export type EvaluationResult = {
  value: number;
  display: string;
  approximate: boolean;
  /** Set when the result came from solving an equation, e.g. "y" in "y = 1". */
  variable?: string;
};

type Token =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '^' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'lbrace' }
  | { type: 'rbrace' }
  | { type: 'lbracket' }
  | { type: 'rbracket' }
  | { type: 'cmd'; value: string }
  | { type: 'bang' };

/**
 * A value that is linear in (at most) a single variable: `a * v + k`.
 * `v` is null exactly when `a` is 0 (a pure constant).
 */
type Linear = { k: number; a: number; v: string | null };

const constant = (k: number): Linear => ({ k, a: 0, v: null });
const variable = (name: string): Linear => ({ k: 0, a: 1, v: name });

function sharedVar(x: Linear, y: Linear): string | null {
  if (x.v && y.v && x.v !== y.v) {
    throw new Error('more than one variable');
  }
  return x.v ?? y.v;
}

function add(x: Linear, y: Linear): Linear {
  const v = sharedVar(x, y);
  const a = x.a + y.a;
  return a === 0 ? constant(x.k + y.k) : { k: x.k + y.k, a, v };
}

function negate(x: Linear): Linear {
  return x.a === 0 ? constant(-x.k) : { k: -x.k, a: -x.a, v: x.v };
}

function multiply(x: Linear, y: Linear): Linear {
  if (x.a === 0) {
    const a = x.k * y.a;
    return a === 0 ? constant(x.k * y.k) : { k: x.k * y.k, a, v: y.v };
  }
  if (y.a === 0) {
    const a = y.k * x.a;
    return a === 0 ? constant(x.k * y.k) : { k: x.k * y.k, a, v: x.v };
  }
  throw new Error('nonlinear product');
}

function divide(x: Linear, y: Linear): Linear {
  if (y.a !== 0) {
    throw new Error('nonlinear division');
  }
  const a = x.a / y.k;
  return a === 0 ? constant(x.k / y.k) : { k: x.k / y.k, a, v: x.v };
}

function power(base: Linear, exponent: Linear): Linear {
  if (exponent.a !== 0) {
    throw new Error('variable exponent');
  }
  if (base.a === 0) {
    return constant(Math.pow(base.k, exponent.k));
  }
  if (exponent.k === 1) {
    return base;
  }
  if (exponent.k === 0) {
    return constant(1);
  }
  throw new Error('nonlinear power');
}

function asNumber(x: Linear): number {
  if (x.a !== 0) {
    throw new Error('expected a constant');
  }
  return x.k;
}

function factorial(x: Linear): Linear {
  const n = asNumber(x);
  if (!Number.isInteger(n) || n < 0 || n > 170) {
    throw new Error('factorial domain');
  }
  let result = 1;
  for (let k = 2; k <= n; k++) {
    result *= k;
  }
  return constant(result);
}

function tokenize(rawInput: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;

  // Recognizers often split a multi-digit number into spaced digits ("1 2"
  // for "12"). Adjacent digits never mean multiplication in handwritten math,
  // so glue digit runs separated only by whitespace back together.
  const input = rawInput.replace(/(\d)\s+(?=[\d.])/g, '$1');

  while (i < input.length) {
    const c = input[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '&' || c === '~') {
      i++;
      continue;
    }

    if (c === '\\') {
      i++;
      const nextChar = input[i];

      if (nextChar !== undefined && !/[a-zA-Z]/.test(nextChar)) {
        i++;
        if (nextChar === '{') {
          tokens.push({ type: 'lbrace' });
        } else if (nextChar === '}') {
          tokens.push({ type: 'rbrace' });
        }
        continue;
      }

      let name = '';
      while (i < input.length && /[a-zA-Z]/.test(input[i])) {
        name += input[i];
        i++;
      }

      if (name === 'left' || name === 'right') {
        continue;
      }

      tokens.push({ type: 'cmd', value: name });
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let num = '';
      while (i < input.length && /[0-9.]/.test(input[i])) {
        num += input[i];
        i++;
      }
      const value = Number(num);
      if (!Number.isFinite(value)) {
        return null;
      }
      tokens.push({ type: 'num', value });
      continue;
    }

    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '^') {
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }

    if (c === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if (c === '{') {
      tokens.push({ type: 'lbrace' });
      i++;
      continue;
    }
    if (c === '}') {
      tokens.push({ type: 'rbrace' });
      i++;
      continue;
    }
    if (c === '[') {
      tokens.push({ type: 'lbracket' });
      i++;
      continue;
    }
    if (c === ']') {
      tokens.push({ type: 'rbracket' });
      i++;
      continue;
    }
    if (c === '!') {
      tokens.push({ type: 'bang' });
      i++;
      continue;
    }

    if (c === ',' || c === '|') {
      i++;
      continue;
    }

    // A bare letter is a variable (each letter is its own symbol).
    if (/[a-zA-Z]/.test(c)) {
      tokens.push({ type: 'var', name: c });
      i++;
      continue;
    }

    return null;
  }

  return tokens;
}

