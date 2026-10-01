// Stash search (GAME_SPEC §12): a small query language over what the rules say about an item. Pure; covered by
// tests/ui/search.test.ts.
//
//   life fire            every term must match (AND)
//   "fire damage"        a quoted phrase matches as a whole
//   ring|amulet          either alternative matches
//   !normal  !"of ash"   the item must NOT match the term (a negated a|b excludes both)
//   rare magic unique normal
//                        a bare rarity word matches the item's rarity, not text that happens to contain it
//                        ("rare" does not light up a Reforging Ember that "makes a new rare item")
//
// Matching is case-insensitive substring search over the item's searchable text: name, base type, class, header
// lines, properties, implicit / affix / scar texts, affix names, tags, currency / map / flask descriptions, and
// state words (crafted, sealed, fractured, corrupted, scarred).
import type { Item, ItemDescription, Rarity, TooltipLine } from '../../contracts/items';

export type SearchTerm = { kind: 'text'; text: string } | { kind: 'rarity'; rarity: Rarity };

export interface SearchClause {
  /** At least one must match (none, when negated). */
  any: SearchTerm[];
  negate: boolean;
}

export interface SearchQuery {
  clauses: SearchClause[];
}

/** What a query is matched against: normalised text (one field per line) and the rarity, if the item has one. */
export interface SearchDoc {
  text: string;
  rarity: Rarity | null;
}

export const RARITY_WORDS: readonly Rarity[] = ['normal', 'magic', 'rare', 'unique'];

/** Lower-case, one kind of dash and apostrophe, single spaces. Applied to both the query and the item text. */
export function normalizeSearchText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split on `sep` outside double quotes. */
function splitOutsideQuotes(s: string, isSep: (ch: string) => boolean): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') {
      quoted = !quoted;
      cur += ch;
    } else if (!quoted && isSep(ch)) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseTerm(raw: string): SearchTerm | null {
  const quoted = raw.includes('"');
  const text = normalizeSearchText(raw.replace(/"/g, ' '));
  if (!text) return null;
  if (!quoted && (RARITY_WORDS as readonly string[]).includes(text)) return { kind: 'rarity', rarity: text as Rarity };
  return { kind: 'text', text };
}

/** Parse a search box value. An empty (or all-noise) query has no clauses: nothing is highlighted. */
export function parseSearchQuery(input: string): SearchQuery {
  // Typographic quotes (macOS substitutions, pasted text) count as plain double quotes.
  const src = input.replace(/[“”„«»]/g, '"');
  const clauses: SearchClause[] = [];
  for (let token of splitOutsideQuotes(src, (ch) => /\s/.test(ch))) {
    let negate = false;
    while (token.startsWith('!')) {
      negate = true;
      token = token.slice(1);
    }
    const any: SearchTerm[] = [];
    for (const alt of splitOutsideQuotes(token, (ch) => ch === '|')) {
      const term = parseTerm(alt);
      if (term) any.push(term);
    }
    if (any.length) clauses.push({ any, negate });
  }
  return { clauses };
}

export function isSearchActive(q: SearchQuery): boolean {
  return q.clauses.length > 0;
}

function termMatches(t: SearchTerm, doc: SearchDoc): boolean {
  return t.kind === 'rarity' ? doc.rarity === t.rarity : doc.text.includes(t.text);
}

/** True when the item satisfies every clause. An inactive query matches nothing. */
export function matchesSearch(q: SearchQuery, doc: SearchDoc): boolean {
  if (!q.clauses.length) return false;
  for (const c of q.clauses) {
    const hit = c.any.some((t) => termMatches(t, doc));
    if (hit === c.negate) return false;
  }
  return true;
}

function lineFields(line: TooltipLine, out: string[]): void {
  out.push(line.text);
  if (line.affixName) out.push(line.affixName);
  if (line.tags?.length) out.push(line.tags.join(' '));
  if (line.crafted) out.push('crafted');
  if (line.sealed) out.push('sealed');
  if (line.fractured) out.push('fractured');
}

/** The searchable document of an item, built from its rules description. */
export function searchDoc(item: Item, desc: ItemDescription): SearchDoc {
  const fields: string[] = [desc.title, desc.classLabel, ...desc.headerLines];
  if (desc.subtitle) fields.push(desc.subtitle);
  for (const p of desc.properties) fields.push(`${p.label}: ${p.value}`);
  for (const l of desc.implicits) lineFields(l, fields);
  for (const l of desc.affixes) lineFields(l, fields);
  for (const l of desc.scars) lineFields(l, fields);
  if (desc.scars.length) fields.push('scarred');
  if (desc.description) fields.push(desc.description);
  if (desc.flavor) fields.push(desc.flavor);
  if (desc.corrupted || (item.kind === 'map' && item.corrupted)) fields.push('corrupted');
  const rarity: Rarity | null = item.kind === 'equipment' || item.kind === 'map' ? item.rarity : null;
  return { text: fields.map(normalizeSearchText).filter(Boolean).join('\n'), rarity };
}
