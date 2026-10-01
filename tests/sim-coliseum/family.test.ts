// Iron Coliseum family (GAME_SPEC §14): what each monster does to a player, and that every threat is
// readable — the hound's crouch, the thrall's whirling hook, the crossbow's aim line, the shield's front,
// the tar lob and its pool.
import { describe, expect, it } from 'vitest';
import { MONSTER_ANIM, SIM_DT } from '../../src/contracts/sim';
import { areaAngle, inChargeLine } from '../../src/sim/area-geometry';
import { CROSSBOW, HOUND, SHIELD, TAR, THRALL } from '../../src/sim/rosters/coliseum/tuning';
import { monsterDef } from '../../src/sim/rosters';
import { CHAIN_PULL_DISTANCE, PLAYER_RADIUS, ROOT_DURATION, TAR_POOL_RADIUS } from '../../src/sim/constants';
import { MFLAG, MSTATE } from '../../src/sim/stores';
import { PROJ, projSpec, spawnProjectile } from '../../src/sim/projectiles';
import { makeSkill } from '../sim/fixtures';
import { placeMonster, pv } from '../sim/helpers';
import {
  arena, areasOf, attacksOf, hitsOn, monstersOf, projectilesOf, step, stepUntil, ticks, toughStats, walkDir,
} from './helpers';

const debuffIds = (a: ReturnType<typeof arena>) => pv(a.run).debuffs.map((d) => d.id);

describe('Pit Hound', () => {
  it('always crouches (the tell) before it pounces, and its bite bleeds', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const h = placeMonster(a.world, 'pitHound', 120, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    let crouch = 0;
    let lastCrouch = 0;
    let bites = 0;
    for (let t = 0; t < ticks(12); t++) {
      const ev = step(a);
      if (m.state[h] === MSTATE.windup) crouch += SIM_DT;
      else if (crouch > 0) {
        lastCrouch = crouch;
        crouch = 0;
      }
      for (const hit of hitsOn(ev)) {
        if (hit.amount < 2) continue; // bleeding ticks
        bites++;
        // Only a pounce bites, and only after a full crouch.
        expect(m.state[h]).toBe(MSTATE.charge);
        expect(lastCrouch).toBeGreaterThanOrEqual(HOUND.crouch - 1e-6);
      }
    }
    expect(bites).toBeGreaterThan(2);
    expect(debuffIds(a)).toContain('bleeding');
  });

  it('can be outrun: a player walking away is never caught, even by a pounce', () => {
    const a = arena();
    a.player.invulnTime = 0;
    placeMonster(a.world, 'pitHound', 45, 0, { life: 1e6, still: false });
    let hits = 0;
    for (let t = 0; t < ticks(4); t++) hits += hitsOn(step(a, walkDir(-1, 0))).length;
    expect(hits).toBe(0);
    expect(monsterDef('pitHound').speed).toBeLessThan(a.player.stats.moveSpeed);
  });

  it('circles its prey while its bite recharges instead of pressing into it', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const h = placeMonster(a.world, 'pitHound', 30, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    // A bite has just happened: on cooldown it prowls at about HOUND.prowlRange.
    stepUntil(a, 8, () => (m.state[h] === MSTATE.attack ? true : undefined));
    stepUntil(a, 2, () => (m.state[h] === 0 ? true : undefined));
    // It backs off the body it just bit, then circles out of reach until the bite is ready again.
    for (let t = 0; t < ticks(0.4); t++) step(a);
    let minD = Infinity;
    let prowled = 0;
    for (let t = 0; t < ticks(0.8); t++) {
      step(a);
      if (m.attackCd[h] > 0.1) {
        minD = Math.min(minD, Math.hypot(m.x[h], m.y[h]));
        prowled++;
      }
    }
    expect(prowled).toBeGreaterThan(10);
    expect(minD).toBeGreaterThan(m.radius[h] + PLAYER_RADIUS + 4);
  });
});

