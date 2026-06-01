export type EvaluationResult = {
  value: number;
  display: string;
  approximate: boolean;
};

type Token =
  | { type: 'num'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '^' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'lbrace' }
  | { type: 'rbrace' }
  | { type: 'lbracket' }
  | { type: 'rbracket' }
  | { type: 'cmd'; value: string }
  | { type: 'bang' };

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const c = input[i];

    // Whitespace and LaTeX alignment/spacing glue.
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '&' || c === '~') {
      i++;
      continue;
    }

    if (c === '\\') {
      i++;
      const nextChar = input[i];

      // Escaped symbol or spacing command like \, \! \; \{ \}
      if (nextChar !== undefined && !/[a-zA-Z]/.test(nextChar)) {
        i++;
        if (nextChar === '{') {
          tokens.push({ type: 'lbrace' });
        } else if (nextChar === '}') {
          tokens.push({ type: 'rbrace' });
        }
        // Other escapes (\, \! \; \  \%) are spacing — skip.
        continue;
      }

      let name = '';
      while (i < input.length && /[a-zA-Z]/.test(input[i])) {
        name += input[i];
        i++;
      }

      // \left( and \right) — the delimiter follows as its own token.
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

    // Thousands separators and stray bars are decorative — ignore.
    if (c === ',' || c === '|') {
      i++;
      continue;
    }

    // A bare letter means a variable/unknown — not a plain numeric expression.
    return null;
  }

  return tokens;
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) {
    throw new Error('factorial domain');
  }
  let result = 1;
  for (let k = 2; k <= n; k++) {
    result *= k;
  }
  return result;
}

class Parser {
  private i = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): number {
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

  private parseExpr(): number {
    let value = this.parseTerm();
    let token = this.peek();
    while (token && token.type === 'op' && (token.value === '+' || token.value === '-')) {
      this.next();
      const rhs = this.parseTerm();
      value = token.value === '+' ? value + rhs : value - rhs;
      token = this.peek();
    }
    return value;
  }

  private parseTerm(): number {
    let value = this.parseUnary();
    let token = this.peek();
    while (token) {
      if (token.type === 'op' && (token.value === '*' || token.value === '/')) {
        this.next();
        const rhs = this.parseUnary();
        value = token.value === '*' ? value * rhs : value / rhs;
      } else if (token.type === 'cmd' && (token.value === 'cdot' || token.value === 'times' || token.value === 'ast')) {
        this.next();
        value *= this.parseUnary();
      } else if (token.type === 'cmd' && token.value === 'div') {
        this.next();
        value /= this.parseUnary();
      } else if (this.startsFactor(token)) {
        // Implicit multiplication, e.g. 2(3+4) or 3\pi.
        value *= this.parseUnary();
      } else {
        break;
      }
      token = this.peek();
    }
    return value;
  }

  private startsFactor(token: Token): boolean {
    if (token.type === 'num' || token.type === 'lparen' || token.type === 'lbrace') {
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

  private parseUnary(): number {
    const token = this.peek();
    if (token && token.type === 'op' && (token.value === '+' || token.value === '-')) {
      this.next();
      const value = this.parseUnary();
      return token.value === '-' ? -value : value;
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePostfix();
    const token = this.peek();
    if (token && token.type === 'op' && token.value === '^') {
      this.next();
      const exponent = this.parseUnary();
      return Math.pow(base, exponent);
    }
    return base;
  }

  private parsePostfix(): number {
    let value = this.parseAtom();
    let token = this.peek();
    while (token && token.type === 'bang') {
      this.next();
      value = factorial(value);
      token = this.peek();
    }
    return value;
  }

  private parseAtom(): number {
    const token = this.next();
    switch (token.type) {
      case 'num':
        return token.value;
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

  // A braced group {...}, or a single atom/power for bare arguments.
  private parseGroup(): number {
    const token = this.peek();
    if (token && token.type === 'lbrace') {
      this.next();
      const value = this.parseExpr();
      this.expect('rbrace');
      return value;
    }
    return this.parsePower();
  }

  private parseCommand(name: string): number {
    switch (name) {
      case 'pi':
        return Math.PI;
      case 'tau':
        return Math.PI * 2;
      case 'frac':
      case 'dfrac':
      case 'tfrac': {
        const numerator = this.parseGroup();
        const denominator = this.parseGroup();
        return numerator / denominator;
      }
      case 'sqrt': {
        let degree = 2;
        const token = this.peek();
        if (token && token.type === 'lbracket') {
          this.next();
          degree = this.parseExpr();
          this.expect('rbracket');
        }
        return Math.pow(this.parseGroup(), 1 / degree);
      }
      case 'sin':
        return Math.sin(this.parseGroup());
      case 'cos':
        return Math.cos(this.parseGroup());
      case 'tan':
        return Math.tan(this.parseGroup());
      case 'cot':
        return 1 / Math.tan(this.parseGroup());
      case 'sec':
        return 1 / Math.cos(this.parseGroup());
      case 'csc':
        return 1 / Math.sin(this.parseGroup());
      case 'arcsin':
        return Math.asin(this.parseGroup());
      case 'arccos':
        return Math.acos(this.parseGroup());
      case 'arctan':
        return Math.atan(this.parseGroup());
      case 'sinh':
        return Math.sinh(this.parseGroup());
      case 'cosh':
        return Math.cosh(this.parseGroup());
      case 'tanh':
        return Math.tanh(this.parseGroup());
      case 'ln':
        return Math.log(this.parseGroup());
      case 'log':
        return Math.log10(this.parseGroup());
      case 'exp':
        return Math.exp(this.parseGroup());
      case 'abs':
        return Math.abs(this.parseGroup());
      default:
        throw new Error(`unknown command ${name}`);
    }
  }
}

function formatResult(value: number): EvaluationResult {
  if (Number.isInteger(value)) {
    return { value, display: String(value), approximate: false };
  }

  let display: string;
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e9)) {
    display = value.toPrecision(6).replace(/\.?0+($|e)/i, '$1');
  } else {
    const rounded = Math.round(value * 1e6) / 1e6;
    display = String(rounded);
  }

  const approximate = Math.abs(Number(display) - value) > 1e-12;
  return { value, display, approximate };
}

/**
 * Evaluates a LaTeX expression to a single number when it is a self-contained
 * numeric calculation (no free variables). Returns null when the expression
 * cannot be evaluated — e.g. it contains variables, is an equation to solve,
 * or uses unsupported constructs.
 */
export function evaluateLatex(latex: string): EvaluationResult | null {
  if (!latex) {
    return null;
  }

  // Evaluate the left-hand side of an equation/relation ("2+2=" → 4).
  let expr = latex.trim();
  if (expr.includes('=')) {
    expr = expr.slice(0, expr.indexOf('='));
  }
  if (!expr.trim()) {
    return null;
  }

  const tokens = tokenize(expr);
  if (!tokens || tokens.length === 0) {
    return null;
  }

  try {
    const value = new Parser(tokens).parse();
    if (!Number.isFinite(value)) {
      return null;
    }
    return formatResult(value);
  } catch {
    return null;
  }
}
