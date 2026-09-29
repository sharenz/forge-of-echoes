// Texture atlas packing (pure, no GL).
//
// Frames are packed into square pages with a skyline bottom-left packer. Each page keeps two CPU-side RGBA8
// buffers — albedo and an aligned emissive mask — so the GPU texture arrays can be (re)uploaded at any time,
// e.g. after the atlas grows by a page or after a WebGL context loss.
import type { PixelImage } from '../contracts/art';

export interface PackedRect {
  x: number;
  y: number;
}

interface SkylineSegment {
  x: number;
  y: number;
  w: number;
}

/**
 * Skyline bottom-left rectangle packer. Rectangles are padded by `padding` transparent pixels on every side so
 * neighbouring frames never touch.
 */
export class SkylinePacker {
  readonly width: number;
  readonly height: number;
  readonly padding: number;
  private skyline: SkylineSegment[];
  private used = 0;

  constructor(width: number, height: number, padding = 1) {
    this.width = width;
    this.height = height;
    this.padding = padding;
    this.skyline = [{ x: 0, y: 0, w: width }];
  }

  /** Fraction of the page area covered by (padded) rectangles. */
  get occupancy(): number {
    return this.used / (this.width * this.height);
  }

  /** Place a w×h rectangle; returns its top-left (inside the padding) or null if it does not fit. */
  insert(w: number, h: number): PackedRect | null {
    const pw = w + this.padding * 2;
    const ph = h + this.padding * 2;
    if (pw > this.width || ph > this.height) return null;

    let bestIndex = -1;
    let bestY = Infinity;
    let bestWaste = Infinity;
    let bestX = 0;
    for (let i = 0; i < this.skyline.length; i++) {
      const fit = this.fitAt(i, pw, ph);
      if (fit < 0) continue;
      const waste = this.wasteAt(i, pw, fit);
      if (fit < bestY || (fit === bestY && waste < bestWaste)) {
        bestIndex = i;
        bestY = fit;
        bestWaste = waste;
        bestX = this.skyline[i].x;
      }
    }
    if (bestIndex < 0) return null;
    this.addLevel(bestIndex, bestX, bestY + ph, pw);
    this.used += pw * ph;
    return { x: bestX + this.padding, y: bestY + this.padding };
  }

  /** Lowest y at which a pw-wide rectangle starting at segment i rests, or -1 if it does not fit. */
  private fitAt(index: number, pw: number, ph: number): number {
    const x = this.skyline[index].x;
    if (x + pw > this.width) return -1;
    let remaining = pw;
    let y = 0;
    let i = index;
    while (remaining > 0) {
      if (i >= this.skyline.length) return -1;
      const seg = this.skyline[i];
      y = Math.max(y, seg.y);
      if (y + ph > this.height) return -1;
      remaining -= seg.w;
      i++;
    }
    return y;
  }

  /** Area trapped below the rectangle when resting at height y (tie-breaker). */
  private wasteAt(index: number, pw: number, y: number): number {
    let remaining = pw;
    let waste = 0;
    for (let i = index; remaining > 0 && i < this.skyline.length; i++) {
      const seg = this.skyline[i];
      const w = Math.min(seg.w, remaining);
      waste += (y - seg.y) * w;
      remaining -= w;
    }
    return waste;
  }

  private addLevel(index: number, x: number, y: number, w: number): void {
    this.skyline.splice(index, 0, { x, y, w });
    // Trim / remove the segments now covered by the new level.
    for (let i = index + 1; i < this.skyline.length; i++) {
      const prev = this.skyline[i - 1];
      const seg = this.skyline[i];
      const prevEnd = prev.x + prev.w;
      if (seg.x >= prevEnd) break;
      const shrink = prevEnd - seg.x;
      seg.x += shrink;
      seg.w -= shrink;
      if (seg.w <= 0) {
        this.skyline.splice(i, 1);
        i--;
      } else break;
    }
    // Merge neighbouring segments at the same height.
    for (let i = 0; i < this.skyline.length - 1; i++) {
      const a = this.skyline[i];
      const b = this.skyline[i + 1];
      if (a.y === b.y) {
        a.w += b.w;
        this.skyline.splice(i + 1, 1);
        i--;
      }
    }
  }
}

