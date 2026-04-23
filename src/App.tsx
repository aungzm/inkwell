import { useReducer, useState } from 'react';
import { solveMath } from './solver/solve';
import { validateVlmResult } from './solver/validate';
import { appReducer, initialAppState } from './state/reducer';
import type { RasterizedRow, VLMResult } from './types';
import { Feed } from './ui/Feed';
import { DemoLfm25Adapter } from './vlm/lfm25';

const demoAdapter = new DemoLfm25Adapter();
const MODEL_OPTIONS = [
  { id: 'lfm25-demo', label: 'LFM2.5 Demo' },
  { id: 'smolvlm-demo', label: 'SmolVLM Demo' },
  { id: 'qwen-demo', label: 'Qwen Demo' },
] as const;
const COLOR_OPTIONS = ['#14253d', '#2f80ed', '#1f9d55', '#d97706', '#c2410c', '#be185d'];

export default function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [tool, setTool] = useState<'pencil' | 'eraser'>('pencil');
  const [strokeSize, setStrokeSize] = useState(14);
  const [strokeColor, setStrokeColor] = useState(COLOR_OPTIONS[0]);

  const handleSubmit = async (rowId: string, image: RasterizedRow) => {
    dispatch({ type: 'row/submitted', rowId, image });
    let recognized: VLMResult | undefined;

    try {
      recognized = validateVlmResult(await demoAdapter.transcribe(image));
      const solverResult = solveMath(recognized.latex, recognized.intent);
      dispatch({
        type: 'row/parsed',
        rowId,
        vlmResult: recognized,
        solverResult,
      });
    } catch (error) {
      dispatch({
        type: 'row/errored',
        rowId,
        vlmResult: recognized,
        error:
          error instanceof Error
            ? error.message
            : 'An unknown error occurred during row processing.',
      });
    }
  };

  const handleSaveEdit = (rowId: string, latex: string) => {
    const row = state.rows.find((entry) => entry.id === rowId);
    try {
      const solverResult = solveMath(latex, row?.vlmResult?.intent);
      dispatch({ type: 'row/save-edit', rowId, latex, solverResult });
    } catch (error) {
      dispatch({
        type: 'row/errored',
        rowId,
        vlmResult: row?.vlmResult,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to solve the edited LaTeX.',
      });
    }
  };

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

            <div className="tool-group tool-group-model" aria-label="Model selection">
              <label className="tool-group-label" htmlFor="model-select">
                Model
              </label>
              <select
                id="model-select"
                className="model-select"
                value={state.settings.activeModelId}
                onChange={(event) =>
                  dispatch({ type: 'settings/set-model', modelId: event.target.value })
                }
              >
                {MODEL_OPTIONS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="paper-line live-paper-line">
            <Feed
              rows={state.rows}
              onSubmit={handleSubmit}
              onRedraw={(rowId) => dispatch({ type: 'row/redraw', rowId })}
              onStartEdit={(rowId) => dispatch({ type: 'row/start-edit', rowId })}
              onSaveEdit={handleSaveEdit}
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
