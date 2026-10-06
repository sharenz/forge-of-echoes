// The controls cheat-sheet shown on map entry (docs/onboarding-ux.md 6.5). PURE: which chips exist, which are dimmed (used once), and
// when the strip is visible. It shows while the `fight` step is still unlearned, in a map, until its two core chips (cast and move)
// have been used and a few seconds have passed, or a time limit; each chip dims the first time its action is used.
export type ChipId = 'cast' | 'move' | 'flasks' | 'dash' | 'panels';

export const CHIPS: readonly ChipId[] = ['cast', 'move', 'flasks', 'dash', 'panels'];
/** What the player has to do for the strip to wind down. */
export const CORE: readonly ChipId[] = ['cast', 'move'];
/** The strip fades this long after the core chips are both used (ms). */
export const FADE_AFTER_CORE_MS = 3_000;
/** The strip fades after this long regardless (ms). */
export const MAX_SHOW_MS = 40_000;
/** The strip is only for a player who has not learned to fight yet: fewer kills than this (the tracker's FIGHT_KILLS). */

/** An input the client saw the local player do. */
export type UsedAction = 'move' | 'cast' | 'flask' | 'dash' | 'skill';

/** The chip an action dims. */
export function chipOf(action: UsedAction): ChipId | null {
  switch (action) {
    case 'move': return 'move';
    case 'cast': return 'cast';
    case 'flask': return 'flasks';
    case 'dash': return 'dash';
    case 'skill': return null;
  }
}

export interface CheatsheetState {
  visible: boolean;
  /** Chips already used. */
  dimmed: ReadonlySet<ChipId>;
  /** The winding-down fade (the core chips are used). */
  fading: boolean;
}

export interface CheatsheetInput {
  /** The guide is active and the `fight` step is not learned yet. */
  wanted: boolean;
  inMap: boolean;
  /** Monotonic ms the strip began (map entry); null = not started. */
  startedAt: number | null;
  /** Monotonic ms of the moment the last core chip was used; null = not all used. */
  coreDoneAt: number | null;
  used: ReadonlySet<ChipId>;
  now: number;
}

export function cheatsheetState(i: CheatsheetInput): CheatsheetState {
  const none: CheatsheetState = { visible: false, dimmed: i.used, fading: false };
  if (!i.wanted || !i.inMap || i.startedAt === null) return none;
  if (i.now - i.startedAt >= MAX_SHOW_MS) return none;
  if (i.coreDoneAt !== null && i.now - i.coreDoneAt >= FADE_AFTER_CORE_MS) return none;
  return { visible: true, dimmed: i.used, fading: i.coreDoneAt !== null };
}

/** The moment both core chips were used, given the previous value and the new used set. */
export function coreDone(prev: number | null, used: ReadonlySet<ChipId>, now: number): number | null {
  if (prev !== null) return prev;
  return CORE.every((c) => used.has(c)) ? now : null;
}
