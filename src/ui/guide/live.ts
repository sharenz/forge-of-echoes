// UI-local state of the first-run guide that never leaves the browser (per mountUi, shared through Local): which step the player hid the
// tracker at, the marker a "What next" row asked for, the coach card on screen and when the last one appeared, the cheat-sheet's
// timing and used chips, and the world signals latched until their hint is shown. The persisted facts live in character.guide.
import type { GuideHintId, GuideStepId } from '../../contracts/guide';
import { signal, type Signal } from '../store';
import type { ChipId } from './cheatsheet';
import type { HintSnapshot } from './hints';

export type GuideOverrideKind = 'anvil' | 'merchant' | 'mapDevice';

export interface GuideLive {
  /** The tracker is collapsed to its pill at this step (it opens again at the next one). */
  hiddenStep: GuideStepId | null;
  /** A marker a "What next" row asked for (a few seconds; null = none). */
  override: { kind: GuideOverrideKind; at: number } | null;
  /** The coach card on screen. */
  card: { id: GuideHintId; at: number } | null;
  used: ReadonlySet<ChipId>;
  seen: HintSnapshot['seen'];
  /** performance.now() when the cheat-sheet began (the map entry), and when its two core chips were both used. */
  sheetAt: number | null;
  coreAt: number | null;
  lastCardAt: number;
  /** performance.now() of the current map entry (-Infinity = not in one). */
  mapAt: number;
  /** The player closed the closing card. */
  nextClosed: boolean;
  /** The level-ups the player has seen since the UI mounted. */
  levelUps: number;
  /** performance.now() the current step began (the marker's escalation timer). */
  stepAt: number;
}

export const NO_SEEN: HintSnapshot['seen'] = { gear: false, rare: false, noFocus: false, bossPhase: false };

export function createGuideLive(): Signal<GuideLive> {
  return signal<GuideLive>({
    hiddenStep: null, override: null, card: null, used: new Set(), seen: NO_SEEN, sheetAt: null, coreAt: null,
    lastCardAt: -Infinity, mapAt: -Infinity, nextClosed: false, levelUps: 0, stepAt: 0,
  });
}
