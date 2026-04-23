import { useEffect, useState } from 'react';
import { RowCanvas } from '../canvas/RowCanvas';
import type { RasterizedRow, Row as RowType } from '../types';
import { MathBlock } from './MathBlock';

type RowProps = {
  row: RowType;
  index: number;
  onSubmit: (rowId: string, image: RasterizedRow) => void;
  onRedraw: (rowId: string) => void;
  onStartEdit: (rowId: string) => void;
  onSaveEdit: (rowId: string, latex: string) => void;
};

export function Row({
  row,
  index,
  onSubmit,
  onRedraw,
  onStartEdit,
  onSaveEdit,
}: RowProps) {
  const [draftLatex, setDraftLatex] = useState(row.editedLatex ?? row.vlmResult?.latex ?? '');

  useEffect(() => {
    setDraftLatex(row.editedLatex ?? row.vlmResult?.latex ?? '');
  }, [row.editedLatex, row.vlmResult?.latex, row.state]);

  return (
    <article className={`feed-row row-state-${row.state}`}>
      <div className="row-index">Row {String(index + 1).padStart(2, '0')}</div>
      <div className="row-main">
        {row.state === 'active' && (
          <RowCanvas
            onRasterized={(image) => {
              onSubmit(row.id, image);
            }}
          />
        )}

        {row.state === 'processing' && (
          <div className="processing-panel">
            <p className="result-label">Processing</p>
            <p className="debug-empty">
              The demo recognizer is transcribing this row and sending the
              result into the deterministic solver.
            </p>
          </div>
        )}

        {(row.state === 'parsed' || row.state === 'editing') && row.vlmResult && (
          <div className="row-result-shell">
            <div className="result-column">
              <p className="result-label">Recognized LaTeX</p>
              {row.state === 'editing' ? (
                <div className="edit-panel">
                  <textarea
                    value={draftLatex}
                    onChange={(event) => setDraftLatex(event.target.value)}
                    rows={3}
                  />
                  <div className="inline-actions">
                    <button type="button" onClick={() => onSaveEdit(row.id, draftLatex)}>
                      Save LaTeX
                    </button>
                  </div>
                </div>
              ) : (
                <MathBlock latex={row.vlmResult.latex} />
              )}
            </div>
            <div className="result-column result-column-accent">
              <p className="result-label">Solver output</p>
              {row.solverResult ? (
                <MathBlock latex={row.solverResult.latex} />
              ) : (
                <p className="debug-empty">No solver output yet.</p>
              )}
            </div>
            <div className="row-actions">
              <button type="button" onClick={() => onRedraw(row.id)}>
                Redraw
              </button>
              <button type="button" onClick={() => onStartEdit(row.id)}>
                Edit LaTeX
              </button>
            </div>
          </div>
        )}

        {row.state === 'errored' && (
          <div className="error-panel">
            <p className="result-label">Recognizer output</p>
            <code>{row.vlmResult?.raw ?? 'No model output captured.'}</code>
            <p className="error-copy">{row.error}</p>
            <div className="row-actions">
              <button type="button" onClick={() => onRedraw(row.id)}>
                Redraw
              </button>
              {row.vlmResult?.latex && (
                <button
                  type="button"
                  onClick={() => {
                    onStartEdit(row.id);
                  }}
                >
                  Edit LaTeX
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
