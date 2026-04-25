import * as ort from 'onnxruntime-web/wasm';
import type { RasterizedRow, Stroke, VLMResult } from '../types';
import type { VLMAdapter, VlmCapability, VlmStatus } from './adapter';
import classConfig from '../../demo/classes.json';
import modelUrl from '../../demo/math_v1.onnx?url';
import ortWasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasmBinaryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

type ClassConfig = {
  classes: string[];
  img_size: number;
};

type StrokeBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
};

type SymbolPrediction = {
  symbol: string;
  confidence: number;
  bbox: StrokeBounds;
};

const config = classConfig as ClassConfig;
const CLASSES = config.classes;
const IMAGE_SIZE = config.img_size;
const MODEL_INPUT_NAME = 'input';
const MODEL_OUTPUT_NAME = 'logits';
const STROKE_GROUP_PX = 40;
const STROKE_GROUP_MS = 1200;
const STROKE_VERTICAL_OVERLAP = 0.3;

function strokeBounds(stroke: Stroke): StrokeBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of stroke.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
  };
}

function mergeBounds(boxes: StrokeBounds[]): StrokeBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const box of boxes) {
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
  };
}

function bboxesOverlapVertically(a: StrokeBounds, b: StrokeBounds) {
  const overlap = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  const minHeight = Math.min(a.h, b.h);
  return minHeight > 0 && overlap / minHeight >= STROKE_VERTICAL_OVERLAP;
}

function shouldGroup(
  strokeA: Pick<Stroke, 'startedAt' | 'endedAt'>,
  strokeB: Pick<Stroke, 'startedAt' | 'endedAt'>,
  bboxA: StrokeBounds,
  bboxB: StrokeBounds,
) {
  const timeGap = Math.abs(strokeB.startedAt - strokeA.endedAt);
  if (timeGap > STROKE_GROUP_MS) {
    return false;
  }

  const horizontalGap = Math.max(
    0,
    Math.max(bboxA.minX, bboxB.minX) - Math.min(bboxA.maxX, bboxB.maxX),
  );
  if (horizontalGap > STROKE_GROUP_PX) {
    return false;
  }

  if (!bboxesOverlapVertically(bboxA, bboxB)) {
    const horizontalCenterDistance = Math.abs(bboxA.cx - bboxB.cx);
    if (horizontalCenterDistance > Math.max(bboxA.w, bboxB.w) * 0.7) {
      return false;
    }
  }

  return true;
}

function groupStrokes(strokes: Stroke[]) {
  if (strokes.length === 0) {
    return [];
  }

  const bboxes = strokes.map(strokeBounds);
  const groups: number[][] = [];

  for (let index = 0; index < strokes.length; index += 1) {
    let placed = false;

    for (const group of groups) {
      const groupBox = mergeBounds(group.map((strokeIndex) => bboxes[strokeIndex]));
      const groupLastEndedAt = Math.max(...group.map((strokeIndex) => strokes[strokeIndex].endedAt));
      if (
        shouldGroup(
          { startedAt: groupLastEndedAt, endedAt: groupLastEndedAt },
          strokes[index],
          groupBox,
          bboxes[index],
        )
      ) {
        group.push(index);
        placed = true;
        break;
      }
    }

    if (!placed) {
      groups.push([index]);
    }
  }

  return groups;
}

function rasterizeGroup(group: Stroke[], imgSize: number) {
  const bbox = mergeBounds(group.map(strokeBounds));
  const padding = Math.max(bbox.w, bbox.h) * 0.15 + 4;
  const symbolExtent = Math.max(bbox.w, bbox.h) + padding * 2;
  const scale = imgSize / symbolExtent;
  const offsetX = imgSize / 2 - bbox.cx * scale;
  const offsetY = imgSize / 2 - bbox.cy * scale;

  const canvas = document.createElement('canvas');
  canvas.width = imgSize;
  canvas.height = imgSize;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to prepare symbol canvas.');
  }

  context.fillStyle = '#000000';
  context.fillRect(0, 0, imgSize, imgSize);
  context.strokeStyle = '#ffffff';
  context.lineWidth = 2;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (const stroke of group) {
    if (stroke.points.length === 0) {
      continue;
    }

    context.beginPath();
    stroke.points.forEach((point, index) => {
      const x = point.x * scale + offsetX;
      const y = point.y * scale + offsetY;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.stroke();
  }

  return { canvas, bbox };
}

function canvasToTensor(canvas: HTMLCanvasElement, imgSize: number) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Unable to read symbol canvas.');
  }

  const data = context.getImageData(0, 0, imgSize, imgSize).data;
  const tensorData = new Float32Array(imgSize * imgSize);
  for (let index = 0; index < imgSize * imgSize; index += 1) {
    tensorData[index] = data[index * 4] / 255;
  }

  return new ort.Tensor('float32', tensorData, [1, 1, imgSize, imgSize]);
}

