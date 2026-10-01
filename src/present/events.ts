// SimEvent → visuals: impact sparks, damage numbers, shock rings, chain bolts, corpses, scorch marks, camera
// shake, flashes and the big-moment beats (unique drops, boss phases). Sound is mapped separately (sound.ts).
//
// Budgets: a dense wave emits hundreds of hits per frame, so impact bursts, light pulses and numbers are capped
// per frame (crits, killing blows and the local player's own hits first), and impacts converging on one spot
// are thinned (heat.ts) so a focus-fired target never disappears in bloom.
// Screen feedback is gathered over the frame and applied once in endFrame(): one shake (the strongest request
// plus a little of the rest), one crit kick under a decaying ceiling, one hurt flash at most every 0.12 s.
//
// Rimed Ossuary / Iron Coliseum: every 'monsterAttack' first tells the monster painter (special action sets), then
// gets its own beat (the weaver's web puff, the crossbow's muzzle, the shield bash, the Warden's cold gusts…);
// deaths come apart by family (ash, rime-bone chips and frost, dust and blood); a Glacial Wisp that bursts dies as
// its burst sprite (no corpse); the bestiary's telegraphs resolve into ice spikes rising, prisons shattering, arena
// spikes shooting up and the execution strike. Player debuffs pop as they land ('debuff', debuffs.ts: a full pop
// only when new or its stacks rose, a faint shimmer on a refresh), cleanses rinse, 'blocked' flashes the
// shield-bearer's frontal arc with a spark, and 'pull' snaps a chain taut from the thrower to the yanked player
// (chain.ts Tethers). Burn / bleed ticks on a player (handle(e, f, dot)) are ticks, not blows: a small running
// number in the debuff's colour, no sparks and no hurt beat.
import type { SfxId } from '../contracts/audio';
import { THEME_ROSTER } from '../contracts/bestiary';
import { MONSTER_KINDS, type DamageType, type MonsterKind } from '../contracts/content';
import type { RGB } from '../contracts/render';
import { RARITY_CODE, type DropTone, type ProjectileKind, type SimEvent } from '../contracts/sim';
import { layoutFor } from '../data/layouts';
import { spikeFlip } from './bestiary-areas';
import { accentOf, MONSTER_LOOKS } from './bestiary';
import type { CameraRig } from './camera';
import type { Tethers } from './chain';
import { C, IMPACT_COLOR, TONE_COLOR } from './colors';
import { CHARGE_MAX_RADIUS, playerById, type FrameCtx } from './context';
import { eventColor, type MapEventPainter } from './map-events';
import { DEBUFF_WORD, debuffColor, findDebuff, type DebuffPainter } from './debuffs';
import { NUM_STYLE_PLAYER_BLEED, NUM_STYLE_PLAYER_BURN, NUM_STYLE_PLAYER_HURT, sparks, type Effects } from './fx';
import { ImpactHeat } from './heat';
import { clamp01, TAU } from './math';
import { MonsterPainter } from './monsters';
import type { Pen } from './pen';
import type { PlayerPainter } from './players';
import type { PostState } from './post';
import type { PropPainter } from './props';
import type { SpriteTable } from './sprites';

const DT_INDEX: Record<DamageType, number> = { physical: 0, fire: 1, cold: 2, lightning: 3, void: 4 };
const KIND_INDEX = Object.fromEntries(MONSTER_KINDS.map((k, i) => [k, i])) as Record<MonsterKind, number>;
const BIG: ReadonlySet<MonsterKind> = new Set(MONSTER_KINDS.filter((k) => MONSTER_LOOKS[k].big));
const FAMILY_INDEX = { ash: 0, rime: 1, dust: 2 } as const;
/** Hook throwers: a 'pull' is anchored on the nearest of them along the drag. */
const HOOKERS = [KIND_INDEX.chainThrall, KIND_INDEX.chainmaster];
/** Corpse lifetimes (seconds) before they have fully crumbled to ash. */
const CORPSE_LIFE = 7;
const CORPSE_LIFE_BIG = 12;
const CORPSE_LIFE_BOSS = 30;

const FLASH_UNIQUE: RGB = [1, 0.62, 0.3];
const FLASH_BOSS: RGB = [0.55, 0.06, 0.03];
const FLASH_PHASE: RGB = [1, 0.5, 0.2];
const FLASH_HURT: RGB = [0.7, 0.04, 0.03];
const FLASH_LEVEL: RGB = [1, 0.86, 0.55];
const FLASH_CLEAR: RGB = [1, 0.84, 0.5];
const FLASH_TELL: RGB = [0.4, 0.05, 0.03];
const DUST: RGB = [0.42, 0.36, 0.33];
const DUST_END: RGB = [0.14, 0.12, 0.12];
const DEBRIS: RGB = [0.3, 0.26, 0.26];
const FOCUS_TEXT: RGB = [0.55, 0.7, 1];
const EVADE_TEXT: RGB = [0.75, 0.82, 0.95];
const LIFE_UP: RGB = [1, 0.35, 0.3];
/** Allies' casts and blinks are drawn a step quieter than your own. */
const ALLY_FX = 0.6;
/** Crit shake: one small kick per frame, while the recent crit trauma stays under a ceiling that drains. */
const CRIT_SHAKE = 0.1;
const CRIT_TRAUMA_MAX = 0.3;
const CRIT_TRAUMA_DRAIN = 1;
/** Hurt flashes: at most one per interval, sized by the life lost since the previous one. */
const HURT_FLASH_GAP = 0.12;
const HURT_FLASH_MAX = 0.28;
/** A hit taking at least this share of max life gets its beat at once. */
const HURT_BIG = 0.15;
const FOCUS_UP: RGB = [0.45, 0.6, 1];
const BONE_CHIP: RGB = [0.86, 0.82, 0.72];
const BONE_END: RGB = [0.4, 0.42, 0.48];
const SAND: RGB = [0.62, 0.52, 0.4];
const SAND_END: RGB = [0.2, 0.17, 0.13];
const BLOOD: RGB = [0.82, 0.12, 0.1];
const BLOOD_END: RGB = [0.3, 0.03, 0.03];
const SHIELD_ARC: RGB = [1, 0.88, 0.6];
const FROST_FLASH: RGB = [0.6, 0.82, 1];
const MARK_RED: RGB = [1, 0.16, 0.1];
const TAR: RGB = [0.16, 0.11, 0.07];
const TAR_END: RGB = [0.03, 0.02, 0.02];
/** A wisp that dies within this long and this near of its burst is the burst: no corpse. */
const BURST_MATCH_TIME = 0.15;
const BURST_MATCH_DIST = 14;
/** Public drops (items players put on the floor): neutral bone, never a rarity colour. */
const PUBLIC_RING: RGB = [0.75, 0.7, 0.6];
const POOF: RGB = [0.62, 0.58, 0.54];
const POOF_END: RGB = [0.22, 0.2, 0.2];

const SKILL_COLOR = {
  emberLance: C.flame, emberNova: C.flame, flameWave: C.flame, rimeShards: C.frost, arcChain: C.storm, riftStep: C.voidGlow,
  cinderWard: C.hot,
} as const;

const PROJECTILE_END: Record<ProjectileKind, readonly [RGB, RGB, number]> = {
  emberLance: [C.hot, C.ember, 6],
  novaFlame: [C.flame, C.lavaDark, 4],
  flameWave: [C.flame, C.lavaDark, 6],
  rimeShard: [C.ice, C.mana, 5],
  cinderSpit: [C.hot, C.lavaDark, 12],
  heraldOrb: [C.voidHi, C.void, 8],
  matriarchOrb: [C.hot, C.lavaDark, 10],
  webShot: [C.ice, C.frost, 6],
  frostShard: [C.ice, C.mana, 6],
  crossbowBolt: [[1, 0.92, 0.75], [0.45, 0.38, 0.32], 5],
  chainHook: [C.hot, C.ember, 6],
  tarGlob: [TAR, TAR_END, 10],
  boneShard: [BONE_CHIP, BONE_END, 5],
};

export interface EventKit {
  pen: Pen;
  fx: Effects;
  rig: CameraRig;
  post: PostState;
  players: PlayerPainter;
  props: PropPainter;
  table: SpriteTable;
  impactDelay: (id: SfxId) => number;
  monsters?: MonsterPainter;
  debuffs?: DebuffPainter;
  tethers?: Tethers;
  mapEvents?: MapEventPainter;
}

export class EventFx {
  /** Per-frame budgets. */
  private bursts = 0;
  private pulses = 0;
  private dust = 0;
  /** Big impacts (slams, eruptions, meteors) resolved this frame: after a few, the rest are drawn lighter. */
  private big = 0;
  private readonly heat = new ImpactHeat(0.1);
  /**
   * Blasts landing on one spot in quick succession (a meteor shower bunched against the arena rim resolves one
   * rock every 0.12 s): only the first two per cell get the ring and the light pulse, later ones a light burst.
   */
  private readonly blastHeat = new ImpactHeat(0.6, 48);
  /** Shake requested this frame (strongest and total). */
  private shakeMax = 0;
  private shakeSum = 0;
  private critThisFrame = false;
  /** Crit-driven trauma added recently (drains over time; caps crit shake). */
  private critTrauma = 0;
  /** Share of the local player's max life lost this frame, and since the last hurt flash. */
  private hurtFrac = 0;
  private hurtCarry = 0;
  private lastHurtFlash = -1;
  private readonly frames = { impact: 4, levelUp: 8, sigil: 8, slash: 4, iceSpike: 8, arenaSpike: 8, wispBurst: 6, shieldArc: 4 };
  private readonly lifeOf = { iceSpike: 0.57, arenaSpike: 0.67, wispBurst: 0.43, shieldArc: 0.22 };
  /** Recent wisp bursts (x, y, time) so the dying wisp leaves its burst instead of a corpse. */
  private readonly bursts3 = new Float64Array(8 * 3);
  private burstNext = 0;

