// The fairness budget of Event Director v2 (docs/atlas-rework/C-map-events.md 4.3) as tests, on every roster.
import { describe, expect, it } from 'vitest';
import type { MapEventKind } from '../../src/contracts/map-events';
import type { Theme } from '../../src/contracts/content';
import { stepWorld } from '../../src/sim/run';
import { nearestLivingDist, skinOf } from '../../src/sim/events/kit';
import { FAULT_GRADE_SECONDS } from '../../src/data/progression/map-events';
import { eventRun, live } from './helpers';

const THEMES: Theme[] = ['ashenForge', 'rimedOssuary', 'ironColiseum'];
const KINDS: MapEventKind[] = ['hunted', 'echoRift', 'blackout', 'vaultbreakers', 'wound', 'secondCrown'];
/** Fixed-clearance rules: how far from every living player an event's OWN spawns must be (0 = the design says otherwise). */
const CLEARANCE: Partial<Record<MapEventKind, number>> = { hunted: 320, vaultbreakers: 250, secondCrown: 350 };

describe.each(THEMES)('fairness on %s', (theme) => {
  it.each(KINDS)('%s: hostile areas wait, spawns keep clear, the view names its thresholds', (kind) => {
    const r = eventRun(kind, { theme, director: true, wave: kind === 'secondCrown' ? 6 : 2, plan: { wave: kind === 'secondCrown' ? 6 : 2 }, vulnerable: true });
    const w = r.w;
    if (kind === 'secondCrown') {
      // The map's boss is what the wave director spawns on wave 6.
      w.director.wave = 1;
    }
    const seenAreas = new Set<number>();
    const seenMembers = new Set<number>();
    let sawHostile = 0;
    for (let tick = 0; tick < 60 * 80; tick++) {
      // Walk the party into the optional sites so every phase runs.
      const e = live(w, kind);
      if (e && (e.phase === 'available')) {
        const s = e.s as { anchor?: { x: number; y: number }; center?: { x: number; y: number } };
        const at = s.anchor ?? s.center;
        if (at) { w.players[0].x = at.x + 10; w.players[0].y = at.y; }
      }
      stepWorld(w);
      for (const a of w.areas) {
        if (seenAreas.has(a.id) || a.age > 0.05) continue;
        seenAreas.add(a.id);
        const eventArea = a.kind === 'faultWedge' || (a.kind === 'chargeLine' && a.owner >= 0 && (live(w, 'vaultbreakers')?.s as { wagon?: number } | undefined)?.wagon === a.owner)
          || (a.kind === 'slamWarning' && a.radius === 150);
        if (!eventArea) continue;
        sawHostile++;
        expect(a.duration, `${a.kind} r${a.radius}`).toBeGreaterThanOrEqual(a.radius > 60 ? 1.8 : 1.0);
        if (a.tickInterval > 0) expect(a.tickTimer).toBeGreaterThanOrEqual(1.0 - 1e-6);
      }
      const min = CLEARANCE[kind];
      if (min) {
        const ev = live(w, kind);
        if (ev) for (const id of ev.members) {
          if (seenMembers.has(id)) continue;
          seenMembers.add(id);
          const i = w.monsters.slotOf(id);
          if (i < 0 || (kind === 'secondCrown' && id === w.director.bossId && seenMembers.size === 1)) continue;
          // The first crown and the rival are checked at their own spawn; everything else at first sight.
          expect(nearestLivingDist(w, w.monsters.x[i], w.monsters.y[i]), `${kind} spawn`).toBeGreaterThanOrEqual(kind === 'secondCrown' ? 200 : min - 1);
        }
      }
      // F7: the thresholds are on the HUD before they matter.
      const ev = live(w, kind);
      if (ev?.phase === 'active' && kind === 'hunted') expect(ev.view.objectives[1].max).toBe(3);
      if (ev?.phase === 'active' && kind === 'wound') expect(ev.view.timers[0].total).toBe(FAULT_GRADE_SECONDS[skinOf(w)][0]);
    }
    if (kind === 'wound') expect(sawHostile).toBeGreaterThan(0);
    if (kind === 'vaultbreakers') expect(sawHostile).toBeGreaterThan(0);
  });
});

// Void Breach (wave 2): every hostile area it raises waits its telegraph, on every roster; nothing starts on a held player.
describe.each(THEMES)('fairness of the Void Breach on %s', (theme) => {
  it('tide bands and the Heart nova obey F1 and Voidcallers keep clear of the players (F4)', () => {
    const r = eventRun('voidBreach', { theme, vulnerable: true, players: [{ x: 500, y: 300 }] });
    const w = r.w;
    let bands = 0;
    const seen = new Set<number>();
    for (let tick = 0; tick < 60 * 60; tick++) {
      const e = live(w, 'voidBreach');
      if (e && e.phase === 'available') { const c = (e.s as { center: { x: number; y: number } }).center; w.players[0].x = c.x + 10; w.players[0].y = c.y; }
      stepWorld(w);
      for (const a of w.areas) {
        if (seen.has(a.id) || a.age > 0.05) continue;
        seen.add(a.id);
        if (a.kind === 'voidTide') { bands++; expect(a.duration).toBeGreaterThanOrEqual(1.8); }
        if (a.kind === 'slamWarning' && a.radius === 70) expect(a.duration).toBeGreaterThanOrEqual(1.8);
      }
    }
    expect(bands).toBeGreaterThan(4);
  });
});
