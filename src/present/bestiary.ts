// Presentation tables for the per-map rosters (GAME_SPEC §13–§14) and the pure geometry helpers the painters share.
//
//   MONSTER_LOOKS[kind]     how a kind carries itself: ghost translucency, floating (soft shadow), its death / corpse
//                           family (ash, rime or dust), its presence (lights, floor, rising motes) as a boss or
//                           lieutenant, and the emissive hotspot its presence light hangs on (the Warden's lantern,
//                           Varkus's forge-hot shield boss, the Chainmaster's red-hot hooks).
//   ACTION_SPRITES          special action sets (glacialWisp/burst, chainThrall/throw, hollowWarden/cast,
//                           boneChorister/sing) keyed by the 'monsterAttack' that starts them and the MONSTER_ANIM
//                           states they may show in. Varkus's charge and whirl and the Chainmaster's whirl are driven by
//                           the areas instead (their lane / spinning ring is the honest signal), the shield-bearer's
//                           block by the 'blocked' event.
//   choirArcs, prisonStartRadius, laneEnds, ...   geometry following src/sim/area-geometry.ts (the sim's own conventions:
//                           heading and variant packed into the area id).
//   TAR_POOL_RADIUS, CHARGE_LANE_DASH_TAIL, MARK_LOCKED_TAIL, ...   the sim tuning a few telegraphs are timed and sized
//                           by (pinned to their sources by tests/present/telegraphs.test.ts), with chargeLaneProgress
//                           and markLockProgress: every fill completes exactly when the hit lands.
import { THEME_ROSTER } from '../contracts/bestiary';
import type { MonsterKind } from '../contracts/content';
import type { RGB } from '../contracts/render';
import { MONSTER_ANIM, type AreaView, type ProjectileKind, type SimEvent } from '../contracts/sim';
import {
  CHARGE_LINE_HALF_WIDTH, CHOIR_GAP_HALF_ANGLE, ICE_PRISON_END_FRACTION, areaAngle, areaVariant,
} from '../sim/area-geometry';
import { C } from './colors';
import { clamp01, TAU } from './math';

export type MonsterAttack = Extract<SimEvent, { t: 'monsterAttack' }>['attack'];

/** What a monster leaves behind: ash (the forge), rime (the ossuary's cold bone) or dust and blood (the arena). */
export type CorpseFamily = 'ash' | 'rime' | 'dust';

export interface PresenceLook {
  /** Main light colour, its radius and intensity (the boss / lieutenant presence). */
  light: RGB;
  radius: number;
  intensity: number;
  flicker: number;
  /** A second, tighter light on the emissive hotspot (lantern, shield boss, hooks); radius 0 = none. */
  hotLight: RGB;
  hotRadius: number;
  hotIntensity: number;
  /** Floor under a boss: pool colour, sigil colour (null = no sigil) and scale. */
  pool: RGB;
  sigil: RGB | null;
  floorScale: number;
  /** Rising motes: sprite, colours and rate per second (0 = none). */
  mote: string;
  moteC0: RGB;
  moteC1: RGB;
  moteRate: number;
  moteGravity: number;
  /** Outline and name colours (lieutenants), spawn / summon / phase colour. */
  accent: RGB;
}

export interface MonsterLook {
  /** Drifts through the horde, drawn translucent (the Rimeshade). */
  ghost: boolean;
  /** Floats above the floor: a softer, smaller shadow. */
  float: boolean;
  /** Heavy / large: corpse lingers longer, bigger death burst, damage numbers ride higher. */
  big: boolean;
  corpse: CorpseFamily;
  /** Presence as a lieutenant or boss (null: the default ember presence). */
  presence: PresenceLook | null;
}

const PLAIN: MonsterLook = { ghost: false, float: false, big: false, corpse: 'ash', presence: null };

const FROST_LIGHT: RGB = [0.62, 0.84, 1];
const LANTERN: RGB = [0.78, 0.93, 1];
const EMBER_LIGHT: RGB = [1, 0.46, 0.16];
const ARENA_GOLD: RGB = [1, 0.72, 0.36];

export const PRESENCE_WARDEN: PresenceLook = {
  light: [0.4, 0.6, 1], radius: 180, intensity: 0.55, flicker: 0.2,
  hotLight: LANTERN, hotRadius: 90, hotIntensity: 0.7,
  pool: [0.12, 0.26, 0.5], sigil: [0.36, 0.62, 0.9], floorScale: 3,
  mote: 'fx/frost', moteC0: C.ice, moteC1: C.mana, moteRate: 10, moteGravity: -18,
  accent: C.frost,
};

