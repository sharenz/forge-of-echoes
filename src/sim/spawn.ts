// Monster and pack creation. All life/damage/speed numbers flow from the kind's MonsterDef (rosters/)
// through MonsterScaling, per-wave growth, elite modifiers and the party size.
import type { MonsterKind } from '../contracts/content';
import { MONSTER_ANIM, RARITY_CODE, type MonsterRarity } from '../contracts/sim';
import { KIND_INDEX, RARITY_XP, eliteDamageMult, eliteLifeMult, eliteSpeedMult } from './archetypes';
import { PARTY_LIFE_PER_PLAYER, SPAWN_ANIM_TIME, WAVE_DAMAGE_GROWTH, WAVE_LIFE_GROWTH } from './constants';
import { DAMAGE_INDEX, GOLDEN_ANGLE, TAU } from './math';
import { nearestLiving } from './player';
import { monsterDefs } from './rosters';
import { MFLAG } from './stores';
import type { Pack, World } from './world';

/** Party size used for scaling: the living players (at least 1). */
export function partySize(w: World): number {
  return Math.max(1, w.living.length);
}

/** Monster life multiplier for the current party: ×(1 + 0.5·(n−1)). */
export function partyLifeMult(w: World): number {
  return 1 + PARTY_LIFE_PER_PLAYER * (partySize(w) - 1);
}

export interface SpawnOptions {
  rarity?: MonsterRarity;
  mods?: number;
  pack?: number;
  wave?: number;
  lieutenant?: boolean;
  boss?: boolean;
  /** Play the 0.5 s spawn animation (invulnerable) and emit 'monsterSpawn'. Default true. */
  animate?: boolean;
}

/** Spawn one monster; returns its slot or -1 when the store is full. */
export function spawnMonster(w: World, kind: MonsterKind, x: number, y: number, opts: SpawnOptions = {}): number {
  const m = w.monsters;
  const i = m.alloc();
  if (i < 0) return -1;
  const kindIndex = KIND_INDEX[kind];
  const a = monsterDefs()[kindIndex];
  const s = w.config.monsters;
  const rarity = opts.rarity ?? 'normal';
  const mods = opts.mods ?? 0;
  const wave = Math.max(1, opts.wave ?? w.director.wave);
  const isDummy = kind === 'trainingDummy';
  // Life scales with the party present at spawn time (a later join doesn't buff living monsters).
  const lifeMult = isDummy ? 1 : s.lifeMultiplier * (1 + WAVE_LIFE_GROWTH * (wave - 1)) * eliteLifeMult(mods) * partyLifeMult(w);
  const dmgMult = s.damageMultiplier * (1 + WAVE_DAMAGE_GROWTH * (wave - 1)) * eliteDamageMult(mods);
  const rng = w.worldRng;
  const animate = opts.animate ?? true;

  m.kind[i] = kindIndex;
  m.rarity[i] = opts.boss ? RARITY_CODE.boss : opts.lieutenant ? RARITY_CODE.lieutenant : RARITY_CODE[rarity];
  m.x[i] = x;
  m.y[i] = y;
  m.prevX[i] = x;
  m.prevY[i] = y;
  m.radius[i] = a.radius * (rarity === 'rare' ? 1.15 : 1);
  const near = nearestLiving(w, x, y);
  m.facing[i] = near && near.x < x ? -1 : 1;
  if (near) m.target[i] = near.id;
  m.anim[i] = animate ? MONSTER_ANIM.spawn : MONSTER_ANIM.idle;
  m.spawnTime[i] = animate ? SPAWN_ANIM_TIME : 0;
  m.maxLife[i] = Math.max(1, a.life * lifeMult);
  m.life[i] = m.maxLife[i];
  m.speed[i] = a.speed * Math.max(0, s.speedMultiplier) * eliteSpeedMult(mods);
  m.damage[i] = a.damage * dmgMult;
  m.attackCd[i] = rng.range(0.3, 1.2);
  m.offsetAngle[i] = rng.range(0, TAU);
  m.phase[i] = rng.range(0, TAU);
  m.xp[i] = isDummy ? 0 : a.xp * RARITY_XP[rarity] * Math.max(0, s.xpMultiplier);
  m.knockback[i] = a.knockback;
  m.mods[i] = mods;
  m.dtype[i] = DAMAGE_INDEX[a.damageType];
  m.hitReduction[i] = a.hitReduction ?? 0;
  m.aim[i] = near ? Math.atan2(near.y - y, near.x - x) : 0;
  const heavy = opts.boss || opts.lieutenant || a.heavy === true;
  m.flags[i] =
    (opts.lieutenant ? MFLAG.lieutenant : 0) | (opts.boss ? MFLAG.boss : 0) | (isDummy ? MFLAG.unpushable : 0) | (heavy ? MFLAG.heavy : 0) |
    (a.ghost ? MFLAG.ghost : 0) | (a.block ? MFLAG.guard : 0);
  m.wave[i] = Math.min(255, wave);
  for (let k = 0; k < 5; k++) m.res[i * 5 + k] = a.resist[k] + (isDummy ? 0 : s.resistBonus);
  if (opts.pack !== undefined && opts.pack >= 0) {
    m.pack[i] = opts.pack;
    w.packs[opts.pack].alive++;
  }
  if (animate) w.events.push({ t: 'monsterSpawn', kind, rarity: m.rarity[i], x, y });
  return i;
}

/** Get a pooled pack record (reusing finished packs). */
export function allocPack(w: World, x: number, y: number, wave: number, stream: boolean, rarity: MonsterRarity, aggro: boolean): number {
  let idx = -1;
  for (let k = 0; k < w.packs.length; k++) {
    if (!w.packs[k].active && w.packs[k].alive <= 0) {
      idx = k;
      break;
    }
  }
  const pack: Pack = { active: true, homeX: x, homeY: y, goalX: x, goalY: y, aggro, alive: 0, wave, stream, rarity };
  if (idx < 0) {
    w.packs.push(pack);
    return w.packs.length - 1;
  }
  w.packs[idx] = pack;
  return idx;
}

/**
 * Spawn a group around a centre in a tight Vogel spiral (members don't start overlapping).
 * The first member of a rare pack is the rare leader.
 */
export function spawnGroup(
  w: World, members: readonly MonsterKind[], cx: number, cy: number, pack: number, rarity: MonsterRarity, mods: number, wave: number,
): void {
  const lim = w.arenaRadius - 20;
  for (let k = 0; k < members.length; k++) {
    const kind = members[k];
    const r = k === 0 ? 0 : 9 + 8 * Math.sqrt(k);
    const a = k * GOLDEN_ANGLE + w.packs[pack].homeX * 0.01;
    let x = cx + Math.cos(a) * r;
    let y = cy + Math.sin(a) * r;
    const d = Math.hypot(x, y);
    if (d > lim) {
      x *= lim / d;
      y *= lim / d;
    }
    const memberRarity: MonsterRarity = rarity === 'rare' ? (k === 0 ? 'rare' : 'normal') : rarity;
    const memberMods = rarity === 'rare' ? (k === 0 ? mods : 0) : mods;
    spawnMonster(w, kind, x, y, { rarity: memberRarity, mods: memberMods, pack, wave });
  }
}