  constructor(private readonly k: EventKit) {
    const t = k.table;
    this.frames.impact = t.get('fx/impact').frames;
    this.frames.levelUp = t.get('fx/levelUp').frames;
    this.frames.sigil = t.get('fx/sigil').frames;
    this.frames.slash = t.get('fx/slash').frames;
    const once = (id: string, key: 'iceSpike' | 'arenaSpike' | 'wispBurst' | 'shieldArc'): void => {
      const m = t.get(id);
      this.frames[key] = m.frames;
      this.lifeOf[key] = m.frames / (m.fps || 12);
    };
    once('fx/iceSpike', 'iceSpike');
    once('fx/arenaSpike', 'arenaSpike');
    once('monster/glacialWisp/burst', 'wispBurst');
    once('fx/shieldArc', 'shieldArc');
    for (let i = 0; i < MONSTER_KINDS.length; i++) {
      const m = t.get(`monster/${MONSTER_KINDS[i]}/corpse`);
      k.fx.corpses.setInfo(i, m.frames, m.fps, FAMILY_INDEX[MONSTER_LOOKS[MONSTER_KINDS[i]].corpse]);
    }
    this.bursts3.fill(-1e9);
  }

  /** Start a frame (`dt` real seconds since the last one). */
  beginFrame(dt: number): void {
    this.bursts = 0;
    this.pulses = 0;
    this.dust = 0;
    this.big = 0;
    this.shakeMax = 0;
    this.shakeSum = 0;
    this.critThisFrame = false;
    this.hurtFrac = 0;
    this.critTrauma = Math.max(0, this.critTrauma - dt * CRIT_TRAUMA_DRAIN);
    this.k.fx.numbers.beginFrame();
  }

  /** Apply the frame's gathered screen feedback (after every event of the frame was handled). */
  endFrame(f: FrameCtx): void {
    const { rig, post } = this.k;
    if (this.critThisFrame && this.critTrauma < CRIT_TRAUMA_MAX) {
      this.critTrauma += CRIT_SHAKE;
      this.shake(CRIT_SHAKE);
    }
    // Getting hit: one "hurt beat" (flash, shake, kick, chromatic) per HURT_FLASH_GAP, sized by all the life lost
    // since the previous beat — surrounded by eight attackers reads as a pulse, not a permanent red veil. A single
    // big hit never waits.
    this.hurtCarry += this.hurtFrac;
    const due = this.lastHurtFlash < 0 || f.time - this.lastHurtFlash >= HURT_FLASH_GAP || f.time < this.lastHurtFlash;
    if (this.hurtCarry > 0 && (due || this.hurtFrac > HURT_BIG)) {
      const hurt = this.hurtCarry;
      post.flash(FLASH_HURT, Math.min(HURT_FLASH_MAX, 0.05 + hurt * 0.5), 0.3);
      this.shake(Math.min(0.5, 0.16 + hurt * 1.1));
      const kick = 2 + 3 * clamp01(hurt * 4);
      const a = Math.random() * TAU;
      rig.kick(Math.cos(a) * kick, Math.sin(a) * kick);
      if (hurt > 0.12) post.chromatic(Math.min(0.8, 0.35 + hurt));
      this.lastHurtFlash = f.time;
      this.hurtCarry = 0;
    }
    if (this.shakeMax > 0) rig.shake(Math.min(1, this.shakeMax + 0.25 * (this.shakeSum - this.shakeMax)));
  }

  /** Zone change: forget spatial and feedback state. */
  reset(): void {
    this.heat.clear();
    this.blastHeat.clear();
    this.critTrauma = 0;
    this.hurtCarry = 0;
    this.lastHurtFlash = -1;
    this.bursts3.fill(-1e9);
    this.k.tethers?.clear();
  }

  /** Request screen shake for this frame (applied once in endFrame). */
  private shake(amount: number): void {
    if (!(amount > 0)) return;
    if (amount > this.shakeMax) this.shakeMax = amount;
    this.shakeSum += amount;
  }

