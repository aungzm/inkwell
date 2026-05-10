import { getStroke } from 'perfect-freehand';
import type { RasterizedRow, Stroke } from '../types';

const getStrokeOptions = (size: number) => ({
  size,
  thinning: 0.68,
  smoothing: 0.5,
  streamline: 0.4,
  simulatePressure: false,
});

const PADDING = 14;
const CONTENT_THRESHOLD = 245;

const toSvgPath = (points: number[][]) => {
  if (points.length === 0) {
    return '';
  }

  const [first, ...rest] = points;
  const commands = [`M ${first[0]} ${first[1]}`];

  for (const point of rest) {
    commands.push(`L ${point[0]} ${point[1]}`);
  }

  commands.push('Z');
  return commands.join(' ');
};

function findContentBounds(imageData: ImageData) {
  const { data, width, height } = imageData;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3] ?? 0;
      const red = data[offset] ?? 255;
      const green = data[offset + 1] ?? 255;
      const blue = data[offset + 2] ?? 255;

      if (
        alpha > 0 &&
        (red < CONTENT_THRESHOLD || green < CONTENT_THRESHOLD || blue < CONTENT_THRESHOLD)
      ) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

export function rasterizeStrokes(
  strokes: Stroke[],
  scale = 2,
): RasterizedRow | null {
  const outlinePoints = strokes.flatMap((stroke) =>
    getStroke(
      stroke.points.map((point) => [point.x, point.y, point.pressure] as const),
      getStrokeOptions(stroke.size),
    ),
  );

  if (outlinePoints.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of outlinePoints) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const width = Math.ceil(maxX - minX + PADDING * 2);
  const height = Math.ceil(maxY - minY + PADDING * 2);
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');

  if (!context) {
    return null;
  }

  context.scale(scale, scale);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  for (const stroke of strokes) {
    const outline = getStroke(
      stroke.points.map((point) => [point.x, point.y, point.pressure] as const),
      getStrokeOptions(stroke.size),
    ).map(([x, y]) => [x - minX + PADDING, y - minY + PADDING]);

    const path = toSvgPath(outline);
    if (!path) {
      continue;
    }

    context.fillStyle = stroke.color;
    context.fill(new Path2D(path));
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return {
    imageData,
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    strokes: strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    })),
  };
}

export function rasterizeCanvasRegion(
  sourceCanvas: HTMLCanvasElement,
  scale = 2,
): RasterizedRow | null {
  const sourceContext = sourceCanvas.getContext('2d');

  if (!sourceContext) {
    return null;
  }

  const sourceImage = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const bounds = findContentBounds(sourceImage);

  if (!bounds) {
    return null;
  }

  const width = Math.ceil(bounds.maxX - bounds.minX + 1 + PADDING * 2);
  const height = Math.ceil(bounds.maxY - bounds.minY + 1 + PADDING * 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');

  if (!context) {
    return null;
  }

  context.scale(scale, scale);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(
    sourceCanvas,
    bounds.minX,
    bounds.minY,
    bounds.maxX - bounds.minX + 1,
    bounds.maxY - bounds.minY + 1,
    PADDING,
    PADDING,
    bounds.maxX - bounds.minX + 1,
    bounds.maxY - bounds.minY + 1,
  );

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return {
    imageData,
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    strokes: [],
  };
}
