// Players: joining, held-slot casting with charges/cooldowns and focus, flasks, regen, movement
// (through the shared `movePlayer` rules), animation state, live updates from the rules, and the
// PlayerView writer. Every function works on one PlayerState; the run steps them in join order.
import type { SkillId } from '../contracts/content';
import { BELT_SLOTS, LOADOUT_SLOTS } from '../contracts/items';
import type {
  FlaskRuntime, FlaskSlotView, PlayerAnim, PlayerIntent, PlayerJoin, PlayerUpdate, PlayerView, SkillRuntimeDef, SlotView,
} from '../contracts/sim';
import {
  ALLY_PUSH_MAX, ALLY_PUSH_RATE, CROWD_CONE_COS, CROWD_CONTACT_PAD, CROWD_SLOW_FLOOR, CROWD_SLOW_PER_MONSTER, DT, HIT_FLASH_DECAY,
  INSTANT_RETRIGGER, MELEE_CAP_WINDOW_TICKS, NOT_ENOUGH_FOCUS_REPEAT, PLAYER_RADIUS,
} from './constants';
import { clamp, dirFromVector, finiteOr } from './math';
import { CAST_SLOW, readMove, resolvePlayerAt, slowedSpeed } from './movement';
import { releaseSkill, tickFireTrail, tickPendingNovas, tickWard } from './skills';
import { MFLAG, MSTATE } from './stores';
import type { FlaskState, PlayerState, SkillChargeState, World } from './world';

/** Non-basic slots get first pick; the basic attack (slot 0) fills the gaps. */
const CAST_ORDER = [1, 2, 3, 4, 5, 0] as const;

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
 */
export type SimPlayerJoin = PlayerJoin & { life?: number; focus?: number };

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
    ward: { time: 0, duration: 0, reduction: 0, pulse: 0, damage: 0, critChance: 0, critMultiplier: 1.5, ailmentChance: 0, radius: 40 },
    invulnTime: 0, dashTime: 0, hitTime: 0, hitFlash: 0,
    dead: false,
    prevHeld: new Array<boolean>(LOADOUT_SLOTS).fill(false),
    slotLock: new Float32Array(LOADOUT_SLOTS),
    focusWarnCd: 0,
    meleeWindow: new Float32Array(MELEE_CAP_WINDOW_TICKS),
    meleeSum: 0,
    trailTimer: 0,
    pushX: 0, pushY: 0,
    pendingNovas: [],
    portalLatch: 0,
    portalDwellId: 0,
    portalDwell: 0,
  };
  setSkills(p, rt.skills);
  for (let k = 0; k < BELT_SLOTS; k++) {
    const f = rt.flasks[k] ?? null;
    p.flasks.push(f ? makeFlask(f) : null);
  }
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
  const f = p.flasks[slot];
  if (!f || f.count <= 0 || f.active > 0) return;
  f.count--;
  const rt = f.runtime;
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
}

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

function canAfford(p: PlayerState, def: SkillRuntimeDef): boolean {
  return p.focus + 1e-9 >= Math.max(0, def.focusCost);
}

function updateCasting(w: World, p: PlayerState): void {
  const held = p.intent.held;
  let carry = 0;
  if (p.cast) {
    p.cast.time += DT;
    if (p.cast.time >= p.cast.total) {
      const c = p.cast;
      carry = Math.min(DT, c.time - c.total);
      p.cast = null;
      releaseSkill(w, p, c.def, p.aimX, p.aimY);
    }
  }
  for (let o = 0; o < CAST_ORDER.length; o++) {
    const slot = CAST_ORDER[o];
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
    if (!instant && p.cast && !(p.cast.slot === 0 && slot !== 0)) continue;
    if (ch.charges < 1) continue;
    if (!canAfford(p, def)) {
      if (!p.prevHeld[slot] || p.focusWarnCd <= 0) {
        w.events.push({ t: 'notEnoughFocus', playerId: p.id });
        p.focusWarnCd = NOT_ENOUGH_FOCUS_REPEAT;
      }
      continue;
    }
    p.focus -= Math.max(0, def.focusCost);
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
  // Roll the melee-cap window forward one tick.
  const wi = w.tick % MELEE_CAP_WINDOW_TICKS;
  p.meleeSum = Math.max(0, p.meleeSum - p.meleeWindow[wi]);
  p.meleeWindow[wi] = 0;

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
  if (s.focusRegen > 0) p.focus = Math.min(s.maxFocus, p.focus + s.focusRegen * DT);
  tickWard(w, p);
  updateCasting(w, p);
  tickPendingNovas(w, p);

  // Movement (the shared movePlayer rules): slowed while a timed active skill is cast (never by
  // the basic attack) and by a horde pressing in from the front — the crowd part is sim-only, the
  // client learns it through corrections. vx/vy carry the effective speed, so the presenter's
  // locomotion rate matches what the player actually does.
  const dir = readMove(intent.moveX, intent.moveY);
  const mx = dir.x;
  const my = dir.y;
  const ml = dir.len;
  const castSlow = p.cast && p.cast.slot !== 0 ? CAST_SLOW : 0;
  const crowd = ml > 0.05 ? crowdFactor(w, p, mx / ml, my / ml) : 1;
  // Uncrowded, the slow is exactly what a predicting client passes (0 or CAST_SLOW).
  const slow = crowd === 1 ? castSlow : 1 - (1 - castSlow) * crowd;
  const speed = slowedSpeed(s.moveSpeed, slow);
  p.vx = mx * speed;
  p.vy = my * speed;
  moveTo(w, p, p.x + p.vx * DT, p.y + p.vy * DT);
  const moving = ml > 0.05 && speed > 0;
  tickFireTrail(w, p, moving);

  // Facing: toward the aim while casting, else along movement.
  if (p.cast || p.dashTime > 0) p.facing = dirFromVector(p.aimX - p.x, p.aimY - p.y, p.facing);
  else if (moving) p.facing = dirFromVector(mx, my, p.facing);
  setAnim(p, moving);
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
    if (!m.alive[i] || m.flags[i] & (MFLAG.unpushable | MFLAG.heavy) || m.spawnTime[i] > 0 || m.state[i] === MSTATE.leap) continue;
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
    invulnTime: 0, hitFlash: 0, dead: false, slots, flasks,
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
  v.invulnTime = p.invulnTime; v.hitFlash = p.hitFlash; v.dead = p.dead;
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
    sv.usable = !p.dead && ch.charges >= 1 && canAfford(p, def);
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
