// Daily surge (brief D section 7, slice G1). Pure rules: the server clock is always an argument (`now`, ms), never read here.
//
//   forgeDay(now)            the forge day index: it turns over at 04:00 UTC (SURGE_RESET_UTC_HOUR), no time zones, no DST
//   surgeStatus(...)         charges of one area for the UI and the rules: max (3 + tree), spent, remaining, time to the reset
//   spendSurge(...)          at activation: spend one charge of the run's area (or keep it, Afterglow) and describe the run's surge
//   refundSurge(...)         the server-loss refund of an expedition's charge (ordinary deaths and abandons refund nothing)
//   refillSurge(...)         Hourglass Sand (one area) and the Grand Hourglass (all areas); refused when nothing is spent
//
// The ledger lives on the account's Atlas (`atlas.surge`), so every character of an account shares it and an alt gains
// nothing. It resets lazily: a stored day before today counts as an empty ledger, so no scheduler exists and a restart across
// the boundary cannot matter. A stored day AFTER today (the server clock stepped back) is kept: time never grants charges.
import type { AtlasAreaId, AtlasProgress, AtlasSurge, MapTreeNodeId } from '../../contracts/atlas';
import type { CharacterSave } from '../../contracts/items';
import type { Result, RunSetup } from '../../contracts/game';
import { createRng, hashU32 } from '../../core/rng';
import { ATLAS_AREAS, findAtlasArea } from '../../data/progression/atlas';
import { atlasNodeAllocatable, mapTreeNodes } from '../../data/progression/map-tree';
import { SURGE_BONUS, SURGE_CHARGES, SURGE_DAY_MS, SURGE_MAX_CHARGES, SURGE_RESET_UTC_HOUR } from '../../data/progression/territory';
import { spendCurrency } from './merchant';
import { tideCharges } from './territory';
import { fail, ok } from './util';

const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------------------------

/** Forge-day index of a server time (ms since the epoch): `floor((now - 4 h) / 24 h)`. */
export function forgeDay(now: number): number {
  return Math.floor((now - SURGE_RESET_UTC_HOUR * HOUR_MS) / SURGE_DAY_MS);
}

/** Server time (ms) at which forge day `day` starts. */
export function forgeDayStart(day: number): number {
  return day * SURGE_DAY_MS + SURGE_RESET_UTC_HOUR * HOUR_MS;
}

/** Index of the `hours`-long slice of the forge clock containing `now` (slices start at the 04:00 UTC anchor; `hours` divides 24). */
export function forgeRotation(now: number, hours: number): number {
  return Math.floor((now - SURGE_RESET_UTC_HOUR * HOUR_MS) / (hours * HOUR_MS));
}

/** Server time (ms) at which forge rotation `index` (of `hours`-long slices) starts. */
export function forgeRotationStart(index: number, hours: number): number {
  return index * hours * HOUR_MS + SURGE_RESET_UTC_HOUR * HOUR_MS;
}

/** Milliseconds until the next reset (always in (0, 24 h]). */
export function msUntilReset(now: number): number {
  return forgeDayStart(forgeDay(now) + 1) - now;
}

/** "3 h 12 m", "42 m", "under a minute": the countdown text of the dock chip and the rail. */
export function resetCountdownText(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  if (minutes <= 0) return 'under a minute';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}

// ---------------------------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------------------------

const isDeadOrSealed = (areaId: AtlasAreaId | undefined): boolean => {
  const area = findAtlasArea(areaId);
  return !!area && (area.deadEnd === true || area.sealed === true);
};

/**
 * Charges an area holds per day: 3 plus the tree (Second Wind +1 everywhere, Lamp Oil +1 on dead-end and sealed areas) plus `extra`
 * (a covering Bright or Blazing Tide sigil, brief D 6.3: `tideCharges`).
 */
export function surgeMaxCharges(areaId: AtlasAreaId, nodes: readonly MapTreeNodeId[] | undefined, extra = 0): number {
  const dead = isDeadOrSealed(areaId);
  for (const node of mapTreeNodes(nodes ?? []).filter(atlasNodeAllocatable)) {
    for (const e of node.effects) {
      if (e.stat !== 'surgeCharges') continue;
      if (e.when?.area && (e.when.area === 'deadEnd') !== dead) continue;
      extra += e.value;
    }
  }
  return Math.max(0, Math.min(SURGE_MAX_CHARGES, SURGE_CHARGES + Math.floor(extra)));
}

