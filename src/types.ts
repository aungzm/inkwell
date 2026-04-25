export type InkPoint = {
  x: number;
  y: number;
  pressure: number;
};

export type Stroke = {
  id: string;
  points: InkPoint[];
  color: string;
  size: number;
  startedAt: number;
  endedAt: number;
};

export type RasterizedRow = {
  imageData: ImageData;
  dataUrl: string;
  width: number;
  height: number;
  strokes: Stroke[];
};

export type Intent =
  | { kind: 'evaluate' }
  | { kind: 'simplify' }
  | { kind: 'solve'; for?: string }
  | { kind: 'derivative'; withRespectTo: string }
  | {
      kind: 'integral';
      withRespectTo: string;
      definite?: { from: string; to: string };
    };

export type VLMResult = {
  latex: string;
  intent?: Intent;
  confidence?: number;
  raw: string;
};

export type SolverResult = {
  kind: 'exact' | 'approximate' | 'unsupported';
  latex: string;
  plainText: string;
};

export type RowState = 'active' | 'processing' | 'parsed' | 'errored' | 'editing';

export type Row = {
  id: string;
  state: RowState;
  strokes: Stroke[];
  image?: RasterizedRow;
  vlmResult?: VLMResult;
  solverResult?: SolverResult;
  error?: string;
  editedLatex?: string;
  createdAt: number;
  updatedAt: number;
};

export type Settings = {
  activeModelId: string;
  autoSubmitMs: number;
};

export type AppState = {
  sessionId: string;
  rows: Row[];
  settings: Settings;
};
