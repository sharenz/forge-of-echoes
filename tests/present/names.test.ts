import { describe, expect, it } from 'vitest';
import { MONSTER_KINDS } from '../../src/contracts/content';
import { ELITE_BIT, RARITY_CODE } from '../../src/contracts/sim';
import { MonsterNameCache, eliteName } from '../../src/present/names';

describe('eliteName', () => {
  it('names a rare leader after its two mods, highest bit first', () => {
    expect(eliteName('ashling', ELITE_BIT.juggernaut | ELITE_BIT.frenzied)).toBe('Frenzied Juggernaut Ashling');
    expect(eliteName('ironhideBrute', ELITE_BIT.warded | ELITE_BIT.emberTouched)).toBe('Warded Ember-touched Ironhide Brute');
    expect(eliteName('riftStalker', ELITE_BIT.juggernaut | ELITE_BIT.warded)).toBe('Warded Juggernaut Rift Stalker');
  });

  it('is independent of how the mask was built (same pair, same name)', () => {
    const a = eliteName('emberSkitter', ELITE_BIT.frenzied | ELITE_BIT.emberTouched);
    const b = eliteName('emberSkitter', ELITE_BIT.emberTouched | ELITE_BIT.frenzied);
    expect(a).toBe(b);
    expect(a).toBe('Ember-touched Frenzied Ember Skitter');
  });

  it('falls back to the plain name without mods and handles magic mods', () => {
    expect(eliteName('cinderSpitter', 0)).toBe('Cinder Spitter');
    expect(eliteName('ashling', ELITE_BIT.swift)).toBe('Swift Ashling');
  });
});

describe('MonsterNameCache', () => {
  it('gives lieutenants and bosses their proper names and caches rare names', () => {
    const cache = new MonsterNameCache();
    const herald = MONSTER_KINDS.indexOf('ashboundHerald');
    const boss = MONSTER_KINDS.indexOf('cinderMatriarch');
    const ashling = MONSTER_KINDS.indexOf('ashling');
    expect(cache.name(herald, RARITY_CODE.lieutenant, 0)).toBe('Ashbound Herald');
    expect(cache.name(boss, RARITY_CODE.boss, ELITE_BIT.juggernaut)).toBe('Cinder Matriarch');
    const mods = ELITE_BIT.juggernaut | ELITE_BIT.frenzied;
    const first = cache.name(ashling, RARITY_CODE.rare, mods);
    expect(first).toBe('Frenzied Juggernaut Ashling');
    // Same string instance on repeat: the per-frame draw never rebuilds it.
    expect(cache.name(ashling, RARITY_CODE.rare, mods)).toBe(first);
  });
});
