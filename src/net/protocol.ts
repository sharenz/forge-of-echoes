// Wire-level constants and enum tables for the binary snapshot format (see codec docs in snapshot.ts).
// Every string enum crosses the wire as its index in one of these tables; the tables are append-only.
import { FLASK_IDS, MONSTER_KINDS, SKILL_IDS, THEMES } from '../contracts/content';
import type { Theme } from '../contracts/content';
import { AREA_KINDS, PROJECTILE_KINDS } from '../contracts/sim';
import type { Dir4, DropSprite, DropTone, PlayerAnim, PropKind, RunPhase } from '../contracts/sim';

/**
 * First byte of every binary snapshot. Bump it whenever the byte layout OR the meaning of a field changes, even if
 * an older decoder could still parse the bytes. PROTOCOL_VERSION (frozen in contracts) does not move with it, so a
 * browser tab still running an older bundle after a deploy reconnects fine and then receives snapshots it rejects
 * (`snapshot version … != …`). After MAX_SNAPSHOT_FAILURES of those in a row, src/client/connection.ts ends the
 * session with 'reload' and the page reloads once (index.html is served no-cache, PROTOCOL_RELOAD_KEY stops loops).
 * That reload is what brings the new bundle. Never keep the number to "stay compatible": a stale bundle that still
 * decodes keeps running with a feature set that no longer matches the server.
 *
 * 3: drop records can be public (owner 0, anyone may pick them up by clicking) and carry the autoPickup bit.
 *    Version-2 clients have no click pickup, so they could never pick up equipment.
 */
export const SNAPSHOT_VERSION = 3;

/** Drop flag byte: tone in bits 0–2, sprite in bits 3–4, then these (bit 7 is spare). */
export const DROP_BLOCKED_BIT = 32;
export const DROP_AUTO_PICKUP_BIT = 64;

/** Entity positions travel as i16 offsets from the AOI origin in 1/POS_SCALE world units (±2048 units). */
export const POS_SCALE = 16;
/** Velocities of projectiles travel as i16 in 1/VEL_SCALE units per second (±4096 u/s). */
export const PROJ_VEL_SCALE = 8;
/** Player aim: i16 offset from the player in 1/AIM_SCALE units (±4096 units). */
export const AIM_SCALE = 8;
/** Radii of monsters/projectiles: u8 in 1/RADIUS_SCALE units (≤ 63.75). */
export const RADIUS_SCALE = 4;
/** Area radii: u16 in 1/AREA_RADIUS_SCALE units (≤ 8191). */
export const AREA_RADIUS_SCALE = 8;
/**
 * Sim-tick resolution for times that advance in whole ticks: monster anim times (u16, wrapping after ~18 min — only
 * the idle dummy lives that long), projectile ages (u8, or u16 past 4.25 s) and lobbed flight times (u8). Lossless.
 */
export const ANIM_TIME_SCALE = 60;

/**
 * Extra margin (world units) around AOI_HALF_WIDTH/HEIGHT. The AOI is already larger than the ~640×360 view, and
 * the margin keeps entities from popping at the edge while the (predicted) viewer runs ahead of the server.
 */
export const AOI_MARGIN = 64;

/** Hard caps per section (u8/u16 counts on the wire). */
export const MAX_WIRE_PLAYERS = 255;
export const MAX_WIRE_ENTITIES = 65535;
export const MAX_WIRE_AREAS = 255;
/**
 * Per snapshot: the viewer's own drops are written first, then public drops fill the rest, so a floor full of
 * dumped items can never hide your loot. Whenever a pass has more candidates in the AOI than it has room for, it
 * keeps the ones nearest to the viewer.
 */
export const MAX_WIRE_DROPS = 255;
/**
 * At most this many public drops (owner 0) per snapshot. Every record repeats its label and icon id (~70 B), and a
 * dumped stash tab would otherwise cost each viewer in the area ~300 KB/s. The item a friend just dropped at your
 * feet is always among the nearest.
 */
export const MAX_WIRE_PUBLIC_DROPS = 64;
export const MAX_WIRE_PROPS = 255;

export const DIR4_CODES = ['south', 'north', 'east', 'west'] as const satisfies readonly Dir4[];
export const PLAYER_ANIM_CODES = ['idle', 'run', 'cast', 'dash', 'hit', 'death'] as const satisfies readonly PlayerAnim[];
export const RUN_PHASE_CODES = ['hideout', 'tell', 'fight', 'boss', 'cleared', 'failed'] as const satisfies readonly RunPhase[];
export const DROP_TONE_CODES = ['normal', 'magic', 'rare', 'unique', 'currency', 'map', 'flask'] as const satisfies readonly DropTone[];
export const DROP_SPRITE_CODES = ['equipment', 'currency', 'map', 'flask'] as const satisfies readonly DropSprite[];
export const PROP_KIND_CODES = [
  'mapDevice', 'stash', 'merchant', 'portal', 'returnPortal', 'chest',
  'pillar', 'brazier', 'standingStone', 'rubble', 'bones', 'crystal', 'banner', 'anvil', 'ruinWall',
] as const satisfies readonly PropKind[];

// Compile-time exhaustiveness: every union member must have a code (a missing one fails to typecheck here).
type Covers<Union extends string, Table extends readonly string[]> = [Union] extends [Table[number]] ? true : never;
const COVERAGE: [
  Covers<Dir4, typeof DIR4_CODES>,
  Covers<PlayerAnim, typeof PLAYER_ANIM_CODES>,
  Covers<RunPhase, typeof RUN_PHASE_CODES>,
  Covers<DropTone, typeof DROP_TONE_CODES>,
  Covers<DropSprite, typeof DROP_SPRITE_CODES>,
  Covers<PropKind, typeof PROP_KIND_CODES>,
] = [true, true, true, true, true, true];
void COVERAGE;

/** Props whose presence/state is replicated in every snapshot (everything else is static zone data). */
export const DYNAMIC_PROP_KINDS: ReadonlySet<PropKind> = new Set<PropKind>(['chest', 'portal', 'returnPortal']);

export { AREA_KINDS, FLASK_IDS, MONSTER_KINDS, PROJECTILE_KINDS, SKILL_IDS, THEMES };

/** Build a string → code lookup for an enum table. */
function codeMap<T extends string>(table: readonly T[]): ReadonlyMap<T, number> {
  const m = new Map<T, number>();
  table.forEach((v, i) => m.set(v, i));
  return m;
}

export const DIR4_CODE = codeMap(DIR4_CODES);
export const PLAYER_ANIM_CODE = codeMap(PLAYER_ANIM_CODES);
export const RUN_PHASE_CODE = codeMap(RUN_PHASE_CODES);
export const DROP_TONE_CODE = codeMap(DROP_TONE_CODES);
export const DROP_SPRITE_CODE = codeMap(DROP_SPRITE_CODES);
export const PROP_KIND_CODE = codeMap(PROP_KIND_CODES);
export const THEME_CODE = codeMap<Theme>(THEMES);
export const SKILL_CODE = codeMap(SKILL_IDS);
export const FLASK_CODE = codeMap(FLASK_IDS);
export const AREA_KIND_CODE = codeMap(AREA_KINDS);
