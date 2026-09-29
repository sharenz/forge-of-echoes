// Renderer sandbox (dev/render.html): a small self-running battle scene that exercises every renderer feature.
//
// Query params:
//   ?monsters=N   monster count (default 400)
//   ?stress       6000 sprites + ~3000 particles + 200 lights, all on screen
//   ?bench        log average CPU time per frame to the console ("[shot] bench …")
//   ?t=SECONDS    fast-forward the scene before the first frame
//   ?freeze       stop simulating after the fast-forward (static frame for look-dev comparisons)
//   ?zoom=Z       camera zoom (default 1)
//   ?dead         desaturated "death" grading
//   ?lost=MS      simulate a WebGL context loss after MS milliseconds (restores 500 ms later)
//   ?gallery      static reference sheet of every primitive (shapes, text, sprite options) for verification
//   ?skip=a,b     leave out draw groups (ground, pools, telegraphs, props, drops, monsters, hero, projectiles,
//                 chains, levelup, bars, numbers, particles) when isolating a visual problem
import type { Camera, PostFx, Renderer, RGB } from '../../contracts/render';
import { createRenderer, plateHeight, snapToPixel } from '../index';
import { makeTestArt, prng } from './testArt';

declare global {
  interface Window {
    __renderer?: Renderer;
  }
}

const params = new URLSearchParams(location.search);
const STRESS = params.has('stress');
const BENCH = params.has('bench');
const MONSTERS = Number(params.get('monsters') ?? (STRESS ? 6000 : 400));
const ZOOM = Number(params.get('zoom') ?? 1);
const FAST_FORWARD = Number(params.get('t') ?? 0);
const DEAD = params.has('dead');
const FREEZE = params.has('freeze');
const GALLERY = params.has('gallery');
/** Comma-separated draw groups to leave out (debugging), e.g. ?skip=chains,particles */
const SKIP = new Set((params.get('skip') ?? '').split(',').filter(Boolean));

const C = {
  ember: [0.91, 0.4, 0.16] as RGB,
  flame: [1, 0.6, 0.24] as RGB,
  hot: [1, 0.9, 0.66] as RGB,
  deepRed: [0.55, 0.08, 0.04] as RGB,
  frost: [0.5, 0.78, 0.91] as RGB,
  mana: [0.29, 0.48, 0.84] as RGB,
  voidGlow: [0.75, 0.48, 1] as RGB,
  gold: [0.88, 0.69, 0.29] as RGB,
  danger: [1, 0.22, 0.14] as RGB,
  magic: [0.48, 0.64, 1] as RGB,
  rare: [0.95, 0.82, 0.36] as RGB,
  unique: [0.91, 0.47, 0.18] as RGB,
  normal: [0.85, 0.82, 0.77] as RGB,
  currency: [0.79, 0.71, 0.54] as RGB,
  map: [0.82, 0.82, 0.86] as RGB,
  plate: [0.05, 0.04, 0.05] as RGB,
  smoke: [0.24, 0.21, 0.23] as RGB,
  stone: [0.35, 0.31, 0.34] as RGB,
  storm: [0.73, 0.65, 1] as RGB,
  lightning: [0.94, 0.91, 1] as RGB,
  parchment: [0.91, 0.86, 0.75] as RGB,
  life: [0.78, 0.16, 0.14] as RGB,
};

const ARENA = 520;
const TILE = 16;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const statsEl = document.getElementById('stats') as HTMLElement;
const r = createRenderer(canvas);
window.__renderer = r;
r.registerSprites(makeTestArt());

function fit(): void {
  r.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
}
window.addEventListener('resize', fit);
fit();

const rand = prng(1234);
const range = (a: number, b: number) => a + (b - a) * rand();
const hash2 = (x: number, y: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

// -------------------------------------------------------------------------------------------------------------
// Scene state
// -------------------------------------------------------------------------------------------------------------

interface Prop {
  kind: 'pillar' | 'brazier' | 'crystal';
  x: number;
  y: number;
  phase: number;
}
const props: Prop[] = [];
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2;
  props.push({ kind: 'pillar', x: Math.cos(a) * 470, y: Math.sin(a) * 470 * 0.8, phase: 0 });
  if (i % 2 === 0) {
    const b = a + Math.PI / 16;
    props.push({ kind: 'brazier', x: Math.cos(b) * 430, y: Math.sin(b) * 430 * 0.8, phase: rand() * 4 });
  }
}
for (const [cx, cy] of [[-260, -140], [280, 60], [-60, 230]]) {
  for (let k = 0; k < 3; k++) props.push({ kind: 'crystal', x: cx + range(-14, 14), y: cy + range(-8, 8), phase: 0 });
}
for (const [x, y] of [[-110, -90], [150, -130], [-40, 190]]) props.push({ kind: 'brazier', x, y, phase: rand() * 4 });

const N = Math.max(0, MONSTERS);
const mx = new Float32Array(N);
const my = new Float32Array(N);
const mvx = new Float32Array(N);
const mvy = new Float32Array(N);
const mkind = new Uint8Array(N); // 0 ashling, 1 skitter, 2 brute
const mrare = new Uint8Array(N); // 0 normal, 1 magic, 2 rare
const mflash = new Float32Array(N);
const mphase = new Float32Array(N);
const SPEED = [34, 72, 22];
const SPRITE = ['mon/ashling', 'mon/skitter', 'mon/brute'];
const RARE_NAMES = ['Juggernaut Brute', 'Frenzied Ashling', 'Warded Skitter', 'Ember-touched Brute'];

