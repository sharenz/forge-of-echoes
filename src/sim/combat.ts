// Damage resolution for both sides, ailments and kill credit.
import type { PlayerDebuff } from '../contracts/bestiary';
import { DAMAGE_TYPES, type DamageType, type MonsterKind } from '../contracts/content';
import { MONSTER_ANIM, type MonsterRarity, type RootSource, type SimEvent } from '../contracts/sim';
import { ELITE, KIND_BY_INDEX, KIND_INDEX } from './archetypes';
import { removeOwnedAreas, spawnArea } from './areas';
import {
  CHILL_DURATION, EVASION_CAP, HIT_ANIM, IGNITE_DURATION, IGNITE_EVENT_INTERVAL, IGNITE_FRACTION,
  CORPSE_LIFETIME, CORPSE_MEMORY, KNOCKBACK_MAX, KNOCKBACK_MIN, MELEE_CAP_FRACTION, MELEE_CAP_WINDOW_TICKS, RESIST_CAP, ROLL_MAX,
  ROLL_MIN,
  SHOCK_BONUS, SHOCK_DURATION, WARD_REDUCTION_CAP, WARDED_REDUCTION,
} from './constants';
import { applyDebuff, cleanseAll, clearDebuffs, effectiveResist, isActive, shockMult } from './debuffs';
import { rollKillLoot } from './hooks';
import { mapEventKill } from './map-events';
import { grantXp, spawnDrops } from './loot';
import { DAMAGE_INDEX, damageTypeAt } from './math';
import { refreshLiving } from './player';
import { monsterDefs } from './rosters';
import { MFLAG } from './stores';
import type { PlayerState, World } from './world';

export const DT_PHYSICAL = DAMAGE_INDEX.physical;
export const DT_FIRE = DAMAGE_INDEX.fire;
export const DT_COLD = DAMAGE_INDEX.cold;
export const DT_LIGHTNING = DAMAGE_INDEX.lightning;
export const DT_VOID = DAMAGE_INDEX.void;

const DUMMY = KIND_INDEX.trainingDummy;

const RARITY_NAMES: readonly MonsterRarity[] = ['normal', 'magic', 'rare', 'normal', 'normal'];

/** Whether a monster can currently be hit (alive, not spawning, not phase-immune). */
export function isHittable(w: World, i: number): boolean {
  const m = w.monsters;
  return m.alive[i] === 1 && m.spawnTime[i] <= 0 && (m.flags[i] & MFLAG.immune) === 0;
}

/**
 * Player damage on monster slot `i`. `amount` is the average hit (the skill's resolved damage);
 * this rolls ×0.8–1.2, then crit, then the target's resistance, shock, Warded and (for `hit`s on
 * an armoured monster such as the Ironhide Brute) armour. `dir` pushes the target back (knockback 2–4 units, scaled by `knock`
 * and the monster's susceptibility; the pending push never exceeds the 4-unit cap however many
 * hits land at once). `hit` = false marks burning damage (ward embers, fire trails), which armour
 * (MonsterDef.hitReduction) does not reduce. `source` is the player id credited with the damage (0 = nobody). Returns true
 * when this call killed the monster (it received the kill credit).
 */
export function damageMonster(
  w: World, i: number, amount: number, dtype: number, critChance: number, critMult: number, ailmentChance: number,
  dirX: number, dirY: number, knock: number, hit = true, source = 0,
): boolean {
  if (!isHittable(w, i) || amount <= 0) return false;
  const m = w.monsters;
  const rng = w.combatRng;
  let dmg = amount * rng.range(ROLL_MIN, ROLL_MAX);
  let crit = false;
  if (critChance > 0 && rng.next() < critChance) {
    crit = true;
    dmg *= critMult > 1 ? critMult : 1.5;
  }
  // Ailments build from the resisted hit; shock, Warded and armour apply to the hit itself (and
  // live, per tick, to the burn), so a brute's armour is the thing ignite gets around.
  const resisted = dmg * (1 - Math.min(RESIST_CAP, m.res[i * 5 + dtype]));
  if (ailmentChance > 0) applyAilment(w, i, resisted, dtype, ailmentChance, source);
  dmg = resisted * takenMult(w, i);
  if (hit && m.hitReduction[i] > 0) dmg *= 1 - m.hitReduction[i];
  if (knock > 0 && m.knockback[i] > 0) {
    const l = Math.hypot(dirX, dirY);
    if (l > 1e-6) {
      const kb = rng.range(KNOCKBACK_MIN, KNOCKBACK_MAX) * m.knockback[i] * knock;
      let kx = m.kbX[i] + (dirX / l) * kb;
      let ky = m.kbY[i] + (dirY / l) * kb;
      const kl = Math.hypot(kx, ky);
      const cap = KNOCKBACK_MAX * m.knockback[i];
      if (kl > cap) {
        kx *= cap / kl;
        ky *= cap / kl;
      }
      m.kbX[i] = kx;
      m.kbY[i] = ky;
    }
  }
  m.hitFlash[i] = 1;
  wakePack(w, i);
  // Whoever hurts a monster draws its attention (unless it is locked on a closer player).
  if (source > 0 && m.target[i] === 0) m.target[i] = source;
  return applyMonsterDamage(w, i, dmg, dtype, crit, source);
}

