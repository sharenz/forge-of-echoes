// Player debuffs on the HUD (GAME_SPEC §13) and the per-map bestiary names (§14): src/ui/lib/debuffs.ts and the
// monster name tables in src/ui/lib/content.ts.
import { describe, expect, it } from 'vitest';
import { NEW_MONSTER_KINDS, PLAYER_DEBUFFS, THEME_ROSTER } from '../../src/contracts/bestiary';
import { MAP_BASE_IDS, MONSTER_KINDS, type MonsterKind } from '../../src/contracts/content';
import { MAP_AFFLICTIONS } from '../../src/data/progression/bestiary';
import { MONSTER_NAMES, eliteDisplayName, monsterTitle, rosterFor } from '../../src/ui/lib/content';
import {
  DEBUFF_INFO,
  MONSTER_DEBUFFS,
  counterplay,
  debuffElapsed,
  debuffEnding,
  debuffReapplied,
  debuffTimeText,
  debuffsEqual,
  sortDebuffs,
  waveDebuffs,
  type HudDebuff,
} from '../../src/ui/lib/debuffs';

const d = (id: HudDebuff['id'], remaining = 1, duration = 2, stacks = 1): HudDebuff => ({ id, remaining, duration, stacks });

describe('debuff texts', () => {
  it('explains every debuff with an effect and its counterplay', () => {
    for (const id of PLAYER_DEBUFFS) {
      const info = DEBUFF_INFO[id];
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.effect.length).toBeGreaterThan(10);
      expect(info.counter.length).toBeGreaterThan(10);
    }
  });

  it('follows GAME_SPEC §13: hard control, stacks and counters', () => {
    expect(PLAYER_DEBUFFS.filter((id) => DEBUFF_INFO[id].control)).toEqual(['frozen', 'rooted']);
    expect(DEBUFF_INFO.bleeding.maxStacks).toBe(3);
    expect(DEBUFF_INFO.withered.maxStacks).toBe(3);
    expect(DEBUFF_INFO.chilled.maxStacks).toBe(1);
    expect(DEBUFF_INFO.rooted.counter).toMatch(/Rift Step/);
    expect(DEBUFF_INFO.burning.counter).toMatch(/Life flask/);
    expect(DEBUFF_INFO.withered.counter).toMatch(/Focus flask/);
  });
});

describe('debuff bar', () => {
  it('shows hard control first', () => {
    const order = sortDebuffs([d('burning'), d('bleeding'), d('rooted'), d('chilled'), d('frozen')]).map((x) => x.id);
    expect(order).toEqual(['frozen', 'rooted', 'chilled', 'bleeding', 'burning']);
  });

  it('leaves out debuffs this client does not know (a newer server)', () => {
    const unknown = { id: 'petrified', remaining: 1, duration: 2, stacks: 1 } as unknown as HudDebuff;
    expect(sortDebuffs([unknown, d('chilled')]).map((x) => x.id)).toEqual(['chilled']);
  });

  it('blinks only the end of a debuff, scaled to its length, and never hard control', () => {
    expect(debuffEnding(d('chilled', 0.5, 2))).toBe(true);
    expect(debuffEnding(d('chilled', 0.7, 2))).toBe(false);
    // A 1 s shock blinks for its last 0.3 s, not 60% of its life.
    expect(debuffEnding(d('shocked', 0.5, 1))).toBe(false);
    expect(debuffEnding(d('shocked', 0.25, 1))).toBe(true);
    expect(debuffEnding(d('frozen', 0.2, 0.8))).toBe(false);
    expect(debuffEnding(d('rooted', 0.2, 1.4))).toBe(false);
    expect(debuffEnding(d('burning', 0, 3))).toBe(false);
  });

  it('formats the timer and the sweep', () => {
    expect(debuffTimeText(1.44)).toBe('1.4s');
    expect(debuffTimeText(12.2)).toBe('13s');
    expect(debuffTimeText(0)).toBe('');
    expect(debuffElapsed(1, 4)).toBe(0.75);
    expect(debuffElapsed(5, 4)).toBe(0);
    expect(debuffElapsed(1, 0)).toBe(0);
  });

  it('pops on arrival, a new stack or a refreshed timer, not while ticking down', () => {
    expect(debuffReapplied(undefined, d('chilled'))).toBe(true);
    expect(debuffReapplied(d('chilled', 1.2), d('chilled', 1.1))).toBe(false);
    expect(debuffReapplied(d('chilled', 0.3), d('chilled', 2))).toBe(true);
    expect(debuffReapplied(d('bleeding', 3, 4, 1), d('bleeding', 3, 4, 2))).toBe(true);
  });

  it('re-renders at 0.1 s steps', () => {
    expect(debuffsEqual([d('chilled', 1.01)], [d('chilled', 1.04)])).toBe(true);
    expect(debuffsEqual([d('chilled', 1.01)], [d('chilled', 1.12)])).toBe(false);
    expect(debuffsEqual([d('chilled')], [d('chilled'), d('rooted')])).toBe(false);
    expect(debuffsEqual([d('bleeding', 1, 4, 1)], [d('bleeding', 1, 4, 2)])).toBe(false);
  });

  it('points at the deck slot that answers each debuff', () => {
    expect(counterplay([d('rooted')])).toEqual({ skills: ['riftStep'], flasks: [] });
    expect(counterplay([d('burning'), d('bleeding'), d('withered')]).flasks.sort()).toEqual(['focus', 'life']);
    expect(counterplay([d('chilled'), d('frozen'), d('shocked')])).toEqual({ skills: [], flasks: [] });
  });

  it('warns what a wave can bring', () => {
    for (const k of Object.keys(MONSTER_DEBUFFS)) expect(MONSTER_KINDS).toContain(k as MonsterKind);
    expect(waveDebuffs(['frostWeaver', 'glacialWisp', 'boneThrall'])).toEqual(['frozen', 'rooted', 'chilled']);
    expect(waveDebuffs(['pitHound', 'chainThrall', 'varkus'])).toEqual(['rooted', 'bleeding']);
    expect(waveDebuffs(['chainmaster'])).toEqual(['rooted', 'bleeding']);
    expect(waveDebuffs(['ashling'])).toEqual([]);
  });

  it('warns of exactly what each map base inflicts (the map device readout, data/progression/bestiary.ts)', () => {
    for (const base of MAP_BASE_IDS) {
      const r = THEME_ROSTER[base];
      const brings = waveDebuffs([...r.family, r.lieutenant, r.boss]);
      expect(new Set(brings)).toEqual(new Set(MAP_AFFLICTIONS[base].map((a) => a.debuff)));
    }
  });
});

