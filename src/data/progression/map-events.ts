import type { MapEventKind } from '../../contracts/map-events';
import type { AtlasAreaType } from './atlas';
import { ANVIL_COLOR, ANVIL_MIN_TIER, ANVIL_NAME, ANVIL_TEXT, ANVIL_WINDOW } from './events/anvil';
import { BELLWATCH_COLOR, BELLWATCH_MIN_TIER, BELLWATCH_NAME, BELLWATCH_TEXT, BELLWATCH_WINDOW } from './events/bellwatch';
import { HOST_COLOR, HOST_MIN_TIER, HOST_NAME, HOST_TEXT, HOST_WINDOW } from './events/host';
import { ORCHARD_COLOR, ORCHARD_MIN_TIER, ORCHARD_NAME, ORCHARD_TEXT, ORCHARD_WINDOW } from './events/orchard';
import { PACT_COLOR, PACT_MIN_TIER, PACT_NAME, PACT_TEXT, PACT_WINDOW } from './events/pact-altar';
import { RING_COLOR, RING_MIN_TIER, RING_NAME, RING_TEXT, RING_WINDOW } from './events/ring';
import { BREACH_COLOR, BREACH_MIN_TIER, BREACH_NAME, BREACH_TEXT, BREACH_WINDOW } from './events/void-breach';

/** Player-facing names. The ids (hunted, echoRift ...) are the stable wire/save ids. */
export const MAP_EVENT_NAMES: Record<MapEventKind, string> = {
  hunted: 'The Stalker', echoRift: 'The Echoing', blackout: 'Ember Relay', vaultbreakers: 'Laden Caravan',
  secondCrown: 'Rival Crowns', wound: 'The Fault',
  pactAltar: PACT_NAME, orchard: ORCHARD_NAME, ring: RING_NAME, host: HOST_NAME, anvil: ANVIL_NAME, bellwatch: BELLWATCH_NAME, voidBreach: BREACH_NAME,
};
export const MAP_EVENT_MIN_TIER: Record<MapEventKind, number> = {
  hunted: 1, echoRift: 2, blackout: 3, vaultbreakers: 3, secondCrown: 5, wound: 3,
  pactAltar: PACT_MIN_TIER, orchard: ORCHARD_MIN_TIER, ring: RING_MIN_TIER, host: HOST_MIN_TIER, anvil: ANVIL_MIN_TIER, bellwatch: BELLWATCH_MIN_TIER,
  voidBreach: BREACH_MIN_TIER,
};
/** Kinds that never join the ordinary slate draw: the Void Breach only comes from the Voidtouched Atlas keystone (forced plans). */
export const MAP_EVENT_UNPOOLED: readonly MapEventKind[] = ['voidBreach'];
/** First and last wave a plan may be revealed in (the boss-time event lives on the boss wave). */
export const MAP_EVENT_WINDOW: Record<MapEventKind, readonly [number, number]> = {
  hunted: [2, 4], echoRift: [2, 4], blackout: [2, 4], vaultbreakers: [2, 4], secondCrown: [6, 6], wound: [3, 5],
  pactAltar: PACT_WINDOW, orchard: ORCHARD_WINDOW, ring: RING_WINDOW, host: HOST_WINDOW, anvil: ANVIL_WINDOW, bellwatch: BELLWATCH_WINDOW,
  voidBreach: BREACH_WINDOW,
};
export const MAP_EVENT_COLORS: Record<MapEventKind, readonly [number, number, number]> = {
  hunted: [0.95, 0.68, 0.25], echoRift: [0.55, 0.35, 0.82], blackout: [1, 0.86, 0.6],
  vaultbreakers: [0.95, 0.8, 0.35], secondCrown: [1, 0.5, 0.2], wound: [0.9, 0.25, 0.4],
  pactAltar: PACT_COLOR, orchard: ORCHARD_COLOR, ring: RING_COLOR, host: HOST_COLOR, anvil: ANVIL_COLOR, bellwatch: BELLWATCH_COLOR, voidBreach: BREACH_COLOR,
};
/** Chance a map gets at least one event (was 25%). */
export const MAP_EVENT_BASE_CHANCE = 0.45;
export const MAP_EVENT_MAX_CHANCE = 0.65;
/** Chance of a second, concurrent event when the first was drawn (a slate of at most two). */
export const MAP_EVENT_SECOND_CHANCE = 0.3;
/** At most this many events on a map, whatever the tree says. */
export const MAP_EVENT_MAX_SLOTS = 3;
/** At most this many live at once. */
export const MAP_EVENT_MAX_LIVE = 3;
/** Absolute additions to each eligible event's chance; all chances sum to the event chance. */
export const AREA_EVENT_BONUS: Partial<Record<AtlasAreaType, Partial<Record<MapEventKind, number>>>> = {
  forge: { hunted: 0.05, blackout: 0.05, wound: 0.03, anvil: 0.04 }, arena: { hunted: 0.10, secondCrown: 0.05, ring: 0.05 },
  crypt: { echoRift: 0.10, wound: 0.05, host: 0.03, bellwatch: 0.05 }, vault: { echoRift: 0.05, vaultbreakers: 0.10, pactAltar: 0.05 },
  frontier: { orchard: 0.06 },
};
export const MOD_EVENT_BONUS: Record<string, Partial<Record<MapEventKind, number>>> = {
  commanded: { hunted: 0.08 }, restless: { hunted: 0.05 },
  teeming: { echoRift: 0.05 }, echo: { echoRift: 0.10 },
};

