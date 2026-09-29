// Ambient particles: embers/frost drifting up out of the abyss beyond the arena rim, and airborne ash, snow or
// dust over the playfield. Emission is proportional to the visible area, so the density is the same at any
// screen size and costs nothing off-screen.
import type { FrameCtx } from './context';
import type { Pen } from './pen';

export class Ambience {
  private abyssAcc = 0;
  private airAcc = 0;

  update(pen: Pen, f: FrameCtx, arenaRadius: number): void {
    const v = f.view;
    const look = f.look;
    const w = v.x1 - v.x0;
    const h = v.y1 - v.y0;
    const screens = (w * h) / (640 * 360);
    // Abyss: sample random points of the view; only those beyond the rim emit.
    this.abyssAcc += f.fxDt * 26 * screens;
    let n = Math.min(8, Math.floor(this.abyssAcc));
    this.abyssAcc -= n;
    const rim = arenaRadius + 34;
    while (n-- > 0) {
      const x = v.x0 + Math.random() * w;
      const y = v.y0 + Math.random() * h + 40;
      if (x * x + y * y < rim * rim) continue;
      const b = pen.burst(x, y, 1, look.abyssColor, look.abyssColorEnd);
      b.sprite = look.abyssSprite;
      pen.speed(2, 8);
      pen.life(2, 3.6);
      pen.size(0.5, 1);
      b.sizeEnd = 0.4;
      b.angle = -Math.PI / 2;
      b.spread = 1;
      b.gravity = -9;
      b.layer = 'fx';
      pen.emit();
    }
    // Air: ash, snow or dust drifting over the playfield.
    if (look.airRate > 0) {
      this.airAcc += f.fxDt * look.airRate * screens;
      let m = Math.min(6, Math.floor(this.airAcc));
      this.airAcc -= m;
      while (m-- > 0) {
        const x = v.x0 + Math.random() * w;
        const y = v.y0 + Math.random() * h;
        if (x * x + y * y > arenaRadius * arenaRadius) continue;
        const b = pen.burst(x, y, 1, look.airColor, look.airColorEnd);
        b.sprite = look.airSprite;
        pen.speed(3, 9);
        pen.life(2.5, 4.5);
        pen.size(look.airSize[0], look.airSize[1]);
        b.sizeEnd = 0.6;
        b.angle = look.airGravity > 0 ? 0.6 : -2.2;
        b.spread = 1.2;
        b.gravity = look.airGravity;
        b.additive = look.airAdditive;
        b.emissive = look.airAdditive ? 0.55 : 0.22;
        b.layer = look.airAdditive ? 'fx' : 'world';
        pen.emit();
      }
    }
  }
}
