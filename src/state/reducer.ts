import type { AppState, RasterizedRow, Row, VLMResult, SolverResult } from '../types';

type AppAction =
  | { type: 'row/submitted'; rowId: string; image: RasterizedRow }
  | { type: 'row/parsed'; rowId: string; vlmResult: VLMResult; solverResult: SolverResult }
  | { type: 'row/errored'; rowId: string; error: string; vlmResult?: VLMResult }
  | { type: 'row/redraw'; rowId: string }
  | { type: 'row/start-edit'; rowId: string }
  | { type: 'row/save-edit'; rowId: string; latex: string; solverResult: SolverResult }
  | { type: 'settings/set-model'; modelId: string };

const createActiveRow = (): Row => {
  const now = Date.now();
  return {
    id: `row-${now}-${Math.random().toString(36).slice(2, 7)}`,
    state: 'active',
    strokes: [],
    createdAt: now,
    updatedAt: now,
  };
};

export const initialAppState: AppState = {
  sessionId: `session-${Date.now()}`,
  rows: [createActiveRow()],
  settings: {
    activeModelId: 'lfm25-demo',
    autoSubmitMs: 1200,
  },
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'row/submitted':
      return {
        ...state,
        rows: state.rows.map((row) =>
          row.id === action.rowId
            ? {
                ...row,
                image: action.image,
                state: 'processing',
                updatedAt: Date.now(),
              }
            : row,
        ),
      };
    case 'row/parsed': {
      const rows = state.rows.map((row) =>
        row.id === action.rowId
          ? {
              ...row,
              state: 'parsed' as const,
              vlmResult: action.vlmResult,
              solverResult: action.solverResult,
              error: undefined,
              updatedAt: Date.now(),
            }
          : row,
      );

      const hasActiveRow = rows.some((row) => row.state === 'active');
      return {
        ...state,
        rows: hasActiveRow ? rows : [...rows, createActiveRow()],
      };
    }
    case 'row/errored':
      return {
        ...state,
        rows: state.rows.map((row) =>
          row.id === action.rowId
            ? {
                ...row,
                state: 'errored' as const,
                vlmResult: action.vlmResult ?? row.vlmResult,
                error: action.error,
                updatedAt: Date.now(),
              }
            : row,
        ),
      };
    case 'row/redraw':
      return {
        ...state,
        rows: state.rows.map((row) =>
          row.id === action.rowId
            ? {
                ...row,
                image: undefined,
                vlmResult: undefined,
                solverResult: undefined,
                error: undefined,
                editedLatex: undefined,
                state: 'active' as const,
                updatedAt: Date.now(),
              }
            : row,
        ),
      };
    case 'row/start-edit':
      return {
        ...state,
        rows: state.rows.map((row) =>
          row.id === action.rowId
            ? {
                ...row,
                state: 'editing' as const,
                editedLatex: row.vlmResult?.latex ?? row.editedLatex ?? '',
                updatedAt: Date.now(),
              }
            : row,
        ),
      };
    case 'row/save-edit':
      return {
        ...state,
        rows: state.rows.map((row) =>
          row.id === action.rowId
            ? {
                ...row,
                state: 'parsed' as const,
                editedLatex: action.latex,
                vlmResult: row.vlmResult
                  ? { ...row.vlmResult, latex: action.latex }
                  : {
                      latex: action.latex,
                      raw: action.latex,
                    },
                solverResult: action.solverResult,
                error: undefined,
                updatedAt: Date.now(),
              }
            : row,
        ),
      };
    case 'settings/set-model':
      return {
        ...state,
        settings: {
          ...state.settings,
          activeModelId: action.modelId,
        },
      };
    default:
      return state;
  }
}
