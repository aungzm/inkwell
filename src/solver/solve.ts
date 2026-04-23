import { derivative, evaluate, simplify } from 'mathjs';
import type { Intent, SolverResult } from '../types';
import { latexToMathJs } from './latex2mathjs';
import { mathTextToLatex } from './render';

const round = (value: number) => Math.round(value * 1000) / 1000;

const solveEquation = (input: string, variable = 'x'): SolverResult => {
  const [lhs, rhs] = input.split('=');

  if (!lhs || !rhs) {
    throw new Error('The solver expected an equation.');
  }

  const normalized = `(${latexToMathJs(lhs)}) - (${latexToMathJs(rhs)})`;
  const c = Number(evaluate(normalized, { [variable]: 0 }));
  const f1 = Number(evaluate(normalized, { [variable]: 1 }));
  const f2 = Number(evaluate(normalized, { [variable]: 2 }));
  const a = round((f2 - 2 * f1 + c) / 2);
  const b = round(f1 - c - a);

  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) < 1e-9) {
      throw new Error('The equation is not solvable in one variable.');
    }

    const solution = round(-c / b);
    return {
      kind: 'exact',
      latex: `${variable} = ${solution}`,
      plainText: `${variable} = ${solution}`,
    };
  }

  const discriminant = round(b * b - 4 * a * c);
  if (discriminant < 0) {
    return {
      kind: 'unsupported',
      latex: '\\text{No real roots}',
      plainText: 'No real roots',
    };
  }

  const root = Math.sqrt(discriminant);
  const plus = round((-b + root) / (2 * a));
  const minus = round((-b - root) / (2 * a));
  const plainText =
    plus === minus
      ? `${variable} = ${plus}`
      : `${variable} = ${plus}, ${minus}`;

  return {
    kind: 'exact',
    latex:
      plus === minus
        ? `${variable} = ${plus}`
        : `${variable} \\in \\{${plus}, ${minus}\\}`,
    plainText,
  };
};

const integrate = (input: string, variable = 'x'): SolverResult => {
  const source = latexToMathJs(input);

  if (source === variable) {
    return {
      kind: 'exact',
      latex: `\\frac{${variable}^{2}}{2} + C`,
      plainText: `${variable}^2 / 2 + C`,
    };
  }

  const polynomialMatch = source.match(
    new RegExp(`^${variable}\\^\\((\\d+)\\)$|^${variable}\\^(\\d+)$`),
  );
  if (polynomialMatch) {
    const exponent = Number(polynomialMatch[1] ?? polynomialMatch[2]);
    const next = exponent + 1;
    return {
      kind: 'exact',
      latex: `\\frac{${variable}^{${next}}}{${next}} + C`,
      plainText: `${variable}^${next} / ${next} + C`,
    };
  }

  if (source === 'sin(x)') {
    return {
      kind: 'exact',
      latex: '-\\cos(x) + C',
      plainText: '-cos(x) + C',
    };
  }

  if (source === 'cos(x)') {
    return {
      kind: 'exact',
      latex: '\\sin(x) + C',
      plainText: 'sin(x) + C',
    };
  }

  return {
    kind: 'unsupported',
    latex: '\\text{Integral not supported in v1}',
    plainText: 'Integral not supported in v1',
  };
};

export function solveMath(inputLatex: string, intent?: Intent): SolverResult {
  if (intent?.kind === 'solve') {
    return solveEquation(inputLatex, intent.for ?? 'x');
  }

  if (intent?.kind === 'derivative') {
    const expression = inputLatex.replace(/^\\frac\{d\}\{d[a-zA-Z]\}\s*/, '');
    const result = derivative(
      latexToMathJs(expression),
      intent.withRespectTo,
    ).toString();

    return {
      kind: 'exact',
      latex: mathTextToLatex(result),
      plainText: result,
    };
  }

  if (intent?.kind === 'integral') {
    return integrate(inputLatex, intent.withRespectTo);
  }

  const source = latexToMathJs(inputLatex);
  const hasVariable = /[a-zA-Z]/.test(source);

  if (intent?.kind === 'simplify' || hasVariable) {
    const result = simplify(source).toString();
    return {
      kind: 'exact',
      latex: mathTextToLatex(result),
      plainText: result,
    };
  }

  const evaluated = evaluate(source);
  const plainText = String(round(Number(evaluated)));
  return {
    kind: 'approximate',
    latex: plainText,
    plainText,
  };
}
