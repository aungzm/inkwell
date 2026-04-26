import type { RasterizedRow, VLMResult } from '../types';
import type { VLMAdapter, VlmCapability, VlmStatus } from './adapter';

type TransformersModule = typeof import('@huggingface/transformers');
type ImageModel = Awaited<
  ReturnType<TransformersModule['AutoModelForImageTextToText']['from_pretrained']>
>;
type Processor = Awaited<
  ReturnType<TransformersModule['AutoProcessor']['from_pretrained']>
>;

const MODEL_ID = 'huggingworld/Qwen3.5-0.8B-ONNX';
const INPUT_SIZE = 448;
const MAX_NEW_TOKENS = 48;
const TRANSCRIPTION_PROMPT =
  'Read the handwritten mathematical expression in this image. Return only a single LaTeX expression with no prose, no markdown, and no explanation.';

type BrowserNavigatorWithGpu = Navigator & {
  gpu?: {
    requestAdapter: () => Promise<unknown>;
  };
};

export class Qwen35VlOnnxWebGpuAdapter implements VLMAdapter {
  id = 'qwen35vl-onnx-webgpu';
  label = 'Qwen3.5-VL 0.8B ONNX';
  private ready = false;
  private model: ImageModel | null = null;
  private processor: Processor | null = null;
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
      this.emitStatus({ stage: 'ready', message: 'Qwen3.5-VL ONNX runtime is ready.' });
      return;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = (async () => {
      const support = await this.checkSupport();
      if (!support.supported) {
        throw new Error(support.reason ?? 'This browser cannot run the Qwen3.5-VL ONNX model.');
      }

      this.emitStatus({ stage: 'loading', message: 'Loading Transformers.js runtime...' });
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

      const [model, processor] = await Promise.all([
        transformers.AutoModelForImageTextToText.from_pretrained(MODEL_ID, {
          device: 'webgpu',
          dtype: {
            vision_encoder: 'fp16',
            embed_tokens: 'q4',
            decoder_model_merged: 'q4',
          },
          progress_callback: onProgress,
        }),
        transformers.AutoProcessor.from_pretrained(MODEL_ID, {
          progress_callback: onProgress,
        } as never),
      ]);

      this.transformers = transformers;
      this.model = model;
      this.processor = processor;
      this.ready = true;
      this.emitStatus({ stage: 'ready', message: 'Qwen3.5-VL ONNX runtime is ready.' });
    })().finally(() => {
      this.loadingPromise = null;
    });

    return this.loadingPromise.catch((error) => {
      this.emitStatus({
        stage: 'error',
        message: error instanceof Error ? error.message : 'Failed to load the Qwen3.5-VL model.',
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
      throw new Error('The Qwen3.5-VL ONNX model is not ready yet.');
    }

    this.emitStatus({
      stage: 'loading',
      message: `Preparing image crop (${image.width}x${image.height}) for Qwen...`,
    });

    const { RawImage } = this.transformers;
    const rawImage = new RawImage(image.imageData.data, image.width, image.height, 4);
    const resizedImage = await rawImage.resize(INPUT_SIZE, INPUT_SIZE);

    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image' },
          { type: 'text', text: TRANSCRIPTION_PROMPT },
        ],
      },
    ];

    const chatPrompt = this.processor.apply_chat_template(messages, {
      add_generation_prompt: true,
    });

    let inputs: Awaited<ReturnType<Processor>>;
    try {
      inputs = await this.processor(chatPrompt, resizedImage, {
        add_special_tokens: false,
      });
    } catch (err) {
      console.error('[qwen35vl] processor() failed', {
        rawImage,
        resizedImage,
        width: image.width,
        height: image.height,
      });
      throw new Error(
        `Qwen3.5-VL processor failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let outputs: { slice: (first: null, second: [number, null]) => unknown };
    try {
      this.emitStatus({
        stage: 'loading',
        message: `Recognizing formula with Qwen (${MAX_NEW_TOKENS} token cap)...`,
      });
      outputs = (await this.model.generate({
        ...inputs,
        do_sample: false,
        max_new_tokens: MAX_NEW_TOKENS,
      })) as { slice: (first: null, second: [number, null]) => unknown };
    } catch (err) {
      console.error('[qwen35vl] model.generate() failed', { inputs });
      throw new Error(
        `Qwen3.5-VL generate failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const inputLength = inputs.input_ids.dims.at(-1) ?? 0;
    const generated = outputs.slice(null, [inputLength, null]) as Parameters<
      Processor['batch_decode']
    >[0];
    const decoded = this.processor.batch_decode(generated, {
      skip_special_tokens: true,
    })[0];
    this.emitStatus({ stage: 'ready', message: 'Qwen3.5-VL ONNX runtime is ready.' });

    return {
      latex: decoded.trim(),
      raw: decoded,
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
