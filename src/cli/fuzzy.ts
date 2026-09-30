// Tiny fuzzy matcher for the interactive pickers: every whitespace-separated term must match the haystack,
// either as a substring (best) or as an in-order subsequence. Lower score = better; null = no match.
export function fuzzyScore(query: string, haystack: string): number | null {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const h = haystack.toLowerCase();
  let total = 0;
  for (const term of terms) {
    const at = h.indexOf(term);
    if (at >= 0) {
      const wordStart = at === 0 || /[\s/_\-]/.test(h[at - 1]);
      total += (wordStart ? 0 : 10) + at * 0.01;
      continue;
    }
    let pos = -1, gaps = 0;
    for (const ch of term) {
      const next = h.indexOf(ch, pos + 1);
      if (next < 0) return null;
      if (pos >= 0) gaps += next - pos - 1;
      pos = next;
    }
    if (gaps > term.length) return null; // scattered letters are noise, not a match
    total += 100 + gaps;
  }
  return total;
}

export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  if (!query.trim()) return items.slice();
  return items
    .map((item, i) => ({ item, i, score: fuzzyScore(query, text(item)) }))
    .filter((x): x is { item: T; i: number; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((x) => x.item);
}