export const PRESENCE_VARKUS: PresenceLook = {
  light: ARENA_GOLD, radius: 170, intensity: 0.4, flicker: 0.3,
  hotLight: EMBER_LIGHT, hotRadius: 56, hotIntensity: 0.55,
  pool: [0.5, 0.2, 0.06], sigil: null, floorScale: 3.2,
  mote: 'fx/ember', moteC0: C.hot, moteC1: C.ember, moteRate: 14, moteGravity: -30,
  accent: C.flame,
};

export const PRESENCE_CHORISTER: PresenceLook = {
  light: FROST_LIGHT, radius: 120, intensity: 0.4, flicker: 0.15,
  hotLight: LANTERN, hotRadius: 0, hotIntensity: 0,
  pool: [0.1, 0.22, 0.42], sigil: null, floorScale: 2,
  mote: 'fx/frost', moteC0: C.ice, moteC1: C.frost, moteRate: 5, moteGravity: -14,
  accent: C.frost,
};

export const PRESENCE_CHAINMASTER: PresenceLook = {
  light: EMBER_LIGHT, radius: 120, intensity: 0.38, flicker: 0.35,
  hotLight: EMBER_LIGHT, hotRadius: 48, hotIntensity: 0.4,
  pool: [0.4, 0.12, 0.05], sigil: null, floorScale: 2,
  mote: 'fx/ember', moteC0: C.hot, moteC1: C.ember, moteRate: 5, moteGravity: -26,
  accent: C.flame,
};

export const MONSTER_LOOKS: Record<MonsterKind, MonsterLook> = {
  ashling: PLAIN,
  emberSkitter: PLAIN,
  cinderSpitter: PLAIN,
  riftStalker: PLAIN,
  ironhideBrute: { ...PLAIN, big: true },
  ashboundHerald: { ...PLAIN, big: true },
  cinderMatriarch: { ...PLAIN, big: true },
  trainingDummy: PLAIN,
  boneThrall: { ...PLAIN, corpse: 'rime' },
  rimeshade: { ...PLAIN, ghost: true, float: true, corpse: 'rime' },
  frostWeaver: { ...PLAIN, corpse: 'rime' },
  glacialWisp: { ...PLAIN, float: true, corpse: 'rime' },
  ossuaryGolem: { ...PLAIN, big: true, corpse: 'rime' },
  boneChorister: { ...PLAIN, big: true, corpse: 'rime', presence: PRESENCE_CHORISTER },
  hollowWarden: { ...PLAIN, big: true, float: true, corpse: 'rime', presence: PRESENCE_WARDEN },
  pitHound: { ...PLAIN, corpse: 'dust' },
  chainThrall: { ...PLAIN, corpse: 'dust' },
  ironCrossbowman: { ...PLAIN, corpse: 'dust' },
  shieldbearer: { ...PLAIN, big: true, corpse: 'dust' },
  tarSlinger: { ...PLAIN, corpse: 'dust' },
  chainmaster: { ...PLAIN, big: true, corpse: 'dust', presence: PRESENCE_CHAINMASTER },
  varkus: { ...PLAIN, big: true, corpse: 'dust', presence: PRESENCE_VARKUS },
};

/** Lieutenants and bosses of every roster (one of each per map: events find them anywhere in the arena). */
export const COMMANDERS: ReadonlySet<MonsterKind> = new Set(
  Object.values(THEME_ROSTER).flatMap((r) => [r.lieutenant, r.boss] as MonsterKind[]),
);

/** Kinds with a presence hotspot measured from the art (the emissive cluster their hot light hangs on). */
export const HOTSPOT_KINDS: readonly MonsterKind[] = ['hollowWarden', 'varkus', 'chainmaster'];

/** Accent colour of a big moment (spawn, summon, phase, death) for a lieutenant / boss kind. */
export function accentOf(kind: MonsterKind | null | undefined): RGB {
  const p = kind ? MONSTER_LOOKS[kind]?.presence : null;
  return p ? p.accent : C.ember;
}

// ---------------------------------------------------------------------------------------------------------------
// Special action sets
// ---------------------------------------------------------------------------------------------------------------

