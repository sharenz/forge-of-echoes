// Static world props: the hideout courtyard, deterministic themed map decor, the arena's ruined
// edge ring, and the walk-in interactions (hideout map portal, completion chest, return portal),
// checked for every living player.
//
// PropView.interactive marks what a click uses: the hideout's map device, stash, merchant and anvil
// (the Crafting Bench), plus the hideout map portal while it is open and the map's return portal.
import type { Theme } from '../contracts/content';
import type { PropCover, PropKind } from '../contracts/sim';
import { coverOf } from '../data/propCover';
import { livingIds } from './combat';
import {
  CHEST_TOUCH_PAD, DT, PLAYER_RADIUS, PORTAL_DWELL, PORTAL_ENTER_RADIUS, PORTAL_LATCH_RADIUS, RETURN_PORTAL_CLEARANCE,
  RETURN_PORTAL_DROP_CLEARANCE, RETURN_PORTAL_VIEW, RETURN_PORTAL_VIEW_WEIGHT,
} from './constants';
import { resolveProps } from './grid';
import { rollChestLoot } from './hooks';
import { spawnDrops } from './loot';
import { GOLDEN_ANGLE, TAU } from './math';
import type { PlayerState, Prop, World } from './world';

export function addProp(
  w: World, kind: PropKind, x: number, y: number, radius: number,
  opts: { variant?: number; interactive?: boolean; state?: number; cover?: PropCover } = {},
): Prop {
  const cover = coverOf(kind, radius, opts.cover);
  const prop: Prop = {
    id: w.nextPropId++,
    kind,
    x,
    y,
    radius,
    state: opts.state ?? 0,
    variant: opts.variant ?? 0,
    interactive: opts.interactive ?? false,
    solid: radius > 0,
    cover,
    tall: cover === 'tall',
  };
  w.props.push(prop);
  if (prop.solid) w.propGrid.insert(prop);
  return prop;
}

/** Ruined wall segments and broken pillars ringing the playable circle (decorative, outside it). */
export function edgeRing(w: World, spacing: number): void {
  const R = w.arenaRadius;
  const ringR = R + 12;
  const count = Math.max(12, Math.round((TAU * ringR) / spacing));
  for (let k = 0; k < count; k++) {
    const a = (k / count) * TAU;
    const pillar = k % 5 === 0;
    const r = pillar ? ringR + 4 : ringR;
    addProp(w, pillar ? 'pillar' : 'ruinWall', Math.cos(a) * r, Math.sin(a) * r, 0, {
      variant: pillar ? 3 : (k * 7 + (k >> 2)) % 4,
    });
  }
}

// --- hideout -----------------------------------------------------------------

/** Where players appear in the hideout (a step south of the courtyard centre). */
export function hideoutSpawn(R: number): { x: number; y: number } {
  return { x: 0, y: R * 0.12 };
}

export function hideoutDummyPosition(R: number): { x: number; y: number } {
  return { x: 0, y: R * 0.52 };
}

export function layoutHideout(w: World): void {
  const R = w.arenaRadius;
  // North: the map device, flanked by braziers with banners behind.
  addProp(w, 'mapDevice', 0, -R * 0.5, 20, { interactive: true });
  addProp(w, 'brazier', -R * 0.24, -R * 0.47, 7, { variant: 0 });
  addProp(w, 'brazier', R * 0.24, -R * 0.47, 7, { variant: 1 });
  addProp(w, 'banner', -R * 0.13, -R * 0.74, 0, { variant: 0 });
  addProp(w, 'banner', R * 0.13, -R * 0.74, 0, { variant: 1 });
  // West: the crafting corner — the stash, and the anvil (the Crafting Bench) a step south of it
  // towards the spawn, so the two stations used together sit together, on open ground off the
  // spawn → dummy line. East: Rook the merchant.
  addProp(w, 'stash', -R * 0.6, 0, 14, { interactive: true });
  addProp(w, 'anvil', -R * 0.5, R * 0.22, 10, { interactive: true });
  addProp(w, 'merchant', R * 0.6, 0, 12, { interactive: true });
  addProp(w, 'brazier', -R * 0.62, -R * 0.26, 7, { variant: 2 });
  addProp(w, 'brazier', R * 0.62, -R * 0.26, 7, { variant: 3 });
  addProp(w, 'banner', R * 0.72, R * 0.18, 0, { variant: 2 });
  addProp(w, 'brazier', -R * 0.3, R * 0.66, 7, { variant: 0 });
  addProp(w, 'brazier', R * 0.3, R * 0.66, 7, { variant: 1 });
  // A colonnade just inside the wall.
  const pillars = 14;
  for (let k = 0; k < pillars; k++) {
    const a = (k / pillars) * TAU + TAU / (pillars * 2);
    const x = Math.cos(a) * R * 0.86;
    const y = Math.sin(a) * R * 0.86;
    if (clearOf(w, x, y, 30)) addProp(w, 'pillar', x, y, 9, { variant: k % 3 });
  }
  // A little rubble and bone clutter near the walls.
  const rng = w.worldRng;
  for (let k = 0; k < 10; k++) {
    const a = rng.range(0, TAU);
    const r = R * rng.range(0.7, 0.92);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (clearOf(w, x, y, 18)) addProp(w, k % 3 === 0 ? 'bones' : 'rubble', x, y, 0, { variant: rng.int(0, 3) });
  }
  edgeRing(w, 40);
}

