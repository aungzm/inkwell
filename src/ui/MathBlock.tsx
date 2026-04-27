import { useEffect, useRef } from 'react';
import katex from 'katex';

type MathBlockProps = {
  latex: string;
};

export function MathBlock({ latex }: MathBlockProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    katex.render(latex, container, {
      throwOnError: false,
      displayMode: true,
      trust: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
    });
  }, [latex]);

  return <div ref={containerRef} className="math-block" />;
}