function spawn(i: number, hx: number, hy: number): void {
  if (STRESS) {
    mx[i] = hx + range(-320, 320);
    my[i] = hy + range(-180, 190);
  } else {
    const a = rand() * Math.PI * 2;
    const d = range(140, ARENA - 40);
    mx[i] = Math.cos(a) * d;
    my[i] = Math.sin(a) * d * 0.8;
  }
  const k = rand();
  mkind[i] = k < 0.68 ? 0 : k < 0.9 ? 1 : 2;
  const q = rand();
  mrare[i] = q < 0.02 ? 2 : q < 0.1 ? 1 : 0;
  mphase[i] = rand() * 100;
  mvx[i] = mvy[i] = 0;
  mflash[i] = 0;
}

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}
const projectiles: Projectile[] = [];

interface Number_ {
  x: number;
  y: number;
  age: number;
  text: string;
  crit: boolean;
}
const numbers: Number_[] = [];

interface Pulse {
  x: number;
  y: number;
  age: number;
  life: number;
  radius: number;
  color: RGB;
}
const pulses: Pulse[] = [];

/** Arc-chain lightning: a jagged polyline through a few monsters, re-jittered every frame while it lives. */
interface Chain {
  targets: number[];
  age: number;
}
const chains: Chain[] = [];
let chainTimer = 1.2;

const pools = [
  { x: -150, y: 60, r: 26 },
  { x: 170, y: -90, r: 22 },
  { x: 40, y: 160, r: 30 },
];

interface Telegraph {
  x: number;
  y: number;
  radius: number;
  age: number;
  duration: number;
}
const telegraphs: Telegraph[] = [];

const drops = [
  { x: -60, y: -30, label: 'Ashwood Wand', tone: C.rare, sprite: 'drop/equipment', beam: true },
  { x: 24, y: 40, label: 'Kindling Shard', tone: C.currency, sprite: 'drop/currency', beam: false },
  { x: 96, y: -12, label: 'The Patient Spark', tone: C.unique, sprite: 'drop/equipment', beam: true },
  { x: -124, y: 96, label: 'Silk Wraps', tone: C.magic, sprite: 'drop/equipment', beam: false },
  { x: 136, y: 112, label: 'Map: Ashen Forge (T3)', tone: C.map, sprite: 'drop/currency', beam: true },
];

const hero = { x: 0, y: 0, vx: 0, vy: 0, facing: 'south' as 'south' | 'east' | 'west', fire: 0 };
const camera: Camera = { x: 0, y: 0, zoom: ZOOM, shakeX: 0, shakeY: 0 };
/** Smoothed follow target; the camera itself is derived from the hero's snapped position plus this lag. */
const follow = { x: 0, y: 0 };
let shake = 0;
let time = 0;
let flashTimer = 0;
let lastLevelUp = -10;

function heroPath(t: number): [number, number] {
  return [250 * Math.sin(t * 0.21), 150 * Math.sin(t * 0.33 + 0.6)];
}

for (let i = 0; i < N; i++) spawn(i, 0, 0);

// -------------------------------------------------------------------------------------------------------------
// Simulation
// -------------------------------------------------------------------------------------------------------------

function hitMonster(i: number, dirX: number, dirY: number): void {
  mflash[i] = 1;
  mvx[i] += dirX * 70;
  mvy[i] += dirY * 70;
  const crit = rand() < 0.14;
  const dmg = Math.round(range(18, 34) * (crit ? 2.4 : 1));
  if (numbers.length < 90) numbers.push({ x: mx[i] + range(-4, 4), y: my[i] - 16, age: 0, text: String(dmg), crit });
  r.emit({
    x: mx[i], y: my[i] - 6, count: crit ? 22 : 10, color: C.hot, colorEnd: C.ember, speed: [40, crit ? 170 : 120],
    life: [0.15, 0.4], size: [0.8, 1.3], drag: 0.9,
  });
  if (crit) {
    r.emit({
      x: mx[i], y: my[i], z: 6, count: 8, sprite: 'fx/ember', color: C.flame, colorEnd: C.deepRed, speed: [20, 60],
      upward: [60, 120], gravity: 260, life: [0.6, 1.1], size: [1, 1], sizeEnd: 0.6, light: 14,
    });
    shake = Math.min(3, shake + 1.2);
  }
  pulses.push({ x: mx[i], y: my[i] - 6, age: 0, life: 0.14, radius: crit ? 60 : 36, color: C.flame });
}