/**
 * Where the hideout map portal opens: beside the map device, to its south-east — off the straight
 * walk from the courtyard spawn up to the device, so nobody stumbles into a map (and spends one of
 * its portals) on the way there — and on open, walkable ground.
 */
function hideoutPortalSpot(w: World): { x: number; y: number } {
  const R = w.arenaRadius;
  const device = w.props.find((p) => p.kind === 'mapDevice');
  const x = device ? device.x + device.radius + 24 : R * 0.17;
  const y = device ? device.y + device.radius + 30 : -R * 0.31;
  return placeNear(w, x, y, PLAYER_RADIUS + 4, R);
}

/**
 * Hideout: show the map portal beside the map device with `remaining` uses (its state), or hide
 * it at 0. The prop is created on first use and then kept (stable id); reopening emits 'portal'
 * open again, and anyone standing where it opens has to step out and back in to use it.
 */
export function setHideoutPortal(w: World, remaining: number): void {
  if (w.config.mode !== 'hideout') return;
  const count = Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) : 0;
  let portal = w.portal;
  if (!portal) {
    if (count === 0) return;
    const spot = hideoutPortalSpot(w);
    portal = addProp(w, 'portal', spot.x, spot.y, 0, { state: 0 });
    w.portal = portal;
  }
  const wasOpen = portal.state > 0;
  portal.state = count;
  // Clickable (usePortal) exactly while it is open.
  portal.interactive = count > 0;
  if (count > 0 && !wasOpen) {
    latchPlayersOn(w, portal);
    w.events.push({ t: 'portal', playerId: 0, x: portal.x, y: portal.y, kind: 'open' });
  }
}

// --- maps ------------------------------------------------------------------------

interface DecorEntry {
  kind: PropKind;
  weight: number;
  radius: number;
}

const DECOR: Record<Theme, readonly DecorEntry[]> = {
  hideout: [],
  cinderChapel: [
    { kind: 'ruinWall', weight: 2, radius: 12 }, { kind: 'pillar', weight: 3, radius: 10 },
    { kind: 'brazier', weight: 3, radius: 7 }, { kind: 'bones', weight: 2, radius: 0 },
  ],
  choralCrypt: [
    { kind: 'bones', weight: 6, radius: 0 }, { kind: 'standingStone', weight: 3, radius: 9 },
    { kind: 'crystal', weight: 2, radius: 8 }, { kind: 'rubble', weight: 2, radius: 0 },
  ],
  chainworks: [
    { kind: 'pillar', weight: 3, radius: 10 }, { kind: 'brazier', weight: 2, radius: 7 },
    { kind: 'banner', weight: 3, radius: 0 }, { kind: 'rubble', weight: 4, radius: 0 },
  ],
  ashenForge: [
    { kind: 'pillar', weight: 3, radius: 10 },
    { kind: 'standingStone', weight: 3, radius: 9 },
    { kind: 'rubble', weight: 5, radius: 0 },
    { kind: 'bones', weight: 2, radius: 0 },
    { kind: 'brazier', weight: 2, radius: 7 },
  ],
  rimedOssuary: [
    { kind: 'crystal', weight: 5, radius: 8 },
    { kind: 'bones', weight: 5, radius: 0 },
    { kind: 'standingStone', weight: 2, radius: 9 },
    { kind: 'pillar', weight: 2, radius: 10 },
    { kind: 'rubble', weight: 2, radius: 0 },
    { kind: 'brazier', weight: 1, radius: 7 },
  ],
  ironColiseum: [
    { kind: 'pillar', weight: 4, radius: 10 },
    { kind: 'brazier', weight: 3, radius: 7 },
    { kind: 'rubble', weight: 4, radius: 0 },
    { kind: 'bones', weight: 1, radius: 0 },
    { kind: 'standingStone', weight: 1, radius: 9 },
    { kind: 'banner', weight: 2, radius: 0 },
  ],
};

