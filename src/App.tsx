export default function App() {
  return (
    <main className="app-shell">
      <aside className="sidebar-card">
        <p className="eyebrow">Slate</p>
        <h1>Handwritten math, one row at a time.</h1>
        <p className="body-copy">
          The app shell is in place. Next up is the canvas row, pause
          detection, and the feed workflow.
        </p>
      </aside>

      <section className="paper-stage">
        <div className="paper-sheet">
          <div className="paper-line">
            <span className="paper-label">Row 01</span>
            <div className="latex-preview">\\int x^2 \\, dx</div>
          </div>
        </div>
      </section>
    </main>
  );
}
