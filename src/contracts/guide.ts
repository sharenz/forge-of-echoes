// SHARED CONTRACT — the first-run guide (docs/onboarding-ux.md): ids, the persisted account-level GuideState and the
// `guide` command. The state is ACCOUNT-wide (it travels with the shared storage, like `atlas`), so a second character
// never repeats the tutorial. Only monotonic facts are stored (steps done, hints shown, props used); the step the player
// is on right now is DERIVED from live state in the UI (src/ui/guide/steps.ts), never stored as a cursor.

/** The eleven tracked steps in order, then the closing "what next" card. */
export const GUIDE_STEP_IDS = [
  'device', 'area', 'map', 'open', 'enter', 'fight', 'boss', 'chest', 'home', 'points', 'equip', 'next',
] as const;
export type GuideStepId = (typeof GUIDE_STEP_IDS)[number];

/** Event-triggered first-time hints (each shown at most once per account). */
export const GUIDE_HINT_IDS = [
  'lowLife', 'flasksEmpty', 'focusEmpty', 'levelUp', 'firstLoot', 'firstRare', 'firstDeath', 'secondDeath',
  'firstDebuff', 'firstEvent', 'firstBossPhase', 'firstBench', 'firstMerchant', 'firstAtlasPoint', 'firstStash',
  'firstCraft', 'firstMapClear',
] as const;
export type GuideHintId = (typeof GUIDE_HINT_IDS)[number];

/** Hideout objects whose name plate fades once the player has used them. */
export const GUIDE_PROPS = ['mapDevice', 'stash', 'anvil', 'merchant'] as const;
export type GuideProp = (typeof GUIDE_PROPS)[number];

export type GuideMode = 'active' | 'skipped' | 'done';

export interface GuideState {
  /** Schema of this blob (not the save version). */
  v: 1;
  /** active: show the tracker and hints; skipped: the player or the veteran rule said no; done: finished. */
  mode: GuideMode;
  skippedBy?: 'player' | 'veteran';
  /** Steps ever completed. Monotonic and de-duplicated; order irrelevant. */
  done: GuideStepId[];
  /** Hints already shown. */
  hints: GuideHintId[];
  /** Interactive hideout objects the player has used (their name plates fade). */
  used?: GuideProp[];
  /** Completion time (ms since epoch) per step: the funnel an admin can read. */
  t?: Partial<Record<GuideStepId, number>>;
  startedAt?: number;
  finishedAt?: number;
  /** How often the player replayed the tutorial. */
  replays?: number;
  /** The server already granted the gentle opening (warm-up) to this account's first map. */
  warmed?: true;
}

export const GUIDE_OPS = ['done', 'hint', 'used', 'skip', 'replay', 'finish'] as const;
export type GuideOp = (typeof GUIDE_OPS)[number];

/** The wire shape of the `guide` command (src/contracts/net.ts Command). */
export type GuideCommand =
  | { c: 'guide'; op: 'done'; id: GuideStepId }
  | { c: 'guide'; op: 'hint'; id: GuideHintId }
  | { c: 'guide'; op: 'used'; id: GuideProp }
  | { c: 'guide'; op: 'skip' | 'replay' | 'finish' };

/** An account at or past these numbers is a veteran: the guide never starts for it. */
export const GUIDE_VETERAN_LEVEL = 5;
/** The gentle first map: monsters stay asleep until the player has moved or cast, or this long, whichever is first (seconds). */
export const GUIDE_WARMUP_SECONDS = 15;

/** What the UI sends (`UiActions.guide`): the command without its tag. */
export type GuideInput =
  | { op: 'done'; id: GuideStepId }
  | { op: 'hint'; id: GuideHintId }
  | { op: 'used'; id: GuideProp }
  | { op: 'skip' | 'replay' | 'finish' };

/** One-shot facts from the world the UI cannot see in its state (a drop landed, the player cast...). Emitted by the client app. */
export type GuideSignal =
  | { kind: 'drop'; tone: import('./sim').DropTone }
  | { kind: 'noFocus' }
  | { kind: 'bossPhase'; phase: number }
  | { kind: 'used'; action: 'move' | 'cast' | 'flask' | 'dash' | 'skill' }
  | { kind: 'mapEntered' };

/** A prop's place on screen, for the guide's world markers and name plates (CSS px; refreshed every frame, read in rAF, never subscribed). */
export interface WorldAnchor {
  id: number;
  kind: import('./sim').PropKind;
  /** CSS px of the prop's base centre. */
  x: number;
  y: number;
  /** Prop state (chest: 0 closed / 1 open; portal: remaining). */
  state: number;
  /** Footprint radius and sprite height in CSS px (for the ring and the plate). */
  radius: number;
  height: number;
}

export interface UiWorld {
  /** The guide-relevant props of the current zone with their screen positions (empty outside the game). */
  anchors(): readonly WorldAnchor[];
  /** The area of the screen the world is visible in (CSS px). */
  viewport(): { width: number; height: number };
  /** Walk to a prop and use it, exactly like a click on it in the world (the keyboard path of the tracker). */
  walkTo(propId: number): void;
}

export interface GuideSignals {
  subscribe(fn: (signal: GuideSignal) => void): () => void;
}
