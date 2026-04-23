type SettingsProps = {
  modelLabel: string;
  prompt: string;
};

export function Settings({ modelLabel, prompt }: SettingsProps) {
  return (
    <section className="panel-card">
      <p className="eyebrow">Settings</p>
      <h2 className="panel-title">Local model routing</h2>
      <p className="body-copy">
        Current adapter: <strong>{modelLabel}</strong>
      </p>
      <p className="caption-copy">{prompt}</p>
    </section>
  );
}
