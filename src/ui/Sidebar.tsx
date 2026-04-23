import type { Row } from '../types';

type SidebarProps = {
  rows: Row[];
};

export function Sidebar({ rows }: SidebarProps) {
  const parsedRows = rows.filter((row) => row.state === 'parsed');
  const erroredRows = rows.filter((row) => row.state === 'errored');
  const activeRows = rows.filter((row) => row.state === 'active');

  return (
    <section className="panel-card">
      <p className="eyebrow">Session</p>
      <h2 className="panel-title">Workspace status</h2>
      <div className="summary-metric">
        <strong>{activeRows.length}</strong>
        <span>active rows</span>
      </div>
      <div className="summary-metric">
        <strong>{parsedRows.length}</strong>
        <span>parsed rows</span>
      </div>
      <div className="summary-metric">
        <strong>{erroredRows.length}</strong>
        <span>need review</span>
      </div>
      <p className="caption-copy">
        The current flow is row-based and live. History and saved sessions can
        layer on top of this later.
      </p>
    </section>
  );
}
