// Screen feedback budgets: crit shake, hurt flashes and impact convergence must not stack without bound.
import { beforeAll, describe, expect, it } from 'vitest';
import type { SpriteDef } from '../../src/contracts/art';
import type { SimEvent } from '../../src/contracts/sim';
import { generateSprites } from '../../src/art';
import { THEME_LOOKS } from '../../src/present';
import { CameraRig } from '../../src/present/camera';
import { createFrameCtx } from '../../src/present/context';
import { EventFx } from '../../src/present/events';
import { Effects } from '../../src/present/fx';
import { ImpactHeat } from '../../src/present/heat';
import { Pen } from '../../src/present/pen';
import { PlayerPainter } from '../../src/present/players';
import { PostState } from '../../src/present/post';
import { PropPainter } from '../../src/present/props';
import { SpriteTable, WandTips } from '../../src/present/sprites';
import { emptyWorld, player, RecordingRenderer } from './helpers';

let sprites: SpriteDef[];
beforeAll(() => {
  sprites = generateSprites();
});

function kit() {
  const r = new RecordingRenderer();
  r.registerSprites(sprites);
  const table = new SpriteTable(r);
  const rig = new CameraRig();
  const post = new PostState();
  const fx = new Effects((s, k) => r.measureText(s, k));
  const events = new EventFx({
    pen: new Pen(r), fx, rig, post, table, props: new PropPainter(table),
    players: new PlayerPainter(new WandTips(sprites), { levelUp() {} }), impactDelay: () => 0,
  });
  const world = emptyWorld([player(1, 0, 0)]);
  const f = createFrameCtx(world);
  f.localId = 1;
  f.local = world.players[0];
  let time = 0;
  /** One frame: begin, handle `evs`, end; advances presentation time by dt. */
  const frame = (evs: SimEvent[], dt = 1 / 60): void => {
    time += dt;
    f.time = time;
    f.dt = dt;
    f.fxDt = dt;
    post.update(dt);
    events.beginFrame(dt);
    for (const e of evs) events.handle(e, f);
    events.endFrame(f);
  };
  return { r, rig, post, fx, frame };
}

const crit = (x = 100, y = 40): SimEvent => ({
  t: 'hit', playerId: 1, x, y, amount: 120, damageType: 'fire', crit: true, target: 'monster', killed: false, kind: 'ashling',
});
const hurt = (amount: number): SimEvent => ({
  t: 'hit', playerId: 1, x: 0, y: 0, amount, damageType: 'physical', crit: false, target: 'player', killed: false,
});

describe('screen feedback caps', () => {
  it('30 crits in one frame shake no more than one crit', () => {
    const one = kit();
    one.frame([crit()]);
    const many = kit();
    many.frame(Array.from({ length: 30 }, (_, i) => crit(100 + i * 9, 40)));
    expect(one.rig.traumaLevel).toBeGreaterThan(0);
    expect(many.rig.traumaLevel).toBeLessThanOrEqual(one.rig.traumaLevel + 0.1 + 1e-9);
  });

  it('sustained crit fire stays under a low trauma ceiling', () => {
    const k = kit();
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      k.frame([crit(), crit(130, 60), crit(160, 20)]);
      k.rig.update(1 / 60, 0, 0, 0, 0, 1, false);
      peak = Math.max(peak, k.rig.traumaLevel);
    }
    expect(peak).toBeLessThanOrEqual(0.35);
  });

  it('being surrounded pulses a bounded red flash instead of a permanent veil', () => {
    const k = kit();
    let peak = 0;
    let sum = 0;
    const frames = 120;
    for (let i = 0; i < frames; i++) {
      // Eight attackers, each hitting four times a second for 3 % of max life.
      const hits: SimEvent[] = [];
      if (i % 2 === 0) for (let h = 0; h < 1 + (i % 4 === 0 ? 1 : 0); h++) hits.push(hurt(3));
      k.frame(hits);
      const fx = k.post.build(THEME_LOOKS.ashenForge, 1 / 60, false, 0, i / 60);
      const a = fx.flash ? fx.flash.alpha : 0;
      peak = Math.max(peak, a);
      sum += a;
    }
    expect(peak).toBeLessThanOrEqual(0.3);
    // On average the screen stays clearly readable.
    expect(sum / frames).toBeLessThan(0.15);
  });

  it('a big hit is felt at once, even right after a small one', () => {
    const k = kit();
    k.frame([hurt(2)]);
    const before = k.post.build(THEME_LOOKS.ashenForge, 1 / 60, false, 0, 0).flash?.alpha ?? 0;
    k.frame([hurt(40)]);
    const after = k.post.build(THEME_LOOKS.ashenForge, 1 / 60, false, 0, 0).flash?.alpha ?? 0;
    expect(after).toBeGreaterThan(before + 0.1);
  });
});

describe('impact convergence', () => {
  it('counts impacts per 32-unit cell inside a short window', () => {
    const h = new ImpactHeat(0.1);
    expect(h.touch(10, 10, 1)).toBe(0);
    expect(h.touch(12, 14, 1.01)).toBe(1);
    expect(h.touch(20, 5, 1.05)).toBe(2);
    expect(h.touch(200, 10, 1.05)).toBe(0); // another cell
    expect(h.touch(10, 10, 1.2)).toBe(0); // window elapsed
  });

  it('a focus-fired target gets at most two light pulses per window', () => {
    const k = kit();
    k.frame(Array.from({ length: 24 }, () => crit(100, 40)));
    // Pulses are drawn as lights; count the ones on the target (crit pulses: radius 52).
    const pen = new Pen(k.r);
    k.r.beginFrame({ camera: { x: 0, y: 0, zoom: 1 }, ambient: [0.2, 0.2, 0.2], time: 0 });
    k.fx.pulses.draw(pen);
    const onTarget = k.r.frameLights.filter((l) => Math.abs(l.x - 100) < 1 && Math.abs(l.y - 32) < 1);
    expect(onTarget.length).toBeLessThanOrEqual(2);
  });
});