describe('bestiary names', () => {
  it('names every monster kind, singular and plural', () => {
    for (const k of MONSTER_KINDS) {
      expect(MONSTER_NAMES[k].one.length).toBeGreaterThan(0);
      expect(MONSTER_NAMES[k].many.length).toBeGreaterThan(0);
    }
    for (const k of NEW_MONSTER_KINDS) expect(MONSTER_NAMES[k]).toBeDefined();
    expect(MONSTER_NAMES.ironCrossbowman.many).toBe('Iron Crossbowmen');
  });

  it('gives each map base its own lieutenant and boss, with a title', () => {
    for (const base of MAP_BASE_IDS) {
      const r = rosterFor(base);
      expect(r).toEqual({ lieutenant: THEME_ROSTER[base].lieutenant, boss: THEME_ROSTER[base].boss });
      expect(MONSTER_NAMES[r.lieutenant].title).toBeDefined();
      expect(MONSTER_NAMES[r.boss].title).toBeDefined();
    }
    expect(monsterTitle('hollowWarden')).toBe('The Hollow Warden');
    expect(monsterTitle('varkus')).toBe('Varkus, the Iron Champion');
    expect(monsterTitle('boneThrall')).toBe('Bone Thrall');
  });

  it('falls back to the families, then to the Ashen Forge', () => {
    expect(rosterFor(null, ['pitHound', 'tarSlinger']).boss).toBe('varkus');
    expect(rosterFor(undefined, ['rimeshade']).lieutenant).toBe('boneChorister');
    expect(rosterFor(null, []).boss).toBe('cinderMatriarch');
  });

  it('shows elite bars by their full title, whatever form the name arrives in', () => {
    expect(eliteDisplayName('hollowWarden')).toBe('The Hollow Warden');
    expect(eliteDisplayName('Varkus')).toBe('Varkus, the Iron Champion');
    expect(eliteDisplayName('The Chainmaster')).toBe('The Chainmaster');
    expect(eliteDisplayName('Cinder Matriarch')).toBe('The Cinder Matriarch');
    expect(eliteDisplayName('Bone Chorister')).toBe('The Bone Chorister');
    expect(eliteDisplayName('Some Echo Boss')).toBe('Some Echo Boss');
  });
});

// The UI may not import src/sim (it reads contracts only), so the tooltip text spells the numbers out; this keeps it
// honest when the sim's tuning moves (ROOT_GRACE went from 1.5 s to 3 s in the balance pass and the card lagged behind).
describe('debuff card numbers match the sim', () => {
  it('effect texts quote the current tuning', async () => {
    const c = await import('../../src/sim/constants');
    const pct = (f: number) => `${Math.round(f * 100)}%`;
    const secs = (s: number) => `${s} second${s === 1 ? '' : 's'}`;
    expect(DEBUFF_INFO.chilled.effect).toContain(`${pct(c.PLAYER_CHILL_SLOW)} slower`);
    expect(DEBUFF_INFO.frozen.effect).toContain(`cannot be frozen for ${secs(c.FREEZE_IMMUNITY)}`);
    expect(DEBUFF_INFO.rooted.effect).toContain(`no root can hold you for ${secs(c.ROOT_GRACE)}`);
    expect(DEBUFF_INFO.burning.effect).toContain(`${pct(c.BURN_FRACTION)} of the hit`);
    expect(DEBUFF_INFO.bleeding.effect).toContain(`${pct(c.BLEED_FRACTION)} of the hit`);
    expect(DEBUFF_INFO.bleeding.maxStacks).toBe(c.BLEED_MAX_STACKS);
    expect(DEBUFF_INFO.shocked.effect).toContain(`${pct(c.PLAYER_SHOCK_BONUS)} more damage`);
    expect(DEBUFF_INFO.withered.effect).toContain(`−${pct(c.WITHER_RES_PER_STACK)}`);
    expect(DEBUFF_INFO.withered.maxStacks).toBe(c.WITHER_MAX_STACKS);
  });
});
