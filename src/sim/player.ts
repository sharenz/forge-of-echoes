// Players: joining, held-slot casting with charges/cooldowns and focus, flasks, regen, movement
// (through the shared `movePlayer` rules), animation state, live updates from the rules, and the
// PlayerView writer. Every function works on one PlayerState; the run steps them in join order.
import type { PlayerDebuff } from '../contracts/bestiary';
import type { SkillId } from '../contracts/content';
import { BELT_SLOTS, LOADOUT_SLOTS } from '../contracts/items';
import type {
  FlaskRuntime, FlaskSlotView, PlayerAnim, PlayerIntent, PlayerJoin, PlayerUpdate, PlayerView, RootSource, SkillRuntimeDef, SlotView,
} from '../contracts/sim';
import { areaSlowAt } from './area-geometry';
import {
  ALLY_PUSH_MAX, ALLY_PUSH_RATE, CROWD_CONE_COS, CROWD_CONTACT_PAD, CROWD_SLOW_FLOOR, CROWD_SLOW_PER_MONSTER, DT, FLASK_FX, HIT_FLASH_DECAY,
  INSTANT_RETRIGGER, NOT_ENOUGH_FOCUS_REPEAT, PLAYER_KNOCKBACK_MAX, PLAYER_KNOCKBACK_RATE, PLAYER_RADIUS,
  PULL_MAX_DISTANCE, PULL_TIME,
} from './constants';
import {
  DebuffState, applyDebuff, castRate, cleanseDebuffs, flaskActiveFx, isFrozen, moveSlowOf, restoreDebuffs, tickDebuffs, writeDebuffViews,
  type DebuffCarry,
} from './debuffs';
import { clamp, dirFromVector, finiteOr } from './math';
import { CAST_SLOW, combineSlow, playerFlowDrift, playerSlow, readMove, resolvePlayerAt, slowedSpeed } from './movement';
import { releaseSkill, tickFireTrail, tickPendingNovas, tickPendingStrikes, tickRoster2, tickRoster3, tickSelfBuffs, tickWard } from './skills';
import { surgeCastRate } from './skills/roster3-state';
import { passiveFlask, tickPassivePlayer } from './passives';
import { MFLAG, MSTATE } from './stores';
import { castCost, noteCast } from './skills/primitives/state';
import type { FlaskState, PlayerState, SkillChargeState, World } from './world';

function maxCharges(def: SkillRuntimeDef): number {
  return Math.max(1, Math.floor(def.charges));
}

function makeFlask(rt: FlaskRuntime): FlaskState {
  return { runtime: rt, count: rt.count, active: 0, rate: 0 };
}

function normaliseLoadout(loadout: readonly (SkillId | null)[]): (SkillId | null)[] {
  const out: (SkillId | null)[] = [];
  for (let k = 0; k < LOADOUT_SLOTS; k++) out.push(loadout[k] ?? null);
  return out;
}

export function emptyIntent(x: number, y: number): PlayerIntent {
  return { moveX: 0, moveY: 0, aimX: x, aimY: y + 40, held: new Array<boolean>(LOADOUT_SLOTS).fill(false), flask: -1 };
}

/** Copy a (possibly malformed) intent from the app into the player's own intent object. */
export function storeIntent(p: PlayerState, intent: PlayerIntent): void {
  const own = p.intent;
  own.moveX = finiteOr(intent.moveX, 0);
  own.moveY = finiteOr(intent.moveY, 0);
  own.aimX = finiteOr(intent.aimX, own.aimX);
  own.aimY = finiteOr(intent.aimY, own.aimY);
  const held = Array.isArray(intent.held) ? intent.held : [];
  for (let k = 0; k < LOADOUT_SLOTS; k++) own.held[k] = held[k] === true;
  own.flask = Number.isInteger(intent.flask) && intent.flask >= 0 && intent.flask < BELT_SLOTS ? intent.flask : -1;
}

/**
 * PlayerJoin plus optional vitals (not in the frozen contract): a player re-added to an instance
 * they briefly left (e.g. after a reconnect) resumes with this life and focus instead of full
 * ones, so dropping the connection is never a free heal. Clamped to 1..maxLife and 0..maxFocus.
 * `debuffs` does the same for debuffs (never a free cleanse): pass a copy of the entries of their
 * last PlayerView.debuffs, taken when they left — `view.debuffs.map((d) => ({ ...d }))` (the sim
 * reuses those objects; each carries `dps`, see SimDebuffView). They resume with their remaining
 * times (debuffs.ts restoreDebuffs).
 */