/** Current damage-taken multiplier of a monster (shock, Warded). */
function takenMult(w: World, i: number): number {
  const m = w.monsters;
  let f = 1;
  if (m.shockTime[i] > 0) f *= 1 + SHOCK_BONUS;
  if (m.flags[i] & MFLAG.shielded) f *= 1 - WARDED_REDUCTION;
  return f;
}

function applyMonsterDamage(w: World, i: number, dmg: number, dtype: number, crit: boolean, source: number): boolean {
  const m = w.monsters;
  const dummy = m.kind[i] === DUMMY;
  m.life[i] -= dmg;
  const killed = !dummy && m.life[i] <= 0;
  // Crits, killing blows and dummy hits always show; plain hits are the first to go under load.
  if (crit || killed || dummy) w.events.push(monsterHitEvent(w, i, dmg, dtype, crit, killed, source));
  else if (w.events.lowOpen) w.events.low(monsterHitEvent(w, i, dmg, dtype, crit, killed, source));
  if (dummy) {
    // The training dummy never dies: it resets and plays its "struck" animation.
    if (m.life[i] < m.maxLife[i] * 0.02) m.life[i] = m.maxLife[i];
    m.anim[i] = MONSTER_ANIM.attack;
    m.animTime[i] = 0;
    m.stateTime[i] = 0.35;
    return false;
  }
  if (killed) killMonster(w, i, dtype, true, source);
  return killed;
}

function monsterHitEvent(w: World, i: number, amount: number, dtype: number, crit: boolean, killed: boolean, source: number): SimEvent {
  const m = w.monsters;
  // A burn or projectile outliving its player (they left) is credited to nobody.
  const playerId = source > 0 && w.playerById[source] ? source : 0;
  return {
    t: 'hit', playerId, x: m.x[i], y: m.y[i], amount, damageType: damageTypeAt(dtype), crit, target: 'monster', killed,
    kind: KIND_BY_INDEX[m.kind[i]],
  };
}

function applyAilment(w: World, i: number, hitDamage: number, dtype: number, chance: number, source: number): void {
  if (dtype !== DT_FIRE && dtype !== DT_COLD && dtype !== DT_LIGHTNING) return;
  if (w.combatRng.next() >= chance) return;
  const m = w.monsters;
  let fresh: boolean;
  let name: 'burning' | 'chilled' | 'shocked';
  if (dtype === DT_FIRE) {
    fresh = m.igniteTime[i] <= 0;
    const dps = (hitDamage * IGNITE_FRACTION) / IGNITE_DURATION;
    // Ignites don't stack: the strongest burn wins (and its player gets the credit); the
    // duration refreshes.
    if (fresh || dps >= m.igniteDps[i]) {
      m.igniteDps[i] = dps;
      m.igniteSrc[i] = source;
    }
    if (fresh) m.igniteEventTimer[i] = IGNITE_EVENT_INTERVAL;
    m.igniteTime[i] = IGNITE_DURATION;
    name = 'burning';
  } else if (dtype === DT_COLD) {
    fresh = m.chillTime[i] <= 0;
    m.chillTime[i] = CHILL_DURATION;
    name = 'chilled';
  } else {
    fresh = m.shockTime[i] <= 0;
    m.shockTime[i] = SHOCK_DURATION;
    name = 'shocked';
  }
  if (fresh && w.events.lowOpen) w.events.low({ t: 'ailment', ailment: name, x: m.x[i], y: m.y[i] });
}

