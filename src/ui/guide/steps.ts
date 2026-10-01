// The first-run objective tracker's step state machine (docs/onboarding-ux.md 6.2). PURE: a function of an observable snapshot
// (which panels are open, whether the device slot is filled, whether a portal exists, the zone, the run phase, the points...).
// Steps complete BY EVIDENCE, never by obedience: a player who ctrl-clicks a map straight into the slot skips "pick the area", a
// player who walks into a friend's map skips steps 1 to 5. Evidence of a later step completes every earlier step of the walk
// (device ... home). `points` and `equip` are independent tasks of the hideout after the first clear. Completion is MONOTONIC
// through the persisted `done` list: a step done never un-completes, and the displayed step never moves backwards.
import type { GuideMode, GuideStepId } from '../../contracts/guide';
import type { RunPhase } from '../../contracts/sim';
import type { GuideChapterId } from '../../data/guide/strings';

/** The walk, in order; evidence of a step completes every earlier one. */
export const WALK: readonly GuideStepId[] = ['device', 'area', 'map', 'open', 'enter', 'fight', 'boss', 'chest', 'home'];
/** The hideout tasks after the walk: each completes on its own evidence, shown in this order. */
export const TASKS: readonly GuideStepId[] = ['points', 'equip'];
export const TRACKED: readonly GuideStepId[] = [...WALK, ...TASKS];

export const CHAPTERS: Record<GuideChapterId, readonly GuideStepId[]> = {
  enter: ['device', 'area', 'map', 'open', 'enter'],
  win: ['fight', 'boss', 'chest', 'home'],
  grow: ['points', 'equip'],
};

export function chapterOf(step: GuideStepId): GuideChapterId {
  return step === 'points' || step === 'equip' || step === 'next' ? 'grow' : CHAPTERS.win.includes(step) ? 'win' : 'enter';
}

/** Kills in a run before `fight` counts as learned (or wave 2 reached). */
export const FIGHT_KILLS = 10;

export interface GuideSnapshot {
  /** Tracking only happens while 'active'. */
  mode: GuideMode;
  /** The persisted steps (character.guide.done). */
  done: readonly GuideStepId[];
  zone: 'hideout' | 'map' | null;
  /** In a hideout: it is the player's own. */
  ownHideout: boolean;
  /** The Map Device panel (the Atlas) is the visible left panel. */
  atlasOpen: boolean;
  /** An area modal is open inside it. */
  areaModal: boolean;
  /** character.mapDevice is filled. */
  deviceMap: boolean;
  /** The hideout map portal (hud.portal) or this map's own portal info. */
  portal: { remaining: number; total: number; cleared: boolean; ownerName: string } | null;
  run: {
    phase: RunPhase;
    kills: number;
    wave: number;
    waveCount: number;
    /** The reward chest: closed, open, or not spawned. */
    chest: 'closed' | 'open' | null;
    bossName: string | null;
  } | null;
  /** Unspent attribute and skill points. */
  unspent: { attribute: number; skill: number };
  /** Backpack gear that fits a free equipment slot. */
  gearToEquip: number;
  /** The display name of the area the first map opens ("Cinder Crossing"). */
  area: string;
}

export type GuideTargetKind = 'mapDevice' | 'portal' | 'chest' | 'returnPortal';

/** How the current step reads: the normal line, or a variant for a player who fell or has no portal left. */
export type StepVariant = 'normal' | 'retryPortal' | 'retryNoPortal' | 'partyJoin';

export interface GuideView {
  /** False when the guide is off (skipped / done) or has nothing to say here (someone else's hideout with no portal). */
  visible: boolean;
  /** The step to show now; 'next' = the closing card; null when invisible. */
  step: GuideStepId | null;
  variant: StepVariant;
  /** Every step satisfied (persisted or by evidence). */
  completed: ReadonlySet<GuideStepId>;
  /** Evidence steps not yet persisted: the caller sends `guide done` for each. */
  newlyDone: GuideStepId[];
  chapter: GuideChapterId;
  /** The world object the marker points at, if any. */
  target: GuideTargetKind | null;
  /** The marker shows at once (true) or only after the player stalled on the step (false). */
  urgent: boolean;
}

const openPortal = (s: GuideSnapshot): boolean => !!s.portal && s.portal.remaining > 0 && !s.portal.cleared;

/** The walk steps the snapshot proves. Pure evidence: it never reads `done`. */
export function evidenceOf(s: GuideSnapshot): Set<GuideStepId> {
  const out = new Set<GuideStepId>();
  const inMap = s.zone === 'map';
  const portal = openPortal(s);
  if (s.atlasOpen || s.areaModal || s.deviceMap || portal || inMap) out.add('device');
  if (s.areaModal || s.deviceMap || portal || inMap) out.add('area');
  if (s.deviceMap || portal || inMap) out.add('map');
  if (portal || inMap) out.add('open');
  if (inMap) out.add('enter');
  const r = s.run;
  if (inMap && r) {
    if (r.kills >= FIGHT_KILLS || r.wave >= 2 || r.phase === 'boss' || r.phase === 'cleared') out.add('fight');
    if (r.phase === 'cleared') out.add('boss');
    if (r.chest === 'open') out.add('chest');
  }
  return out;
}