function step(dt: number): void {
  time += dt;
  const [px, py] = heroPath(time);
  hero.vx = (px - hero.x) / Math.max(dt, 1e-4);
  hero.vy = (py - hero.y) / Math.max(dt, 1e-4);
  hero.x = px;
  hero.y = py;
  if (Math.abs(hero.vx) > Math.abs(hero.vy) * 0.8) hero.facing = hero.vx > 0 ? 'east' : 'west';
  else hero.facing = 'south';

  // Monsters swarm the hero, orbiting when close.
  const blend = 1 - Math.exp(-4 * dt);
  for (let i = 0; i < N; i++) {
    let dx = hero.x - mx[i];
    let dy = hero.y - my[i];
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const wob = Math.sin(time * 1.7 + mphase[i]);
    const orbit = d < 110 ? 0.9 : 0.35;
    let tx = dx + -dy * orbit * wob;
    let ty = dy + dx * orbit * wob;
    if (d < 34) {
      tx -= dx * 1.6;
      ty -= dy * 1.6;
    }
    if (STRESS) {
      tx = Math.cos(time * 0.5 + mphase[i]);
      ty = Math.sin(time * 0.7 + mphase[i] * 1.3);
    }
    const sp = SPEED[mkind[i]];
    mvx[i] += (tx * sp - mvx[i]) * blend;
    mvy[i] += (ty * sp - mvy[i]) * blend;
    mx[i] += mvx[i] * dt;
    my[i] += mvy[i] * dt;
    const rr = Math.hypot(mx[i], my[i] / 0.8);
    if (!STRESS && rr > ARENA - 30) {
      mx[i] *= (ARENA - 30) / rr;
      my[i] *= (ARENA - 30) / rr;
    }
    if (mflash[i] > 0) mflash[i] = Math.max(0, mflash[i] - dt * 6);
  }

  // Hero fires ember lances at the nearest monster.
  hero.fire -= dt;
  if (hero.fire <= 0 && N > 0) {
    hero.fire = STRESS ? 0.03 : 0.11;
    let best = -1;
    let bestD = 260 * 260;
    for (let i = 0; i < N; i += STRESS ? 7 : 1) {
      const dx = mx[i] - hero.x;
      const dy = my[i] - hero.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best >= 0) {
      const sx = hero.x;
      const sy = hero.y - 12;
      const a = Math.atan2(my[best] - 5 - sy, mx[best] - sx) + range(-0.08, 0.08);
      projectiles.push({ x: sx, y: sy, vx: Math.cos(a) * 360, vy: Math.sin(a) * 360, life: 0.75 });
    }
  }

  for (let p = projectiles.length - 1; p >= 0; p--) {
    const pr = projectiles[p];
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;
    let hit = -1;
    for (let i = 0; i < N && hit < 0; i++) {
      const dx = mx[i] - pr.x;
      const dy = my[i] - 6 - pr.y;
      if (dx * dx + dy * dy < 90) hit = i;
    }
    if (hit >= 0) {
      const inv = 1 / Math.hypot(pr.vx, pr.vy);
      hitMonster(hit, pr.vx * inv, pr.vy * inv);
    }
    if (hit >= 0 || pr.life <= 0) {
      r.emit({ x: pr.x, y: pr.y, count: 6, color: C.hot, colorEnd: C.ember, speed: [10, 60], life: [0.1, 0.25], size: [1, 1.4] });
      projectiles.splice(p, 1);
    } else if (rand() < 0.9) {
      r.emit({
        x: pr.x - pr.vx * 0.02, y: pr.y - pr.vy * 0.02, count: 1, sprite: 'fx/ember', color: C.flame, colorEnd: C.deepRed,
        speed: [4, 18], life: [0.18, 0.4], size: [0.5, 1], sizeEnd: 0.4,
      });
    }
  }

  for (let i = numbers.length - 1; i >= 0; i--) if ((numbers[i].age += dt) > 0.75) numbers.splice(i, 1);
  for (let i = pulses.length - 1; i >= 0; i--) if ((pulses[i].age += dt) > pulses[i].life) pulses.splice(i, 1);

  // Fire pools: rising flames and smoke.
  for (const pool of pools) {
    if (rand() < 0.9) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * pool.r * 0.85;
      r.emit({
        x: pool.x + Math.cos(a) * d, y: pool.y + Math.sin(a) * d * 0.7, count: 1, color: C.hot, colorEnd: C.deepRed,
        speed: [0, 6], life: [0.5, 0.9], size: [1, 1.8], sizeEnd: 0.3, gravity: -46,
      });
    }
    if (rand() < 0.12) {
      r.emit({
        x: pool.x + range(-pool.r, pool.r) * 0.5, y: pool.y - 4, z: 0, count: 1, sprite: 'fx/smoke', color: C.smoke,
        colorEnd: [0.08, 0.07, 0.08], speed: [2, 8], life: [1.2, 2], size: [0.7, 1], sizeEnd: 2.2, gravity: -16,
        additive: false, emissive: 0,
      });
    }
  }

  // Braziers throw embers.
  for (const p of props) {
    if (p.kind === 'brazier' && rand() < 0.08) {
      r.emit({
        x: p.x + range(-3, 3), y: p.y - 12, count: 1, sprite: 'fx/ember', color: C.hot, colorEnd: C.ember, speed: [4, 14],
        angle: -Math.PI / 2, spread: 1.4, life: [0.7, 1.3], size: [0.5, 1], gravity: -22,
      });
    }
  }

  // Abyss embers drifting beyond the arena wall.
  if (!STRESS && rand() < 0.5) {
    const a = rand() * Math.PI * 2;
    const d = range(ARENA + 20, ARENA + 240);
    r.emit({
      x: Math.cos(a) * d, y: Math.sin(a) * d * 0.8, count: 1, sprite: 'fx/ember', color: C.ember, colorEnd: C.deepRed,
      speed: [2, 8], life: [2, 4], size: [0.5, 1], gravity: -10, sizeEnd: 0.5,
    });
  }

  // Telegraphed slams around the hero.
  while (telegraphs.length < 3) {
    const a = rand() * Math.PI * 2;
    const d = range(50, 130);
    telegraphs.push({ x: hero.x + Math.cos(a) * d, y: hero.y + Math.sin(a) * d * 0.8, radius: range(22, 40), age: -rand() * 0.8, duration: range(1.1, 1.8) });
  }
  for (let i = telegraphs.length - 1; i >= 0; i--) {
    const t = telegraphs[i];
    t.age += dt;
    if (t.age >= t.duration) {
      r.emit({ x: t.x, y: t.y, count: 40, color: C.hot, colorEnd: C.danger, speed: [30, 150], life: [0.2, 0.5], size: [1, 1.6], drag: 0.95 });
      r.emit({
        x: t.x, y: t.y, z: 2, count: 14, sprite: 'fx/ember', color: C.stone, colorEnd: C.smoke, speed: [20, 70],
        upward: [70, 150], gravity: 320, life: [0.7, 1.2], size: [1, 1.5], sizeEnd: 1, additive: false, emissive: 0,
      });
      r.emit({
        x: t.x, y: t.y, count: 10, sprite: 'fx/smoke', color: C.smoke, colorEnd: [0.06, 0.05, 0.06], speed: [20, 50],
        life: [0.6, 1.1], size: [1, 1.4], sizeEnd: 2, drag: 0.9, additive: false, emissive: 0,
      });
      pulses.push({ x: t.x, y: t.y, age: 0, life: 0.25, radius: t.radius * 2.6, color: C.flame });
      shake = Math.min(4, shake + 2);
      telegraphs.splice(i, 1);
    }
  }

  // Arc chain from the hero through the nearest monsters every ~2.5 s.
  chainTimer -= dt;
  if (chainTimer <= 0 && N > 4 && !STRESS) {
    chainTimer = 2.5;
    const targets: number[] = [];
    let fromX = hero.x;
    let fromY = hero.y - 14;
    for (let hop = 0; hop < 5; hop++) {
      let best = -1;
      let bestD = 150 * 150;
      for (let i = 0; i < N; i++) {
        if (targets.includes(i)) continue;
        const d2 = (mx[i] - fromX) ** 2 + (my[i] - fromY) ** 2;
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      if (best < 0) break;
      targets.push(best);
      fromX = mx[best];
      fromY = my[best];
    }
    if (targets.length) {
      chains.push({ targets, age: 0 });
      for (const i of targets) {
        // Multi-target hits flash at ~0.75 so neighbouring struck monsters keep some detail instead of merging
        // into one white shape.
        mflash[i] = 0.75;
        r.emit({ x: mx[i], y: my[i] - 6, count: 10, color: C.lightning, colorEnd: C.storm, speed: [30, 110], life: [0.1, 0.3], size: [0.8, 1.2] });
      }
    }
  }
  for (let i = chains.length - 1; i >= 0; i--) if ((chains[i].age += dt) > 0.28) chains.splice(i, 1);

  // Periodic level-up flash.
  flashTimer += dt;
  if (flashTimer > 7) {
    flashTimer = 0;
    lastLevelUp = time;
    r.emit({ x: hero.x, y: hero.y - 10, count: 70, color: C.hot, colorEnd: C.gold, speed: [50, 140], life: [0.4, 0.9], size: [1, 1.5], drag: 0.8, light: 0 });
    r.emit({
      x: hero.x, y: hero.y, z: 4, count: 24, sprite: 'fx/ember', color: C.hot, colorEnd: C.gold, speed: [10, 50],
      upward: [100, 180], gravity: 240, life: [0.8, 1.4], size: [1, 1], sizeEnd: 0.5, light: 18,
    });
  }

  shake = Math.max(0, shake - dt * 10);
  // Camera: exponential follow, anchored to the hero's *snapped* position so the hero sprite never jitters
  // against the sub-pixel camera (see the camera notes in src/render/index.ts). Only the lag is fractional.
  const k = 1 - Math.exp(-5 * dt);
  follow.x += (hero.x - follow.x) * k;
  follow.y += (hero.y - 8 - follow.y) * k;
  camera.x = snapToPixel(hero.x, camera.zoom) + (follow.x - hero.x);
  camera.y = snapToPixel(hero.y, camera.zoom) + (follow.y - hero.y);
  camera.shakeX = (Math.random() - 0.5) * shake;
  camera.shakeY = (Math.random() - 0.5) * shake;

  if (STRESS) {
    // Keep the particle count near 3000 with a steady fountain spread over the view.
    const want = 3000 - r.stats().particles;
    for (let k = 0; k < Math.min(60, Math.max(0, want / 10)); k++) {
      r.emit({
        x: hero.x + range(-300, 300), y: hero.y + range(-170, 170), count: 10, color: C.hot, colorEnd: C.ember,
        speed: [10, 60], life: [0.6, 1.2], size: [0.8, 1.4],
      });
    }
  }
  r.updateParticles(dt);
}

