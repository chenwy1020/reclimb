/** Preserve code while accepting both Markdown and common TeX math delimiters. */
export function normalizeMathDelimiters(text: string): string {
  return text
    .split(/(\x60{3}[\s\S]*?\x60{3}|\x60[^\x60\n]*\x60)/g)
    .map((piece, i) =>
      i % 2
        ? piece
        : piece
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n(?![A-Za-z])/g, '\n')
            .replace(/\\\[([\s\S]*?)\\\]/g, (_, math: string) => '\n$$\n' + math.trim() + '\n$$\n')
            .replace(/\\\(([^\n]*?)\\\)/g, (_, math: string) => '$' + math + '$'),
    )
    .join('');
}