// --- Event Director v2 fairness budget (docs/atlas-rework/C-map-events.md 4.3) -----------------------------------
export const MAP_EVENT_WARNING_SECONDS = 3;
/** F1: no hostile event area hurts before this many seconds (F1_LARGE for radius above F1_LARGE_RADIUS). */
export const EVENT_MIN_TELEGRAPH = 1.0;
export const EVENT_MIN_TELEGRAPH_LARGE = 1.8;
export const EVENT_LARGE_RADIUS = 60;
/** F4: event monsters appear at least this far from every living player (the design may say otherwise). */
export const EVENT_SPAWN_CLEARANCE = 250;
/** Two events never begin their onset within this many seconds of each other. */
export const EVENT_ONSET_GAP = 8;
/** Two hot zones of concurrent events never sit closer than this. */
export const EVENT_HOT_ZONE_GAP = 200;
/**
 * Sworn to the Veil's soft timeout (90 s after the onset) is stretched for the events whose own length is longer: a Pact Altar has two
 * rounds, the Caravan's road is 100 s, the Rival fight runs the boss fight. Kinds not listed use the plain timeout.
 */
export const MAP_EVENT_TIMEOUT_FACTOR: Partial<Record<MapEventKind, number>> = { pactAltar: 1.9, vaultbreakers: 1.5, voidBreach: 1.5, secondCrown: 3, host: 1.3 };

/** Seconds a finished event stays on the HUD (the "completed text" rule). */
export const EVENT_RESULT_SECONDS = 5;

// --- The Stalker ----------------------------------------------------------------------------------------------------
export const STALKER_SPAWN_CLEARANCE = 320;
export const STALKER_ORBIT: readonly [number, number] = [260, 340];
export const STALKER_POUNCE_SECONDS = 9;
export const STALKER_POUNCE_SECONDS_HUNTED = 7;
export const STALKER_FRENZY_SECONDS = 4;
export const STALKER_ROGUE_SECONDS = 5;
/** The furthest a pounce can cover (it closes in on its straggler first). */
export const STALKER_LEAP_MAX = 400;
export const STALKER_DISC_RADIUS = 34;
export const STALKER_DISC_SECONDS = 1.2;
export const STALKER_LOCK_BEFORE_IMPACT = 0.4;
export const STALKER_FLIGHT = 0.25;
export const STALKER_HUNT_MAX = 3;
export const STALKER_HUNT_BONUS = 0.12;
export const STALKER_FRENZY_BONUS = 0.25;
export const STALKER_HEAL = 0.1;
/** The Stalker's life as a multiple of a rare of its kind (a matched build kills a plain rare in about ten seconds). */
export const STALKER_LIFE = 16;
export const STALKER_EXPOSED_SECONDS = 4;
export const STALKER_EXPOSED_TAKEN = 0.4;
export const STALKER_WHIFF_RECOVERY = 2.5;
export const STALKER_STUN_SECONDS = 3;
export const STALKER_DAMAGE_MULT = 1.6;
/** Left alive this long after it appeared, or at the boss wave, it turns rogue and pays nothing. */
export const STALKER_IGNORE_SECONDS = 120;
/** Whiff tally that grades Silver / Gold. */
export const STALKER_GRADE_WHIFFS: readonly [number, number] = [1, 3];

