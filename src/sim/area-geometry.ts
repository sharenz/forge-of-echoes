// Area conventions shared by the sim, the presenter, client prediction and the test bot. Imports only the
// contracts, so `import … from 'src/sim/area-geometry'` pulls in nothing else (like ./movement).
//
// AreaView carries id, kind, x, y, radius, age and duration — and every one of them reaches the client
// (the net codec sends id as a full u32). The bestiary areas need a little more (a heading, a variant), so
// it is packed into the id:
//
//   id = seq · 1024 + variant · 256 + angleByte        (seq: 1, 2, 3 … per run, wrapping below 2^22)
//   areaAngle(a)   = angleByte · 2π / 256              (radians, 0 = +x/east, π/2 = +y/south; ±0.7°)
//   areaVariant(a) = variant (0..3)
//
// The sim quantises every heading to what the id carries and uses that same angle for its own hit tests,
// so what the presenter draws is exactly what hits. Per kind (see src/sim/areas.ts for behaviour):
//
//   chargeLine      a straight telegraph from (x, y) along areaAngle, length = radius, half-width
//                   CHARGE_LINE_HALF_WIDTH[variant] (0 = aim line: a thin, harmless laser; 1 = a charge
//                   lane; 2–3 wider lanes). `chargeLineEnd(a)` gives the far end.
//   choirWave       an expanding frost ring: radius is its CURRENT radius (the sim grows it), band
//                   half-width CHOIR_RING_HALF_WIDTH. It has variant + 1 gaps of ±CHOIR_GAP_HALF_ANGLE
//                   centred on areaAngle + k·2π/(variant + 1): walk through a gap. `choirGapAngles(a)`.
//   icePrison       a ring closing on a player: radius is its CURRENT radius, shrinking linearly from
//                   its start to ICE_PRISON_END_FRACTION of it at age = duration (`close` = age/duration
//                   for icePrisonShardFrame). Leaving the ring before it closes breaks it.
//   wispBurst       a pulse telegraph: at age = duration everyone within radius is chilled and everyone
//                   within radius·WISP_FREEZE_FRACTION (draw it as an inner ring) is frozen.
//   blizzard        a drifting storm: x/y move every tick. areaAngle = its drift heading AT SPAWN only
//                   (it bounces off the arena edge): draw motion from the x/y deltas between snapshots.
//   glacialSpike    one spike of a line (areaAngle = the line's heading, for the lean of the spike).
//   tarPool         slows by TAR_SLOW while a player's feet are inside; roots on first contact.
//   executionMark   follows its player until it locks (≈0.8 s before the strike), then stays put.
//   whirlwind       follows its monster; ticking damage.
//   frostNovaWarning, arenaSpikes, and every older kind: plain circles.
import type { AreaKind, AreaView } from '../contracts/sim';

const TAU = Math.PI * 2;

/** Heading resolution packed into an area id. */
export const AREA_ANGLE_STEPS = 256;
/** Area ids wrap their sequence below this (ids stay under 2^32). */
export const AREA_SEQ_LIMIT = 1 << 22;

/** The heading an area id can carry closest to `angle` (radians, in [0, 2π)). */
export function quantizeAreaAngle(angle: number): number {
  return angleByte(angle) * (TAU / AREA_ANGLE_STEPS);
}

function angleByte(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const b = Math.round((angle / TAU) * AREA_ANGLE_STEPS) % AREA_ANGLE_STEPS;
  return b < 0 ? b + AREA_ANGLE_STEPS : b;
}

/** Pack an area id (see the header). `seq` ≥ 1; `variant` 0..3. */
export function encodeAreaId(seq: number, angle: number, variant: number): number {
  const s = seq % AREA_SEQ_LIMIT;
  return s * 1024 + (variant & 3) * 256 + angleByte(angle);
}

/** Heading packed into an area's id (radians in [0, 2π)). */
export function areaAngle(a: Pick<AreaView, 'id'>): number {
  return (a.id & 255) * (TAU / AREA_ANGLE_STEPS);
}

/** Variant packed into an area's id (0..3). */
export function areaVariant(a: Pick<AreaView, 'id'>): number {
  return (a.id >>> 8) & 3;
}

// --- chargeLine ------------------------------------------------------------------------------------

/** Half-width of a chargeLine by variant: 0 aim line (harmless), 1 charge lane, 2–3 wide lanes. */
export const CHARGE_LINE_HALF_WIDTH: readonly number[] = [5, 16, 22, 30];

