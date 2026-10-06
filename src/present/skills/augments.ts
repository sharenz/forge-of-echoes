// Visuals of the flagship augments (power rework SK5). Three pieces, all in the hit's element palette:
//   AugmentFx.event(...)   the 'augment' cues: a lodge sticking, detonations and bursts (lodges, Pyre Burst, Afterimage, Static
//                          Arrival, Eye of the Storm, Shattering Rows), on-kill explosions, splits, marks, Tide Returns, Heartfire
//   drawAugmentStatus(...) on a monster: lodged projectiles glowing in its body, a mark's reticle over its head (AILMENT_BIT
//                          lodged / marked, from the snapshot, so it shows for every viewer)
//   drawAugmentArea(...)   the player's chilling ground (Frost Comb) and static fields (Thunder Mark); burning ground and Magma
//                          Core's pool are fireTrail areas (areas.ts)
import type { DamageType } from '../../contracts/content';
import type { RGB } from '../../contracts/render';
import { AILMENT_BIT, type AreaView, type SimEvent } from '../../contracts/sim';
import { C } from '../colors';
import type { FrameCtx } from '../context';
import { sparks, type Effects } from '../fx';
import { clamp01, TAU } from '../math';
import type { Pen } from '../pen';

const KINETIC: RGB = [0.95, 0.85, 0.58];
const KINETIC_END: RGB = [0.45, 0.4, 0.34];
const MARK: RGB = [1, 0.86, 0.45];
const STATIC: RGB = [0.62, 0.78, 1];

/** Hot, cool and glow colours of each damage type. */
const PALETTE: Record<DamageType, readonly [RGB, RGB, RGB]> = {
  fire: [C.hot, C.ember, C.flame],
  cold: [C.ice, C.mana, C.frost],
  lightning: [C.lightning, C.storm, STATIC],
  void: [C.voidHi, C.void, C.voidGlow],
  physical: [KINETIC, KINETIC_END, KINETIC],
};

export interface AugmentKit {
  pen: Pen;
  fx: Effects;
}

/** Cue budget per frame: on-kill chains in a dense pack never flood the particle pool. */
const CUES_PER_FRAME = 24;

export class AugmentFx {
  private cues = 0;

  constructor(private readonly k: AugmentKit) {}

  /** New frame: reset the cue budget. */
  beginFrame(): void {
    this.cues = 0;
  }

  event(e: Extract<SimEvent, { t: 'augment' }>, own: boolean): void {
    if (this.cues++ > CUES_PER_FRAME && e.fx !== 'detonate' && e.fx !== 'blast') return;
    const { pen, fx } = this.k;
    const [hot, cool, glow] = PALETTE[e.damageType] ?? PALETTE.fire;
    const y = e.y - 6;
    switch (e.fx) {
      case 'lodge':
        // A spark driven into the body (or the afterimage / fused shell waiting to go off).
        sparks(pen, e.x, y - 4, 4, hot, cool, 10, 30, 0.15);
        fx.rings.spawn(e.x, y, 2, Math.max(8, e.radius * 0.5), 0.2, glow, 1, 0.6);
        return;
      case 'detonate':
      case 'blast':
      case 'explode': {
        const big = e.fx !== 'explode';
        fx.rings.spawn(e.x, y, 4, e.radius, big ? 0.32 : 0.24, glow, big ? 2 : 1, 0.85, 0.6);
        fx.rings.spawn(e.x, y, 2, e.radius * 0.5, 0.2, hot, 1, 0.6);
        const b = pen.burst(e.x, y, big ? 16 : 9, hot, cool);
        if (e.damageType === 'cold') b.sprite = 'fx/frost';
        else if (e.damageType === 'lightning' || e.damageType === 'physical') b.sprite = 'fx/spark';
        pen.speed(e.radius * 1.2, e.radius * 2.4);
        pen.life(0.18, 0.36);
        pen.size(0.7, 1.2);
        b.drag = 0.9;
        pen.emit();
        fx.pulses.spawn(e.x, y - 4, e.radius * 1.8, 0.24, glow, own ? 0.55 : 0.35);
        if (big) fx.decals.spawn(e.x, e.y, Math.max(0.4, e.radius / 40), 4, 0.5);
        return;
      }
      case 'split':
        sparks(pen, e.x, y, 6, hot, cool, 30, 80, 0.16);
        return;
      case 'mark':
        fx.rings.spawn(e.x, e.y - 2, e.radius + 10, e.radius + 2, 0.3, MARK, 1, 0.9);
        return;
      case 'return':
        sparks(pen, e.x, y, 5, hot, cool, 15, 45, 0.2);
        return;
      case 'refund':
        fx.rings.spawn(e.x, e.y - 4, 6, 34, 0.35, C.mana, 1, 0.8, 0.4);
        fx.pulses.spawn(e.x, e.y - 12, 60, 0.3, C.mana, own ? 0.5 : 0.3);
        return;
    }
  }
}