export type SimPlayerJoin = PlayerJoin & { life?: number; focus?: number; debuffs?: readonly DebuffCarry[] };

/**
 * PlayerUpdate plus the character level (not in the frozen contract). The level shown on
 * PlayerView changes only through this field; send it with every level-up.
 */
export type SimPlayerUpdate = PlayerUpdate & { level?: number };

export function createPlayer(join: SimPlayerJoin, x: number, y: number): PlayerState {
  const rt = join.runtime;
  const stats = rt.stats;
  const life = typeof join.life === 'number' && Number.isFinite(join.life) ? clamp(join.life, 1, stats.maxLife) : stats.maxLife;
  const focus = typeof join.focus === 'number' && Number.isFinite(join.focus) ? clamp(join.focus, 0, stats.maxFocus) : stats.maxFocus;
  const p: PlayerState = {
    id: join.id,
    name: String(join.name ?? ''),
    level: Math.max(1, Math.floor(finiteOr(join.level, 1))),
    intent: emptyIntent(x, y),
    view: createPlayerView(join.id),
    x, y, prevX: x, prevY: y, vx: 0, vy: 0,
    facing: 'south',
    aimX: x, aimY: y + 40,
    anim: 'idle', animTime: 0,
    life,
    focus,
    stats,
    flags: new Set(stats.flags),
    skills: new Map(),
    charges: new Map(),
    loadout: normaliseLoadout(rt.loadout),
    flasks: [],
    cast: null,
    ward: { time: 0, duration: 0, reduction: 0, pulse: 0, damage: 0, critChance: 0, critMultiplier: 1.5, ailmentChance: 0, radius: 40,
      dtype: 1, focusOnPulse: false, renewOnHit: false },
    invulnTime: 0, dashTime: 0, hitTime: 0, hitFlash: 0,
    dead: false, eventSlow: 0, noFlasks: false,
    prevHeld: new Array<boolean>(LOADOUT_SLOTS).fill(false),
    slotLock: new Float32Array(LOADOUT_SLOTS),
    focusWarnCd: 0,
    trailTimer: 0,
    pushX: 0, pushY: 0,
    pendingNovas: [],
    pendingStrikes: [],
    stride: { time: 0, speed: 0, evasion: 0 },
    restore: { time: 0, focusRate: 0, lifeRate: 0 },
    skillAreas: [],
    barrier: { amount: 0, max: 0, time: 0, chillRadius: 0, regen: 0, retort: 0, retortRadius: 0 },
    aegis: {
      time: 0, reduction: 0, radius: 0, damage: 0, critChance: 0, critMultiplier: 1.5, ailmentChance: 0, gap: 0, cooldown: 0, resist: 0,
      pulse: 0, pulseTimer: 0,
    },
    echoSigil: { casts: 0, time: 0, delay: 0, damage: 0, refund: 0 },
    portalLatch: 0,
    portalDwellId: 0,
    portalDwell: 0,
    debuffs: new DebuffState(),
    kbX: 0, kbY: 0,
    pullTime: 0, pullTotal: 0, pullFromX: 0, pullFromY: 0, pullToX: 0, pullToY: 0,
  };
  setSkills(p, rt.skills);
  for (let k = 0; k < BELT_SLOTS; k++) {
    const f = rt.flasks[k] ?? null;
    p.flasks.push(f ? makeFlask(f) : null);
  }
  if (Array.isArray(join.debuffs)) restoreDebuffs(p, join.debuffs);
  return p;
}

function setSkills(p: PlayerState, skills: readonly SkillRuntimeDef[]): void {
  const next = new Map<SkillId, SkillRuntimeDef>();
  for (const def of skills) next.set(def.id, def);
  const charges = new Map<SkillId, SkillChargeState>();
  for (const [id, def] of next) {
    const max = maxCharges(def);
    const prev = p.charges.get(id);
    const prevDef = p.skills.get(id);
    if (!prev || !prevDef) {
      charges.set(id, { charges: max, timer: 0 });
      continue;
    }
    // Keep the recharge progress; extra max charges arrive immediately.
    const gained = Math.max(0, max - maxCharges(prevDef));
    const c = Math.min(max, prev.charges + gained);
    charges.set(id, { charges: def.cooldown > 0 ? c : max, timer: c >= max || def.cooldown <= 0 ? 0 : Math.min(prev.timer, def.cooldown) });
  }
  p.skills = next;
  p.charges = charges;
}

