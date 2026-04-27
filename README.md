# Inkwell

A handwritten-formula recognition workstation that runs entirely in your browser. Sketch a math expression on the canvas, and a local vision-language model transcribes it to LaTeX — no server round-trip, no data leaves your machine.

Inkwell is built on WebGPU + ONNX Runtime Web, so the whole inference pipeline executes locally against models like LiquidAI LFM2.5-VL and FastVLM.

**Live demo:** <https://ink.aungzm.com/>

## Stack

- **React 19** + **Vite 7** + **TypeScript** for the UI
- **onnxruntime-web** (WebGPU) for in-browser model execution
- **@huggingface/transformers** for tokenizer/processor utilities
- **perfect-freehand** for natural ink strokes
- **KaTeX** for LaTeX rendering
- **mathjs** for LaTeX → expression conversion (used by the planned solver)

## Getting started

```bash
pnpm install
pnpm dev
```

Then open the dev server URL printed in the terminal.

### Browser support

Use a **Chromium-based browser** (Chrome, Edge, Brave, Arc, Opera). WebGPU is enabled by default in Chromium since v113 and the ONNX Runtime Web pipeline is well exercised there.

- **Safari** — WebGPU shipped in 18.4 but coverage of the ops Transformers.js needs is still partial; expect crashes or fallback errors.
- **Firefox** — WebGPU is behind `dom.webgpu.enabled` and considered experimental. Inkwell may load the runtime but fail during inference.

### System requirements

- **RAM:** 8 GB minimum, 16 GB recommended. The 450M / 0.5B model weights, KV cache, and image buffers all sit in GPU + system memory at once.
- **GPU:** any discrete GPU or modern integrated GPU (Intel Iris Xe, Apple M-series, AMD Radeon 6xxx+, NVIDIA GTX 10-series+) with WebGPU support.
- **Disk:** ~600 MB free for the browser cache to hold the ONNX weights between sessions.

### First load

The first time you pick a model, the browser downloads its ONNX weights from the HuggingFace CDN — roughly **400–600 MB per model**, depending on the chosen quantisation. On a typical home connection this can take **30 seconds to a couple of minutes**, and the canvas will sit behind a "Loading…" status bar the whole time. Once cached by the browser, subsequent loads are near-instant.

Other scripts:

```bash
pnpm build      # type-check + production build
pnpm preview    # preview the production build
pnpm test       # run vitest
```

## How it works

1. You draw on the canvas with the **Ink** or **Erase** tool.
2. After a brief pause, the strokes are rasterized into a tight crop.
3. The active VLM adapter (LFM2.5-VL or FastVLM) runs locally on WebGPU and returns LaTeX.
4. The result is rendered with KaTeX and the raw LaTeX source is shown alongside.

Model adapters live in [src/vlm/](src/vlm/) and implement a common [VLMAdapter](src/vlm/adapter.ts) interface, so additional models can be slotted in.

## Roadmap

### Available now

- [x] Handwritten formula recognition to LaTeX (LiquidAI LFM2.5-VL 450M)
- [x] FastVLM 0.5B as an alternate adapter
- [x] Fully local, in-browser inference via WebGPU + ONNX Runtime Web
- [x] Pencil + eraser tools with adjustable stroke width and ink tone
- [x] Auto-crop and pause-detection on the drawing canvas
- [x] Live KaTeX preview of the recognized formula
- [x] Raw LaTeX source panel

### Planned

- [ ] **Calculation of LaTeX equations** — evaluate, simplify, solve, differentiate, and integrate the recognized expression via mathjs
- [ ] **History panel** — scroll back through previous recognitions and restore any prior result to the canvas
- [ ] **Copy LaTeX** — one-click copy of the LaTeX source to the clipboard
- [ ] **Upload as image** — drop a photo or screenshot of a handwritten formula instead of drawing it
- [ ] **Larger canvas** — resizable / multi-row workspace for longer derivations

Have an idea? Open an issue at <https://github.com/aungzm/inkwell/issues>.

## License

MIT