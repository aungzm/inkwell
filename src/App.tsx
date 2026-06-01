import { useEffect, useMemo, useState } from 'react';
import { evaluateLatex } from './solver/evaluate';
import { validateVlmResult } from './solver/validate';
import { MathBlock } from './ui/MathBlock';
import { SheetSurface } from './ui/SheetSurface';
import type { RasterizedRow, VLMResult } from './types';
import type { VlmStatus } from './vlm/adapter';
import { FastVlmOnnxWebGpuAdapter } from './vlm/fastvlm';
import { Gemma4OnnxWebGpuAdapter } from './vlm/gemma4';
import { Lfm25OnnxWebGpuAdapter } from './vlm/lfm25';
import type { VLMAdapter } from './vlm/adapter';

const ADAPTERS: Record<string, () => VLMAdapter> = {
  'lfm25': () => new Lfm25OnnxWebGpuAdapter(),
  'fastvlm': () => new FastVlmOnnxWebGpuAdapter(),
  'gemma4': () => new Gemma4OnnxWebGpuAdapter(),
};
const ADAPTER_LABELS: Record<string, string> = {
  'lfm25': 'LiquidAI LFM2.5-VL 450M',
  'fastvlm': 'FastVLM 0.5B',
  'gemma4': 'Gemma 4 E2B',
};
const DEFAULT_ADAPTER_KEY = 'lfm25';
const COLOR_OPTIONS = ['#0f2a43', '#1f6feb', '#0e7490', '#7c3aed'];

type RecognitionState = {
  image?: RasterizedRow;
  result?: VLMResult;
  error?: string;
  strokeCount: number;
  recognizedAt: number | null;
};

function getStatusProgress(status: VlmStatus) {
  return status.stage === 'loading' ? status.progress : undefined;
}

