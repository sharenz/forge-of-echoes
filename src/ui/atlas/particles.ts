// Atmospheric particles for the chart (brief A, 5.4): rising embers, drifting ash, frost glints and void motes.
// Art-pixel positions; deterministic given the seed so tests can step it. Presentation only.
import { CHART_H, CHART_W } from '../../art/atlas/geometry';

export type ParticleKind = 'ember' | 'ash' | 'glint' | 'void';
export interface Particle { kind: ParticleKind; x: number; y: number; vx: number; vy: number; age: number; life: number; size: number }
export interface Emitter { x: number; y: number; kind: 'lava' | 'brazier' | 'frost' | 'torch' | 'void' | 'node' }

/** xorshift for cheap, seedable randomness. */
export function rng(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1000003) / 1000003;
  };
}

export class ParticleField {
  list: Particle[] = [];
  private rand = rng(90210);
  private budget = 0;
  constructor(public max = 170) {}

  step(dt: number, emitters: readonly Emitter[], visible: (x: number, y: number) => boolean, calm: boolean): void {
    if (calm) { this.list.length = 0; return; }
    for (const p of this.list) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'ember') { p.vx += Math.sin(p.age * 3 + p.x) * 6 * dt; p.vy -= 2 * dt; }
      if (p.kind === 'void') p.vx += Math.sin(p.age * 2 + p.y * 0.1) * 5 * dt;
    }
    this.list = this.list.filter((p) => p.age < p.life && p.x > -8 && p.y > -8 && p.x < CHART_W + 8 && p.y < CHART_H + 8);
    // spawn: a steady trickle scaled by the number of emitters, plus a background ash drift
    this.budget += dt * (26 + Math.min(40, emitters.length * 1.4));
    while (this.budget >= 1 && this.list.length < this.max) {
      this.budget -= 1;
      const r = this.rand();
      if (r < 0.18) {
        const x = this.rand() * CHART_W, y = this.rand() * CHART_H;
        if (visible(x, y)) this.list.push({ kind: 'ash', x, y, vx: 5 + this.rand() * 6, vy: 2 + this.rand() * 4, age: 0, life: 6 + this.rand() * 4, size: 1 });
        continue;
      }
      if (!emitters.length) continue;
      const e = emitters[Math.floor(this.rand() * emitters.length)];
      if (e.kind === 'frost') this.list.push({ kind: 'glint', x: e.x + (this.rand() - 0.5) * 6, y: e.y + (this.rand() - 0.5) * 6, vx: 0, vy: 0, age: 0, life: 0.9 + this.rand() * 0.8, size: 1 });
      else if (e.kind === 'void') this.list.push({ kind: 'void', x: e.x + (this.rand() - 0.5) * 20, y: e.y + (this.rand() - 0.5) * 30, vx: 0, vy: -3 - this.rand() * 4, age: 0, life: 2 + this.rand() * 2, size: 1 });
      else this.list.push({ kind: 'ember', x: e.x + (this.rand() - 0.5) * (e.kind === 'lava' ? 8 : 3), y: e.y, vx: (this.rand() - 0.5) * 5, vy: -(8 + this.rand() * 12), age: 0, life: 1.2 + this.rand() * 1.8, size: this.rand() < 0.2 ? 2 : 1 });
    }
  }
}
