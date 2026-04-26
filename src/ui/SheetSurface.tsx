import { useEffect, useMemo, useRef, useState } from 'react';
import type { VLMAdapter } from '../vlm/adapter';
import type { RasterizedRow, VLMResult } from '../types';
import { rasterizeStrokes } from '../canvas/rasterize';
import { useStrokes } from '../canvas/useStrokes';

type SheetSurfaceProps = {
  adapter: VLMAdapter;
  tool: 'pencil' | 'eraser';
  strokeColor: string;
  strokeSize: number;
  onRecognize: (image: RasterizedRow) => Promise<VLMResult>;
  onRecognized: (payload: {
    image: RasterizedRow;
    result: VLMResult;
    strokeCount: number;
    recognizedAt: number;
  }) => void;
  onPreviewChange: (payload: {
    image: RasterizedRow | null;
    strokeCount: number;
    hasInk: boolean;
  }) => void;
  onRecognitionError: (payload: {
    image: RasterizedRow | null;
    message: string;
    strokeCount: number;
  }) => void;
  onResetOutput: () => void;
};

function formatTime(timestamp: number | null) {
  if (!timestamp) {
    return 'No recognition yet';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

export function SheetSurface({
  adapter,
  tool,
  strokeColor,
  strokeSize,
  onRecognize,
  onRecognized,
  onPreviewChange,
  onRecognitionError,
  onResetOutput,
}: SheetSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [lastRecognizedAt, setLastRecognizedAt] = useState<number | null>(null);
  const { strokes, isDrawing, clear, undo, bind } = useStrokes({
    canvasRef,
    tool,
    strokeColor,
    strokeSize,
  });

  const hasInk = strokes.length > 0;
  const helperCopy = useMemo(() => {
    if (tool === 'eraser') {
      return hasInk ? 'Erase marks directly from the formula region.' : 'Switch back to ink to write a formula.';
    }

    if (isRecognizing) {
      return 'Recognition in progress...';
    }

    if (!adapter.isReady()) {
      return 'Model is preparing. You can still sketch while it loads.';
    }

    if (isDrawing) {
      return 'Inscribing formula...';
    }

    return hasInk
      ? 'Formula region detected. Recognize when the crop looks right.'
      : 'Write a formula inside the frame, then recognize it.';
  }, [adapter, hasInk, isDrawing, isRecognizing, tool]);

  useEffect(() => {
    if (!hasInk) {
      onPreviewChange({
        image: null,
        strokeCount: 0,
        hasInk: false,
      });
      return;
    }

    const rasterized = rasterizeStrokes(strokes, 1);
    onPreviewChange({
      image: rasterized,
      strokeCount: strokes.length,
      hasInk: true,
    });
  }, [hasInk, onPreviewChange, strokes]);

  const handleClear = () => {
    clear();
    onResetOutput();
  };

  const handleUndo = () => {
    undo();
    onResetOutput();
  };

  const handleRecognize = async () => {
    if (!hasInk || isRecognizing) {
      return;
    }

    const rasterized = rasterizeStrokes(strokes);
    if (!rasterized) {
      onRecognitionError({
        image: null,
        message: 'Unable to prepare a crop from the current strokes.',
        strokeCount: strokes.length,
      });
      return;
    }

    setIsRecognizing(true);
    try {
      const result = await onRecognize(rasterized);
      const recognizedAt = Date.now();
      setLastRecognizedAt(recognizedAt);
      onRecognized({
        image: rasterized,
        result,
        strokeCount: strokes.length,
        recognizedAt,
      });
    } catch (error) {
      onRecognitionError({
        image: rasterized,
        message:
          error instanceof Error ? error.message : 'Unable to recognize this formula yet.',
        strokeCount: strokes.length,
      });
    } finally {
      setIsRecognizing(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-label">I. Inscribe</div>

      <div className="canvas-wrap">
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
        <span className="baseline" />
        <canvas
          ref={canvasRef}
          className="ink-canvas formula-canvas"
          {...bind}
        />
      </div>

      <div className="controls">
        <button
          type="button"
          className="primary"
          onClick={handleRecognize}
          disabled={!hasInk || isRecognizing || !adapter.isReady()}
        >
          Recognize
        </button>
        <button type="button" onClick={handleClear} disabled={!hasInk || isRecognizing}>
          Clear
        </button>
        <button type="button" onClick={handleUndo} disabled={!hasInk || isRecognizing}>
          Undo
        </button>
      </div>

      <div className="recognition-helper">
        <p>{helperCopy}</p>
      </div>

      <div className="meta">
        <span>{strokes.length} stroke{strokes.length === 1 ? '' : 's'}</span>
        <span>{formatTime(lastRecognizedAt)}</span>
      </div>
    </section>
  );
}