/** Completion of the whole walk up to the latest proven step (evidence of a later step completes the earlier ones). */
function closeWalk(steps: Iterable<GuideStepId>): Set<GuideStepId> {
  const have = new Set(steps);
  let top = -1;
  WALK.forEach((id, i) => { if (have.has(id)) top = i; });
  const out = new Set<GuideStepId>();
  for (let i = 0; i <= top; i++) out.add(WALK[i]);
  for (const id of TASKS) if (have.has(id)) out.add(id);
  if (have.has('next')) out.add('next');
  return out;
}

export function deriveGuide(s: GuideSnapshot): GuideView {
  const none: GuideView = {
    visible: false, step: null, variant: 'normal', completed: new Set(), newlyDone: [], chapter: 'enter', target: null, urgent: false,
  };
  if (s.mode !== 'active' || s.zone === null) return none;
  const persisted = new Set(s.done);
  const proven = evidenceOf(s);
  const inMap = s.zone === 'map';
  const home = s.zone === 'hideout';

  // The way home after the boss: back in a hideout with the boss down, the walk is complete.
  if (home && persisted.has('boss')) proven.add('home');
  // Leaving a cleared map before opening the chest still finishes the walk (nothing is blocked, nothing is nagged).
  const completed = closeWalk([...persisted, ...proven]);

  // Hideout tasks: each on its own evidence once the walk is done.
  if (completed.has('home') && home) {
    if (s.unspent.attribute <= 0 && s.unspent.skill <= 0) completed.add('points');
    if (s.gearToEquip <= 0) completed.add('equip');
  }
  for (const id of TASKS) if (persisted.has(id)) completed.add(id);

  const newlyDone = TRACKED.filter((id) => completed.has(id) && !persisted.has(id));

  // Someone else's hideout: a single line while their portal is open, otherwise the guide has nothing to say here.
  if (home && !s.ownHideout) {
    const open = openPortal(s);
    return open
      ? { ...none, visible: true, step: 'enter', variant: 'partyJoin', completed, newlyDone, chapter: 'enter', target: 'portal', urgent: true }
      : { ...none, completed, newlyDone };
  }

  let step: GuideStepId | null = null;
  for (const id of TRACKED) if (!completed.has(id)) { step = id; break; }
  let variant: StepVariant = 'normal';

  // Fell (or left) before the boss: the walk was done but the boss is not. The tracker returns to the fight, or to opening a map.
  if (home && completed.has('enter') && !completed.has('boss')) {
    if (openPortal(s)) { step = 'fight'; variant = 'retryPortal'; }
    else { step = 'map'; variant = 'retryNoPortal'; }
  }
  if (step === null) step = 'next';

  const chapter = chapterOf(step);
  let target: GuideTargetKind | null = null;
  let urgent = false;
  switch (step) {
    case 'device': target = 'mapDevice'; urgent = true; break;
    case 'area': case 'map': case 'open': target = s.atlasOpen ? null : 'mapDevice'; urgent = true; break;
    case 'enter': target = 'portal'; urgent = true; break;
    case 'fight': if (variant === 'retryPortal') { target = 'portal'; urgent = true; } break;
    case 'chest': target = inMap ? 'chest' : null; urgent = true; break;
    case 'home': target = inMap ? 'returnPortal' : null; urgent = true; break;
    default: break;
  }
  if (variant === 'retryNoPortal') { target = s.atlasOpen ? null : 'mapDevice'; urgent = true; }
  return { visible: true, step, variant, completed, newlyDone, chapter, target, urgent };
}

/** The steps of the chapter the tracker shows (the current chapter's lines), with their state. */
export interface TrackerLine { id: GuideStepId; state: 'done' | 'current' | 'todo' }

export function trackerLines(view: GuideView): TrackerLine[] {
  if (!view.visible || !view.step) return [];
  // The side lines (a friend's portal, a spent map) stand alone: one line, no chapter around it.
  if (view.variant === 'partyJoin') return [{ id: 'enter', state: 'current' }];
  if (view.variant === 'retryNoPortal') return [{ id: 'map', state: 'current' }];
  const ids = view.step === 'next' ? CHAPTERS.grow : CHAPTERS[view.chapter];
  return ids.map((id) => ({ id, state: id === view.step ? 'current' : view.completed.has(id) ? 'done' : 'todo' }));
}

/** "2 / 5": how many lines of the chapter are done. */
export function chapterProgress(view: GuideView): { done: number; total: number } {
  const lines = trackerLines(view);
  return { done: lines.filter((l) => l.state === 'done').length, total: lines.length };
}

/**
 * Backpack equipment that fits a free slot (the `equip` step's evidence). `fits(item)` says whether it can be worn in some empty slot
 * (the caller owns the rules); pure over the list.
 */
export function countGearToEquip<T>(backpackGear: readonly T[], fits: (item: T) => boolean): number {
  return backpackGear.reduce((n, item) => (fits(item) ? n + 1 : n), 0);
}
