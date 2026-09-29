// Allocation-free drawing helpers: one reusable options object per primitive kind. The renderer reads options
// synchronously inside each call, so the same object can be reset and refilled for every draw of a frame.
import type {
  Layer, LightOptions, ParticleBurst, Renderer, RGB, ShapeOptions, SpriteOptions, TextOptions,
} from '../contracts/render';

const WHITE: RGB = [1, 1, 1];

export class Pen {
  readonly r: Renderer;
  private readonly so: SpriteOptions = {
    layer: undefined, sortY: undefined, flipX: undefined, scale: undefined, scaleX: undefined, scaleY: undefined,
    rotation: undefined, alpha: undefined, tint: undefined, flash: undefined, flashColor: undefined, additive: undefined,
    emissive: undefined, outline: undefined,
  };
  private readonly sh: ShapeOptions = {
    color: WHITE, alpha: undefined, layer: undefined, additive: undefined, emissive: undefined, thickness: undefined, arc: undefined,
  };
  private readonly lo: LightOptions = { color: WHITE, intensity: 1, flicker: 0 };
  private readonly to: TextOptions = {
    color: undefined, alpha: undefined, scale: undefined, align: undefined, outline: undefined, layer: undefined, box: undefined,
  };
  private readonly box = { color: WHITE, alpha: 1, border: undefined as RGB | undefined, padding: 2 as number | undefined };
  private readonly b: ParticleBurst = {
    x: 0, y: 0, z: undefined, count: 1, sprite: undefined, color: WHITE, colorEnd: undefined, speed: [0, 0], angle: undefined,
    spread: undefined, life: [0.3, 0.5], size: [1, 1], sizeEnd: undefined, gravity: undefined, drag: undefined, upward: undefined,
    additive: undefined, emissive: undefined, layer: undefined, light: undefined,
  };
  private readonly speedT: [number, number] = [0, 0];
  private readonly lifeT: [number, number] = [0.3, 0.5];
  private readonly sizeT: [number, number] = [1, 1];
  private readonly upT: [number, number] = [0, 0];
  /** Scratch colours callers may fill and pass as tint/colour (valid until the next draw that reuses them). */
  readonly t0: [number, number, number] = [1, 1, 1];
  readonly t1: [number, number, number] = [1, 1, 1];
  readonly t2: [number, number, number] = [1, 1, 1];

  constructor(r: Renderer) {
    this.r = r;
  }

  /** Fresh sprite options (all defaults). */
  sprite(layer?: Layer): SpriteOptions {
    const o = this.so;
    o.layer = layer;
    o.sortY = undefined;
    o.flipX = undefined;
    o.scale = undefined;
    o.scaleX = undefined;
    o.scaleY = undefined;
    o.rotation = undefined;
    o.alpha = undefined;
    o.tint = undefined;
    o.flash = undefined;
    o.flashColor = undefined;
    o.additive = undefined;
    o.emissive = undefined;
    o.outline = undefined;
    return o;
  }

  /** Fresh shape options. */
  shape(color: RGB, alpha = 1, layer?: Layer): ShapeOptions {
    const o = this.sh;
    o.color = color;
    o.alpha = alpha;
    o.layer = layer;
    o.additive = undefined;
    o.emissive = undefined;
    o.thickness = undefined;
    o.arc = undefined;
    return o;
  }

  light(x: number, y: number, radius: number, color: RGB, intensity = 1, flicker = 0): void {
    if (!(intensity > 0.004) || !(radius > 0)) return;
    const o = this.lo;
    o.color = color;
    o.intensity = intensity;
    o.flicker = flicker;
    this.r.light(x, y, radius, o);
  }

  /** Fresh text options (top layer, centred, default outline). */
  text(color: RGB, alpha = 1, scale = 1): TextOptions {
    const o = this.to;
    o.color = color;
    o.alpha = alpha;
    o.scale = scale;
    o.align = 'center';
    o.outline = undefined;
    o.layer = undefined;
    o.box = undefined;
    return o;
  }

  /** Attach a plate to the current text options. */
  plate(o: TextOptions, color: RGB, alpha: number, border?: RGB, padding = 2): TextOptions {
    const b = this.box;
    b.color = color;
    b.alpha = alpha;
    b.border = border;
    b.padding = padding;
    o.box = b;
    return o;
  }

  /** Fresh particle burst at (x, y). Set speed/life/size through the setters below. */
  burst(x: number, y: number, count: number, color: RGB, colorEnd?: RGB): ParticleBurst {
    const b = this.b;
    b.x = x;
    b.y = y;
    b.z = undefined;
    b.count = count;
    b.sprite = undefined;
    b.color = color;
    b.colorEnd = colorEnd;
    this.speedT[0] = 0;
    this.speedT[1] = 0;
    b.speed = this.speedT;
    b.angle = undefined;
    b.spread = undefined;
    this.lifeT[0] = 0.3;
    this.lifeT[1] = 0.5;
    b.life = this.lifeT;
    this.sizeT[0] = 1;
    this.sizeT[1] = 1;
    b.size = this.sizeT;
    b.sizeEnd = undefined;
    b.gravity = undefined;
    b.drag = undefined;
    b.upward = undefined;
    b.additive = undefined;
    b.emissive = undefined;
    b.layer = undefined;
    b.light = undefined;
    return b;
  }

  speed(lo: number, hi: number): void {
    this.speedT[0] = lo;
    this.speedT[1] = hi;
  }

  life(lo: number, hi: number): void {
    this.lifeT[0] = lo;
    this.lifeT[1] = hi;
  }

  size(lo: number, hi: number): void {
    this.sizeT[0] = lo;
    this.sizeT[1] = hi;
  }

  upward(lo: number, hi: number): void {
    this.upT[0] = lo;
    this.upT[1] = hi;
    this.b.upward = this.upT;
  }

  emit(): void {
    this.r.emit(this.b);
  }
}