// --- The Echoing -----------------------------------------------------------------------------------------------------
export const ECHO_LOG_SIZE = 24;
export const ECHO_LOG_MIN = 6;
export const ECHO_MAX = 12;
export const ECHO_INTERVAL = 1.6;
export const ECHO_FIRST_DELAY = 3;
export const ECHO_SHIMMER = 1.0;
export const ECHO_SPEED = 80;
export const ECHO_LIFE = 2.5;
export const ECHO_ENGAGE_RADIUS = 110;
export const ECHO_DISENGAGE_RADIUS = 160;
export const ECHO_HOME_RADIUS = 30;
export const ECHO_ANCHOR_CLEARANCE = 250;
export const ECHO_ANCHOR_RIM = 200;
export const ECHO_REACH = 70;
/** Returned echoes at which the rift erupts (below it the rift seals). */
export const ECHO_ERUPT_RETURNS = 6;
export const ECHO_ERUPT_SECONDS = 5;
export const ECHO_ERUPT_RADIUS = 150;
export const ECHO_WARDEN_LIFE = 3;
/** Intercepted share for Bronze / Silver / Gold. */
export const ECHO_GRADE_SHARE: readonly [number, number, number] = [0.5, 0.75, 0.95];
/** An echo killed inside this radius of the anchor was only caught at the door: it counts ECHO_GATE_WEIGHT of an interception. */
export const ECHO_GATE_RADIUS = 150;
export const ECHO_GATE_WEIGHT = 0.8;

// --- Laden Caravan ---------------------------------------------------------------------------------------------------
export const CARAVAN_SPEED = 22;
export const CARAVAN_ESCORTS = 8;
export const CARAVAN_REINFORCEMENTS = 4;
export const CARAVAN_LOCKS = 3;
/** A lock has this many times a bruiser's life: a fair bot breaks about two of three (tests/sim-events/bot-play.test.ts). */
export const CARAVAN_LOCK_LIFE = 10;
export const CARAVAN_LANE = 250;
export const CARAVAN_LANE_SECONDS = 1.5;
export const CARAVAN_LANE_DAMAGE = 12;
export const CARAVAN_ESCORT_LEASH = 200;
/** Two wheel hardpoints (fixtures): each has this many times a bruiser's scaled life and slows the wagon when broken. */
export const CARAVAN_WHEELS = 2;
export const CARAVAN_WHEEL_LIFE = 4;
export const CARAVAN_WHEEL_RADIUS = 9;
/** Speed multiplier per broken wheel (multiplicative: two broken = 0.49). */
export const CARAVAN_WHEEL_SLOW = 0.7;
/** A lock stays shielded while MORE than this many of its escort group live (the shield line). */
export const CARAVAN_SHIELD_KEEP = 1;
/** The trample lane knocks a player in it this far sideways when it lands. */
export const CARAVAN_LANE_KNOCK = 60;
/** Ashen: a broken crucible spills a fire pool (radius, seconds, damage base). */
export const CARAVAN_SPILL_RADIUS = 34;
export const CARAVAN_SPILL_SECONDS = 4;
export const CARAVAN_SPILL_DAMAGE = 8;