/**
 * Burning damage over time for one tick. Returns true if the burn killed the monster.
 * While a monster is phase-immune (the Matriarch's roar) the burn keeps running out but deals
 * nothing, so it can never finish her mid-transition.
 */
export function tickIgnite(w: World, i: number, dt: number): boolean {
  const m = w.monsters;
  if (m.igniteTime[i] <= 0) return false;
  const step = Math.min(dt, m.igniteTime[i]);
  const dmg = m.flags[i] & MFLAG.immune ? 0 : m.igniteDps[i] * step * takenMult(w, i);
  m.igniteTime[i] -= dt;
  if (m.igniteTime[i] <= 0) {
    m.igniteTime[i] = 0;
    m.igniteDps[i] = 0;
  }
  m.igniteAccum[i] += dmg;
  m.igniteEventTimer[i] -= dt;
  const dummy = m.kind[i] === DUMMY;
  const source = m.igniteSrc[i];
  m.life[i] -= dmg;
  const killed = !dummy && m.life[i] <= 0;
  if (killed || m.igniteEventTimer[i] <= 0 || m.igniteTime[i] <= 0) {
    if (killed) w.events.push(monsterHitEvent(w, i, m.igniteAccum[i], DT_FIRE, false, true, source));
    else if (m.igniteAccum[i] >= 0.5 && w.events.lowOpen) {
      w.events.low(monsterHitEvent(w, i, m.igniteAccum[i], DT_FIRE, false, false, source));
    }
    m.igniteAccum[i] = 0;
    m.igniteEventTimer[i] = IGNITE_EVENT_INTERVAL;
  }
  if (m.igniteTime[i] <= 0) m.igniteSrc[i] = 0;
  if (dummy && m.life[i] < m.maxLife[i] * 0.02) m.life[i] = m.maxLife[i];
  if (killed) killMonster(w, i, DT_FIRE, true, source);
  return killed;
}

export function wakePack(w: World, i: number): void {
  const pk = w.monsters.pack[i];
  if (pk >= 0) w.packs[pk].aggro = true;
}

/** Ids of the living players, in join order (who gets instanced loot). */
export function livingIds(w: World): number[] {
  const out: number[] = [];
  for (const p of w.living) out.push(p.id);
  return out;
}

/**
 * Remove a monster. `credited` kills (a player's hit crossed zero) grant the kill outcome, loot,
 * on-kill recovery and elite death effects; uncredited deaths (crumbling to ash after the boss)
 * still grant their XP. `source` is the killing player's id (0 = nobody present, e.g. a
 * burn from someone who left): the kill still counts and still drops loot for everyone.
 *
 * The death is committed (slot released, pack/boss bookkeeping done, outcomes pushed) before the
 * server's loot hook is called, so a hook that throws can't leave a half-dead monster behind.
 */
