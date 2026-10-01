// Cover heights (docs/atlas-rework/D-territory.md 10.8): tall props stop straight shots of both sides, low props are flown over,
// lobs and nova rings ignore cover, walk-through props never block, pierce counts bodies not walls, a shot that starts inside a
// prop's footprint leaves it, ranged brains hold their volley behind a wall, and aim lines stop at it.
import { describe, expect, it } from 'vitest';
import { PROP_COVER, coverOf } from '../../src/data/propCover';
import { PROP_KIND_CODES } from '../../src/net/protocol';
import { coverBlocked, coverClip, insideCover } from '../../src/sim/cover';
import { addProp } from '../../src/sim/props';
import { PROJ, projSpec, spawnProjectile } from '../../src/sim/projectiles';
import type { PropCover, PropKind } from '../../src/contracts/sim';
import type { World } from '../../src/sim/world';
import { makeArena, ofType, placeMonster, stepN, type Arena } from './helpers';
import { hold } from './helpers';
import { makeSkill, makeStats, makeConfig, makeJoin, TIER5, strongSkills, strongStats, STRONG_LOADOUT } from './fixtures';
import { createBot } from './bot';
import { createRunInternal } from '../../src/sim/run';
import { areaRadius, areaTheme } from '../../src/data/layouts/area';
import type { PlayerIntent } from '../../src/contracts/sim';

/** A hostile flat shot from (x, y) along +x (or `angle`). */
function shoot(w: World, kindName: keyof typeof PROJ, x: number, y: number, o: { flight?: number; angle?: number; hostile?: boolean; pierce?: number; owner?: number } = {}): number {
  const s = projSpec;
  s.kind = PROJ[kindName];
  s.hostile = o.hostile ?? true;
  s.owner = o.owner ?? 1;
  s.x = x;
  s.y = y;
  s.angle = o.angle ?? 0;
  s.speed = 300;
  s.range = 600;
  s.radius = 4;
  s.damage = 10;
  s.dtype = 0;
  s.critChance = 0;
  s.critMult = 1;
  s.ailmentChance = 0;
  s.pierce = o.pierce ?? 0;
  return spawnProjectile(w, s, o.flight ?? 0);
}

function arenaWith(cover: PropKind | null, radius = 10, at = 100, override?: PropCover): Arena {
  const a = makeArena();
  if (cover) {
    const p = addProp(a.world, cover, at, 0, radius, override ? { cover: override } : {});
    void p;
  }
  return a;
}

const lifeOf = (a: Arena) => a.run.view.players[0].life;
const maxLifeOf = (a: Arena) => a.run.view.players[0].maxLife;
const coverBlocks = (events: ReturnType<typeof ofType<'blocked'>>) => events.filter((e) => e.cover === true);

describe('the cover table', () => {
  it('classifies every prop kind', () => {
    for (const kind of PROP_KIND_CODES) expect(['tall', 'low', 'none']).toContain(PROP_COVER[kind]);
  });

  it('puts the tall obstacles tall and the low ones low, and a radius of 0 never blocks', () => {
    for (const k of ['pillar', 'standingStone', 'vat', 'hoist', 'ruinWall', 'obelisk', 'statue', 'sarcophagus', 'ribArch', 'iceColumn', 'gate'] as const) {
      expect(coverOf(k, 10), k).toBe('tall');
    }
    for (const k of ['rubble', 'crate', 'chainPost', 'brazier', 'bones', 'crystal', 'banner', 'altar', 'bellows', 'weaponRack', 'chest'] as const) {
      expect(coverOf(k, 10), k).toBe('low');
    }
    expect(coverOf('pillar', 0)).toBe('none');
    expect(coverOf('crate', 12, 'tall')).toBe('tall');
    expect(coverOf('ruinWall', 12, 'low')).toBe('low');
  });
});

