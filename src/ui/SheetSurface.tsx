import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { VLMAdapter } from '../vlm/adapter';
import type { RasterizedRow, VLMResult } from '../types';
import { rasterizeCanvasRegion, rasterizeStrokes } from '../canvas/rasterize';
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
    hasContent: boolean;
  }) => void;
  onRecognitionError: (payload: {
    image: RasterizedRow | null;
    message: string;
    strokeCount: number;
  }) => void;
  onResetOutput: () => void;
};

type UploadedSheetImage = {
  dataUrl: string;
  element: HTMLImageElement;
  name: string;
  width: number;
  height: number;
};

function getContainedRect(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number,
) {
  const scale = Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

function loadImageFile(file: File) {
  return new Promise<UploadedSheetImage>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('Unable to read the selected image.'));
    };

    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null;
      if (!dataUrl) {
        reject(new Error('The selected file could not be decoded as an image.'));
        return;
      }

      const image = new Image();
      image.onload = () => {
        resolve({
          dataUrl,
          element: image,
          name: file.name,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      };
      image.onerror = () => {
        reject(new Error('The selected file is not a supported image.'));
      };
      image.src = dataUrl;
    };

    reader.readAsDataURL(file);
  });
}

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
  const backgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [lastRecognizedAt, setLastRecognizedAt] = useState<number | null>(null);
  const [uploadedImage, setUploadedImage] = useState<UploadedSheetImage | null>(null);
  const { strokes, isDrawing, clear, undo, bind } = useStrokes({
    canvasRef,
    tool,
    strokeColor,
    strokeSize,
  });

  const hasInk = strokes.length > 0;
  const hasContent = hasInk || Boolean(uploadedImage);
  const helperCopy = useMemo(() => {
    if (tool === 'eraser') {
      if (hasInk) {
        return 'Erase annotations directly from the formula region.';
      }

      if (uploadedImage) {
        return 'Eraser only removes drawn annotations. Upload remains in place until removed.';
      }

      return 'Switch back to ink or upload an image to begin.';
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

    if (uploadedImage && hasInk) {
      return 'Uploaded sheet and annotations are merged for preview and recognition.';
    }

    if (uploadedImage) {
      return 'Uploaded formula is ready. Add annotations if needed, then recognize.';
    }

    return hasInk
      ? 'Formula region detected. Recognize when the crop looks right.'
      : 'Write a formula inside the frame or upload an image to begin.';
  }, [adapter, hasInk, isDrawing, isRecognizing, tool, uploadedImage]);

  useEffect(() => {
    const canvas = backgroundCanvasRef.current;
    if (!canvas) {
      return;
    }

    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
    canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);

    if (!uploadedImage) {
      return;
    }

    const rect = getContainedRect(
      bounds.width,
      bounds.height,
      uploadedImage.width,
      uploadedImage.height,
    );
    context.clearRect(0, 0, bounds.width, bounds.height);
    context.drawImage(uploadedImage.element, rect.x, rect.y, rect.width, rect.height);
  }, [uploadedImage]);

  const buildCompositeRaster = (scale = 2) => {
    const inkCanvas = canvasRef.current;
    const backgroundCanvas = backgroundCanvasRef.current;

    if (!inkCanvas || !backgroundCanvas) {
      return null;
    }

    const bounds = inkCanvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = width;
    compositeCanvas.height = height;
    const context = compositeCanvas.getContext('2d');

    if (!context) {
      return null;
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(backgroundCanvas, 0, 0, width, height);
    context.drawImage(inkCanvas, 0, 0, width, height);

    return rasterizeCanvasRegion(compositeCanvas, scale);
  };

  useEffect(() => {
    if (!hasContent) {
      onPreviewChange({
        image: null,
        strokeCount: 0,
        hasContent: false,
      });
      return;
    }

    const rasterized = uploadedImage ? buildCompositeRaster(1) : rasterizeStrokes(strokes, 1);
    onPreviewChange({
      image: rasterized ?? null,
      strokeCount: strokes.length,
      hasContent: Boolean(rasterized),
    });
  }, [hasContent, onPreviewChange, strokes, uploadedImage]);

  const resetFileSelection = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClear = () => {
    clear();
    setUploadedImage(null);
    resetFileSelection();
    onResetOutput();
  };

  const handleUndo = () => {
    undo();
    onResetOutput();
  };

  const handleRecognize = async () => {
    if (!hasContent || isRecognizing) {
      return;
    }

    const rasterized = uploadedImage ? buildCompositeRaster(2) : rasterizeStrokes(strokes);
    if (!rasterized) {
      onRecognitionError({
        image: null,
        message: uploadedImage
          ? 'Unable to prepare a crop from the uploaded image and annotations.'
          : 'Unable to prepare a crop from the current strokes.',
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

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleUploadChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const nextImage = await loadImageFile(file);
      setUploadedImage(nextImage);
      onResetOutput();
    } catch (error) {
      onRecognitionError({
        image: null,
        message: error instanceof Error ? error.message : 'Unable to load the selected image.',
        strokeCount: strokes.length,
      });
      resetFileSelection();
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
          ref={backgroundCanvasRef}
          className={uploadedImage ? 'ink-canvas formula-canvas background-canvas has-image' : 'ink-canvas formula-canvas background-canvas'}
          aria-hidden="true"
        />
        <canvas
          ref={canvasRef}
          className="ink-canvas formula-canvas"
          {...bind}
        />
        {uploadedImage ? (
          <div className="canvas-badge">
            {uploadedImage.name}
            <br />
            {uploadedImage.width} x {uploadedImage.height}
          </div>
        ) : null}
      </div>

      <div className="controls">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
          className="sr-only"
          onChange={handleUploadChange}
        />
        <button type="button" onClick={handleUploadClick} disabled={isRecognizing}>
          Upload image
        </button>
        <button
          type="button"
          className="primary"
          onClick={handleRecognize}
          disabled={!hasContent || isRecognizing || !adapter.isReady()}
        >
          Recognize
        </button>
        <button type="button" onClick={handleClear} disabled={!hasContent || isRecognizing}>
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
        <span>
          {strokes.length} stroke{strokes.length === 1 ? '' : 's'}
          {uploadedImage ? ' + uploaded sheet' : ''}
        </span>
        <span>{formatTime(lastRecognizedAt)}</span>
      </div>
    </section>
  );
}