function topClass(logits: Float32Array) {
  let bestIndex = 0;
  let bestValue = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < logits.length; index += 1) {
    if (logits[index] > bestValue) {
      bestValue = logits[index];
      bestIndex = index;
    }
  }

  let total = 0;
  for (const value of logits) {
    total += Math.exp(value - bestValue);
  }

  return {
    symbol: CLASSES[bestIndex] ?? '',
    confidence: 1 / total,
  };
}

function toLatex(raw: string) {
  return raw.replaceAll('*', ' \\cdot ');
}

export class LocalMathOnnxAdapter implements VLMAdapter {
  id = 'local-math-onnx';
  label = 'Local Math ONNX';
  private ready = false;
  private session: ort.InferenceSession | null = null;
  private loadingPromise: Promise<void> | null = null;
  private statusListener: ((status: VlmStatus) => void) | null = null;

  private emitStatus(status: VlmStatus) {
    this.statusListener?.(status);
  }

  setStatusListener(listener: ((status: VlmStatus) => void) | null) {
    this.statusListener = listener;
  }

  async checkSupport(): Promise<VlmCapability> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return {
        supported: false,
        reason: 'This adapter needs a browser environment.',
      };
    }

    return { supported: true };
  }

  async load() {
    if (this.ready && this.session) {
      this.emitStatus({ stage: 'ready', message: 'Local ONNX model is ready.' });
      return;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = (async () => {
      const support = await this.checkSupport();
      if (!support.supported) {
        throw new Error(support.reason ?? 'This browser cannot run the local ONNX model.');
      }

      this.emitStatus({ stage: 'loading', message: 'Loading local ONNX model...' });
      ort.env.wasm.proxy = false;
      (ort.env.wasm as typeof ort.env.wasm & { wasmPaths?: { mjs?: string; wasm?: string } }).wasmPaths =
        {
          mjs: ortWasmModuleUrl,
          wasm: ortWasmBinaryUrl,
        };
      this.session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
      });
      this.ready = true;
      this.emitStatus({ stage: 'ready', message: 'Local ONNX model is ready.' });
    })().finally(() => {
      this.loadingPromise = null;
    });

    return this.loadingPromise.catch((error) => {
      this.emitStatus({
        stage: 'error',
        message: error instanceof Error ? error.message : 'Failed to load the local ONNX model.',
      });
      throw error;
    });
  }

  isReady() {
    return this.ready;
  }

  async transcribe(image: RasterizedRow): Promise<VLMResult> {
    await this.load();

    if (!this.session) {
      throw new Error('The local ONNX model is not ready yet.');
    }

    if (!image.strokes.length) {
      throw new Error('No strokes were available for recognition.');
    }

    const groups = groupStrokes(image.strokes);
    const symbols: SymbolPrediction[] = [];

    for (const group of groups) {
      const groupedStrokes = group.map((index) => image.strokes[index]);
      const { canvas, bbox } = rasterizeGroup(groupedStrokes, IMAGE_SIZE);
      const tensor = canvasToTensor(canvas, IMAGE_SIZE);
      const result = await this.session.run({ [MODEL_INPUT_NAME]: tensor });
      const logits = result[MODEL_OUTPUT_NAME].data as Float32Array;
      const topPrediction = topClass(logits);

      symbols.push({
        symbol: topPrediction.symbol,
        confidence: topPrediction.confidence,
        bbox,
      });
    }

    symbols.sort((a, b) => a.bbox.cx - b.bbox.cx);
    const raw = symbols.map((symbol) => symbol.symbol).join('');
    const confidence =
      symbols.reduce((sum, symbol) => sum + symbol.confidence, 0) / Math.max(1, symbols.length);

    return {
      latex: toLatex(raw),
      raw,
      confidence,
    };
  }

  async unload() {
    this.session = null;
    this.ready = false;
    this.emitStatus({ stage: 'idle', message: 'Model unloaded.' });
  }
}
