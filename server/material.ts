export interface SourceMaterialExcerpt {
  text: string;
  totalCharacters: number;
  includedRanges: Array<{ start: number; end: number }>;
  truncated: boolean;
}

/** Select small, task-relevant excerpts while retaining the original character offsets. */
export function selectSourceMaterialExcerpt(source: string | undefined, relevance: string, maxCharacters = 6000): SourceMaterialExcerpt | undefined {
  if (!source?.length) return undefined;
  if (source.length <= maxCharacters) return { text: source, totalCharacters: source.length, includedRanges: [{ start: 0, end: source.length }], truncated: false };
  const tokens = [...new Set((relevance.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter(token => token.length >= 2))];
  const chunks: Array<{ start: number; end: number; text: string; score: number }> = [];
  const matcher = /[^\n.!?。！？]+(?:[.!?。！？]+|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source))) {
    const value = match[0];
    if (!value.trim()) continue;
    const lower = value.toLocaleLowerCase();
    const score = tokens.reduce((sum, token) => sum + (lower.includes(token) ? 1 : 0), 0);
    chunks.push({ start: match.index, end: match.index + value.length, text: value, score });
  }
  if (!chunks.length) chunks.push({ start: 0, end: source.length, text: source, score: 0 });
  const ranked = [...chunks].sort((a, b) => b.score - a.score || a.start - b.start);
  const selected: typeof chunks = [];
  let size = 0;
  for (const chunk of ranked) {
    const remaining = maxCharacters - size;
    if (remaining <= 0) break;
    const chosen = chunk.text.length <= remaining ? chunk : { ...chunk, end: chunk.start + remaining, text: chunk.text.slice(0, remaining) };
    selected.push(chosen); size += chosen.text.length;
  }
  selected.sort((a, b) => a.start - b.start);
  const ranges = selected.map(chunk => ({ start: chunk.start, end: chunk.end }));
  return {
    text: selected.map(chunk => chunk.text).join('\n[…材料摘录间隔…]\n'),
    totalCharacters: source.length,
    includedRanges: ranges,
    truncated: true,
  };
}
