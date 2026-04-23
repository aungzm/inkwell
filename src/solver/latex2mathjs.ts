const replaceFrac = (input: string): string => {
  const marker = '\\frac{';
  const start = input.indexOf(marker);

  if (start === -1) {
    return input;
  }

  const numeratorStart = start + marker.length - 1;
  const { content: numerator, endIndex: numeratorEnd } = extractBraced(
    input,
    numeratorStart,
  );
  const { content: denominator, endIndex: denominatorEnd } = extractBraced(
    input,
    numeratorEnd + 1,
  );

  const replacement = `((${replaceFrac(numerator)})/(${replaceFrac(denominator)}))`;

  return replaceFrac(
    `${input.slice(0, start)}${replacement}${input.slice(denominatorEnd + 1)}`,
  );
};

function extractBraced(source: string, openIndex: number) {
  if (source[openIndex] !== '{') {
    throw new Error('Expected a braced LaTeX group.');
  }

  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          content: source.slice(openIndex + 1, index),
          endIndex: index,
        };
      }
    }
  }

  throw new Error('Unbalanced braces in LaTeX input.');
}

export function latexToMathJs(input: string): string {
  let output = input.trim();

  output = replaceFrac(output);
  output = output.replace(/\\left|\\right/g, '');
  output = output.replace(/\\cdot|\\times/g, '*');
  output = output.replace(/\\sqrt\{([^{}]+)\}/g, 'sqrt($1)');
  output = output.replace(/\\sin/g, 'sin');
  output = output.replace(/\\cos/g, 'cos');
  output = output.replace(/\\tan/g, 'tan');
  output = output.replace(/\^\{([^{}]+)\}/g, '^($1)');
  output = output.replace(/\s+/g, ' ');
  output = output.replace(/(\d)([a-zA-Z])/g, '$1 * $2');
  output = output.replace(/([a-zA-Z)])\(/g, '$1 * (');
  output = output.replace(/\)([a-zA-Z0-9])/g, ') * $1');
  output = output.replace(/\b(sqrt|sin|cos|tan)\s*\*\s*\(/g, '$1(');

  return output.trim();
}
