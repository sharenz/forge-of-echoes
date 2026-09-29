// Iron Coliseum behaviour tuning (GAME_SPEC §14). Stats (life, damage, speed, XP…) live in the MonsterDefs
// (./index.ts); these are the behaviour numbers of the brains. Seconds, world units, and damage as multiples of
// the monster's own (scaled) damage.

/** Pit Hound: prowls round its prey while its bite recharges, crouches (the tell), then pounces. */
export const HOUND = {
  /** Starts a pounce when its body is this far from touching the target. */
  pounceReach: 24,
  /** Crouch before the pounce: the readable tell. */
  crouch: 0.3,
  /** The pounce: a straight dash along the direction locked when the crouch ends. */
  lungeTime: 0.2,
  lungeSpeed: 220,
  /** The bite lands if its body comes this close to touching during the pounce. */
  biteReach: 5,
  /** Bite pose held after the pounce. */
  recover: 0.35,
  cooldown: 2,
  jitter: 0.4,
  /** While the bite recharges it circles at about this distance instead of pressing in. */
  prowlRange: 64,
  prowlSpeed: 0.85,
} as const;

/** Chain Thrall: a hunter that throws its hook (roots + drags 40 units), then rushes in and rakes. */
export const THRALL = {
  /** Throws when the target is between these distances. */
  hookMin: 60,
  hookMax: 200,
  /** The hook whirls overhead (the tell) this long before the throw. */
  windup: 0.7,
  hookSpeed: 320,
  /** Flies at most this far (and at most 40 units past where the target stood). */
  hookRange: 240,
  hookRadius: 5,
  hookMult: 0.5,
  /** Throw pose held after the release. */
  throwPose: 0.35,
  cooldown: 7.5,
  jitter: 1.5,
  /** After a hook connects it rushes its rooted victim for this long, this much faster. */
  reelTime: 1.6,
  reelSpeed: 1.45,
  /** The rake: a short windup, then a strike if still in reach. */
  rakeReach: 8,
  rakeWindup: 0.2,
  rakePose: 0.3,
  rakeCooldown: 1.8,
  rakeMult: 0.65,
} as const;

/** Iron Crossbowman: a locked aim line per bolt (family.ts brainCrossbowman). */
export const CROSSBOW = {
  near: 150,
  far: 240,
  fireRange: 300,
  /** The aim: a locked laser line shown this long before the bolt (GAME_SPEC §14: 0.6 s). */
  windup: 0.6,
  cooldown: 5,
  jitter: 1,
  boltSpeed: 480,
  boltRange: 420,
  boltRadius: 3.5,
  /**
   * Extra bolts (the Splitting map mod) fan out to one side of the aimed one, this far apart (radians); every
   * bolt has its own aim line.
   */
  spread: 0.15,
  /** Volley discipline: at most this many crossbowmen aim at one player at once… */
  maxAimers: 2,
  /** …the others wait up to this long before looking again. */
  hold: 0.6,
} as const;

/** Shieldbearer: walks behind its tower shield; bashes whoever stands in front of it. */
export const SHIELD = {
  /** Full blocking arc (GAME_SPEC §14: 120°) and how fast the shield turns to follow its target. */
  arc: (2 * Math.PI) / 3,
  turnRate: 1.2,
  /** Walking speed factor while its target is outside the shield's front (it pivots to face them). */
  flankSpeed: 0.55,
  /** Starts a bash when its body is this far from touching a target in front of it. */
  bashReach: 16,
  /** cos of the half-angle in front of the shield the bash covers (±60°: the blocking arc). */
  frontCos: 0.5,
  /** The shield is hauled back (guard down: the opening) this long before the bash… */
  windup: 0.6,
  /** …and stays down this long after it. */
  recover: 0.7,
  cooldown: 3.2,
  mult: 0.8,
  /** A connecting bash shoves the player this far along the shield's heading. */
  knockback: 34,
  /** The bash carries the bearer forward this far. */
  lunge: 10,
} as const;

/** Tar Slinger (kit shooterBrain): lobs tar where its target is heading; the glob leaves a tar pool. */
export const TAR = {
  near: 140,
  far: 230,
  fireRange: 290,
  windup: 0.55,
  cooldown: 5.5,
  jitter: 1,
  /** A true lob: lands after this long (the presenter draws its arc and landing ring). */
  flight: 1.2,
  range: 330,
  radius: 6,
  /** Landing splash radius and damage (the pool's root is the real threat). */
  splash: 14,
  mult: 0.4,
  /** Aims where the target will be this many seconds after the release (partial lead). */
  lead: 0.6,
  /** Holds its throw (up to `hold` s) while tar already lies within this of the spot it would aim at. */
  tarredRadius: 12,
  hold: 0.8,
  /**
   * No carpets: it also holds while this many pools (lying, or globs still in flight) are within crowdRadius of
   * its target — the floor stays readable and a player can still outrun a Pit Hound.
   */
  maxNear: 3,
  crowdRadius: 160,
} as const;

