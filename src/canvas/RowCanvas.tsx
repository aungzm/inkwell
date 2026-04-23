import { useEffect, useRef, useState } from 'react';
import { usePauseDetector } from './pauseDetector';
import { rasterizeStrokes } from './rasterize';
import { useStrokes } from './useStrokes';
import type { RasterizedRow } from '../types';

type RowCanvasProps = {
  onRasterized?: (rasterized: RasterizedRow) => void;
};

export function RowCanvas({ onRasterized }: RowCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [lastInteractionAt, setLastInteractionAt] = useState<number | null>(null);
  const [preview, setPreview] = useState<RasterizedRow | null>(null);
  const { strokes, isDrawing, clear, bind } = useStrokes({ canvasRef });

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

    setPreview(rasterized);
    onRasterized?.(rasterized);
  };

  const timeLeft = usePauseDetector({
    enabled: hasInk,
    isDrawing,
    isHovering,
    lastInteractionAt,
    onPause: submit,
  });

  return (
    <div className="row-canvas-card">
      <div className="row-canvas-copy">
        <div>
          <p className="eyebrow">Canvas phase</p>
          <h2>Draw a row and pause to capture it.</h2>
        </div>
        <p className="body-copy">
          This stage focuses on the handwritten input feel. The cropped image
          preview below is what the recognition layer will eventually receive.
        </p>
      </div>

      <div className="row-canvas-grid">
        <div className="canvas-panel">
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
                  ? 'Drawing...'
                  : `Auto-capture in ${Math.max(
                      0,
                      Math.ceil((timeLeft ?? 0) / 100),
                    ) / 10}s`
                : 'Start writing to begin'}
            </span>
            <button type="button" onClick={submit} disabled={!hasInk}>
              Capture now
            </button>
            <button type="button" onClick={clear} disabled={!hasInk}>
              Clear
            </button>
          </div>
        </div>

        <div className="debug-panel">
          <p className="debug-title">Raster preview</p>
          {preview ? (
            <>
              <img
                src={preview.dataUrl}
                alt="Rasterized handwritten math row"
                className="debug-image"
              />
              <p className="debug-meta">
                {preview.width} x {preview.height}px crop
              </p>
            </>
          ) : (
            <p className="debug-empty">
              Pause after drawing and the cropped image will appear here.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