/** Bit of a MONSTER_ANIM code in an anim mask. */
export const animBit = (code: number): number => 1 << code;
const WINDUP = animBit(MONSTER_ANIM.windup);
const ATTACK = animBit(MONSTER_ANIM.attack);
const IDLE = animBit(MONSTER_ANIM.idle);
const MOVE = animBit(MONSTER_ANIM.move);

export interface ActionSprite {
  /** Sprite name under monster/<kind>/. */
  name: string;
  /** MONSTER_ANIM states it may show in (it ends when the monster leaves them). */
  mask: number;
}

/** A 'monsterAttack' of a kind that switches the body to a special action set. */
export const ACTION_SPRITES: Partial<Record<MonsterKind, Partial<Record<MonsterAttack, ActionSprite>>>> = {
  glacialWisp: { burst: { name: 'burst', mask: ATTACK } },
  chainThrall: { hook: { name: 'throw', mask: ATTACK } },
  hollowWarden: {
    prison: { name: 'cast', mask: WINDUP | ATTACK },
    spikes: { name: 'cast', mask: WINDUP | ATTACK },
    summon: { name: 'cast', mask: WINDUP | ATTACK },
    blizzard: { name: 'cast', mask: WINDUP | ATTACK },
  },
  boneChorister: { summon: { name: 'sing', mask: WINDUP | ATTACK } },
};

/** The shield-bearer's brace after a block: shown while it stands or walks, for this long after the last block. */
export const BLOCK_POSE: ActionSprite = { name: 'block', mask: IDLE | MOVE };
export const BLOCK_HOLD = 0.45;

/** Anim states whose plain sprite is replaced outright (the wisp's only attack is its burst). */
export const STATIC_ACTIONS: Partial<Record<MonsterKind, Partial<Record<number, string>>>> = {
  glacialWisp: { [MONSTER_ANIM.attack]: 'burst' },
  // Varkus's leap onto the Execution Mark: airborne with the greatsword hauled high for the strike.
  varkus: { [MONSTER_ANIM.leap]: 'windup' },
};

/**
 * Leap arcs (MONSTER_ANIM.leap): seconds in the air and apex height. Rift Stalkers hop; Varkus soars onto his mark
 * (flight = VARKUS.leapFlight, pinned by the tests).
 */
export const LEAP_ARC: Partial<Record<MonsterKind, { flight: number; height: number }>> = {
  riftStalker: { flight: 0.25, height: 14 },
  varkus: { flight: 0.5, height: 56 },
};
export const DEFAULT_LEAP = { flight: 0.25, height: 14 } as const;

