import type { RasterizedRow, VLMResult } from '../types';
import type { VLMAdapter, VlmCapability, VlmStatus } from './adapter';

type TransformersModule = typeof import('@huggingface/transformers');
type LoadedProcessor = Awaited<ReturnType<TransformersModule['AutoProcessor']['from_pretrained']>>;
type Gemma4Model = {
  generate: (inputs: Record<string, unknown>) => Promise<{
    slice: (first: null, second: [number, null]) => unknown;
  }>;
  dispose?: () => void;
};
type Gemma4Processor = LoadedProcessor & {
  apply_chat_template: (
    messages: unknown,
    options: { add_generation_prompt: boolean; enable_thinking?: boolean }
  ) => string;
  batch_decode: (
    tokens: unknown,
    options: { skip_special_tokens: boolean }
  ) => string[];
};
type Gemma4ProcessorCall = (
  text: string,
  images: unknown,
  audio: unknown,
  options: { add_special_tokens: boolean }
) => Promise<{ input_ids: { dims: number[] } } & Record<string, unknown>>;

const MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX';
const MAX_NEW_TOKENS = 96;
const TRANSCRIPTION_PROMPT =
  'Read the handwritten mathematical expression in this image. Return only the expression as a single LaTeX string. No prose, no markdown, no explanation, and no surrounding delimiters.';

function extractGemmaText(decoded: string) {
  const withoutChannels = decoded
    .replace(/<pad>/gi, ' ')
    .replace(/<\|channel\|>thought\s*/gi, '')
    .replace(/<\|channel\|>/gi, '')
    .replace(/<\|[a-z_]+\|>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return withoutChannels;
}

type BrowserNavigatorWithGpu = Navigator & {
  gpu?: {
    requestAdapter: () => Promise<unknown>;
  };
};

export class Gemma4OnnxWebGpuAdapter implements VLMAdapter {
  id = 'gemma4-onnx-webgpu';
  label = 'Gemma 4 E2B ONNX (Experimental)';
  private ready = false;
  private model: Gemma4Model | null = null;
  private processor: Gemma4Processor | null = null;
  private transformers: TransformersModule | null = null;
  private loadingPromise: Promise<void> | null = null;
  private statusListener: ((status: VlmStatus) => void) | null = null;

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
        reason: 'You appear to be offline. First load needs network access to fetch the model.',
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
    if (this.ready && this.model && this.processor) {
      this.emitStatus({ stage: 'ready', message: 'Gemma 4 ONNX runtime is ready.' });
      return;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = (async () => {
      const support = await this.checkSupport();
      if (!support.supported) {
        throw new Error(support.reason ?? 'This browser cannot run the Gemma 4 ONNX model.');
      }

      this.emitStatus({
        stage: 'loading',
        message: 'Loading Gemma 4 runtime. This model is much larger than the others.',
      });

      const transformers = await import('@huggingface/transformers');
      transformers.env.allowLocalModels = false;

      const onProgress = (info: {
        status?: string;
        progress?: number;
        file?: string;
        name?: string;
      }) => {
        const label = info.file ?? info.name ?? info.status ?? 'model files';
        this.emitStatus({
          stage: 'loading',
          message: `Loading ${label}...`,
          progress: typeof info.progress === 'number' ? info.progress : undefined,
        });
      };

      const gemma4 = transformers as TransformersModule & {
        Gemma4ForConditionalGeneration?: {
          from_pretrained: (modelId: string, options: Record<string, unknown>) => Promise<Gemma4Model>;
        };
      };

      if (!gemma4.Gemma4ForConditionalGeneration) {
        throw new Error(
          'This Transformers.js build does not expose Gemma4ForConditionalGeneration.',
        );
      }

      const [model, processor] = await Promise.all([
        gemma4.Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, {
          device: 'webgpu',
          dtype: 'q4f16',
          progress_callback: onProgress,
        }),
        transformers.AutoProcessor.from_pretrained(MODEL_ID, {
          progress_callback: onProgress,
        } as never) as Promise<Gemma4Processor>,
      ]);

      this.transformers = transformers;
      this.model = model;
      this.processor = processor;
      this.ready = true;
      this.emitStatus({ stage: 'ready', message: 'Gemma 4 ONNX runtime is ready.' });
    })().finally(() => {
      this.loadingPromise = null;
    });

    return this.loadingPromise.catch((error) => {
      this.emitStatus({
        stage: 'error',
        message: error instanceof Error ? error.message : 'Failed to load the Gemma 4 model.',
      });
      throw error;
    });
  }

  isReady() {
    return this.ready;
  }

  async transcribe(image: RasterizedRow): Promise<VLMResult> {
    await this.load();

    if (!this.model || !this.processor || !this.transformers) {
      throw new Error('The Gemma 4 ONNX model is not ready yet.');
    }

    const { RawImage } = this.transformers;
    const rawImage = new RawImage(image.imageData.data, image.width, image.height, 4);
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image' },
          { type: 'text', text: TRANSCRIPTION_PROMPT },
        ],
      },
    ];

    const prompt = this.processor.apply_chat_template(messages, {
      enable_thinking: false,
      add_generation_prompt: true,
    });

    this.emitStatus({
      stage: 'loading',
      message: `Recognizing formula with Gemma 4 (${MAX_NEW_TOKENS} token cap)...`,
    });

    const inputs = await (this.processor as unknown as Gemma4ProcessorCall)(prompt, rawImage, null, {
      add_special_tokens: false,
    });

    const outputs = (await this.model.generate({
      ...inputs,
      max_new_tokens: MAX_NEW_TOKENS,
      do_sample: false,
    })) as { slice: (first: null, second: [number, null]) => unknown };

    const inputLength = inputs.input_ids.dims.at(-1) ?? 0;
    const generated = outputs.slice(null, [inputLength, null]);
    const decoded = this.processor.batch_decode(generated, {
      skip_special_tokens: true,
    })[0];
    const rawDecoded = this.processor.batch_decode(generated, {
      skip_special_tokens: false,
    })[0];
    const normalized = extractGemmaText(decoded || rawDecoded);

    // Gemma sometimes emits only channel/control scaffolding or an empty step.
    // Fall back to decoding the full output if the generated slice is blank.
    const fallbackDecoded =
      normalized ||
      extractGemmaText(
        this.processor.batch_decode(outputs as never, {
          skip_special_tokens: false,
        })[0],
      );

    this.emitStatus({ stage: 'ready', message: 'Gemma 4 ONNX runtime is ready.' });

    return {
      latex: fallbackDecoded.trim(),
      raw: rawDecoded || decoded,
    };
  }

  async unload() {
    this.model?.dispose?.();
    this.model = null;
    this.processor = null;
    this.transformers = null;
    this.ready = false;
    this.emitStatus({ stage: 'idle', message: 'Model unloaded.' });
  }
}