// -------------------------------------------------------------------------------------------------------------
// Drawing
// -------------------------------------------------------------------------------------------------------------

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

function drawGround(): void {
  const halfW = r.viewWidth / 2 / camera.zoom + TILE;
  const halfH = r.viewHeight / 2 / camera.zoom + TILE;
  const tx0 = Math.floor((camera.x - halfW) / TILE);
  const tx1 = Math.ceil((camera.x + halfW) / TILE);
  const ty0 = Math.floor((camera.y - halfH) / TILE);
  const ty1 = Math.ceil((camera.y + halfH) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const cx = tx * TILE + TILE / 2;
      const cy = ty * TILE + TILE / 2;
      const d = Math.hypot(cx, cy / 0.8);
      if (d > ARENA) continue;
      const h = hash2(tx, ty);
      // Lava veins: thin bands of a low-frequency field, broken up by the tile hash.
      const vein = Math.sin(tx * 0.19 + 1.4 * Math.sin(ty * 0.12)) + Math.sin(ty * 0.23 - 0.8 * Math.sin(tx * 0.14));
      const lava = Math.abs(vein) < 0.035 && h % 100 < 55 && d < ARENA - 40;
      const variant = lava ? 8 + ((h >>> 8) % 4) : (h >>> 8) % 8;
      const edge = d > ARENA - 24;
      r.sprite('tile/test/floor', variant, tx * TILE, ty * TILE, { layer: 'ground', tint: edge ? [0.55, 0.5, 0.55] : undefined });
      const h2 = hash2(tx + 911, ty - 377);
      if (h2 % 100 < 6 && !edge) r.sprite('tile/test/detail', (h2 >>> 8) % 4, tx * TILE, ty * TILE, { layer: 'decal' });
    }
  }
}