/**
 * Chances (0..1) that a spent charge is not consumed, each rolled on its own stream: Afterglow (tree) first, then a Blazing Tide sigil
 * (`tideKeep`, brief D 7.5). Afterglow keeps index 0 whether or not a Tide roll follows, so adding a sigil never moves its roll.
 */
export function surgeKeepChances(nodes: readonly MapTreeNodeId[] | undefined, tideKeep = 0): number[] {
  const afterglow = mapTreeNodes(nodes ?? []).filter(atlasNodeAllocatable)
    .flatMap(n => n.effects).filter(e => e.stat === 'surgeKeep').reduce((n, e) => n + e.value, 0);
  const own = Math.min(1, Math.max(0, afterglow / 100));
  if (tideKeep > 0) return [own, Math.min(1, tideKeep)];
  return own > 0 ? [own] : [];
}

/** Whether the charge survives: each chance is rolled independently from the map seed, any success keeps it. */
export function surgeKept(seed: number, chances: readonly number[]): boolean {
  let kept = false;
  chances.forEach((p, i) => {
    // One independent stream per source, so adding a source never moves another's roll.
    const roll = createRng(hashU32(((seed >>> 0) ^ Math.imul(0x41f7e1, i + 1)) >>> 0)).next();
    if (roll < p) kept = true;
  });
  return kept;
}

/** The bonus a spent charge gives (the tree may scale it later; today it is the constant). */
export function surgeBonusFor(_atlas?: AtlasProgress, multiplier = 1): { quantityMore: number; rarityMore: number } {
  const m = Math.max(1, multiplier);
  return { quantityMore: Math.round(SURGE_BONUS.quantityMore * m * 100) / 100, rarityMore: Math.round(SURGE_BONUS.rarityMore * m * 100) / 100 };
}

/** The ledger as it stands at `now`: today's, or an empty one when the stored day is before today. */
export function surgeLedgerAt(atlas: Pick<AtlasProgress, 'surge'> | undefined, now: number): AtlasSurge {
  const today = forgeDay(now);
  const stored = atlas?.surge;
  if (stored && stored.day >= today) return stored;
  return { day: today, spent: {} };
}

export interface SurgeStatus {
  areaId: AtlasAreaId;
  max: number;
  spent: number;
  remaining: number;
  day: number;
  /** Milliseconds to the next reset. */
  resetsInMs: number;
}

/** The Atlas fields the surge reads: the ledger and the tree, and (for Tide sigils) the beacons. */
export type SurgeAtlas = Pick<AtlasProgress, 'surge' | 'nodes'> & Partial<Pick<AtlasProgress, 'beacons' | 'completed'>>;

/** Tide charges covering `areaId` (0 without beacons). */
function tideExtra(atlas: SurgeAtlas | undefined, areaId: AtlasAreaId): number {
  return atlas?.beacons ? tideCharges({ completed: atlas.completed ?? [], beacons: atlas.beacons, ...(atlas.nodes ? { nodes: atlas.nodes } : {}) }, areaId) : 0;
}

export function surgeStatus(atlas: SurgeAtlas | undefined, areaId: AtlasAreaId, now: number): SurgeStatus {
  const ledger = surgeLedgerAt(atlas, now);
  const max = surgeMaxCharges(areaId, atlas?.nodes, tideExtra(atlas, areaId));
  const spent = Math.max(0, Math.min(max, Math.floor(ledger.spent[areaId] ?? 0)));
  return { areaId, max, spent, remaining: Math.max(0, max - spent), day: ledger.day, resetsInMs: msUntilReset(now) };
}

/** Every area's status (the chart draws pips on every node). */
export function surgeStatusAll(atlas: SurgeAtlas | undefined, now: number): Record<AtlasAreaId, SurgeStatus> {
  return Object.fromEntries(ATLAS_AREAS.map(a => [a.id, surgeStatus(atlas, a.id, now)])) as Record<AtlasAreaId, SurgeStatus>;
}