/**
 * Live update from the rules. The shown level changes only through the explicit `level` field
 * (SimPlayerUpdate): `restore` alone is just a refill (it may accompany a level-up that gained
 * several levels, or a heal that gained none).
 */
export function applyPlayerUpdate(p: PlayerState, u: SimPlayerUpdate): void {
  if (u.stats) {
    p.stats = u.stats;
    p.flags = new Set(u.stats.flags);
    p.life = Math.min(p.life, u.stats.maxLife);
    p.focus = Math.min(p.focus, u.stats.maxFocus);
  }
  if (u.skills) setSkills(p, u.skills);
  if (u.loadout) p.loadout = normaliseLoadout(u.loadout);
  if (u.flasks) {
    for (let k = 0; k < BELT_SLOTS; k++) {
      const rt = u.flasks[k] ?? null;
      const cur = p.flasks[k];
      if (!rt) p.flasks[k] = null;
      else if (cur && cur.runtime.flaskId === rt.flaskId) {
        // Same flask: refresh numbers but keep an in-progress recovery running.
        cur.runtime = rt;
        cur.count = rt.count;
      } else p.flasks[k] = makeFlask(rt);
    }
  }
  if (typeof u.level === 'number' && Number.isFinite(u.level)) p.level = Math.max(1, Math.floor(u.level));
  if (u.restore && !p.dead) {
    p.life = p.stats.maxLife;
    p.focus = p.stats.maxFocus;
  }
  // A cast whose skill left the loadout (or the character) is cancelled.
  if (p.cast && (p.loadout[p.cast.slot] !== p.cast.def.id || !p.skills.has(p.cast.def.id))) p.cast = null;
}

function useFlask(w: World, p: PlayerState, slot: number): void {
  // Champion's Ring, Bare Hands: a restriction the player took on (never a power-up); the press is refused quietly.
  if (p.noFlasks) return;
  const f = p.flasks[slot];
  if (!f || f.count <= 0 || f.active > 0) return;
  const rt = f.runtime;
  // Unending Vigil (the Orrery): Life flasks are refused quietly, like a vow.
  const pr = p.stats.passives;
  if (pr && pr.noLifeFlasks && rt.flaskId === 'lifeFlask') return;
  f.count--;
  if (pr) passiveFlask(w, p, pr, rt.flaskId);
  const amount = Math.max(0, rt.amount);
  if (rt.duration > 0) {
    f.active = rt.duration;
    f.rate = amount / rt.duration;
  } else {
    // Instant flask.
    if (rt.resource === 'life') p.life = Math.min(p.stats.maxLife, p.life + amount);
    else p.focus = Math.min(p.stats.maxFocus, p.focus + amount);
  }
  w.outcomes.push({ t: 'flaskUsed', playerId: p.id, slot });
  w.events.push({ t: 'flask', playerId: p.id, resource: rt.resource });
  // Utility flasks (power rework): the effect is read from the active flask each tick; only these one-off parts happen here.
  if (rt.flaskId === 'quickstep') { cleanseDebuffs(w, p, QUICKSTEP_CLEANSE); return; }
  if (rt.flaskId === 'aegis') return;
  if (rt.flaskId === 'quicksilverMind') {
    p.focus = Math.min(p.stats.maxFocus, p.focus + p.stats.maxFocus * FLASK_FX.quicksilverMind.focusInstant);
    return;
  }
  // GAME_SPEC §13: the life flask puts out burning and stanches bleeding; the focus flask lifts withered.
  cleanseDebuffs(w, p, rt.resource === 'life' ? LIFE_FLASK_CLEANSE : FOCUS_FLASK_CLEANSE);
}

const QUICKSTEP_CLEANSE: readonly PlayerDebuff[] = ['rooted'];
const LIFE_FLASK_CLEANSE: readonly PlayerDebuff[] = ['burning', 'bleeding'];
const FOCUS_FLASK_CLEANSE: readonly PlayerDebuff[] = ['withered'];

