// Calls out to the server's RunHooks. The sim always commits its own state *before* calling out
// and treats a hook that throws (or returns garbage) as "nothing happened" — no loot, pickup
// refused — so one bad roll can never corrupt the world or abort a tick halfway. Errors are kept
// for the server (drainHookErrors in index.ts); the first one per instance is also logged, so a
// server that never drains them still hears about it. Because a throwing tryPickup leaves the drop
// on the ground, that hook must commit last and never throw after granting (see tryPickup below).
import type { EventRewardContext } from '../contracts/map-events';
import type { DropSpec, KillLootContext } from '../contracts/sim';
import type { World } from './world';

/** At most this many errors are kept between drains (the count keeps going). */
const MAX_KEPT_ERRORS = 32;

export interface HookErrorLog {
  /** Oldest first, at most MAX_KEPT_ERRORS. */
  errors: unknown[];
  /** Errors since the instance was created (including the ones no longer kept). */
  total: number;
}

export function createHookErrorLog(): HookErrorLog {
  return { errors: [], total: 0 };
}

function report(w: World, hook: string, error: unknown): void {
  const log = w.hookErrors;
  log.total++;
  if (log.errors.length < MAX_KEPT_ERRORS) log.errors.push(error);
  if (log.total === 1) {
    console.error(`sim: RunHooks.${hook} failed; the sim carried on without it (later errors: drainHookErrors).`, error);
  }
}

/**
 * Keep only well-formed specs owned by one of `owners` (a spec for anyone else — including public,
 * owner 0 — could never be picked up by the players the loot was rolled for). A spec without a
 * boolean `autoPickup` is kept (never lose loot over it) with the rules' default for its sprite —
 * equipment is clicked, everything else is walked over — and reported.
 */
function sanitize(w: World, hook: string, specs: unknown, owners: readonly number[]): DropSpec[] {
  if (!Array.isArray(specs)) {
    report(w, hook, new TypeError(`${hook} returned ${specs === null ? 'null' : typeof specs}, expected DropSpec[]`));
    return [];
  }
  let bad = 0;
  let patched = 0;
  const out: DropSpec[] = [];
  for (const s of specs as unknown[]) {
    const spec = s as DropSpec | null;
    if (
      spec && typeof spec === 'object' && Number.isFinite(spec.token) && owners.includes(spec.owner) &&
      typeof spec.label === 'string' && typeof spec.tone === 'string' && typeof spec.sprite === 'string' &&
      typeof spec.iconId === 'string'
    ) {
      if (typeof spec.autoPickup === 'boolean') out.push(spec);
      else {
        patched++;
        out.push({ ...spec, autoPickup: spec.sprite !== 'equipment' });
      }
    } else bad++;
  }
  if (bad > 0) report(w, hook, new TypeError(`${hook} returned ${bad} malformed drop spec(s) (bad shape or owner not in the instance)`));
  if (patched > 0) {
    report(w, hook, new TypeError(`${hook} returned ${patched} drop spec(s) without a boolean autoPickup (defaulted: equipment is clicked, the rest walked over)`));
  }
  return out;
}

export function rollKillLoot(w: World, ctx: KillLootContext, playerIds: readonly number[]): DropSpec[] {
  let specs: unknown;
  try {
    specs = w.config.hooks.rollKillLoot(ctx, playerIds, w.lootRng);
  } catch (e) {
    report(w, 'rollKillLoot', e);
    return [];
  }
  return sanitize(w, 'rollKillLoot', specs, playerIds);
}

export function rollChestLoot(w: World, playerIds: readonly number[]): DropSpec[] {
  let specs: unknown;
  try {
    // The Wayside Anvil's boons ride along (absent = the ordinary chest).
    const boons = w.mapEvent?.boons ?? undefined;
    specs = boons ? w.config.hooks.rollChestLoot(playerIds, w.lootRng, boons) : w.config.hooks.rollChestLoot(playerIds, w.lootRng);
  } catch (e) {
    report(w, 'rollChestLoot', e);
    return [];
  }
  return sanitize(w, 'rollChestLoot', specs, playerIds);
}

/** A map event's payout for every player in `playerIds` (none when the server has no rollEventReward). */
export function rollEventRewardSpecs(w: World, ctx: EventRewardContext, playerIds: readonly number[]): DropSpec[] {
  const hook = w.config.hooks.rollEventReward;
  if (!hook) return [];
  let specs: unknown;
  try {
    specs = hook.call(w.config.hooks, ctx, playerIds, w.lootRng);
  } catch (e) {
    report(w, 'rollEventReward', e);
    return [];
  }
  return sanitize(w, 'rollEventReward', specs, playerIds);
}

/**
 * A throwing tryPickup counts as a refusal: the drop stays on the ground (blocked) and can be
 * clicked again. That makes the hook's contract strict — the server's tryPickup must be
 * all-or-nothing and COMMIT LAST:
 *   - check everything that can refuse (token known, eligible player, backpack room) first and
 *     return false without side effects;
 *   - then consume the token (delete it from the server's floor/loot table) together with the grant,
 *     so a second call for the same token can only ever answer false;
 *   - after the grant, never throw: wrap follow-ups (the immediate save of a public pickup, pushes to
 *     the client, logging) in try/catch and still return true.
 * A hook that throws AFTER granting would leave the item both in the backpack and on the floor — a
 * duplicate anyone can click again.
 */
export function tryPickup(w: World, playerId: number, token: number): boolean {
  try {
    return w.config.hooks.tryPickup(playerId, token) === true;
  } catch (e) {
    report(w, 'tryPickup', e);
    return false;
  }
}

/** Hand the collected errors to the caller and forget them. */
export function drainErrors(w: World): unknown[] {
  const out = w.hookErrors.errors;
  w.hookErrors.errors = [];
  return out;
}
