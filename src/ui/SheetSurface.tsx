import { useEffect, useMemo, useRef, useState } from 'react';
import { getStroke } from 'perfect-freehand';
import type { VLMAdapter } from '../vlm/adapter';
import type { RasterizedRow, Stroke } from '../types';
import { usePauseDetector } from '../canvas/pauseDetector';
import { rasterizeStrokes } from '../canvas/rasterize';
import { useStrokes } from '../canvas/useStrokes';
import { MathBlock } from './MathBlock';

type SheetSurfaceProps = {
  adapter: VLMAdapter;
  tool: 'pencil' | 'eraser';
  strokeColor: string;
  strokeSize: number;
  onValidateResult: (image: RasterizedRow) => Promise<{ latex: string }>;
};

type Placement = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  latex?: string;
  error?: string;
  status: 'pending' | 'ready' | 'error';
};

const getStrokeOptions = (size: number) => ({
  size,
  thinning: 0.68,
  smoothing: 0.5,
  streamline: 0.4,
  simulatePressure: false,
});

const getStrokeBounds = (strokes: Stroke[]) => {
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

  return {
    x: minX,
    y: minY,
    width: Math.max(48, maxX - minX),
    height: Math.max(36, maxY - minY),
  };
};

export function SheetSurface({
  adapter,
  tool,
  strokeColor,
  strokeSize,
  onValidateResult,
}: SheetSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [lastInteractionAt, setLastInteractionAt] = useState<number | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);

  const eraseRadius = useMemo(() => Math.max(10, strokeSize), [strokeSize]);

  const { strokes, isDrawing, clear, bind } = useStrokes({
    canvasRef,
    tool,
    strokeColor,
    strokeSize,
    onErasePoint: (point) => {
      setPlacements((current) =>
        current.filter((placement) => {
          const left = placement.x - eraseRadius;
          const right = placement.x + placement.width + eraseRadius;
          const top = placement.y - eraseRadius;
          const bottom = placement.y + placement.height + eraseRadius;
          return !(
            point.x >= left &&
            point.x <= right &&
            point.y >= top &&
            point.y <= bottom
          );
        }),
      );
    },
  });

  useEffect(() => {
    if (strokes.length === 0) {
      return;
    }

    setLastInteractionAt(Date.now());
  }, [strokes]);

  const hasInk = strokes.length > 0;

  const submit = async () => {
    if (!hasInk) {
      return;
    }

    const bounds = getStrokeBounds(strokes);
    const rasterized = rasterizeStrokes(strokes);
    if (!bounds || !rasterized) {
      return;
    }

    const placementId = `placement-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    clear();
    setLastInteractionAt(null);
    setPlacements((current) => [
      ...current,
      {
        id: placementId,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        status: 'pending',
      },
    ]);

    try {
      const result = await onValidateResult(rasterized);
      setPlacements((current) =>
        current.map((placement) =>
          placement.id === placementId
            ? {
                ...placement,
                latex: result.latex,
                status: 'ready',
              }
            : placement,
        ),
      );
    } catch (error) {
      setPlacements((current) =>
        current.map((placement) =>
          placement.id === placementId
            ? {
                ...placement,
                error:
                  error instanceof Error
                    ? error.message
                    : 'Unable to interpret this handwriting yet.',
                status: 'error',
              }
            : placement,
        ),
      );
    }
  };

  const timeLeft = usePauseDetector({
    enabled: hasInk,
    isDrawing,
    isHovering,
    lastInteractionAt,
    onPause: () => {
      void submit();
    },
  });

  return (
    <div className="sheet-surface-shell">
      <div className="sheet-surface">
        {placements.map((placement) => (
          <div
            key={placement.id}
            className={`sheet-placement placement-${placement.status}`}
            style={{
              left: placement.x,
              top: placement.y,
              minWidth: placement.width,
              minHeight: placement.height,
            }}
          >
            {placement.status === 'ready' && placement.latex && (
              <MathBlock latex={placement.latex} />
            )}
            {placement.status === 'pending' && (
              <p className="placement-status">Interpreting...</p>
            )}
            {placement.status === 'error' && (
              <p className="placement-error">{placement.error}</p>
            )}
          </div>
        ))}

        <canvas
          ref={canvasRef}
          className="ink-canvas sheet-overlay-canvas"
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
          {...bind}
        />
      </div>

      <div className="canvas-toolbar">
        <span>
          {tool === 'eraser'
            ? 'Erase handwriting or rendered placements directly on the sheet'
            : !adapter.isReady()
              ? 'Model is still preparing. You can draw now and interpret once it is ready.'
            : hasInk
              ? isDrawing
                ? 'Writing...'
                : `Replacing handwriting in ${Math.max(
                    0,
                    Math.ceil((timeLeft ?? 0) / 100),
                  ) / 10}s`
              : `Using ${adapter.label} to replace handwriting in place`}
        </span>
        <div className="canvas-actions">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!hasInk || tool === 'eraser' || !adapter.isReady()}
          >
            Interpret selection
          </button>
          <button type="button" onClick={clear} disabled={!hasInk}>
            Clear ink
          </button>
        </div>
      </div>
    </div>
  );
}
