// Event-triggered first-time hints (docs/onboarding-ux.md 6.6). PURE: `hintCandidates` says which hints the current snapshot calls for
// (state-based triggers plus latched one-shot signals such as "a drop landed"), `pickHint` applies the rules that make them
// courteous: one at a time by priority, each at most once per account, a gap between cards, never while a modal or the death
// overlay is up, never in the first seconds after entering a map (the wave tell is playing), and never for a veteran or when the
// player turned tips off. Hints only ever point: they never block anything.
import type { GuideHintId, GuideMode } from '../../contracts/guide';

/** Minimum time between two cards (ms). */
export const HINT_GAP_MS = 25_000;
/** No card this long after the portal entry (ms): the wave tell is playing. */
export const POST_ENTRY_QUIET_MS = 4_000;
/** A card stays this long unless hovered or focused (ms). */
export const HINT_SHOW_MS = 9_000;
/** Life fraction below which `lowLife` fires. */
export const LOW_LIFE_HINT = 0.4;
/** Focus fraction at or below which `focusEmpty` fires (when a Focus skill is assigned). */
export const EMPTY_FOCUS_HINT = 0.03;

/** Highest priority first. */
export const HINT_ORDER: readonly GuideHintId[] = [
  'lowLife', 'flasksEmpty', 'firstDeath', 'secondDeath', 'levelUp', 'focusEmpty', 'firstDebuff', 'firstBossPhase', 'firstEvent',
  'firstRare', 'firstLoot', 'firstMapClear', 'firstAtlasPoint', 'firstBench', 'firstMerchant', 'firstStash', 'firstCraft',
];

/** The control a card pulses while it is up (CSS `[data-guide-pulse="..."]`). */
export type HintPoint = 'flasks' | 'focus' | 'badges' | 'inventory' | 'deck' | 'device' | null;

export const HINT_POINTS: Record<GuideHintId, HintPoint> = {
  lowLife: 'flasks', flasksEmpty: 'flasks', focusEmpty: 'focus', levelUp: 'badges', firstLoot: null, firstRare: 'inventory',
  firstDeath: null, secondDeath: 'badges', firstDebuff: null, firstEvent: null, firstBossPhase: null, firstBench: null,
  firstMerchant: null, firstAtlasPoint: 'device', firstStash: null, firstCraft: null, firstMapClear: null,
};

export interface HintSnapshot {
  zone: 'hideout' | 'map' | null;
  dead: boolean;
  life: number;
  maxLife: number;
  focus: number;
  maxFocus: number;
  /** A skill that spends Focus is on the bar. */
  needsFocus: boolean;
  flasks: readonly ({ resource: 'life' | 'focus'; count: number } | null)[];
  /** The level went up since the UI mounted. */
  leveledUp: boolean;
  unspent: { attribute: number; skill: number; atlas: number };
  deaths: number;
  debuffs: number;
  /** Map event cards on screen. */
  events: number;
  panels: { bench: boolean; merchant: boolean; stash: boolean };
  itemsCrafted: number;
  mapsCompleted: number;
  /** Latched one-shots from the world (cleared when their hint is shown). */
  seen: { gear: boolean; rare: boolean; noFocus: boolean; bossPhase: boolean };
}

/** Every hint the snapshot calls for, unordered and not yet filtered by what was shown. */
export function hintCandidates(s: HintSnapshot): Set<GuideHintId> {
  const out = new Set<GuideHintId>();
  const inMap = s.zone === 'map';
  const alive = !s.dead;
  const lifeFrac = s.maxLife > 0 ? s.life / s.maxLife : 1;
  const focusFrac = s.maxFocus > 0 ? s.focus / s.maxFocus : 1;
  const lifeFlask = s.flasks.some((f) => f?.resource === 'life' && f.count > 0);
  if (inMap && alive && s.life > 0 && lifeFrac < LOW_LIFE_HINT && lifeFlask) out.add('lowLife');
  if (inMap && alive && s.flasks.some((f) => f?.resource === 'life' && f.count === 0)) out.add('flasksEmpty');
  if (s.seen.noFocus || (inMap && alive && s.needsFocus && focusFrac <= EMPTY_FOCUS_HINT)) out.add('focusEmpty');
  if (s.leveledUp && (s.unspent.attribute > 0 || s.unspent.skill > 0)) out.add('levelUp');
  if (s.seen.gear) out.add('firstLoot');
  if (s.seen.rare) out.add('firstRare');
  // A death card comes after the death overlay and the summary are gone: back home, alive.
  if (alive && s.zone === 'hideout' && s.deaths >= 1) out.add('firstDeath');
  if (alive && s.zone === 'hideout' && s.deaths >= 2) out.add('secondDeath');
  if (inMap && s.debuffs > 0) out.add('firstDebuff');
  if (inMap && s.events > 0) out.add('firstEvent');
  if (s.seen.bossPhase) out.add('firstBossPhase');
  if (s.panels.bench) out.add('firstBench');
  if (s.panels.merchant) out.add('firstMerchant');
  if (s.panels.stash) out.add('firstStash');
  if (s.zone === 'hideout' && s.unspent.atlas > 0) out.add('firstAtlasPoint');
  if (s.itemsCrafted >= 1) out.add('firstCraft');
  if (s.zone === 'hideout' && s.mapsCompleted >= 1) out.add('firstMapClear');
  return out;
}

export interface HintContext {
  /** Monotonic ms. */
  now: number;
  mode: GuideMode;
  /** Settings.hints (default on). */
  tipsOn: boolean;
  shown: readonly GuideHintId[];
  /** When the last card appeared (-Infinity = never). */
  lastShownAt: number;
  /** When the player entered the current map (-Infinity = not in one). */
  enteredMapAt: number;
  /** A modal, the death overlay, the run summary, a dialog or the affix choice is up. */
  blocked: boolean;
}

/** The hint to show now, or null. */
export function pickHint(candidates: ReadonlySet<GuideHintId>, ctx: HintContext): GuideHintId | null {
  // Hints outlive the tutorial (a finished guide still points out the bench or Rook once); only a skipped guide (a veteran, or a player who said no) is silent.
  if (ctx.mode === 'skipped' || !ctx.tipsOn || ctx.blocked) return null;
  if (ctx.now - ctx.lastShownAt < HINT_GAP_MS) return null;
  if (ctx.now - ctx.enteredMapAt < POST_ENTRY_QUIET_MS) return null;
  for (const id of HINT_ORDER) if (candidates.has(id) && !ctx.shown.includes(id)) return id;
  return null;
}

/** The latched one-shots a drop or other world signal sets (tone: the DropTone of a `dropSpawn`). */
export function dropSignal(tone: string): { gear: boolean; rare: boolean } {
  const gear = tone === 'normal' || tone === 'magic' || tone === 'rare' || tone === 'unique';
  return { gear, rare: tone === 'rare' || tone === 'unique' };
}
