// Stream flankers (roadmap 4: standing still is not a strategy): from wave 3 every third stream group comes from BEHIND the player,
// the side opposite the hunters already on her, announced by a 'flank' event the moment it spawns.
import { describe, expect, it } from 'vitest';
import { SIM_DT, type SimEvent } from '../../src/contracts/sim';
import { FLANK_EVERY, FLANK_FROM_WAVE, PRESSURE_RADIUS, VIEW_HALF_H, VIEW_HALF_W } from '../../src/sim/constants';
import { idleIntent, makeSolo, makeStats } from './fixtures';
import { ofType, stepWith } from './helpers';

const sturdy = () => makeStats({ maxLife: 1e9, evasion: 0 });

interface Group {
  wave: number;
  tick: number;
  spawns: { x: number; y: number }[];
  flank: Extract<SimEvent, { t: 'flank' }> | null;
  px: number;
  py: number;
  /** Bearing from the player to the hunters already near her just before the group arrived (NaN: none). */
  threat: number;
}

function record(seed: number, seconds: number): Group[] {
  const { run, world } = makeSolo({ seed, stats: sturdy(), waves: { baseMonsters: 90, waveDuration: 40 } });
  const groups: Group[] = [];
  for (let t = 0; t < Math.round(seconds / SIM_DT); t++) {
    // The hunters' bearing as the director sees it on this tick (before it spawns anything).
    const p = world.players[0];
    const m = world.monsters;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < m.hwm; i++) {
      if (!m.alive[i] || (m.pack[i] >= 0 && !world.packs[m.pack[i]].aggro)) continue;
      const dx = m.x[i] - p.x;
      const dy = m.y[i] - p.y;
      const d = Math.hypot(dx, dy);
      if (d > PRESSURE_RADIUS || d < 1) continue;
      sx += dx / d;
      sy += dy / d;
    }
    const threat = sx * sx + sy * sy > 1e-6 ? Math.atan2(sy, sx) : Number.NaN;
    stepWith(run, idleIntent());
    const evs = run.drainEvents();
    const started = run.drainOutcomes().some((o) => o.t === 'waveStart');
    const spawns = ofType(evs, 'monsterSpawn');
    if (started || spawns.length === 0) continue; // a wave's packs arrive with its start
    groups.push({ wave: world.director.stream.wave, tick: t, spawns: spawns.map((e) => ({ x: e.x, y: e.y })), flank: ofType(evs, 'flank')[0] ?? null, px: p.x, py: p.y, threat });
  }
  return groups;
}

const angle = (x: number, y: number): number => Math.atan2(y, x);
const diff = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('stream flankers', () => {
  const groups = record(31, 110);

  it('waves 1 and 2 never flank; from wave 3 flankers arrive, never more often than every third group', () => {
    expect(groups.filter((g) => g.wave < FLANK_FROM_WAVE).every((g) => g.flank === null)).toBe(true);
    const later = groups.filter((g) => g.wave >= FLANK_FROM_WAVE);
    const flanks = later.filter((g) => g.flank);
    expect(flanks.length).toBeGreaterThan(0);
    expect(flanks.length).toBeLessThanOrEqual(Math.ceil(later.length / FLANK_EVERY));
  });

  it('a flank comes from behind: opposite (or beside) the hunters already on her, off-screen, where the warning points', () => {
    for (const g of groups.filter((q) => q.flank)) {
      const f = g.flank!;
      const fa = angle(f.x - g.px, f.y - g.py);
      expect(Number.isNaN(g.threat)).toBe(false);
      // Behind (about pi from the hunters) or at least at her side (pi / 2), never into her face.
      expect(diff(fa, g.threat)).toBeGreaterThan(Math.PI / 2 - 0.5);
      for (const s of g.spawns) {
        expect(diff(angle(s.x - g.px, s.y - g.py), fa)).toBeLessThan(1.0);
        const off = Math.abs(s.x - g.px) >= VIEW_HALF_W || Math.abs(s.y - g.py) >= VIEW_HALF_H;
        const atEdge = Math.hypot(s.x, s.y) >= 900 - 31;
        expect(off || atEdge).toBe(true);
      }
    }
  });

  it('is deterministic: the same seed sends the same flankers', () => {
    const again = record(31, 110);
    expect(again.map((g) => [g.tick, g.flank?.x ?? null])).toEqual(groups.map((g) => [g.tick, g.flank?.x ?? null]));
  }, 30000);
});
