import type { RasterizedRow, VLMResult } from '../types';
import type { VLMAdapter, VlmCapability, VlmStatus } from './adapter';

type TransformersModule = typeof import('@huggingface/transformers');
type ImageToTextPipeline = Awaited<ReturnType<TransformersModule['pipeline']>> & ((
  input: unknown,
  options?: { max_new_tokens?: number },
) => Promise<Array<{ generated_text: string }>>);

const MODEL_ID = 'breezedeus/pix2text-mfr';
type BrowserNavigatorWithGpu = Navigator & {
  gpu?: {
    requestAdapter: () => Promise<unknown>;
  };
};

export class Pix2TextWebGpuAdapter implements VLMAdapter {
  id = 'pix2text-mfr';
  label = 'Pix2Text MFR (WebGPU)';
  private ready = false;
  private pipe: ImageToTextPipeline | null = null;
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
        reason: 'You appear to be offline. The model files need an internet connection on first load.',
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
    if (this.ready && this.pipe) {
      this.emitStatus({ stage: 'ready', message: 'Pix2Text MFR is ready.' });
      return;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = (async () => {
      const support = await this.checkSupport();
      if (!support.supported) {
        throw new Error(support.reason ?? 'This browser cannot run the Pix2Text WebGPU model.');
      }

      this.emitStatus({ stage: 'loading', message: 'Loading Transformers.js runtime...' });
      const transformers = await import('@huggingface/transformers');
      transformers.env.allowLocalModels = false;

      const onProgress = (info: { status?: string; progress?: number; file?: string; name?: string }) => {
        const label = info.file ?? info.name ?? info.status ?? 'model files';
        this.emitStatus({
          stage: 'loading',
          message: `Loading ${label}...`,
          progress: typeof info.progress === 'number' ? info.progress : undefined,
        });
      };

      const pipe = (await transformers.pipeline('image-to-text', MODEL_ID, {
        device: 'webgpu',
        progress_callback: onProgress,
      })) as ImageToTextPipeline;

      this.transformers = transformers;
      this.pipe = pipe;
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

    if (!this.pipe || !this.transformers) {
      throw new Error('The Pix2Text model is not ready yet.');
    }

    const { RawImage } = this.transformers;
    const rawImage = new RawImage(image.imageData.data, image.width, image.height, 4);
    const output = await this.pipe(rawImage, {
      max_new_tokens: 128,
    });
    const generated = Array.isArray(output) && output.length > 0 ? output[0]?.generated_text ?? '' : '';
    const latex = generated.trim();

    return {
      latex,
      raw: generated,
    };
  }

  async unload() {
    this.pipe?.dispose?.();
    this.pipe = null;
    this.transformers = null;
    this.ready = false;
    this.emitStatus({ stage: 'idle', message: 'Model unloaded.' });
  }
}