/** Far end of a chargeLine. */
export function chargeLineEnd(a: Pick<AreaView, 'id' | 'x' | 'y' | 'radius'>): { x: number; y: number } {
  const ang = areaAngle(a);
  return { x: a.x + Math.cos(ang) * a.radius, y: a.y + Math.sin(ang) * a.radius };
}

/** Whether a body of radius `pad` at (x, y) touches the chargeLine's lane (a capsule). */
export function inChargeLine(a: Pick<AreaView, 'id' | 'x' | 'y' | 'radius'>, x: number, y: number, pad: number): boolean {
  const ang = areaAngle(a);
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const rx = x - a.x;
  const ry = y - a.y;
  const along = rx * ux + ry * uy;
  const t = along < 0 ? 0 : along > a.radius ? a.radius : along;
  const px = rx - ux * t;
  const py = ry - uy * t;
  const hw = CHARGE_LINE_HALF_WIDTH[areaVariant(a)] + pad;
  return px * px + py * py <= hw * hw;
}

// --- choirWave -------------------------------------------------------------------------------------

/** Half-width of a choir ring's band (units). */
export const CHOIR_RING_HALF_WIDTH = 6;
/** Half-angle of each gap in a choir ring (radians). */
export const CHOIR_GAP_HALF_ANGLE = 0.3;

/** Gap centre angles of a choir ring. */
export function choirGapAngles(a: Pick<AreaView, 'id'>): number[] {
  const n = areaVariant(a) + 1;
  const base = areaAngle(a);
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(base + (k * TAU) / n);
  return out;
}

/** Whether direction `angle` (from the ring's centre) passes through one of its gaps. */
export function inChoirGap(a: Pick<AreaView, 'id'>, angle: number): boolean {
  const n = areaVariant(a) + 1;
  const base = areaAngle(a);
  const step = TAU / n;
  // Distance to the nearest gap centre, folded into [-step/2, step/2).
  let rel = (angle - base) % step;
  if (rel < 0) rel += step;
  if (rel > step / 2) rel -= step;
  return Math.abs(rel) <= CHOIR_GAP_HALF_ANGLE;
}

/** Whether a body of radius `pad` at (x, y) touches the ring's band outside its gaps. */
export function inChoirRing(a: Pick<AreaView, 'id' | 'x' | 'y' | 'radius'>, x: number, y: number, pad: number): boolean {
  const dx = x - a.x;
  const dy = y - a.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (Math.abs(d - a.radius) > CHOIR_RING_HALF_WIDTH + pad) return false;
  return !inChoirGap(a, Math.atan2(dy, dx));
}

// --- the rest ----------------------------------------------------------------------------------------

/** An ice prison closes to this share of its starting radius. */
export const ICE_PRISON_END_FRACTION = 0.2;
/** A glacial wisp's burst freezes everyone within this share of its radius (and chills the rest). */
export const WISP_FREEZE_FRACTION = 0.4;
/** Share of move speed lost while standing in tar. */
export const TAR_SLOW = 0.5;

/**
 * Whether a body of radius `pad` at (x, y) is inside an area (the shape its kind has: a lane for
 * chargeLine, a band with gaps for choirWave, a disc for everything else).
 */
export function areaContains(a: Pick<AreaView, 'id' | 'kind' | 'x' | 'y' | 'radius'>, x: number, y: number, pad: number): boolean {
  switch (a.kind as AreaKind) {
    case 'chargeLine':
      return inChargeLine(a, x, y, pad);
    case 'choirWave':
      return inChoirRing(a, x, y, pad);
    default: {
      const dx = x - a.x;
      const dy = y - a.y;
      const r = a.radius + pad;
      return dx * dx + dy * dy <= r * r;
    }
  }
}

/**
 * Ground slow at a player's feet (x, y): TAR_SLOW inside any tarPool, else 0. Part of the movement
 * rules the client predicts with (see movement.ts `playerSlow`).
 */
export function areaSlowAt(areas: readonly Pick<AreaView, 'kind' | 'x' | 'y' | 'radius'>[], x: number, y: number): number {
  for (let k = 0; k < areas.length; k++) {
    const a = areas[k];
    if (a.kind !== 'tarPool') continue;
    const dx = x - a.x;
    const dy = y - a.y;
    if (dx * dx + dy * dy <= a.radius * a.radius) return TAR_SLOW;
  }
  return 0;
}
