// Monsters: the horde. One pass over the struct-of-arrays store per frame, no allocation: sprite ids and frame
// metadata are precomputed per (kind, anim), every per-monster option lives in reused objects and per-slot
// presentation state (phase offsets, health-bar lag, special action sets) lives in typed arrays keyed by store
// slot, reset when the slot's id changes.
//
// Readability rules: rarity is a runtime treatment (magic = blue outline + faint underglow; rare = gold outline,
// gold light and ground glow, rising gold embers, name + bar — "a rare monster glows gold and shows its name";
// lieutenant/boss = strong outlines and presence), windups pulse a danger tint so attacks are telegraphed by the
// body as well as the ground, ailments are visible at a glance (burning embers + orange light, chilled blue tint +
// frost, shocked violet sparks), and monsters empowered by the Herald glow with a red rim. Every other monster
// carries its theme's dim 1 px rim (ThemeLook.monsterRim), so a normal body never melts into the floor outside the
// light pools. Presence lights are culled by their own reach, not the sprite's, so a boss's glow never blinks at
// the screen edge.
//
// Per-roster looks (bestiary.ts MONSTER_LOOKS): the Rimeshade is a translucent ghost with a cold halo; floating
// kinds (Rimeshade, Glacial Wisp, Hollow Warden) cast a soft, small shadow; each boss and lieutenant has its own
// presence — the Matriarch's molten sigil, the Warden's frost sigil and the cold light of its lantern (hung on the
// lantern itself, measured from the art: Hotspots), Varkus's forge-hot shield boss and arena-gold glow, the
// Chorister's cold halo, the Chainmaster's red-hot hooks.
//
// Special action sets (bestiary.ts): a 'monsterAttack' starts one on the monster that sent it (nearest of its kind
// to the event): the wisp's burst, the chain thrall's throw, the Warden's cast (prison, spikes, summons, blizzard),
// the Chorister's raising chant; it shows while the monster's anim stays in the set's states. A 'blocked' event
// puts the nearest shield-bearer into its brace for a moment. Varkus's charge and whirl and the Chainmaster's whirl
// follow what the sim draws: the charge sprite while he runs along one of his charge lanes, the whirl while a
// spinning blade ring (whirlwind variant 1) is centred on him — the telegraph is the signal, the body matches it.
import { MONSTER_KINDS, type MonsterKind } from '../contracts/content';
import type { RGB } from '../contracts/render';
import { AILMENT_BIT, MONSTER_ANIM, RARITY_CODE } from '../contracts/sim';
import {
  ACTION_SPRITES, BLOCK_HOLD, BLOCK_POSE, COMMANDERS, DEFAULT_LEAP, LEAP_ARC, MONSTER_LOOKS, STATIC_ACTIONS, animBit, isWhirlBlades, laneDistance, laneOf,
  type Lane, type MonsterAttack, type PresenceLook,
} from './bestiary';
import { C } from './colors';
import { LIGHT_CAPS, lightInView, type FrameCtx } from './context';
import { clamp01, hash1, TAU } from './math';
import { MonsterNameCache } from './names';
import type { Pen } from './pen';
import type { Hotspots, SpriteMeta, SpriteTable } from './sprites';

const ANIM_COUNT = 6;
const KIND_COUNT = MONSTER_KINDS.length;
const KIND = Object.fromEntries(MONSTER_KINDS.map((k, i) => [k, i])) as Record<MonsterKind, number>;
/** MONSTER_LOOKS and leap arcs by kind index (the draw loop indexes by the store's kind byte). */
const LOOK_BY_KIND = MONSTER_KINDS.map((k) => MONSTER_LOOKS[k]);
const LEAP_BY_KIND = MONSTER_KINDS.map((k) => LEAP_ARC[k] ?? DEFAULT_LEAP);

const OUTLINE_MAGIC: RGB = [0.42, 0.58, 1];
const OUTLINE_RARE: RGB = [0.98, 0.82, 0.3];
const OUTLINE_LIEUTENANT: RGB = [1, 0.5, 0.18];
const OUTLINE_BOSS: RGB = [0.92, 0.24, 0.08];
const OUTLINE_EMPOWERED: RGB = [0.7, 0.16, 0.08];
/** The Rimeshade's rim: a cold, pale edge (it is translucent: the theme rim would read as a solid outline). */
const GHOST_RIM: RGB = [0.36, 0.48, 0.6];
const GHOST_HALO: RGB = [0.45, 0.7, 1];
const WINDUP: RGB = [1, 0.25, 0.12];
const HIT_FLASH: RGB = [1, 0.93, 0.8];
const BURN_LIGHT: RGB = [1, 0.48, 0.14];
const SHIELD: RGB = [0.62, 0.78, 1];
const BAR_BG: RGB = [0.04, 0.03, 0.035];
const BAR_LIFE: RGB = [0.78, 0.13, 0.12];
const BAR_LAG: RGB = [1, 0.85, 0.55];
// Magic monsters: the life bar takes their blue so the pack reads as one.
const BAR_MAGIC: RGB = [0.36, 0.52, 0.95];
const NAME_RARE: RGB = [0.98, 0.84, 0.36];
/** How many rare packs show their full name at once (the nearest ones). */
const NAMED_RARES = 3;
const NAME_LT: RGB = [1, 0.58, 0.24];
const RARE_GLOW: RGB = [1, 0.78, 0.3];
const MAGIC_GLOW: RGB = [0.35, 0.5, 1];
const BOSS_FLOOR: RGB = [1, 0.34, 0.1];
const BOSS_POOL: RGB = [0.7, 0.14, 0.04];
const DUST: RGB = [0.5, 0.43, 0.36];
const DUST_END: RGB = [0.16, 0.13, 0.11];
/** Plate padding of the rare/lieutenant name (pixels). */
const NAME_PAD = 1;
/** Floats per notable record: x, y, rarity, height of the drawn body + plate above the feet, kind index. */
export const NOTABLE_STRIDE = 5;
const NOTABLE_CAP = 64;
/** A pending action set waits this long for its anim state before it is dropped (a lost or late snapshot). */
const ACTION_PENDING = 2.5;
/** Events name no monster: the sender is the nearest of its kind within this distance of the event. */
const EVENT_MATCH = 56;
/** A whirl ring centred within this distance of the monster is its own. */
const WHIRL_MATCH = 10;
/** Lanes / whirls scanned per frame (a handful exist at a time). */
const LANE_CAP = 16;

