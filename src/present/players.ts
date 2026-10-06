// Players: every sorceress in the instance. Facing follows the aim while casting and the velocity while moving
// (with hysteresis, see direction.ts); locomotion playback scales with speed; casts show their wind-up frames
// from castProgress and snap to the release frames when the cast event lands. Each carries her wand-tip ember
// light (tip positions measured from the art), a personal light pool, a blob shadow, the Cinder Ward bubble and,
// for allies, a name plate with a small life bar. The local player gets a subtle warm ground ring instead, and a
// thin warm-white outline (flat colour: unlit, never bloomed) while she stands inside a danger telegraph or a fire
// pool — exactly where lights, rims and blasts pile up — so her silhouette survives the brightest moments of a
// fight and she sees at a glance that she is standing in it (the bestiary's lanes and choir bands count by their
// real shape: src/sim/area-geometry.ts areaContains).
// Debuffs (debuffs.ts) ride on every player: overlays, the chilled / frozen tint on her body and, while frozen, her
// pose held exactly where the ice caught her.
// Party colours come from party.ts (stable per name across clients and zones), recomputed when the roster changes.
import type { SkillId } from '../contracts/content';
import type { AreaView, Dir4, PlayerView } from '../contracts/sim';
import type { RGB } from '../contracts/render';
import { areaContains } from '../sim/area-geometry';
import { C } from './colors';
import type { FrameCtx } from './context';
import { findDebuff, type DebuffPainter } from './debuffs';
import { facingFromVector, spriteDir } from './direction';
import { approach, clamp, clamp01, hash1, TAU } from './math';
import type { Pen } from './pen';
import { PARTY_COLORS, partyColorSlots } from './party';
import type { WandTips } from './sprites';

/** Base move speed (GAME_SPEC §3): run animation plays at 1× at this speed. */
const BASE_SPEED = 110;
const RUN_FPS = 12;
const IDLE_FPS = 5;
const RELEASE_HOLD = 0.13;

const LOCAL_RING: RGB = [1, 0.62, 0.3];
const HIT_FLASH: RGB = [1, 0.32, 0.26];
const WARD: RGB = [1, 0.66, 0.3];
const DEAD_NAME: RGB = [0.55, 0.52, 0.5];
const DANGER_OUTLINE: RGB = [1, 0.86, 0.7];
/** Slack (world units) around a danger area inside which her outline shows: her body, not just her feet. */
const DANGER_SLACK = 5;

/** Is (x, y) inside a telegraph, a hazard or a fire pool that hurts or holds players? */
export function inPlayerDanger(areas: readonly AreaView[], x: number, y: number): boolean {
  for (let k = 0; k < areas.length; k++) {
    const a = areas[k];
    const kind = a.kind;
    if (kind === 'fireTrail' || kind === 'heraldAura') continue;
    if (areaContains(a, x, y, DANGER_SLACK)) return true;
  }
  return false;
}

/** Cast glow per skill; a skill without an entry (roster skills before their presenter slice) glows like fire. */
const SKILL_GLOW: Partial<Record<SkillId, RGB>> = {
  emberLance: C.flame,
  emberNova: C.flame,
  flameWave: C.flame,
  rimeShards: C.frost,
  arcChain: C.storm,
  riftStep: C.voidGlow,
  cinderWard: C.hot,
};

const DIR_INDEX: Record<Dir4, number> = { south: 0, north: 1, east: 2, west: 3 };
const ANIMS = ['idle', 'run', 'cast', 'dash', 'hit'] as const;
/** Precomputed sprite ids: SPRITE_IDS[anim][dirIndex] (west uses the east id, flipped). */
const SPRITE_IDS: Record<string, readonly string[]> = {};
for (const a of ANIMS) SPRITE_IDS[a] = ['south', 'north', 'east', 'east'].map((d) => `sorceress/${a}/${d}`);
const DEATH_ID = 'sorceress/death/south';

interface PlayerState {
  id: number;
  facing: Dir4;
  runPhase: number;
  level: number;
  release: number;
  releaseSkill: SkillId | null;
  lastX: number;
  lastY: number;
  speed: number;
  partyIndex: number;
  /** Pose held while frozen (the ice caught her mid-motion). */
  heldId: string;
  heldFrame: number;
  frozen: boolean;
}

export interface PlayerHooks {
  /** A player gained a level (presenter plays the fx + sound). */
  levelUp(p: PlayerView, x: number, y: number): void;
}