  /** One event's visuals. `dot`: a 'hit' that is a burn / bleed tick on a player (DebuffPainter.isDotTick). */
  handle(e: SimEvent, f: FrameCtx, dot = false): void {
    const { pen, fx, rig, post } = this.k;
    const local = f.localId;
    switch (e.t) {
      case 'cast': {
        this.k.players.released(e.playerId, e.skill);
        const pos = this.k.players.pos.get(e.playerId);
        const x = pos ? pos.tipX : e.x;
        const y = pos ? pos.tipY : e.y - 14;
        const col = SKILL_COLOR[e.skill] ?? C.flame;
        const ang = Math.atan2(e.dirY, e.dirX);
        // Muzzle flashes: allies' a step quieter, and a party casting shoulder to shoulder shares one cell's
        // budget, so three wands firing together never fuse into a white ball over the casters.
        const pk = (e.playerId === local ? 1 : ALLY_FX) * (this.heat.touch(x, y, f.time) >= 2 ? 0 : 1);
        if (e.skill === 'flameWave') {
          const b = pen.burst(x, y, 16, C.hot, C.ember);
          pen.speed(40, 110);
          pen.life(0.15, 0.35);
          pen.size(0.8, 1.4);
          b.angle = ang;
          b.spread = 1.1;
          b.drag = 0.9;
          pen.emit();
          if (pk > 0) fx.pulses.spawn(x, y, 60, 0.2, C.flame, 0.55 * pk);
        } else if (e.skill === 'rimeShards') {
          const b = pen.burst(x, y, 5, C.ice, C.mana);
          b.sprite = 'fx/frost';
          b.emissive = 0.6;
          pen.speed(40, 100);
          pen.life(0.12, 0.26);
          pen.size(0.4, 0.6);
          b.angle = ang;
          b.spread = 0.6;
          b.drag = 0.9;
          pen.emit();
          if (pk > 0) fx.pulses.spawn(x, y, 46, 0.15, C.frost, 0.45 * pk);
        } else if (e.skill === 'emberLance') {
          const b = pen.burst(x, y, 4, C.hot, C.ember);
          pen.speed(30, 80);
          pen.life(0.08, 0.18);
          pen.size(0.6, 0.9);
          b.angle = ang;
          b.spread = 0.7;
          pen.emit();
          if (pk > 0 && this.pulses++ < 6) fx.pulses.spawn(x, y, 40, 0.1, C.flame, 0.35 * pk);
        } else if (e.skill !== 'cinderWard') {
          sparks(pen, x, y, 6, C.hot, col, 20, 60, 0.2);
          if (pk > 0) fx.pulses.spawn(x, y, 50, 0.15, col, 0.5 * pk);
        }
        return;
      }
      case 'nova': {
        const y = e.y - 6;
        fx.rings.spawn(e.x, y, 6, e.radius, 0.38, C.flame, 1, 0.7, 0.6);
        fx.rings.spawn(e.x, y, 4, e.radius * 0.45, 0.22, C.hot, 1, 0.6);
        const b = pen.burst(e.x, y, 16, C.hot, C.ember);
        pen.speed(e.radius * 1.4, e.radius * 2.6);
        pen.life(0.18, 0.38);
        pen.size(0.8, 1.4);
        b.drag = 0.92;
        pen.emit();
        if (e.playerId === local) this.shake(0.12);
        return;
      }
      case 'dash': {
        // Void afterimages along the blink: lit, non-additive ghosts on the world layer (they sort with the crowd
        // and never bloom into a white ball over her), stopping short of where she lands.
        const k = e.playerId === local ? 1 : ALLY_FX;
        const n = 5;
        const dx = e.toX - e.fromX;
        const dy = e.toY - e.fromY;
        const flip = dx < 0;
        const horizontal = Math.abs(dx) > Math.abs(dy) * 0.8;
        const id = horizontal ? 'sorceress/dash/east' : dy < 0 ? 'sorceress/dash/north' : 'sorceress/dash/south';
        for (let i = 0; i < n; i++) {
          const t = i / n;
          fx.sprites.spawn(id, 3, e.fromX + dx * t, e.fromY + dy * t, 0.2 + 0.2 * t, {
            frame: 1, color: C.voidGlow, additive: false, alpha: (0.18 + 0.22 * t) * k, flip, world: true,
          });
        }
        const len = Math.hypot(dx, dy);
        const steps = Math.min(8, Math.ceil(len / 14));
        for (let i = 0; i <= steps; i++) {
          const t = i / Math.max(1, steps);
          const b = pen.burst(e.fromX + dx * t, e.fromY + dy * t - 10, 2, C.voidHi, C.void);
          pen.speed(6, 24);
          pen.life(0.25, 0.5);
          pen.size(0.6, 1);
          pen.emit();
        }
        fx.pulses.spawn(e.fromX, e.fromY - 10, 48, 0.22, C.voidGlow, 0.25 * k);
        fx.pulses.spawn(e.toX, e.toY - 10, 52, 0.26, C.voidGlow, 0.38 * k);
        fx.rings.spawn(e.toX, e.toY - 2, 4, 18, 0.3, C.voidGlow, 1, 0.7 * k);
        return;
      }
      case 'ward': {
        fx.rings.spawn(e.x, e.y - 8, 8, 44, 0.45, C.hot, 2, 0.9, 1);
        const b = pen.burst(e.x, e.y - 10, 20, C.hot, C.ember);
        b.sprite = 'fx/ember';
        pen.speed(30, 70);
        pen.life(0.3, 0.6);
        b.drag = 0.8;
        pen.emit();
        return;
      }
      case 'chain': {
        fx.chains.spawn(e.points, e.damageType);
        const pts = e.points;
        for (let i = 2; i + 1 < pts.length && i < 32; i += 2) sparks(pen, pts[i], pts[i + 1] - 7, 5, C.lightning, C.storm, 30, 90, 0.2);
        return;
      }
      case 'hit':
        if (dot) this.dotTick(e, f);
        else this.hit(e, f);
        return;
      case 'evade':
        if (e.target === 'player') fx.texts.spawn('Evade', e.x, e.y - 30, EVADE_TEXT, 0.6, 1, 10);
        return;
      case 'projectileEnd': {
        if (this.bursts++ > 30) return;
        const pe = PROJECTILE_END[e.kind];
        const c0 = pe[0];
        const c1 = pe[1];
        const n = pe[2];
        if (e.kind === 'cinderSpit') {
          const b = pen.burst(e.x, e.y, n, c0, c1);
          pen.speed(20, 60);
          pen.life(0.2, 0.45);
          pen.size(0.8, 1.3);
          b.upward = undefined;
          b.drag = 0.85;
          pen.emit();
          fx.rings.spawn(e.x, e.y, 3, 14, 0.25, C.ember, 1, 0.8);
          // A barrage landing around you: two flashes per spot, the rest just burst and scorch.
          if (this.heat.touch(e.x, e.y, f.time) < 2) fx.pulses.spawn(e.x, e.y, 46, 0.25, C.ember, 0.6);
          fx.decals.spawn(e.x, e.y, 0.5, 5, 0.7);
        } else if (e.kind === 'tarGlob') {
          // Tar splashes where it lands (the pool is the area): heavy dark droplets, no glow.
          const b = pen.burst(e.x, e.y - 2, n, c0, c1);
          b.sprite = 'fx/spark';
          pen.speed(20, 50);
          pen.upward(30, 70);
          b.z = 2;
          b.gravity = 300;
          pen.life(0.35, 0.6);
          pen.size(0.6, 1);
          b.sizeEnd = 0.8;
          b.additive = false;
          b.emissive = 0.05;
          b.layer = 'world';
          pen.emit();
          fx.rings.spawn(e.x, e.y, 3, 16, 0.25, [0.9, 0.55, 0.2], 1, 0.35);
        } else if (e.kind === 'webShot') {
          // The web splats where it ends: a sticky frost-silk mark for a moment.
          fx.decals.spawn(e.x, e.y, 0.55, 1.6, 0, 'web');
          sparks(pen, e.x, e.y - 8, n, c0, c1, 10, 35, 0.25);
        } else sparks(pen, e.x, e.y - 8, n, c0, c1, 15, 55, 0.22);
        return;
      }
      case 'death':
        this.death(e, f);
        return;
      case 'monsterAttack': {
        this.k.monsters?.onAttack(f, e.kind, e.attack, e.x, e.y);
        this.attack(e, f);
        return;
      }
      case 'monsterSpawn': {
        if (e.rarity >= RARITY_CODE.lieutenant) {
          fx.rings.spawn(e.x, e.y, 10, 120, 0.8, accentOf(e.kind), 2, 1, 1.5);
          this.shake(0.35);
        } else if (e.kind === 'rimeshade') {
          // A ghost gathers out of the cold rather than clawing out of the floor.
          const b = pen.burst(e.x, e.y - 8, 6, C.ice, C.mana);
          b.sprite = 'fx/frost';
          pen.speed(6, 18);
          pen.life(0.4, 0.8);
          pen.size(0.5, 0.8);
          b.gravity = -12;
          pen.emit();
        } else if (this.dust++ < 6) this.dustPuff(e.x, e.y, 3);
        return;
      }
      case 'ailment': {
        if (this.bursts++ > 30) return;
        if (e.ailment === 'burning') sparks(pen, e.x, e.y - 8, 6, C.hot, C.ember, 10, 40, 0.4);
        else if (e.ailment === 'chilled') {
          const b = pen.burst(e.x, e.y - 8, 6, C.ice, C.frost);
          b.sprite = 'fx/frost';
          pen.speed(10, 30);
          pen.life(0.25, 0.5);
          pen.size(0.5, 0.8);
          pen.emit();
        } else sparks(pen, e.x, e.y - 8, 6, C.lightning, C.storm, 30, 80, 0.2);
        return;
      }
      case 'areaResolve':
        this.areaResolve(e, f);
        return;
      case 'dropSpawn': {
        if (e.owner === 0) {
          // Someone put an item on the floor: a soft thud of dust, never the loot fanfare.
          this.dustPuff(e.x, e.y, 5);
          fx.rings.spawn(e.x, e.y - 1, 2, 9, 0.25, PUBLIC_RING, 1, 0.45);
          return;
        }
        if (e.owner !== local) return;
        this.dropSpawn(e.tone, e.x, e.y);
        return;
      }
      case 'pickup': {
        if (e.playerId === local) {
          const col = TONE_COLOR[e.tone];
          const b = pen.burst(e.x, e.y - 6, 8, C.hot, col);
          b.sprite = 'fx/spark';
          pen.speed(10, 40);
          pen.life(0.2, 0.4);
          pen.size(0.5, 0.8);
          b.angle = -Math.PI / 2;
          b.spread = 2.2;
          pen.emit();
          fx.rings.spawn(e.x, e.y - 2, 2, 10, 0.2, col, 1, 0.7);
        } else if (e.owner === 0) {
          // Another player lifted a public drop: a soft poof where it lay.
          this.poof(e.x, e.y);
        }
        return;
      }
      case 'mote': {
        if (e.playerId !== local || this.bursts++ > 30) return;
        const b = pen.burst(e.x, e.y - 10, 3, C.echoCore, C.echo);
        b.sprite = 'fx/spark';
        pen.speed(10, 30);
        pen.life(0.15, 0.3);
        pen.size(0.4, 0.7);
        pen.emit();
        return;
      }
      case 'flask': {
        const pos = this.k.players.pos.get(e.playerId);
        if (!pos) return;
        const col = e.resource === 'life' ? LIFE_UP : FOCUS_UP;
        const b = pen.burst(pos.x, pos.y - 4, 14, C.white, col);
        pen.speed(4, 14);
        pen.life(0.5, 0.9);
        pen.size(0.6, 1);
        b.angle = -Math.PI / 2;
        b.spread = 1;
        b.gravity = -40;
        pen.emit();
        fx.rings.spawn(pos.x, pos.y, 4, 16, 0.4, col, 1, 0.8);
        return;
      }
      case 'debuff': {
        const pos = this.k.players.pos.get(e.playerId);
        const x = pos ? pos.x : e.x;
        const y = pos ? pos.y : e.y;
        const p = playerById(f.world, e.playerId);
        const d = p ? findDebuff(p.debuffs, e.debuff) : null;
        const source = d?.source ?? null;
        const painter = this.k.debuffs;
        // The sim repeats an unchanged refresh once a second (standing in a storm or a fire pool): a shimmer, no pop.
        if (painter && !painter.shouldPop(e.playerId, e.debuff, e.stacks, f.time)) {
          painter.shimmer(pen, x, y, e.debuff, source);
          return;
        }
        painter?.pop(pen, x, y, e.debuff, e.stacks, source, e.playerId === local);
        const word = DEBUFF_WORD[e.debuff];
        if (word && e.playerId === local) fx.texts.spawn(word, x, y - 38, debuffColor(e.debuff, source), 0.7, 1, 8);
        if (e.debuff === 'frozen' && e.playerId === local) {
          post.flash(FROST_FLASH, 0.08, 0.4, this.k.impactDelay('debuffFreeze'));
          this.shake(0.18);
        }
        return;
      }
      case 'cleanse': {
        this.k.debuffs?.cleansed(e.playerId, e.debuffs);
        const pos = this.k.players.pos.get(e.playerId);
        this.k.debuffs?.cleanse(pen, pos ? pos.x : e.x, pos ? pos.y : e.y, e.debuffs, e.playerId === local);
        return;
      }
      case 'blocked':
        this.blocked(e.x, e.y, f);
        return;
      case 'pull':
        this.pull(e, f);
        return;
      case 'mapEvent':
        this.mapEvent(e, f);
        return;
      case 'waveTell':
        post.flash(FLASH_TELL, 0.08, 0.6, this.k.impactDelay('waveTell'));
        return;
      case 'waveStart':
        post.flash(C.ember, 0.06, 0.4);
        this.shake(0.12);
        return;
      case 'bossSpawn': {
        const kind = this.bossKind(f);
        const acc = accentOf(kind);
        const cold = kind === 'hollowWarden';
        post.flash(cold ? FROST_FLASH : FLASH_BOSS, cold ? 0.22 : 0.3, 1.2);
        post.chromatic(0.5);
        this.shake(0.7);
        rig.holdFor(0.08);
        fx.rings.spawn(e.x, e.y, 12, 180, 1, acc, 2, 1, 2);
        fx.rings.spawn(e.x, e.y, 6, 110, 0.7, cold ? C.ice : C.hot, 1, 0.9);
        fx.pulses.spawn(e.x, e.y - 30, 260, 1.2, acc, 2);
        if (kind === 'varkus') {
          // The champion strides in: the sand bursts up, the crowd's gold rains.
          this.dustPuff(e.x, e.y, 30);
          this.fountain(e.x, e.y, 40, C.hot, C.gold, 110, 200);
        } else {
          fx.sprites.spawn('fx/sigil', this.frames.sigil, e.x, e.y, 1.2, { color: acc, scale: 4, alpha: 1 });
          if (cold) this.frostBurst(e.x, e.y - 20, 40, 60, 160);
          else this.fountain(e.x, e.y, 60, C.hot, C.lavaDark, 120, 220);
        }
        // A hand-crafted boss stage names how its boss arrives (D 10.5 `arrive`): through the gate, over the rim, out of a shimmer.
        const arrive = layoutFor(f.world.areaId)?.bossStage.arrive;
        if (arrive === 'gate') this.dustPuff(e.x, e.y, 36);
        else if (arrive === 'shimmer') this.frostBurst(e.x, e.y - 20, 28, 50, 130);
        else if (arrive === 'rim') this.fountain(e.x, e.y, 40, C.hot, C.ember, 100, 190);
        return;
      }
      case 'bossPhase': {
        const kind = this.bossKind(f);
        const cold = kind === 'hollowWarden';
        post.flash(cold ? FROST_FLASH : FLASH_PHASE, 0.28, 0.6);
        post.chromatic(0.7);
        post.slowMo(0.3, 0.14);
        this.shake(0.75);
        rig.holdFor(0.07);
        const b = this.bossPos(f);
        if (b) {
          fx.rings.spawn(b.x, b.y - 20, 10, 150, 0.7, cold ? C.ice : C.hot, 2, 1, 2);
          if (cold) this.frostBurst(b.x, b.y - 20, 50, 80, 200);
          else if (kind === 'varkus') {
            this.dustPuff(b.x, b.y, 24);
            this.fountain(b.x, b.y - 10, 40, C.hot, C.gold, 80, 200);
          } else this.fountain(b.x, b.y - 10, 50, C.hot, C.ember, 80, 200);
        }
        return;
      }
      case 'cleared':
        post.flash(FLASH_CLEAR, 0.2, 1.2);
        fx.rings.spawn(e.x, e.y, 10, 240, 1.4, C.gold, 2, 0.8, 1.5);
        return;
      case 'chestOpen':
        fx.rings.spawn(e.x, e.y - 8, 6, 60, 0.6, C.gold, 2, 1, 1.4);
        fx.pulses.spawn(e.x, e.y - 12, 140, 0.9, C.gold, 1.8);
        this.fountain(e.x, e.y - 10, 40, C.hot, C.gold, 90, 170);
        this.shake(0.2);
        return;
      case 'portal': {
        const frost = this.nearProp(f, e.x, e.y, 'returnPortal');
        const col = frost ? C.frost : C.flame;
        if (e.kind === 'open') {
          this.k.props.portalOpened(e.x, e.y, f.world.props, f.time);
          fx.rings.spawn(e.x, e.y - 24, 6, 50, 0.6, col, 2, 1, 1.4);
          const b = pen.burst(e.x, e.y - 24, 30, C.white, col);
          pen.speed(30, 90);
          pen.life(0.3, 0.7);
          b.drag = 0.85;
          pen.emit();
        } else {
          fx.rings.spawn(e.x, e.y - 20, 30, 4, 0.4, col, 2, 1, 1.2);
          const b = pen.burst(e.x, e.y - 20, 24, C.white, col);
          pen.speed(10, 50);
          pen.life(0.3, 0.6);
          b.gravity = -60;
          pen.emit();
          if (e.playerId === local) post.flash(col, 0.18, 0.5, this.k.impactDelay('portalEnter'));
        }
        return;
      }
      case 'playerDeath': {
        const b = pen.burst(e.x, e.y - 10, 30, C.lifeLight, C.blood);
        pen.speed(20, 70);
        pen.life(0.4, 0.9);
        b.drag = 0.8;
        pen.emit();
        fx.rings.spawn(e.x, e.y, 6, 40, 0.6, C.lifeLight, 1, 0.8, 0.8);
        if (e.playerId === local) {
          post.flash(FLASH_HURT, 0.35, 1);
          post.chromatic(0.8);
          this.shake(0.55);
        }
        return;
      }
      case 'playerJoin':
        // Arrival: the ember sigil burns under her feet as she steps out of the portal light.
        fx.sprites.spawn('fx/sigil', this.frames.sigil, e.x, e.y, 0.9, { color: f.look.sigil, scale: 1.2, alpha: 0.55, world: false });
        fx.rings.spawn(e.x, e.y, 4, 30, 0.5, f.look.sigil, 1, 0.7, 0.5);
        fx.pulses.spawn(e.x, e.y - 10, 80, 0.7, f.look.sigil, 0.55);
        return;
      case 'notEnoughFocus': {
        if (e.playerId !== local) return;
        const pos = this.k.players.pos.get(e.playerId);
        if (pos) fx.texts.spawn('No Focus', pos.x, pos.y - 34, FOCUS_TEXT, 0.8, 1, 8);
        return;
      }
    }
  }