function tickFlasks(p: PlayerState): void {
  for (const f of p.flasks) {
    if (!f || f.active <= 0) continue;
    const step = Math.min(DT, f.active);
    f.active -= DT;
    if (f.active < 0) f.active = 0;
    const gain = f.rate * step;
    if (f.runtime.resource === 'life') p.life = Math.min(p.stats.maxLife, p.life + gain);
    else p.focus = Math.min(p.stats.maxFocus, p.focus + gain);
  }
}

function tickCharges(p: PlayerState): void {
  for (const [id, ch] of p.charges) {
    const def = p.skills.get(id);
    if (!def) continue;
    const max = maxCharges(def);
    if (def.cooldown <= 0) {
      ch.charges = max;
      ch.timer = 0;
      continue;
    }
    if (ch.charges >= max) {
      ch.timer = 0;
      continue;
    }
    ch.timer -= DT;
    if (ch.timer <= 0) {
      ch.charges++;
      ch.timer = ch.charges < max ? ch.timer + def.cooldown : 0;
    }
  }
}

/** Focus a cast costs now: the def's cost, unless an augment makes it cheaper (power rework SK5: Rift Echo, Charged Reprieve). */
function costOf(p: PlayerState, def: SkillRuntimeDef, now: number): number {
  return castCost(p, def, now);
}

function canAfford(p: PlayerState, def: SkillRuntimeDef, now: number): boolean {
  return p.focus + 1e-9 >= costOf(p, def, now);
}

function updateCasting(w: World, p: PlayerState): void {
  const held = p.intent.held;
  // Chilled casts progress at 70%; frozen, a cast holds and nothing new starts. Tempest Surge speeds casts up (×1 without it).
  const rate = castRate(p) * surgeCastRate(p);
  let carry = 0;
  if (p.cast) {
    p.cast.time += rate === 1 ? DT : DT * rate;
    if (p.cast.time >= p.cast.total) {
      const c = p.cast;
      carry = Math.min(DT, c.time - c.total);
      p.cast = null;
      releaseSkill(w, p, c.def, p.aimX, p.aimY);
    }
  }
  // Active skills get first pick; Ember Lance fills the gaps wherever it is assigned.
  const basicSlot = p.loadout.indexOf('emberLance');
  for (let o = 0; o <= LOADOUT_SLOTS && rate > 0; o++) {
    const slot = o === LOADOUT_SLOTS ? basicSlot : o;
    if (slot < 0 || (o < LOADOUT_SLOTS && slot === basicSlot)) continue;
    if (held[slot] !== true) continue;
    const id = p.loadout[slot];
    if (!id) continue;
    const def = p.skills.get(id);
    const ch = p.charges.get(id);
    if (!def || !ch) continue;
    const instant = !(def.castTime > 0);
    // A held instant skill re-fires only after its lock (a fresh press always goes through), so a
    // normal keypress spanning several ticks spends exactly one Rift Step charge.
    if (instant && p.prevHeld[slot] && p.slotLock[slot] > 0) continue;
    // Only one timed cast at a time, but any skill may cut short the (free) basic attack.
    if (!instant && p.cast && !(p.cast.def.id === 'emberLance' && id !== 'emberLance')) continue;
    if (ch.charges < 1) continue;
    if (!canAfford(p, def, w.time)) {
      if (!p.prevHeld[slot] || p.focusWarnCd <= 0) {
        w.events.push({ t: 'notEnoughFocus', playerId: p.id });
        p.focusWarnCd = NOT_ENOUGH_FOCUS_REPEAT;
      }
      continue;
    }
    const paid = costOf(p, def, w.time);
    p.focus -= paid;
    noteCast(p, def, paid, w.time);
    if (def.cooldown > 0) {
      ch.charges--;
      if (ch.timer <= 0) ch.timer = def.cooldown;
    }
    if (instant) {
      p.slotLock[slot] = INSTANT_RETRIGGER;
      releaseSkill(w, p, def, p.aimX, p.aimY);
      continue;
    }
    p.cast = { slot, def, time: carry, total: def.castTime };
    p.anim = 'cast';
    p.animTime = 0;
  }
  for (let k = 0; k < LOADOUT_SLOTS; k++) p.prevHeld[k] = held[k] === true;
}

