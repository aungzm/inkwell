import { describe, expect, it } from 'vitest';
import { latexToMathJs } from '../src/solver/latex2mathjs';

describe('latexToMathJs', () => {
  it('converts fractions', () => {
    expect(latexToMathJs('\\frac{1}{2}')).toBe('((1)/(2))');
  });

  it('converts implicit multiplication', () => {
    expect(latexToMathJs('2x + 3')).toBe('2 * x + 3');
  });

  it('converts powers with braces', () => {
    expect(latexToMathJs('x^{3} + 1')).toBe('x^(3) + 1');
  });

  it('converts square roots', () => {
    expect(latexToMathJs('\\sqrt{x}')).toBe('sqrt(x)');
  });
});
