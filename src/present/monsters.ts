// Monsters: the horde. One pass over the struct-of-arrays store per frame, no allocation: sprite ids and frame
// metadata are precomputed per (kind, anim), every per-monster option lives in reused objects and per-slot
// presentation state (phase offsets, health-bar lag) lives in typed arrays keyed by store slot, reset when the
// slot's id changes.
//
// Readability rules: rarity is a runtime treatment (magic = blue outline + faint underglow; rare = gold outline,
// gold light and ground glow, rising gold embers, name + bar — "a rare monster glows gold and shows its name";
// lieutenant/boss = strong outlines and presence: the Matriarch stands on a slowly turning molten sigil),
// windups pulse a danger tint so attacks are telegraphed by the body as well as the ground, ailments are visible
// at a glance (burning embers + orange light, chilled blue tint + frost, shocked violet sparks), and monsters
// empowered by the Herald glow with a red rim. Every other monster carries its theme's dim 1 px rim
// (ThemeLook.monsterRim), so a normal body never melts into the floor outside the light pools. Presence lights are culled by their own reach, not the sprite's,
// so the boss's glow never blinks at the screen edge.
import { MONSTER_KINDS } from '../contracts/content';
import type { RGB } from '../contracts/render';
import { AILMENT_BIT, MONSTER_ANIM, RARITY_CODE } from '../contracts/sim';
import { C } from './colors';
import { LIGHT_CAPS, lightInView, type FrameCtx } from './context';
import { clamp01, hash1, TAU } from './math';
import { MonsterNameCache } from './names';
import type { Pen } from './pen';
import type { SpriteMeta, SpriteTable } from './sprites';

const ANIM_COUNT = 6;
const KIND_COUNT = MONSTER_KINDS.length;
const KIND = Object.fromEntries(MONSTER_KINDS.map((k, i) => [k, i])) as Record<(typeof MONSTER_KINDS)[number], number>;

const OUTLINE_MAGIC: RGB = [0.42, 0.58, 1];
const OUTLINE_RARE: RGB = [0.98, 0.82, 0.3];
const OUTLINE_LIEUTENANT: RGB = [1, 0.5, 0.18];
const OUTLINE_BOSS: RGB = [0.92, 0.24, 0.08];
const OUTLINE_EMPOWERED: RGB = [0.7, 0.16, 0.08];
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
const NAME_LT: RGB = [1, 0.58, 0.24];
const RARE_GLOW: RGB = [1, 0.78, 0.3];
const MAGIC_GLOW: RGB = [0.35, 0.5, 1];
const BOSS_FLOOR: RGB = [1, 0.34, 0.1];
const BOSS_POOL: RGB = [0.7, 0.14, 0.04];
/** Plate padding of the rare/lieutenant name (pixels). */
const NAME_PAD = 1;
/** Floats per notable record: x, y, rarity, height of the drawn body + plate above the feet. */
export const NOTABLE_STRIDE = 4;
const NOTABLE_CAP = 64;
/** Rift Stalker leap flight time (sim behaviour table); the body arcs through the air over it. */
const LEAP_FLIGHT = 0.25;
const LEAP_HEIGHT = 14;

export class MonsterPainter {
  private readonly ids: string[] = [];
  private readonly metas: SpriteMeta[] = [];
  private readonly shadow = new Float32Array(KIND_COUNT);
  private cap = 0;
  private seen = new Uint32Array(0);
  private phase = new Float32Array(0);
  private lag = new Float32Array(0);
  private readonly names = new MonsterNameCache();
  private readonly tint: [number, number, number] = [1, 1, 1];
  /**
   * Notable monsters this frame (off-screen indicators), NOTABLE_STRIDE floats each: rendered x, y, rarity and how
   * far above the feet the body and its plate reach (so a marker never sits on top of a visible name plate).
   */
  readonly notable = new Float32Array(NOTABLE_STRIDE * NOTABLE_CAP);
  notableCount = 0;

