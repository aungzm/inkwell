import { useEffect, useState } from 'react';
import { validateVlmResult } from './solver/validate';
import type { RasterizedRow } from './types';
import { SheetSurface } from './ui/SheetSurface';
import { LocalMathOnnxAdapter } from './vlm/localMath';
import type { VlmStatus } from './vlm/adapter';

const adapter = new LocalMathOnnxAdapter();
const COLOR_OPTIONS = ['#14253d', '#2f80ed', '#1f9d55', '#d97706', '#c2410c', '#be185d'];

export default function App() {
  const [tool, setTool] = useState<'pencil' | 'eraser'>('pencil');
  const [strokeSize, setStrokeSize] = useState(14);
  const [strokeColor, setStrokeColor] = useState(COLOR_OPTIONS[0]);
  const [modelStatus, setModelStatus] = useState<VlmStatus>({
    stage: 'idle',
    message: 'Preparing model runtime...',
  });

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
    };
  }, []);

  const handleInterpret = async (image: RasterizedRow) =>
    validateVlmResult(await adapter.transcribe(image));

  return (
    <main className="app-shell">
      <section className="paper-stage">
        <div className="paper-sheet feed-paper">
          <header className="workspace-header">
            <div className="workspace-title">
              <div className="brand-mark">
                <span className="brand-dot" />
                <p className="eyebrow">Slate Workspace</p>
              </div>
              <h1>Live sheet</h1>
            </div>
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
                  Pencil
                </button>
                <button
                  type="button"
                  className={tool === 'eraser' ? 'segment-button is-active' : 'segment-button'}
                  onClick={() => setTool('eraser')}
                >
                  Eraser
                </button>
              </div>
            </div>

            <div className="tool-group" aria-label="Stroke thickness">
              <label className="tool-group-label" htmlFor="stroke-size">
                {tool === 'eraser' ? 'Eraser size' : 'Thickness'}
              </label>
              <div className="slider-control">
                <input
                  id="stroke-size"
                  type="range"
                  min="6"
                  max="32"
                  step="1"
                  value={strokeSize}
                  onChange={(event) => setStrokeSize(Number(event.target.value))}
                />
                <span className="slider-value">{strokeSize}px</span>
              </div>
            </div>

            <div className="tool-group" aria-label="Stroke color">
              <span className="tool-group-label">Color</span>
              <div className="color-swatch-row">
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={
                      color === strokeColor ? 'color-swatch is-active' : 'color-swatch'
                    }
                    style={{ backgroundColor: color }}
                    onClick={() => setStrokeColor(color)}
                    aria-label={`Choose ${color} ink`}
                    aria-pressed={color === strokeColor}
                    disabled={tool === 'eraser'}
                  />
                ))}
              </div>
            </div>

            <div className="tool-group tool-group-model" aria-label="Active model">
              <span className="tool-group-label">Model</span>
              <div className="model-select" aria-live="polite">
                {adapter.label}
              </div>
            </div>
          </div>

          <div className={`model-status-banner status-${modelStatus.stage}`}>
            <div>
              <p className="model-status-title">Model status</p>
              <p className="model-status-copy">{modelStatus.message}</p>
            </div>
            {modelStatus.stage === 'loading' && typeof modelStatus.progress === 'number' && (
              <div className="model-progress">
                <div
                  className="model-progress-bar"
                  style={{ width: `${Math.max(4, Math.min(100, modelStatus.progress * 100))}%` }}
                />
              </div>
            )}
          </div>

          <div className="paper-line live-paper-line">
            <SheetSurface
              adapter={adapter}
              onValidateResult={handleInterpret}
              tool={tool}
              strokeColor={strokeColor}
              strokeSize={strokeSize}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
