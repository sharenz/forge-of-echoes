// Fairness over whole Iron Coliseum maps (GAME_SPEC §13: "a debuff never comes from an invisible source.
// Every root and freeze comes from a projectile you can see or a telegraph you can read"). A bot plays tier-5
// maps; every root, every lane and every aim line is checked against what was on screen at that moment.
import { beforeAll, describe, expect, it } from 'vitest';
import { THRALL, CHAINMASTER } from '../../src/sim/rosters/coliseum/tuning';
import { createRunInternal } from '../../src/sim/run';
import { MONSTER_KINDS, type MonsterKind } from '../../src/contracts/content';
import { SIM_DT, type SimEvent } from '../../src/contracts/sim';
import { areaAngle, areaVariant } from '../../src/sim/area-geometry';
import { PLAYER_RADIUS } from '../../src/sim/constants';
import { PROJ } from '../../src/sim/projectiles';
import { createBot } from '../sim/bot';
import { STRONG_LOADOUT, TIER5, fairSkills, fairStats, makeConfig, makeJoin } from '../sim/fixtures';

/** The cues each Iron Coliseum monster may send (src/sim/rosters/coliseum/index.ts). */
const CUES: Partial<Record<MonsterKind, readonly string[]>> = {
  pitHound: ['melee'],
  chainThrall: ['hook', 'melee', 'leap'],
  ironCrossbowman: ['aim', 'bolt'],
  shieldbearer: ['bash', 'melee'],
  tarSlinger: ['tar'],
  chainmaster: ['hook', 'whirl', 'summon', 'melee'],
  varkus: ['slam', 'charge', 'mark', 'leap', 'whirl', 'spikes', 'summon'],
};

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2)) : 0;
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
}

interface Audit {
  result: 'cleared' | 'died' | 'timeout';
  roots: number;
  hookRoots: number;
  tarRoots: number;
  debuffs: Set<string>;
  cues: Map<MonsterKind, Set<string>>;
  lanes: number;
  aimLines: number;
  /** Crossbow bolts loosed, and how many flew exactly along an aim line their crossbowman showed. */
  bolts: number;
  honestBolts: number;
  /** Varkus was reached (he sent a cue): the whole roster was audited. */
  bossSeen: boolean;
}

/**
 * A fair bot plays a tier-5 Iron Coliseum (with `splitting`, every monster volley has an extra projectile);
 * every tick is audited (assertions fail inside). Extra life guarantees the full attack audit;
 * ordinary-life survival is measured separately by balance-ironColiseum.test.ts.
 */
