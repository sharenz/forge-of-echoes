// The per-skill power budget of docs/power-rework/skills.md 2 as a table test for roster batch 1 (SK2). Single-target DPS index =
// e10 × hits on one target / max(cast time, cooldown per charge), divided by Ember Lance's 2.3 / 0.42; Focus per second when
// spammed = cost / that interval. Hits on one target come from the rules' own estimate (ResolvedSkill.singleTargetHits: every
// Frost Orb shard, Storm Call's expected share of its scattered strikes), except Spark, whose fan is budgeted at 2 of its sparks
// on one enemy (skills.md: the spam band assumes part of a fan connects).
import { describe, expect, it } from 'vitest';
import type { SkillId } from '../../src/contracts/content';
import { SKILLS } from '../../src/data/progression';
import { buildPlayerModel } from '../../src/game/progression/model';
import { resolveSkill } from '../../src/game/progression/skills';
import { bareCharacter } from './fixtures';

const LANCE_INDEX = 2.3 / 0.42;

type Band = 'spam' | 'area' | 'utility';
const BANDS: Record<Exclude<Band, 'utility'>, { index: [number, number]; focus: [number, number] }> = {
  spam: { index: [1.2, 2.2], focus: [15, 27] },
  area: { index: [0.2, 0.5], focus: [3, 8] },
};

const ROWS: readonly { id: SkillId; band: Band; hits?: number }[] = [
  { id: 'phaseStride', band: 'utility' },
  { id: 'glacialNova', band: 'area' },
  { id: 'spark', band: 'spam', hits: 2 },
  { id: 'cinderMortar', band: 'area' },
  { id: 'arcaneReprieve', band: 'utility' },
  { id: 'umbralBolt', band: 'spam' },
  { id: 'kineticLance', band: 'spam' },
  { id: 'frostOrb', band: 'area' },
  { id: 'stormCall', band: 'area' },
  { id: 'glacialSpikes', band: 'area' },
];

describe('skill power budget (skills.md 2), roster batch 1 at rank 10 without gear', () => {
  const model = buildPlayerModel(bareCharacter({ level: 40 }));

  it.each(ROWS)('$id sits in its band', ({ id, band, hits }) => {
    const r = resolveSkill(model, id, 10);
    expect(SKILLS[id].available).toBe(true);
    if (band === 'utility') {
      expect(r.runtime.damage).toBe(0);
      expect(r.dps).toBeNull();
      return;
    }
    const interval = Math.max(r.runtime.castTime, r.runtime.cooldown / r.runtime.charges);
    expect(interval).toBeCloseTo(r.interval, 10);
    const index = (r.effectiveness * (hits ?? r.singleTargetHits)) / interval / LANCE_INDEX;
    const focus = r.runtime.focusCost / interval;
    const b = BANDS[band];
    expect(index, `${id} index`).toBeGreaterThanOrEqual(b.index[0] - 1e-9);
    expect(index, `${id} index`).toBeLessThanOrEqual(b.index[1] + 1e-9);
    expect(focus, `${id} Focus/s`).toBeGreaterThanOrEqual(b.focus[0] - 1e-9);
    expect(focus, `${id} Focus/s`).toBeLessThanOrEqual(b.focus[1] + 1e-9);
  });

  it('pins the indices skills.md quotes (Umbral Bolt 2.2, Kinetic Lance 1.4, Mortar 0.44)', () => {
    const idx = (id: SkillId) => {
      const r = resolveSkill(model, id, 10);
      return (r.effectiveness * r.singleTargetHits) / r.interval / LANCE_INDEX;
    };
    expect(idx('umbralBolt')).toBeCloseTo(2.19, 2);
    expect(idx('kineticLance')).toBeCloseTo(1.44, 2);
    expect(idx('cinderMortar')).toBeCloseTo(0.44, 2);
  });

  it('a spammed Umbral Bolt is sustained about 43% of the time at the good band ML28 (regen 10.4/s)', () => {
    const r = resolveSkill(model, 'umbralBolt', 10);
    expect(10.4 / (r.runtime.focusCost / r.interval)).toBeCloseTo(0.43, 2);
  });
});

// Roster batch 2 (SK3). Area skills sit in the area band. Immolation Sigil is a burst: skills.md's "1.0 to 1.3 averaged over the
// cooldown" cannot be read with this index (6.5 / 6 s / 5.48 = 0.2), so the table pins what a burst means here: one cast lands
// 2.5 to 3.5 Ember Lance hits at once, at 2 to 4 Focus per second. Static Lash is the spam skill skills.md quotes at 0.85 (below
// the band: a held, self-aiming beam). Zones and defences that deal damage on the side (Gravity Well, Wither Field, Static Aegis)
// are control: a low index and cheap per second.
const ROWS2: readonly { id: SkillId; band: Band | 'burst' | 'control' | 'lash' }[] = [
  { id: 'gravityWell', band: 'control' },
  { id: 'rimeBulwark', band: 'utility' },
  { id: 'immolationSigil', band: 'burst' },
  { id: 'staticAegis', band: 'control' },
  { id: 'voltaicPulse', band: 'area' },
  { id: 'entropyHex', band: 'utility' },
  { id: 'concussiveBlast', band: 'area' },
  { id: 'staticLash', band: 'lash' },
  { id: 'echoSigil', band: 'utility' },
  { id: 'witherField', band: 'control' },
];

