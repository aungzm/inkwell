import type { VLMResult } from '../types';

const HALLUCINATION_PATTERN = /\b(this|image|answer|explanation|sorry)\b/i;

export function validateVlmResult(result: VLMResult): VLMResult {
  if (!result.latex.trim()) {
    throw new Error('The recognizer returned an empty LaTeX string.');
  }

  if (HALLUCINATION_PATTERN.test(result.latex)) {
    throw new Error('The recognizer output looked like prose instead of math.');
  }

  return result;
}
