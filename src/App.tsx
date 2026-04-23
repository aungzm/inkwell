import { useReducer, useState } from 'react';
import { solveMath } from './solver/solve';
import { validateVlmResult } from './solver/validate';
import { appReducer, initialAppState } from './state/reducer';
import type { RasterizedRow, VLMResult } from './types';
import { Feed } from './ui/Feed';
import { DemoLfm25Adapter } from './vlm/lfm25';
import { TRANSCRIPTION_PROMPT } from './vlm/prompt';

const demoAdapter = new DemoLfm25Adapter();

export default function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [isToolbarOpen, setIsToolbarOpen] = useState(true);

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

  const latestParsedRow = [...state.rows]
    .reverse()
    .find((row) => row.state === 'parsed' && row.solverResult);
  const parsedCount = state.rows.filter((row) => row.state === 'parsed').length;
  const erroredCount = state.rows.filter((row) => row.state === 'errored').length;

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
            <button
              type="button"
              className="toolbar-toggle"
              onClick={() => setIsToolbarOpen((current) => !current)}
              aria-expanded={isToolbarOpen}
            >
              {isToolbarOpen ? 'Hide options' : 'Show options'}
            </button>
          </header>
          {isToolbarOpen && (
            <div className="workspace-toolbar">
              <div className="workspace-tools" aria-label="Workspace tools">
                <span className="tool-pill tool-pill-active">Pen</span>
                <span className="tool-pill">Auto solve</span>
                <span className="tool-pill">Local model</span>
              </div>
              <div className="workspace-stats" aria-label="Workspace status">
                <span className="tool-pill">
                  Parsed {parsedCount}
                </span>
                <span className="tool-pill">
                  Review {erroredCount}
                </span>
                <span className="tool-pill tool-pill-wide">
                  {latestParsedRow?.solverResult?.plainText ?? 'Waiting for the first solved row'}
                </span>
              </div>
              <p className="toolbar-caption">{demoAdapter.label} · {TRANSCRIPTION_PROMPT}</p>
            </div>
          )}
          <div className="paper-line live-paper-line">
            <span className="paper-label">Session feed</span>
            <Feed
              rows={state.rows}
              onSubmit={handleSubmit}
              onRedraw={(rowId) => dispatch({ type: 'row/redraw', rowId })}
              onStartEdit={(rowId) => dispatch({ type: 'row/start-edit', rowId })}
              onSaveEdit={handleSaveEdit}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