/** Keep the start area open so the first seconds of a run are never blocked. */
const MAP_START_CLEAR = 140;

export function clearOf(w: World, x: number, y: number, gap: number): boolean {
  for (const p of w.props) {
    const dx = p.x - x;
    const dy = p.y - y;
    const r = p.radius + gap;
    if (dx * dx + dy * dy < r * r) return false;
  }
  return true;
}

export function layoutMap(w: World): void {
  const R = w.arenaRadius;
  const rng = w.worldRng;
  const theme = w.config.theme;
  const table = DECOR[theme].length > 0 ? DECOR[theme] : DECOR.ashenForge;

  // Theme set pieces first, so random scatter flows around them.
  if (theme === 'cinderChapel') {
    // Two ruined aisles, with wide passages and a clear arrival area.
    for (const side of [-1, 1]) for (let row = -2; row <= 2; row++) {
      const x = side * R * 0.3, y = row * R * 0.23;
      addProp(w, 'pillar', x, y, 10, { variant: (row + 2) % 4 });
      addProp(w, 'brazier', x + side * 35, y + 25, 7, { variant: (row + 2) % 4 });
    }
  } else if (theme === 'choralCrypt') {
    // A choir of standing tombstones around a broad, open nave.
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * TAU, x = Math.cos(a) * R * 0.55, y = Math.sin(a) * R * 0.55;
      addProp(w, 'standingStone', x, y, 9, { variant: k % 4 });
      addProp(w, 'bones', x + 18, y + 15, 0, { variant: k % 4 });
    }
  } else if (theme === 'chainworks') {
    // Parallel hauling lines, punctuated by torch-lit work stations.
    for (const side of [-1, 1]) for (let row = -2; row <= 2; row++) {
      const x = row * R * 0.23, y = side * R * 0.38;
      addProp(w, row % 2 === 0 ? 'pillar' : 'brazier', x, y, row % 2 === 0 ? 10 : 7, { variant: (row + 2) % 4 });
      addProp(w, 'banner', x, y + side * 25, 0, { variant: (row + 2) % 4 });
    }
  } else if (theme === 'ironColiseum') {
    // An inner colonnade of pillars alternating with torches.
    const n = 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const torch = k % 2 === 1;
      addProp(w, torch ? 'brazier' : 'pillar', Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6, torch ? 7 : 10, { variant: k % 4 });
    }
  } else if (theme === 'ashenForge') {
    // Ritual stone circles with a brazier at their heart.
    const circles = Math.max(2, Math.round(R / 300));
    for (let c = 0; c < circles; c++) {
      const a = (c / circles) * TAU + rng.range(0, 0.8);
      const r = rng.range(R * 0.35, R * 0.7);
      const cx = Math.cos(a) * r;
      const cy = Math.sin(a) * r;
      const stones = rng.int(5, 7);
      addProp(w, 'brazier', cx, cy, 7, { variant: c % 4 });
      for (let s = 0; s < stones; s++) {
        const sa = (s / stones) * TAU + rng.range(-0.15, 0.15);
        addProp(w, 'standingStone', cx + Math.cos(sa) * 56, cy + Math.sin(sa) * 56, 9, { variant: rng.int(0, 3) });
      }
    }
  } else if (theme === 'rimedOssuary') {
    // Crystal clusters growing out of bone piles.
    const clusters = Math.max(3, Math.round(R / 220));
    for (let c = 0; c < clusters; c++) {
      const a = (c / clusters) * TAU + rng.range(0, 1);
      const r = rng.range(R * 0.3, R * 0.8);
      const cx = Math.cos(a) * r;
      const cy = Math.sin(a) * r;
      const n = rng.int(3, 5);
      for (let s = 0; s < n; s++) {
        const sa = s * GOLDEN_ANGLE;
        const sr = 10 + 9 * Math.sqrt(s);
        addProp(w, 'crystal', cx + Math.cos(sa) * sr, cy + Math.sin(sa) * sr, s === 0 ? 8 : 6, { variant: rng.int(0, 3) });
      }
      addProp(w, 'bones', cx + rng.range(-24, 24), cy + 22, 0, { variant: rng.int(0, 3) });
    }
  }

  // Random scatter: roughly one prop per 16k square units.
  const count = Math.round((Math.PI * R * R) / 16000);
  const minR2 = MAP_START_CLEAR * MAP_START_CLEAR;
  const maxR = R - 30;
  for (let k = 0; k < count; k++) {
    const entry = rng.weighted(table, (e) => e.weight) ?? table[0];
    for (let attempt = 0; attempt < 10; attempt++) {
      const r = Math.sqrt(rng.range(minR2, maxR * maxR));
      const a = rng.range(0, TAU);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (!clearOf(w, x, y, entry.radius + 26)) continue;
      addProp(w, entry.kind, x, y, entry.radius, { variant: rng.int(0, 3) });
      // Solid pieces collect a little debris around their base.
      if (entry.radius > 0 && rng.chance(0.35)) {
        const debris = rng.int(1, 2);
        for (let d = 0; d < debris; d++) {
          const da = rng.range(0, TAU);
          const dr = entry.radius + rng.range(6, 16);
          addProp(w, rng.chance(0.7) ? 'rubble' : 'bones', x + Math.cos(da) * dr, y + Math.sin(da) * dr, 0, { variant: rng.int(0, 3) });
        }
      }
      break;
    }
  }
  edgeRing(w, 46);
}