describe('straight shots and cover', () => {
  it('a tall prop stops a hostile shot before it reaches the player and sparks a cover impact', () => {
    const a = arenaWith('pillar');
    a.player.x = 160;
    a.player.y = 0;
    shoot(a.world, 'crossbowBolt', 20, 0);
    const r = stepN(a.run, 60);
    expect(lifeOf(a)).toBe(maxLifeOf(a));
    const hits = coverBlocks(ofType(r.events, 'blocked'));
    expect(hits).toHaveLength(1);
    expect(hits[0].x).toBeGreaterThan(80);
    expect(hits[0].x).toBeLessThan(100);
    expect(a.world.projectiles.count).toBe(0);
  });

  it('a low prop is flown over: the same shot hits the player', () => {
    const a = arenaWith('crate', 12);
    a.player.x = 160;
    a.player.y = 0;
    shoot(a.world, 'crossbowBolt', 20, 0);
    const r = stepN(a.run, 60);
    expect(lifeOf(a)).toBeLessThan(maxLifeOf(a));
    expect(coverBlocks(ofType(r.events, 'blocked'))).toHaveLength(0);
  });

  it('a layout override flips a prop: a tall crate stack blocks, a low ruin wall does not', () => {
    const tall = arenaWith('crate', 12, 100, 'tall');
    tall.player.x = 160;
    shoot(tall.world, 'crossbowBolt', 20, 0);
    stepN(tall.run, 60);
    expect(lifeOf(tall)).toBe(maxLifeOf(tall));
    const low = arenaWith('ruinWall', 12, 100, 'low');
    low.player.x = 160;
    shoot(low.world, 'crossbowBolt', 20, 0);
    stepN(low.run, 60);
    expect(lifeOf(low)).toBeLessThan(maxLifeOf(low));
  });

  it('a walk-through prop (radius 0) never blocks, whatever its kind', () => {
    const a = arenaWith('pillar', 0);
    a.player.x = 160;
    shoot(a.world, 'crossbowBolt', 20, 0);
    stepN(a.run, 60);
    expect(lifeOf(a)).toBeLessThan(maxLifeOf(a));
  });

  it('a lob flies over a tall prop and lands on the player', () => {
    const a = arenaWith('pillar');
    a.player.x = 160;
    // A cinder spit lands after `flight` seconds where it was aimed: 140 u at 280 u/s.
    shoot(a.world, 'cinderSpit', 20, 0, { flight: 0.5 });
    const r = stepN(a.run, 70);
    expect(coverBlocks(ofType(r.events, 'blocked'))).toHaveLength(0);
    expect(a.world.projectiles.count).toBe(0);
  });

  it('a nova ring bursts over cover; a player lance does not', () => {
    const a = arenaWith('pillar');
    const m = placeMonster(a.world, 'ashling', 140, 0, { life: 1e6 });
    shoot(a.world, 'novaFlame', 20, 0, { hostile: false });
    stepN(a.run, 40);
    expect(a.world.monsters.life[m]).toBeLessThan(1e6);
    const b = arenaWith('pillar');
    const m2 = placeMonster(b.world, 'ashling', 140, 0, { life: 1e6 });
    shoot(b.world, 'emberLance', 20, 0, { hostile: false });
    const r = stepN(b.run, 40);
    expect(b.world.monsters.life[m2]).toBe(1e6);
    expect(coverBlocks(ofType(r.events, 'blocked'))).toHaveLength(1);
  });

  it('a piercing shot stops at tall cover (pierce counts bodies, not walls) and never reaches bodies behind it', () => {
    const a = arenaWith('pillar', 10, 120);
    const front = placeMonster(a.world, 'ashling', 60, 0, { life: 1e6 });
    const back = placeMonster(a.world, 'ashling', 180, 0, { life: 1e6 });
    shoot(a.world, 'emberLance', 20, 0, { hostile: false, pierce: -1 });
    const r = stepN(a.run, 60);
    expect(a.world.monsters.life[front]).toBeLessThan(1e6);
    expect(a.world.monsters.life[back]).toBe(1e6);
    expect(coverBlocks(ofType(r.events, 'blocked'))).toHaveLength(1);
    expect(a.world.projectiles.count).toBe(0);
  });

  it('a body in front of the wall is hit before the wall stops the shot (travel order)', () => {
    const a = arenaWith('pillar', 10, 120);
    const front = placeMonster(a.world, 'ashling', 60, 0, { life: 1e6 });
    shoot(a.world, 'emberLance', 20, 0, { hostile: false, pierce: 0 });
    stepN(a.run, 60);
    expect(a.world.monsters.life[front]).toBeLessThan(1e6);
  });

  it('a shot that starts inside a prop leaves it instead of vanishing', () => {
    const a = arenaWith('pillar', 12, 0);
    a.player.x = 160;
    const slot = shoot(a.world, 'crossbowBolt', 4, 0);
    stepN(a.run, 2);
    expect(a.world.projectiles.alive[slot]).toBe(1);
    stepN(a.run, 60);
    expect(lifeOf(a)).toBeLessThan(maxLifeOf(a));
    expect(insideCover(a.world.propGrid, 4, 0)).toBe(true);
  });

  it('a player pressed against a tall prop does not shoot through it', () => {
    const a = arenaWith('pillar', 10, 20);
    a.player.x = 20 - 10 - 7; // touching the pillar's west edge
    a.player.y = 0;
    const m = placeMonster(a.world, 'ashling', 80, 0, { life: 1e6 });
    stepN(a.run, 90, hold(0, 200, 0));
    expect(a.world.monsters.life[m]).toBe(1e6);
  });

  it('Arc Chain needs a line: a monster behind tall cover is not struck, one in the clear is', () => {
    const arc = makeSkill('arcChain', 1, { level: 10 });
    const a = makeArena({ skills: [arc], loadout: ['arcChain', null, null, null, null, null], stats: makeStats() });
    addProp(a.world, 'pillar', 60, 0, 10);
    const behind = placeMonster(a.world, 'ashling', 110, 0, { life: 1e6 });
    stepN(a.run, 60, hold(0, 110, 0));
    expect(a.world.monsters.life[behind]).toBe(1e6);
    const b = makeArena({ skills: [arc], loadout: ['arcChain', null, null, null, null, null], stats: makeStats() });
    addProp(b.world, 'crate', 60, 0, 12);
    const open = placeMonster(b.world, 'ashling', 110, 0, { life: 1e6 });
    stepN(b.run, 60, hold(0, 110, 0));
    expect(b.world.monsters.life[open]).toBeLessThan(1e6);
  });
});