/** A special action that started this frame (the presenter plays its sound and the launch beat). */
export type MonsterAction = 'charge' | 'whirl';

export interface MonsterHooks {
  /** A driven action began on a monster at (x, y): Varkus launched his charge, a whirl started spinning. */
  actionStart(kind: MonsterKind, action: MonsterAction, x: number, y: number): void;
}

const NO_HOOKS: MonsterHooks = { actionStart: () => {} };

/** Special sprite indices of the driven actions (see `special`). */
const enum Driven {
  None = 0,
  Charge = 1,
  Whirl = 2,
}

export class MonsterPainter {
  private readonly ids: string[] = [];
  private readonly metas: SpriteMeta[] = [];
  private readonly shadow = new Float32Array(KIND_COUNT);
  /** Special action sprites: ids and metas by index, and the index for (kind, name). */
  private readonly specialIds: string[] = [];
  private readonly specialMetas: SpriteMeta[] = [];
  private readonly specialIndex = new Map<string, number>();
  /** Per kind: special index of its 'charge' / 'whirl' sprite (−1 = none). */
  private readonly chargeSprite = new Int16Array(KIND_COUNT).fill(-1);
  private readonly whirlSprite = new Int16Array(KIND_COUNT).fill(-1);
  private readonly blockSprite = new Int16Array(KIND_COUNT).fill(-1);
  private cap = 0;
  private seen = new Uint32Array(0);
  private phase = new Float32Array(0);
  private lag = new Float32Array(0);
  /** Event-started action set per slot: special index (−1 none), anim mask, start time, active flag, deadline. */
  private ovIdx = new Int16Array(0);
  private ovMask = new Uint8Array(0);
  private ovT0 = new Float64Array(0);
  private ovActive = new Uint8Array(0);
  private ovUntil = new Float64Array(0);
  /** Area-driven action per slot (Driven) and when it started. */
  private drv = new Uint8Array(0);
  private drvT0 = new Float64Array(0);
  private readonly names = new MonsterNameCache();
  /** Scratch: the squared distances of the nearest rares (see rareNameCut). */
  private readonly nameBest = new Float64Array(NAMED_RARES);
  private readonly tint: [number, number, number] = [1, 1, 1];
  private readonly hotOut = { x: 0, y: 0 };
  /** This frame's charge lanes (variant ≥ 1) and whirling blade rings (x, y) for the driven actions. */
  private readonly lanes: Lane[] = Array.from({ length: LANE_CAP }, () => ({ x0: 0, y0: 0, ux: 1, uy: 0, len: 0, half: 0, aim: false }));
  private laneCount = 0;
  private readonly whirls = new Float32Array(LANE_CAP * 2);
  private whirlCount = 0;
  /** Commander presence lights placed this frame (x, y): two side by side share one's worth of light. */
  private readonly presence = new Float32Array(8 * 2);
  private presenceCount = 0;
  /**
   * Notable monsters this frame (off-screen indicators), NOTABLE_STRIDE floats each: rendered x, y, rarity, how
   * far above the feet the body and its plate reach (so a marker never sits on top of a visible name plate), kind.
   */
  readonly notable = new Float32Array(NOTABLE_STRIDE * NOTABLE_CAP);
  notableCount = 0;

  constructor(table: SpriteTable, private readonly hot: Hotspots | null = null, private readonly hooks: MonsterHooks = NO_HOOKS) {
    for (let k = 0; k < KIND_COUNT; k++) {
      const kind = MONSTER_KINDS[k];
      const remap = STATIC_ACTIONS[kind];
      for (let a = 0; a < ANIM_COUNT; a++) {
        let name: string;
        if (kind === 'trainingDummy') name = a === MONSTER_ANIM.attack ? 'attack' : 'idle';
        else if (a === MONSTER_ANIM.idle || a === MONSTER_ANIM.spawn) name = 'idle';
        else if (a === MONSTER_ANIM.move) name = 'move';
        else if (a === MONSTER_ANIM.windup) name = 'windup';
        else if (a === MONSTER_ANIM.leap) name = table.has(`monster/${kind}/leap`) ? 'leap' : 'attack';
        else name = 'attack';
        const alt = remap?.[a];
        if (alt && table.has(`monster/${kind}/${alt}`)) name = alt;
        const id = `monster/${kind}/${name}`;
        this.ids.push(id);
        this.metas.push(table.get(id));
      }
      // Shadow width follows the idle sprite's width.
      this.shadow[k] = Math.max(0.6, table.get(`monster/${kind}/idle`).width / 17);
      const acts = ACTION_SPRITES[kind];
      if (acts) for (const act of Object.values(acts)) if (act) this.special(table, kind, act.name);
      this.chargeSprite[k] = this.special(table, kind, 'charge');
      this.whirlSprite[k] = this.special(table, kind, 'whirl');
      this.blockSprite[k] = this.special(table, kind, BLOCK_POSE.name);
    }
    // Floating kinds cast a small, soft shadow: they hover.
    for (let k = 0; k < KIND_COUNT; k++) if (LOOK_BY_KIND[k].float) this.shadow[k] *= 0.75;
  }