  /**
   * One map-event beat (Event Director v2): a ring and a light pulse in the event's colour, and per beat its own moment: a
   * whiff slows time for 80 ms with a dust puff and a hollow "Whiff", a hit shakes, the payoff lands with a 60 ms hit-stop and a
   * grade trophy (gold flashes and fountains). Nothing here covers a telegraph or a drop (rings and pulses sit under the numbers).
   */
  private mapEvent(e: Extract<SimEvent, { t: 'mapEvent' }>, f: FrameCtx): void {
    const { fx, post } = this.k;
    this.k.mapEvents?.beat(e);
    const col = eventColor(e.kind);
    switch (e.beat) {
      case 'omen':
        fx.pulses.spawn(e.x, e.y, 90, 1.2, col, 0.6);
        fx.rings.spawn(e.x, e.y, 6, 60, 1.0, col, 1, 0.6, 0.6);
        return;
      case 'onset':
        fx.rings.spawn(e.x, e.y, 10, 120, 0.9, col, 2, 0.8, 1);
        fx.pulses.spawn(e.x, e.y, 140, 0.8, col, 0.8);
        post.flash(col, 0.08, 0.35);
        this.shake(0.1);
        return;
      case 'step':
      case 'pulse':
        fx.rings.spawn(e.x, e.y, 4, 34, 0.35, col, 1, 0.7, 0.3);
        // Rival Crowns: the survivor's crown flares (the spoils).
        if (e.kind === 'secondCrown' && e.n === 1) {
          fx.rings.spawn(e.x, e.y - 30, 8, 90, 0.8, C.gold, 2, 0.9, 1.2);
          fx.pulses.spawn(e.x, e.y - 30, 140, 0.8, C.gold, 0.8);
          fx.texts.spawn('Empowered', e.x, e.y - 70, C.gold, 1.4, 1, 12);
          this.shake(0.15);
        }
        return;
      case 'arrive':
        fx.rings.spawn(e.x, e.y, 8, 90, 0.8, col, 2, 0.8, 0.8);
        this.shake(0.12);
        return;
      case 'whiff':
        // A hollow thud: a beat of slow motion, dust and the word.
        post.slowMo(0.3, 0.08);
        this.dustPuff(e.x, e.y, 10);
        fx.rings.spawn(e.x, e.y, 3, 40, 0.4, col, 1, 0.7);
        fx.texts.spawn(`Whiff ${e.n}`, e.x, e.y - 30, col, 0.9, 1, 10);
        this.shake(0.2);
        return;
      case 'hit':
        if (e.kind === 'orchard') { fx.rings.spawn(e.x, e.y, 3, 26, 0.3, col, 1, 0.6); return; } // a bite, not a blow
        this.shake(0.3);
        fx.rings.spawn(e.x, e.y, 4, 50, 0.4, C.lifeLight, 2, 0.7);
        return;
      case 'return':
        fx.rings.spawn(e.x, e.y, 20, 60, 0.6, col, 1, 0.8, 0.8);
        fx.pulses.spawn(e.x, e.y, 110, 0.5, col, 0.6);
        return;
      case 'lit':
        this.fountain(e.x, e.y - 8, 24, C.hot, C.flame, 60, 130);
        fx.rings.spawn(e.x, e.y, 6, 80, 0.6, C.flame, 2, 0.9, 1);
        fx.texts.spawn(`Brazier ${e.n} lit`, e.x, e.y - 30, C.flame, 1.2, 1, 12);
        return;
      case 'lost':
        fx.texts.spawn(e.kind === 'orchard' ? 'Bloom lost' : 'Ember lost', e.x, e.y - 30, col, 1.1, 1, 10);
        this.dustPuff(e.x, e.y, 8);
        return;
      case 'lock':
        // The Stalker's disc locked: the leap is coming (0.4 s), a tight red ring closing on the spot.
        if (e.kind === 'hunted' || e.kind === 'ring') {
          fx.rings.spawn(e.x, e.y, 36, 8, 0.4, col, 2, 0.9);
          return;
        }
        fx.rings.spawn(e.x, e.y - 8, 6, 60, 0.6, C.gold, 2, 1, 1.4);
        this.fountain(e.x, e.y - 10, 26, C.hot, C.gold, 90, 170);
        fx.texts.spawn(['Coffer', 'Reliquary', "Cartographer's Tube"][e.n] ?? 'Lock', e.x, e.y - 34, C.gold, 1.2, 1, 12);
        this.shake(0.15);
        return;
      case 'seal':
        fx.rings.spawn(e.x, e.y, 10, 160, 1.0, col, 3, 0.9, 1.4);
        fx.pulses.spawn(e.x, e.y, 200, 0.9, col, 0.9);
        return;
      case 'erupt':
        fx.pulses.spawn(e.x, e.y, 180, 1.5, col, 0.5);
        this.shake(0.15);
        return;
      case 'complete': {
        // Payoff: the flash and the hit-stop land on the grade chord's transient (impact alignment).
        const grade = e.n;
        const sfx = grade >= 3 ? 'eventGold' : grade === 2 ? 'eventSilver' : 'eventBronze';
        const delay = this.k.impactDelay(sfx);
        const tone = grade >= 3 ? C.gold : grade === 2 ? C.ice : C.ochre;
        post.after(delay, () => {
          post.slowMo(0.05, 0.06);
          post.flash(tone, grade >= 3 ? 0.22 : 0.12, 0.7);
          fx.rings.spawn(e.x, e.y, 8, grade >= 3 ? 170 : 110, 1.0, tone, 2, 0.9, 1.4);
          fx.pulses.spawn(e.x, e.y - 10, grade >= 3 ? 220 : 150, 0.9, tone, 1.2);
          this.fountain(e.x, e.y - 10, grade >= 3 ? 44 : 28, C.hot, tone, 90, 190);
        });
        fx.texts.spawn(['', 'Bronze Trophy', 'Silver Trophy', 'Gold Trophy'][grade] ?? '', e.x, e.y - 44, tone, 2.2, 1.4, 14, true);
        this.shake(0.2);
        return;
      }
      case 'failed':
        fx.rings.spawn(e.x, e.y, 30, 6, 0.8, col, 1, 0.5);
        fx.texts.spawn('Lost', e.x, e.y - 30, col, 1.2, 1, 8);
        return;
      // Wave 2 of events: choices and objectives. Rings and pulses sit under the numbers; nothing covers a telegraph.
      case 'pick':
        fx.rings.spawn(e.x, e.y, 6, 70, 0.7, col, 2, 0.9, 1);
        fx.pulses.spawn(e.x, e.y - 6, 120, 0.7, col, 0.7);
        this.shake(0.08);
        return;
      case 'harvest':
        this.fountain(e.x, e.y - 8, 22, C.hot, col, 60, 130);
        fx.rings.spawn(e.x, e.y, 6, 60, 0.6, col, 2, 0.9, 1);
        return;
      case 'shatter':
        post.flash(col, 0.1, 0.4);
        fx.rings.spawn(e.x, e.y, 10, 170, 0.9, col, 3, 0.9, 1.4);
        fx.pulses.spawn(e.x, e.y - 10, 200, 0.8, col, 1);
        this.fountain(e.x, e.y - 8, 34, C.hot, col, 80, 170);
        this.shake(0.3);
        return;
      case 'thaw':
        fx.rings.spawn(e.x, e.y, 4, 40, 0.5, col, 1, 0.7, 0.5);
        this.dustPuff(e.x, e.y, 5);
        return;
      case 'toll':
        fx.pulses.spawn(e.x, e.y - 20, 160, 0.9, col, 0.8);
        fx.rings.spawn(e.x, e.y, 12, 90, 0.8, col, 2, 0.8, 0.8);
        this.shake(0.22);
        return;
      case 'forge':
        this.fountain(e.x, e.y - 10, 30, C.hot, C.flame, 80, 170);
        fx.rings.spawn(e.x, e.y, 8, 80, 0.7, C.flame, 2, 0.9, 1.2);
        fx.pulses.spawn(e.x, e.y - 8, 140, 0.7, C.flame, 0.9);
        this.shake(0.12);
        return;
      case 'tide':
        fx.pulses.spawn(e.x, e.y, 220, 1.2, col, 0.5);
        this.shake(0.15);
        return;
      case 'crack':
        if (e.kind === 'vaultbreakers') {
          // n 0: a wheel breaks (splinters); n 1: a lock's shield line drops.
          if (e.n === 0) {
            this.dustPuff(e.x, e.y, 10);
            fx.texts.spawn('Wheel broken', e.x, e.y - 26, col, 1.1, 1, 10);
            this.shake(0.2);
          } else {
            fx.rings.spawn(e.x, e.y - 6, 10, 50, 0.6, C.ice, 2, 0.9, 1);
            fx.texts.spawn('Shield down', e.x, e.y - 30, C.ice, 1.1, 1, 10);
          }
          return;
        }
        if (e.kind === 'bellwatch') fx.texts.spawn(`Cantor falls ${e.n}/4`, e.x, e.y - 30, col, 1.3, 1, 11);
        fx.rings.spawn(e.x, e.y, 6, 50, 0.5, col, 1, 0.7);
        this.dustPuff(e.x, e.y, 8);
        this.shake(0.12);
        return;
    }
    void f;
  }

