// FROZEN CONTRACT - map events (Event Director v2, docs/atlas-rework/C-map-events.md).
// Enum values are append-only: wire indices and saved plans depend on their order.

export const MAP_EVENT_KINDS = [
  'hunted', 'echoRift', 'blackout', 'vaultbreakers', 'secondCrown', 'wound',
  // wave 2 of events
  'pactAltar', 'orchard', 'ring', 'host', 'anvil', 'bellwatch', 'voidBreach',
] as const;
export type MapEventKind = typeof MAP_EVENT_KINDS[number];

/** Server-only creation roll. Never sent in ZoneInfo or a map tooltip. */
export interface MapEventPlan {
  kind: MapEventKind;
  wave: number;
  angle: number;
  /** Small per-plan choice drawn at creation (fixes the theme-independent flavour of the encounter: 0..255). */
  variant?: number;
  /** Guaranteed area encounters remain available through the boss and must resolve before the map clears. */
  required?: boolean;
  /** Fixed creation sequence: up to three area encounters plus a commissioned Bounty hunter (one after another). */
  next?: MapEventPlan;
  /** A second plan that runs concurrently in its own wave window (a slate of two); never sealed presets. */
  also?: MapEventPlan;
}

export const MAP_EVENT_PHASES = ['available', 'warning', 'active', 'complete', 'failed'] as const;
export type MapEventPhase = typeof MAP_EVENT_PHASES[number];

/** 0 failed / lost, 1 Bronze, 2 Silver, 3 Gold. */
export type MapEventGrade = 0 | 1 | 2 | 3;
export const MAP_EVENT_GRADE_NAMES = ['Failed', 'Bronze', 'Silver', 'Gold'] as const;

/** Ground decals the presenter draws for an event (append-only). */
export const MAP_EVENT_ZONES = [
  'eye', 'anchor', 'crack', 'field', 'wedgePlan', 'brazier', 'road', 'gate',
  // wave 2: a dwell stone (n = which choice, v = dwell percent, 255 = chosen, 254 = spent), a centrepiece (altar, ring altar, anvil
  // charge ring), the Ring's chain wall, the Void Breach's tide (r = safe radius) and its eye
  'stone', 'altar', 'arena', 'tide', 'breach',
] as const;
export type MapEventZoneKind = typeof MAP_EVENT_ZONES[number];

/** Small world markers (append-only). */
export const MAP_EVENT_ICONS = [
  'claw', 'echo', 'echoRare', 'wagon', 'lock', 'ember', 'crown', 'warden', 'guardian', 'pounce',
  // wave 2: bloom (v = stage 0..3, w = life percent), prism / heart (w = life percent), bell (v = Dirge, w = toll progress),
  // cantor, champion, anvil (v = charge percent), shield line, wheel, statue
  'bloom', 'prism', 'bell', 'cantor', 'champion', 'anvil', 'heart', 'shield', 'wheel', 'statue',
] as const;
export type MapEventIcon = typeof MAP_EVENT_ICONS[number];

/** A progress bar; its label comes from MAP_EVENT_TEXT[kind].objectives[id]. */
export interface MapEventBar { id: number; cur: number; max: number }
/** A countdown; its label comes from MAP_EVENT_TEXT[kind].timers[id]. */
export interface MapEventTimer { id: number; seconds: number; total: number }
export interface MapEventZone {
  kind: MapEventZoneKind;
  x: number; y: number; r: number;
  /** Heading in radians (wedge centre, field base angle, road heading). */
  a: number;
  /** Per-kind state 0..255 (resonance, hot order, lit progress, lock number ...). */
  v: number;
  /** Second per-kind value 0..255 (which pact / vow / boon glyph a stone shows). Absent = 0. */
  n?: number;
}
export interface MapEventMarker {
  icon: MapEventIcon; x: number; y: number; v: number;
  /** Second per-kind value 0..255 (life percent of a destructible). Absent = 0. */
  w?: number;
}

/** What a client sees of one live event. Every string is a key into MAP_EVENT_TEXT (never a literal). */
export interface MapEventView {
  /** Stable per run: distinguishes the up-to-three concurrent events. */
  uid: number;
  kind: MapEventKind;
  phase: MapEventPhase;
  /** Focus point (off-screen pointer, name label): the marker, anchor or the hunted monster. */
  x: number;
  y: number;
  /** Projected grade while active, final grade once complete. */
  grade: MapEventGrade;
  /** Index into MAP_EVENT_TEXT[kind].hints. */
  hint: number;
  objectives: MapEventBar[];
  timers: MapEventTimer[];
  zones: MapEventZone[];
  markers: MapEventMarker[];
}

/** Cosmetic beats the presenter turns into announcements, sounds and effects. */
export const MAP_EVENT_BEATS = [
  'omen', 'onset', 'step', 'whiff', 'hit', 'return', 'seal', 'erupt', 'complete', 'failed', 'lit', 'lock', 'arrive', 'lost', 'pulse',
  // wave 2: a stone was chosen (n = choice), a bloom was harvested, the prism shattered, statues thaw (n = count), the bell tolls
  // (n = Dirge), the anvil forged a boon, the void tide advances (n = step), a wall or ring crack
  'pick', 'harvest', 'shatter', 'thaw', 'toll', 'forge', 'tide', 'crack',
] as const;
export type MapEventBeat = typeof MAP_EVENT_BEATS[number];

/**
 * Hooks for the Atlas tree, map mods and scarabs (stream B): every field is optional, neutral when absent. The
 * server folds them into RunConfig.eventModifiers when the run is built; the sim reads only this shape.
 */