  /** Register monster/<kind>/<name> as a special sprite if the art has it; its index or −1. */
  private special(table: SpriteTable, kind: MonsterKind, name: string): number {
    const id = `monster/${kind}/${name}`;
    const known = this.specialIndex.get(id);
    if (known !== undefined) return known;
    if (!table.has(id)) return -1;
    const idx = this.specialIds.length;
    this.specialIds.push(id);
    this.specialMetas.push(table.get(id));
    this.specialIndex.set(id, idx);
    return idx;
  }

  private ensure(capacity: number): void {
    if (capacity <= this.cap) return;
    this.cap = capacity;
    this.seen = new Uint32Array(capacity).fill(0xffffffff);
    this.phase = new Float32Array(capacity);
    this.lag = new Float32Array(capacity);
    this.ovIdx = new Int16Array(capacity).fill(-1);
    this.ovMask = new Uint8Array(capacity);
    this.ovT0 = new Float64Array(capacity);
    this.ovActive = new Uint8Array(capacity);
    this.ovUntil = new Float64Array(capacity);
    this.drv = new Uint8Array(capacity);
    this.drvT0 = new Float64Array(capacity);
  }

  reset(): void {
    this.seen.fill(0xffffffff);
    this.ovIdx.fill(-1);
    this.drv.fill(0);
  }