export default function App() {
  const [tool, setTool] = useState<'pencil' | 'eraser'>('pencil');
  const [strokeSize, setStrokeSize] = useState(5);
  const [strokeColor, setStrokeColor] = useState(COLOR_OPTIONS[0]);
  const [recognition, setRecognition] = useState<RecognitionState | null>(null);
  const [preview, setPreview] = useState<{
    image: RasterizedRow | null;
    strokeCount: number;
    hasContent: boolean;
  }>({
    image: null,
    strokeCount: 0,
    hasContent: false,
  });
  const [adapterKey, setAdapterKey] = useState<string>(DEFAULT_ADAPTER_KEY);
  const adapter = useMemo(() => ADAPTERS[adapterKey](), [adapterKey]);
  const [modelStatus, setModelStatus] = useState<VlmStatus>({
    stage: 'idle',
    message: `Preparing ${ADAPTER_LABELS[adapterKey]}...`,
  });
  const statusClassName = useMemo(() => {
    if (modelStatus.stage === 'error') {
      return 'status-bar error';
    }

    if (modelStatus.stage === 'loading' || modelStatus.stage === 'checking') {
      return 'status-bar busy';
    }

    if (modelStatus.stage === 'ready') {
      return 'status-bar ready';
    }

    return 'status-bar';
  }, [modelStatus.stage]);

  useEffect(() => {
    setModelStatus({
      stage: 'idle',
      message: `Preparing ${adapter.label}...`,
    });
    adapter.setStatusListener(setModelStatus);

    let cancelled = false;
    const boot = async () => {
      try {
        await adapter.load();
      } catch (error) {
        if (cancelled) {
          return;
        }

        setModelStatus({
          stage: 'error',
          message:
            error instanceof Error ? error.message : 'Failed to initialize the local ONNX model.',
        });
      }
    };

    void boot();

    return () => {
      cancelled = true;
      adapter.setStatusListener(null);
      void adapter.unload();
    };
  }, [adapter]);

  const evaluation = useMemo(
    () => (recognition?.result?.latex ? evaluateLatex(recognition.result.latex) : null),
    [recognition?.result?.latex],
  );

  const handleInterpret = async (image: RasterizedRow) =>
    validateVlmResult(await adapter.transcribe(image));

  return (
    <main className="app-shell">
      <div className="page">
        <header className="app-header">
          <div className="header-meta" />
          <h1>Inkwell</h1>
          <div className="header-meta header-meta-right">LiquidAI · 450M · ONNX</div>
          <p className="tagline">
            A dedicated handwritten-formula recognition workstation tuned for explicit crop,
            preview, and LaTeX inspection.
          </p>
        </header>

        <div className="workspace-toolbar">
          <div className="tool-group" aria-label="Drawing tool">
            <span className="tool-group-label">Tool</span>
            <div className="segmented-control">
              <button
                type="button"
                className={tool === 'pencil' ? 'segment-button is-active' : 'segment-button'}
                onClick={() => setTool('pencil')}
              >
                Ink
              </button>
              <button
                type="button"
                className={tool === 'eraser' ? 'segment-button is-active' : 'segment-button'}
                onClick={() => setTool('eraser')}
              >
                Erase
              </button>
            </div>
          </div>

          <div className="tool-group" aria-label="Stroke thickness">
            <label className="tool-group-label" htmlFor="stroke-size">
              {tool === 'eraser' ? 'Eraser width' : 'Stroke width'}
            </label>
            <div className="slider-control">
              <input
                id="stroke-size"
                type="range"
                min="2"
                max="12"
                step="0.5"
                value={strokeSize}
                onChange={(event) => setStrokeSize(Number(event.target.value))}
              />
              <span className="slider-value">{strokeSize}px</span>
            </div>
          </div>

          <div className="tool-group" aria-label="Stroke color">
            <span className="tool-group-label">Ink tone</span>
            <div className="color-swatch-row">
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={color === strokeColor ? 'color-swatch is-active' : 'color-swatch'}
                  style={{ backgroundColor: color }}
                  onClick={() => setStrokeColor(color)}
                  aria-label={`Choose ${color} ink`}
                  aria-pressed={color === strokeColor}
                  disabled={tool === 'eraser'}
                />
              ))}
            </div>
          </div>

          <div className="tool-group tool-group-model" aria-label="Model">
            <span className="tool-group-label">Model</span>
            <select
              className="model-pill"
              value={adapterKey}
              onChange={(event) => setAdapterKey(event.target.value)}
            >
              {Object.keys(ADAPTERS).map((key) => (
                <option key={key} value={key}>
                  {ADAPTER_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={statusClassName}>
          <span className="dot" />
          <span className="status-message">{modelStatus.message}</span>
          <span className="progress">
            <span
              style={{
                width: `${Math.max(
                  6,
                  Math.min(100, Math.round((getStatusProgress(modelStatus) ?? 0.12) * 100)),
                )}%`,
              }}
            />
          </span>
        </div>

        <div className="workspace">
          <SheetSurface
            adapter={adapter}
            onRecognize={handleInterpret}
            onRecognized={({ image, result, strokeCount, recognizedAt }) => {
              setRecognition({
                image,
                result,
                strokeCount,
                recognizedAt,
              });
            }}
            onPreviewChange={setPreview}
            onRecognitionError={({ image, message, strokeCount }) => {
              setRecognition({
                image: image ?? preview.image ?? undefined,
                error: message,
                strokeCount,
                recognizedAt: Date.now(),
              });
            }}
            onResetOutput={() => setRecognition(null)}
            tool={tool}
            strokeColor={strokeColor}
            strokeSize={strokeSize}
          />

          <div className="result-column">
          <section className="panel">
            <div className="panel-label">Recognize</div>

            <div className={recognition?.result?.latex ? 'render-box' : 'render-box empty'}>
              {recognition?.result?.latex ? (
                <MathBlock latex={recognition.result.latex} />
              ) : recognition?.error ? (
                recognition.error
              ) : (
                'Recognized formula renders here once the model completes.'
              )}
            </div>

            <div className="panel-label">LaTeX Source</div>
            <div
              className={
                recognition?.result?.latex || recognition?.error ? 'latex-box' : 'latex-box empty'
              }
            >
              {recognition?.result?.latex ?? recognition?.error ?? '(no output yet)'}
            </div>

            <div className={preview.image ? 'preview-thumb visible' : 'preview-thumb'}>
              {preview.image ? (
                <img
                  src={preview.image.dataUrl}
                  alt="Detected formula crop preview"
                  className="preview-image"
                />
              ) : (
                <div className="preview-image preview-image-empty" />
              )}
              <div className="label">
                Detection crop
                <br />
                {preview.image
                  ? `${preview.image.width} × ${preview.image.height}`
                  : 'Awaiting content'}
                <br />
                {preview.strokeCount} stroke{preview.strokeCount === 1 ? '' : 's'}
              </div>
            </div>

            <div className="meta">
              <span>
                {recognition?.result?.raw
                  ? `Raw ${recognition.result.raw.length} chars`
                  : recognition?.error
                    ? 'Recognition failed'
                    : 'Model idle'}
              </span>
              <span>
                {recognition?.recognizedAt
                  ? new Intl.DateTimeFormat(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                      second: '2-digit',
                    }).format(recognition.recognizedAt)
                  : '—'}
              </span>
            </div>
          </section>

          <section className="panel">
            <div className="panel-label">Calculation</div>
            <div className={evaluation ? 'calc-box' : 'calc-box empty'}>
              {evaluation ? (
                <div className="calc-result">
                  {evaluation.variable ? (
                    <span className="calc-var">{evaluation.variable}</span>
                  ) : null}
                  <span className="calc-sign">{evaluation.approximate ? '≈' : '='}</span>
                  <span className="calc-number">{evaluation.display}</span>
                </div>
              ) : (
                'A numeric result appears here when the formula can be evaluated.'
              )}
            </div>
          </section>
          </div>
        </div>
      </div>
    </main>
  );
}