function drawProps(): void {
  for (const p of props) {
    if (p.kind === 'pillar') {
      r.sprite('fx/shadow', 0, p.x, p.y, { layer: 'shadow', scaleX: 1.3, scaleY: 0.5 });
      r.sprite('prop/pillar', 0, p.x, p.y);
    } else if (p.kind === 'brazier') {
      r.sprite('fx/shadow', 0, p.x, p.y, { layer: 'shadow', scaleX: 1, scaleY: 0.4 });
      r.sprite('prop/brazier', Math.floor(time * 9 + p.phase), p.x, p.y);
      r.sprite('fx/glow', 0, p.x, p.y - 12, { layer: 'fx', additive: true, tint: C.flame, alpha: 0.35, scale: 1.2 });
      r.light(p.x, p.y - 10, 96, { color: C.flame, intensity: 1.05, flicker: 0.7 });
    } else {
      r.sprite('prop/crystal', 0, p.x, p.y);
      r.light(p.x, p.y - 8, 60, { color: C.frost, intensity: 0.55, flicker: 0.05 });
    }
  }
}

function drawPools(): void {
  for (const pool of pools) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 3 + pool.x);
    // Burning ground: scorched disc, a smouldering rim and a faint molten heart; the flames are particles.
    r.circle(pool.x, pool.y, pool.r + 3, { color: [0.02, 0.01, 0.01], alpha: 0.7 });
    r.circle(pool.x, pool.y, pool.r, { color: C.deepRed, alpha: 0.16 + 0.06 * pulse, emissive: 1, additive: true });
    r.circle(pool.x, pool.y, pool.r * 0.45, { color: C.ember, alpha: 0.1 + 0.06 * pulse, additive: true, emissive: 1 });
    r.ring(pool.x, pool.y, pool.r, { color: C.ember, alpha: 0.55, emissive: 1, thickness: 1 });
    r.light(pool.x, pool.y, pool.r * 2.6, { color: C.ember, intensity: 0.75, flicker: 0.6 });
  }
}

function drawTelegraphs(): void {
  for (const t of telegraphs) {
    if (t.age < 0) continue;
    const p = Math.min(1, t.age / t.duration);
    // Fills stay on the ground (under the horde); the danger rim and progress ring go on 'fx' so no monster
    // sprite can ever hide a lethal outline.
    r.circle(t.x, t.y, t.radius, { color: C.danger, alpha: 0.1, emissive: 0.4 });
    r.circle(t.x, t.y, t.radius, { color: C.danger, alpha: 0.22, emissive: 0.7, arc: p });
    r.ring(t.x, t.y, t.radius * p, { color: C.danger, alpha: 0.45, emissive: 0.8, additive: true, layer: 'fx' });
    r.ring(t.x, t.y, t.radius, { color: C.danger, alpha: 0.9, emissive: 0.9, additive: true, layer: 'fx' });
  }
}

function drawMonsters(): void {
  const t = time;
  for (let i = 0; i < N; i++) {
    const k = mkind[i];
    const x = mx[i];
    const y = my[i];
    r.sprite('fx/shadow', 0, x, y, { layer: 'shadow', scale: k === 2 ? 1.4 : k === 1 ? 0.7 : 0.9, scaleY: 0.45 });
    const rare = mrare[i];
    r.sprite(SPRITE[k], Math.floor(t * (k === 1 ? 14 : 8) + mphase[i]), x, y, {
      flipX: mvx[i] < 0,
      flash: mflash[i],
      outline: rare === 2 ? C.rare : rare === 1 ? C.magic : undefined,
    });
    if (rare === 2 && !STRESS) {
      r.text(RARE_NAMES[i % RARE_NAMES.length], x, y - (k === 2 ? 30 : 20), {
        color: C.rare, align: 'center', box: { color: C.plate, alpha: 0.7, padding: 2 },
      });
    }
  }
}

function drawHero(): void {
  const moving = Math.hypot(hero.vx, hero.vy) > 5;
  const dir = hero.facing === 'south' ? 'south' : 'east';
  const id = `hero/${moving ? 'run' : 'idle'}/${dir}`;
  const flip = hero.facing === 'west';
  r.sprite('fx/shadow', 0, hero.x, hero.y, { layer: 'shadow', scaleX: 1.1, scaleY: 0.45 });
  r.sprite(id, Math.floor(time * (moving ? 10 : 4)), hero.x, hero.y, { flipX: flip });
  const tipX = hero.x + (dir === 'south' ? -6 : flip ? -3 : 3);
  const tipY = hero.y - 22;
  r.light(tipX, tipY, 130, { color: C.flame, intensity: 1.15, flicker: 0.18 });
  r.light(hero.x, hero.y - 8, 50, { color: [0.8, 0.7, 0.9], intensity: 0.35 });
  r.sprite('fx/glow', 0, tipX, tipY, { layer: 'fx', additive: true, tint: C.flame, alpha: 0.5, scale: 0.7 });
}