/** Everything one player does in a tick (before monsters act). */
export function updatePlayer(w: World, p: PlayerState): void {
  const intent = p.intent;
  p.invulnTime = Math.max(0, p.invulnTime - DT);
  p.dashTime = Math.max(0, p.dashTime - DT);
  p.hitTime = Math.max(0, p.hitTime - DT);
  p.hitFlash = Math.max(0, p.hitFlash - DT * HIT_FLASH_DECAY);
  p.focusWarnCd = Math.max(0, p.focusWarnCd - DT);
  for (let k = 0; k < LOADOUT_SLOTS; k++) if (p.slotLock[k] > 0) p.slotLock[k] = Math.max(0, p.slotLock[k] - DT);
  tickCharges(p);

  if (p.dead) {
    p.vx = 0;
    p.vy = 0;
    p.animTime += DT;
    intent.flask = -1;
    return;
  }

  p.aimX = intent.aimX;
  p.aimY = intent.aimY;
  // A flask press is an edge: it applies on one tick even if the intent is not replaced.
  const flask = intent.flask;
  intent.flask = -1;
  if (flask >= 0) useFlask(w, p, flask);
  tickFlasks(p);
  const s = p.stats;
  if (s.lifeRegen > 0) p.life = Math.min(s.maxLife, p.life + s.lifeRegen * DT);
  if (s.focusRegen > 0) p.focus = Math.min(s.maxFocus, p.focus + s.focusRegen * (1 + flaskActiveFx(p, 'quicksilverMind') * FLASK_FX.quicksilverMind.focusRegen) * DT);
  // The Orrery: Unending Vigil's low-life regeneration, Last Ember's free ward (nothing without passives).
  if (s.passives) tickPassivePlayer(w, p, DT);
  tickWard(w, p);
  tickSelfBuffs(p);
  updateCasting(w, p);
  tickPendingNovas(w, p);
  tickPendingStrikes(w, p);
  tickRoster2(w, p);
  tickRoster3(w, p);

  // Movement (the shared movePlayer rules): slowed while a timed active skill is cast (never by
  // the basic attack), by debuffs (chilled; frozen and rooted hold her still), by tar underfoot, and
  // by a horde pressing in from the front — the crowd part is sim-only, the client learns it through
  // corrections. vx/vy carry the effective speed, so the presenter's locomotion rate matches what the
  // player actually does. A chain hook's drag replaces her own movement while it lasts.
  let moving = false;
  let mx = 0;
  let my = 0;
  if (p.pullTime > 0) {
    p.pullTime = Math.max(0, p.pullTime - DT);
    const u = p.pullTotal > 0 ? 1 - p.pullTime / p.pullTotal : 1;
    moveTo(w, p, p.pullFromX + (p.pullToX - p.pullFromX) * u, p.pullFromY + (p.pullToY - p.pullFromY) * u);
    p.vx = 0;
    p.vy = 0;
  } else {
    const dir = readMove(intent.moveX, intent.moveY);
    mx = dir.x;
    my = dir.y;
    const ml = dir.len;
    const castSlow = p.cast && p.cast.def.id !== 'emberLance' ? CAST_SLOW : 0;
    const base = combineSlow(playerSlow(castSlow, moveSlowOf(p), areaSlowAt(w.areas, p.x, p.y)), p.eventSlow);
    // Phase Stride: no slow from crowding while it lasts.
    const crowd = ml > 0.05 && base < 1 && p.stride.time <= 0 ? crowdFactor(w, p, mx / ml, my / ml) : 1;
    // Uncrowded, the slow is exactly what a predicting client passes (see movement.ts playerSlow).
    const slow = crowd === 1 ? base : 1 - (1 - base) * crowd;
    const stride = p.stride.time > 0 ? p.stride.speed : 0;
    const speed = slowedSpeed(s.moveSpeed * (1 + flaskActiveFx(p, 'quickstep') * FLASK_FX.quickstep.moveSpeed + stride), slow);
    p.vx = mx * speed;
    p.vy = my * speed;
    // A conveyor belt underfoot adds its drift to her own velocity (movement.ts movePlayerDrifted: same expression, so client
    // prediction lands on the same spot); p.vx/vy stay her own effective speed.
    const drift = playerFlowDrift(w.layout?.flows, p.x, p.y);
    moveTo(w, p, p.x + (p.vx + drift.x) * DT, p.y + (p.vy + drift.y) * DT);
    moving = ml > 0.05 && speed > 0;
  }
  tickFireTrail(w, p, moving);

  // Frozen: the pose, facing and animation clock hold.
  if (!isFrozen(p)) {
    // Facing: toward the aim while casting, else along movement.
    if (p.cast || p.dashTime > 0) p.facing = dirFromVector(p.aimX - p.x, p.aimY - p.y, p.facing);
    else if (moving) p.facing = dirFromVector(mx, my, p.facing);
    setAnim(p, moving);
  }
  tickDebuffs(w, p, moving);
}

