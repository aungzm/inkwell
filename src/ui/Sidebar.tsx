import type { Row } from '../types';

type SidebarProps = {
  rows: Row[];
};

export function Sidebar({ rows }: SidebarProps) {
  const parsedRows = rows.filter((row) => row.state === 'parsed');
  const erroredRows = rows.filter((row) => row.state === 'errored');

  return (
    <section className="panel-card">
      <p className="eyebrow">Session</p>
      <h2 className="panel-title">Feed snapshot</h2>
      <div className="summary-metric">
        <strong>{parsedRows.length}</strong>
        <span>parsed rows</span>
      </div>
      <div className="summary-metric">
        <strong>{erroredRows.length}</strong>
        <span>rows needing attention</span>
      </div>
      <p className="caption-copy">
        IndexedDB history is still to come, but the reducer-backed feed is now
        working end to end.
      </p>
    </section>
  );
}