export interface MapEventModifiers {
  /** Added to the measured tally (Stalker whiffs, Fault seconds are not affected): each active danger mod is +1. */
  tally?: number;
  /** Multiplies the Stalker's whiff tally (Hunter's Patience: 2). */
  whiffMultiplier?: number;
  /** Extra Resonance the Echoing tolerates before it erupts (Resonant Rift: +2). */
  echoTolerance?: number;
  /** Echo life multiplier (Resonant Rift: 1.1). */
  echoLife?: number;
  /** The Stalker rolls a proof mod (Warded Hunts). */
  stalkerProof?: boolean;
  /** Multiplies event monster speed (Restless: 1.2). */
  monsterSpeed?: number;
  /** Multiplies the number of guardians and escorts (Teeming, Thick Herds). */
  monsterCount?: number;
  /** Shifts every grade up by this many steps (0..2; Gold stays Gold). */
  gradeShift?: number;
  /** Additive chance for the event's ingredient (Echo Dust). */
  ingredientChance?: number;
  /** Multiplies every event reward's extra rolls (reward mods). 1 = none. */
  rewardMultiplier?: number;
  /** Seconds added to every timed grade threshold. */
  timeBonus?: number;
  /** Multiplies every event timer and timed threshold (Long Fuse: 1.1). */
  timerScale?: number;
  /** Makes share- and time-based grade thresholds this much easier (Quick Study: 0.05; Ringmaster-style lenses: 0.15). */
  gradeEase?: number;
  /** Soft timeout: an event still running this many seconds after its onset fails and pays nothing (Sworn to the Veil: 90). */
  timeoutSeconds?: number;
  /** Encounter lenses (one per event: the effect and its price, see docs/atlas-rework/tree-events-interface.md). */
  stalkerLife?: number;
  lockLife?: number;
  caravanSpeed?: number;
  rivalLife?: number;
  /** Multiplies the share of a monster's life a Fault eruption deals (Fault-Walker: 1.5). */
  faultMonsterDamage?: number;
  /** How many hot wedges the Fault shows ahead (default 2; Fault-Walker price: 1). */
  faultPreview?: number;
  relayWick?: number;
  /** Extra Wickbearers alive at once (Keeper of the Flame price: 1). */
  relayBearers?: number;
  /** Crown Rivalry: multiplies the rival boss's exclusive unique chance (1.5). */
  rivalUnique?: number;
  /** Pact Broker: one more pact stone (always a hard one). */
  pactExtra?: number;
  /** Green Thumb: blooms ripen this many times faster (1.25) and monsters divert to them this many times more (1.2). */
  bloomRipen?: number;
  bloomTarget?: number;
  /** Ringmaster: the champion's life multiplier (1.2; the 15% easier thresholds come through gradeEase). */
  championLife?: number;
  /** Thaw Warden: the host thaws at this rate (0.8) and holds this many times the statues (1.15). */
  thawRate?: number;
  hostCount?: number;
  /** Anvil Blessing: one more boon offered (1) and charging costs this many times the kills (1.2). */
  anvilBoons?: number;
  anvilCost?: number;
  /** Bellringer: tolls come this many times slower (1.15) and cantors have this many times the life (1.15). */
  tollScale?: number;
  cantorLife?: number;
  /** Voidtouched Atlas: percent (50) added to the Void Breach's tide damage and to its rewards. */
  voidStrength?: number;
}

/** The pacts of the Pact Altar, in stable wire order (append only). */
export const PACT_IDS = ['swarm', 'bloodMoon', 'ironhide', 'ambush', 'cinderCurse', 'emberTax'] as const;
export type PactId = (typeof PACT_IDS)[number];

/** What a pact changes about ONE wave (the seam is planWave / spawnMonster / the kill loot context). 1 = neutral. */
export interface WavePact {
  id: PactId;
  /** Wave the pact belongs to. */
  wave: number;
  /** Multiplies the wave's monster budget. */
  monsters: number;
  /** Every pack of the wave is at least magic. */
  magic: boolean;
  /** Multiplies monster life for the wave. */
  life: number;
  /** Streams are folded into the packs and the whole wave arrives at once from every side. */
  ambush: boolean;
  /** Percent added to the item quantity and item rarity of this wave's kills. */
  quantity: number;
  rarity: number;
  /** Players lose this many percentage points of every resistance while the wave lasts. */
  resist: number;
}

/**
 * What the Wayside Anvil's boons do to the completion chest's equipment (RunHooks.rollChestLoot receives it; neutral when absent).
 * Tempered: +1 maximum Stability. Keen: a guaranteed implicit tier upgrade. Attuned: the class. Recast: rolled twice, the better kept.
 */
export interface ChestBoons {
  stability: number;
  keen: boolean;
  recast: boolean;
  /** ItemClass id of the attuned class, or null. */
  itemClass: string | null;
}

/** What the rewards rules get for one payout (grade and choice are decided by the sim). */
export interface EventRewardContext {
  kind: MapEventKind;
  grade: MapEventGrade;
  /** Caravan: lock number (0 coffer, 1 reliquary, 2 tube), 3 = the all-locks bonus. Otherwise 0. */
  choice: number;
  /** The measured tally that decided the grade (whiffs, intercepted echoes, locks broken, seconds). */
  tally: number;
  x: number;
  y: number;
  wave: number;
  ingredientBonus: number;
  multiplier: number;
}
