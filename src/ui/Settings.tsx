type SettingsProps = {
  modelLabel: string;
  prompt: string;
};

export function Settings({ modelLabel, prompt }: SettingsProps) {
  return (
    <section className="panel-card">
      <p className="eyebrow">Recognition</p>
      <h2 className="panel-title">Interpreter</h2>
      <div className="settings-chip-row">
        <span className="settings-chip settings-chip-active">{modelLabel}</span>
        <span className="settings-chip">Structured JSON</span>
      </div>
      <p className="caption-copy">{prompt}</p>
    </section>
  );
}
