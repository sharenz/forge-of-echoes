import { describe, expect, it } from 'vitest';
import type { ItemClass } from '../../src/contracts/content';
import { AFFIXES, BASES } from '../../src/data/items';
import { affixCandidates } from '../../src/game/items';

const SLOTS: ItemClass[] = ['helmet', 'chest', 'gloves', 'boots', 'belt'];
const hasArmour = (id: keyof typeof BASES) => BASES[id].properties.some((p) => p.stat === 'armor');

describe('armour economy', () => {
  it('offers armour-capable bases for every armour slot, including at low level', () => {
    for (const cls of SLOTS) {
      const bases = Object.values(BASES).filter((b) => b.itemClass === cls && b.properties.some((p) => p.stat === 'armor'));
      expect(bases.length, cls).toBeGreaterThan(0);
      expect(Math.min(...bases.map((b) => b.levelRequirement)), cls).toBeLessThanOrEqual(10);
    }
  });

  it('keeps evasion-focused caster bases and adds hybrids', () => {
    expect(hasArmour('ashenRobe')).toBe(false);
    expect(hasArmour('wardedVestment')).toBe(true);
    for (const id of ['scaleCowl', 'quiltedJerkin', 'studdedGloves'] as const) {
      expect(BASES[id].properties.map((p) => p.stat).sort(), id).toEqual(['armor', 'evasion']);
    }
  });

  it('rolls flat and % armour on armour bases (belts included) but not on pure-evasion bases', () => {
    const ids = (b: keyof typeof BASES) => new Set(affixCandidates(BASES[b], 60).map((c) => c.affix.id));
    for (const b of ['scaleCowl', 'wardedVestment', 'ironshodBoots', 'studdedBelt'] as const) {
      expect(ids(b).has('armourFlat'), b).toBe(true);
      expect(ids(b).has('armourPercent'), b).toBe(true);
    }
    expect(ids('ashenRobe').has('armourFlat')).toBe(false);
    expect(ids('chainBelt').has('armourFlat')).toBe(false);
  });

  it('keeps legacy affix ids valid', () => {
    for (const id of ['armourFlat', 'armourPercent', 'evasionFlat', 'evasionPercent']) {
      expect(AFFIXES.some((a) => a.id === id)).toBe(true);
    }
  });
});