export class PlayerPainter {
  private readonly states = new Map<number, PlayerState>();
  private readonly tipOut = { x: 0, y: 0 };
  private readonly c0: [number, number, number] = [1, 1, 1];
  /** Roster the party colours were computed for (ids in view order). */
  private roster: number[] = [];
  /** Rendered positions of players this frame (by id) for other systems (indicators, fx anchors). */
  readonly pos = new Map<number, { x: number; y: number; tipX: number; tipY: number }>();

  constructor(private readonly tips: WandTips, private readonly hooks: PlayerHooks, private readonly debuffs: DebuffPainter | null = null) {}

  reset(): void {
    this.states.clear();
    this.pos.clear();
    this.roster.length = 0;
    this.debuffs?.reset();
  }

  private state(p: PlayerView, x: number, y: number): PlayerState {
    let s = this.states.get(p.id);
    if (!s) {
      s = {
        id: p.id, facing: p.facing, runPhase: hash1(p.id) * 6, level: p.level, release: 0, releaseSkill: null, lastX: x, lastY: y,
        speed: 0, partyIndex: 0, heldId: SPRITE_IDS.idle[0], heldFrame: 0, frozen: false,
      };
      this.states.set(p.id, s);
    }
    return s;
  }

  /** The cast event for player `id` landed: show the release frames. */
  released(id: number, skill: SkillId): void {
    const s = this.states.get(id);
    if (!s) return;
    s.release = RELEASE_HOLD;
    s.releaseSkill = skill;
  }

  /** Party colour for a player id (name plates, off-screen markers). */
  partyColor(id: number): RGB {
    const s = this.states.get(id);
    return PARTY_COLORS[s ? s.partyIndex : 0];
  }

  /** Re-derive party colours when players joined or left (the slots depend only on the set of names). */
  private syncRoster(players: readonly PlayerView[]): void {
    const roster = this.roster;
    let same = roster.length === players.length;
    for (let k = 0; same && k < players.length; k++) same = roster[k] === players[k].id;
    if (same) return;
    roster.length = 0;
    for (const p of players) roster.push(p.id);
    const slots = partyColorSlots(players.map((p) => p.name));
    for (let k = 0; k < players.length; k++) {
      const s = this.states.get(players[k].id);
      if (s) s.partyIndex = slots[k];
    }
  }

