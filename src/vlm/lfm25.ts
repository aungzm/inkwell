import type { RasterizedRow, VLMResult } from '../types';
import type { VLMAdapter } from './adapter';

type TransformersModule = typeof import('@huggingface/transformers');
type ImageModel = Awaited<
  ReturnType<TransformersModule['AutoModelForImageTextToText']['from_pretrained']>
>;
type Processor = Awaited<
  ReturnType<TransformersModule['AutoProcessor']['from_pretrained']>
>;

const MODEL_ID = 'LiquidAI/LFM2.5-VL-450M-ONNX';
type BrowserNavigatorWithGpu = Navigator & {
  gpu?: {
    requestAdapter: () => Promise<unknown>;
  };
};

export class Lfm25WebGpuAdapter implements VLMAdapter {
  id = 'lfm25-webgpu';
  label = 'LiquidAI LFM2.5-VL-450M (WebGPU)';
  private ready = false;
  private model: ImageModel | null = null;
  private processor: Processor | null = null;
  private transformers: TransformersModule | null = null;
  private loadingPromise: Promise<void> | null = null;

  async load() {
    if (this.ready && this.model && this.processor) {
      return;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = (async () => {
      const webGpuNavigator = navigator as BrowserNavigatorWithGpu;
      if (!webGpuNavigator.gpu) {
        throw new Error('WebGPU is not available in this browser.');
      }

      const adapter = await webGpuNavigator.gpu.requestAdapter();
      if (!adapter) {
        throw new Error('No WebGPU adapter was found on this device.');
      }

      const transformers = await import('@huggingface/transformers');
      transformers.env.allowLocalModels = false;

      const [model, processor] = await Promise.all([
        transformers.AutoModelForImageTextToText.from_pretrained(MODEL_ID, {
          device: 'webgpu',
          dtype: {
            vision_encoder: 'fp16',
            embed_tokens: 'fp16',
            decoder_model_merged: 'q4',
          },
        }),
        transformers.AutoProcessor.from_pretrained(MODEL_ID),
      ]);

      this.transformers = transformers;
      this.model = model;
      this.processor = processor;
      this.ready = true;
    })().finally(() => {
      this.loadingPromise = null;
    });

    return this.loadingPromise;
  }

  isReady() {
    return this.ready;
  }

  async transcribe(image: RasterizedRow): Promise<VLMResult> {
    await this.load();

    if (!this.model || !this.processor || !this.transformers) {
      throw new Error('The LFM2.5 WebGPU model is not ready yet.');
    }

    const { RawImage } = this.transformers;
    const rawImage = new RawImage(image.imageData.data, image.width, image.height, 4);
    const prompt =
      'Transcribe the handwritten content in this image. Return only the final LaTeX or plain text with no explanation.';
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image' },
          { type: 'text', text: prompt },
        ],
      },
    ];

    const chatPrompt = this.processor.apply_chat_template(messages, {
      add_generation_prompt: true,
    });
    const inputs = await this.processor(rawImage, chatPrompt, {
      add_special_tokens: false,
    });
    const outputs = (await this.model.generate({
      ...inputs,
      do_sample: false,
      max_new_tokens: 96,
    })) as { slice: (first: null, second: [number, null]) => unknown };

    const inputLength = inputs.input_ids.dims.at(-1) ?? 0;
    const generated = outputs.slice(null, [inputLength, null]) as Parameters<
      Processor['batch_decode']
    >[0];
    const decoded = this.processor.batch_decode(generated, {
      skip_special_tokens: true,
    })[0];
    const latex = decoded.trim();

    return {
      latex,
      raw: decoded,
    };
  }

  async unload() {
    this.model?.dispose?.();
    this.model = null;
    this.processor = null;
    this.transformers = null;
    this.ready = false;
  }
}