class Parser {
  private i = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Linear {
    const value = this.parseExpr();
    if (this.i < this.tokens.length) {
      throw new Error('trailing tokens');
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }

  private next(): Token {
    const token = this.tokens[this.i];
    if (!token) {
      throw new Error('unexpected end');
    }
    this.i++;
    return token;
  }

  private expect(type: Token['type']): void {
    const token = this.next();
    if (token.type !== type) {
      throw new Error(`expected ${type}`);
    }
  }

  private parseExpr(): Linear {
    let value = this.parseTerm();
    let token = this.peek();
    while (token && token.type === 'op' && (token.value === '+' || token.value === '-')) {
      this.next();
      const rhs = this.parseTerm();
      value = token.value === '+' ? add(value, rhs) : add(value, negate(rhs));
      token = this.peek();
    }
    return value;
  }

  private parseTerm(): Linear {
    let value = this.parseUnary();
    let token = this.peek();
    while (token) {
      if (token.type === 'op' && (token.value === '*' || token.value === '/')) {
        this.next();
        const rhs = this.parseUnary();
        value = token.value === '*' ? multiply(value, rhs) : divide(value, rhs);
      } else if (token.type === 'cmd' && (token.value === 'cdot' || token.value === 'times' || token.value === 'ast')) {
        this.next();
        value = multiply(value, this.parseUnary());
      } else if (token.type === 'cmd' && token.value === 'div') {
        this.next();
        value = divide(value, this.parseUnary());
      } else if (this.startsFactor(token)) {
        // Implicit multiplication, e.g. 5y, 2(3+4), 3\pi.
        value = multiply(value, this.parseUnary());
      } else {
        break;
      }
      token = this.peek();
    }
    return value;
  }

  private startsFactor(token: Token): boolean {
    if (token.type === 'num' || token.type === 'var' || token.type === 'lparen' || token.type === 'lbrace') {
      return true;
    }
    if (token.type === 'cmd') {
      return (
        token.value !== 'cdot' &&
        token.value !== 'times' &&
        token.value !== 'ast' &&
        token.value !== 'div'
      );
    }
    return false;
  }

  private parseUnary(): Linear {
    const token = this.peek();
    if (token && token.type === 'op' && (token.value === '+' || token.value === '-')) {
      this.next();
      const value = this.parseUnary();
      return token.value === '-' ? negate(value) : value;
    }
    return this.parsePower();
  }

  private parsePower(): Linear {
    const base = this.parsePostfix();
    const token = this.peek();
    if (token && token.type === 'op' && token.value === '^') {
      this.next();
      return power(base, this.parseUnary());
    }
    return base;
  }

  private parsePostfix(): Linear {
    let value = this.parseAtom();
    let token = this.peek();
    while (token && token.type === 'bang') {
      this.next();
      value = factorial(value);
      token = this.peek();
    }
    return value;
  }

  private parseAtom(): Linear {
    const token = this.next();
    switch (token.type) {
      case 'num':
        return constant(token.value);
      case 'var':
        return variable(token.name);
      case 'lparen': {
        const value = this.parseExpr();
        this.expect('rparen');
        return value;
      }
      case 'lbrace': {
        const value = this.parseExpr();
        this.expect('rbrace');
        return value;
      }
      case 'cmd':
        return this.parseCommand(token.value);
      default:
        throw new Error('unexpected token');
    }
  }

  private parseGroup(): Linear {
    const token = this.peek();
    if (token && token.type === 'lbrace') {
      this.next();
      const value = this.parseExpr();
      this.expect('rbrace');
      return value;
    }
    return this.parsePower();
  }

  private fn(apply: (n: number) => number): Linear {
    return constant(apply(asNumber(this.parseGroup())));
  }

  private parseCommand(name: string): Linear {
    switch (name) {
      case 'pi':
        return constant(Math.PI);
      case 'tau':
        return constant(Math.PI * 2);
      case 'frac':
      case 'dfrac':
      case 'tfrac': {
        const numerator = this.parseGroup();
        const denominator = this.parseGroup();
        return divide(numerator, denominator);
      }
      case 'sqrt': {
        let degree = 2;
        const token = this.peek();
        if (token && token.type === 'lbracket') {
          this.next();
          degree = asNumber(this.parseExpr());
          this.expect('rbracket');
        }
        return constant(Math.pow(asNumber(this.parseGroup()), 1 / degree));
      }
      case 'sin':
        return this.fn(Math.sin);
      case 'cos':
        return this.fn(Math.cos);
      case 'tan':
        return this.fn(Math.tan);
      case 'cot':
        return this.fn((n) => 1 / Math.tan(n));
      case 'sec':
        return this.fn((n) => 1 / Math.cos(n));
      case 'csc':
        return this.fn((n) => 1 / Math.sin(n));
      case 'arcsin':
        return this.fn(Math.asin);
      case 'arccos':
        return this.fn(Math.acos);
      case 'arctan':
        return this.fn(Math.atan);
      case 'sinh':
        return this.fn(Math.sinh);
      case 'cosh':
        return this.fn(Math.cosh);
      case 'tanh':
        return this.fn(Math.tanh);
      case 'ln':
        return this.fn(Math.log);
      case 'log':
        return this.fn(Math.log10);
      case 'exp':
        return this.fn(Math.exp);
      case 'abs':
        return this.fn(Math.abs);
      default:
        throw new Error(`unknown command ${name}`);
    }
  }
}

function parseLinear(source: string): Linear {
  const tokens = tokenize(source);
  if (!tokens || tokens.length === 0) {
    throw new Error('empty');
  }
  return new Parser(tokens).parse();
}

function formatResult(value: number, variableName?: string): EvaluationResult {
  let display: string;
  let approximate: boolean;

  if (Number.isInteger(value)) {
    display = String(value);
    approximate = false;
  } else {
    const magnitude = Math.abs(value);
    if (magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e9)) {
      display = value.toPrecision(6).replace(/\.?0+($|e)/i, '$1');
    } else {
      display = String(Math.round(value * 1e6) / 1e6);
    }
    approximate = Math.abs(Number(display) - value) > 1e-12;
  }

