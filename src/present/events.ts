// SimEvent → visuals: impact sparks, damage numbers, shock rings, chain bolts, corpses, scorch marks, camera
// shake, flashes and the big-moment beats (unique drops, boss phases). Sound is mapped separately (sound.ts).
//
// Budgets: a dense wave emits hundreds of hits per frame, so impact bursts, light pulses and numbers are capped
// per frame (crits, killing blows and the local player's own hits first), and impacts converging on one spot
// are thinned (heat.ts) so a focus-fired target never disappears in bloom.
// Screen feedback is gathered over the frame and applied once in endFrame(): one shake (the strongest request
// plus a little of the rest), one crit kick under a decaying ceiling, one hurt flash at most every 0.12 s.
import type { SfxId } from '../contracts/audio';
import { MONSTER_KINDS, type DamageType, type MonsterKind } from '../contracts/content';
import type { RGB } from '../contracts/render';
import { RARITY_CODE, type DropTone, type ProjectileKind, type SimEvent } from '../contracts/sim';
import type { CameraRig } from './camera';
import { C, IMPACT_COLOR, TONE_COLOR } from './colors';
import { CHARGE_MAX_RADIUS, type FrameCtx } from './context';
import { NUM_STYLE_PLAYER_HURT, sparks, type Effects } from './fx';
import { ImpactHeat } from './heat';
import { clamp01, TAU } from './math';
import type { Pen } from './pen';
import type { PlayerPainter } from './players';
import type { PostState } from './post';
import type { PropPainter } from './props';
import type { SpriteTable } from './sprites';

const DT_INDEX: Record<DamageType, number> = { physical: 0, fire: 1, cold: 2, lightning: 3, void: 4 };
const KIND_INDEX = Object.fromEntries(MONSTER_KINDS.map((k, i) => [k, i])) as Record<MonsterKind, number>;
const BIG: ReadonlySet<MonsterKind> = new Set(['ironhideBrute', 'ashboundHerald', 'cinderMatriarch']);
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
  private readonly frames = { impact: 4, levelUp: 8, sigil: 8, slash: 4 };

  constructor(private readonly k: EventKit) {
    const t = k.table;
    this.frames.impact = t.get('fx/impact').frames;
    this.frames.levelUp = t.get('fx/levelUp').frames;
    this.frames.sigil = t.get('fx/sigil').frames;
    this.frames.slash = t.get('fx/slash').frames;
    for (let i = 0; i < MONSTER_KINDS.length; i++) {
      const m = t.get(`monster/${MONSTER_KINDS[i]}/corpse`);
      k.fx.corpses.setInfo(i, m.frames, m.fps);
    }
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
  }

  /** Request screen shake for this frame (applied once in endFrame). */
  private shake(amount: number): void {
    if (!(amount > 0)) return;
    if (amount > this.shakeMax) this.shakeMax = amount;
    this.shakeSum += amount;
  }

  handle(e: SimEvent, f: FrameCtx): void {
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
        this.hit(e, f);
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
        } else sparks(pen, e.x, e.y - 8, n, c0, c1, 15, 55, 0.22);
        return;
      }
      case 'death':
        this.death(e);
        return;
      case 'monsterAttack': {
        if (e.attack === 'summon') {
          fx.sprites.spawn('fx/sigil', this.frames.sigil, e.x, e.y, 0.8, { color: C.ember, scale: 2.2, alpha: 0.9 });
          fx.rings.spawn(e.x, e.y, 10, 90, 0.6, C.ember, 2, 0.8, 1);
        } else if (e.attack === 'leap' || e.attack === 'charge') {
          this.dustPuff(e.x, e.y, 8);
        } else if (e.attack === 'melee' && this.bursts++ < 20) {
          fx.sprites.spawn('fx/slash', this.frames.slash, e.x, e.y - 8, 0.2, { alpha: 0.7, scale: 0.7, rotation: Math.random() * TAU, color: C.bone });
        }
        return;
      }
      case 'monsterSpawn': {
        if (e.rarity >= RARITY_CODE.lieutenant) {
          fx.rings.spawn(e.x, e.y, 10, 120, 0.8, C.ember, 2, 1, 1.5);
          this.shake(0.35);
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
      case 'waveTell':
        post.flash(FLASH_TELL, 0.08, 0.6, this.k.impactDelay('waveTell'));
        return;
      case 'waveStart':
        post.flash(C.ember, 0.06, 0.4);
        this.shake(0.12);
        return;
      case 'bossSpawn':
        post.flash(FLASH_BOSS, 0.3, 1.2);
        post.chromatic(0.5);
        this.shake(0.7);
        rig.holdFor(0.08);
        fx.rings.spawn(e.x, e.y, 12, 180, 1, C.ember, 2, 1, 2);
        fx.rings.spawn(e.x, e.y, 6, 110, 0.7, C.hot, 1, 0.9);
        fx.pulses.spawn(e.x, e.y - 30, 260, 1.2, C.ember, 2);
        fx.sprites.spawn('fx/sigil', this.frames.sigil, e.x, e.y, 1.2, { color: C.ember, scale: 4, alpha: 1 });
        this.fountain(e.x, e.y, 60, C.hot, C.lavaDark, 120, 220);
        return;
      case 'bossPhase': {
        post.flash(FLASH_PHASE, 0.28, 0.6);
        post.chromatic(0.7);
        post.slowMo(0.3, 0.14);
        this.shake(0.75);
        rig.holdFor(0.07);
        const b = this.bossPos(f);
        if (b) {
          fx.rings.spawn(b.x, b.y - 20, 10, 150, 0.7, C.hot, 2, 1, 2);
          this.fountain(b.x, b.y - 10, 50, C.hot, C.ember, 80, 200);
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

  private death(e: Extract<SimEvent, { t: 'death' }>): void {
    const { pen, fx, rig, post } = this.k;
    const ki = KIND_INDEX[e.kind] ?? 0;
    const boss = e.rarity === RARITY_CODE.boss;
    const lt = e.rarity === RARITY_CODE.lieutenant;
    const big = BIG.has(e.kind) || boss || lt;
    const life = boss ? CORPSE_LIFE_BOSS : big ? CORPSE_LIFE_BIG : CORPSE_LIFE;
    fx.corpses.spawn(ki, e.x, e.y, e.facing < 0, DT_INDEX[e.damageType] ?? 0, life * (0.85 + Math.random() * 0.3));
    const ic = IMPACT_COLOR[e.damageType];
    const c0 = ic[0];
    const c1 = ic[1];
    if (this.bursts++ < 40 || big || e.rarity >= RARITY_CODE.rare) {
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
    if (big) {
      fx.decals.spawn(e.x, e.y, boss ? 2.4 : 1.2, boss ? 25 : 10, 1);
      fx.pulses.spawn(e.x, e.y - 12, boss ? 260 : 110, boss ? 1.2 : 0.5, C.flame, boss ? 2 : 1.2);
      this.shake(boss ? 0.9 : lt ? 0.6 : 0.2);
    }
    if (boss || lt) {
      fx.rings.spawn(e.x, e.y - 20, 10, boss ? 220 : 130, boss ? 1 : 0.7, C.hot, 2, 1, 2);
      this.fountain(e.x, e.y - 20, boss ? 90 : 50, C.hot, C.ember, 100, 240);
      post.flash(boss ? C.hot : C.flame, boss ? 0.35 : 0.2, boss ? 1.2 : 0.6);
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
      default:
        return;
    }
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

