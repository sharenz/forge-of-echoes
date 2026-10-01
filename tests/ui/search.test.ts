// Stash search (GAME_SPEC §12): the query parser and matcher in src/ui/lib/search.ts, on hand-made documents and on
// real items described by the shared rules.
import { describe, expect, it } from 'vitest';
import type { CurrencyStack, EquipmentItem, Item, ItemDescription, MapItem } from '../../src/contracts/items';
import { rules } from '../../src/game';
import {
  isSearchActive,
  matchesSearch,
  normalizeSearchText,
  parseSearchQuery,
  searchDoc,
  type SearchDoc,
} from '../../src/ui/lib/search';

/** A document with one field per line, normalised like searchDoc does. */
const doc = (text: string, rarity: SearchDoc['rarity'] = null): SearchDoc => ({
  text: text.split('\n').map(normalizeSearchText).join('\n'),
  rarity,
});
const hit = (query: string, d: SearchDoc): boolean => matchesSearch(parseSearchQuery(query), d);

describe('search query parser', () => {
  it('splits terms, keeps quoted phrases whole and reads alternatives and negation', () => {
    expect(parseSearchQuery('life  fire').clauses).toEqual([
      { any: [{ kind: 'text', text: 'life' }], negate: false },
      { any: [{ kind: 'text', text: 'fire' }], negate: false },
    ]);
    expect(parseSearchQuery('"fire damage" ring|amulet !"of ash"').clauses).toEqual([
      { any: [{ kind: 'text', text: 'fire damage' }], negate: false },
      { any: [{ kind: 'text', text: 'ring' }, { kind: 'text', text: 'amulet' }], negate: false },
      { any: [{ kind: 'text', text: 'of ash' }], negate: true },
    ]);
  });

  it('reads bare rarity words as rarity, quoted ones as text', () => {
    expect(parseSearchQuery('Rare').clauses[0].any).toEqual([{ kind: 'rarity', rarity: 'rare' }]);
    expect(parseSearchQuery('!normal').clauses[0]).toEqual({ any: [{ kind: 'rarity', rarity: 'normal' }], negate: true });
    expect(parseSearchQuery('"rare"').clauses[0].any).toEqual([{ kind: 'text', text: 'rare' }]);
    expect(parseSearchQuery('magic|unique').clauses[0].any).toEqual([
      { kind: 'rarity', rarity: 'magic' },
      { kind: 'rarity', rarity: 'unique' },
    ]);
  });

  it('ignores noise: empty input, lone operators, empty alternatives, unterminated quotes', () => {
    expect(isSearchActive(parseSearchQuery(''))).toBe(false);
    expect(isSearchActive(parseSearchQuery('   '))).toBe(false);
    expect(isSearchActive(parseSearchQuery('! | "" !"'))).toBe(false);
    expect(parseSearchQuery('a||b|').clauses[0].any).toEqual([
      { kind: 'text', text: 'a' },
      { kind: 'text', text: 'b' },
    ]);
    expect(parseSearchQuery('"fire dam').clauses).toEqual([{ any: [{ kind: 'text', text: 'fire dam' }], negate: false }]);
  });

  it('normalises case, dashes, typographic quotes and whitespace', () => {
    expect(normalizeSearchText('  Fire–Cold  Ring ')).toBe('fire-cold ring');
    expect(parseSearchQuery('“Fire  Damage”').clauses[0].any).toEqual([{ kind: 'text', text: 'fire damage' }]);
    expect(hit('12-18', doc('Adds (12–18) fire damage'))).toBe(true);
  });
});

