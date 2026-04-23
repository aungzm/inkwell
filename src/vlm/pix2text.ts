import type { RasterizedRow, VLMResult } from '../types';
import type { VLMAdapter, VlmCapability, VlmStatus } from './adapter';

type TransformersModule = typeof import('@huggingface/transformers');
type OrtModule = typeof import('onnxruntime-web');
type Processor = Awaited<ReturnType<TransformersModule['AutoProcessor']['from_pretrained']>>;
type ProcessorResult = Awaited<ReturnType<Processor>>;
type OrtSession = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>;
type OrtTensorInstance = InstanceType<OrtModule['Tensor']>;

const MODEL_ID = 'breezedeus/pix2text-mfr';
const MODEL_REVISION = 'main';
const ORT_VERSION = '1.26.0-dev.20260416-b7804b056c';
const ENCODER_URL = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/encoder_model.onnx`;
const DECODER_URL = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/decoder_model.onnx`;
const DEFAULT_MAX_TOKENS = 256;
const ORT_WASM_PREFIX = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

type BrowserNavigatorWithGpu = Navigator & {
  gpu?: {
    requestAdapter: () => Promise<unknown>;
  };
};

type TensorLike = {
  data: ArrayLike<number> | ArrayLike<bigint>;
  dims: number[];
  type: string;
};

const hasBigInt64Array = (): boolean => typeof BigInt64Array !== 'undefined';

function isTensorLike(value: unknown): value is TensorLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'dims' in value &&
    'type' in value &&
    Array.isArray((value as { dims?: unknown }).dims) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function toOrtTensor(ort: OrtModule, tensor: TensorLike) {
  const dims = [...tensor.dims];
  const type = tensor.type === 'int64' ? 'int64' : tensor.type === 'bool' ? 'bool' : 'float32';

  if (type === 'int64') {
    const source = Array.from(tensor.data as ArrayLike<number | bigint>, (value) => BigInt(value));
    return new ort.Tensor('int64', BigInt64Array.from(source), dims);
  }

  if (type === 'bool') {
    return new ort.Tensor('bool', Uint8Array.from(tensor.data as ArrayLike<number>, (value) => value), dims);
  }

  return new ort.Tensor(
    'float32',
    Float32Array.from(tensor.data as ArrayLike<number>, (value) => value),
    dims,
  );
}

function createInt64Tensor(ort: OrtModule, values: readonly number[], dims: number[]) {
  if (!hasBigInt64Array()) {
    throw new Error('This browser does not support BigInt64Array, which Pix2Text needs for decoding.');
  }

  return new ort.Tensor('int64', BigInt64Array.from(values, (value) => BigInt(value)), dims);
}

function createOnesTensor(ort: OrtModule, length: number) {
  return new ort.Tensor('int64', BigInt64Array.from({ length }, () => 1n), [1, length]);
}

function createPositionIdsTensor(ort: OrtModule, length: number) {
  return new ort.Tensor('int64', BigInt64Array.from({ length }, (_, index) => BigInt(index)), [1, length]);
}

