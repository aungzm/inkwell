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
  };
}