  return { value, display, approximate, variable: variableName };
}

/**
 * Evaluates a LaTeX expression when it resolves to a single number:
 *  - a pure arithmetic expression ("3/4 + 1" → 1.75), or
 *  - a single-variable linear equation, solved for the variable ("5y + 2 = 7" → y = 1).
 *
 * Returns null when it cannot — multiple variables, nonlinear terms, no unique
 * solution, or unsupported constructs.
 */
export function evaluateLatex(latex: string): EvaluationResult | null {
  if (!latex) {
    return null;
  }

  const sides = latex.split('=');
  if (sides.length > 2) {
    return null;
  }

  const leftStr = sides[0]?.trim() ?? '';
  const rightStr = sides.length === 2 ? sides[1].trim() : null;
  if (!leftStr && !rightStr) {
    return null;
  }

  try {
    const left = leftStr ? parseLinear(leftStr) : null;
    const right = rightStr !== null && rightStr ? parseLinear(rightStr) : null;

    // No equation — just evaluate the expression to a number.
    if (right === null) {
      if (!left || left.a !== 0) {
        return null;
      }
      const result = formatResult(left.k);
      return Number.isFinite(result.value) ? result : null;
    }
    if (left === null) {
      if (right.a !== 0) {
        return null;
      }
      const result = formatResult(right.k);
      return Number.isFinite(result.value) ? result : null;
    }

    // Equation: left = right.
    const variableName = left.v ?? right.v;

    // Both sides constant — show the computed value of the left side.
    if (!variableName) {
      const result = formatResult(left.k);
      return Number.isFinite(result.value) ? result : null;
    }

    // a*var = -k  →  var = -k / a
    const a = left.a - right.a;
    const k = left.k - right.k;
    if (a === 0) {
      return null;
    }
    const solution = -k / a;
    if (!Number.isFinite(solution)) {
      return null;
    }
    return formatResult(solution, variableName);
  } catch {
    return null;
  }
}
