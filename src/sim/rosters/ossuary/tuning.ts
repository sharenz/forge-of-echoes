// Rimed Ossuary behaviour tuning (GAME_SPEC §14). Stats (life, damage, speed, XP, resistances) live in the
// MonsterDefs (./index.ts); these are the behaviour numbers. Damage figures are multiples of the monster's
// own scaled damage (monsterDamage), times, distances and radii are in seconds and world units.

/** Bone Thrall: a clattering skeleton — short windup, then a lunge-bite (the Ashling's rhythm). */
export const THRALL = { reach: 10, windup: 0.26, recover: 0.2, cooldown: 1.2, lunge: 9 } as const;

/**
 * Bone Thrall leap (rosters/pressure.ts gapLeap; pairs are [tier-1 map, full ramp], behaviour.ts byLevel): the Ashling's
 * gap-closer. Tier 1: one short, light hop every ~11 s from 60-100 units out, landing where the player stands. Full ramp:
 * every ~4.5 s from up to 190 out, a 0.4 s crouch, landing where a steadily walking player will be, 150 units of reach.
 */
export const THRALL_LEAP = {
  minRange: 60, maxRange: [100, 190] as readonly [number, number], cooldown: [11, 4.5] as readonly [number, number], jitter: 1.5,
  windup: [0.6, 0.4] as readonly [number, number], recover: [0.6, 0.4] as readonly [number, number],
  hop: [70, 150] as readonly [number, number], aim: [0, 0.7] as readonly [number, number], radius: 20,
  mult: [0.5, 0.9] as readonly [number, number],
} as const;

/** Rimeshade: a ghost that drifts in on a slow weave, glides the last stretch, touches (chills) and fades back. */
export const SHADE = {
  /** Weave while drifting in: amplitude (radians off the straight line) and frequency (rad/s). */
  weaveAmp: 0.6,
  weaveFreq: 1.7,
  /** Inside this distance it stops weaving and glides straight at its player… */
  closeIn: 100,
  /**
   * …this much faster than its drift: 56 × 1.4 ≈ 78 units/s, well under a walking player's 110. Speed-ups
   * stack on it (the Chorister's haste +25%, Swift / Frenzied packs, map mods) and can carry a glide past
   * her pace — which is why it fades back after every touch instead of clinging to its victim.
   */
  glide: 1.4,
  /** Touch: reach beyond its body, windup (the reaching pose), damage multiple. */
  reach: 6,
  windup: 0.24,
  mult: 1.15,
  /** After a touch it fades back for this long at this share of its speed (ghosts don't pile on a victim). */
  recoil: 0.6,
  recoilSpeed: 0.7,
  /** Seconds of the strike pose before the fade-back drifts (the attack sprite is 3 frames at 12 fps). */
  strikePose: 0.25,
  cooldown: 1.5,
} as const;

/**
 * Frost Weaver: keeps its distance and spits a slow web that roots (brains.ts brainWeaver).
 *
 * Aim: the web goes where a player who keeps walking as she is would meet it (the intercept, `aim` = 1
 * of it) whenever that meeting lies within the web's range: walking at it, or across it at an angle,
 * gets her caught; stopping, turning or stepping aside while it's in the air (1–2 s of a slow web on
 * screen) dodges it. A player crossing its line of fire squarely outpaces the intercept (the web is
 * barely faster than her walk, so the meeting would lie out of range): those shots take the short
 * `fallbackLead` instead, which only catches someone who slows down.
 *
 * Measured over whole bot-played maps (tests/sim-ossuary, seeds 1–8): the dodging bot, which sidesteps
 * every projectile within 100 units, is rooted 0–2 times a map (with the old fixed 0.25 s lead: almost never);
 * the careless bot (SLOPPY: stops walking 1.2 s in every 3) 2–6 times at Tier 5 and 1–10 at Tier 1,
 * with 0–2 freezes (wisp bursts, Ice Prisons). ROOT_GRACE keeps two webs from chaining a root.
 */
