// The Chainmaster (Iron Coliseum lieutenant, GAME_SPEC §14): his hook finds the farthest player along an
// aim line and drags them in; his chain whirl is a telegraphed ring before it bleeds; he summons Chain Thralls.
import { describe, expect, it } from 'vitest';
// The harness first: it loads the sim through run.ts (the core's modules import each other in a cycle).
import { joinArena, placeMonster, pv } from '../sim/helpers';
import { SIM_DT } from '../../src/contracts/sim';
import { areaAngle } from '../../src/sim/area-geometry';
import { PULL_MAX_DISTANCE } from '../../src/sim/constants';
import { applyDebuff, cleanseDebuffs, isHeld } from '../../src/sim/debuffs';
import { PLAYER_DEBUFFS } from '../../src/contracts/bestiary';
import { allocPack, spawnMonster } from '../../src/sim/spawn';
import { monsterDef } from '../../src/sim/rosters';
import { CHAINMASTER as C } from '../../src/sim/rosters/coliseum/tuning';
import { idleIntent } from '../sim/fixtures';
import {
  arena, areasOf, attacksOf, cullExcept, monstersOf, step, ticks, toughStats, touchesDisc,
} from './helpers';

describe('The Chainmaster', () => {
  it('hooks the FARTHEST player along an aim line shown for the whole cast, and drags them in (rooted, chain)', () => {
    const a = arena();
    a.player.x = 40;
    a.player.y = 0;
    const far = joinArena(a, 2, -300, 0, toughStats());
    a.player.invulnTime = 0;
    far.invulnTime = 0;
    const i = placeMonster(a.world, 'chainmaster', 0, 0, { life: 1e6 });
    const m = a.world.monsters;
    let lineAt = -1;
    let angle = 0;
    let hookAt = -1;
    let pull: { fromX: number; fromY: number; toX: number; toY: number; playerId: number } | undefined;
    const intents = new Map([[1, idleIntent()], [2, idleIntent()]]);
    for (let t = 0; t < ticks(6) && !pull; t++) {
      const ev = step(a, intents);
      cullExcept(a.world, [i]);
      const line = areasOf(a.world, 'chargeLine', { variant: 0, owner: m.id[i] })[0];
      if (line && lineAt < 0) {
        lineAt = a.world.time;
        angle = areaAngle(line);
      }
      if (attacksOf(ev, 'chainmaster', 'hook').length && hookAt < 0) hookAt = a.world.time;
      pull = ev.find((e) => e.t === 'pull') as typeof pull;
    }
    expect(lineAt, 'no aim line').toBeGreaterThan(0);
    expect(Math.cos(angle)).toBeLessThan(-0.99); // toward the far player (west)
    expect(hookAt - lineAt).toBeGreaterThanOrEqual(C.hookCast - SIM_DT - 1e-6);
    expect(pull, 'the hook never landed').toBeDefined();
    expect(pull!.playerId).toBe(2);
    // A long yank (capped at PULL_MAX_DISTANCE) toward him.
    expect(Math.hypot(pull!.toX - pull!.fromX, pull!.toY - pull!.fromY)).toBeCloseTo(PULL_MAX_DISTANCE, 0);
    expect(pull!.toX).toBeGreaterThan(pull!.fromX);
    expect(pv(a.run, 2).debuffs.find((d) => d.id === 'rooted')?.source).toBe('chain');
    expect(pv(a.run, 1).debuffs).toHaveLength(0);
  });

  it('faces along his hook\'s aim line for the whole cast, not toward the nearer player', () => {
    const a = arena();
    a.player.x = 40; // the nearest player (his target) stands east of him…
    a.player.y = 0;
    const far = joinArena(a, 2, -300, 0, toughStats()); // …the hook goes west
    a.player.invulnTime = 0;
    far.invulnTime = 0;
    const i = placeMonster(a.world, 'chainmaster', 0, 0, { life: 1e6 });
    const m = a.world.monsters;
    const intents = new Map([[1, idleIntent()], [2, idleIntent()]]);
    let aiming = 0;
    for (let t = 0; t < ticks(6); t++) {
      const ev = step(a, intents);
      cullExcept(a.world, [i]);
      if (attacksOf(ev, 'chainmaster', 'hook').length) break;
      if (areasOf(a.world, 'chargeLine', { variant: 0, owner: m.id[i] }).length === 0) continue;
      aiming++;
      expect(m.facing[i]).toBe(-1);
    }
    expect(aiming).toBeGreaterThan(ticks(C.hookCast) - 3);
  });

  it('never hooks a player standing close to him (he whirls instead)', () => {
    const a = arena();
    a.player.x = 50;
    a.player.invulnTime = 0;
    const i = placeMonster(a.world, 'chainmaster', 0, 0, { life: 1e6 });
    let hooks = 0;
    let whirls = 0;
    for (let t = 0; t < ticks(12); t++) {
      const ev = step(a);
      cullExcept(a.world, [i]);
      a.player.x = 50; // she holds her ground next to him
      a.player.y = 0;
      hooks += attacksOf(ev, 'chainmaster', 'hook').length;
      whirls += attacksOf(ev, 'chainmaster', 'whirl').length;
    }
    expect(hooks).toBe(0);
    expect(whirls).toBeGreaterThan(0);
  });

  it('the whirl shows a harmless ring for its whole cast before the chains turn; the chains bleed', () => {
    const a = arena();
    a.player.x = 40;
    a.player.invulnTime = 0;
    const i = placeMonster(a.world, 'chainmaster', 0, 0, { life: 1e6 });
    const m = a.world.monsters;
    let ringAt = -1;
    let bladesAt = -1;
    let hurtBeforeBlades = false;
    for (let t = 0; t < ticks(10) && bladesAt < 0; t++) {
      const life = a.player.life;
      step(a);
      cullExcept(a.world, [i]);
      if (areasOf(a.world, 'whirlwind', { variant: 0, owner: m.id[i] }).length && ringAt < 0) ringAt = a.world.time;
      if (areasOf(a.world, 'whirlwind', { variant: 1, owner: m.id[i] }).length) bladesAt = a.world.time;
      if (ringAt > 0 && bladesAt < 0 && a.player.life < life) hurtBeforeBlades = true;
    }
    expect(ringAt, 'no whirl ring').toBeGreaterThan(0);
    expect(bladesAt - ringAt).toBeGreaterThanOrEqual(C.whirlCast - SIM_DT - 1e-6);
    // She stands out of his melee reach: the ring itself never hurts.
    expect(hurtBeforeBlades).toBe(false);
    for (let t = 0; t < ticks(1.5); t++) {
      step(a);
      cullExcept(a.world, [i]);
    }
    expect(pv(a.run).debuffs.map((d) => d.id)).toContain('bleeding');
  });

  it('never walks his spinning chains into a player held by someone else\'s hook or tar', () => {
    const a = arena();
    a.player.x = 40;
    a.player.invulnTime = 0;
    const i = placeMonster(a.world, 'chainmaster', 0, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    let blades: ReturnType<typeof areasOf>[number] | undefined;
    for (let t = 0; t < ticks(10) && !blades; t++) {
      step(a);
      cullExcept(a.world, [i]);
      cleanseDebuffs(a.world, a.player, PLAYER_DEBUFFS);
      blades = areasOf(a.world, 'whirlwind', { variant: 1, owner: m.id[i] })[0];
    }
    expect(blades, 'no whirl').toBeDefined();
    a.player.x = m.x[i] + blades!.radius + 25;
    a.player.y = m.y[i];
    expect(applyDebuff(a.world, a.player, 'rooted', 0, 'tar')).toBe(true);
    const life = a.player.life;
    const d0 = Math.hypot(m.x[i] - a.player.x, m.y[i] - a.player.y);
    let heldTicks = 0;
    for (let t = 0; t < ticks(2) && isHeld(a.player) && !blades!.dead; t++) {
      step(a);
      cullExcept(a.world, [i]);
      if (!isHeld(a.player)) break; // freed this tick: he may walk on
      heldTicks++;
      expect(Math.hypot(m.x[i] - a.player.x, m.y[i] - a.player.y)).toBeGreaterThanOrEqual(d0 - 1e-3);
    }
    expect(heldTicks).toBeGreaterThan(ticks(1));
    expect(a.player.life).toBe(life);
  });

  it('a hooked player is never inside his spinning chains while the hook still roots them', () => {
    for (const seed of [3, 5, 8, 13]) {
      const a = arena({ seed });
      a.player.x = -200;
      a.player.invulnTime = 0;
      const i = placeMonster(a.world, 'chainmaster', 0, 0, { life: 1e6, still: false });
      const m = a.world.monsters;
      let hooked = 0;
      for (let t = 0; t < ticks(25); t++) {
        step(a);
        cullExcept(a.world, [i]);
        const root = pv(a.run).debuffs.find((d) => d.id === 'rooted' && d.source === 'chain');
        if (!root) continue;
        hooked++;
        for (const blades of areasOf(a.world, 'whirlwind', { variant: 1, owner: m.id[i] })) {
          expect(touchesDisc(blades, a.player.x, a.player.y), `seed ${seed}: rooted inside the chains`).toBe(false);
        }
      }
      expect(hooked, `seed ${seed}: never hooked`).toBeGreaterThan(0);
    }
  });

  it('arrives with Chain Thralls and summons more while few are near him', () => {
    const a = arena();
    a.player.x = 150;
    a.player.invulnTime = 0;
    const pk = allocPack(a.world, 0, 0, 3, false, 'normal', true);
    const i = spawnMonster(a.world, 'chainmaster', 0, 0, { pack: pk, wave: 3, lieutenant: true });
    monsterDef('chainmaster').onSpawn!(a.world, i, pk, 0, 0);
    expect(monstersOf(a.world, 'chainThrall')).toHaveLength(C.escorts);
    const m = a.world.monsters;
    const near = () => monstersOf(a.world, 'chainThrall').filter((j) => Math.hypot(m.x[j] - m.x[i], m.y[j] - m.y[i]) <= C.summonCountRadius).length;
    let summons = 0;
    for (let t = 0; t < ticks(40); t++) {
      const before = near();
      const ev = step(a);
      if (attacksOf(ev, 'chainmaster', 'summon').length === 0) continue;
      summons++;
      // He only calls for more while fewer than summonCap are near him.
      expect(before).toBeLessThan(C.summonCap);
      expect(near()).toBeLessThanOrEqual(C.summonCap - 1 + C.summonCount);
    }
    expect(summons).toBeGreaterThan(0);
  });

  it('arriving by the arena wall, his escort still stands inside it', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const R = a.world.arenaRadius;
    const x = R - 12;
    const pk = allocPack(a.world, x, 0, 3, false, 'normal', true);
    const i = spawnMonster(a.world, 'chainmaster', x, 0, { pack: pk, wave: 3, lieutenant: true });
    monsterDef('chainmaster').onSpawn!(a.world, i, pk, x, 0);
    const m = a.world.monsters;
    const escort = monstersOf(a.world, 'chainThrall');
    expect(escort).toHaveLength(C.escorts);
    for (const j of escort) expect(Math.hypot(m.x[j], m.y[j])).toBeLessThanOrEqual(R - 16 + 1e-3);
  });
});