describe('Chain Thrall', () => {
  it('whirls its hook (windup) before every throw; a hook that lands drags 40 units toward it and roots (chain)', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const th = placeMonster(a.world, 'chainThrall', 150, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    let windup = 0;
    const throwAt = stepUntil(a, 10, (ev) => {
      if (m.state[th] === MSTATE.cast) windup += SIM_DT;
      return attacksOf(ev, 'chainThrall', 'hook').length ? true : undefined;
    });
    expect(throwAt).toBe(true);
    expect(windup).toBeGreaterThanOrEqual(THRALL.windup - 1e-6);
    expect(m.anim[th]).toBe(MONSTER_ANIM.attack);
    const hooks = projectilesOf(a.world, 'chainHook');
    expect(hooks).toHaveLength(1);
    // The chain is drawn from its launch point, the thrall's hand.
    const pr = a.world.projectiles;
    const lx = pr.x[hooks[0]] - pr.vx[hooks[0]] * pr.age[hooks[0]];
    expect(Math.hypot(lx - m.x[th], pr.y[hooks[0]] - pr.vy[hooks[0]] * pr.age[hooks[0]] - m.y[th])).toBeLessThan(m.radius[th] + 3);
    const x0 = a.player.x;
    const pull = stepUntil(a, 1.5, (ev) => ev.find((e) => e.t === 'pull'));
    expect(pull, 'the hook never landed').toBeDefined();
    expect(Math.hypot(pull!.toX - pull!.fromX, pull!.toY - pull!.fromY)).toBeCloseTo(CHAIN_PULL_DISTANCE, 0);
    expect(pull!.toX - x0).toBeGreaterThan(0); // toward the thrall (east)
    const root = pv(a.run).debuffs.find((d) => d.id === 'rooted');
    expect(root?.source).toBe('chain');
  });

  it('a sidestep dodges the thrown hook, and its rake up close never roots', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const th = placeMonster(a.world, 'chainThrall', 160, 0, { life: 1e6, still: false });
    stepUntil(a, 10, (ev) => (attacksOf(ev, 'chainThrall', 'hook').length ? true : undefined));
    let pulls = 0;
    for (let t = 0; t < ticks(1); t++) pulls += step(a, walkDir(0, 1)).filter((e) => e.t === 'pull').length;
    expect(pulls).toBe(0);
    // Up close it rakes: plain hits.
    const m = a.world.monsters;
    m.x[th] = a.player.x + 16;
    m.y[th] = a.player.y;
    m.attackCd[th] = 1e9;
    let rakes = 0;
    for (let t = 0; t < ticks(4); t++) {
      rakes += hitsOn(step(a)).filter((h) => h.amount >= 1).length;
      expect(debuffIds(a)).not.toContain('rooted');
    }
    expect(rakes).toBeGreaterThan(0);
  });

  it('rushes the victim its hook caught', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const th = placeMonster(a.world, 'chainThrall', 180, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    stepUntil(a, 10, (ev) => ev.find((e) => e.t === 'pull'));
    expect(m.timerB[th]).toBeGreaterThan(0);
    stepUntil(a, 1, () => (m.state[th] === 0 ? true : undefined));
    const x0 = m.x[th];
    step(a);
    step(a);
    const v = Math.abs(m.x[th] - x0) / (2 * SIM_DT);
    expect(v).toBeGreaterThan(monsterDef('chainThrall').speed * 1.2);
  });
});