export const WEAVER = {
  near: 150, far: 230, fireRange: 280, windup: 0.6, cooldown: 3.4, jitter: 0.8,
  /** The spit's release pose (s). */
  recover: 0.25,
  /**
   * Web speed [tier-1 map, full ramp] (behaviour.ts byLevel): a slow, visible web at tier 1 (from 200 units away it
   * takes 1.7 s to arrive), 2.7x the walk at high tiers (0.7 s). The 0.6 s windup is the tell either way.
   */
  speed: [120, 300] as readonly [number, number], range: 300, radius: 6, mult: 0.4,
  /** Share of the intercept lead used [tier 1, full]; seconds of lead (× that share) when there's no intercept within range. */
  aim: [0.85, 1] as readonly [number, number], fallbackLead: 0.25,
  /** Extra webs per cast at the full ramp (a single web with a perfect intercept isn't trivial to sidestep). */
  extraShots: 0,
  /** Extra webs (map mods) fan out this far apart (radians). */
  spread: 0.15,
} as const;

/**
 * Frost Weaver's rime marker (rosters/pressure.ts markerDropper): after a web, a frostNovaWarning (damage only: the web is
 * the only root, so no rider) drops on where the player will be `delay` s from now and leaves a small chilling storm.
 * Tier 1: one every ~14 s, 1.6 s notice, on where they stand (40% lead), a 2 s storm. Full ramp: every ~6 s, 1.1 s notice,
 * the full intercept, a 4 s storm.
 */
export const WEAVER_MARK = {
  kind: 'frostNovaWarning', radius: 30, delay: [1.6, 1.1] as readonly [number, number],
  cooldown: [14, 6] as readonly [number, number], jitter: 1.5, lead: [0.4, 1] as readonly [number, number],
  mult: [0.5, 1] as readonly [number, number], debuff: null, spacing: 50,
  linger: { kind: 'blizzard', mult: [0.3, 0.5] as readonly [number, number], duration: [2, 4] as readonly [number, number] },
} as const;

/** Glacial Wisp: weaves in, rushes the last stretch, pulses 0.7 s and shatters in a burst. */
export const WISP = {
  weaveAmp: 0.8,
  weaveFreq: 5.5,
  /** Within this distance (and with its opening delay over) it rushes straight in… */
  rushRange: 170,
  /** …this much faster. */
  rush: 1.45,
  /**
   * It stops to pulse when its player is this close beyond touching (body to body) — well inside the
   * burst's freezing core (WISP_FREEZE_FRACTION × radius from the ring's centre): a player who stands
   * still is frozen, one who takes a step within the 0.7 s is only chilled.
   */
  trigger: 2,
  /** The pulse telegraph (the wispBurst ring): seconds, radius; chill inside, freeze in its inner 40%. */
  pulse: 0.7,
  radius: 40,
  mult: 1.5,
} as const;

/** Ossuary Golem: a slow, armoured bruiser with a telegraphed frost slam in front of it (chills). */
export const GOLEM = { windup: 1.0, radius: 46, offset: 12, cooldown: 3.6, recover: 0.5, mult: 1.25 } as const;

/** Bone Chorister (lieutenant, wave 3). */
export const CHORISTER = {
  keepNear: 100,
  keepFar: 165,
  /** Haste aura radius (allies HASTE_BONUS faster, speed only). */
  haste: 110,
  /** Choir Wave: every `choirEvery` s a `choirCast` s toll, then `rings` rings `ringGap` s apart. */
  choirEvery: 4,
  choirFirst: 2.5,
  choirCast: 0.6,
  rings: 2,
  ringGap: 0.6,
  /** Each ring expands from `ringStart` to `ringEnd` over `ringTime` (≈ 105 units/s: a player keeps pace). */
  ringStart: 18,
  ringEnd: 440,
  ringTime: 4,
  /** Gaps per ring (choirWave variant = gaps − 1) and how far the second ring's gaps turn from the first's. */
  gaps: 3,
  gapTurn: 0.28,
  ringMult: 0.65,
  /** Raising: every `raiseEvery` s a `raiseCast` s chant, then thralls rise from up to `raiseCorpses` corpses
   *  within `raiseRadius`, topped up from the ground to at least `raiseMin`. */
  raiseEvery: 9,
  raiseFirst: 4.5,
  raiseCast: 0.9,
  raiseRadius: 260,
  raiseCorpses: 4,
  raiseMin: 2,
  /**
   * Ground raises appear this far from the Chorister. No chant starts, and nothing rises, on a saturated field
   * (SUMMON_FIELD_CAP): a Chorister the party can't reach used to raise a thrall wall every few seconds until
   * the horde itself kept it alive (balance pass: Tier 4–5 maps with 800+ kills and the lieutenant still up at
   * the boss).
   */
  raiseRingMin: 30,
  raiseRingMax: 60,
  /** Thralls that arrive with it. */
  escorts: 4,
  release: 0.4,
} as const;