export interface AtlasPage {
  packer: SkylinePacker;
  albedo: Uint8Array;
  emissive: Uint8Array;
  /** Page needs (re)upload to the GPU. */
  dirty: boolean;
}

export interface AtlasSlot {
  page: number;
  x: number;
  y: number;
}

/**
 * CPU-side atlas: a growing list of square RGBA8 pages with aligned emissive layers. Released slots are kept on
 * per-size free lists and handed out again to frames of exactly that size, so re-registering sprites (theme or
 * scene swaps, hot reload) does not grow the atlas forever.
 */
export class AtlasStore {
  readonly pageSize: number;
  readonly padding: number;
  readonly pages: AtlasPage[] = [];
  private readonly free = new Map<number, AtlasSlot[]>();

  constructor(pageSize = 1024, padding = 1) {
    this.pageSize = pageSize;
    this.padding = padding;
  }

  /** True if a w×h frame (plus padding) fits on a page at all. */
  fits(w: number, h: number): boolean {
    return w > 0 && h > 0 && w + this.padding * 2 <= this.pageSize && h + this.padding * 2 <= this.pageSize;
  }

  /** Number of released slots waiting for reuse (all sizes). */
  get freeSlots(): number {
    let n = 0;
    for (const list of this.free.values()) n += list.length;
    return n;
  }

  /** Reserve space for a w×h frame: a released slot of the same size, else packed, opening pages as needed. */
  allocate(w: number, h: number): AtlasSlot {
    if (!this.fits(w, h)) {
      throw new Error(`atlas: frame ${w}x${h} exceeds the ${this.pageSize}px atlas page`);
    }
    const reuse = this.free.get(sizeKey(w, h))?.pop();
    if (reuse) return reuse;
    for (let p = 0; p < this.pages.length; p++) {
      const r = this.pages[p].packer.insert(w, h);
      if (r) return { page: p, x: r.x, y: r.y };
    }
    const size = this.pageSize;
    const page: AtlasPage = {
      packer: new SkylinePacker(size, size, this.padding),
      albedo: new Uint8Array(size * size * 4),
      emissive: new Uint8Array(size * size * 4),
      dirty: true,
    };
    this.pages.push(page);
    const r = page.packer.insert(w, h);
    if (!r) throw new Error('atlas: empty page rejected a frame'); // unreachable: size checked above
    return { page: this.pages.length - 1, x: r.x, y: r.y };
  }

  /** Copy a PixelImage (straight-alpha RGBA) into a page layer at slot position. */
  blit(slot: AtlasSlot, image: PixelImage, layer: 'albedo' | 'emissive'): void {
    const page = this.pages[slot.page];
    const dst = layer === 'albedo' ? page.albedo : page.emissive;
    const size = this.pageSize;
    const w = image.width;
    const rowBytes = w * 4;
    for (let y = 0; y < image.height; y++) {
      const src = image.data.subarray(y * rowBytes, y * rowBytes + rowBytes);
      dst.set(src, ((slot.y + y) * size + slot.x) * 4);
    }
    page.dirty = true;
  }

  /** Zero a w×h region of one layer (a frame without an emissive mask, or a released slot). */
  clear(slot: AtlasSlot, w: number, h: number, layer: 'albedo' | 'emissive'): void {
    const page = this.pages[slot.page];
    const dst = layer === 'albedo' ? page.albedo : page.emissive;
    const size = this.pageSize;
    for (let y = 0; y < h; y++) {
      const o = ((slot.y + y) * size + slot.x) * 4;
      dst.fill(0, o, o + w * 4);
    }
    page.dirty = true;
  }

  /** Return a w×h slot for reuse by a later frame of the same size; its pixels are cleared. */
  release(slot: AtlasSlot, w: number, h: number): void {
    this.clear(slot, w, h, 'albedo');
    this.clear(slot, w, h, 'emissive');
    const key = sizeKey(w, h);
    const list = this.free.get(key);
    if (list) list.push(slot);
    else this.free.set(key, [slot]);
  }
}

function sizeKey(w: number, h: number): number {
  return w * 65536 + h;
}