// --- The Fault -------------------------------------------------------------------------------------------------------
export const FAULT_RADIUS = 240;
export const FAULT_PULSES = 4;
export const FAULT_PULSE_SECONDS = 8;
export const FAULT_GUARDIANS = 6;
export const FAULT_HOT_DELAY = 2;
export const FAULT_ERUPT_TELEGRAPH = 1.8;
export const FAULT_DAMAGE = 14;
export const FAULT_MONSTER_FRAC = 0.3;
export const FAULT_CRUST_SECONDS = 4;
export const FAULT_OVERFLOW_SECONDS = 75;
export const FAULT_OVERFLOW_INTERVAL = 10;
export const FAULT_OVERFLOW_MONSTERS = 4;
/** Seal time (s) for Gold / Silver. */
export const FAULT_GRADE_SECONDS: Record<'ashen' | 'ossuary' | 'coliseum', readonly [number, number]> = {
  ashen: [27, 45], ossuary: [30, 50], coliseum: [27, 45],
};
export const FAULT_REACH = 70;
export const FAULT_CLEARANCE = 300;

// --- Ember Relay -----------------------------------------------------------------------------------------------------
export const RELAY_BRAZIERS = 3;
export const RELAY_SPACING = 300;
export const RELAY_WICK_SECONDS = 30;
export const RELAY_WICK_HIT = 2;
export const RELAY_DWELL = 2;
export const RELAY_DWELL_RADIUS = 46;
export const RELAY_LIT_RADIUS = 210;
export const RELAY_BEARER_INTERVAL = 25;
export const RELAY_MAX_LOST = 3;
export const RELAY_PICKUP_RADIUS = 26;
export const RELAY_SHROUD_HASTE = 0.3;
/** The carrier of the Ember moves this much slower (a fraction; on the wire as PlayerView.eventSlow). */
export const RELAY_CARRY_SLOW = 0.12;
/** Gold needs all three braziers lit with no Ember lost inside this many seconds from the onset. */
export const RELAY_GOLD_SECONDS = 56;

// --- Rival Crowns ----------------------------------------------------------------------------------------------------
export const RIVAL_ARRIVAL_SECONDS = 20;
export const RIVAL_SHIMMER_SECONDS = 3;
export const RIVAL_LIFE = 0.6;
export const RIVAL_DAMAGE = 0.8;
export const RIVAL_CLEARANCE = 350;
export const RIVAL_SPOILS_HEAL = 0.2;
export const RIVAL_SPOILS_BONUS = 0.25;
/** The rival's timers run this many seconds behind the first boss's at arrival. */
export const RIVAL_OFFSET_SECONDS = 1.5;
/** Two large (radius > 60) boss telegraphs at a time: the rival's next cast waits, at most this long per cast. */
export const RIVAL_BUDGET_LARGE = 2;
export const RIVAL_BUDGET_MAX_HOLD = 3;
/** Feud: every FEUD_INTERVAL seconds fighting minion pairs within FEUD_REACH trade this share of the attacker's damage. */
export const RIVAL_FEUD_INTERVAL = 0.5;
export const RIVAL_FEUD_REACH = 70;
export const RIVAL_FEUD_DAMAGE = 0.6;
/** Enrage: this long after the rival arrives both bosses gain +2% damage every 10 s. */
export const RIVAL_ENRAGE_SECONDS = 240;
export const RIVAL_ENRAGE_STEP = 10;
export const RIVAL_ENRAGE_BONUS = 0.02;
/** Seconds from the rival's arrival to the second death for Gold / Silver. */
export const RIVAL_GRADE_SECONDS: readonly [number, number] = [52, 100];
/** The rival's roster decides how long the pair takes to fell: a Coliseum or Ossuary rival is tougher for the matched build. */
export const RIVAL_SKIN_PACE = { ashen: 1, ossuary: 1.3, coliseum: 1.5 } as const;

/** Player-facing strings, keyed by the numeric ids the MapEventView carries (never literals on the wire). */
export interface MapEventText {
  /** The omen banner (a parchment strip, 3 s). */
  omen: string;
  /** One line per phase for the kicker of the card. */
  phases: { available: string; warning: string; active: string; complete: string; failed: string };
  objectives: readonly string[];
  timers: readonly string[];
  hints: readonly string[];
}