/** The Chainmaster (lieutenant). */
export const CHAINMASTER = {
  keepNear: 30,
  keepFar: 120,
  meleeReach: 10,
  meleeCd: 1.3,
  /** Hook: aimed at the farthest living player within hookMax, when they are at least hookMin away. */
  hookEvery: 6,
  hookFirst: 2,
  hookCast: 0.6,
  hookRelease: 0.4,
  hookMin: 110,
  hookMax: 460,
  hookSpeed: 380,
  hookRadius: 6,
  hookMult: 0.5,
  /** The drag: brings the victim to about `hookLeave` units from him (between 40 and PULL_MAX_DISTANCE). */
  hookLeave: 50,
  /**
   * No whirl may start this long after a hook is thrown: the blades (whirlCast later) only turn once the
   * victim's root (1.4 s after the hook lands) has long run out.
   */
  hookGate: 2,
  /** Chain whirl: a harmless ring for the cast, then spinning chains that bleed. */
  whirlEvery: 7,
  whirlFirst: 3.5,
  whirlRange: 100,
  whirlCast: 0.9,
  whirlChannel: 2.2,
  whirlRelease: 0.5,
  whirlRadius: 64,
  whirlTick: 0.35,
  whirlMult: 0.4,
  whirlSpeed: 0.55,
  /** Summons Chain Thralls while fewer than summonCap of them are within summonCountRadius. */
  summonEvery: 11,
  summonFirst: 5,
  summonCast: 0.7,
  summonCount: 3,
  summonCap: 5,
  summonCountRadius: 320,
  /** Arrives with this many Chain Thralls. */
  escorts: 3,
} as const;

/** Varkus, the Iron Champion (boss). */
export const VARKUS = {
  keepNear: 30,
  keepFar: 60,
  roar: 1.2,
  /** Cleave: a telegraphed overhead strike into the sand ahead of him. */
  cleaveEvery: 4,
  cleaveFirst: 1.5,
  cleaveCast: 0.9,
  cleaveRelease: 0.5,
  cleaveRange: 76,
  cleaveOffset: 18,
  cleaveRadius: 44,
  cleaveMult: 1.4,
  /** Charge: the lane shows for the cast, then he dashes its length in chargeDash (see varkus.ts). */
  chargeEvery: 7,
  chargeFirst: 3,
  chargeCast: 0.9,
  chargeDash: 0.7,
  chargeChannel: 1.2,
  chargeRelease: 0.8,
  chargeRange: 420,
  chargeMult: 1.2,
  chargeKnockback: 36,
  /** Execution Mark: follows its player for markLock s, strikes at markTime s; he leaps onto it. */
  markEvery: 11,
  markFirst: 5,
  markCast: 0.4,
  markRelease: 0.3,
  markTime: 3,
  markLock: 2,
  markRadius: 36,
  markMult: 1.8,
  markRange: 480,
  /**
   * The leap onto the mark: airborne for its last leapFlight s, then a recovery (the opening). The presenter's
   * arc (src/present/bestiary.ts LEAP_ARC.varkus.flight) must match — retune both together.
   */
  leapFlight: 0.5,
  leapRecover: 0.7,
  /** Whirlwind (phase 2+): a harmless ring for the cast, then spinning blades that bleed as he walks. */
  whirlEvery: 9,
  whirlFirst: 2,
  whirlRange: 160,
  whirlCast: 0.7,
  whirlChannel: 3,
  whirlRelease: 0.6,
  whirlRadius: 58,
  whirlTick: 0.35,
  whirlMult: 0.35,
  whirlSpeed: 0.75,
  /** Crowd's Favour (phase 3): spike tiles rise in a pattern round every player near him. */
  crowdEvery: 9,
  crowdFirst: 1.5,
  crowdCast: 0.8,
  crowdRelease: 0.3,
  crowdReach: 520,
  spikeRadius: 13,
  spikeMult: 1.1,
  /**
   * Roots never take a dodge away: no charge, cleave, whirl or Crowd's Favour starts on a held player (rooted or
   * being dragged), and while a held player stands in his lane, his cleave's circle or a spike tile,
   * that telegraph never gets closer than walkOut s to landing — freed, they always have that long to step out
   * (a lane from its axis at half speed in tar: 29 units, 0.53 s). At most maxHold s of holding per telegraph /
   * Crowd's Favour call.
   */
  walkOut: 0.6,
  maxHold: 2.5,
  /** Pit Hound summons: phase 1 / phase 2+. */
  summonCast: 0.6,
  summonEvery: [15, 12],
  summonFirst: [8, 3],
  summonCount: [3, 3],
  summonCap: 8,
  summonCountRadius: 360,
} as const;