export function killMonster(w: World, i: number, dtype: number, credited: boolean, source = 0): void {
  const m = w.monsters;
  if (!m.alive[i]) return;
  const kind = KIND_BY_INDEX[m.kind[i]];
  const x = m.x[i];
  const y = m.y[i];
  const flags = m.flags[i];
  const mods = m.mods[i];
  const damage = m.damage[i];
  const xp = m.xp[i];
  const wave = m.wave[i];
  const isBoss = (flags & MFLAG.boss) !== 0;
  const isLieutenant = (flags & MFLAG.lieutenant) !== 0;
  const summoned = (flags & MFLAG.summoned) !== 0;
  const rarity = RARITY_NAMES[m.rarity[i]];
  const def = monsterDefs()[m.kind[i]];
  w.events.push({ t: 'death', kind, rarity: m.rarity[i], x, y, facing: m.facing[i], damageType: damageTypeAt(dtype) });

  const pk = m.pack[i];
  if (pk >= 0) {
    const pack = w.packs[pk];
    pack.alive--;
    if (pack.alive <= 0) pack.active = false;
  }
  removeOwnedAreas(w, m.id[i]);
  if (w.memory.size > 0) w.memory.delete(m.id[i]);
  const eventReward = mapEventKill(w, m.id[i], credited);
  m.release(i);
  recordCorpse(w, kind, x, y);
  if (isBoss) {
    w.director.bossDefeated = true;
    w.director.bossDeathX = x;
    w.director.bossDeathY = y;
    // The map is won (the director clears it next tick, after the players' own update): lift the
    // survivors' debuffs now, so no burn or bleed ticks in between.
    for (const p of w.living) cleanseAll(w, p);
  }
  def.onDeath?.(w, x, y, credited);

  if (credited) {
    w.kills++;
    const killer = source > 0 ? w.playerById[source] : undefined;
    w.outcomes.push({ t: 'kill', playerId: killer ? killer.id : 0, kind, rarity, isLieutenant, isBoss });
    if (isBoss) w.outcomes.push({ t: 'bossDefeated' });
    if (killer && !killer.dead) {
      const s = killer.stats;
      if (s.lifeOnKill > 0) killer.life = Math.min(s.maxLife, killer.life + s.lifeOnKill);
      if (s.focusOnKill > 0) killer.focus = Math.min(s.maxFocus, killer.focus + s.focusOnKill);
    }
    if (mods & ELITE.emberTouched) {
      spawnArea(w, 'eruptionWarning', x, y, 44, 0.9, { damage: damage * 1.5, dtype: DT_FIRE, hurts: 'player' });
    }
    // Instanced loot: one roll call covering every living player (the dead can't pick anything up
    // and leave by respawning). Summoned minions never roll loot: stalling a summoner would
    // otherwise be an endless farm.
    if (!summoned && w.living.length > 0) {
      const specs = rollKillLoot(w, { kind, summoned, rarity, isLieutenant, isBoss, wave, x, y, ...(eventReward ? { eventReward } : {}) }, livingIds(w));
      if (specs.length > 0) spawnDrops(w, specs, x, y, isBoss || isLieutenant || rarity === 'rare');
    }
  }
  if (xp > 0) grantXp(w, xp);
}

export type PlayerHitKind = 'melee' | 'projectile' | 'area' | 'dot';

/**
 * Damage one player, optionally with a debuff rider. Order: invulnerability → evasion (attacks only:
 * an evaded hit carries no debuff either) → roll → armour (physical) → resistance (withered lowers
 * it) → damageTaken → shocked → Cinder Ward → melee window cap (per player). A hit that connects
 * applies `debuff` (with the damage dealt, which burning and bleeding scale with; `source` for
 * roots) — also a zero-damage hit such as a web shot, or one the melee cap absorbed. A hit that kills
 * applies nothing. Returns the damage dealt (0 when it didn't connect).
 */
export function damagePlayer(
  w: World, p: PlayerState, amount: number, dtype: number, kind: PlayerHitKind, debuff: PlayerDebuff | null = null,
  source?: RootSource,
): number {
  const r = hitPlayer(w, p, amount, dtype, kind, debuff, source);
  return r > 0 ? r : 0;
}

/**
 * damagePlayer that also tells whether the hit connected: −1 when it didn't (dead, invulnerable,
 * evaded, or nothing to deal), else the damage dealt (0 for a zero-damage hit carrying a debuff).
 * Follow-ups such as a knockback or a chain hook's pull go on a connecting hit only.
 *
 * Fairness guard (GAME_SPEC §13: every root and freeze comes from a projectile you can see or a
 * telegraph you can read): a 'melee' hit never carries 'frozen' or 'rooted' — the rider is dropped.
 */
