const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function graphemes(s: string): string[] {
  return Array.from(segmenter.segment(s), (x) => x.segment);
}

export function graphemeLength(s: string): number {
  return graphemes(s).length;
}

export function truncateGraphemes(s: string, max: number): string {
  const g = graphemes(s);
  if (g.length <= max) return s;
  if (max <= 0) return '';
  return (
    g
      .slice(0, max - 1)
      .join('')
      .trimEnd() + '…'
  );
}

export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstSentences(md: string, n: number): string {
  const sentences = plainText(md).match(/[^.!?]+[.!?]+/g) ?? [];
  return sentences
    .slice(0, n)
    .map((s) => s.trim())
    .join(' ');
}
