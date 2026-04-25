# Slate — Planning Document

**A frontend-only handwritten math recognition and solving tool.**

Draft v0.1 · Hobby / demo project · Author: Hisham

---

## 1. Elevator pitch

Slate is a browser-native alternative to MyScript for handwritten math. You write on what feels like a continuous sheet of lined paper; when you pause, the row you just wrote is transcribed to LaTeX by a vision-language model running on WebGPU inside your browser, and then evaluated, simplified, or solved by a deterministic math engine. A new blank row appears beneath, and you keep going.

Everything runs client-side. No backend, no API keys, no data leaves the device.

---

## 2. Design principles

Each of these is a lens to resolve ambiguity when implementing:

1. **One discrete line at a time.** The VLM never sees more than a single row of handwriting. This is the load-bearing decision of the whole project — segmentation is the hardest part of math OCR, and the vertical-feed UX sidesteps it entirely.
2. **VLM transcribes. Solver solves.** The model's job is producing clean LaTeX. The solver's job is math. These never blur. Swapping VLMs must never affect correctness of the math.
3. **Fail legibly, not silently.** When the VLM returns nonsense or the solver can't parse, the user sees what went wrong and can edit/retry. No confident wrong answers.
4. **Local-first, no cloud fallback.** WebGPU inference only. This constrains model size but is part of the demo story.
5. **Ship the canvas layer last-mile perfect.** The drawing experience is what the user feels on every interaction. Latency, stroke smoothness, and the "row-complete" transition are the highest-priority polish items.

---

## 3. User experience flow

### The vertical feed

The app opens to what looks like a single sheet of lined paper. The only active element is the top row — a full-width canvas sized to roughly one line of handwriting.

The user draws. As they draw, strokes are rendered in real time with light smoothing.

When they pause (see §5 for the pause heuristic), the row transitions:

1. Strokes are rasterized to a cropped image.
2. The image is sent to the active VLM.
3. The VLM returns LaTeX (or a structured object containing LaTeX plus intent — see §6).
4. The handwriting fades out and is replaced by rendered LaTeX via KaTeX.
5. The solver runs on the parsed expression and produces a result, which appears to the right of the row (or below, on narrow viewports).
6. A new blank canvas row spawns beneath and receives focus.

The user continues. The result is a scrollable vertical list of rendered rows that reads like a worked solution.

### Row states

A row is always in one of these states, and the UI communicates the current state clearly:

- **Active** — user is drawing or has just drawn. Canvas is editable.
- **Processing** — pause detected, image sent to VLM. Subtle loading indicator. Strokes remain visible.
- **Parsed** — LaTeX rendered, solver output shown. Row is now read-only but editable via an "edit" affordance that reverts it to Active.
- **Errored** — VLM failed, parse failed, or solver rejected input. Row shows the raw VLM output and an inline error, with options to retry, edit the LaTeX directly, or dismiss.

### Edit affordances

Every parsed row has:
- A "redraw" button that clears the row and returns it to Active.
- An "edit LaTeX" button that exposes the underlying LaTeX as a text field for manual correction. This is the escape hatch when the VLM consistently misreads something.

### History

Every parsed row is persisted to IndexedDB automatically. A sidebar (collapsible) shows past sessions grouped by date, each session being a contiguous vertical feed. Sessions can be reopened, continued, or deleted. No server sync in v1.

---

## 4. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│                         UI layer                            │
│  React + Vite + TS · Tailwind · KaTeX for math rendering    │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│                     Row controller                          │
│  Orchestrates: draw → pause → rasterize → VLM → solve → done│
└─────┬─────────┬──────────────┬──────────────┬───────────────┘
      │         │              │              │
┌─────▼───┐ ┌───▼────┐ ┌───────▼───────┐ ┌────▼──────────┐
│ Canvas  │ │ Pause  │ │ VLM adapter   │ │ Solver        │
│ engine  │ │ detect │ │ (transformers │ │ (math.js)     │
│         │ │        │ │  .js / WebGPU)│ │               │
└─────────┘ └────────┘ └───────────────┘ └───────────────┘
                                                 │
                                         ┌───────▼───────┐
                                         │ IndexedDB     │
                                         │ (history)     │
                                         └───────────────┘
