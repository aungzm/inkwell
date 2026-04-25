import type { VLMResult } from '../types';

const HALLUCINATION_PATTERN = /\b(this|image|answer|explanation|sorry)\b/i;
const DOCUMENT_PATTERN =
  /\\documentclass|\\usepackage|\\begin\{document\}|\\end\{document\}|\\begin\{tikzpicture\}|\\end\{tikzpicture\}|\\draw\b|\\node\b/i;

export function validateVlmResult(result: VLMResult): VLMResult {
  if (!result.latex.trim()) {
    throw new Error('The recognizer returned an empty LaTeX string.');
  }

  if (HALLUCINATION_PATTERN.test(result.latex)) {
    throw new Error('The recognizer output looked like prose instead of math.');
  }

  if (DOCUMENT_PATTERN.test(result.latex)) {
    throw new Error('The recognizer output looked like a full LaTeX document instead of a single math expression.');
  }

  return result;
}