/** The Hollow Warden (boss, final wave). Per-phase values are [phase 1, phase 2, phase 3]. */
export const WARDEN = {
  roar: 1.3,
  /** Distance band: floats in beyond `keepFar`, drifts back inside `keepNear`, circles in between. */
  keepNear: 70,
  keepFar: 110,
  /** Lantern swing when a player is in reach (chills). */
  meleeReach: 8,
  meleeCd: 1.4,
  /** Seconds between the end of one big cast and the start of the next. */
  gap: 0.9,
  /** Pose held after every cast. */
  release: 0.35,

  /** Frost Nova (all phases): a disc telegraph around her; at the burst a ring of frost shards flies out. */
  nova: {
    telegraph: 1.2, radius: [100, 112, 124], mult: 1.6, cd: [7, 6, 5], first: 3, range: 380,
    shards: [14, 18, 22], shardSpeed: 105, shardRange: 440, shardRadius: 5, shardMult: 0.55,
    /**
     * The shard ring leaves from this share of the disc's radius (just outside her body), so a player who
     * stepped out of the disc sees it coming: 0.65–0.85 s from the burst to the disc's edge. (Walking
     * straight away outpaces it; the gaps between shards let a sidestep through.)
     */
    shardStart: 0.3,
  },
  /** Frost shard volley (all phases): a fan at her player. */
  volley: {
    cast: 0.45, count: [5, 5, 7], spread: 0.14, range: 460, radius: 5, mult: 0.7, cd: [3.4, 3.0, 2.6], first: 1.5,
    /** Shard speed and intercept share [tier 1, full ramp]; the fan grows by `extraShots` at the full ramp. */
    speed: [170, 340] as readonly [number, number], aim: [0.5, 1] as readonly [number, number], fallbackLead: 0.3, extraShots: 2,
  },
  /** Glacial Spikes (phase 2+): lines of spikes erupting in sequence toward players; a fan of three in phase 3. */
  spikes: {
    cast: 0.6, first: 0.8, step: 0.06, spacing: 24, radius: 15, mult: 1.8, cd: [7, 6.5, 5.5], range: 480, fan: 0.32,
    /** Spikes per line: to the player and `overshoot` past, within [minCount, maxCount] (maxCount reaches range + overshoot). */
    minCount: 8, maxCount: 23, overshoot: 70, maxLines: 4,
  },
  /** Ice Prison (phase 2+): a ring closing on a player; frozen if still inside when it closes. */
  prison: { cast: 0.5, radius: 50, close: 2, mult: 0.5, cd: [8, 8, 6.5], range: 460 },
  /**
   * Summons Rimeshades (all phases): 'summon' as her 0.6 s cast starts, the shades rise around her as it
   * ends — neither on a saturated field (SUMMON_FIELD_CAP). Ghosts gather round their victim and soak her
   * bolts, so a few per call keeps the Warden a fight rather than a wall of ghosts.
   */
  summon: { cast: 0.6, count: [2, 2, 3], cd: [14, 13, 12], first: 7, rMin: 40, rMax: 80 },
  /** Blizzard (phase 3): three drifting storms that chill (and nip) everyone inside. */
  blizzard: {
    cast: 0.8, count: 3, radius: 58, duration: 12, speedMin: 20, speedMax: 28, tick: 0.5, mult: 0.15, cd: 12.5,
    /**
     * Placed around her player (evenly, ± `spreadJitter` radians) this far away, at least `clear` beyond its
     * radius from every living player (a storm with no such spot — a party spread all around her player —
     * is pushed out past the nearest player, or not cast); each drifts toward where that player stood (± `headingJitter`), so the three sweep
     * across the fight from different sides.
     */
    near: 110, far: 230, clear: 30, spreadJitter: 0.45, headingJitter: 0.6,
  },
} as const;