/** Special sprite for (kind, attack), or null. */
export function actionFor(kind: MonsterKind, attack: MonsterAttack): ActionSprite | null {
  return ACTION_SPRITES[kind]?.[attack] ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Area geometry (src/sim/area-geometry.ts conventions)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The solid arcs of a choir ring: variant + 1 gaps of ±CHOIR_GAP_HALF_ANGLE centred on areaAngle + k·2π/n.
 * Writes [start, end] pairs (radians, start < end, end − start < 2π) into `out` and returns how many arcs.
 */
export function choirArcs(a: Pick<AreaView, 'id'>, out: Float32Array): number {
  const n = areaVariant(a) + 1;
  const base = areaAngle(a);
  const step = TAU / n;
  let k = 0;
  for (let g = 0; g < n && k * 2 + 1 < out.length; g++) {
    const start = base + g * step + CHOIR_GAP_HALF_ANGLE;
    const end = base + (g + 1) * step - CHOIR_GAP_HALF_ANGLE;
    if (end <= start) continue;
    out[k * 2] = start;
    out[k * 2 + 1] = end;
    k++;
  }
  return k;
}

/** An ice prison's starting radius from its current radius and closing progress (radius shrinks linearly). */
export function prisonStartRadius(radius: number, close: number): number {
  const k = 1 - (1 - ICE_PRISON_END_FRACTION) * Math.min(1, Math.max(0, close));
  return k > 1e-6 ? radius / k : radius;
}

/** Radius an ice prison snaps shut at. */
export function prisonEndRadius(radius: number, close: number): number {
  return prisonStartRadius(radius, close) * ICE_PRISON_END_FRACTION;
}

/** A chargeLine's lane: start, unit direction, length and half-width (variant 0 = the harmless aim line). */
export interface Lane {
  x0: number;
  y0: number;
  ux: number;
  uy: number;
  len: number;
  half: number;
  aim: boolean;
}

export function laneOf(a: Pick<AreaView, 'id' | 'x' | 'y' | 'radius'>, out: Lane): Lane {
  const ang = areaAngle(a);
  const v = areaVariant(a);
  out.x0 = a.x;
  out.y0 = a.y;
  out.ux = Math.cos(ang);
  out.uy = Math.sin(ang);
  out.len = Math.max(0, a.radius);
  out.half = CHARGE_LINE_HALF_WIDTH[v] ?? CHARGE_LINE_HALF_WIDTH[1];
  out.aim = v === 0;
  return out;
}

/** Distance from (x, y) to a lane's axis segment, and how far along it the nearest point lies (0..len). */
export function laneDistance(l: Lane, x: number, y: number): { d: number; along: number } {
  const rx = x - l.x0;
  const ry = y - l.y0;
  const t = Math.max(0, Math.min(l.len, rx * l.ux + ry * l.uy));
  return { d: Math.hypot(rx - l.ux * t, ry - l.uy * t), along: t };
}

/** Whirlwind variant 1 = the spinning blades; 0 = the harmless windup ring. */
export const isWhirlBlades = (a: Pick<AreaView, 'id'>): boolean => areaVariant(a) >= 1;

// ---------------------------------------------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------------------------------------------

/** Lobbed kinds: they fly on an arc of ProjectileStoreView.life seconds and land where (x, y) + v·(life − age). */
export function isLobKind(kind: ProjectileKind): boolean {
  return kind === 'cinderSpit' || kind === 'tarGlob';
}

/** Height of a lob at progress u (0..1) with apex `h`: 4h·u(1−u). */
export const lobHeight = (u: number, h: number): number => 4 * h * u * (1 - u);

// ---------------------------------------------------------------------------------------------------------------
// Sim tuning the telegraphs are drawn against
// ---------------------------------------------------------------------------------------------------------------
// Mirrors of sim values that src/sim/area-geometry.ts (the only sim module the presenter may import) doesn't
// export yet. tests/present/telegraphs.test.ts pins every one to its source, so a retune in the sim fails the tests
// instead of silently desynchronising what is drawn from what hits.

/** A Cinder Spitter's lob splashes this wide where it lands (src/sim/constants SPIT_SPLASH_RADIUS). */
export const SPIT_SPLASH_RADIUS = 12;
/** A Tar Slinger's glob splashes this wide where it lands (src/sim/rosters/coliseum/tuning TAR.splash)… */
export const TAR_SPLASH_RADIUS = 14;
/** …and leaves a tarPool this wide (src/sim/constants TAR_POOL_RADIUS) that roots whoever it touches. */
export const TAR_POOL_RADIUS = 26;
/**
 * Varkus's charge lane outlives its cast by the dash plus a tick of slack (VARKUS.chargeDash + 0.1,
 * src/sim/rosters/coliseum/varkus.ts chargeTelegraph): its fill must be complete at the launch, not at the end.
 */
export const CHARGE_LANE_DASH_TAIL = 0.8;
/** An execution mark stands still for the last markTime − markLock seconds of its life (VARKUS). */
export const MARK_LOCKED_TAIL = 1;

/**
 * Telegraph progress of a charge lane (chargeLine variant ≥ 1): 0 → 1 over the cast, reaching 1 exactly at the
 * launch (full fill = the hit, like every other telegraph). Lanes too short to carry the dash tail fill over their
 * whole life.
 */
export function chargeLaneProgress(age: number, duration: number): number {
  const windup = duration - CHARGE_LANE_DASH_TAIL;
  if (!(windup > 0.05)) return duration > 0 ? clamp01(age / duration) : 1;
  return clamp01(age / windup);
}

/** Has the charge down a lane launched (the dash is running)? */
export function chargeLaneLaunched(age: number, duration: number): boolean {
  const windup = duration - CHARGE_LANE_DASH_TAIL;
  return windup > 0.05 && age >= windup;
}

/**
 * How far an execution mark is into its locked window: 0 while it still follows its player, then 0 → 1 over the
 * last MARK_LOCKED_TAIL seconds (it no longer moves: step out). Counted from the time left, so a mark whose clock
 * the sim holds (a rooted victim) stays exactly where it was.
 */
export function markLockProgress(age: number, duration: number): number {
  const left = duration - age;
  if (left > MARK_LOCKED_TAIL) return 0;
  return clamp01(1 - left / MARK_LOCKED_TAIL);
}

/** Has an execution mark locked in place? */
export const markLocked = (age: number, duration: number): boolean => duration - age <= MARK_LOCKED_TAIL;