export function hitPlayer(
  w: World, p: PlayerState, amount: number, dtype: number, kind: PlayerHitKind, debuff: PlayerDebuff | null = null,
  source?: RootSource,
): number {
  if (p.dead || p.invulnTime > 0) return -1;
  if (kind === 'melee' && (debuff === 'frozen' || debuff === 'rooted')) debuff = null;
  const damaging = amount > 0;
  if (!damaging && !debuff) return -1;
  const s = p.stats;
  const rng = w.combatRng;
  if ((kind === 'melee' || kind === 'projectile') && s.evasion > 0 && rng.next() < Math.min(EVASION_CAP, s.evasion)) {
    w.events.push({ t: 'evade', playerId: p.id, x: p.x, y: p.y, target: 'player' });
    return -1;
  }
  let dmg = 0;
  const type: DamageType = DAMAGE_TYPES[dtype];
  if (damaging) {
    dmg = kind === 'dot' ? amount : amount * rng.range(ROLL_MIN, ROLL_MAX);
    if (dtype === DT_PHYSICAL && s.armor > 0) dmg *= 1 - s.armor / (s.armor + 10 * dmg);
    dmg *= 1 - effectiveResist(p, type);
    if (Number.isFinite(s.damageTaken) && s.damageTaken >= 0) dmg *= s.damageTaken;
    if (isActive(p, 'shocked')) dmg *= shockMult(p);
    if (p.ward.time > 0) dmg *= 1 - Math.min(WARD_REDUCTION_CAP, Math.max(0, p.ward.reduction));
    if (kind === 'melee') {
      const allowed = MELEE_CAP_FRACTION * s.maxLife - p.meleeSum;
      dmg = Math.min(dmg, Math.max(0, allowed));
      p.meleeWindow[w.tick % MELEE_CAP_WINDOW_TICKS] += dmg;
      p.meleeSum += dmg;
    }
  }
  if (dmg > 0) {
    p.life -= dmg;
    p.hitFlash = 1;
    if (!p.cast && p.dashTime <= 0) p.hitTime = HIT_ANIM;
    w.events.push({
      t: 'hit', playerId: p.id, x: p.x, y: p.y, amount: dmg, damageType: type, crit: false, target: 'player', killed: p.life <= 0,
    });
    if (p.life <= 0) {
      killPlayer(w, p);
      return dmg;
    }
  }
  if (debuff) applyDebuff(w, p, debuff, dmg, source);
  return dmg;
}

/**
 * A player falls: they stay in the instance as a corpse (anim 'death') until the app removes them.
 * Allies fight on; monsters lose interest in the body.
 */
export function killPlayer(w: World, p: PlayerState): void {
  if (p.dead) return;
  p.dead = true;
  p.life = 0;
  p.cast = null;
  p.anim = 'death';
  p.animTime = 0;
  p.vx = 0;
  p.vy = 0;
  p.ward.time = 0;
  p.pendingNovas.length = 0;
  p.portalDwell = 0;
  p.portalDwellId = 0;
  for (const f of p.flasks) if (f) f.active = 0;
  clearDebuffs(w, p);
  refreshLiving(w);
  w.events.push({ t: 'playerDeath', playerId: p.id, x: p.x, y: p.y });
  w.outcomes.push({ t: 'playerDied', playerId: p.id });
}

/** Remember a death for corpse-raising (a fixed ring: the oldest entry is overwritten). */
function recordCorpse(w: World, kind: MonsterKind, x: number, y: number): void {
  const list = w.corpses;
  if (list.length < CORPSE_MEMORY) {
    list.push({ kind, x, y, time: w.time, used: false });
    return;
  }
  const c = list[w.corpseCursor];
  w.corpseCursor = (w.corpseCursor + 1) % CORPSE_MEMORY;
  c.kind = kind;
  c.x = x;
  c.y = y;
  c.time = w.time;
  c.used = false;
}

/**
 * Take (mark used) up to `max` unused corpses within `radius` of (x, y) that died at most
 * CORPSE_LIFETIME ago — of `kind` only when given — nearest first, and return where they lie (for
 * raising). Summoned minions leave corpses too.
 */
export function takeCorpses(w: World, x: number, y: number, radius: number, max: number, kind?: MonsterKind): { x: number; y: number }[] {
  const found: { k: number; d2: number }[] = [];
  const r2 = radius * radius;
  const list = w.corpses;
  for (let k = 0; k < list.length; k++) {
    const c = list[k];
    if (c.used || w.time - c.time > CORPSE_LIFETIME || (kind !== undefined && c.kind !== kind)) continue;
    const dx = c.x - x;
    const dy = c.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2) found.push({ k, d2 });
  }
  found.sort((a, b) => a.d2 - b.d2 || a.k - b.k);
  const out: { x: number; y: number }[] = [];
  for (let n = 0; n < found.length && n < max; n++) {
    const c = list[found[n].k];
    c.used = true;
    out.push({ x: c.x, y: c.y });
  }
  return out;
}
