import { useReducer } from 'react';
import { solveMath } from './solver/solve';
import { validateVlmResult } from './solver/validate';
import { appReducer, initialAppState } from './state/reducer';
import type { RasterizedRow, VLMResult } from './types';
import { Feed } from './ui/Feed';
import { Settings } from './ui/Settings';
import { Sidebar } from './ui/Sidebar';
import { DemoLfm25Adapter } from './vlm/lfm25';
import { TRANSCRIPTION_PROMPT } from './vlm/prompt';

const demoAdapter = new DemoLfm25Adapter();

export default function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);

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

  return (
    <main className="app-shell">
      <aside className="sidebar-stack">
        <section className="sidebar-card">
          <p className="eyebrow">Slate</p>
          <h1>Handwritten math, one row at a time.</h1>
          <p className="body-copy">
            The feed now runs through a reducer-backed row lifecycle with a
            local demo recognizer, validation, and deterministic solver output.
          </p>
          <div className="status-card">
            <span className="status-label">Latest solved row</span>
            <strong>
              {latestParsedRow?.solverResult?.plainText ?? 'Waiting for the first parsed row'}
            </strong>
          </div>
        </section>

        <Sidebar rows={state.rows} />
        <Settings modelLabel={demoAdapter.label} prompt={TRANSCRIPTION_PROMPT} />
      </aside>

      <section className="paper-stage">
        <div className="paper-sheet feed-paper">
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