describe('cover queries', () => {
  it('coverBlocked / coverClip see a pillar between two points and clip a line where it stops', () => {
    const a = arenaWith('pillar', 10, 100);
    expect(coverBlocked(a.world, 0, 0, 200, 0, 2)).toBe(true);
    expect(coverBlocked(a.world, 0, 0, 80, 0, 2)).toBe(false);
    expect(coverBlocked(a.world, 0, 40, 200, 40, 2)).toBe(false);
    expect(coverClip(a.world, 0, 0, 0, 300, 2)).toBeCloseTo(88, 0);
    expect(coverClip(a.world, 0, 40, 0, 300, 2)).toBe(300);
  });

  it('a long line is sampled all the way: a wall 400 u out still blocks', () => {
    const a = arenaWith('pillar', 10, 400);
    expect(coverBlocked(a.world, 0, 0, 500, 0, 2)).toBe(true);
  });
});

describe('ranged brains and cover', () => {
  /** A crossbowman (or any shooter) at x = -160 and the player at x = 160 with a wall of pillars between them. */
  function standoff(kind: 'ironCrossbowman' | 'frostWeaver' | 'boneThrall', wall: boolean) {
    const a = makeArena({ stats: makeStats({ maxLife: 1e9 }) });
    if (wall) for (let y = -300; y <= 300; y += 16) addProp(a.world, 'pillar', 0, y, 10);
    a.player.x = 160;
    a.player.y = 0;
    const i = placeMonster(a.world, kind, -160, 0, { still: false });
    return { a, i };
  }

  for (const kind of ['ironCrossbowman', 'frostWeaver'] as const) {
    it(`${kind} never spends a volley on a wall between it and its target, and keeps moving`, () => {
      const { a, i } = standoff(kind, true);
      let absorbed = 0;
      let moved = 0;
      let lastX = a.world.monsters.x[i];
      for (let t = 0; t < 900; t++) {
        const r = stepN(a.run, 1);
        absorbed += coverBlocks(ofType(r.events, 'blocked')).length;
        const x = a.world.monsters.x[i];
        if (Math.abs(x - lastX) > 0.01) moved++;
        lastX = x;
      }
      expect(absorbed).toBe(0);
      expect(moved).toBeGreaterThan(100); // it walked up to the wall (closing in), not frozen in place at range
      expect(a.world.monsters.x[i]).toBeGreaterThan(-160 + 40);
    });

    it(`${kind} still shoots when the way is clear`, () => {
      const { a } = standoff(kind, false);
      let shots = 0;
      for (let t = 0; t < 900; t++) {
        const r = stepN(a.run, 1);
        shots += ofType(r.events, 'monsterAttack').filter((e) => e.attack === 'bolt' || e.attack === 'web').length;
      }
      expect(shots).toBeGreaterThan(0);
    });
  }

  it('the crossbow aim line stops where the wall would stop the bolt, and no line is drawn into a wall at all', () => {
    // With a wall the crossbowman holds fire; with only a short pillar off to the side the line (when drawn) is clipped.
    const a = makeArena({ stats: makeStats({ maxLife: 1e9 }) });
    a.player.x = 150;
    a.player.y = 0;
    addProp(a.world, 'pillar', 250, 0, 12); // behind the player: it clips the line, not the shot at the player
    placeMonster(a.world, 'ironCrossbowman', -150, 0, { still: false });
    let longest = 0;
    for (let t = 0; t < 600 && longest === 0; t++) {
      stepN(a.run, 1);
      for (const ar of a.world.areas) if (!ar.dead && ar.kind === 'chargeLine') longest = Math.max(longest, ar.radius);
    }
    expect(longest).toBeGreaterThan(0);
    // The bolt's range is 420 u from x = -150: the pillar's near face at x = 238 clips the line (~380 u) short of the full range.
    expect(longest).toBeLessThan(400);
  });
});