/**
 * Status visuals of a monster drawn at (x, y) with body height `h` and radius `rad` (monsters.ts calls this after its own
 * ailments): lodged = embers pulsing inside the body; marked = a slowly turning reticle above it.
 */
export function drawAugmentStatus(pen: Pen, f: FrameCtx, x: number, y: number, h: number, rad: number, ail: number, phase: number): void {
  if ((ail & (AILMENT_BIT.lodged | AILMENT_BIT.marked)) === 0) return;
  const r = pen.r;
  if (ail & AILMENT_BIT.lodged) {
    const pulse = 0.55 + 0.45 * Math.sin(f.time * 9 + phase * TAU);
    const o = pen.shape(C.hot, 0.55 * pulse, 'fx');
    o.additive = true;
    o.emissive = 1;
    r.circle(x + rad * 0.25, y - h * 0.5, 2 + pulse, o);
    if (Math.random() < f.fxDt * 6) sparks(pen, x, y - h * 0.5, 1, C.hot, C.ember, 5, 15, 0.12);
  }
  if (ail & AILMENT_BIT.marked) {
    const top = y - h - 6;
    const spin = f.time * 2 + phase * TAU;
    const o = pen.shape(MARK, 0.7, 'fx');
    o.additive = true;
    o.emissive = 0.9;
    o.thickness = 1;
    r.ring(x, top, 5, o);
    for (let k = 0; k < 4; k++) {
      const a = spin + (k * TAU) / 4;
      const tick = pen.shape(MARK, 0.8, 'fx');
      tick.additive = true;
      tick.emissive = 0.9;
      r.circle(x + Math.cos(a) * 7, top + Math.sin(a) * 7, 1, tick);
    }
  }
}

/** Frost Comb's chilling ground and Thunder Mark's static field. False for other kinds. */
export function drawAugmentArea(pen: Pen, f: FrameCtx, a: AreaView): boolean {
  if (a.kind !== 'frostGround' && a.kind !== 'staticField') return false;
  const r = pen.r;
  const t = a.duration > 0 ? a.age / a.duration : 0;
  const k = clamp01(a.age / 0.15) * clamp01((1 - t) / 0.3);
  const col = a.kind === 'frostGround' ? C.frost : STATIC;
  const fill = pen.shape(col, 0.12 * k, 'decal');
  fill.additive = true;
  fill.emissive = 0.7;
  r.circle(a.x, a.y, a.radius, fill);
  const rim = pen.shape(col, 0.3 * k, 'decal');
  rim.additive = true;
  rim.thickness = 1;
  r.ring(a.x, a.y, a.radius, rim);
  if (a.kind === 'staticField') {
    if (Math.random() < f.fxDt * 8 * k) sparks(pen, a.x + (Math.random() - 0.5) * a.radius * 1.4, a.y - 2, 1, C.lightning, C.storm, 5, 25, 0.12);
  } else if (Math.random() < f.fxDt * 5 * k) {
    const b = pen.burst(a.x + (Math.random() - 0.5) * a.radius * 1.4, a.y + (Math.random() - 0.5) * a.radius * 0.8, 1, C.ice, C.mana);
    b.sprite = 'fx/frost';
    pen.speed(1, 4);
    pen.life(0.4, 0.7);
    pen.size(0.3, 0.5);
    pen.emit();
  }
  return true;
}