/** After the boss: the reward chest and the return portal appear near (ax, ay) (a player). */
export function spawnClearRewards(w: World, ax: number, ay: number): void {
  const R = w.arenaRadius;
  const len = Math.hypot(ax, ay);
  // The chest a step towards the arena centre (or south when already there).
  const cx = len > 1 ? -ax / len : 0;
  const cy = len > 1 ? -ay / len : 1;
  const chest = placeNear(w, ax + cx * 56, ay + cy * 56, 12, R);
  addProp(w, 'chest', chest.x, chest.y, 10, { state: 0 });
  const spot = returnPortalSpot(w, ax, ay, -cy, cx, chest.x, chest.y);
  const portal = addProp(w, 'returnPortal', spot.x, spot.y, 0, { state: 1, interactive: true });
  latchPlayersOn(w, portal);
  w.events.push({ t: 'portal', playerId: 0, x: portal.x, y: portal.y, kind: 'open' });
}

const PORTAL_RINGS = [110, 130, 150, 170, 190] as const;
const PORTAL_BEARINGS = 24;

/**
 * The return portal: close to the player (on screen, preferably to the side) but clear of where
 * loot lands — the boss's fall and the chest, which both fountain loot, and every drop already on
 * the ground — so walking over your loot never brushes the way home. Candidates ring the anchor
 * (ax, ay), starting on its side (sx, sy). It must also be seen: a spot the open inventory (docked right) or the command
 * deck (bottom) would hide on the smallest supported screen gives up clearance for every unit it lies outside
 * RETURN_PORTAL_VIEW. The best score wins (clearance less that penalty), the nearest among equals.
 */
function returnPortalSpot(w: World, ax: number, ay: number, sx: number, sy: number, chestX: number, chestY: number): { x: number; y: number } {
  const lim = w.arenaRadius - 40;
  const d = w.director;
  const base = Math.atan2(sy, sx);
  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  let bestCost = Infinity;
  for (const r of PORTAL_RINGS) {
    for (let k = 0; k < PORTAL_BEARINGS; k++) {
      // 0, +1, −1, +2, −2 … steps around from the preferred side.
      const step = (k + 1) >> 1;
      const a = base + (k % 2 === 1 ? step : -step) * (TAU / PORTAL_BEARINGS);
      const x = ax + Math.cos(a) * r;
      const y = ay + Math.sin(a) * r;
      if (x * x + y * y > lim * lim) continue;
      if (resolveProps(w.propGrid, x, y, PORTAL_ENTER_RADIUS + 6).hit) continue;
      let clear = Math.min(1, Math.hypot(x - chestX, y - chestY) / RETURN_PORTAL_CLEARANCE);
      if (d.bossDefeated) clear = Math.min(clear, Math.hypot(x - d.bossDeathX, y - d.bossDeathY) / RETURN_PORTAL_CLEARANCE);
      for (const drop of w.drops) clear = Math.min(clear, Math.hypot(x - drop.x, y - drop.y) / RETURN_PORTAL_DROP_CLEARANCE);
      const score = clear - portalViewPenalty(x - ax, y - ay) * RETURN_PORTAL_VIEW_WEIGHT;
      // Nearer is better among equals, and a camera shows more width than height.
      const cost = r + Math.abs(y - ay) * 0.5;
      if (score > bestScore + 1e-9 || (score >= bestScore - 1e-9 && cost < bestCost)) {
        best = { x, y };
        bestScore = score;
        bestCost = cost;
      }
    }
  }
  // Nothing on the rings (walls everywhere): a step to the left, where no docked inventory covers it.
  return best ?? placeNear(w, ax - 96, ay, PORTAL_ENTER_RADIUS, w.arenaRadius);
}