describe('Iron Crossbowman', () => {
  it('shows a 0.6 s aim line, then the bolt flies exactly along it and bleeds', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const c = placeMonster(a.world, 'ironCrossbowman', 200, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    const line = stepUntil(a, 8, () => areasOf(a.world, 'chargeLine', { variant: 0, owner: m.id[c] })[0]);
    expect(line).toBeDefined();
    const shownAt = a.world.time;
    const bolt = stepUntil(a, 1, () => projectilesOf(a.world, 'crossbowBolt')[0]);
    expect(bolt).toBeDefined();
    expect(a.world.time - shownAt).toBeGreaterThanOrEqual(0.6 - 1e-6);
    const pr = a.world.projectiles;
    expect(Math.atan2(pr.vy[bolt!], pr.vx[bolt!])).toBeCloseTo(Math.atan2(Math.sin(areaAngle(line!)), Math.cos(areaAngle(line!))), 5);
    stepUntil(a, 1, (ev) => (hitsOn(ev).length ? true : undefined));
    expect(debuffIds(a)).toContain('bleeding');
  });

  it('a player who steps off the aim line is not hit', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const c = placeMonster(a.world, 'ironCrossbowman', 200, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    stepUntil(a, 8, () => areasOf(a.world, 'chargeLine', { variant: 0, owner: m.id[c] })[0]);
    m.attackCd[c] = 1e9; // this one shot only
    let hits = 0;
    for (let t = 0; t < ticks(1.5); t++) hits += hitsOn(step(a, walkDir(0, 1))).length;
    expect(hits).toBe(0);
  });

  it('volley discipline: at most two crossbowmen aim at one player at a time', () => {
    const a = arena();
    a.player.invulnTime = 0;
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2;
      placeMonster(a.world, 'ironCrossbowman', Math.cos(ang) * 200, Math.sin(ang) * 200, { life: 1e6, still: false });
    }
    let most = 0;
    let bolts = 0;
    for (let t = 0; t < ticks(15); t++) {
      bolts += attacksOf(step(a), 'ironCrossbowman', 'bolt').length;
      most = Math.max(most, areasOf(a.world, 'chargeLine', { variant: 0 }).length);
    }
    expect(most).toBe(2);
    expect(bolts).toBeGreaterThan(8);
  });

  describe('on a Splitting map (an extra bolt per volley)', () => {
    /** A Splitting arena with one crossbowman 200 units east; returns once its aim lines are down. */
    function splitting() {
      const a = arena();
      a.player.invulnTime = 0;
      (a.world.config.monsters as { extraProjectiles: number }).extraProjectiles = 1;
      const c = placeMonster(a.world, 'ironCrossbowman', 200, 0, { life: 1e6, still: false });
      const m = a.world.monsters;
      const lines = stepUntil(a, 8, () => {
        const l = areasOf(a.world, 'chargeLine', { variant: 0, owner: m.id[c] });
        return l.length ? l : undefined;
      });
      expect(lines, 'no aim lines').toBeDefined();
      return { a, c, lines: lines!.map((l) => ({ x: l.x, y: l.y, angle: areaAngle(l), area: l })) };
    }

    it('draws one aim line per bolt; every bolt leaves from its line\'s start exactly along it', () => {
      const { a, lines } = splitting();
      expect(lines).toHaveLength(2);
      // One line is aimed at her; the extra fans out beside it, a spread over.
      expect(lines.filter((l) => inChargeLine(l.area, a.player.x, a.player.y, 0))).toHaveLength(1);
      const gap = Math.abs(Math.atan2(Math.sin(lines[0].angle - lines[1].angle), Math.cos(lines[0].angle - lines[1].angle)));
      expect(gap).toBeCloseTo(CROSSBOW.spread, 1);
      const bolts = stepUntil(a, 1, () => {
        const b = projectilesOf(a.world, 'crossbowBolt');
        return b.length ? b : undefined;
      });
      expect(bolts).toHaveLength(2);
      const pr = a.world.projectiles;
      const used = new Set<number>();
      for (const b of bolts!) {
        const heading = Math.atan2(pr.vy[b], pr.vx[b]);
        const k = lines.findIndex((l) => Math.abs(Math.atan2(Math.sin(heading - l.angle), Math.cos(heading - l.angle))) < 1e-5);
        expect(k, `a bolt at ${heading.toFixed(4)} rad flies where no line was drawn`).toBeGreaterThanOrEqual(0);
        used.add(k);
        // Launched from the line's start.
        const lx = pr.x[b] - pr.vx[b] * pr.age[b];
        const ly = pr.y[b] - pr.vy[b] * pr.age[b];
        expect(Math.hypot(lx - lines[k].x, ly - lines[k].y)).toBeLessThan(1e-3);
      }
      expect(used.size).toBe(2);
    });

    it('standing still on the aimed line is hit; stepping away from the extra line dodges both', () => {
      const still = splitting();
      let hits = 0;
      for (let t = 0; t < ticks(1.5); t++) hits += hitsOn(step(still.a)).filter((h) => h.amount >= 1).length;
      expect(hits).toBeGreaterThanOrEqual(1);
      // The extra line's side: step the other way (0.3 s ≈ 33 units: off the aimed line's 10.5-unit reach).
      const dodge = splitting();
      const aimed = dodge.lines.find((l) => inChargeLine(l.area, dodge.a.player.x, dodge.a.player.y, 0))!;
      const extra = dodge.lines.find((l) => l !== aimed)!;
      const side = Math.sign(Math.sin(extra.angle - aimed.angle)) * Math.sign(Math.cos(aimed.angle)); // +1: the extra is south… of her
      const m = dodge.a.world.monsters;
      m.attackCd[dodge.c] = 1e9;
      let dodged = 0;
      for (let t = 0; t < ticks(1.5); t++) {
        const intent = t < ticks(0.3) ? walkDir(0, side >= 0 ? -1 : 1) : walkDir(0, 0);
        dodged += hitsOn(step(dodge.a, intent)).filter((h) => h.amount >= 1).length;
      }
      expect(dodged).toBe(0);
    });

    it('volley discipline still counts crossbowmen, not lines: at most two aim at one player', () => {
      const a = arena();
      a.player.invulnTime = 0;
      (a.world.config.monsters as { extraProjectiles: number }).extraProjectiles = 1;
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2;
        placeMonster(a.world, 'ironCrossbowman', Math.cos(ang) * 200, Math.sin(ang) * 200, { life: 1e6, still: false });
      }
      const m = a.world.monsters;
      let most = 0;
      let bolts = 0;
      for (let t = 0; t < ticks(15); t++) {
        step(a);
        bolts += projectilesOf(a.world, 'crossbowBolt').filter((b) => a.world.projectiles.age[b] <= SIM_DT + 1e-9).length;
        const owners = new Set(areasOf(a.world, 'chargeLine', { variant: 0 }).map((l) => l.owner));
        most = Math.max(most, owners.size);
        for (const id of owners) expect(areasOf(a.world, 'chargeLine', { variant: 0, owner: id })).toHaveLength(2);
        expect(m.alive.length).toBeGreaterThan(0);
      }
      expect(most).toBe(2);
      expect(bolts).toBeGreaterThan(16);
    });
  });
});