  /**
   * Slot of the living monster of kind index `kind` nearest to (x, y) within `maxDist` in `world`, or −1 (events
   * name no monster: they carry its kind and where it was).
   */
  static nearest(m: FrameCtx['world']['monsters'], kind: number, x: number, y: number, maxDist: number): number {
    let best = -1;
    let bd = maxDist * maxDist;
    const cap = m.capacity;
    for (let i = 0; i < cap; i++) {
      if (!m.alive[i] || m.kind[i] !== kind) continue;
      const dx = m.x[i] - x;
      const dy = m.y[i] - y;
      const d = dx * dx + dy * dy;
      if (d <= bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** A 'monsterAttack' arrived: start the sender's special action set, if its kind has one for this attack. */
  onAttack(f: FrameCtx, kind: MonsterKind, attack: MonsterAttack, x: number, y: number): void {
    const act = ACTION_SPRITES[kind]?.[attack];
    if (!act) return;
    const idx = this.specialIndex.get(`monster/${kind}/${act.name}`);
    if (idx === undefined) return;
    const m = f.world.monsters;
    this.ensure(m.capacity);
    // A lieutenant's or boss's cue may be placed at its target (the Warden's 'prison'): there is only one of them.
    const i = MonsterPainter.nearest(m, KIND[kind], x, y, COMMANDERS.has(kind) ? 1e6 : EVENT_MATCH);
    if (i < 0) return;
    this.claim(m, i);
    this.ovIdx[i] = idx;
    this.ovMask[i] = act.mask;
    this.ovT0[i] = f.time;
    this.ovActive[i] = act.mask & animBit(m.anim[i]) ? 1 : 0;
    this.ovUntil[i] = f.time + ACTION_PENDING;
  }

  /**
   * A shield stopped a projectile at (x, y): the nearest shield-bearer braces. Returns its slot (the caller draws the
   * frontal arc flash from its centre) or −1.
   */
  onBlocked(f: FrameCtx, x: number, y: number): number {
    const m = f.world.monsters;
    this.ensure(m.capacity);
    const k = KIND.shieldbearer;
    const i = MonsterPainter.nearest(m, k, x, y, 60);
    if (i < 0) return -1;
    const idx = this.blockSprite[k];
    if (idx < 0) return i;
    this.claim(m, i);
    // Repeated blocks restart the brace (its deflection spark shows again) at most every 0.12 s.
    if (this.ovIdx[i] !== idx || f.time - this.ovT0[i] > 0.12) this.ovT0[i] = f.time;
    this.ovIdx[i] = idx;
    this.ovMask[i] = BLOCK_POSE.mask;
    this.ovActive[i] = 2; // hold mode: shown until ovUntil while the anim allows it
    this.ovUntil[i] = f.time + BLOCK_HOLD;
    return i;
  }

  /** Make sure slot `i`'s per-slot state belongs to the monster now in it. */
  private claim(m: FrameCtx['world']['monsters'], i: number): void {
    const id = m.id[i];
    if (this.seen[i] === id) return;
    this.seen[i] = id;
    this.phase[i] = hash1(id);
    this.lag[i] = m.maxLife[i] > 0 ? m.life[i] / m.maxLife[i] : 1;
    this.ovIdx[i] = -1;
    this.drv[i] = Driven.None;
  }

  /** This frame's charge lanes and whirling blade rings (the driven actions look for them). */
  private scanAreas(f: FrameCtx): void {
    this.laneCount = 0;
    this.whirlCount = 0;
    const areas = f.world.areas;
    for (let k = 0; k < areas.length; k++) {
      const a = areas[k];
      if (a.kind === 'chargeLine' && this.laneCount < LANE_CAP) {
        const l = laneOf(a, this.lanes[this.laneCount]);
        if (!l.aim) this.laneCount++;
      } else if (a.kind === 'whirlwind' && isWhirlBlades(a) && this.whirlCount < LANE_CAP) {
        this.whirls[this.whirlCount * 2] = a.x;
        this.whirls[this.whirlCount * 2 + 1] = a.y;
        this.whirlCount++;
      }
    }
  }

  /** Driven action of a monster this frame: whirling inside its own blade ring, charging along a lane. */
  private driven(m: FrameCtx['world']['monsters'], i: number, kind: number): Driven {
    if (this.whirlSprite[kind] >= 0) {
      for (let w = 0; w < this.whirlCount; w++) {
        const dx = this.whirls[w * 2] - m.x[i];
        const dy = this.whirls[w * 2 + 1] - m.y[i];
        if (dx * dx + dy * dy <= WHIRL_MATCH * WHIRL_MATCH) return Driven.Whirl;
      }
    }
    if (this.chargeSprite[kind] >= 0 && m.anim[i] === MONSTER_ANIM.move) {
      for (let l = 0; l < this.laneCount; l++) {
        const lane = this.lanes[l];
        const q = laneDistance(lane, m.x[i], m.y[i]);
        if (q.d <= 4 && q.along > 0.5) return Driven.Charge;
      }
    }
    return Driven.None;
  }

  /**
   * The squared distance (from the local player) up to which a rare keeps its name plate this frame: the NAMED_RARES nearest ones.
   * Infinity when there are no more rares than that.
   */
  private rareNameCut(f: FrameCtx, m: FrameCtx['world']['monsters'], a: number): number {
    const best = this.nameBest;
    let n = 0;
    const px = f.local ? f.local.x : f.view.cx;
    const py = f.local ? f.local.y : f.view.cy;
    for (let i = 0; i < m.capacity; i++) {
      if (!m.alive[i] || m.rarity[i] !== RARITY_CODE.rare) continue;
      const dx = m.prevX[i] + (m.x[i] - m.prevX[i]) * a - px;
      const dy = m.prevY[i] + (m.y[i] - m.prevY[i]) * a - py;
      const d = dx * dx + dy * dy;
      // keep the NAMED_RARES smallest in `best` (insertion into a tiny sorted array)
      if (n < NAMED_RARES) { let k = n++; while (k > 0 && best[k - 1] > d) { best[k] = best[k - 1]; k--; } best[k] = d; }
      else if (d < best[NAMED_RARES - 1]) { let k = NAMED_RARES - 1; while (k > 0 && best[k - 1] > d) { best[k] = best[k - 1]; k--; } best[k] = d; }
    }
    return n < NAMED_RARES ? Infinity : best[NAMED_RARES - 1];
  }

  draw(pen: Pen, f: FrameCtx): void {
    const m = f.world.monsters;
    this.ensure(m.capacity);
    const r = pen.r;
    const v = f.view;
    const a = f.alpha;
    const dt = f.dt;
    const fxDt = f.fxDt;
    const time = f.time;
    const lights = f.lights;
    const tint = this.tint;
    const bossPhase = f.world.run.boss ? f.world.run.boss.phase : 1;
    this.notableCount = 0;
    this.presenceCount = 0;
    this.scanAreas(f);
    const cap = m.capacity;
    const nameCut = this.rareNameCut(f, m, a);
    for (let i = 0; i < cap; i++) {
      if (!m.alive[i]) continue;
      const x = m.prevX[i] + (m.x[i] - m.prevX[i]) * a;
      const y = m.prevY[i] + (m.y[i] - m.prevY[i]) * a;
      const rarity = m.rarity[i];
      const kind = m.kind[i];
      this.claim(m, i);
      const look = LOOK_BY_KIND[kind] ?? MONSTER_LOOKS.ashling;
      const anim = m.anim[i];
      const at = m.animTime[i];

      // Body sprite: a driven action (charge / whirl), an event-started action set, or the plain anim.
      let sid: string;
      let meta: SpriteMeta;
      let frame: number;
      const drv = kind < KIND_COUNT ? this.driven(m, i, kind) : Driven.None;
      if (drv !== this.drv[i]) {
        this.drv[i] = drv;
        this.drvT0[i] = time;
        if (drv !== Driven.None) this.hooks.actionStart(MONSTER_KINDS[kind], drv === Driven.Charge ? 'charge' : 'whirl', x, y);
      }
      let ov = this.ovIdx[i];
      if (ov >= 0) {
        const allowed = (this.ovMask[i] & animBit(anim)) !== 0;
        if (this.ovActive[i] === 2) {
          // Hold mode (the brace): while its time lasts and the monster isn't winding up or striking.
          if (!allowed || time > this.ovUntil[i]) ov = this.ovIdx[i] = -1;
        } else if (allowed) {
          if (!this.ovActive[i]) {
            this.ovActive[i] = 1;
            this.ovT0[i] = time;
          }
        } else if (this.ovActive[i] || time > this.ovUntil[i]) {
          ov = this.ovIdx[i] = -1;
        } else ov = -1; // still pending: the plain anim meanwhile
      }
      if (drv !== Driven.None) {
        const si = drv === Driven.Charge ? this.chargeSprite[kind] : this.whirlSprite[kind];
        sid = this.specialIds[si];
        meta = this.specialMetas[si];
        frame = frameOf(meta, time - this.drvT0[i], this.phase[i]);
      } else if (ov >= 0) {
        sid = this.specialIds[ov];
        meta = this.specialMetas[ov];
        frame = frameOf(meta, time - this.ovT0[i], this.phase[i]);
      } else {
        const si = kind * ANIM_COUNT + (anim < ANIM_COUNT ? anim : 0);
        sid = this.ids[si];
        meta = this.metas[si];
        frame = frameOf(meta, at, this.phase[i]);
      }
      const h = meta.anchorY;
      const isBoss = rarity === RARITY_CODE.boss;
      const isLt = rarity === RARITY_CODE.lieutenant;
      const isRare = rarity === RARITY_CODE.rare;
      const flip = m.facing[i] < 0;
      // Leaping bodies arc through the air above their shadow (the champion soars onto his mark); his presence
      // lights fly with him.
      let hop = 0;
      let air = 0;
      if (anim === MONSTER_ANIM.leap) {
        const arc = LEAP_BY_KIND[kind];
        air = Math.sin(Math.PI * clamp01(at / arc.flight));
        hop = air * arc.height;
      }
      if (rarity >= RARITY_CODE.rare) {
        if (this.notableCount < NOTABLE_CAP) {
          const o = this.notableCount++ * NOTABLE_STRIDE;
          this.notable[o] = x;
          this.notable[o + 1] = y;
          this.notable[o + 2] = rarity;
          this.notable[o + 3] = h + (isBoss ? 4 : 20);
          this.notable[o + 4] = kind;
        }
        this.presenceLights(pen, f, i, x, y - hop, h, rarity, bossPhase, look.presence, sid, frame, flip);
      }
      if (x < v.x0 - 50 || x > v.x1 + 50 || y < v.y0 - 10 || y > v.y1 + 90) continue;
      const ail = m.ailments[i];
      // A map-event fixture (a bloom, the Time Prism, a wheel): the event painter draws the prop; the body stays hidden.
      if (ail & AILMENT_BIT.fixture) continue;
      const spawning = anim === MONSTER_ANIM.spawn;
      const spawnK = spawning ? clamp01(at / 0.5) : 1;

      // Shadow (floating kinds: small and soft; the ghost barely marks the floor; a leaper's shrinks as it rises).
      // Sized by the body, not the frame: a greatsword or a swung chain widens the sprite, not the feet.
      const so = pen.sprite('shadow');
      const sw = Math.min(this.shadow[kind], Math.max(0.6, (m.radius[i] * 2.6) / 16) * (look.float ? 0.75 : 1)) * (1 - 0.3 * air);
      so.scaleX = sw;
      so.scaleY = sw * 0.7;
      so.alpha = (look.ghost ? 0.35 : look.float ? 0.55 : 0.8) * spawnK * (1 - 0.35 * air);
      r.sprite('fx/shadow', 0, x, y, so);

      // Ground presence under elites (on 'decal': under every body, never over one).
      if (isBoss) this.bossFloor(pen, f, x, y, bossPhase, spawnK, look.presence);
      else if (isLt && look.presence) this.ltFloor(pen, f, x, y, spawnK, look.presence);
      else if (isRare || rarity === RARITY_CODE.magic) {
        const g = pen.sprite('decal');
        g.additive = true;
        g.emissive = 1;
        g.tint = isRare ? RARE_GLOW : MAGIC_GLOW;
        g.alpha = (isRare ? 0.2 + 0.05 * Math.sin(time * 3 + i) : 0.08) * spawnK;
        g.scaleX = isRare ? 0.9 + m.radius[i] * 0.03 : 0.6;
        g.scaleY = isRare ? 0.35 + m.radius[i] * 0.012 : 0.24;
        r.sprite('fx/glow', 0, x, y - 1, g);
      }

      // Spawn sigil burning into the floor as the monster claws out of it.
      if (spawning) {
        const sg = pen.sprite('decal');
        sg.additive = true;
        sg.tint = f.look.sigil;
        sg.alpha = Math.sin(spawnK * Math.PI) * 0.8;
        sg.scale = Math.max(0.5, m.radius[i] / 11);
        sg.emissive = 1;
        r.sprite('fx/sigil', Math.floor(time * 10), x, y, sg);
      }

      // The ghost's cold halo: faint light around the shroud (additive, behind the body).
      if (look.ghost) {
        const g = pen.sprite('fx');
        g.additive = true;
        g.tint = GHOST_HALO;
        g.alpha = (0.1 + 0.04 * Math.sin(time * 4 + i)) * spawnK;
        g.scale = 0.5 + m.radius[i] * 0.03;
        g.sortY = y - 0.5;
        r.sprite('fx/glow', 0, x, y - h * 0.5, g);
      }

      // Body.
      const o = pen.sprite('world');
      o.flipX = flip;
      let flash = m.hitFlash[i];
      if (flash > 0) {
        // Warm and capped: a monster under sustained fire keeps its detail instead of becoming a white blob.
        o.flash = flash * (rarity >= RARITY_CODE.lieutenant ? 0.3 : 0.55);
        o.flashColor = HIT_FLASH;
      } else if (anim === MONSTER_ANIM.windup && kind !== KIND.trainingDummy) {
        // Wind-ups pulse towards danger red: the body telegraphs the attack.
        flash = 0.18 + 0.14 * Math.sin(time * 22);
        o.flash = flash;
        o.flashColor = WINDUP;
      }
      if (spawning) o.alpha = spawnK;
      // The ghost drifts translucent, its opacity breathing a little.
      if (look.ghost) o.alpha = (o.alpha ?? 1) * (0.74 + 0.08 * Math.sin(time * 2.6 + this.phase[i] * TAU));
      // Map events: a shimmering, broken-translucent event monster (the Stalker, echoes): always readable and targetable.
      if (ail & AILMENT_BIT.spectral) {
        const flicker = Math.sin(time * 9 + this.phase[i] * TAU) + 0.5 * Math.sin(time * 23 + i);
        o.alpha = (o.alpha ?? 1) * (flicker > 1.1 ? 0.5 : 0.78);
        o.emissive = Math.max(o.emissive ?? 0, 0.22);
      }
      // Exposed (a whiffed Stalker): a gold pulse says it takes extra damage now.
      if (ail & AILMENT_BIT.exposed) {
        o.flash = Math.max(o.flash ?? 0, 0.2 + 0.1 * Math.sin(time * 14));
        o.flashColor = C.gold;
      }
      // A frozen statue (Stasis Host): the first frame, held, in ice.
      if (ail & AILMENT_BIT.frozen) {
        frame = 0;
        o.emissive = Math.max(o.emissive ?? 0, 0.12);
      }
      if (ail & (AILMENT_BIT.chilled | AILMENT_BIT.shocked | AILMENT_BIT.burning | AILMENT_BIT.empowered | AILMENT_BIT.spectral | AILMENT_BIT.frozen | AILMENT_BIT.decayed)) {
        tint[0] = 1;
        tint[1] = 1;
        tint[2] = 1;
        if (ail & AILMENT_BIT.chilled) {
          tint[0] = 0.62;
          tint[1] = 0.8;
          tint[2] = 1;
        }
        if (ail & AILMENT_BIT.shocked) {
          tint[0] *= 0.94;
          tint[1] *= 0.9;
        }
        if (ail & AILMENT_BIT.burning) {
          tint[1] *= 0.9;
          tint[2] *= 0.78;
          o.emissive = 0.12;
        }
        if (ail & AILMENT_BIT.empowered) {
          tint[1] *= 0.86;
          tint[2] *= 0.8;
        }
        if (ail & AILMENT_BIT.spectral) {
          tint[0] *= 0.86;
          tint[1] *= 0.8;
        }
        // Decayed (Umbral Bolt): a bruised violet cast.
        if (ail & AILMENT_BIT.decayed) {
          tint[0] *= 0.86;
          tint[1] *= 0.72;
          tint[2] *= 0.92;
        }
        if (ail & AILMENT_BIT.frozen) {
          tint[0] = 0.58;
          tint[1] = 0.8;
          tint[2] = 1;
        }
        o.tint = tint;
      }
      // A boss never sinks into the dark: a little self-light, stronger each phase.
      if (isBoss) o.emissive = Math.max(o.emissive ?? 0, 0.08 + 0.04 * bossPhase);
      if (hop > 0) o.sortY = y;
      if (isBoss) o.outline = OUTLINE_BOSS;
      else if (isLt) o.outline = OUTLINE_LIEUTENANT;
      else if (isRare) o.outline = OUTLINE_RARE;
      else if (rarity === RARITY_CODE.magic) o.outline = OUTLINE_MAGIC;
      else if (ail & AILMENT_BIT.empowered) o.outline = OUTLINE_EMPOWERED;
      // Everyone else: the theme's dim rim, so a normal monster never melts into the floor.
      else o.outline = look.ghost ? GHOST_RIM : f.look.monsterRim;
      r.sprite(sid, frame, x, y - hop, o);

      const midY = y - h * 0.5;

      // A charging champion kicks up the sand as he runs.
      if (drv === Driven.Charge && Math.random() < fxDt * 30) this.dust(pen, x - m.facing[i] * 10, y, 1);

      // Ailments.
      if (ail & AILMENT_BIT.burning) {
        if (lights.burning < LIGHT_CAPS.burning) {
          lights.burning++;
          pen.light(x, midY, 24 + m.radius[i] * 1.5, BURN_LIGHT, 0.4, 0.65);
        }
        if (Math.random() < fxDt * 7) {
          const b = pen.burst(x + (Math.random() - 0.5) * m.radius[i] * 1.6, y - Math.random() * h * 0.8, 1, C.hot, C.ember);
          b.sprite = 'fx/ember';
          pen.speed(4, 12);
          pen.life(0.35, 0.7);
          pen.size(0.6, 1);
          b.angle = -Math.PI / 2;
          b.spread = 0.8;
          b.gravity = -40;
          pen.emit();
        }
      }
      if ((ail & AILMENT_BIT.chilled) && Math.random() < fxDt * 3) {
        const b = pen.burst(x + (Math.random() - 0.5) * m.radius[i] * 2, y - Math.random() * h, 1, C.ice, C.frost);
        b.sprite = 'fx/frost';
        pen.speed(2, 6);
        pen.life(0.4, 0.8);
        pen.size(0.4, 0.7);
        b.gravity = 20;
        pen.emit();
      }
      // Decay: violet motes seeping off the body and sinking.
      if ((ail & AILMENT_BIT.decayed) && Math.random() < fxDt * 5) {
        const b = pen.burst(x + (Math.random() - 0.5) * m.radius[i] * 1.8, y - Math.random() * h * 0.9, 1, C.voidHi, C.void);
        b.sprite = 'fx/mote';
        pen.speed(2, 8);
        pen.life(0.5, 0.9);
        pen.size(0.5, 0.8);
        b.gravity = 18;
        pen.emit();
      }
      if ((ail & AILMENT_BIT.shocked) && Math.random() < fxDt * 6) {
        const b = pen.burst(x + (Math.random() - 0.5) * m.radius[i] * 2, y - Math.random() * h, 2, C.lightning, C.storm);
        b.sprite = 'fx/spark';
        pen.speed(20, 50);
        pen.life(0.08, 0.16);
        pen.size(0.4, 0.7);
        pen.emit();
      }
      if (ail & AILMENT_BIT.shielded) {
        const sh = pen.shape(SHIELD, 0.28 + 0.1 * Math.sin(time * 5 + i), 'fx');
        sh.additive = true;
        sh.emissive = 0.7;
        sh.thickness = 1;
        r.ring(x, midY, m.radius[i] + 5, sh);
      }

      // Rising motes: gold for rare leaders, the boss's and lieutenant's own (heat, frost, embers).
      if (isRare && Math.random() < fxDt * 3) {
        const b = pen.burst(x + (Math.random() - 0.5) * m.radius[i] * 1.8, y - Math.random() * h * 0.6, 1, C.hot, C.gold);
        b.sprite = 'fx/ember';
        pen.speed(3, 8);
        pen.life(0.7, 1.2);
        pen.size(0.55, 0.85);
        b.angle = -Math.PI / 2;
        b.spread = 0.6;
        b.gravity = -22;
        pen.emit();
      } else if (isBoss) this.bossMotes(pen, f, x, y, m.radius[i], bossPhase, look.presence);
      else if (isLt && look.presence && Math.random() < fxDt * look.presence.moteRate) {
        const p = look.presence;
        const ang = Math.random() * TAU;
        const b = pen.burst(x + Math.cos(ang) * m.radius[i] * 1.4, y + Math.sin(ang) * m.radius[i] * 0.6, 1, p.moteC0, p.moteC1);
        b.sprite = p.mote;
        pen.speed(3, 10);
        pen.life(0.8, 1.4);
        pen.size(0.4, 0.7);
        b.angle = -Math.PI / 2;
        b.spread = 0.8;
        b.gravity = p.moteGravity;
        pen.emit();
      }

      // Name + health bar for rares and the lieutenant (the boss bar lives in the HUD).
      if (isRare || isLt) {
        const maxLife = m.maxLife[i];
        const frac = maxLife > 0 ? clamp01(m.life[i] / maxLife) : 1;
        this.lag[i] = Math.max(frac, this.lag[i] - dt * 0.5 * (1 + (this.lag[i] - frac) * 4));
        if (this.lag[i] < frac) this.lag[i] = frac;
        const w = isLt ? 40 : 26;
        const top = y - h - 6;
        const bx = Math.round(x - w / 2);
        const by = Math.round(top);
        r.rect(bx - 1, by - 1, w + 2, 5, pen.shape(BAR_BG, 0.9, 'top'));
        const lagW = Math.round(w * this.lag[i]);
        if (lagW > 0) r.rect(bx, by, lagW, 3, pen.shape(BAR_LAG, 0.85, 'top'));
        const lifeW = Math.round(w * frac);
        if (lifeW > 0) r.rect(bx, by, lifeW, 3, pen.shape(BAR_LIFE, 1, 'top'));
        // Only the few rares nearest to you carry their full name; the rest of a crowd show the bar alone (a name pile covers the screen).
        const pdx = x - (f.local ? f.local.x : v.cx);
        const pdy = y - (f.local ? f.local.y : v.cy);
        if (isRare && pdx * pdx + pdy * pdy > nameCut) continue;
        const name = this.names.name(kind, rarity, m.mods[i]);
        // Keep the whole plate on screen: a leader at the edge still shows its name (the bar stays on the body).
        const half = (r.measureText(name, 1) / 2 + NAME_PAD + 1) / f.zoom;
        const lo = v.cx - v.halfW + half + 2;
        const hi = v.cx + v.halfW - half - 2;
        const nx = lo <= hi ? (x < lo ? lo : x > hi ? hi : x) : x;
        const to = pen.text(isLt ? NAME_LT : NAME_RARE, 1, 1);
        pen.plate(to, C.plate, 0.62, undefined, NAME_PAD);
        r.text(name, nx, by - 7, to);
      } else if (!isBoss && kind !== KIND.trainingDummy && !spawning) {
        // Normal and magic monsters: a compact bar once they have taken damage (a full-health horde stays clean).
        const maxLife = m.maxLife[i];
        const frac = maxLife > 0 ? clamp01(m.life[i] / maxLife) : 1;
        this.lag[i] = Math.max(frac, this.lag[i] - dt * 0.5 * (1 + (this.lag[i] - frac) * 4));
        if (this.lag[i] < frac) this.lag[i] = frac;
        if (frac < 0.999 || this.lag[i] < 0.999) {
          const w = Math.max(10, Math.round(m.radius[i] * 2 + 4));
          const bx = Math.round(x - w / 2);
          const by = Math.round(y - h - 3);
          r.rect(bx - 1, by - 1, w + 2, 4, pen.shape(BAR_BG, 0.8, 'top'));
          const lagW = Math.round(w * this.lag[i]);
          if (lagW > 0) r.rect(bx, by, lagW, 2, pen.shape(BAR_LAG, 0.75, 'top'));
          const lifeW = Math.max(1, Math.round(w * frac));
          r.rect(bx, by, lifeW, 2, pen.shape(rarity === RARITY_CODE.magic ? BAR_MAGIC : BAR_LIFE, 1, 'top'));
        }
      }
    }
  }

  /**
   * Lights that make an elite read from afar: a boss's and lieutenant's own presence (the Matriarch's ember
   * underglow, the Warden's lantern, Varkus's shield boss…) and the gold light of rare leaders. Culled by their
   * reach, so they fade in with the floor they light instead of popping.
   */
  private presenceLights(
    pen: Pen, f: FrameCtx, i: number, x: number, y: number, h: number, rarity: number, bossPhase: number, p: PresenceLook | null,
    sid: string, frame: number, flip: boolean,
  ): void {
    const v = f.view;
    const time = f.time;
    if (rarity === RARITY_CODE.boss || rarity === RARITY_CODE.lieutenant) {
      if (!p) {
        if (rarity === RARITY_CODE.boss) {
          const k = 0.8 + 0.2 * Math.sin(time * 2.3) + (bossPhase - 1) * 0.18;
          if (lightInView(v, x, y - 20, 190)) pen.light(x, y - 20, 190, C.ember, 0.95 * k, 0.4);
          if (lightInView(v, x, y - 40, 70)) pen.light(x, y - 40, 70, C.hot, 0.5 * k, 0.3);
        } else if (lightInView(v, x, y - 22, 120)) pen.light(x, y - 22, 120, C.ember, 0.6 + 0.15 * Math.sin(time * 3), 0.35);
        return;
      }
      const phaseK = rarity === RARITY_CODE.boss ? 1 + (bossPhase - 1) * 0.15 : 1;
      // A lieutenant fighting beside its boss (or two presences crowding one spot) share their light: the player
      // between them must not bleach out.
      let near = 0;
      for (let q = 0; q < this.presenceCount; q++) {
        const dx = this.presence[q * 2] - x;
        const dy = this.presence[q * 2 + 1] - y;
        if (dx * dx + dy * dy < 160 * 160) near++;
      }
      if (this.presenceCount < 8) {
        this.presence[this.presenceCount * 2] = x;
        this.presence[this.presenceCount * 2 + 1] = y;
        this.presenceCount++;
      }
      const k = ((0.85 + 0.15 * Math.sin(time * 2.1 + this.phase[i] * TAU)) * phaseK) / (1 + 0.7 * near);
      const ly = y - h * 0.4;
      if (lightInView(v, x, ly, p.radius)) pen.light(x, ly, p.radius, p.light, p.intensity * k, p.flicker);
      if (p.hotRadius > 0) {
        // Hung on the art's own hot spot (the lantern swings with the Warden, the shield boss moves with Varkus).
        const spot = this.hot?.at(sid, frame, flip, this.hotOut) ?? null;
        const hx = spot ? x + spot.x : x;
        const hy = spot ? y + spot.y : y - h * 0.6;
        if (lightInView(v, hx, hy, p.hotRadius)) pen.light(hx, hy, p.hotRadius, p.hotLight, p.hotIntensity * k, p.flicker);
      }
      return;
    }
    if (f.lights.rare < LIGHT_CAPS.rare) {
      const rad = 40 + f.world.monsters.radius[i] * 2;
      const ly = y - h * 0.5;
      if (!lightInView(v, x, ly, rad)) return;
      f.lights.rare++;
      pen.light(x, ly, rad, C.gold, 0.55 + 0.12 * Math.sin(time * 3 + this.phase[i] * TAU), 0.1);
    }
  }

  /**
   * A boss's floor: the Matriarch stands on a broad molten pool and a slowly turning sigil, the Warden on a pool of
   * cold light and a frost sigil, Varkus on a glow of arena gold. Hotter each phase.
   */
  private bossFloor(pen: Pen, f: FrameCtx, x: number, y: number, phase: number, spawnK: number, p: PresenceLook | null): void {
    const r = pen.r;
    const time = f.time;
    const heat = 0.85 + 0.15 * Math.sin(time * 2.3) + (phase - 1) * 0.15;
    const scale = p ? p.floorScale : 3.4;
    const pool = pen.sprite('decal');
    pool.additive = true;
    pool.emissive = 1;
    pool.tint = p ? p.pool : BOSS_POOL;
    pool.alpha = 0.34 * heat * spawnK;
    pool.scaleX = scale;
    pool.scaleY = scale * 0.44;
    r.sprite('fx/glow', 0, x, y - 2, pool);
    const sigil = p ? p.sigil : BOSS_FLOOR;
    if (!sigil) return;
    const sg = pen.sprite('decal');
    sg.additive = true;
    sg.emissive = 1;
    sg.tint = sigil;
    sg.alpha = (0.16 + 0.05 * phase) * heat * spawnK;
    sg.scaleX = scale * 0.76;
    sg.scaleY = scale * 0.38;
    r.sprite('fx/sigil', Math.floor(time * 4), x, y - 1, sg);
  }

  /** A lieutenant's softer floor glow (its own colour). */
  private ltFloor(pen: Pen, f: FrameCtx, x: number, y: number, spawnK: number, p: PresenceLook): void {
    const g = pen.sprite('decal');
    g.additive = true;
    g.emissive = 1;
    g.tint = p.pool;
    g.alpha = (0.26 + 0.06 * Math.sin(f.time * 2.2)) * spawnK;
    g.scaleX = p.floorScale;
    g.scaleY = p.floorScale * 0.42;
    pen.r.sprite('fx/glow', 0, x, y - 1, g);
  }

  private bossMotes(pen: Pen, f: FrameCtx, x: number, y: number, radius: number, phase: number, p: PresenceLook | null): void {
    const rate = p ? p.moteRate * (1 + (phase - 1) * 0.5) : 18 + phase * 10;
    if (!(Math.random() < f.fxDt * rate)) return;
    const ang = Math.random() * TAU;
    const reach = Math.max(24, radius * 1.3);
    const b = pen.burst(x + Math.cos(ang) * reach, y + Math.sin(ang) * reach * 0.4, 1, p ? p.moteC0 : C.hot, p ? p.moteC1 : C.lavaDark);
    b.sprite = p ? p.mote : 'fx/ember';
    pen.speed(6, 18);
    pen.life(0.8, 1.6);
    // Frost flakes are big sprites: keep them small so the boss's feet don't bloom into a white cloud.
    if (p && p.mote === 'fx/frost') {
      pen.size(0.4, 0.7);
      b.emissive = 0.6;
    } else pen.size(0.7, 1.2);
    b.angle = -Math.PI / 2;
    b.spread = 0.9;
    b.gravity = p ? p.moteGravity : -34;
    pen.emit();
  }

  private dust(pen: Pen, x: number, y: number, count: number): void {
    const b = pen.burst(x, y - 1, count, DUST, DUST_END);
    b.sprite = 'fx/smoke';
    pen.speed(8, 24);
    pen.life(0.4, 0.8);
    pen.size(0.3, 0.55);
    b.sizeEnd = 1.6;
    b.drag = 0.85;
    b.additive = false;
    b.emissive = 0;
    b.gravity = -8;
    b.layer = 'world';
    pen.emit();
  }
}

/** Frame of a sprite `t` seconds into it (loops wrap from a per-monster phase; one-shots hold their last frame). */
function frameOf(meta: SpriteMeta, t: number, phase: number): number {
  if (meta.loop) return Math.floor(t * meta.fps + phase * meta.frames) % meta.frames;
  const fr = Math.floor(t * meta.fps);
  return fr >= meta.frames ? meta.frames - 1 : fr < 0 ? 0 : fr;
}