/**
 * Knock a player back `dist` units along (dirX, dirY) over the next few ticks (pending knockback is
 * capped at PLAYER_KNOCKBACK_MAX). Call it after a hit that connected.
 */
export function knockPlayer(w: World, p: PlayerState, dirX: number, dirY: number, dist: number): void {
  if (p.dead || !(dist > 0)) return;
  const l = Math.hypot(dirX, dirY);
  if (l < 1e-6) return;
  let kx = p.kbX + (dirX / l) * dist;
  let ky = p.kbY + (dirY / l) * dist;
  const kl = Math.hypot(kx, ky);
  if (kl > PLAYER_KNOCKBACK_MAX) {
    kx *= PLAYER_KNOCKBACK_MAX / kl;
    ky *= PLAYER_KNOCKBACK_MAX / kl;
  }
  p.kbX = kx;
  p.kbY = ky;
}

/**
 * Drag a player up to `distance` units (at most PULL_MAX_DISTANCE) toward (towardX, towardY) over
 * PULL_TIME (stopping short of the point itself, and of the first solid prop in the way — a chain
 * never drags anyone through a pillar), then hold them: they are rooted (`source`, ROOT_DURATION from
 * now) and emit 'pull' with the drag's real end. Their own movement is suspended while dragged; Rift
 * Step breaks both. Call it after a hit that connected (the chain hook does: projectiles.ts). The
 * duration is fixed because client prediction replays the drag from the 'pull' event (from → to at
 * u = 1 − pullTime / pullTotal) with exactly that timing.
 */
export function pullPlayer(
  w: World, p: PlayerState, towardX: number, towardY: number, distance: number, source: RootSource = 'chain',
): void {
  if (p.dead) return;
  const dx = towardX - p.x;
  const dy = towardY - p.y;
  const d = Math.hypot(dx, dy);
  const want = Number.isFinite(distance) ? Math.min(PULL_MAX_DISTANCE, Math.max(0, distance)) : 0;
  let dist = Math.min(want, Math.max(0, d - PLAYER_RADIUS * 2));
  if (dist > 0) dist = freeDragDistance(w, p.x, p.y, dx / d, dy / d, dist);
  const fromX = p.x;
  const fromY = p.y;
  const toX = d > 1e-6 ? fromX + (dx / d) * dist : fromX;
  const toY = d > 1e-6 ? fromY + (dy / d) * dist : fromY;
  applyDebuff(w, p, 'rooted', 0, source);
  if (dist <= 0) return;
  p.pullFromX = fromX;
  p.pullFromY = fromY;
  p.pullToX = toX;
  p.pullToY = toY;
  p.pullTotal = Math.max(DT, PULL_TIME);
  p.pullTime = p.pullTotal;
  w.events.push({ t: 'pull', playerId: p.id, fromX, fromY, toX, toY });
}

/**
 * How far a player at (x, y) can be dragged along the unit vector (ux, uy) before her body meets a
 * solid prop (at most `max`). Props behind her or beside the path don't count; one she already
 * touches in the drag's direction stops it at once.
 */
function freeDragDistance(w: World, x: number, y: number, ux: number, uy: number, max: number): number {
  let best = max;
  const props = w.props;
  for (let k = 0; k < props.length; k++) {
    const pr = props[k];
    if (!pr.solid) continue;
    const r = pr.radius + PLAYER_RADIUS;
    const cx = pr.x - x;
    const cy = pr.y - y;
    const along = cx * ux + cy * uy;
    if (along <= 0 || along - r >= best) continue;
    const perp2 = cx * cx + cy * cy - along * along;
    if (perp2 >= r * r) continue;
    const hit = along - Math.sqrt(r * r - perp2);
    if (hit < best) best = hit > 0 ? hit : 0;
  }
  return best;
}

/**
 * Speed factor from regular monsters pressed against the player within the forward cone of her
 * travel direction (ux, uy: unit vector). Uses the grid built at the start of this tick.
 */