function audit(seed: number, splitting = false): Audit {
  const { run, world } = createRunInternal(
    makeConfig({ theme: 'ironColiseum', seed, arenaRadius: 650, scaling: { ...TIER5, extraProjectiles: splitting ? 1 : 0 } }),
  );
  run.addPlayer(makeJoin(1, { stats: { ...fairStats(), maxLife: 1e6 }, skills: fairSkills(), loadout: STRONG_LOADOUT }));
  const bot = createBot();
  const m = world.monsters;
  const pr = world.projectiles;
  const out: Audit = {
    result: 'timeout', roots: 0, hookRoots: 0, tarRoots: 0, debuffs: new Set(), cues: new Map(), lanes: 0, aimLines: 0, bolts: 0, honestBolts: 0,
    bossSeen: false,
  };
  const CROSSBOWMAN = MONSTER_KINDS.indexOf('ironCrossbowman');
  // Hooks in flight at the end of the previous tick: x, y, vx, vy, radius.
  let hooks: number[] = [];
  const seenAreas = new Set<object>();
  for (let t = 0; t < Math.round((20 * 60) / SIM_DT); t++) {
    // Crossbow aim lines on the ground as this tick starts (owner id, start, heading).
    const aims = world.areas
      .filter((a) => !a.dead && a.kind === 'chargeLine' && areaVariant(a) === 0 && m.slotOf(a.owner) >= 0 && m.kind[m.slotOf(a.owner)] === CROSSBOWMAN)
      .map((a) => ({ owner: a.owner, x: a.x, y: a.y, angle: areaAngle(a) }));
    run.setIntent(1, bot.intent(run.view, 1));
    run.step();
    const events: SimEvent[] = run.drainEvents();
    // Every bolt loosed this tick flies from the start of one of its crossbowman's lines, exactly along it.
    for (let i = 0; i < pr.hwm; i++) {
      if (!pr.alive[i] || !pr.hostile[i] || pr.kind[i] !== PROJ.crossbowBolt || pr.age[i] > SIM_DT + 1e-9) continue;
      out.bolts++;
      const heading = Math.atan2(pr.vy[i], pr.vx[i]);
      const lx = pr.x[i] - pr.vx[i] * pr.age[i];
      const ly = pr.y[i] - pr.vy[i] * pr.age[i];
      const line = aims.find((l) => l.owner === pr.src[i] && Math.hypot(lx - l.x, ly - l.y) < 1e-2 &&
        Math.abs(Math.atan2(Math.sin(heading - l.angle), Math.cos(heading - l.angle))) < 1e-4);
      expect(line, `seed ${seed}${splitting ? ' (Splitting)' : ''} t=${world.time.toFixed(2)}: a crossbow bolt with no aim line`).toBeDefined();
      out.honestBolts++;
    }
    for (const e of events) {
      if (e.t === 'monsterAttack') {
        if (e.kind === 'varkus') out.bossSeen = true;
        const set = out.cues.get(e.kind) ?? new Set<string>();
        set.add(e.attack);
        out.cues.set(e.kind, set);
      }
      if (e.t !== 'debuff') continue;
      out.debuffs.add(e.debuff);
      if (e.debuff !== 'rooted') continue;
      out.roots++;
      // A root must come from a hook that was flying at her (it lands this tick) or from tar she stands in.
      let byHook = false;
      for (let k = 0; k < hooks.length; k += 5) {
        const [x, y, vx, vy, r] = hooks.slice(k, k + 5);
        if (segDist(e.x, e.y, x, y, x + vx * SIM_DT, y + vy * SIM_DT) <= r + PLAYER_RADIUS + 1) byHook = true;
      }
      const byTar = world.areas.some((a) => a.kind === 'tarPool' && !a.dead && Math.hypot(e.x - a.x, e.y - a.y) <= a.radius + 1e-3);
      expect(byHook || byTar, `seed ${seed} t=${world.time.toFixed(2)}: a root with no hook or tar in sight`).toBe(true);
      if (byHook) out.hookRoots++;
      else out.tarRoots++;
    }
    for (const v of run.view.players[0].debuffs) if (v.id === 'rooted') expect(['chain', 'tar']).toContain(v.source);
    // Lanes belong to Varkus, aim lines to crossbowmen and the Chainmaster's hook.
    for (const a of world.areas) {
      if (a.dead || a.kind !== 'chargeLine' || seenAreas.has(a)) continue;
      seenAreas.add(a);
      const owner = m.slotOf(a.owner);
      if (owner < 0) continue;
      const kind = MONSTER_KINDS[m.kind[owner]];
      if (areaVariant(a) === 0) {
        out.aimLines++;
        expect(['ironCrossbowman', 'chainmaster']).toContain(kind);
      } else {
        out.lanes++;
        expect(kind).toBe('varkus');
      }
    }
    hooks = [];
    for (let i = 0; i < pr.hwm; i++) {
      if (pr.alive[i] && pr.hostile[i] && pr.kind[i] === PROJ.chainHook) hooks.push(pr.x[i], pr.y[i], pr.vx[i], pr.vy[i], pr.radius[i]);
    }
    const outcomes = run.drainOutcomes();
    if (outcomes.some((o) => o.t === 'playerDied')) {
      out.result = 'died';
      break;
    }
    if (outcomes.some((o) => o.t === 'cleared')) {
      out.result = 'cleared';
      break;
    }
  }
  return out;
}