describe('search matching', () => {
  const wand = doc('Ember Bite\nAshwood Wand\nWand\n+14% increased Fire Damage\nBlazing\nfire caster', 'rare');
  const ring = doc('Storm Loop\nRing\n+18% to Lightning Resistance', 'magic');

  it('needs every term (AND), any alternative, and no negated term', () => {
    expect(hit('fire wand', wand)).toBe(true);
    expect(hit('fire ring', wand)).toBe(false);
    expect(hit('ring|wand', wand)).toBe(true);
    expect(hit('ring|wand', ring)).toBe(true);
    expect(hit('wand !fire', wand)).toBe(false);
    expect(hit('!fire', ring)).toBe(true);
    expect(hit('!ring|wand', ring)).toBe(false);
  });

  it('matches phrases as a whole and never across fields', () => {
    expect(hit('"fire damage"', wand)).toBe(true);
    expect(hit('"damage fire"', wand)).toBe(false);
    // "Wand" then "+14%" are separate lines: a phrase cannot bridge them.
    expect(hit('"wand +14"', wand)).toBe(false);
  });

  it('matches rarity words against the rarity only', () => {
    expect(hit('rare', wand)).toBe(true);
    expect(hit('rare', ring)).toBe(false);
    expect(hit('rare', doc('Reforging Ember\nRerolls the item into a new rare item'))).toBe(false);
    expect(hit('"rare"', doc('Reforging Ember\nRerolls the item into a new rare item'))).toBe(true);
    expect(hit('!normal', ring)).toBe(true);
  });

  it('an inactive query matches nothing', () => {
    expect(matchesSearch(parseSearchQuery(''), wand)).toBe(false);
  });
});

describe('search documents from the rules', () => {
  const ch = rules.createCharacter('Tester', 1);
  const describe_ = (item: Item): ItemDescription => rules.describeItem(item, ch);
  const find = (pred: (i: Item) => boolean): Item => {
    const all: Item[] = [...ch.backpack.entries.map((e) => e.item), ...Object.values(ch.equipment)] as Item[];
    const it = all.find(pred);
    if (!it) throw new Error('starting kit item missing');
    return it;
  };

  it('covers names, classes, affix texts and names, tags and rarity', () => {
    const wand = find((i) => i.kind === 'equipment' && i.baseId === 'ashwoodWand') as EquipmentItem;
    const d = searchDoc(wand, describe_(wand));
    expect(d.rarity).toBe(wand.rarity);
    expect(d.text).toContain('ashwood wand');
    expect(d.text).toContain('wand');
    expect(hit('fire', d)).toBe(true);
    expect(hit(`${wand.rarity} wand`, d)).toBe(true);
    expect(hit('!wand', d)).toBe(false);
  });

  it('finds currency by name and description, maps by name and tier', () => {
    const scrap = find((i) => i.kind === 'currency' && i.currencyId === 'scrap') as CurrencyStack;
    const sd = searchDoc(scrap, describe_(scrap));
    expect(sd.rarity).toBeNull();
    expect(hit('scrap', sd)).toBe(true);
    expect(hit('currency', sd)).toBe(true);
    expect(hit('rare', sd)).toBe(false);

    const map = find((i) => i.kind === 'map') as MapItem;
    const md = searchDoc(map, describe_(map));
    expect(md.rarity).toBe(map.rarity);
    expect(hit('map', md)).toBe(true);
    expect(hit(`"tier ${map.tier}"`, md)).toBe(true);
  });

  it('marks crafted, sealed and fractured lines and corrupted maps with their words', () => {
    const wand = find((i) => i.kind === 'equipment' && i.baseId === 'ashwoodWand') as EquipmentItem;
    expect(wand.affixes.length).toBeGreaterThan(0);
    const crafted = { ...wand, affixes: wand.affixes.map((a, i) => (i === 0 ? { ...a, crafted: true, sealed: true } : a)) };
    const cd = searchDoc(crafted, describe_(crafted));
    expect(hit('crafted', cd)).toBe(true);
    expect(hit('sealed', cd)).toBe(true);
    expect(hit('fractured', cd)).toBe(false);

    const map = find((i) => i.kind === 'map') as MapItem;
    const corrupted = { ...map, corrupted: true };
    expect(hit('corrupted', searchDoc(corrupted, describe_(corrupted)))).toBe(true);
  });
});