function crowdFactor(w: World, p: PlayerState, ux: number, uy: number): number {
  const m = w.monsters;
  const cand = w.scratch;
  const reach = PLAYER_RADIUS + w.grid.maxRadius + CROWD_CONTACT_PAD;
  const n = w.grid.query(p.x - reach, p.y - reach, p.x + reach, p.y + reach, cand);
  let count = 0;
  for (let k = 0; k < n; k++) {
    const i = cand[k];
    // Heavy/immovable bodies block (they shove the player) rather than slow; spawning and
    // airborne monsters aren't in the way yet.
    // Ghosts drift through her.
    if (!m.alive[i] || m.flags[i] & (MFLAG.unpushable | MFLAG.heavy | MFLAG.ghost) || m.spawnTime[i] > 0 || m.state[i] === MSTATE.leap) continue;
    const dx = m.x[i] - p.x;
    const dy = m.y[i] - p.y;
    const rr = m.radius[i] + PLAYER_RADIUS + CROWD_CONTACT_PAD;
    const d2 = dx * dx + dy * dy;
    if (d2 > rr * rr) continue;
    if (dx * ux + dy * uy > CROWD_CONE_COS * Math.sqrt(d2)) count++;
  }
  return Math.max(CROWD_SLOW_FLOOR, 1 - CROWD_SLOW_PER_MONSTER * count);
}

/** Move a player to a point, resolving props and the arena edge (the movePlayer rules). */
export function moveTo(w: World, p: PlayerState, x: number, y: number): void {
  const o = resolvePlayerAt(x, y, w.arenaRadius, w.props);
  p.x = o.x;
  p.y = o.y;
}

/**
 * After the monsters moved: apply the shove from bodies a player can't move (heavy monsters, the
 * dummy), then ease overlapping allies apart (light, so a party can still stack up in a doorway).
 */
export function applyPlayerPushes(w: World): void {
  const players = w.players;
  for (let k = 0; k < players.length; k++) {
    const p = players[k];
    if (!p.dead && (p.kbX !== 0 || p.kbY !== 0)) {
      const sx = p.kbX * PLAYER_KNOCKBACK_RATE;
      const sy = p.kbY * PLAYER_KNOCKBACK_RATE;
      p.kbX -= sx;
      p.kbY -= sy;
      if (Math.abs(p.kbX) + Math.abs(p.kbY) < 0.05) {
        p.kbX = 0;
        p.kbY = 0;
      }
      moveTo(w, p, p.x + sx, p.y + sy);
    }
    if (p.dead || (p.pushX === 0 && p.pushY === 0)) {
      p.pushX = 0;
      p.pushY = 0;
      continue;
    }
    let px = p.pushX;
    let py = p.pushY;
    const l = Math.hypot(px, py);
    const maxStep = 2.5;
    if (l > maxStep) {
      px *= maxStep / l;
      py *= maxStep / l;
    }
    p.pushX = 0;
    p.pushY = 0;
    moveTo(w, p, p.x + px, p.y + py);
  }
  const living = w.living;
  if (living.length < 2) return;
  const rr = PLAYER_RADIUS * 2;
  for (let a = 0; a < living.length; a++) {
    const pa = living[a];
    for (let b = a + 1; b < living.length; b++) {
      const pb = living[b];
      // Phase Stride: she passes through allies (and they through her) while it lasts.
      if (pa.stride.time > 0 || pb.stride.time > 0) continue;
      let dx = pb.x - pa.x;
      let dy = pb.y - pa.y;
      let d = Math.hypot(dx, dy);
      if (d >= rr) continue;
      if (d < 1e-4) {
        // Exactly stacked (joined on the same spot): split along a fixed per-pair direction.
        const ang = ((pa.id * 97 + pb.id * 31) % 360) * (Math.PI / 180);
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        d = 1;
      } else {
        dx /= d;
        dy /= d;
      }
      const push = Math.min(ALLY_PUSH_MAX, (rr - Math.min(d, rr)) * ALLY_PUSH_RATE) * 0.5;
      moveTo(w, pa, pa.x - dx * push, pa.y - dy * push);
      moveTo(w, pb, pb.x + dx * push, pb.y + dy * push);
    }
  }
}

function setAnim(p: PlayerState, moving: boolean): void {
  let anim: PlayerAnim;
  if (p.dead) anim = 'death';
  else if (p.dashTime > 0) anim = 'dash';
  else if (p.cast) anim = 'cast';
  else if (p.hitTime > 0) anim = 'hit';
  else if (moving) anim = 'run';
  else anim = 'idle';
  if (anim !== p.anim) {
    p.anim = anim;
    p.animTime = 0;
  } else p.animTime += DT;
}

