import { useState } from 'react';
import { RowCanvas } from './canvas/RowCanvas';
import type { RasterizedRow } from './types';

export default function App() {
  const [latestCapture, setLatestCapture] = useState<RasterizedRow | null>(null);

  return (
    <main className="app-shell">
      <aside className="sidebar-card">
        <p className="eyebrow">Slate</p>
        <h1>Handwritten math, one row at a time.</h1>
        <p className="body-copy">
          The app shell now includes a live drawing row, pause detection, and
          cropped raster output for the future recognition step.
        </p>
        <div className="status-card">
          <span className="status-label">Latest crop</span>
          <strong>{latestCapture ? 'Ready for recognition' : 'Waiting for ink'}</strong>
        </div>
      </aside>

      <section className="paper-stage">
        <div className="paper-sheet">
          <div className="paper-line live-paper-line">
            <span className="paper-label">Active row</span>
            <RowCanvas onRasterized={setLatestCapture} />
          </div>
        </div>
      </section>
    </main>
  );
}