/** World units an offset (dx, dy) from the player lies outside RETURN_PORTAL_VIEW, summed over both axes (0 = in view). */
export function portalViewPenalty(dx: number, dy: number): number {
  const v = RETURN_PORTAL_VIEW;
  return Math.max(0, v.left - dx, dx - v.right) + Math.max(0, v.top - dy, dy - v.bottom);
}

function placeNear(w: World, x: number, y: number, r: number, R: number): { x: number; y: number } {
  let px = x;
  let py = y;
  const lim = R - 40;
  const d = Math.hypot(px, py);
  if (d > lim) {
    px *= lim / d;
    py *= lim / d;
  }
  for (let k = 0; k < 3; k++) {
    const o = resolveProps(w.propGrid, px, py, r + 6);
    px = o.x;
    py = o.y;
  }
  return { x: px, y: py };
}

/** Anyone standing on a portal that just opened must step out and back in before it takes them. */
function latchPlayersOn(w: World, portal: Prop): void {
  for (const p of w.players) {
    if (Math.hypot(p.x - portal.x, p.y - portal.y) <= PORTAL_LATCH_RADIUS) {
      p.portalLatch = portal.id;
      p.portalDwellId = 0;
      p.portalDwell = 0;
    }
  }
}

/** A player arriving on an open portal (e.g. re-entering a cleared map) isn't sent straight back. */
export function latchPortalsUnder(w: World, p: PlayerState): void {
  for (const prop of w.props) {
    if ((prop.kind !== 'portal' && prop.kind !== 'returnPortal') || prop.state <= 0) continue;
    if (Math.hypot(p.x - prop.x, p.y - prop.y) <= PORTAL_LATCH_RADIUS) p.portalLatch = prop.id;
  }
}

/** Walk-in interactions for every living player, in join order, once per tick. */
export function updatePropInteractions(w: World): void {
  const living = w.living;
  for (let q = 0; q < living.length; q++) {
    const p = living[q];
    if (!p.dead) interact(w, p);
  }
}

function interact(w: World, p: PlayerState): void {
  // Leaving the portal you stood in re-arms it (a refused entry can be retried by stepping out).
  if (p.portalLatch !== 0) {
    const latched = w.props.find((pr) => pr.id === p.portalLatch);
    if (!latched || Math.hypot(p.x - latched.x, p.y - latched.y) > PORTAL_LATCH_RADIUS) p.portalLatch = 0;
  }
  let inside = 0;
  for (let k = 0; k < w.props.length; k++) {
    const prop = w.props[k];
    const kind = prop.kind;
    if (kind !== 'chest' && kind !== 'portal' && kind !== 'returnPortal') continue;
    const d = Math.hypot(p.x - prop.x, p.y - prop.y);
    if (kind === 'chest') {
      // The first player to touch the chest opens it for everyone: each living player gets their
      // own chest loot out of it. Opened first, then the hook: a failing roll still opens it.
      if (prop.state === 0 && d <= PLAYER_RADIUS + prop.radius + CHEST_TOUCH_PAD) {
        prop.state = 1;
        w.events.push({ t: 'chestOpen', x: prop.x, y: prop.y });
        w.outcomes.push({ t: 'chestOpened', playerId: p.id });
        const specs = rollChestLoot(w, livingIds(w));
        if (specs.length > 0) spawnDrops(w, specs, prop.x, prop.y - 2, true);
      }
      continue;
    }
    if (prop.state <= 0 || d > PORTAL_ENTER_RADIUS || p.portalLatch === prop.id) continue;
    // Standing in an open portal: it takes the player once they have stayed PORTAL_DWELL seconds
    // (brushing past, or picking up loot beside it, does nothing).
    inside = prop.id;
    if (p.portalDwellId !== prop.id) {
      p.portalDwellId = prop.id;
      p.portalDwell = 0;
    }
    p.portalDwell += DT;
    if (p.portalDwell < PORTAL_DWELL - 1e-6) continue;
    inside = 0;
    p.portalLatch = prop.id;
    w.events.push({ t: 'portal', playerId: p.id, x: prop.x, y: prop.y, kind: 'enter' });
    w.outcomes.push(kind === 'portal' ? { t: 'enterPortal', playerId: p.id } : { t: 'returnPortal', playerId: p.id });
  }
  if (inside === 0) {
    p.portalDwellId = 0;
    p.portalDwell = 0;
  }
}
