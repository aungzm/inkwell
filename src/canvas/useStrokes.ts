import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { getStroke } from 'perfect-freehand';
import type { Stroke } from '../types';

const clampPressure = (pressure: number) => {
  if (!Number.isFinite(pressure) || pressure <= 0) {
    return 0.5;
  }

  return Math.min(Math.max(pressure, 0.08), 1);
};

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

type UseStrokesOptions = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
};

export function useStrokes({ canvasRef }: UseStrokesOptions) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const activeStrokeIdRef = useRef<string | null>(null);
  const strokeCounterRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const bounds = canvas.getBoundingClientRect();
    canvas.width = Math.floor(bounds.width * ratio);
    canvas.height = Math.floor(bounds.height * ratio);
    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.fillStyle = '#18283b';

    for (const stroke of strokes) {
      const outline = getStroke(
        stroke.points.map((point) => [point.x, point.y, point.pressure] as const),
        {
          size: 14,
          thinning: 0.68,
          smoothing: 0.5,
          streamline: 0.4,
          simulatePressure: false,
        },
      );

      const path = toSvgPath(outline);
      if (!path) {
        continue;
      }

      const drawingPath = new Path2D(path);
      context.fill(drawingPath);
    }
  }, [canvasRef, strokes]);

  const getPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const bounds = canvas.getBoundingClientRect();

    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      pressure: clampPressure(event.pressure),
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = getPoint(event);
    if (!point) {
      return;
    }

    strokeCounterRef.current += 1;
    const strokeId = `stroke-${strokeCounterRef.current}`;
    activeStrokeIdRef.current = strokeId;
    setIsDrawing(true);
    setStrokes((current) => [...current, { id: strokeId, points: [point] }]);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!activeStrokeIdRef.current) {
      return;
    }

    const point = getPoint(event);
    if (!point) {
      return;
    }

    setStrokes((current) =>
      current.map((stroke) =>
        stroke.id === activeStrokeIdRef.current
          ? { ...stroke, points: [...stroke.points, point] }
          : stroke,
      ),
    );
  };

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!activeStrokeIdRef.current) {
      return;
    }

    activeStrokeIdRef.current = null;
    setIsDrawing(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const clear = () => {
    activeStrokeIdRef.current = null;
    setIsDrawing(false);
    setStrokes([]);
  };

  return {
    strokes,
    isDrawing,
    clear,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishStroke,
      onPointerCancel: finishStroke,
      onPointerLeave: finishStroke,
    },
  };
}