function drawProjectiles(): void {
  for (const p of projectiles) {
    r.sprite('proj/lance', 0, p.x, p.y, { layer: 'fx', rotation: Math.atan2(p.vy, p.vx), sortY: p.y + 12 });
    r.light(p.x, p.y, 44, { color: C.flame, intensity: 0.9 });
  }
  for (const pu of pulses) {
    const k = 1 - pu.age / pu.life;
    r.light(pu.x, pu.y, pu.radius, { color: pu.color, intensity: 1.4 * k });
  }
}

function drawDrops(): void {
  for (const d of drops) {
    const bob = Math.round(Math.sin(time * 2.4 + d.x) * 1.2);
    r.sprite('fx/shadow', 0, d.x, d.y, { layer: 'shadow', scaleX: 0.8, scaleY: 0.35 });
    r.sprite(d.sprite, 0, d.x, d.y - 1 + bob, { tint: d.sprite === 'drop/currency' ? undefined : d.tone, emissive: 0.15 });
    if (d.beam) {
      const pulse = 0.6 + 0.4 * Math.sin(time * 4 + d.x);
      r.sprite('fx/beam', 0, d.x, d.y - 2, { layer: 'fx', additive: true, tint: d.tone, alpha: 0.55 * pulse, scaleX: 1, scaleY: 1.4 });
      r.light(d.x, d.y - 6, 40, { color: d.tone, intensity: 0.7 });
    }
    r.text(d.label, d.x, d.y - 16, {
      color: d.tone, align: 'center',
      box: { color: C.plate, alpha: 0.82, border: [d.tone[0] * 0.45, d.tone[1] * 0.45, d.tone[2] * 0.45], padding: 2 },
    });
  }
}

function drawNumbers(): void {
  for (const n of numbers) {
    const t = Math.min(1, n.age / 0.62);
    const rise = easeOutCubic(t) * 30;
    const alpha = n.age > 0.5 ? Math.max(0, 1 - (n.age - 0.5) / 0.25) : 1;
    r.text(n.text, n.x, n.y - rise, {
      color: n.crit ? [1, 0.86, 0.32] : [1, 0.66, 0.36], scale: n.crit ? 2 : 1, align: 'center', alpha,
    });
  }
}

function drawChains(): void {
  for (const c of chains) {
    const fade = 1 - c.age / 0.28;
    let x0 = hero.x;
    let y0 = hero.y - 22;
    for (const i of c.targets) {
      const x1 = mx[i];
      const y1 = my[i] - 7;
      // Jagged segments: midpoints displaced perpendicular to the bolt.
      const steps = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 12));
      let px = x0;
      let py = y0;
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const off = k === steps ? 0 : (Math.random() - 0.5) * 10;
        const nx = x0 + (x1 - x0) * t + off * -(y1 - y0) / Math.hypot(x1 - x0, y1 - y0);
        const ny = y0 + (y1 - y0) * t + off * (x1 - x0) / Math.hypot(x1 - x0, y1 - y0);
        r.line(px, py, nx, ny, { color: C.storm, alpha: 0.35 * fade, thickness: 3, layer: 'fx', additive: true });
        r.line(px, py, nx, ny, { color: C.lightning, alpha: fade, thickness: 1, layer: 'fx' });
        px = nx;
        py = ny;
      }
      r.light(x1, y1, 44, { color: C.storm, intensity: 0.8 * fade });
      x0 = x1;
      y0 = y1;
    }
  }
}

function drawHealthBars(): void {
  if (STRESS) return;
  for (let i = 0; i < N; i++) {
    if (mrare[i] !== 2) continue;
    const k = mkind[i];
    const top = my[i] - (k === 2 ? 25 : 16);
    const frac = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 0.7 + mphase[i]));
    r.rect(mx[i] - 11, top, 22, 3, { color: C.plate, alpha: 0.85, layer: 'top' });
    r.rect(mx[i] - 10, top + 1, Math.round(20 * frac), 1, { color: C.life, layer: 'top' });
  }
}

function drawLevelUp(): void {
  const t = time - lastLevelUp;
  if (t > 1.6) return;
  const k = Math.min(1, t / 0.45);
  r.ring(hero.x, hero.y - 4, 8 + easeOutCubic(k) * 60, { color: C.gold, alpha: 1 - k, additive: true, emissive: 1, thickness: 2, layer: 'fx' });
  r.light(hero.x, hero.y - 10, 160 * (1 - k * 0.5), { color: C.gold, intensity: 1.2 * (1 - k) });
  r.text('LEVEL UP', hero.x, hero.y - 44 - easeOutCubic(Math.min(1, t / 0.6)) * 8, {
    color: C.rare, scale: 2, align: 'center', alpha: t > 1.2 ? (1.6 - t) / 0.4 : 1,
    box: { color: C.plate, alpha: 0.75, border: C.gold, padding: 3 },
  });
}

function drawStressLights(): void {
  // 200 lights spread across the view (stress test).
  for (let i = 0; i < 200; i++) {
    const gx = (i % 20) / 19 - 0.5;
    const gy = Math.floor(i / 20) / 9 - 0.5;
    const c: RGB = i % 3 === 0 ? C.flame : i % 3 === 1 ? C.frost : C.voidGlow;
    r.light(hero.x + gx * 620, hero.y + gy * 340, 46, { color: c, intensity: 0.7, flicker: 0.4 });
  }
}