  constructor(table: SpriteTable) {
    for (let k = 0; k < KIND_COUNT; k++) {
      const kind = MONSTER_KINDS[k];
      for (let a = 0; a < ANIM_COUNT; a++) {
        let name: string;
        if (kind === 'trainingDummy') name = a === MONSTER_ANIM.attack ? 'attack' : 'idle';
        else if (a === MONSTER_ANIM.idle || a === MONSTER_ANIM.spawn) name = 'idle';
        else if (a === MONSTER_ANIM.move) name = 'move';
        else if (a === MONSTER_ANIM.windup) name = 'windup';
        else if (a === MONSTER_ANIM.leap) name = table.has(`monster/${kind}/leap`) ? 'leap' : 'attack';
        else name = 'attack';
        const id = `monster/${kind}/${name}`;
        this.ids.push(id);
        this.metas.push(table.get(id));
      }
      // Shadow width follows the idle sprite's width.
      this.shadow[k] = Math.max(0.6, table.get(`monster/${kind}/idle`).width / 17);
    }
  }

  private ensure(capacity: number): void {
    if (capacity <= this.cap) return;
    this.cap = capacity;
    this.seen = new Uint32Array(capacity).fill(0xffffffff);
    this.phase = new Float32Array(capacity);
    this.lag = new Float32Array(capacity);
  }