```

Key idea: the **row controller** is the only place that knows about state transitions. Canvas, VLM, and solver are stateless services it calls. This keeps the weird async/cancel logic (what if the user starts drawing again mid-VLM-call?) contained in one place.

---

## 5. Canvas layer

### Library choice

**perfect-freehand** for stroke vectorization. It produces pressure-sensitive, filled-path strokes that look like ink instead of jagged polylines. Pair it with raw `<canvas>` + pointer events rather than a full drawing framework — we need tight control over crop boundaries and state.

Alternative considered: tldraw. Too much framework for what is essentially a single-stroke-collection-per-row widget.

### Pause detection

A row is considered "complete" when:
- No pointer-down event for **N milliseconds** (starting point: 1200ms, tunable), AND
- At least one stroke exists on the row, AND
- The user's pointer is not hovering over the row (desktop only).

The timer resets on every new stroke. The user can also hit Enter to force-submit a row, or Escape to cancel a pending submission.

### Rasterization

When a row submits:
1. Compute the bounding box of all strokes on the row, with small padding.
2. Render strokes to an offscreen canvas at a fixed DPI (2x device pixel ratio).
3. Convert to a Blob/ImageData suitable for the VLM adapter.

Rasterizing only the used region matters — tiny crops keep inference fast on 450M-parameter models.

### Row sizing

Rows grow vertically as needed. If the user's handwriting exceeds the initial row height, the canvas expands to accommodate. This avoids forcing users into a fixed line height, which is unnatural for math with subscripts/superscripts/fractions.

---

## 6. VLM layer

### Model roster (v1)

All models run client-side via `@huggingface/transformers` with WebGPU backend.

| Model | Params | Role |
|---|---|---|
| LiquidAI/LFM2.5-VL-450M | 450M | Default. Fastest, smallest. |
| HuggingFaceTB/SmolVLM-Instruct-webgpu | ~500M | Alternate. Good general VLM. |
| Qwen2-VL-2B-Instruct (webgpu variant) | 2B | "Quality mode." Slower to load and run, but stronger on messy handwriting. |

Users pick the active model in settings. Model weights are cached in browser storage (via the transformers.js cache) so a model is only downloaded once.

### Adapter interface

All models are hidden behind a single interface so the row controller doesn't care which is active:

```ts
interface VLMAdapter {
  id: string;
  load(): Promise<void>;       // idempotent; loads weights if not cached
  isReady(): boolean;
  transcribe(image: ImageData): Promise<VLMResult>;
  unload(): Promise<void>;     // free VRAM when switching models
}

interface VLMResult {
  latex: string;               // e.g. "\\int x^2 \\, dx"
  intent?: Intent;             // see below
  confidence?: number;         // 0-1 if the model exposes it
  raw: string;                 // full model output for debugging
}

type Intent =
  | { kind: 'evaluate' }       // "2 + 3"
  | { kind: 'simplify' }       // "(x+1)^2 - x^2"
  | { kind: 'solve'; for?: string }  // "2x + 3 = 7"
  | { kind: 'derivative'; with_respect_to: string }
  | { kind: 'integral'; with_respect_to: string; definite?: { from: string; to: string } };
```

### Prompt strategy

The VLM is prompted to output JSON, not free text. Structured output is more reliable to parse and forces the model to commit to an interpretation:

```
You are a math transcription system. Look at the handwritten math in
the image and return a single JSON object with these fields:
- latex: the expression as valid LaTeX
- intent: one of "evaluate", "simplify", "solve", "derivative", "integral"
- variable: for solve/derivative/integral, the variable; otherwise null

