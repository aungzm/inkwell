import type { RasterizedRow, Row as RowType } from '../types';
import { Row } from './Row';

type FeedProps = {
  rows: RowType[];
  onSubmit: (rowId: string, image: RasterizedRow) => void;
  onRedraw: (rowId: string) => void;
  onStartEdit: (rowId: string) => void;
  onSaveEdit: (rowId: string, latex: string) => void;
};

export function Feed({
  rows,
  onSubmit,
  onRedraw,
  onStartEdit,
  onSaveEdit,
}: FeedProps) {
  return (
    <div className="feed-list">
      {rows.map((row) => (
        <Row
          key={row.id}
          row={row}
          onSubmit={onSubmit}
          onRedraw={onRedraw}
          onStartEdit={onStartEdit}
          onSaveEdit={onSaveEdit}
        />
      ))}
    </div>
  );
}