// --- view --------------------------------------------------------------------

export function createPlayerView(id: number): PlayerView {
  const slots: SlotView[] = [];
  for (let k = 0; k < LOADOUT_SLOTS; k++) {
    slots.push({ skillId: null, cooldown: 0, cooldownTotal: 0, charges: 0, maxCharges: 0, focusCost: 0, usable: false });
  }
  const flasks: (FlaskSlotView | null)[] = [];
  for (let k = 0; k < BELT_SLOTS; k++) flasks.push(null);
  return {
    id, name: '', level: 1,
    x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, facing: 'south', aimX: 0, aimY: 0, anim: 'idle', animTime: 0,
    castSkill: null, castProgress: 0, life: 0, maxLife: 0, focus: 0, maxFocus: 0, wardTime: 0, wardDuration: 0,
    invulnTime: 0, hitFlash: 0, dead: false, eventSlow: 0, debuffs: [], slots, flasks,
  };
}

export function writePlayerView(p: PlayerState): void {
  const v = p.view;
  v.name = p.name; v.level = p.level;
  v.x = p.x; v.y = p.y; v.prevX = p.prevX; v.prevY = p.prevY; v.vx = p.vx; v.vy = p.vy;
  v.facing = p.facing; v.aimX = p.aimX; v.aimY = p.aimY; v.anim = p.anim; v.animTime = p.animTime;
  v.castSkill = p.cast ? p.cast.def.id : null;
  v.castProgress = p.cast ? clamp(p.cast.time / p.cast.total, 0, 1) : 0;
  v.life = Math.max(0, p.life); v.maxLife = p.stats.maxLife;
  v.focus = Math.max(0, p.focus); v.maxFocus = p.stats.maxFocus;
  v.wardTime = p.ward.time; v.wardDuration = p.ward.duration;
  v.invulnTime = p.invulnTime; v.hitFlash = p.hitFlash; v.dead = p.dead; v.eventSlow = p.eventSlow;
  writeDebuffViews(p);
  for (let k = 0; k < LOADOUT_SLOTS; k++) {
    const sv = v.slots[k];
    const id = p.loadout[k];
    const def = id ? p.skills.get(id) : undefined;
    const ch = id ? p.charges.get(id) : undefined;
    if (!id || !def || !ch) {
      sv.skillId = id ?? null;
      sv.cooldown = 0; sv.cooldownTotal = 0; sv.charges = 0; sv.maxCharges = 0; sv.focusCost = 0; sv.usable = false;
      continue;
    }
    sv.skillId = id;
    sv.cooldown = ch.timer;
    sv.cooldownTotal = def.cooldown;
    sv.charges = ch.charges;
    sv.maxCharges = maxCharges(def);
    sv.focusCost = def.focusCost;
    // The view has no clock: a free use (Rift Echo) is not foreseen here, a discount is.
    sv.usable = !p.dead && ch.charges >= 1 && canAfford(p, def, Infinity);
  }
  for (let k = 0; k < BELT_SLOTS; k++) {
    const f = p.flasks[k];
    if (!f) {
      v.flasks[k] = null;
      continue;
    }
    let fv = v.flasks[k];
    if (!fv) {
      fv = { flaskId: f.runtime.flaskId, count: 0, resource: f.runtime.resource, active: 0, duration: 0 };
      v.flasks[k] = fv;
    }
    fv.flaskId = f.runtime.flaskId;
    fv.count = f.count;
    fv.resource = f.runtime.resource;
    fv.active = f.active;
    fv.duration = f.runtime.duration;
  }
}

/** Nearest living player to a point (null when nobody is alive). */
export function nearestLiving(w: World, x: number, y: number): PlayerState | null {
  const living = w.living;
  let best: PlayerState | null = null;
  let bd = Infinity;
  for (let k = 0; k < living.length; k++) {
    const p = living[k];
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bd) {
      bd = d2;
      best = p;
    }
  }
  return best;
}

/** Rebuild the living-player list (after a join, a leave or a death). */
export function refreshLiving(w: World): void {
  const out: PlayerState[] = [];
  for (const p of w.players) if (!p.dead) out.push(p);
  w.living = out;
}