function postFx(): PostFx {
  const lt = time - lastLevelUp;
  const flash = lt < 0.45 ? { color: [1, 0.86, 0.55] as RGB, alpha: 0.22 * (1 - lt / 0.45) ** 2 } : undefined;
  return {
    bloom: 1,
    vignette: 0.55,
    saturation: DEAD ? 0.05 : 1,
    chromatic: lt < 0.35 ? 0.5 * (1 - lt / 0.35) : 0,
    exposure: 1,
    flash,
  };
}

/** Reference sheet: every primitive and option on a lit floor, with a fixed camera. */
function drawGallery(): void {
  const cam: Camera = { x: 0, y: 0, zoom: ZOOM };
  r.beginFrame({ camera: cam, ambient: [0.35, 0.32, 0.38], time, clearColor: [0.012, 0.008, 0.016] });
  for (let ty = -14; ty < 14; ty++) for (let tx = -22; tx < 22; tx++) r.sprite('tile/test/floor', (hash2(tx, ty) >>> 8) % 8, tx * TILE, ty * TILE, { layer: 'ground' });
  r.light(-200, -100, 160, { color: C.flame, intensity: 0.9 });
  r.light(200, 60, 180, { color: C.frost, intensity: 0.7 });
  const label = (s: string, x: number, y: number) => r.text(s, x, y, { color: C.parchment, align: 'center' });

  // Row 1: lines at many angles and thicknesses.
  label('line  t=1 / 2 / 3', -230, -150);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const t = 1 + (i % 3);
    r.line(-230, -110, -230 + Math.cos(a) * 30, -110 + Math.sin(a) * 30, { color: C.lightning, thickness: t, layer: 'fx' });
  }
  r.line(-300, -60, -160, -70, { color: C.storm, thickness: 3, additive: true, alpha: 0.5, layer: 'fx' });
  r.line(-300, -60, -160, -70, { color: C.lightning, thickness: 1, layer: 'fx' });
  r.line(-300, -50, -300, -50, { color: C.danger, thickness: 2, layer: 'fx' }); // zero length → dot

  // Row 1b: circles, rings, arcs.
  label('circle / ring / arc', -60, -150);
  r.circle(-100, -110, 16, { color: C.danger, alpha: 0.6 });
  r.ring(-60, -110, 16, { color: C.danger, thickness: 1, emissive: 1 });
  r.ring(-20, -110, 16, { color: C.gold, thickness: 3, emissive: 0.6 });
  for (let i = 0; i < 4; i++) {
    const arc = 0.25 * (i + 1);
    r.circle(-100 + i * 40, -65, 14, { color: C.danger, alpha: 0.12 });
    r.circle(-100 + i * 40, -65, 14, { color: C.danger, alpha: 0.35, arc, emissive: 0.6 });
    r.ring(-100 + i * 40, -65, 14, { color: C.danger, arc, emissive: 1 });
  }

  // Row 1c: rects + plates.
  label('rect / plate', 120, -150);
  r.rect(80, -125, 30, 12, { color: C.mana });
  r.rect(115, -125, 30, 12, { color: C.ember, additive: true, emissive: 1 });
  r.rect(150, -125, 22, 3, { color: C.plate, alpha: 0.85, layer: 'top' });
  r.rect(151, -124, 14, 1, { color: C.life, layer: 'top' });
  // A PoE-style label stack: uniform plate heights, spaced with plateHeight() + 1 px.
  const stack: [string, RGB][] = [['Ashwood Wand', C.rare], ['Kindling Shard', C.currency], ['Glassbone Wand', C.magic], ['Map: Rimed Ossuary', C.map]];
  stack.forEach(([s, tone], i) => r.text(s, 125, -100 + i * (plateHeight() + 1), {
    color: tone, align: 'center', box: { color: C.plate, alpha: 0.85, border: [tone[0] * 0.45, tone[1] * 0.45, tone[2] * 0.45], padding: 2 },
  }));
  r.text('Rare Plate', 225, -90, { color: C.rare, align: 'center', box: { color: [0.25, 0.1, 0.1], alpha: 1, padding: 2 } });
  r.text('Juggernaut', 225, -70, { color: C.rare, align: 'center', box: { color: [0.25, 0.1, 0.1], alpha: 1, padding: 2 } });
  r.text('gy', 280, -90, { color: C.rare, align: 'center', scale: 2, box: { color: [0.1, 0.25, 0.1], alpha: 1, padding: 2 } });
  r.text('AB', 280, -60, { color: C.rare, align: 'center', scale: 2, box: { color: [0.1, 0.25, 0.1], alpha: 1, padding: 2 } });

  // Row 2: text scales, alignment, glyph coverage.
  r.text('The quick brown fox jumps over the lazy dog 0123456789', -300, -20, { color: C.normal });
  r.text('ABCDEFGHIJKLMNOPQRSTUVWXYZ !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~', -300, -5, { color: C.normal });
  r.text('+42% fire (T1)', -300, 12, { color: C.flame, scale: 2 });
  r.text('1337', -80, 12, { color: C.rare, scale: 3 });
  r.text('left', 200, -20, { align: 'left', color: C.magic });
  r.text('center', 200, -8, { align: 'center', color: C.magic });
  r.text('right', 200, 4, { align: 'right', color: C.magic });
  r.line(200, -30, 200, 12, { color: C.danger, alpha: 0.5, layer: 'top' });
  r.text('no outline', 240, 16, { outline: null, color: C.hot });

  // Row 3: sprite options.
  const y3 = 90;
  const opts: [string, Parameters<Renderer['sprite']>[4]][] = [
    ['plain', {}],
    ['flipX', { flipX: true }],
    ['flash', { flash: 1 }],
    ['flash red', { flash: 0.7, flashColor: [1, 0.2, 0.2] }],
    ['outline', { outline: C.rare }],
    ['tint', { tint: [0.5, 0.8, 1] }],
    ['alpha .5', { alpha: 0.5 }],
    ['emissive .6', { emissive: 0.6 }],
    ['additive', { additive: true, emissive: 1 }],
    ['scale 2', { scale: 2 }],
    ['rot 30', { rotation: Math.PI / 6 }],
  ];
  opts.forEach(([name, o], i) => {
    const x = -270 + i * 54;
    r.sprite('fx/shadow', 0, x, y3, { layer: 'shadow', scaleX: 1.2, scaleY: 0.45 });
    r.sprite('mon/brute', Math.floor(time * 5), x, y3, o);
    label(name, x, y3 + 12);
  });
  r.sprite('proj/lance', 0, -250, 140, { layer: 'fx', rotation: time });
  r.sprite('proj/orb', 0, -220, 140, { layer: 'fx' });
  r.sprite('hero/idle/south', Math.floor(time * 4), -180, 150);
  r.sprite('hero/run/east', Math.floor(time * 10), -150, 150, { flipX: true });
  r.sprite('prop/brazier', Math.floor(time * 9), -110, 150);
  r.light(-110, 138, 70, { color: C.flame, intensity: 1, flicker: 0.7 });
  r.sprite('prop/pillar', 0, -70, 160);
  r.sprite('prop/crystal', 0, -30, 150);

  // Rotation strip: quarter turns must be exact pixel copies (9x9 orbs stay 9x9, half-pixel and integer anchors),
  // and a hair off zero must match zero.
  label('rot 0 / 90 / 180 / 270 / 1e-4', 160, 124);
  const quarter = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 1e-4];
  quarter.forEach((rot, i) => {
    const x = 40 + i * 22;
    r.sprite('proj/orb', 0, x, 142, { layer: 'fx', rotation: rot });
    r.sprite('proj/orb4', 0, x, 160, { layer: 'fx', rotation: rot });
    r.sprite('proj/lance', 0, x + 150, 142 + (i % 2) * 4, { layer: 'fx', rotation: rot });
  });
  r.endFrame({ bloom: 1, vignette: 0.4 });
}