describe('Shieldbearer', () => {
  /** A player projectile fired at the bearer from `deg` degrees off its shield's heading. */
  function shootFrom(deg: number) {
    const a = arena({ skills: [makeSkill('emberLance', 1)] });
    // The player stands on the shield's axis far away (the shield keeps facing her), the bolt comes from `deg`.
    a.player.x = -300;
    a.player.y = 0;
    const i = placeMonster(a.world, 'shieldbearer', 0, 0, { life: 1e6 });
    const m = a.world.monsters;
    m.aim[i] = Math.PI;
    const from = Math.PI + (deg * Math.PI) / 180;
    const s = projSpec;
    Object.assign(s, {
      kind: PROJ.emberLance, hostile: false, x: Math.cos(from) * 60, y: Math.sin(from) * 60, angle: from + Math.PI, speed: 400, range: 200,
      radius: 3, damage: 10, dtype: 1, critChance: 0, critMult: 1.5, ailmentChance: 0, pierce: 0, owner: 1,
    });
    spawnProjectile(a.world, s);
    let blocked = 0;
    for (let t = 0; t < 20; t++) blocked += step(a).filter((e) => e.t === 'blocked').length;
    return { blocked, hurt: m.life[i] < 1e6 };
  }

  it('blocks player projectiles inside its 120° front and nowhere else', () => {
    expect(monsterDef('shieldbearer').block?.arc).toBeCloseTo((2 * Math.PI) / 3, 9);
    for (const deg of [0, 30, -50, 57]) expect(shootFrom(deg), `${deg}°`).toEqual({ blocked: 1, hurt: false });
    for (const deg of [63, -70, 120, 180]) expect(shootFrom(deg), `${deg}°`).toEqual({ blocked: 0, hurt: true });
  });

  it('bashes whoever stands in front of it: the guard drops for the bash (the opening), the player is knocked back', () => {
    const a = arena({ skills: [makeSkill('emberLance', 1)] });
    a.player.invulnTime = 0;
    const i = placeMonster(a.world, 'shieldbearer', 26, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    m.aim[i] = Math.PI;
    const windup = stepUntil(a, 4, () => (m.state[i] === MSTATE.windup ? true : undefined));
    expect(windup).toBe(true);
    expect(m.flags[i] & MFLAG.guard).toBe(0); // guard down while it hauls the shield back
    const x0 = a.player.x;
    const bash = stepUntil(a, SHIELD.windup + 0.1, (ev) => attacksOf(ev, 'shieldbearer', 'bash')[0]);
    expect(bash).toBeDefined();
    for (let t = 0; t < 20; t++) step(a);
    expect(a.player.x).toBeLessThan(x0 - SHIELD.knockback * 0.7);
    expect(a.player.life).toBeLessThan(1e6);
    stepUntil(a, SHIELD.recover + 0.2, () => (m.state[i] === 0 ? true : undefined));
    expect(m.flags[i] & MFLAG.guard).not.toBe(0); // guard back up
  });

  it('never bashes a player behind its shield (flanking is the counterplay)', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const i = placeMonster(a.world, 'shieldbearer', 24, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    m.aim[i] = 0; // facing away from her
    m.attackCd[i] = 0;
    let bashes = 0;
    // It turns at SHIELD.turnRate: a player behind it stays behind for (π − π/3) / turnRate seconds.
    for (let t = 0; t < ticks((Math.PI * 2) / 3 / SHIELD.turnRate - 0.2); t++) bashes += attacksOf(step(a), 'shieldbearer', 'bash').length;
    expect(bashes).toBe(0);
    expect(a.player.life).toBe(1e6);
  });
});

describe('Tar Slinger', () => {
  it('lobs tar where its target is; the pool slows by half and roots (tar) on first contact only', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const s = placeMonster(a.world, 'tarSlinger', 200, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    const glob = stepUntil(a, 8, () => projectilesOf(a.world, 'tarGlob')[0]);
    expect(glob).toBeDefined();
    expect(a.world.projectiles.life[glob!]).toBeCloseTo(TAR.flight, 5); // a lob: the presenter draws its arc and landing ring
    m.attackCd[s] = 1e9;
    const pool = stepUntil(a, TAR.flight + 0.2, () => areasOf(a.world, 'tarPool')[0]);
    expect(pool).toBeDefined();
    expect(pool!.radius).toBe(TAR_POOL_RADIUS);
    expect(Math.hypot(pool!.x - a.player.x, pool!.y - a.player.y)).toBeLessThan(pool!.radius);
    step(a);
    const root = pv(a.run).debuffs.find((d) => d.id === 'rooted');
    expect(root?.source).toBe('tar');
    // Once free, walking inside the pool is half speed and it never roots again.
    for (let t = 0; t < ticks(ROOT_DURATION + 0.1); t++) step(a);
    expect(debuffIds(a)).not.toContain('rooted');
    a.player.x = pool!.x - 20;
    a.player.y = pool!.y;
    const x0 = a.player.x;
    let roots = 0;
    for (let t = 0; t < 10; t++) roots += step(a, walkDir(1, 0)).filter((e) => e.t === 'debuff' && e.debuff === 'rooted').length;
    expect(roots).toBe(0);
    expect((a.player.x - x0) / (10 * SIM_DT)).toBeCloseTo(toughStats().moveSpeed * 0.5, 0);
  });

  it("never starts a throw at a spot that is already tarred (a crowd of slingers can't flood it)", () => {
    const a = arena();
    a.player.invulnTime = 0;
    const slingers = [0, 1, 2].map((k) => placeMonster(a.world, 'tarSlinger', Math.cos(k * 2.1) * 200, Math.sin(k * 2.1) * 200, { life: 1e6, still: false }));
    const m = a.world.monsters;
    const prev = slingers.map(() => 0);
    let throws = 0;
    for (let t = 0; t < ticks(20); t++) {
      step(a);
      slingers.forEach((s, k) => {
        if (m.state[s] === MSTATE.cast && prev[k] !== MSTATE.cast) {
          throws++;
          const tarred = areasOf(a.world, 'tarPool').some((p) => Math.hypot(p.x - a.player.x, p.y - a.player.y) <= p.radius + TAR.tarredRadius);
          expect(tarred, 'a slinger started a throw at a tarred spot').toBe(false);
        }
        prev[k] = m.state[s];
      });
    }
    expect(throws).toBeGreaterThan(2);
    expect(monstersOf(a.world, 'tarSlinger')).toHaveLength(3);
  });

  it('never carpets the floor: a crowd of slingers keeps at most a few pools round a moving player', () => {
    const a = arena();
    a.player.invulnTime = 0;
    for (let k = 0; k < 6; k++) {
      placeMonster(a.world, 'tarSlinger', Math.cos(k * 1.05) * 210, Math.sin(k * 1.05) * 210, { life: 1e6, still: false });
    }
    let most = 0;
    const seen = new Set<object>();
    for (let t = 0; t < ticks(20); t++) {
      // She keeps moving (a slow circle), so every throw would aim at fresh ground.
      const ang = t * SIM_DT * 0.8;
      step(a, walkDir(Math.cos(ang), Math.sin(ang)));
      const near = areasOf(a.world, 'tarPool').filter((p) => Math.hypot(p.x - a.player.x, p.y - a.player.y) <= TAR.crowdRadius);
      for (const p of near) seen.add(p);
      most = Math.max(most, near.length);
    }
    expect(seen.size, 'the slingers stopped throwing altogether').toBeGreaterThan(8);
    // At most maxNear were thrown round her; one more may lie ahead where she walks.
    expect(most).toBeLessThanOrEqual(TAR.maxNear + 1);
  });
});

describe('numbers (GAME_SPEC §14: comparable to the Ashen Forge roster)', () => {
  const near = (v: number, ref: number, tol: number) => Math.abs(v / ref - 1) <= tol;
  it('swarmers ≈ Ashling, hunters ≈ Rift Stalker, artillery ≈ Cinder Spitter, bruisers ≈ Ironhide Brute', () => {
    const pairs = [['pitHound', 'ashling'], ['chainThrall', 'riftStalker'], ['ironCrossbowman', 'cinderSpitter'], ['shieldbearer', 'ironhideBrute']] as const;
    for (const [k, ref] of pairs) {
      const d = monsterDef(k);
      const r = monsterDef(ref);
      expect(near(d.life, r.life, 0.2), `${k} life ${d.life} vs ${ref} ${r.life}`).toBe(true);
      expect(near(d.xp, r.xp, 0.15), `${k} xp`).toBe(true);
      // Damage ≈ the reference's, a little under where the Coliseum adds a debuff the reference doesn't have.
      expect(d.damage / r.damage, `${k} damage`).toBeGreaterThanOrEqual(0.6);
      expect(d.damage / r.damage, `${k} damage`).toBeLessThanOrEqual(1.1);
    }
    expect(monsterDef('chainmaster')).toMatchObject({ life: monsterDef('ashboundHerald').life, damage: monsterDef('ashboundHerald').damage, xp: monsterDef('ashboundHerald').xp });
    expect(monsterDef('varkus')).toMatchObject({ life: monsterDef('cinderMatriarch').life, damage: monsterDef('cinderMatriarch').damage, xp: monsterDef('cinderMatriarch').xp });
  });

  it('the family is physical: every basic attack is physical damage', () => {
    for (const k of ['pitHound', 'chainThrall', 'ironCrossbowman', 'shieldbearer', 'tarSlinger', 'chainmaster', 'varkus'] as const) {
      expect(monsterDef(k).damageType).toBe('physical');
    }
  });
});