Output only the JSON object. No explanation.
```

Intent is inferred from visual cues: an `=` sign with a variable on one side → solve; `d/dx` or prime notation → derivative; `∫` → integral; otherwise evaluate/simplify.

### Validation layer

Every VLM response passes through a validator before reaching the solver:

1. Parse as JSON. If fails → Errored state, show raw.
2. Check `latex` is non-empty and contains no obviously hallucinated tokens (e.g., words in English sentences).
3. Try to parse the LaTeX into math.js's expression tree. If it fails, Errored state with the parse error visible.
4. Only if all three pass does the solver run.

This is the firewall between messy model output and deterministic math.

---

## 7. Solver layer

### Engine

**math.js** only. No SymPy, no nerdamer. Rationale:

- math.js is actively maintained and covers evaluate, simplify, derivative, and basic algebraic `solve` (via `simplify` and `rationalize` combined with manual rearrangement for linear/quadratic cases).
- Ships as a reasonable bundle, no WASM overhead.
- Predictable. We know exactly what it can and can't do, which matters for the "fail legibly" principle.

### Operations supported in v1

| Intent | math.js approach |
|---|---|
| evaluate | `math.evaluate(expr)` |
| simplify | `math.simplify(expr)` |
| solve (linear in one var) | `math.simplify` + manual isolation, or `math.solve` via `algebra.js` interop if needed |
| solve (quadratic) | derive coefficients, apply quadratic formula explicitly |
| derivative | `math.derivative(expr, variable)` |
| integral (symbolic) | `math.derivative` in reverse via a small hand-built rule table for polynomials, exp, trig. If the rule table misses, return "not supported in v1." |

Symbolic integration is the weak spot. Acceptable for a hobby demo — users trying to integrate `x^n`, `sin(x)`, `cos(x)`, `e^x`, constants, and sums of those will be well-served. Anything harder shows a clear "not supported" result.

### LaTeX → math.js parsing

LaTeX is not directly evaluable. We need a shim. Options:
- Use a small hand-written converter (`\frac{a}{b}` → `(a)/(b)`, `\cdot` → `*`, `^{...}` → `^(...)`, etc.). Covers 90% of what we'll see from the VLM.
- Use `mathlive`'s parser as a dependency. Heavier but more robust.

**Recommendation:** hand-written converter in v1, with a test suite of ~50 realistic LaTeX inputs. Pull in mathlive only if the converter becomes a bottleneck of bugs.

### Result rendering

Results are rendered with KaTeX, same engine as the recognized input. Errored states are plain text. Evaluated numerics are shown with both exact (where possible) and decimal forms when they differ meaningfully (e.g., `7/3` and `≈ 2.333`).

---

## 8. State and persistence

### In-memory state shape

```ts
type AppState = {
  sessionId: string;
  rows: Row[];
  activeModelId: string;
  settings: Settings;
};

type Row = {
  id: string;
  state: 'active' | 'processing' | 'parsed' | 'errored';
  strokes: Stroke[];           // perfect-freehand input points
  image?: Blob;                // rasterized snapshot, if submitted
  vlmResult?: VLMResult;
  solverResult?: SolverResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
};
```

React state via `useReducer` at the session level; individual canvas components hold their own stroke buffer via `useRef` to avoid re-rendering on every pointer move.

### IndexedDB schema

Using `idb` (the Jake Archibald wrapper — small, reliable):

- `sessions` store: `{ id, createdAt, updatedAt, title }`
- `rows` store: `{ id, sessionId, state, strokes, vlmResultJson, solverResultJson, createdAt }`, indexed by `sessionId`

Strokes are persisted so sessions can be reopened with the original ink intact (for the redraw/edit flow). The rasterized image is not persisted — it's cheap to regenerate from strokes.

---

## 9. Project structure

```
slate/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── canvas/
│   │   ├── RowCanvas.tsx         # single-row drawing surface
│   │   ├── useStrokes.ts         # pointer event → perfect-freehand
│   │   ├── rasterize.ts          # strokes → ImageData
│   │   └── pauseDetector.ts
│   ├── vlm/
│   │   ├── adapter.ts            # VLMAdapter interface
│   │   ├── lfm25.ts              # LiquidAI adapter
│   │   ├── smolvlm.ts
│   │   ├── qwen.ts
│   │   └── prompt.ts             # shared prompt template
│   ├── solver/
│   │   ├── validate.ts           # VLM output → clean LaTeX
│   │   ├── latex2mathjs.ts       # LaTeX → math.js source
│   │   ├── solve.ts              # intent dispatch
│   │   └── render.ts             # results → KaTeX
│   ├── state/
│   │   ├── reducer.ts
│   │   ├── context.tsx
│   │   └── db.ts                 # IndexedDB via idb
│   ├── ui/
│   │   ├── Feed.tsx              # the scrolling container
│   │   ├── Row.tsx               # one row in any state
│   │   ├── Sidebar.tsx           # history
│   │   └── Settings.tsx
│   └── types.ts
├── public/
├── tests/
│   └── latex2mathjs.test.ts      # the converter suite
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

