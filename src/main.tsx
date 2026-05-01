import React from 'react';
import ReactDOM from 'react-dom/client';
import { env } from '@huggingface/transformers';
import App from './App';
import './styles.css';
import 'katex/dist/katex.min.css';

// Keep ONNX Runtime helper assets on the same origin so they satisfy CSP.
const ortWasmUrl = new URL(
  '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm',
  import.meta.url,
).href;
const ortFactoryUrl = new URL(
  '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs',
  import.meta.url,
).href;

// Avoid generating blob: module URLs for the wasm factory, which stricter CSPs block.
env.useWasmCache = false;

(env.backends.onnx as {
  wasm?: {
    wasmPaths?: {
      wasm: string;
      mjs: string;
    };
  };
}).wasm ??= {};

(env.backends.onnx as {
  wasm: {
    wasmPaths?: {
      wasm: string;
      mjs: string;
    };
  };
}).wasm.wasmPaths = {
  wasm: ortWasmUrl,
  mjs: ortFactoryUrl,
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