// ---------------------------------------------------------------------------------------------
// Spending and refunding
// ---------------------------------------------------------------------------------------------

export interface SurgeSpend {
  atlas: AtlasProgress;
  /** Frozen into `RunSetup.surge`. */
  surge: NonNullable<RunSetup['surge']>;
}

/**
 * Spend one charge of `areaId` (the area actually run, passage destinations included) at activation. Undefined when the area has
 * no charge left: the run is then simply normal. `seed` is the map seed (Afterglow's roll): a kept charge still gives the bonus.
 */
export function spendSurge(base: AtlasProgress, areaId: AtlasAreaId, now: number, seed: number, tide: { bonusMultiplier?: number; keepChance?: number } = {}): SurgeSpend | undefined {
  const status = surgeStatus(base, areaId, now);
  if (status.remaining < 1) return undefined;
  const kept = surgeKept(seed, surgeKeepChances(base.nodes, tide.keepChance ?? 0));
  const bonus = surgeBonusFor(base, tide.bonusMultiplier ?? 1);
  const surge: SurgeSpend['surge'] = { areaId, ...bonus, day: status.day, ...(kept ? { kept: true as const } : {}) };
  if (kept) return { atlas: base, surge };
  const ledger = surgeLedgerAt(base, now);
  return { atlas: { ...base, surge: { day: ledger.day, spent: { ...ledger.spent, [areaId]: status.spent + 1 } } }, surge };
}

/**
 * Give back the charge an unrestorable expedition spent (D 7.2: only a server failure refunds). Exact: nothing when the charge was
 * kept by Afterglow, when the forge day has since turned over (the new day's charges are full anyway) or when nothing is recorded.
 */
export function refundSurge(atlas: AtlasProgress | undefined, surge: RunSetup['surge'] | undefined, now: number): AtlasProgress | undefined {
  if (!atlas || !surge || surge.kept) return atlas;
  const ledger = atlas.surge;
  if (!ledger || ledger.day !== surge.day || forgeDay(now) !== surge.day) return atlas;
  const spent = ledger.spent[surge.areaId] ?? 0;
  if (spent < 1) return atlas;
  const next = { ...ledger.spent, [surge.areaId]: spent - 1 };
  if (next[surge.areaId] === 0) delete next[surge.areaId];
  return { ...atlas, surge: { day: ledger.day, spent: next } };
}

// ---------------------------------------------------------------------------------------------
// Hourglass Sand and the Grand Hourglass (D 7.4)
// ---------------------------------------------------------------------------------------------

export type SurgeRefill = { kind: 'area'; areaId: AtlasAreaId } | { kind: 'all' };

/**
 * Use one Hourglass Sand on an area or one Grand Hourglass on the whole chart: the item is taken from the inventory or stash and the
 * ledger is reset. Refused (nothing spent) when the area (or, for the Grand Hourglass, every area) already has all its charges.
 * Sand needs a discovered area, like every other Atlas action.
 */
export function refillSurge(ch: CharacterSave, target: SurgeRefill, now: number): Result<{ character: CharacterSave; message: string }> {
  const atlas = ch.atlas;
  if (!atlas) return fail('Chart an area on the Atlas first.');
  const ledger = surgeLedgerAt(atlas, now);
  if (target.kind === 'area') {
    const area = findAtlasArea(target.areaId);
    if (!area) return fail('Choose an area on the Atlas.');
    if (!atlas.discovered.includes(area.id)) return fail('That part of the Atlas has not been revealed yet.');
    const status = surgeStatus(atlas, area.id, now);
    if (status.spent < 1) return fail(`${area.name} already has all ${status.max} surge charges.`);
    const paid = spendCurrency(ch, 'hourglassSand', 1);
    if (!paid) return fail('You have no Hourglass Sand in your inventory or stash.');
    const spent = { ...ledger.spent };
    delete spent[area.id];
    return ok({ character: { ...paid, atlas: { ...atlas, surge: { day: ledger.day, spent } } }, message: `${area.name} is fully charged: ${status.max} surge charges.` });
  }
  const anySpent = ATLAS_AREAS.some(a => surgeStatus(atlas, a.id, now).spent > 0);
  if (!anySpent) return fail('Every area already has all its surge charges.');
  const paid = spendCurrency(ch, 'grandHourglass', 1);
  if (!paid) return fail('You have no Grand Hourglass in your inventory or stash.');
  return ok({ character: { ...paid, atlas: { ...atlas, surge: { day: ledger.day, spent: {} } } }, message: 'Every area is fully charged.' });
}

