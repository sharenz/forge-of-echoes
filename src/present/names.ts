// Display names for monsters (pure). Rare leaders are named after their two elite mods, e.g. a Juggernaut +
// Frenzied ashling is the "Frenzied Juggernaut Ashling" (adjectives ordered from the highest mod bit down, so a
// given mod pair always reads the same way).
import { MONSTER_KINDS, type MonsterKind } from '../contracts/content';
import { ELITE_BIT, RARITY_CODE } from '../contracts/sim';

export const MONSTER_NAMES: Record<MonsterKind, string> = {
  ashling: 'Ashling',
  emberSkitter: 'Ember Skitter',
  cinderSpitter: 'Cinder Spitter',
  riftStalker: 'Rift Stalker',
  ironhideBrute: 'Ironhide Brute',
  ashboundHerald: 'Ashbound Herald',
  cinderMatriarch: 'Cinder Matriarch',
  trainingDummy: 'Training Dummy',
};

/** Elite mod adjectives, highest bit first. */
const MOD_WORDS: readonly (readonly [number, string])[] = [
  [ELITE_BIT.warded, 'Warded'],
  [ELITE_BIT.emberTouched, 'Ember-touched'],
  [ELITE_BIT.frenzied, 'Frenzied'],
  [ELITE_BIT.juggernaut, 'Juggernaut'],
  [ELITE_BIT.fierce, 'Fierce'],
  [ELITE_BIT.stout, 'Stout'],
  [ELITE_BIT.swift, 'Swift'],
];

/** "Frenzied Juggernaut Ashling" from a kind and an ELITE_BIT mask (no mods → the plain kind name). */
export function eliteName(kind: MonsterKind, mods: number): string {
  let out = '';
  for (const [bit, word] of MOD_WORDS) {
    if ((mods & bit) === 0) continue;
    out += out ? ` ${word}` : word;
  }
  const base = MONSTER_NAMES[kind] ?? kind;
  return out ? `${out} ${base}` : base;
}

/**
 * Cache of rare names keyed by (kind index, mods) so the per-frame draw never builds strings.
 * Lieutenants and bosses use their proper names.
 */
export class MonsterNameCache {
  private readonly cache = new Map<number, string>();

  name(kindIndex: number, rarity: number, mods: number): string {
    const kind = MONSTER_KINDS[kindIndex] ?? 'ashling';
    if (rarity === RARITY_CODE.lieutenant || rarity === RARITY_CODE.boss) return MONSTER_NAMES[kind];
    const key = (kindIndex << 8) | (mods & 255);
    let s = this.cache.get(key);
    if (s === undefined) {
      s = eliteName(kind, mods);
      this.cache.set(key, s);
    }
    return s;
  }
}
