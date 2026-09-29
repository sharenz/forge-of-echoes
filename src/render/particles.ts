// Pooled CPU particle system (struct-of-arrays, dense with swap-remove, zero per-frame allocation).
//
// Particles move on the ground plane (x, y) and optionally have a height z (rendered as a y-offset, sorted by
// ground y). Bursts with `upward` velocity or a starting height fly in z under gravity, bounce once or twice and
// settle with friction ("fountain" loot sparks, blood, debris). Other particles apply gravity along screen y
// (positive = falls down the screen, negative = rises like smoke).
import type { ParticleBurst } from '../contracts/render';

export const PARTICLE_CAPACITY = 8192;

const Z_MODE = 2;
const ADDITIVE = 1;
const TWO_PI = Math.PI * 2;
const GROUND_FRICTION = 7; // 1/s velocity decay while resting on the ground
const BOUNCE = 0.32;

function lerpRange(r: readonly [number, number] | undefined, t: number, fallback: number): number {
  return r ? r[0] + (r[1] - r[0]) * t : fallback;
}

export class ParticlePool {
  readonly capacity: number;
  count = 0;

  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size: Float32Array;
  readonly sizeEnd: Float32Array;
  readonly r0: Float32Array;
  readonly g0: Float32Array;
  readonly b0: Float32Array;
  readonly r1: Float32Array;
  readonly g1: Float32Array;
  readonly b1: Float32Array;
  readonly gravity: Float32Array;
  readonly drag: Float32Array; // exponential decay rate (1/s)
  readonly emissive: Float32Array;
  readonly light: Float32Array;
  readonly sprite: Int32Array;
  readonly frames: Uint16Array;
  readonly layer: Uint8Array;
  readonly flags: Uint8Array;

  private readonly floats: Float32Array[];
  private readonly random: () => number;
  private overwrite = 0;

  constructor(capacity = PARTICLE_CAPACITY, random: () => number = Math.random) {
    this.capacity = capacity;
    this.random = random;
    const f = () => new Float32Array(capacity);
    this.x = f();
    this.y = f();
    this.z = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.size = f();
    this.sizeEnd = f();
    this.r0 = f();
    this.g0 = f();
    this.b0 = f();
    this.r1 = f();
    this.g1 = f();
    this.b1 = f();
    this.gravity = f();
    this.drag = f();
    this.emissive = f();
    this.light = f();
    this.sprite = new Int32Array(capacity);
    this.frames = new Uint16Array(capacity);
    this.layer = new Uint8Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.floats = [
      this.x, this.y, this.z, this.vx, this.vy, this.vz, this.age, this.life, this.size, this.sizeEnd,
      this.r0, this.g0, this.b0, this.r1, this.g1, this.b1, this.gravity, this.drag, this.emissive, this.light,
    ];
  }

  /** Slot for a new particle; when the pool is full the oldest-ish slots are recycled round-robin. */
  private alloc(): number {
    if (this.count < this.capacity) return this.count++;
    const i = this.overwrite;
    this.overwrite = (this.overwrite + 1) % this.capacity;
    return i;
  }

  /** Spawn a burst. `sprite`/`frames`/`layer` are resolved by the renderer. Returns the number spawned. */
  emit(b: ParticleBurst, sprite: number, frames: number, layer: number): number {
    const n = Math.max(0, Math.min(this.capacity, Math.floor(b.count)));
    const rnd = this.random;
    const spread = b.spread ?? TWO_PI;
    const centre = b.angle ?? rnd() * TWO_PI;
    const z0 = Math.max(0, b.z ?? 0);
    const zMode = b.upward !== undefined || z0 > 0;
    const drag = b.drag !== undefined ? -Math.log(1 - Math.min(Math.max(b.drag, 0), 0.999)) : 0;
    const c0 = b.color;
    const c1 = b.colorEnd ?? b.color;
    const flags = ((b.additive ?? true) ? ADDITIVE : 0) | (zMode ? Z_MODE : 0);
    for (let k = 0; k < n; k++) {
      const i = this.alloc();
      const a = centre + (rnd() - 0.5) * spread;
      const speed = lerpRange(b.speed, rnd(), 0);
      this.x[i] = b.x;
      this.y[i] = b.y;
      this.z[i] = z0;
      this.vx[i] = Math.cos(a) * speed;
      this.vy[i] = Math.sin(a) * speed;
      this.vz[i] = zMode ? lerpRange(b.upward, rnd(), 0) : 0;
      this.age[i] = 0;
      this.life[i] = Math.max(0.016, lerpRange(b.life, rnd(), 0.5));
      this.size[i] = lerpRange(b.size, rnd(), 1);
      this.sizeEnd[i] = b.sizeEnd ?? 0.3;
      this.r0[i] = c0[0];
      this.g0[i] = c0[1];
      this.b0[i] = c0[2];
      this.r1[i] = c1[0];
      this.g1[i] = c1[1];
      this.b1[i] = c1[2];
      this.gravity[i] = b.gravity ?? 0;
      this.drag[i] = drag;
      this.emissive[i] = b.emissive ?? 1;
      this.light[i] = b.light ?? 0;
      this.sprite[i] = sprite;
      this.frames[i] = Math.max(1, frames);
      this.layer[i] = layer;
      this.flags[i] = flags;
    }
    return n;
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    const { x, y, z, vx, vy, vz, age, life, gravity, drag, flags } = this;
    const groundDecay = Math.exp(-GROUND_FRICTION * dt);
    for (let i = 0; i < this.count; i++) {
      const a = age[i] + dt;
      if (a >= life[i]) {
        this.remove(i);
        i--;
        continue;
      }
      age[i] = a;
      const k = drag[i];
      if (k > 0) {
        const f = Math.exp(-k * dt);
        vx[i] *= f;
        vy[i] *= f;
        vz[i] *= f;
      }
      if (flags[i] & Z_MODE) {
        vz[i] -= gravity[i] * dt;
        let h = z[i] + vz[i] * dt;
        if (h <= 0) {
          h = 0;
          if (vz[i] < 0) {
            const bounce = -vz[i] * BOUNCE;
            vz[i] = bounce > 12 ? bounce : 0;
          }
          vx[i] *= groundDecay;
          vy[i] *= groundDecay;
        }
        z[i] = h;
      } else {
        vy[i] += gravity[i] * dt;
      }
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
    }
  }

  clear(): void {
    this.count = 0;
    this.overwrite = 0;
  }

  /** Swap-remove particle i (the last particle takes its slot). */
  private remove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    for (const arr of this.floats) arr[i] = arr[last];
    this.sprite[i] = this.sprite[last];
    this.frames[i] = this.frames[last];
    this.layer[i] = this.layer[last];
    this.flags[i] = this.flags[last];
  }

  isAdditive(i: number): boolean {
    return (this.flags[i] & ADDITIVE) !== 0;
  }
}