function draw(): void {
  if (GALLERY) return drawGallery();
  r.beginFrame({ camera, ambient: [0.15, 0.125, 0.165], time, clearColor: [0.012, 0.008, 0.016] });
  const groups: [string, () => void][] = [
    ['ground', drawGround], ['pools', drawPools], ['telegraphs', drawTelegraphs], ['props', drawProps],
    ['drops', drawDrops], ['monsters', drawMonsters], ['hero', drawHero], ['projectiles', drawProjectiles],
    ['chains', drawChains], ['levelup', drawLevelUp], ['bars', drawHealthBars], ['numbers', drawNumbers],
  ];
  for (const [name, fn] of groups) if (!SKIP.has(name)) fn();
  if (SKIP.has('particles')) r.clearParticles();
  if (STRESS) drawStressLights();
  r.endFrame(postFx());
}

// -------------------------------------------------------------------------------------------------------------
// Loop + stats
// -------------------------------------------------------------------------------------------------------------

for (let t = 0; t < FAST_FORWARD; t += 1 / 60) step(1 / 60);

let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let fps = 0;
let simAvg = 0;
let renderAvg = 0;
let benchFrames = 0;
let benchRender = 0;

function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  const t0 = performance.now();
  if (!FREEZE) step(dt);
  const t1 = performance.now();
  draw();
  const t2 = performance.now();
  simAvg = simAvg * 0.95 + (t1 - t0) * 0.05;
  renderAvg = renderAvg * 0.95 + (t2 - t1) * 0.05;
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = fpsFrames / fpsTime;
    fpsFrames = 0;
    fpsTime = 0;
    const s = r.stats();
    statsEl.textContent =
      `${fps.toFixed(0)} fps · cpu: scene ${simAvg.toFixed(2)} ms, renderer ${renderAvg.toFixed(2)} ms\n` +
      `draws ${s.drawCalls} · sprites ${s.sprites} · particles ${s.particles} · lights ${s.lights}\n` +
      `view ${r.viewWidth}×${r.viewHeight} @${r.pixelScale}x`;
  }
  if (BENCH) {
    benchFrames++;
    if (benchFrames > 30) benchRender += t2 - t1;
    if (benchFrames === 150) {
      const s = r.stats();
      console.log(`[shot] bench renderer cpu/frame ${(benchRender / 120).toFixed(2)} ms · draws ${s.drawCalls} · sprites ${s.sprites} · particles ${s.particles} · lights ${s.lights} · view ${r.viewWidth}x${r.viewHeight}@${r.pixelScale}`);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Optional context-loss drill: lose the context, then restore it; rendering must resume.
const lostAfter = Number(params.get('lost') ?? 0);
if (lostAfter > 0) {
  const ext = (canvas.getContext('webgl2') as WebGL2RenderingContext).getExtension('WEBGL_lose_context');
  if (ext) {
    setTimeout(() => {
      ext.loseContext();
      console.log('[shot] context lost');
      setTimeout(() => {
        ext.restoreContext();
        console.log('[shot] context restored');
      }, 500);
    }, lostAfter);
  }
}