export const MAP_EVENT_TEXT: Record<MapEventKind, MapEventText> = {
  hunted: {
    omen: 'Something is following you.',
    phases: { available: 'Tracks in the dust', warning: 'It is coming', active: 'The hunt', complete: 'Stalker slain', failed: 'It slipped away' },
    objectives: ['Hunt', 'Whiffs'],
    timers: ['Next pounce', 'Exposed'],
    hints: [
      'Bait the pounce. Stand behind a pillar, step out at the lock.',
      'The disc locks, then it leaps. Dodge, then strike while it is exposed.',
      'Frenzied. Kill it now.',
      'It slips into the horde and pays nothing.',
      'Every whiff raises the trophy.',
    ],
  },
  echoRift: {
    omen: 'The rift remembers.',
    phases: { available: 'An anchor stirs', warning: 'The rift wakes', active: 'The dead return', complete: 'Rift sealed', failed: 'Rift lost' },
    objectives: ['Home', 'Intercepted', 'Echoes'],
    timers: ['Next echo', 'Erupts in'],
    hints: [
      'Walk to the anchor to wake the rift. Ignore it and it closes.',
      'Echoes walk home to the anchor. Cut them off, rares first.',
      'The rift erupts. Leave the ring, then slay the Warden.',
      'Slay the Rift Warden.',
      'Sealed. Every echo intercepted is a better trophy.',
    ],
  },
  blackout: {
    omen: 'The lights are going out.',
    phases: { available: 'Three cold braziers', warning: 'The dark closes in', active: 'Carry the flame', complete: 'Light restored', failed: 'Flame lost' },
    objectives: ['Braziers lit', 'Embers lost'],
    timers: ['Wick', 'Next bearer', 'Gold pace'],
    hints: [
      'Slay the Wickbearer and take its Ember.',
      'Carry the Ember to a dark brazier and stand at it.',
      'The wick burns. Every hit you take shortens it.',
      'Gold: all three lit, no Ember lost, inside the pace.',
    ],
  },
  vaultbreakers: {
    omen: 'A laden wagon crosses the arena.',
    phases: { available: 'Wheels in the distance', warning: 'The wagon rolls in', active: 'Crack the locks', complete: 'Locks cracked', failed: 'The wagon escaped' },
    objectives: ['Locks', 'Route'],
    timers: ['Wagon leaves'],
    hints: [
      'Cut down the escorts on a lock\'s side to drop its shield, then break it. Each lock guards a different prize.',
      'Keep out of the marked lane ahead of the wagon. It knocks you aside.',
      'Reinforcements are dropping from the rim.',
      'Every unbroken lock leaves with the wagon.',
      'Break a wheel to slow the wagon by 30%. It pays nothing.',
    ],
  },
  secondCrown: {
    omen: 'A rival claims the crown.',
    phases: { available: '', warning: 'A rival approaches', active: 'Two crowns', complete: 'Both crowns fallen', failed: 'The rival is gone' },
    objectives: ['Crowns fallen'],
    timers: ['Rival arrives', 'Fight'],
    hints: [
      'A rival boss is coming from the far rim.',
      'Choose who falls first. The survivor grows stronger. Their minions fight each other.',
      'The survivor is empowered. Finish it.',
      'Enraged: both bosses hit harder every ten seconds.',
    ],
  },
  wound: {
    omen: 'The ground is splitting.',
    phases: { available: 'A crack glows', warning: 'The ground splits', active: 'The Fault', complete: 'Fault sealed', failed: 'The Fault overflows' },
    objectives: ['Pulse', 'Guardians'],
    timers: ['Seal time', 'Overflow'],
    hints: [
      'Walk to the crack to open it. Ignore it and it closes.',
      'Lure guardians into the marked wedge and step out before it erupts.',
      'Two wedges are shown ahead. Plan your route.',
      'Overflowing. Clear the field.',
    ],
  },
  pactAltar: PACT_TEXT,
  orchard: ORCHARD_TEXT,
  ring: RING_TEXT,
  host: HOST_TEXT,
  anvil: ANVIL_TEXT,
  bellwatch: BELLWATCH_TEXT,
  voidBreach: BREACH_TEXT,
};
