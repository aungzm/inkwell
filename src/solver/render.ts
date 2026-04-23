export function mathTextToLatex(input: string) {
  return input
    .replace(/\*/g, ' \\cdot ')
    .replace(/sqrt\(([^()]+)\)/g, '\\sqrt{$1}');
}
