// The first-run guide's account state (contracts/guide.ts): normalising it from storage, deciding it once for an account
// that has none (the veteran rule), and applying the `guide` command's operations. Pure and total: never throws, never
// reads the clock (callers pass `now`), and an unknown or garbage field is dropped, never trusted. Optional on
// CharacterSave like `atlas?`/`craftSlot?`, so no SAVE_VERSION bump: absent means "decide at load".
import type { CharacterSave } from '../../contracts/items';
import type { GuideCommand, GuideHintId, GuideProp, GuideState, GuideStepId } from '../../contracts/guide';
import { GUIDE_HINT_IDS, GUIDE_PROPS, GUIDE_STEP_IDS, GUIDE_VETERAN_LEVEL } from '../../contracts/guide';
import { finite } from './util';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whitelisted ids of `raw`, de-duplicated, in the whitelist's order. */
function idsOf<T extends string>(raw: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<unknown>(raw);
  return allowed.filter((id) => set.has(id));
}

/** A fresh, active guide (a brand-new account). */
export function newGuide(): GuideState {
  return { v: 1, mode: 'active', done: [], hints: [] };
}

/** A guide that never shows anything (the veteran rule, or the player's own skip). */
export function skippedGuide(by: 'player' | 'veteran', now?: number): GuideState {
  return {
    v: 1, mode: 'skipped', skippedBy: by, done: [], hints: [...GUIDE_HINT_IDS],
    ...(now !== undefined ? { finishedAt: now } : {}),
  };
}

/**
 * The stored guide, repaired. Returns undefined for anything that is not a recognisable guide (the server then decides
 * a fresh one at the next load): unknown ids are dropped, lists de-duplicated and capped, timestamps clamped.
 */
export function normalizeGuide(raw: unknown): GuideState | undefined {
  if (!isObj(raw)) return undefined;
  const mode = raw.mode === 'active' || raw.mode === 'skipped' || raw.mode === 'done' ? raw.mode : null;
  if (!mode) return undefined;
  const done = idsOf(raw.done, GUIDE_STEP_IDS);
  const hints = idsOf(raw.hints, GUIDE_HINT_IDS);
  const used = idsOf(raw.used, GUIDE_PROPS);
  const t: Partial<Record<GuideStepId, number>> = {};
  if (isObj(raw.t)) for (const id of GUIDE_STEP_IDS) {
    const v = raw.t[id];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) t[id] = Math.floor(v);
  }
  const startedAt = finite(raw.startedAt, 0);
  const finishedAt = finite(raw.finishedAt, 0);
  const replays = Math.min(99, Math.max(0, Math.floor(finite(raw.replays, 0))));
  return {
    v: 1,
    mode,
    ...(mode === 'skipped' ? { skippedBy: raw.skippedBy === 'veteran' ? 'veteran' as const : 'player' as const } : {}),
    done,
    hints,
    ...(used.length ? { used } : {}),
    ...(Object.keys(t).length ? { t } : {}),
    ...(startedAt > 0 ? { startedAt: Math.floor(startedAt) } : {}),
    ...(finishedAt > 0 ? { finishedAt: Math.floor(finishedAt) } : {}),
    ...(replays > 0 ? { replays } : {}),
    ...(raw.warmed === true ? { warmed: true as const } : {}),
  };
}

/** What the veteran rule looks at: every character of the account and its Atlas. */
export interface GuideEvidence {
  characters: readonly Pick<CharacterSave, 'level' | 'stats'>[];
  atlas?: { clears?: number; completed?: readonly unknown[] } | null;
}

/** A veteran has played before: a character at the veteran level, a completed map, or an Atlas clear. */
export function isVeteran(e: GuideEvidence): boolean {
  if (e.characters.some((c) => c.level >= GUIDE_VETERAN_LEVEL || (c.stats?.mapsCompleted ?? 0) > 0)) return true;
  return (e.atlas?.clears ?? 0) > 0 || (e.atlas?.completed?.length ?? 0) > 0;
}

/**
 * The guide of an account that has none stored (an old account at its first load after this release, a brand-new one):
 * veterans are skipped for good, everyone else starts active.
 */
export function decideGuide(e: GuideEvidence, now?: number): GuideState {
  return isVeteran(e) ? skippedGuide('veteran', now) : { ...newGuide(), ...(now !== undefined ? { startedAt: now } : {}) };
}

/**
 * Re-check an ACTIVE guide when another character joins the account: a second character on an account that already
 * has a veteran flips it to skipped (a player who is back does not need the tutorial again).
 */
export function recheckGuide(g: GuideState, e: GuideEvidence, now?: number): GuideState {
  return g.mode === 'active' && isVeteran(e) ? skippedGuide('veteran', now) : g;
}

/** The result of a `guide` command: the next state, or null when nothing changed. */
export function applyGuideOp(g: GuideState, cmd: GuideCommand, now: number): GuideState | null {
  switch (cmd.op) {
    case 'done': {
      if (!(GUIDE_STEP_IDS as readonly string[]).includes(cmd.id) || g.done.includes(cmd.id)) return null;
      const done = GUIDE_STEP_IDS.filter((id) => id === cmd.id || g.done.includes(id));
      return { ...g, done, t: { ...g.t, [cmd.id]: now }, ...(g.startedAt ? {} : { startedAt: now }) };
    }
    case 'hint': {
      if (!(GUIDE_HINT_IDS as readonly string[]).includes(cmd.id) || g.hints.includes(cmd.id)) return null;
      return { ...g, hints: GUIDE_HINT_IDS.filter((id) => id === cmd.id || g.hints.includes(id)) };
    }
    case 'used': {
      if (!(GUIDE_PROPS as readonly string[]).includes(cmd.id) || g.used?.includes(cmd.id)) return null;
      return { ...g, used: GUIDE_PROPS.filter((id) => id === cmd.id || g.used?.includes(id)) };
    }
    case 'skip':
      if (g.mode === 'skipped' && g.skippedBy === 'player') return null;
      return { ...g, mode: 'skipped', skippedBy: 'player', finishedAt: now };
    case 'finish':
      if (g.mode !== 'active') return null;
      return { ...g, mode: 'done', finishedAt: now };
    case 'replay': {
      const { skippedBy: _by, finishedAt: _end, t: _t, warmed, ...rest } = g;
      return { ...rest, v: 1, mode: 'active', done: [], hints: [], used: [], startedAt: now, replays: Math.min(99, (g.replays ?? 0) + 1), ...(warmed ? { warmed } : {}) };
    }
  }
}

/** Mark the first map's gentle opening as granted (once per account). */
export function markWarmed(g: GuideState): GuideState {
  return g.warmed ? g : { ...g, warmed: true };
}

/**
 * Does the account's next map get the gentle opening? Only an active guide whose account has completed nothing
 * and has not had one already: a replay never re-grants it, and a veteran never gets it.
 */
export function wantsWarmup(g: GuideState | undefined, e: GuideEvidence): boolean {
  return !!g && g.mode === 'active' && !g.warmed && !isVeteran(e);
}

/** Hint ids and props, for tests and the UI. */
export type { GuideHintId, GuideProp };