describe('Iron Coliseum fairness over whole maps', () => {
  const seeds = [2, 5, 9];
  let audits: { seed: number; a: Audit }[] = [];
  /**
   * A Splitting map too (every monster volley has an extra projectile: each crossbow bolt needs its own line).
   * It is audited just the same; the fair bot clears about 11 of 12 of these (a harder map mod), so it only has
   * to reach Varkus — the whole roster has been audited by then.
   */
  let splitting: Audit;
  beforeAll(() => {
    audits = seeds.map((seed) => ({ seed, a: audit(seed) }));
    splitting = audit(9, true);
  }, 180_000);

  it('a Splitting map is just as fair: the fair bot meets Varkus, every bolt flies along its own aim line', () => {
    expect(splitting.bossSeen, `Splitting run ended (${splitting.result}) before Varkus`).toBe(true);
    expect(splitting.result).not.toBe('timeout');
    expect(splitting.bolts).toBeGreaterThan(10);
    expect(splitting.honestBolts).toBe(splitting.bolts);
    expect(splitting.hookRoots + splitting.tarRoots).toBe(splitting.roots);
  });

  it('every root comes from a visible hook that just landed or from tar underfoot — never from a hit', () => {
    let hookRoots = 0;
    let tarRoots = 0;
    for (const { seed, a } of audits) {
      expect(a.result, `seed ${seed}`).toBe('cleared');
      hookRoots += a.hookRoots;
      tarRoots += a.tarRoots;
    }
    expect(hookRoots).toBeGreaterThan(0);
    expect(tarRoots).toBeGreaterThan(0);
  });

  it('only Bleeding and Rooted (plus the Burning/Shocked of a rare\'s telegraphed burst or strike) ever land', () => {
    for (const { a } of audits) {
      for (const d of a.debuffs) expect(['bleeding', 'rooted', 'burning', 'shocked']).toContain(d);
      expect(a.debuffs.has('bleeding')).toBe(true);
      expect(a.debuffs.has('rooted')).toBe(true);
    }
  });

  it('every monster sends only its documented cues, and every family member and both leaders are heard', () => {
    const all = new Map<MonsterKind, Set<string>>();
    for (const { a } of audits) {
      for (const [kind, set] of a.cues) {
        expect(CUES[kind], `${kind} is not an Iron Coliseum monster`).toBeDefined();
        for (const cue of set) expect(CUES[kind], `${kind}: '${cue}'`).toContain(cue);
        const acc = all.get(kind) ?? new Set<string>();
        for (const c of set) acc.add(c);
        all.set(kind, acc);
      }
    }
    expect([...(all.get('ironCrossbowman') ?? [])].sort()).toEqual(['aim', 'bolt']);
    expect(all.get('chainThrall')?.has('hook')).toBe(true);
    expect(all.get('tarSlinger')?.has('tar')).toBe(true);
    expect(all.get('shieldbearer')?.has('bash')).toBe(true);
    expect(all.has('chainmaster')).toBe(false); // now the Chainworks final boss
    // His cleave ('slam') needs a player inside its 76-unit reach: this kiting bot fells him in about 20 s without
    // ever letting him that close, so it is optional here (varkus.test.ts drives the cleave and its telegraph).
    for (const cue of ['charge', 'mark', 'leap', 'whirl', 'spikes', 'summon']) expect(all.get('varkus')?.has(cue), `varkus '${cue}'`).toBe(true);
  });

  it('lanes are only Varkus\'s, aim lines only the crossbowmen\'s and the Chainmaster\'s; every bolt flies along its line', () => {
    for (const { seed, a } of audits) {
      expect(a.lanes).toBeGreaterThan(0);
      expect(a.aimLines).toBeGreaterThan(0);
      expect(a.bolts, `seed ${seed}`).toBeGreaterThan(10);
      expect(a.honestBolts).toBe(a.bolts);
    }
    // Documented windups the lines and hooks rely on.
    expect(THRALL.windup).toBeGreaterThanOrEqual(0.6);
    expect(CHAINMASTER.hookCast).toBeGreaterThanOrEqual(0.6);
  });
});