describe('skill power budget (skills.md 2), roster batch 2 at rank 10 without gear', () => {
  const model = buildPlayerModel(bareCharacter({ level: 40 }));

  it.each(ROWS2)('$id sits in its band', ({ id, band }) => {
    const r = resolveSkill(model, id, 10);
    expect(SKILLS[id].available).toBe(true);
    if (band === 'utility') {
      expect(r.runtime.damage).toBe(0);
      expect(r.dps).toBeNull();
      return;
    }
    const interval = Math.max(r.runtime.castTime, r.runtime.cooldown / r.runtime.charges);
    expect(interval).toBeCloseTo(r.interval, 10);
    const index = (r.effectiveness * r.singleTargetHits) / interval / LANCE_INDEX;
    const focus = r.runtime.focusCost / interval;
    switch (band) {
      case 'burst':
        expect(r.effectiveness / 2.3, `${id} Lance hits per cast`).toBeGreaterThanOrEqual(2.5);
        expect(r.effectiveness / 2.3, `${id} Lance hits per cast`).toBeLessThanOrEqual(3.5);
        expect(focus).toBeGreaterThanOrEqual(2);
        expect(focus).toBeLessThanOrEqual(4);
        break;
      case 'control':
        expect(r.runtime.damage).toBeGreaterThan(0);
        expect(index, `${id} index`).toBeLessThan(0.2);
        expect(focus, `${id} Focus/s`).toBeLessThanOrEqual(8);
        break;
      case 'lash':
        expect(index).toBeCloseTo(0.85, 2);
        expect(focus).toBeGreaterThanOrEqual(BANDS.spam.focus[0]);
        expect(focus).toBeLessThanOrEqual(BANDS.spam.focus[1]);
        break;
      default: {
        const b = BANDS[band as 'area' | 'spam'];
        expect(index, `${id} index`).toBeGreaterThanOrEqual(b.index[0] - 1e-9);
        expect(index, `${id} index`).toBeLessThanOrEqual(b.index[1] + 1e-9);
        expect(focus, `${id} Focus/s`).toBeGreaterThanOrEqual(b.focus[0] - 1e-9);
        expect(focus, `${id} Focus/s`).toBeLessThanOrEqual(b.focus[1] + 1e-9);
      }
    }
  });
});

// Roster batch 3 (SK4). Meteor Rain is a burst like Immolation Sigil, counted as the meteors an enemy at the cursor expects (its
// share of the scattered rain): 2.5 to 3.5 Ember Lance hits per cast at 2 to 4 Focus per second. Event Horizon is the ultimate: one
// detonation of 6 to 8 Lance hits every 18 s at 2 to 4 Focus per second. Storm Step is a blink whose strikes sit in the area band.
// Tempest Surge's pulses are control (on the side of the cast speed). Blizzard deals area-band damage over 6 s for 2.2 Focus per
// second, under the area band's Focus (a zone placed once per cooldown).
const ROWS3: readonly { id: SkillId; band: 'burst' | 'ultimate' | 'area' | 'control' | 'zone' }[] = [
  { id: 'meteorRain', band: 'burst' },
  { id: 'stormStep', band: 'area' },
  { id: 'tempestSurge', band: 'control' },
  { id: 'blizzard', band: 'zone' },
  { id: 'eventHorizon', band: 'ultimate' },
];

describe('skill power budget (skills.md 2), roster batch 3 at rank 10 without gear', () => {
  const model = buildPlayerModel(bareCharacter({ level: 62 }));

  it.each(ROWS3)('$id sits in its band', ({ id, band }) => {
    const r = resolveSkill(model, id, 10);
    expect(SKILLS[id].available).toBe(true);
    const interval = Math.max(r.runtime.castTime, r.runtime.cooldown / r.runtime.charges);
    expect(interval).toBeCloseTo(r.interval, 10);
    const index = (r.effectiveness * r.singleTargetHits) / interval / LANCE_INDEX;
    const focus = r.runtime.focusCost / interval;
    const lanceHits = (r.effectiveness * r.singleTargetHits) / 2.3;
    const area = BANDS.area;
    switch (band) {
      case 'burst':
      case 'ultimate': {
        const [lo, hi] = band === 'burst' ? [2.5, 3.5] : [6, 8];
        expect(lanceHits, `${id} Lance hits per cast`).toBeGreaterThanOrEqual(lo);
        expect(lanceHits, `${id} Lance hits per cast`).toBeLessThanOrEqual(hi);
        expect(focus).toBeGreaterThanOrEqual(2);
        expect(focus).toBeLessThanOrEqual(4);
        break;
      }
      case 'control':
        expect(r.runtime.damage).toBeGreaterThan(0);
        expect(index, `${id} index`).toBeLessThan(0.2);
        expect(focus, `${id} Focus/s`).toBeLessThanOrEqual(8);
        break;
      default:
        expect(index, `${id} index`).toBeGreaterThanOrEqual(area.index[0] - 1e-9);
        expect(index, `${id} index`).toBeLessThanOrEqual(area.index[1] + 1e-9);
        if (band === 'area') expect(focus, `${id} Focus/s`).toBeGreaterThanOrEqual(area.focus[0] - 1e-9);
        expect(focus, `${id} Focus/s`).toBeLessThanOrEqual(area.focus[1] + 1e-9);
    }
  });

  it('every one of the 32 skills is playable now', () => {
    expect(Object.values(SKILLS).every((s) => s.available)).toBe(true);
  });
});