  draw(pen: Pen, f: FrameCtx): void {
    const r = pen.r;
    const players = f.world.players;
    // Make sure every player has a state before colours are assigned.
    for (let k = 0; k < players.length; k++) {
      const p = players[k];
      if (!this.states.has(p.id)) {
        this.state(p, p.prevX + (p.x - p.prevX) * f.alpha, p.prevY + (p.y - p.prevY) * f.alpha);
        this.roster.length = 0;
      }
    }
    this.syncRoster(players);
    const alpha = f.alpha;
    const dt = f.dt;
    const time = f.time;
    for (let k = 0; k < players.length; k++) {
      const p = players[k];
      const x = p.prevX + (p.x - p.prevX) * alpha;
      const y = p.prevY + (p.y - p.prevY) * alpha;
      const s = this.state(p, x, y);
      const local = p.id === f.localId;

      // Speed estimate: the view's velocity when present, else the rendered displacement.
      const moved = dt > 0 ? Math.hypot(x - s.lastX, y - s.lastY) / dt : 0;
      const vSpeed = Math.hypot(p.vx, p.vy);
      const target = vSpeed > 1 ? vSpeed : Math.min(moved, 400);
      s.speed += (target - s.speed) * approach(14, dt);
      const mvx = vSpeed > 1 ? p.vx : x - s.lastX;
      const mvy = vSpeed > 1 ? p.vy : y - s.lastY;
      s.lastX = x;
      s.lastY = y;

      if (p.level > s.level) this.hooks.levelUp(p, x, y);
      s.level = p.level;
      if (s.release > 0) s.release = Math.max(0, s.release - dt);

      // Facing: aim while casting (or just released), velocity while moving. Frozen: held with her pose (the sim
      // holds a cast in progress while the aim keeps following the cursor; the ice block must not mirror).
      const frozen = !p.dead && findDebuff(p.debuffs, 'frozen') !== null;
      const casting = p.anim === 'cast' || s.release > 0 || p.anim === 'dash';
      if (!p.dead && !frozen) {
        if (casting) s.facing = facingFromVector(p.aimX - x, p.aimY - y, s.facing);
        else if (s.speed > 8) s.facing = facingFromVector(mvx, mvy, s.facing);
      }
      const di = DIR_INDEX[s.facing];
      const flip = s.facing === 'west';

      // Animation frame.
      let id: string;
      let frame = 0;
      if (p.dead) {
        id = DEATH_ID;
        frame = Math.min(5, Math.floor(p.animTime * 8));
      } else {
        // The basic attack never slows her: while she moves with it held, keep the legs going (strafing towards
        // the aim) instead of sliding in a cast pose. The wand-tip flare still marks every release.
        const strafing = p.anim === 'cast' && p.castSkill === 'emberLance' && s.speed > 25;
        switch (strafing ? 'run' : p.anim) {
          case 'run': {
            const rate = clamp(s.speed / BASE_SPEED, 0.55, 1.7);
            s.runPhase += dt * RUN_FPS * rate;
            id = SPRITE_IDS.run[di];
            frame = Math.floor(s.runPhase) % 6;
            break;
          }
          case 'cast':
            id = SPRITE_IDS.cast[di];
            if (s.release > 0 && p.castProgress < 0.4) frame = s.release > RELEASE_HOLD * 0.45 ? 3 : 4;
            else frame = Math.min(2, Math.floor(p.castProgress * 3));
            break;
          case 'dash':
            id = SPRITE_IDS.dash[di];
            frame = Math.min(2, Math.floor((p.animTime / 0.2) * 3));
            break;
          case 'hit':
            id = SPRITE_IDS.hit[di];
            frame = Math.min(1, Math.floor(p.animTime / 0.1));
            break;
          default:
            if (s.release > 0) {
              id = SPRITE_IDS.cast[di];
              frame = s.release > RELEASE_HOLD * 0.45 ? 3 : 4;
            } else {
              id = SPRITE_IDS.idle[di];
              frame = Math.floor(time * IDLE_FPS + hash1(p.id) * 4) % 4;
            }
        }
      }

      // Frozen: the ice holds her exactly as it caught her (no stride, no breathing, no cast frames, no turning).
      if (frozen) {
        if (!s.frozen) {
          s.heldId = id;
          s.heldFrame = frame;
        }
        id = s.heldId;
        frame = s.heldFrame;
      }
      s.frozen = frozen;
      const cold = this.debuffs ? this.debuffs.update(pen, f, p, x, y) : null;

      // Ground: shadow and identity ring.
      const so = pen.sprite('shadow');
      so.scaleX = 1.15;
      so.scaleY = 1;
      so.alpha = p.dead ? 0.5 : 0.85;
      r.sprite('fx/shadow', 0, x, y, so);
      if (!p.dead) {
        const ringCol = local ? LOCAL_RING : PARTY_COLORS[s.partyIndex];
        const ro = pen.shape(ringCol, local ? 0.22 : 0.3, 'decal');
        ro.additive = true;
        ro.emissive = 0.6;
        ro.thickness = 1;
        r.ring(x, y, 9, ro);
      }

      // Personal light pool: light pooled around the player. A party huddled together shares one pool's worth
      // of light instead of stacking four into a white spot.
      let near = 0;
      for (let q = 0; q < players.length; q++) {
        const o = players[q];
        if (o !== p && !o.dead && Math.abs(o.x - p.x) < 72 && Math.abs(o.y - p.y) < 56) near++;
      }
      const poolK = (local ? 0.72 : 0.45) / (1 + 0.6 * near);
      pen.light(x, y - 10, local ? 128 : 90, f.look.playerLight, poolK * f.look.playerLightK, 0.04);

      // The sorceress.
      const o = pen.sprite('world');
      o.flipX = flip;
      if (p.hitFlash > 0) {
        // A red jolt, capped so a player under steady fire keeps her silhouette and colours.
        o.flash = Math.min(0.6, p.hitFlash);
        o.flashColor = HIT_FLASH;
      }
      if (p.invulnTime > 0 && !p.dead) o.alpha = 0.72 + 0.28 * Math.sin(time * 30);
      if (local && !p.dead && inPlayerDanger(f.world.areas, x, y)) o.outline = DANGER_OUTLINE;
      if (p.dead && !local) {
        const c = this.c0;
        c[0] = 0.6;
        c[1] = 0.58;
        c[2] = 0.62;
        o.tint = c;
      } else if (cold) o.tint = cold;
      r.sprite(id, frame, x, y, o);
      this.debuffs?.draw(pen, f, p, x, y, flip, local);

      // Wand tip ember.
      const tip = this.tips.tip(id, frame, flip, this.tipOut);
      const tx = x + tip.x;
      const ty = y + tip.y;
      let ps = this.pos.get(p.id);
      if (!ps) {
        ps = { x, y, tipX: tx, tipY: ty };
        this.pos.set(p.id, ps);
      }
      ps.x = x;
      ps.y = y;
      ps.tipX = tx;
      ps.tipY = ty;
      if (!p.dead) {
        const charging = p.anim === 'cast' ? p.castProgress : 0;
        const skill = p.castSkill ?? s.releaseSkill ?? 'emberLance';
        const glowCol = SKILL_GLOW[skill] ?? C.flame;
        const releaseK = s.release / RELEASE_HOLD;
        // Allies' wands glow a little softer: several casters side by side must not merge into one lamp.
        const tipK = local ? 1 : 0.7;
        pen.light(tx, ty, 48 + 24 * charging + 26 * releaseK, glowCol, (0.38 + 0.25 * charging + 0.3 * releaseK) * tipK, 0.25);
        const g = pen.sprite('fx');
        g.additive = true;
        g.tint = glowCol;
        // Small and coloured: the tip is a spark, not a lamp — it must never swallow her silhouette.
        g.alpha = 0.14 + 0.18 * charging + 0.2 * releaseK;
        g.scale = 0.16 + 0.1 * charging + 0.1 * releaseK;
        g.sortY = y + 1;
        r.sprite('fx/glow', 0, tx, ty, g);
        // Bigger spells gather sparks into the wand while they wind up.
        if (p.castSkill && p.castSkill !== 'emberLance' && charging > 0.15 && Math.random() < f.fxDt * 40) {
          const a = Math.random() * TAU;
          const d = 10 + Math.random() * 6;
          const b = pen.burst(tx + Math.cos(a) * d, ty + Math.sin(a) * d, 1, C.hot, glowCol);
          b.sprite = 'fx/spark';
          pen.speed(d * 3.2, d * 3.6);
          pen.life(0.22, 0.28);
          pen.size(0.45, 0.7);
          b.angle = a + Math.PI;
          b.spread = 0.1;
          pen.emit();
        }
      }

      // Cinder Ward bubble.
      if (p.wardTime > 0 && !p.dead) {
        const fade = clamp01(p.wardTime / 0.6);
        const wo = pen.sprite('fx');
        wo.additive = true;
        wo.tint = WARD;
        wo.alpha = (local ? 0.55 : 0.4) * fade;
        wo.sortY = y + 2;
        r.sprite('fx/ward', Math.floor(time * 10), x, y - 12, wo);
        const gr = pen.shape(C.ember, 0.16 * fade, 'decal');
        gr.additive = true;
        gr.emissive = 0.8;
        gr.thickness = 1;
        r.ring(x, y, 40, gr);
        pen.light(x, y - 10, 70, WARD, (local ? 0.35 : 0.25) * fade, 0.3);
        if (Math.random() < f.fxDt * 16) {
          const a = Math.random() * TAU;
          const b = pen.burst(x + Math.cos(a) * 36, y + Math.sin(a) * 30 - 4, 1, C.hot, C.ember);
          b.sprite = 'fx/ember';
          pen.speed(6, 14);
          pen.life(0.4, 0.8);
          b.angle = a + Math.PI / 2;
          b.spread = 0.4;
          b.gravity = -20;
          pen.emit();
        }
      }

      // Allies: name plate and life bar (you know who you are).
      if (!local) {
        const nameCol = p.dead ? DEAD_NAME : PARTY_COLORS[s.partyIndex];
        const top = y - 36;
        const no = pen.text(nameCol, 1, 1);
        pen.plate(no, C.plate, 0.72, undefined, 2);
        r.text(p.name, x, top, no);
        if (!p.dead && p.maxLife > 0) {
          const w = 22;
          const bx = Math.round(x - w / 2);
          const by = Math.round(top + 7);
          r.rect(bx - 1, by - 1, w + 2, 4, pen.shape(C.plate, 0.9, 'top'));
          const frac = clamp01(p.life / p.maxLife);
          if (frac > 0) r.rect(bx, by, Math.max(1, Math.round(w * frac)), 2, pen.shape(frac < 0.3 ? C.lifeLight : C.life, 1, 'top'));
        }
      }
    }
    // Forget players who left.
    if (this.states.size > players.length) {
      for (const id of [...this.states.keys()]) {
        if (!players.some((p) => p.id === id)) {
          this.states.delete(id);
          this.pos.delete(id);
          this.debuffs?.forget(id);
        }
      }
    }
  }
}