  /** Level-up celebration for player `id` at (x, y). */
  levelUp(x: number, y: number, local: boolean, level: number): void {
    const { fx, post } = this.k;
    // The halo sprite rises through her; a gold ring, a warm light swell and a small fountain of sparks — bright
    // enough to celebrate, never so bright that she vanishes mid-fight (levels are gained in combat).
    fx.sprites.spawn('fx/levelUp', this.frames.levelUp, x, y - 18, 0.9, { alpha: local ? 0.6 : 0.45 });
    fx.rings.spawn(x, y - 2, 6, 44, 0.6, C.gold, 1, 0.8, local ? 0.6 : 0.35);
    fx.pulses.spawn(x, y - 12, 100, 1, C.gold, local ? 0.5 : 0.3);
    this.fountain(x, y - 4, local ? 18 : 10, C.hot, C.gold, 60, 120, false);
    if (local) {
      fx.texts.spawn(`Level ${level}`, x, y - 46, C.rare, 1.8, 2, 12, true);
      post.flash(FLASH_LEVEL, 0.1, 0.45, this.k.impactDelay('levelUp'));
    } else fx.texts.spawn('Level up', x, y - 46, C.rare, 1.4, 1, 10, true);
  }

  // --------------------------------------------------------------------------------------------------------

  private hit(e: Extract<SimEvent, { t: 'hit' }>, f: FrameCtx): void {
    const { pen, fx } = this.k;
    const local = f.localId;
    const dti = DT_INDEX[e.damageType] ?? 0;
    const amount = Math.max(1, Math.round(e.amount));
    if (e.target === 'player') {
      fx.numbers.spawn(e.x, e.y - 26, amount, NUM_STYLE_PLAYER_HURT, e.crit, e.playerId === local);
      const ic = IMPACT_COLOR[e.damageType];
      sparks(pen, e.x, e.y - 12, 8, ic[0], ic[1], 20, 70, 0.3);
      if (e.playerId === local) {
        // Shake, kick, flash and chromatic are gathered and applied once per frame (endFrame).
        const p = f.local;
        this.hurtFrac += p && p.maxLife > 0 ? clamp01(e.amount / p.maxLife) : 0.1;
      }
      return;
    }
    const own = e.playerId === local;
    const dummy = e.kind === 'trainingDummy';
    // Numbers: always for your own hits, crits and the dummy; allies' plain hits are dimmer and capped.
    fx.numbers.spawn(e.x, e.y - (e.kind && BIG.has(e.kind) ? 40 : 20), amount, dti, e.crit, own || dummy);
    const ic = IMPACT_COLOR[e.damageType];
    const c0 = ic[0];
    const c1 = ic[1];
    const important = e.crit || e.killed;
    // Focus fire: after two flashes on one spot within 0.1 s, further impacts there only get half the sparks
    // (no light pulse, no impact star), so the target stays visible under the whole party's fire.
    const crowded = this.heat.touch(e.x, e.y - 8, f.time) >= 2;
    const k = own ? 1 : ALLY_FX;
    if (important || this.bursts < 24) {
      this.bursts++;
      const b = pen.burst(e.x, e.y - 8, (e.crit ? 12 : 4) >> (crowded ? 1 : 0), c0, c1);
      b.sprite = e.damageType === 'cold' ? 'fx/frost' : 'fx/spark';
      pen.speed(25, e.crit ? 130 : 80);
      pen.life(0.12, 0.32);
      pen.size(e.damageType === 'cold' ? 0.5 : 0.6, e.damageType === 'cold' ? 0.8 : 1);
      b.drag = 0.9;
      pen.emit();
    }
    if (important && !crowded && this.pulses < 8) {
      this.pulses++;
      fx.pulses.spawn(e.x, e.y - 8, e.crit ? 52 : 34, 0.14, c1, (e.crit ? 0.6 : 0.35) * k);
    }
    if (e.crit && own) {
      if (!crowded) fx.sprites.spawn('fx/impact', this.frames.impact, e.x, e.y - 8, 0.2, { alpha: 0.8, rotation: Math.random() * TAU });
      this.critThisFrame = true;
    }
  }

  /**
   * A burn / bleed tick on a player: a small number in the debuff's colour that accumulates into a running total —
   * no sparks and no hurt beat (the overlay and the life bar already say she is burning or bleeding).
   */
  private dotTick(e: Extract<SimEvent, { t: 'hit' }>, f: FrameCtx): void {
    const style = e.damageType === 'fire' ? NUM_STYLE_PLAYER_BURN : NUM_STYLE_PLAYER_BLEED;
    this.k.fx.numbers.spawn(e.x + 10, e.y - 22, Math.max(1, Math.round(e.amount)), style, false, e.playerId === f.localId);
  }

  private death(e: Extract<SimEvent, { t: 'death' }>, f: FrameCtx): void {
    const { pen, fx, rig, post } = this.k;
    const ki = KIND_INDEX[e.kind] ?? 0;
    const boss = e.rarity === RARITY_CODE.boss;
    const lt = e.rarity === RARITY_CODE.lieutenant;
    const big = BIG.has(e.kind) || boss || lt;
    const life = boss ? CORPSE_LIFE_BOSS : big ? CORPSE_LIFE_BIG : CORPSE_LIFE;
    const family = MONSTER_LOOKS[e.kind]?.corpse ?? 'ash';
    // A wisp that burst leaves nothing but its burst (monster/glacialWisp/burst plays where it stood).
    const burst = e.kind === 'glacialWisp' && this.burstNear(e.x, e.y, f.time);
    if (!burst) fx.corpses.spawn(ki, e.x, e.y, e.facing < 0, DT_INDEX[e.damageType] ?? 0, life * (0.85 + Math.random() * 0.3));
    const ic = IMPACT_COLOR[e.damageType];
    const c0 = ic[0];
    const c1 = ic[1];
    if (burst) return;
    if (family !== 'ash' && (this.bursts < 40 || big || e.rarity >= RARITY_CODE.rare)) {
      this.bursts++;
      this.debris(e.kind, family, e.x, e.y, big, c0, c1);
    } else if (this.bursts++ < 40 || big || e.rarity >= RARITY_CODE.rare) {
      // Ash burst: the body comes apart into cinders.
      const b = pen.burst(e.x, e.y - 6, big ? 26 : 8, C.ash, C.smokeEnd);
      b.sprite = 'fx/ash';
      pen.speed(10, big ? 70 : 40);
      pen.life(0.4, 0.9);
      pen.size(1, 1.6);
      b.additive = false;
      b.emissive = 0;
      b.drag = 0.8;
      b.gravity = -8;
      b.layer = 'world';
      pen.emit();
      const s = pen.burst(e.x, e.y - 8, big ? 18 : 6, c0, c1);
      pen.speed(20, big ? 110 : 60);
      pen.life(0.15, 0.4);
      pen.size(0.6, 1.1);
      s.drag = 0.9;
      pen.emit();
    }
    if (e.rarity === RARITY_CODE.rare) {
      this.fountain(e.x, e.y - 6, 22, C.hot, C.gold, 60, 140, false);
      fx.rings.spawn(e.x, e.y - 6, 4, 34, 0.4, C.gold, 1, 0.9, 1.2);
    }
    const acc = boss || lt ? accentOf(e.kind) : C.flame;
    if (big) {
      if (family === 'ash') fx.decals.spawn(e.x, e.y, boss ? 2.4 : 1.2, boss ? 25 : 10, 1);
      else if (family === 'rime') fx.decals.spawn(e.x, e.y, boss ? 3 : 1.6, boss ? 25 : 10, 0, 'rime');
      else fx.decals.spawn(e.x, e.y, boss ? 1.6 : 0.9, boss ? 25 : 10, 0, 'blood');
      fx.pulses.spawn(e.x, e.y - 12, boss ? 260 : 110, boss ? 1.2 : 0.5, acc, boss ? 2 : 1.2);
      this.shake(boss ? 0.9 : lt ? 0.6 : 0.2);
    }
    if (boss || lt) {
      const cold = family === 'rime';
      fx.rings.spawn(e.x, e.y - 20, 10, boss ? 220 : 130, boss ? 1 : 0.7, cold ? C.ice : C.hot, 2, 1, 2);
      if (cold) this.frostBurst(e.x, e.y - 20, boss ? 70 : 40, 100, 240);
      else this.fountain(e.x, e.y - 20, boss ? 90 : 50, C.hot, family === 'dust' ? C.gold : C.ember, 100, 240);
      post.flash(cold ? (boss ? C.ice : FROST_FLASH) : boss ? C.hot : C.flame, boss ? 0.35 : 0.2, boss ? 1.2 : 0.6);
      post.chromatic(boss ? 0.8 : 0.4);
      post.slowMo(0.25, boss ? 0.3 : 0.15);
      rig.holdFor(boss ? 0.12 : 0.06);
    }
  }

