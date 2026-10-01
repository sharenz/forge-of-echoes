// Instance stream layout shared by the CPU batcher and the sprite shader.
//
// Every visible thing — sprite frame, glyph, rect, circle, ring, line — is one instanced quad of STRIDE 32-bit
// words. The whole lit scene (all layers, already ordered) is a single instanced draw call.
//
//  word  0..3  f32   x, y (pivot, target px), w, h (quad size, target px)
//  word  4..6  f32   pivotX, pivotY (inside the quad), rotation (rad)
//  word  7..8  f32   shape params p0 (ring/line thickness), p1 (arc fraction)
//  word  9     u16x2 atlas texel origin (u, v)
//  word 10     u16x2 frame texel size (w, h)
//  word 11     u8x4  page, kind, flags, emissive (0..255)
//  word 12     u8x4  tint rgb + alpha
//  word 13     u8x4  flash rgb + amount
//  word 14     u8x4  outline rgb + enabled (plate border colour for rects)

export const STRIDE = 15;
export const STRIDE_BYTES = STRIDE * 4;

export const KIND_SPRITE = 0;
export const KIND_RECT = 1;
export const KIND_CIRCLE = 2;
export const KIND_LINE = 3;

export const FLAG_FLIP_X = 1;
export const FLAG_FLIP_Y = 2;
export const FLAG_ADDITIVE = 4;
/** Shadow layer: darkens albedo only, leaves the emissive buffer untouched. */
export const FLAG_SHADOW = 8;
/** 8-neighbour outline (text) instead of the 4-neighbour sprite outline. */
export const FLAG_OUTLINE8 = 16;
/** Rect with a 1px border in the outline colour (text plates). */
export const FLAG_BORDER = 32;
/**
 * Opaque 'world' sprite (character, monster, prop, drop): gets the actor lift — extra ambient fill plus a sky
 * rim on its top edge — so silhouettes stay readable in darkness (see SPRITE_FS).
 */
export const FLAG_ACTOR = 64;

export const LAYERS = ['ground', 'decal', 'shadow', 'world', 'fx', 'top'] as const;
export const L_GROUND = 0;
export const L_DECAL = 1;
export const L_SHADOW = 2;
export const L_WORLD = 3;
export const L_FX = 4;
export const L_TOP = 5;

/** Growable staging list of instances for one layer (plus u32 sort keys for y-sorted layers). */
export class InstanceList {
  f32: Float32Array;
  u32: Uint32Array;
  keys: Uint32Array;
  count = 0;
  private capacity: number;

  constructor(capacity = 1024) {
    this.capacity = capacity;
    const buf = new ArrayBuffer(capacity * STRIDE_BYTES);
    this.f32 = new Float32Array(buf);
    this.u32 = new Uint32Array(buf);
    this.keys = new Uint32Array(capacity);
  }

  /** Reserve one instance; returns its word offset. */
  push(): number {
    if (this.count === this.capacity) this.grow();
    return this.count++ * STRIDE;
  }

  reset(): void {
    this.count = 0;
  }

  private grow(): void {
    const cap = this.capacity * 2;
    const buf = new ArrayBuffer(cap * STRIDE_BYTES);
    const u32 = new Uint32Array(buf);
    u32.set(this.u32);
    const keys = new Uint32Array(cap);
    keys.set(this.keys);
    this.capacity = cap;
    this.u32 = u32;
    this.f32 = new Float32Array(buf);
    this.keys = keys;
  }
}

/** Growable u32 array used to assemble the per-frame upload. */
export class WordBuffer {
  u32: Uint32Array;
  constructor(words = 1024 * STRIDE) {
    this.u32 = new Uint32Array(words);
  }
  ensure(words: number): Uint32Array {
    if (words > this.u32.length) {
      let n = this.u32.length;
      while (n < words) n *= 2;
      this.u32 = new Uint32Array(n);
    }
    return this.u32;
  }
}