  reset(): void {
    this.seen.fill(0xffffffff);
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
    const cap = m.capacity;
    for (let i = 0; i < cap; i++) {
      if (!m.alive[i]) continue;
      const x = m.prevX[i] + (m.x[i] - m.prevX[i]) * a;
      const y = m.prevY[i] + (m.y[i] - m.prevY[i]) * a;
      const rarity = m.rarity[i];
      const kind = m.kind[i];
      const id = m.id[i];
      if (this.seen[i] !== id) {
        this.seen[i] = id;
        this.phase[i] = hash1(id);
        this.lag[i] = m.maxLife[i] > 0 ? m.life[i] / m.maxLife[i] : 1;
      }
      const anim = m.anim[i];
      const si = kind * ANIM_COUNT + (anim < ANIM_COUNT ? anim : 0);
      const meta = this.metas[si];
      const h = meta.anchorY;
      const isBoss = rarity === RARITY_CODE.boss;
      const isLt = rarity === RARITY_CODE.lieutenant;
      const isRare = rarity === RARITY_CODE.rare;
      if (rarity >= RARITY_CODE.rare) {
        if (this.notableCount < NOTABLE_CAP) {
          const o = this.notableCount++ * NOTABLE_STRIDE;
          this.notable[o] = x;
          this.notable[o + 1] = y;
          this.notable[o + 2] = rarity;
          this.notable[o + 3] = h + (isBoss ? 4 : 20);
        }
        this.presenceLights(pen, f, i, x, y, h, rarity, bossPhase);
      }
      if (x < v.x0 - 50 || x > v.x1 + 50 || y < v.y0 - 10 || y > v.y1 + 80) continue;
      const at = m.animTime[i];
      let frame: number;
      if (meta.loop) frame = Math.floor(at * meta.fps + this.phase[i] * meta.frames) % meta.frames;
      else {
        frame = Math.floor(at * meta.fps);
        if (frame >= meta.frames) frame = meta.frames - 1;
      }
      const ail = m.ailments[i];
      const spawning = anim === MONSTER_ANIM.spawn;
      const spawnK = spawning ? clamp01(at / 0.5) : 1;

      // Shadow.
      const so = pen.sprite('shadow');
      const sw = this.shadow[kind];
      so.scaleX = sw;
      so.scaleY = sw * 0.7;
      so.alpha = 0.8 * spawnK;
      r.sprite('fx/shadow', 0, x, y, so);

      // Ground presence under elites (on 'decal': under every body, never over one).
      if (isBoss) this.bossFloor(pen, f, x, y, bossPhase, spawnK);
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

      // Body.
      const o = pen.sprite('world');
      o.flipX = m.facing[i] < 0;
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
      if (ail & (AILMENT_BIT.chilled | AILMENT_BIT.shocked | AILMENT_BIT.burning | AILMENT_BIT.empowered)) {
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
        o.tint = tint;
      }
      // The Matriarch's molten body never sinks into the dark: a little self-light, hotter each phase.
      if (isBoss) o.emissive = Math.max(o.emissive ?? 0, 0.08 + 0.04 * bossPhase);
      // Leaping hunters arc through the air above their shadow.
      let hop = 0;
      if (anim === MONSTER_ANIM.leap) {
        hop = Math.sin(Math.PI * clamp01(at / LEAP_FLIGHT)) * LEAP_HEIGHT;
        o.sortY = y;
      }
      if (isBoss) o.outline = OUTLINE_BOSS;
      else if (isLt) o.outline = OUTLINE_LIEUTENANT;
      else if (isRare) o.outline = OUTLINE_RARE;
      else if (rarity === RARITY_CODE.magic) o.outline = OUTLINE_MAGIC;
      else if (ail & AILMENT_BIT.empowered) o.outline = OUTLINE_EMPOWERED;
      // Everyone else: the theme's dim rim, so a normal monster never melts into the floor.
      else o.outline = f.look.monsterRim;
      r.sprite(this.ids[si], frame, x, y - hop, o);

      const midY = y - h * 0.5;

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

      // Rising motes: gold for rare leaders, heat for the Matriarch.
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
      } else if (isBoss && Math.random() < fxDt * (18 + bossPhase * 10)) {
        const ang = Math.random() * TAU;
        const b = pen.burst(x + Math.cos(ang) * 30, y + Math.sin(ang) * 12, 1, C.hot, C.lavaDark);
        b.sprite = 'fx/ember';
        pen.speed(6, 18);
        pen.life(0.8, 1.6);
        pen.size(0.7, 1.2);
        b.angle = -Math.PI / 2;
        b.spread = 0.9;
        b.gravity = -34;
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
   * Lights that make an elite read from afar: the Matriarch's ember underglow, the Herald's, and the gold light of
   * rare leaders. Culled by their reach, so they fade in with the floor they light instead of popping.
   */
  private presenceLights(pen: Pen, f: FrameCtx, i: number, x: number, y: number, h: number, rarity: number, bossPhase: number): void {
    const v = f.view;
    const time = f.time;
    if (rarity === RARITY_CODE.boss) {
      const k = 0.8 + 0.2 * Math.sin(time * 2.3) + (bossPhase - 1) * 0.18;
      if (lightInView(v, x, y - 20, 190)) pen.light(x, y - 20, 190, C.ember, 0.95 * k, 0.4);
      if (lightInView(v, x, y - 40, 70)) pen.light(x, y - 40, 70, C.hot, 0.5 * k, 0.3);
    } else if (rarity === RARITY_CODE.lieutenant) {
      if (lightInView(v, x, y - 22, 120)) pen.light(x, y - 22, 120, C.ember, 0.6 + 0.15 * Math.sin(time * 3), 0.35);
    } else if (rarity === RARITY_CODE.rare && f.lights.rare < LIGHT_CAPS.rare) {
      const rad = 40 + f.world.monsters.radius[i] * 2;
      const ly = y - h * 0.5;
      if (!lightInView(v, x, ly, rad)) return;
      f.lights.rare++;
      pen.light(x, ly, rad, C.gold, 0.55 + 0.12 * Math.sin(time * 3 + this.phase[i] * TAU), 0.1);
    }
  }

  /** The Matriarch's floor: a broad molten pool and a slowly turning sigil that burn hotter each phase. */
  private bossFloor(pen: Pen, f: FrameCtx, x: number, y: number, phase: number, spawnK: number): void {
    const r = pen.r;
    const time = f.time;
    const heat = 0.85 + 0.15 * Math.sin(time * 2.3) + (phase - 1) * 0.15;
    const pool = pen.sprite('decal');
    pool.additive = true;
    pool.emissive = 1;
    pool.tint = BOSS_POOL;
    pool.alpha = 0.34 * heat * spawnK;
    pool.scaleX = 3.4;
    pool.scaleY = 1.5;
    r.sprite('fx/glow', 0, x, y - 2, pool);
    const sg = pen.sprite('decal');
    sg.additive = true;
    sg.emissive = 1;
    sg.tint = BOSS_FLOOR;
    sg.alpha = (0.16 + 0.05 * phase) * heat * spawnK;
    sg.scaleX = 2.6;
    sg.scaleY = 1.3;
    r.sprite('fx/sigil', Math.floor(time * 4), x, y - 1, sg);
  }
}