function argmaxLastToken(logits: { dims: readonly number[]; data: unknown }): number {
  const [batch, sequenceLength, vocabSize] = logits.dims;
  if (batch !== 1 || !sequenceLength || !vocabSize) {
    throw new Error('Unexpected Pix2Text decoder logits shape.');
  }

  const data = logits.data as ArrayLike<number>;
  const offset = (sequenceLength - 1) * vocabSize;
  let bestIndex = 0;
  let bestValue = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < vocabSize; index += 1) {
    const value = data[offset + index];
    if (value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function normalizeLatex(text: string) {
  return text
    .replace(/<s>|<\/s>|<pad>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findTensorOutput(
  outputs: Record<string, OrtTensorInstance>,
  preferredNames: readonly string[],
): OrtTensorInstance {
  for (const name of preferredNames) {
    const tensor = outputs[name];
    if (tensor) {
      return tensor;
    }
  }

  const firstTensor = Object.values(outputs)[0];
  if (!firstTensor) {
    throw new Error('Pix2Text returned no decoder output tensors.');
  }
  return firstTensor;
}

export class Pix2TextWebGpuAdapter implements VLMAdapter {
  id = 'pix2text-mfr';
  label = 'Pix2Text MFR (WebGPU)';
  private ready = false;
  private processor: Processor | null = null;
  private transformers: TransformersModule | null = null;
  private ort: OrtModule | null = null;
  private encoderSession: OrtSession | null = null;
  private decoderSession: OrtSession | null = null;
  private loadingPromise: Promise<void> | null = null;
  private statusListener: ((status: VlmStatus) => void) | null = null;
  private generationConfig = {
    decoderStartTokenId: 2,
    eosTokenId: 2,
    padTokenId: 0,
    maxNewTokens: DEFAULT_MAX_TOKENS,
  };

  private emitStatus(status: VlmStatus) {
    this.statusListener?.(status);
  }

  setStatusListener(listener: ((status: VlmStatus) => void) | null) {
    this.statusListener = listener;
  }

  async checkSupport(): Promise<VlmCapability> {
    this.emitStatus({ stage: 'checking', message: 'Checking browser and WebGPU support...' });

    if (!navigator.onLine) {
      return {
        supported: false,
        reason: 'You appear to be offline. Pix2Text needs internet access on first load.',
      };
    }

    if (!hasBigInt64Array()) {
      return {
        supported: false,
        reason: 'This browser is missing BigInt64Array support, so Pix2Text cannot decode tokens.',
      };
    }

    const webGpuNavigator = navigator as BrowserNavigatorWithGpu;
    if (!webGpuNavigator.gpu) {
      return {
        supported: false,
        reason: 'WebGPU is not available in this browser.',
      };
    }

    const adapter = await webGpuNavigator.gpu.requestAdapter();
    if (!adapter) {
      return {
        supported: false,
        reason: 'A WebGPU adapter could not be created on this device.',
      };
    }

    return { supported: true };
  }

  async load() {
    if (this.ready && this.processor && this.encoderSession && this.decoderSession) {
      this.emitStatus({ stage: 'ready', message: 'Pix2Text MFR is ready.' });
      return;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = (async () => {
      const support = await this.checkSupport();
      if (!support.supported) {
        throw new Error(support.reason ?? 'This browser cannot run Pix2Text over WebGPU.');
      }

      this.emitStatus({ stage: 'loading', message: 'Loading Pix2Text runtime...' });
      const [transformers, ort] = await Promise.all([
        import('@huggingface/transformers'),
        import('onnxruntime-web'),
      ]);

      transformers.env.allowLocalModels = false;
      if (transformers.env.backends.onnx.wasm) {
        transformers.env.backends.onnx.wasm.proxy = false;
      }

      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = ORT_WASM_PREFIX;

      const onProgress = (info: { status?: string; progress?: number; file?: string; name?: string }) => {
        const label = info.file ?? info.name ?? info.status ?? 'model files';
        this.emitStatus({
          stage: 'loading',
          message: `Loading ${label}...`,
          progress: typeof info.progress === 'number' ? info.progress : undefined,
        });
      };

      const [processor, encoderSession, decoderSession, generationConfigResponse] = await Promise.all([
        transformers.AutoProcessor.from_pretrained(MODEL_ID, {
          progress_callback: onProgress,
        } as never),
        ort.InferenceSession.create(ENCODER_URL, {
          executionProviders: ['webgpu'],
        }),
        ort.InferenceSession.create(DECODER_URL, {
          executionProviders: ['webgpu'],
        }),
        fetch(`https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/generation_config.json`).catch(
          () => null,
        ),
      ]);

      if (generationConfigResponse?.ok) {
        const rawConfig = (await generationConfigResponse.json()) as Partial<{
          decoder_start_token_id: number;
          eos_token_id: number;
          pad_token_id: number;
          max_new_tokens: number;
        }>;

        this.generationConfig = {
          decoderStartTokenId:
            rawConfig.decoder_start_token_id ?? this.generationConfig.decoderStartTokenId,
          eosTokenId: rawConfig.eos_token_id ?? this.generationConfig.eosTokenId,
          padTokenId: rawConfig.pad_token_id ?? this.generationConfig.padTokenId,
          maxNewTokens: rawConfig.max_new_tokens ?? this.generationConfig.maxNewTokens,
        };
      }

      this.transformers = transformers;
      this.ort = ort;
      this.processor = processor;
      this.encoderSession = encoderSession;
      this.decoderSession = decoderSession;
      this.ready = true;
      this.emitStatus({ stage: 'ready', message: 'Pix2Text MFR is ready.' });
    })().finally(() => {
      this.loadingPromise = null;
    });

    return this.loadingPromise.catch((error) => {
      this.emitStatus({
        stage: 'error',
        message: error instanceof Error ? error.message : 'Failed to load the Pix2Text model.',
      });
      throw error;
    });
  }

  isReady() {
    return this.ready;
  }

  async transcribe(image: RasterizedRow): Promise<VLMResult> {
    await this.load();

    if (
      !this.processor ||
      !this.transformers ||
      !this.ort ||
      !this.encoderSession ||
      !this.decoderSession
    ) {
      throw new Error('Pix2Text is not ready yet.');
    }

    const { RawImage } = this.transformers;
    const rawImage = new RawImage(image.imageData.data, image.width, image.height, 4);
    const processed = (await this.processor(rawImage)) as ProcessorResult;
    const pixelValues = processed.pixel_values;

    if (!isTensorLike(pixelValues)) {
      throw new Error('Pix2Text preprocessing did not return image tensors.');
    }

    const encoderOutputs = await this.encoderSession.run({
      pixel_values: toOrtTensor(this.ort, pixelValues),
    });
    const encoderHiddenStates = findTensorOutput(encoderOutputs, ['last_hidden_state']);

    const generatedIds = [this.generationConfig.decoderStartTokenId];
    const maxTokens = Math.max(16, Math.min(1024, this.generationConfig.maxNewTokens));

    for (let step = 0; step < maxTokens; step += 1) {
      const decoderFeeds: Record<string, OrtTensorInstance> = {};

      for (const inputName of this.decoderSession.inputNames) {
        if (inputName === 'input_ids' || inputName === 'decoder_input_ids') {
          decoderFeeds[inputName] = createInt64Tensor(this.ort, generatedIds, [1, generatedIds.length]);
          continue;
        }

        if (inputName === 'encoder_hidden_states') {
          decoderFeeds[inputName] = encoderHiddenStates;
          continue;
        }

        if (inputName === 'encoder_attention_mask') {
          decoderFeeds[inputName] = createOnesTensor(this.ort, encoderHiddenStates.dims[1]);
          continue;
        }

        if (inputName === 'attention_mask' || inputName === 'decoder_attention_mask') {
          decoderFeeds[inputName] = createOnesTensor(this.ort, generatedIds.length);
          continue;
        }

        if (inputName === 'position_ids') {
          decoderFeeds[inputName] = createPositionIdsTensor(this.ort, generatedIds.length);
          continue;
        }

        if (inputName === 'use_cache_branch') {
          decoderFeeds[inputName] = new this.ort.Tensor('bool', [false], [1]);
        }
      }

      const decoderOutputs = await this.decoderSession.run(decoderFeeds);
      const logits = findTensorOutput(decoderOutputs, ['logits']);
      const nextTokenId = argmaxLastToken(logits);

      if (nextTokenId === this.generationConfig.eosTokenId) {
        break;
      }

      if (nextTokenId !== this.generationConfig.padTokenId) {
        generatedIds.push(nextTokenId);
      }
    }

    const decoded = this.processor.batch_decode([generatedIds], {
      skip_special_tokens: true,
    })[0];
    const latex = normalizeLatex(decoded);

    return {
      latex,
      raw: decoded,
    };
  }

  async unload() {
    await Promise.all([
      this.encoderSession?.release?.(),
      this.decoderSession?.release?.(),
    ]);
    this.processor = null;
    this.transformers = null;
    this.ort = null;
    this.encoderSession = null;
    this.decoderSession = null;
    this.ready = false;
    this.emitStatus({ stage: 'idle', message: 'Model unloaded.' });
  }
}
