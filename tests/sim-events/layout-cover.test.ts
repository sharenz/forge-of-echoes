// Ranged monsters and cover, per hand-crafted area: a player who never shoots (an empty loadout, effectively unkillable) walks the
// bot's route through a live area while its monsters fire at her. A shot is WASTED when a TALL prop swallows it ('blocked' with
// `cover`) before it has flown as far as she stood from its shooter when it left (the brains check their line before they shoot,
// behaviour.ts shotClear, so these are ones where she moved behind cover during the flight). A shot that missed her and then hit a
// wall far beyond is not waste. Boss patterns are not gated and are blocked like any shot, so the figure includes them.
// Default: three areas, 45 s each. BALANCE=1: all 25 areas, 120 s each, JSON lines on stderr (or LAYOUT_COVER_OUT=/path).
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AtlasAreaId } from '../../src/contracts/atlas';
import { SIM_DT, type ProjectileKind } from '../../src/contracts/sim';
import { registeredLayouts } from '../../src/data/layouts';
import { areaRadius, areaTheme } from '../../src/data/layouts/area';
import { createRunInternal } from '../../src/sim/run';
import { createBot } from '../sim/bot';
import { TIER5, makeConfig, makeJoin, makeStats, fairSkills } from '../sim/fixtures';

const ALL = !!process.env.BALANCE;
const out = process.env.LAYOUT_COVER_OUT;
const SECONDS = ALL ? 120 : 45;
const areas: AtlasAreaId[] = ALL ? registeredLayouts().map((l) => l.areaId) : ['ironMarch', 'glassSepulchre', 'pitOfEchoes'];
/** Lobs fly over cover; everything else hostile is a flat shot. */
const LOBS: ReadonlySet<ProjectileKind> = new Set(['cinderSpit', 'tarGlob']);

describe('ranged monsters hold their fire behind cover', () => {
  for (const areaId of areas) {
    it(`${areaId}: few hostile shots are absorbed by walls`, () => {
      const { run, world } = createRunInternal(makeConfig({ theme: areaTheme(areaId), seed: 11, arenaRadius: areaRadius(areaId), scaling: { ...TIER5 }, areaId }));
      run.addPlayer(makeJoin(1, { stats: makeStats({ maxLife: 1e12, evasion: 0 }), skills: fairSkills(), loadout: [null, null, null, null, null, null] }));
      const bot = createBot();
      const pr = world.projectiles;
      // Per slot: where it left, and how far she stood from there at that moment.
      const x0 = new Float64Array(pr.capacity), y0 = new Float64Array(pr.capacity), dp0 = new Float64Array(pr.capacity);
      const px = new Float64Array(pr.capacity), py = new Float64Array(pr.capacity), seen = new Uint8Array(pr.capacity);
      let flat = 0;
      let absorbed = 0;
      let wasted = 0;
      for (let t = 0; t < Math.round(SECONDS / SIM_DT); t++) {
        run.setIntent(1, bot.intent(run.view, 1));
        // Positions before the step (the end point of a shot is within one tick's flight of them).
        for (let i = 0; i < pr.hwm; i++) {
          if (!pr.alive[i] || !pr.hostile[i]) { seen[i] = 0; continue; }
          if (!seen[i]) {
            seen[i] = 1;
            x0[i] = pr.x[i]; y0[i] = pr.y[i];
            const p = world.players[0];
            dp0[i] = Math.hypot(p.x - pr.x[i], p.y - pr.y[i]);
          }
          px[i] = pr.x[i] + pr.vx[i] * SIM_DT; py[i] = pr.y[i] + pr.vy[i] * SIM_DT;
        }
        run.step();
        const events = run.drainEvents();
        for (const e of events) {
          if (e.t === 'projectileEnd' && !LOBS.has(e.kind)) flat++;
          else if (e.t === 'blocked' && e.cover) {
            absorbed++;
            // The slot it came from: the pre-step projectile whose next position is nearest this impact.
            let best = -1, bd = 12;
            for (let i = 0; i < pr.hwm; i++) {
              if (!seen[i]) continue;
              const d = Math.hypot(px[i] - e.x, py[i] - e.y);
              if (d < bd) { bd = d; best = i; }
            }
            if (best >= 0 && Math.hypot(e.x - x0[best], e.y - y0[best]) < dp0[best] - 25) wasted++;
          }
        }
        run.drainOutcomes();
      }
      const row = { areaId, seconds: SECONDS, flatShotsEnded: flat, absorbedByCover: absorbed, wastedOnCover: wasted, share: flat > 0 ? Math.round((wasted / flat) * 100) / 100 : 0 };
      if (ALL) { const line = JSON.stringify(row); if (out) appendFileSync(out, `${line}\n`); else process.stderr.write(`${line}\n`); }
      // Nobody fires into a wall on purpose: only a small share of the flat shots may die on cover short of where she stood.
      expect(wasted).toBeLessThanOrEqual(Math.max(3, flat * 0.2));
    }, 600_000);
  }
});
