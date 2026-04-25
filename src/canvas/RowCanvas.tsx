import { useEffect, useRef, useState } from 'react';
import { usePauseDetector } from './pauseDetector';
import { rasterizeStrokes } from './rasterize';
import { useStrokes } from './useStrokes';
import type { RasterizedRow } from '../types';

type RowCanvasProps = {
  onRasterized?: (rasterized: RasterizedRow) => void;
  tool: 'pencil' | 'eraser';
  strokeColor: string;
  strokeSize: number;
};

export function RowCanvas({
  onRasterized,
  tool,
  strokeColor,
  strokeSize,
}: RowCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [lastInteractionAt, setLastInteractionAt] = useState<number | null>(null);
  const { strokes, isDrawing, clear, bind } = useStrokes({
    canvasRef,
    tool,
    strokeColor,
    strokeSize,
  });

  useEffect(() => {
    if (strokes.length === 0) {
      return;
    }

    setLastInteractionAt(Date.now());
  }, [strokes]);

  const hasInk = strokes.length > 0;

  const submit = () => {
    if (!hasInk) {
      return;
    }

    const rasterized = rasterizeStrokes(strokes);
    if (!rasterized) {
      return;
    }

    onRasterized?.(rasterized);
  };

  const timeLeft = usePauseDetector({
    enabled: hasInk,
    isDrawing,
    lastInteractionAt,
    thresholdMs: 500,
    onPause: submit,
  });

  return (
    <div className="sheet-canvas-shell">
      <canvas
        ref={canvasRef}
        className="ink-canvas"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        {...bind}
      />

      <div className="canvas-toolbar">
        <span>
          {hasInk
            ? isDrawing
              ? tool === 'eraser'
                ? 'Erasing...'
                : 'Writing...'
              : `Replace with math in ${Math.max(0, Math.ceil((timeLeft ?? 0) / 100)) / 10}s`
            : tool === 'eraser'
              ? 'Erase from the current writing area'
              : 'Write anywhere on the sheet'}
        </span>
        <div className="canvas-actions">
          <button type="button" onClick={submit} disabled={!hasInk}>
            Render math
          </button>
          <button type="button" onClick={clear} disabled={!hasInk}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