// ---------------------------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------------------------

/** A persisted ledger back to a valid one (unknown areas and bad numbers dropped, charges clamped); undefined when nothing is recorded. */
export function normalizeSurge(raw: unknown, nodes?: readonly MapTreeNodeId[], extraFor: (areaId: AtlasAreaId) => number = () => 0): AtlasSurge | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value.day !== 'number' || !Number.isInteger(value.day) || Math.abs(value.day) > 1e7) return undefined;
  const spent: AtlasSurge['spent'] = {};
  if (typeof value.spent === 'object' && value.spent !== null && !Array.isArray(value.spent)) {
    for (const [id, n] of Object.entries(value.spent as Record<string, unknown>)) {
      const area = findAtlasArea(id);
      if (!area || typeof n !== 'number' || !Number.isFinite(n)) continue;
      const count = Math.max(0, Math.min(surgeMaxCharges(area.id, nodes, extraFor(area.id)), Math.floor(n)));
      if (count > 0) spent[area.id] = count;
    }
  }
  return { day: value.day, spent };
}

/** Freeze `surge` into a run setup and add its readout line (used by openMap and by restoreRunSetup, so both show the same). */
export function attachSurge(setup: RunSetup, surge: NonNullable<RunSetup['surge']>): void {
  setup.surge = surge;
  const area = findAtlasArea(surge.areaId);
  setup.summary.push({
    label: 'Surge',
    value: `+${surge.quantityMore}% quantity, +${surge.rarityMore}% rarity`,
    breakdown: [
      `${surge.quantityMore}% more item quantity, except for maps: surge never changes how many maps drop`,
      `${surge.rarityMore}% more item rarity`,
      `${area?.name ?? 'This area'}'s daily charge is spent by the opener${surge.kept ? '; Afterglow kept it' : ''}; guests share the bonus and spend nothing`,
      'Not applied to boss and chest guarantees, encounter rewards or the Hunting Ground class roll',
    ],
  });
}

/**
 * The activation banner for a surged run (brief D 7.6, slice F1): what it gives and what is left of the area's day, read from the
 * opener's ledger after the spend. Said once with the opening (the server's activation toast).
 */
export function surgeNotice(surge: NonNullable<RunSetup['surge']>, atlasAfter: SurgeAtlas | undefined, now: number): string {
  const area = findAtlasArea(surge.areaId);
  const st = surgeStatus(atlasAfter, surge.areaId, now);
  const left = surge.kept ? `Afterglow kept the charge: ${st.remaining} of ${st.max} left` : `${st.remaining} of ${st.max} charge${st.max === 1 ? '' : 's'} left`;
  return `Surge: +${surge.quantityMore}% item quantity, +${surge.rarityMore}% item rarity. ${left} in ${area?.name ?? 'this area'} today.`;
}

/** The persisted summary of a run's surge (`restoreRunSetup`): undefined when absent or invalid. */
export function normalizeRunSurge(raw: unknown): RunSetup['surge'] | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const v = raw as Record<string, unknown>;
  const area = findAtlasArea(v.areaId);
  if (!area || typeof v.day !== 'number' || !Number.isInteger(v.day)) return undefined;
  const num = (x: unknown, hi: number): number => typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(hi, x)) : 0;
  const quantityMore = num(v.quantityMore, 200), rarityMore = num(v.rarityMore, 200);
  if (quantityMore === 0 && rarityMore === 0) return undefined;
  return { areaId: area.id, quantityMore, rarityMore, day: v.day, ...(v.kept === true ? { kept: true as const } : {}) };
}