---

## 10. Build plan (phased, not timeboxed)

### Phase 0 — scaffold
- Vite + React + TS + Tailwind
- Empty shell with one hardcoded row
- KaTeX rendering a fixed expression to verify the pipeline visually

### Phase 1 — canvas
- perfect-freehand integration in `RowCanvas`
- Stroke capture, smoothing, real-time render
- Rasterization to ImageData, visible as a thumbnail for debugging

### Phase 2 — VLM (one model only)
- Wire up transformers.js with LFM2.5-VL-450M on WebGPU
- Adapter interface in place, but only one implementation
- Hardcoded prompt, JSON parse, show raw LaTeX below the row
- Verify end-to-end: draw → pause → LaTeX appears

### Phase 3 — solver
- LaTeX-to-math.js converter with test suite
- Evaluate and simplify working
- Derivative working
- Solve (linear, quadratic) working
- Errored state UI

### Phase 4 — vertical feed
- Auto-spawn new row on successful parse
- Row state machine (active/processing/parsed/errored)
- Edit/redraw/retry affordances
- Cancel pending VLM call on user re-activation

### Phase 5 — history
- IndexedDB integration
- Sidebar with sessions list
- Reopen past sessions

### Phase 6 — model swap
- Add SmolVLM and Qwen adapters
- Settings UI for active model
- Load/unload handling

### Phase 7 — polish
- Latency tuning (pause threshold, rasterization size)
- Stroke rendering polish
- Empty states, error states, first-run experience
- Integral rule table expansion

---

## 11. Open risks

These are real risks worth naming upfront so they don't surprise you later:

- **WebGPU availability.** Not every browser/device supports WebGPU with enough VRAM for a 450M vision model. The app needs a clear unsupported-device message and, ideally, a feature-detect that runs before the user draws anything.
- **First-run model download size.** 450M params at fp16 is roughly 900MB. Even at int8 quantization it's hundreds of MB. Users on metered connections will bail. The download UX needs a progress bar, a clear size estimate upfront, and a confirmation.
- **VLM output drift.** These are small models. They will hallucinate `x` as `\chi`, mistake `7` for `1`, split `dx` into `dx` or `d \cdot x`. The validation layer and edit-LaTeX escape hatch absorb this, but be prepared for a real accuracy floor. Qwen-2B will outperform the 450M models meaningfully — consider making it the default once cache is warm.
- **LaTeX-to-math.js coverage.** The hand-rolled converter is where most bugs will live. The test suite is not optional.
- **Integral coverage.** The rule-table approach is a deliberate v1 compromise. Users will try `∫ 1/(x^2+1) dx` and it will not work. The "not supported" message needs to be graceful.
- **Mobile.** Drawing math with a finger on a phone is rough. Stylus + tablet is the intended form factor. Mobile support is a polish concern, not a v1 gate.

---

## 12. Explicitly out of scope for v1

To keep scope honest:

- No cloud/API fallback. WebGPU only.
- No multi-region canvas or problem segmentation.
- No graphing or plotting.
- No Pyodide/SymPy.
- No image upload or photo-of-paper input.
- No sharing/export beyond whatever IndexedDB gives us.
- No collaborative editing.
- No accounts.
- No mobile-first layout (desktop/stylus primary).

Each of these is a reasonable v2 direction. Graphing in particular is the most natural first v2 feature given the vertical-feed metaphor.

---

## 13. Decisions requiring sign-off before build starts

1. **Name:** Slate. Alternatives on the table if you want something else (Ledger, Scratch, Quill, Abacus, Carbon).
2. **Default model:** LFM2.5-VL-450M for load speed, or Qwen2-VL-2B for accuracy? This meaningfully changes first-run feel.
3. **Int8 vs fp16 weights:** int8 halves the download but hurts accuracy. Leaning int8 for the 450M models, fp16 for Qwen.
4. **Row height default:** fixed single line that grows, or fixed multi-line from the start? Leaning single-line-that-grows.

None of these block starting Phase 0.
