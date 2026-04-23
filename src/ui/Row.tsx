import { useEffect, useState } from 'react';
import { RowCanvas } from '../canvas/RowCanvas';
import type { RasterizedRow, Row as RowType } from '../types';
import { MathBlock } from './MathBlock';

type RowProps = {
  row: RowType;
  onSubmit: (rowId: string, image: RasterizedRow) => void;
  onRedraw: (rowId: string) => void;
  onStartEdit: (rowId: string) => void;
  onSaveEdit: (rowId: string, latex: string) => void;
  tool: 'pencil' | 'eraser';
  strokeColor: string;
  strokeSize: number;
};

export function Row({
  row,
  onSubmit,
  onRedraw,
  onStartEdit,
  onSaveEdit,
  tool,
  strokeColor,
  strokeSize,
}: RowProps) {
  const [draftLatex, setDraftLatex] = useState(row.editedLatex ?? row.vlmResult?.latex ?? '');

  useEffect(() => {
    setDraftLatex(row.editedLatex ?? row.vlmResult?.latex ?? '');
  }, [row.editedLatex, row.vlmResult?.latex, row.state]);

  return (
    <article className={`sheet-entry row-state-${row.state}`}>
      {row.state === 'active' && (
        <RowCanvas
          tool={tool}
          strokeColor={strokeColor}
          strokeSize={strokeSize}
          onRasterized={(image) => {
            onSubmit(row.id, image);
          }}
        />
      )}

      {row.state === 'processing' && (
        <div className="sheet-processing">
          <p className="sheet-status">Interpreting handwriting...</p>
        </div>
      )}

      {(row.state === 'parsed' || row.state === 'editing') && row.vlmResult && (
        <div className="sheet-rendered-math">
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
        <div className="sheet-error">
          <p className="sheet-status">Couldn&apos;t turn that into math yet.</p>
          <p className="error-copy">{row.error}</p>
          <div className="row-actions">
            <button type="button" onClick={() => onRedraw(row.id)}>
              Try again
            </button>
            {row.vlmResult?.latex && (
              <button type="button" onClick={() => onRedraw(row.id)}>
                Clear
              </button>
            )}
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
    </article>
  );
}
