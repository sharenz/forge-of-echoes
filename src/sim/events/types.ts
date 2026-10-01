// Event Director v2 types (docs/atlas-rework/C-map-events.md 4.1). Kept free of runtime imports so the director, the
// scripts and the kit can share them without import cycles.
import type { Rng } from '../../contracts/rng';
import type { MapEventGrade, MapEventKind, MapEventModifiers, MapEventPhase, MapEventPlan, MapEventView } from '../../contracts/map-events';
import type { PlayerState, World } from '../world';

/** One notable kill, remembered for The Echoing. */
export interface KillRecord {
  x: number;
  y: number;
  kind: number;
  /** RARITY_CODE of the dead monster. */
  rarity: number;
  mods: number;
  wave: number;
}

/** What a script is told when one of its member monsters dies. */
export interface EventKill {
  id: number;
  kind: number;
  x: number;
  y: number;
  rarity: number;
  mods: number;
  credited: boolean;
  isBoss: boolean;
  /** Player id credited with the kill (0 = nobody). */
  source: number;
}

export interface EventInstance {
  uid: number;
  plan: MapEventPlan;
  kind: MapEventKind;
  phase: MapEventPhase;
  /** Script-private stage counter. */
  stage: number;
  /** Seconds since the event revealed itself. */
  age: number;
  /** Generic countdown (the omen warning, then the seconds the result stays on screen). */
  timer: number;
  /** Ids of the monsters this event owns (kills of these are credited to it). */
  members: Set<number>;
  grade: MapEventGrade;
  /** The measured quantity the grade was decided from (whiffs, echoes intercepted, locks, seconds). */
  tally: number;
  finished: boolean;
  /** Seconds of holding the next wave tell that this event may still use (boss-time events only). */
  hold: number;
  /** Event age when it turned active (-1 before): the soft timeout counts from here. */
  activeAge: number;
  view: MapEventView;
  /** The script's own state. */
  s: unknown;
}

export interface EventScript {
  kind: MapEventKind;
  /** The plan's wave arrived: choose the site and start the omen. Return false to wait (capacity, space). */
  reveal(w: World, e: EventInstance): boolean;
  /** Every tick while the event is live (not during its result display). */
  tick(w: World, e: EventInstance): void;
  /** Full control of one of the event's monsters this tick; return true when handled (the brain is skipped). */
  drive?(w: World, e: EventInstance, i: number, t: PlayerState | null): boolean;
  /**
   * Steer ANY monster (not just members) this tick, e.g. the Orchard drawing the horde to a bloom; return true when handled. Only
   * called while the event is live.
   */
  steer?(w: World, e: EventInstance, i: number, t: PlayerState | null): boolean;
  /** ANY credited kill of a monster that is not a member of any event (the Anvil counts kills near it). Only called while live. */
  onAnyKill?(w: World, e: EventInstance, k: EventKill): void;
  /** A member died. */
  onKill?(w: World, e: EventInstance, k: EventKill): void;
  /** A living player was hurt for `amount` (after mitigation). */
  onPlayerHit?(w: World, e: EventInstance, p: PlayerState, amount: number): void;
  /** Write the script's part of the HUD view (objectives, timers, zones, markers, hint, focus point). */
  view(w: World, e: EventInstance): void;
  /** The map is over or the event is being dropped: remove anything of the event's that must not linger. */
  cancel?(w: World, e: EventInstance): void;
}

export interface EventDirector {
  /** Plans waiting for their wave, in reveal order. */
  pending: MapEventPlan[];
  /** Instances alive or showing their result, oldest first. */
  live: EventInstance[];
  nextUid: number;
  /** The event stream: every random choice of every event (never worldRng, so waves stay unaffected). */
  rng: Rng;
  /** Ring of the last notable kills (only kept when an Echoing is planned). */
  killLog: KillRecord[];
  keepKillLog: boolean;
  /** Monster id -> owning instance, for the brain override and the kill dispatch. */
  members: Map<number, EventInstance>;
  /** Monster id -> sim time until which it takes extra damage (a whiffed Stalker). */
  exposed: Map<number, number>;
  /** Ids of translucent event monsters (the client draws them as shimmering). */
  spectral: Set<number>;
  /** Monster id -> extra item quantity / rarity percent on its loot (Stasis Host statues), and the rival boss's unique multiplier. */
  lootBonus: Map<number, { quantity: number; rarity: number; rival?: number }>;
  /** The Wayside Anvil's boons for the completion chest (null = none). */
  boons: import('../../contracts/map-events').ChestBoons | null;
  /** Multiplier on every monster's speed (Bellwatch's Dirge). 1 = none. */
  monsterSpeed: number;
  /** Live instances whose script steers ordinary monsters (rebuilt every tick). */
  steerers: EventInstance[];
  /** The views of the live instances, rebuilt in place every tick (RunView.events). */
  views: MapEventView[];
  modifiers: MapEventModifiers;
  /** Sim time of the last onset (two events never begin within EVENT_ONSET_GAP of each other). */
  lastOnset: number;
  /** Events that have finished, in order (tests, telemetry). */
  results: { kind: MapEventKind; grade: MapEventGrade; tally: number }[];
  /** Set by a required plan: the map must not clear until every required event is done. */
  requiredOpen: number;
  /** The map was created with at least one event plan (an event-free map hashes nothing extra into the digest). */
  planned: boolean;
}