  private areaResolve(e: Extract<SimEvent, { t: 'areaResolve' }>, f: FrameCtx): void {
    const { pen, fx, post } = this.k;
    const dist = f.local ? Math.hypot(f.local.x - e.x, f.local.y - e.y) : 999;
    const near = clamp01(1 - dist / 420);
    switch (e.kind) {
      case 'slamWarning': {
        const boss = e.radius >= 56;
        if (e.radius < CHARGE_MAX_RADIUS) {
          // A Matriarch charge segment she just trampled: a dust wake and a scuffed floor, not a full slam.
          fx.rings.spawn(e.x, e.y, e.radius * 0.5, e.radius * 1.1, 0.3, C.dangerHot, 1, 0.55, 0.3);
          this.dustPuff(e.x, e.y, 8);
          fx.decals.spawn(e.x, e.y, 0.9, 6, 0.4);
          this.shake(0.14 * near);
          return;
        }
        fx.rings.spawn(e.x, e.y, e.radius * 0.4, e.radius * 1.25, 0.35, C.dangerHot, boss ? 2 : 1, 0.9, 0.8);
        this.dustPuff(e.x, e.y, boss ? 26 : 12);
        const b = pen.burst(e.x, e.y, boss ? 20 : 10, DEBRIS, DUST_END);
        b.sprite = 'fx/ash';
        pen.speed(20, 60 + e.radius);
        pen.upward(60, 140);
        b.z = 2;
        b.gravity = 320;
        pen.life(0.6, 1.1);
        pen.size(1, 1.6);
        b.sizeEnd = 1;
        b.additive = false;
        b.emissive = 0;
        b.layer = 'world';
        pen.emit();
        fx.pulses.spawn(e.x, e.y, e.radius * 2.2, 0.3, C.flame, 0.7);
        if (boss) {
          fx.decals.spawn(e.x, e.y, e.radius / 14, 12, 0.9);
          post.chromatic(0.5 * near);
        }
        this.shake((boss ? 0.6 : 0.25) * near);
        return;
      }
      case 'leapWarning':
        fx.rings.spawn(e.x, e.y, 4, e.radius * 1.2, 0.3, C.dangerHot, 1, 0.9, 0.8);
        this.dustPuff(e.x, e.y, 10);
        this.shake(0.15 * near);
        return;
      case 'eruptionWarning':
      case 'meteorWarning': {
        const meteor = e.kind === 'meteorWarning';
        // A meteor shower resolves many at once: the first few get the full treatment, the rest a light one,
        // so the rain stays readable instead of fusing into one white blast. Rocks landing on a spot that just
        // blew (bunched against the rim, around the player) are lighter too, however they are spread over frames.
        const crowd = this.blastHeat.touch(e.x, e.y, f.time);
        const full = crowd < 2 && this.big++ < 3;
        const k = full ? (crowd === 0 ? 1 : 0.6) : 0.35;
        if (full) fx.rings.spawn(e.x, e.y, 4, e.radius * 1.3, 0.4, C.flame, 1, 0.9 * k, 0.7 * k);
        this.fountain(e.x, e.y, Math.round((meteor ? 16 : 14) * k), C.hot, C.lavaDark, 80, meteor ? 200 : 260);
        const b = pen.burst(e.x, e.y - 6, Math.round(12 * k), C.hot, C.ember);
        pen.speed(30, 100);
        pen.life(0.2, 0.5);
        pen.size(1, 1.7);
        b.drag = 0.85;
        pen.emit();
        const sm = pen.burst(e.x, e.y - 4, Math.round(8 * k), C.smoke, C.smokeEnd);
        sm.sprite = 'fx/smoke';
        pen.speed(10, 30);
        pen.life(0.8, 1.4);
        pen.size(0.8, 1.2);
        sm.sizeEnd = 2.2;
        sm.gravity = -20;
        sm.additive = false;
        sm.emissive = 0;
        sm.layer = 'world';
        pen.emit();
        if (full) fx.pulses.spawn(e.x, e.y - 10, e.radius * 2.5 + 40, 0.45, C.flame, 0.9 * k);
        fx.decals.spawn(e.x, e.y, e.radius / 13, 14, 1);
        if (full) this.shake((meteor ? 0.45 : 0.3) * near);
        return;
      }
      case 'stormStrike':
        // A bolt lands: a pale ring and a spray of sparks.
        fx.rings.spawn(e.x, e.y, e.radius * 0.3, e.radius * 1.3, 0.3, C.storm, 1, 0.8, 0.5);
        sparks(pen, e.x, e.y - 8, 10, C.lightning, C.storm, 40, 140, 0.25);
        fx.pulses.spawn(e.x, e.y - 8, e.radius * 2.2, 0.25, C.lightning, 0.6);
        this.shake(0.12 * near);
        return;
      case 'rendStrike': {
        // Raking claws: a red flash and blood flung out of the mark.
        fx.rings.spawn(e.x, e.y, e.radius * 0.3, e.radius * 1.15, 0.3, C.blood, 1, 0.7, 0.4);
        pen.burst(e.x, e.y - 4, 10, C.lifeLight, C.blood);
        pen.speed(30, 110);
        pen.life(0.25, 0.5);
        pen.size(0.8, 1.4);
        pen.emit();
        this.shake(0.12 * near);
        return;
      }
      case 'frostNovaWarning': {
        // The nova bursts out: a cold shock ring and ice flung along the floor. Held back on light and glow — a
        // white-out would hide the Warden and whoever the nova caught.
        const boss = e.radius >= 70;
        fx.rings.spawn(e.x, e.y, e.radius * 0.3, e.radius * 1.12, 0.4, C.ice, boss ? 2 : 1, 0.75, boss ? 0.7 : 0.4);
        fx.rings.spawn(e.x, e.y, e.radius * 0.2, e.radius * 0.8, 0.3, FROST_FLASH, 1, 0.45);
        this.frostBurst(e.x, e.y - 4, boss ? 20 : 10, 40 + e.radius, 60 + e.radius * 1.5, false);
        fx.decals.spawn(e.x, e.y, e.radius / 20, boss ? 8 : 5, 0, 'rime');
        fx.pulses.spawn(e.x, e.y - 8, e.radius * 1.8, 0.35, FROST_FLASH, boss ? 0.55 : 0.35);
        if (boss) post.chromatic(0.3 * near);
        this.shake((boss ? 0.45 : 0.22) * near);
        return;
      }
      case 'glacialSpike': {
        // The spike erupts from its crack (frames 1–7: rise, stand, fracture, shatter, stumps).
        fx.sprites.spawn('fx/iceSpike', this.frames.iceSpike, e.x, e.y, this.lifeOf.iceSpike + 0.25, {
          world: true, from: 1, flip: spikeFlip(e.x, e.y), emissive: 0.55,
        });
        const b = pen.burst(e.x, e.y - 6, 6, C.ice, C.mana);
        b.sprite = 'fx/frost';
        pen.speed(20, 60);
        pen.upward(20, 60);
        b.z = 4;
        b.gravity = 240;
        pen.life(0.35, 0.6);
        pen.size(0.45, 0.8);
        pen.emit();
        if (this.pulses++ < 8) fx.pulses.spawn(e.x, e.y - 10, 50, 0.3, FROST_FLASH, 0.6);
        this.shake(0.08 * near);
        return;
      }
      case 'icePrison': {
        // The prison snaps shut (or breaks): the shards burst off the ring.
        fx.rings.spawn(e.x, e.y, Math.max(4, e.radius), 4, 0.25, C.ice, 2, 0.9, 0.8);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * TAU;
          const b = pen.burst(e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius - 6, 3, C.ice, C.mana);
          b.sprite = 'fx/frost';
          pen.speed(20, 60);
          pen.upward(20, 60);
          b.z = 6;
          b.gravity = 260;
          pen.life(0.35, 0.6);
          pen.size(0.5, 0.9);
          pen.emit();
        }
        fx.decals.spawn(e.x, e.y, Math.max(1, e.radius / 14), 5, 0, 'rime');
        fx.pulses.spawn(e.x, e.y - 10, 90, 0.35, FROST_FLASH, 0.8);
        this.shake(0.12 * near);
        return;
      }
      case 'wispBurst': {
        fx.rings.spawn(e.x, e.y, 4, e.radius * 1.1, 0.3, C.ice, 1, 0.95, 0.6);
        fx.rings.spawn(e.x, e.y - 2, 2, e.radius * 0.45, 0.22, C.white, 2, 0.9);
        this.frostBurst(e.x, e.y - 6, 14, 50, 110, false);
        fx.decals.spawn(e.x, e.y, e.radius / 18, 4, 0, 'rime');
        if (this.pulses++ < 8) fx.pulses.spawn(e.x, e.y - 8, e.radius * 2.4, 0.3, FROST_FLASH, 0.8);
        this.shake(0.1 * near);
        return;
      }
      case 'arenaSpikes': {
        // The spikes shoot up out of the grate (frames 2–7), sand and sparks fly.
        fx.sprites.spawn('fx/arenaSpike', this.frames.arenaSpike, e.x, e.y, this.lifeOf.arenaSpike, { world: true, from: 2, emissive: 0.3 });
        if (this.dust++ < 10) this.sandPuff(e.x, e.y, 5);
        sparks(pen, e.x, e.y - 8, 4, C.hot, C.ember, 20, 60, 0.2);
        this.shake(0.06 * near);
        return;
      }
      case 'executionMark': {
        // The champion lands on the mark: a crater of sand, a red ring, the floor cracked.
        fx.rings.spawn(e.x, e.y, e.radius * 0.3, e.radius * 1.5, 0.4, MARK_RED, 2, 1, 1.4);
        fx.rings.spawn(e.x, e.y, 4, e.radius * 0.9, 0.25, C.hot, 1, 0.8);
        this.sandPuff(e.x, e.y, 26);
        const b = pen.burst(e.x, e.y, 16, SAND, SAND_END);
        b.sprite = 'fx/ash';
        pen.speed(30, 90);
        pen.upward(80, 160);
        b.z = 2;
        b.gravity = 320;
        pen.life(0.6, 1.1);
        pen.size(1, 1.6);
        b.sizeEnd = 1;
        b.additive = false;
        b.emissive = 0;
        b.layer = 'world';
        pen.emit();
        fx.decals.spawn(e.x, e.y, e.radius / 12, 12, 0.2);
        fx.pulses.spawn(e.x, e.y - 10, e.radius * 3, 0.45, MARK_RED, 1.2);
        post.chromatic(0.4 * near);
        this.shake(0.55 * near);
        return;
      }
      default:
        return;
    }
  }

  /** A 'monsterAttack' beat of its own (the painter already switched the body to any special action set). */
  private attack(e: Extract<SimEvent, { t: 'monsterAttack' }>, f: FrameCtx): void {
    const { pen, fx, post } = this.k;
    const acc = accentOf(e.kind);
    switch (e.attack) {
      case 'summon':
        fx.sprites.spawn('fx/sigil', this.frames.sigil, e.x, e.y, 0.8, { color: acc, scale: 2.2, alpha: 0.9 });
        fx.rings.spawn(e.x, e.y, 10, 90, 0.6, acc, 2, 0.8, 1);
        return;
      case 'leap':
      case 'charge':
      case 'whirl':
        this.dustPuff(e.x, e.y, 8);
        return;
      case 'melee': {
        if (this.bursts++ >= 20) return;
        const col = e.kind === 'pitHound' ? BLOOD : e.kind === 'rimeshade' ? C.ice : C.bone;
        fx.sprites.spawn('fx/slash', this.frames.slash, e.x, e.y - 8, 0.2, { alpha: 0.7, scale: 0.7, rotation: Math.random() * TAU, color: col });
        return;
      }
      case 'bash':
        fx.sprites.spawn('fx/slash', this.frames.slash, e.x, e.y - 10, 0.22, { alpha: 0.85, scale: 1.1, rotation: Math.random() * TAU, color: C.bone });
        this.sandPuff(e.x, e.y, 8);
        sparks(pen, e.x, e.y - 12, 6, C.hot, C.ember, 30, 80, 0.2);
        this.shake(0.1);
        return;
      case 'web': {
        const b = pen.burst(e.x, e.y - 8, 5, C.white, C.frost);
        b.sprite = 'fx/frost';
        pen.speed(10, 30);
        pen.life(0.2, 0.4);
        pen.size(0.4, 0.6);
        pen.emit();
        return;
      }
      case 'hook':
        sparks(pen, e.x, e.y - 10, 4, C.hot, C.ember, 20, 50, 0.18);
        return;
      case 'aim':
        if (this.pulses++ < 8) fx.pulses.spawn(e.x, e.y - 10, 30, 0.3, MARK_RED, 0.5);
        return;
      case 'bolt':
        sparks(pen, e.x, e.y - 10, 5, [1, 0.9, 0.7], C.ember, 30, 90, 0.15);
        if (this.dust++ < 10) this.dustPuff(e.x, e.y, 2);
        return;
      case 'tar': {
        const b = pen.burst(e.x, e.y - 12, 4, TAR, TAR_END);
        b.sprite = 'fx/spark';
        pen.speed(10, 30);
        pen.life(0.2, 0.4);
        pen.size(0.5, 0.8);
        b.gravity = 200;
        b.additive = false;
        b.emissive = 0;
        pen.emit();
        return;
      }
      case 'sing':
      case 'pulse':
        // The choir's toll / the wisp's pulse: a cold ring breathing out of the body.
        fx.rings.spawn(e.x, e.y - (e.attack === 'sing' ? 20 : 8), 4, e.attack === 'sing' ? 34 : 16, 0.4, FROST_FLASH, 1, 0.7, 0.4);
        return;
      case 'burst':
        this.wispBurst(e.x, e.y, f.time);
        return;
      case 'nova':
        post.flash(FROST_FLASH, 0.08, 0.35);
        return;
      case 'prison':
      case 'spikes':
      case 'blizzard':
        if (e.kind === 'varkus') {
          // Crowd's Favour: the crowd's gold showers over the arena.
          this.fountain(e.x, e.y - 30, 24, C.hot, C.gold, 80, 150, false);
          return;
        }
        // The Warden's cast: frost runes flare where it lands.
        fx.sprites.spawn('fx/sigil', this.frames.sigil, e.x, e.y, 0.7, { color: FROST_FLASH, scale: 1.6, alpha: 0.8 });
        if (e.attack === 'blizzard') {
          this.frostBurst(e.x, e.y - 30, 24, 40, 100, false);
          post.flash(FROST_FLASH, 0.1, 0.6);
        }
        return;
      case 'mark':
        // Varkus raises the blade at his chosen victim (the mark itself flashes as it appears: areaAppear).
        fx.sprites.spawn('fx/sigil', this.frames.sigil, e.x, e.y, 0.6, { color: MARK_RED, scale: 1.4, alpha: 0.8 });
        return;
      default:
        return;
    }
  }

  /**
   * A telegraph area appeared (areas.ts reports the first sight of each): the execution mark brands its player with a
   * red flash landing on the stroke of its sound (sfxImpactDelay('executionMark')); the ice prison's shards burst up.
   */
  areaAppear(kind: string, x: number, y: number, radius: number, id = -1, f: FrameCtx | null = null): void {
    const { fx, post, pen } = this.k;
    if (kind === 'executionMark') {
      post.after(this.k.impactDelay('executionMark'), () => {
        // The mark follows its player: brand where it is when the flash lands, not where it appeared.
        let mx = x;
        let my = y;
        const areas = f ? f.world.areas : null;
        if (areas) {
          for (let k = 0; k < areas.length; k++) {
            if (areas[k].id === id && areas[k].kind === 'executionMark') {
              mx = areas[k].x;
              my = areas[k].y;
              break;
            }
          }
        }
        fx.rings.spawn(mx, my, radius * 1.6, radius, 0.3, MARK_RED, 2, 0.95, 0.9);
        fx.pulses.spawn(mx, my - 8, radius * 2.4, 0.35, MARK_RED, 0.7);
      });
    } else if (kind === 'icePrison') {
      const b = pen.burst(x, y - 4, 14, C.ice, C.mana);
      b.sprite = 'fx/frost';
      pen.speed(radius * 0.8, radius * 1.6);
      pen.life(0.25, 0.45);
      pen.size(0.4, 0.7);
      b.drag = 0.9;
      pen.emit();
    }
  }

  /** A Glacial Wisp shatters at (x, y): its burst sprite plays where it stood (it dies in the same tick). */
  private wispBurst(x: number, y: number, time: number): void {
    const o = this.burstNext;
    this.burstNext = (this.burstNext + 1) % 8;
    this.bursts3[o * 3] = x;
    this.bursts3[o * 3 + 1] = y;
    this.bursts3[o * 3 + 2] = time;
    this.k.fx.sprites.spawn('monster/glacialWisp/burst', this.frames.wispBurst, x, y, this.lifeOf.wispBurst, { world: true, emissive: 0.6 });
  }

  private burstNear(x: number, y: number, time: number): boolean {
    for (let k = 0; k < 8; k++) {
      const t = this.bursts3[k * 3 + 2];
      if (time - t > BURST_MATCH_TIME || time < t) continue;
      if (Math.abs(this.bursts3[k * 3] - x) < BURST_MATCH_DIST && Math.abs(this.bursts3[k * 3 + 1] - y) < BURST_MATCH_DIST) return true;
    }
    return false;
  }

  /** A shield stopped a projectile at (x, y): the bearer's frontal arc flashes, a spark jumps off it. */
  private blocked(x: number, y: number, f: FrameCtx): void {
    const { pen, fx } = this.k;
    const m = f.world.monsters;
    const i = this.k.monsters ? this.k.monsters.onBlocked(f, x, y) : MonsterPainter.nearest(m, KIND_INDEX.shieldbearer, x, y, 60);
    if (i >= 0) {
      const bx = m.x[i];
      const by = m.y[i];
      fx.sprites.spawn('fx/shieldArc', this.frames.shieldArc, bx, by - 13, this.lifeOf.shieldArc, {
        rotation: Math.atan2(y - by, x - bx), color: SHIELD_ARC, alpha: 0.9,
      });
    }
    sparks(pen, x, y - 10, 7, C.hot, C.gold, 30, 90, 0.2);
    if (this.pulses++ < 8) fx.pulses.spawn(x, y - 10, 36, 0.15, C.gold, 0.5);
  }

  /** A chain hook drags a player: the chain snaps taut from its thrower to her. */
  private pull(e: Extract<SimEvent, { t: 'pull' }>, f: FrameCtx): void {
    const tethers = this.k.tethers;
    const m = f.world.monsters;
    let dx = e.toX - e.fromX;
    let dy = e.toY - e.fromY;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // The thrower stands on along the drag, beyond where she ends up: the hook thrower nearest that ray.
    let best = -1;
    let bestD = 40;
    for (let i = 0; i < m.capacity; i++) {
      if (!m.alive[i] || (m.kind[i] !== HOOKERS[0] && m.kind[i] !== HOOKERS[1])) continue;
      const rx = m.x[i] - e.fromX;
      const ry = m.y[i] - e.fromY;
      const along = rx * dx + ry * dy;
      if (along < len * 0.5 || along > 520) continue;
      const off = Math.abs(rx * dy - ry * dx);
      if (off < bestD) {
        bestD = off;
        best = i;
      }
    }
    const ax = best >= 0 ? m.x[best] : e.toX + dx * 40;
    const ay = best >= 0 ? m.y[best] : e.toY + dy * 40;
    tethers?.spawn(e.playerId, ax, ay, e.fromX, e.fromY);
    sparks(this.k.pen, e.fromX, e.fromY - 10, 6, C.hot, C.ember, 20, 60, 0.2);
    if (e.playerId === f.localId) this.shake(0.2);
  }

  /** Bits of a body that is not ash: rime-bone chips and frost (the ossuary), dust and blood (the arena). */
  private debris(kind: MonsterKind, family: 'rime' | 'dust', x: number, y: number, big: boolean, c0: RGB, c1: RGB): void {
    const pen = this.k.pen;
    if (family === 'rime') {
      if (kind === 'rimeshade') {
        // A ghost comes apart into cold wisps rising.
        const w = pen.burst(x, y - 10, 10, C.ice, C.mana);
        w.sprite = 'fx/smoke';
        pen.speed(4, 14);
        pen.life(0.5, 0.9);
        pen.size(0.3, 0.5);
        w.sizeEnd = 1.6;
        w.gravity = -30;
        w.emissive = 0.5;
        pen.emit();
        return;
      }
      const b = pen.burst(x, y - 6, big ? 22 : 7, BONE_CHIP, BONE_END);
      b.sprite = 'fx/ash';
      pen.speed(20, big ? 80 : 50);
      pen.upward(30, 80);
      b.z = 4;
      b.gravity = 280;
      pen.life(0.5, 0.9);
      pen.size(1, 1.5);
      b.sizeEnd = 1;
      b.additive = false;
      b.emissive = 0;
      b.layer = 'world';
      pen.emit();
      this.frostBurst(x, y - 8, big ? 14 : 5, 20, big ? 90 : 55, false);
    } else {
      const b = pen.burst(x, y - 4, big ? 20 : 7, SAND, SAND_END);
      b.sprite = 'fx/smoke';
      pen.speed(10, big ? 50 : 30);
      pen.life(0.5, 0.9);
      pen.size(0.35, 0.6);
      b.sizeEnd = 1.8;
      b.drag = 0.85;
      b.additive = false;
      b.emissive = 0;
      b.layer = 'world';
      pen.emit();
      const s = pen.burst(x, y - 8, big ? 12 : 5, BLOOD, BLOOD_END);
      pen.speed(20, big ? 80 : 50);
      pen.life(0.2, 0.45);
      pen.size(0.5, 0.8);
      s.gravity = 200;
      s.additive = false;
      s.emissive = 0.2;
      pen.emit();
      if (Math.random() < (big ? 1 : 0.35)) this.k.fx.decals.spawn(x, y + 1, big ? 1.2 : 0.6, big ? 12 : 7, 0, 'blood');
    }
    // The killing blow's own colour, as with every death.
    const k = pen.burst(x, y - 8, big ? 10 : 4, c0, c1);
    pen.speed(20, big ? 90 : 50);
    pen.life(0.15, 0.35);
    pen.size(0.6, 1);
    k.drag = 0.9;
    pen.emit();
  }

  /** Ice shards and frost bursting from (x, y) (`fountain`: thrown up and falling back). */
  private frostBurst(x: number, y: number, count: number, speedLo: number, speedHi: number, fountain = true): void {
    const pen = this.k.pen;
    const b = pen.burst(x, y, count, C.ice, C.mana);
    b.sprite = 'fx/frost';
    pen.speed(speedLo * 0.4, speedHi * 0.5);
    if (fountain) {
      pen.upward(speedLo, speedHi);
      b.z = 4;
      b.gravity = 260;
    } else b.drag = 0.88;
    pen.life(0.5, 1.1);
    pen.size(0.6, 1.1);
    b.sizeEnd = 0.5;
    pen.emit();
  }

  /** Arena sand kicked up at (x, y). */
  private sandPuff(x: number, y: number, count: number): void {
    const pen = this.k.pen;
    const b = pen.burst(x, y - 2, count, SAND, SAND_END);
    b.sprite = 'fx/smoke';
    pen.speed(15, 45);
    pen.life(0.5, 0.9);
    pen.size(0.35, 0.6);
    b.sizeEnd = 1.8;
    b.drag = 0.85;
    b.additive = false;
    b.emissive = 0;
    b.layer = 'world';
    pen.emit();
  }

  /** Kind of the run's boss (in the world, else the theme's roster boss). */
  private bossKind(f: FrameCtx): MonsterKind | null {
    const m = f.world.monsters;
    for (let i = 0; i < m.capacity; i++) if (m.alive[i] && m.rarity[i] === RARITY_CODE.boss) return MONSTER_KINDS[m.kind[i]] ?? null;
    const roster = (THEME_ROSTER as Record<string, { boss: string }>)[f.theme];
    return roster ? (roster.boss as MonsterKind) : null;
  }

  private dropSpawn(tone: DropTone, x: number, y: number): void {
    const { pen, fx, rig, post } = this.k;
    const col = TONE_COLOR[tone];
    if (tone === 'unique') {
      const delay = this.k.impactDelay('dropUnique');
      post.flash(FLASH_UNIQUE, 0.3, 0.7, delay);
      post.after(delay, () => {
        post.chromatic(0.6);
        post.slowMo(0.25, 0.15);
        rig.holdFor(0.08);
        rig.shake(0.35);
        fx.rings.spawn(x, y - 10, 6, 90, 0.8, C.unique, 2, 1, 2);
        fx.pulses.spawn(x, y - 20, 220, 1.2, C.unique, 2.2);
        this.fountain(x, y - 6, 40, C.hot, C.unique, 100, 200);
      });
    } else if (tone === 'rare') {
      const delay = this.k.impactDelay('dropRare');
      post.after(delay, () => {
        fx.rings.spawn(x, y - 8, 4, 44, 0.5, C.rare, 1, 1, 1.4);
        fx.pulses.spawn(x, y - 16, 120, 0.8, C.rare, 1.4);
        this.fountain(x, y - 6, 20, C.hot, C.rare, 70, 150);
      });
    } else if (tone === 'map' || tone === 'magic') {
      const b = pen.burst(x, y - 6, 8, C.white, col);
      b.sprite = 'fx/spark';
      pen.speed(10, 40);
      pen.life(0.3, 0.6);
      pen.size(0.5, 0.8);
      pen.emit();
    }
  }

  /**
   * Upward fountain of embers/sparks that fall back and settle (loot, level-ups, bosses). `lit` attaches a small
   * light to each ember (loot and chests: the floor sparkles); celebrations over a fighter stay unlit.
   */
  private fountain(x: number, y: number, count: number, c0: RGB, c1: RGB, upLo: number, upHi: number, lit = true): void {
    const pen = this.k.pen;
    const b = pen.burst(x, y, count, c0, c1);
    b.sprite = 'fx/ember';
    b.z = 4;
    pen.speed(10, 60);
    pen.upward(upLo, upHi);
    b.gravity = 260;
    pen.life(0.8, 1.5);
    pen.size(0.8, 1.2);
    b.sizeEnd = 0.5;
    b.light = lit && count <= 30 ? 10 : 0;
    pen.emit();
  }

  /** A public drop vanished into someone else's bag: a small pale puff and a faint ring, no sparkle. */
  private poof(x: number, y: number): void {
    const pen = this.k.pen;
    const b = pen.burst(x, y - 4, 7, POOF, POOF_END);
    b.sprite = 'fx/smoke';
    pen.speed(8, 22);
    pen.life(0.35, 0.6);
    pen.size(0.3, 0.5);
    b.sizeEnd = 1.6;
    b.drag = 0.9;
    b.gravity = -12;
    b.additive = false;
    b.emissive = 0.15;
    b.layer = 'world';
    pen.emit();
    this.k.fx.rings.spawn(x, y - 1, 3, 12, 0.3, PUBLIC_RING, 1, 0.35);
  }

  private dustPuff(x: number, y: number, count: number): void {
    const pen = this.k.pen;
    const b = pen.burst(x, y - 2, count, DUST, DUST_END);
    b.sprite = 'fx/smoke';
    pen.speed(15, 45);
    pen.life(0.5, 0.9);
    pen.size(0.35, 0.6);
    b.sizeEnd = 1.8;
    b.drag = 0.85;
    b.additive = false;
    b.emissive = 0;
    b.layer = 'world';
    pen.emit();
  }

  private bossPos(f: FrameCtx): { x: number; y: number } | null {
    const m = f.world.monsters;
    for (let i = 0; i < m.capacity; i++) {
      if (m.alive[i] && m.rarity[i] === RARITY_CODE.boss) return { x: m.x[i], y: m.y[i] };
    }
    return null;
  }

  private nearProp(f: FrameCtx, x: number, y: number, kind: string): boolean {
    for (const p of f.world.props) if (p.kind === kind && Math.abs(p.x - x) < 3 && Math.abs(p.y - y) < 3) return true;
    return false;
  }
}

