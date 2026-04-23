import type { RasterizedRow, VLMResult } from '../types';
import type { VLMAdapter } from './adapter';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const pickResult = (image: RasterizedRow): Omit<VLMResult, 'raw'> => {
  const ratio = image.width / image.height;

  if (ratio > 2.3) {
    return {
      latex: '2 + 3',
      intent: { kind: 'evaluate' },
      confidence: 0.72,
    };
  }

  if (ratio > 1.8) {
    return {
      latex: '2x + 3 = 7',
      intent: { kind: 'solve', for: 'x' },
      confidence: 0.67,
    };
  }

  if (image.height > 320) {
    return {
      latex: '\\frac{d}{dx} x^3',
      intent: { kind: 'derivative', withRespectTo: 'x' },
      confidence: 0.65,
    };
  }

  if (ratio < 1.1) {
    return {
      latex: '\\frac{1}{2}',
      intent: { kind: 'evaluate' },
      confidence: 0.58,
    };
  }

  return {
    latex: '(x+1)^2 - x^2',
    intent: { kind: 'simplify' },
    confidence: 0.63,
  };
};

export class DemoLfm25Adapter implements VLMAdapter {
  id = 'lfm25-demo';
  label = 'LFM2.5 Demo Adapter';
  private ready = false;

  async load() {
    if (this.ready) {
      return;
    }

    await sleep(300);
    this.ready = true;
  }

  isReady() {
    return this.ready;
  }

  async transcribe(image: RasterizedRow): Promise<VLMResult> {
    await this.load();
    await sleep(650);
    const result = pickResult(image);
    const variable =
      result.intent?.kind === 'solve'
        ? result.intent.for ?? null
        : result.intent?.kind === 'derivative' || result.intent?.kind === 'integral'
          ? result.intent.withRespectTo
          : null;

    return {
      ...result,
      raw: JSON.stringify({
        latex: result.latex,
        intent: result.intent?.kind ?? null,
        variable,
      }),
    };
  }

  async unload() {
    this.ready = false;
  }
}
