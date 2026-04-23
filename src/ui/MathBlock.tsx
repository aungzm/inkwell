import katex from 'katex';

type MathBlockProps = {
  latex: string;
};

export function MathBlock({ latex }: MathBlockProps) {
  return (
    <div
      className="math-block"
      dangerouslySetInnerHTML={{
        __html: katex.renderToString(latex, {
          throwOnError: false,
          displayMode: true,
        }),
      }}
    />
  );
}