describe('determinism with cover', () => {
  /** A layout run (walls with cover overrides, crossbowmen, lobs) driven by the bot: its intents and a digest every 300 ticks. */
  function play(areaId: 'ironMarch' | 'gildedVault', recorded?: PlayerIntent[]) {
    const { run } = createRunInternal(makeConfig({ theme: areaTheme(areaId), seed: 77, arenaRadius: areaRadius(areaId), scaling: { ...TIER5, hazards: true }, areaId }));
    run.addPlayer(makeJoin(1, { stats: strongStats(), skills: strongSkills(), loadout: STRONG_LOADOUT }));
    const bot = createBot();
    const intents: PlayerIntent[] = [];
    const digests: number[] = [];
    let covers = 0;
    for (let t = 0; t < 2400; t++) {
      const intent = recorded ? recorded[t] : bot.intent(run.view, 1);
      if (!recorded) intents.push(structuredClone(intent));
      run.setIntent(1, intent);
      run.step();
      for (const e of run.drainEvents()) if (e.t === 'blocked' && e.cover) covers++;
      run.drainOutcomes();
      if (t % 300 === 299) digests.push(run.digest());
    }
    return { intents, digests, covers };
  }

  for (const areaId of ['ironMarch', 'gildedVault'] as const) {
    it(`${areaId}: two runs with the same intents give identical digests and the same cover impacts`, () => {
      const a = play(areaId);
      const b = play(areaId, a.intents);
      expect(b.digests).toEqual(a.digests);
      expect(b.covers).toBe(a.covers);
    });
  }
});
