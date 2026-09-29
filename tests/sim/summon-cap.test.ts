// The saturated field (GAME_SPEC §8, §14; constants.ts SUMMON_FIELD_CAP): no lieutenant or boss summons while
// SUMMON_FIELD_CAP monsters are alive — no summoning cast starts and no minion appears — and they summon again as
// soon as the field thins. One rule for all six summoners, so an unreachable summoner (the Herald kiting behind its
// ashlings) can't snowball the horde until the boss wave.
import { describe, expect, it } from 'vitest';
import { MONSTER_KINDS, type MonsterKind } from '../../src/contracts/content';
import { SIM_DT } from '../../src/contracts/sim';
import { killMonster } from '../../src/sim/combat';
import { SUMMON_FIELD_CAP } from '../../src/sim/constants';
import { MFLAG } from '../../src/sim/stores';
import type { World } from '../../src/sim/world';
import { idleIntent, makeStats } from './fixtures';
import { makeArena, placeMonster, stepWith } from './helpers';

const SUMMONERS: { kind: MonsterKind; minion: MonsterKind; setup?: (w: World, i: number) => void }[] = [
  { kind: 'ashboundHerald', minion: 'ashling' },
  // Her skitters come from phase 2: start her at half life (she roars into it first).
  { kind: 'cinderMatriarch', minion: 'emberSkitter', setup: (w, i) => { w.monsters.life[i] = w.monsters.maxLife[i] * 0.5; } },
  { kind: 'boneChorister', minion: 'boneThrall' },
  { kind: 'hollowWarden', minion: 'rimeshade' },
  { kind: 'chainmaster', minion: 'chainThrall' },
  { kind: 'varkus', minion: 'pitHound' },
];

/** Summoned minions of `kind` alive now. */
function summoned(w: World, kind: MonsterKind): number {
  const m = w.monsters;
  const k = MONSTER_KINDS.indexOf(kind);
  let n = 0;
  for (let i = 0; i < m.hwm; i++) if (m.alive[i] && m.kind[i] === k && (m.flags[i] & MFLAG.summoned) !== 0) n++;
  return n;
}

describe('the saturated field (SUMMON_FIELD_CAP)', () => {
  for (const { kind, minion, setup } of SUMMONERS) {
    it(`${kind}: no summoning cast and no ${minion} while ${SUMMON_FIELD_CAP} monsters are alive, and again once it thins`, () => {
      const { run, world } = makeArena({ stats: makeStats({ maxLife: 1e9, evasion: 0 }) });
      const i = placeMonster(world, kind, 150, 0, { life: 1e6, still: false });
      setup?.(world, i);
      // Fill the field with passive dummies at the far edge (they are no summoner's own minions).
      const fillers: number[] = [];
      for (let k = 0; world.monsters.count < SUMMON_FIELD_CAP; k++) {
        const a = (k / SUMMON_FIELD_CAP) * Math.PI * 2;
        fillers.push(placeMonster(world, 'trainingDummy', Math.cos(a) * 520, Math.sin(a) * 520, { life: 1e9 }));
      }
      const casts = (seconds: number): number => {
        let n = 0;
        for (let t = 0; t < Math.round(seconds / SIM_DT); t++) {
          stepWith(run, idleIntent());
          for (const e of run.drainEvents()) if (e.t === 'monsterAttack' && e.kind === kind && e.attack === 'summon') n++;
        }
        return n;
      };
      expect(casts(25), `${kind} on a saturated field`).toBe(0);
      expect(summoned(world, minion)).toBe(0);
      // The field thins: the next summon comes.
      for (const j of fillers.slice(0, 20)) killMonster(world, j, 0, false);
      expect(casts(25), `${kind} once the field thinned`).toBeGreaterThan(0);
      expect(summoned(world, minion)).toBeGreaterThan(0);
    }, 30_000);
  }
});
