// Ashen Forge behaviour tuning (GAME_SPEC §8). Stats live in the MonsterDefs (./index.ts).
export const BEHAVIOUR = {
  ashling: { reach: 10, windup: 0.22, lungeTime: 0.15, lungeSpeed: 120, cooldown: 1.2 },
  /**
   * Anti-kiting leap (rosters/pressure.ts gapLeap; every pair is [tier-1 map, full ramp], behaviour.ts byLevel). Tier 1: one
   * short, slow, light hop every ~11 s from 60-100 units out, landing where the player stands. Full ramp: every ~4.5 s from
   * up to 190 out, a 0.4 s crouch, landing where a steadily walking player will be (70% of the lead), 150 units of reach.
   */
  ashlingLeap: {
    minRange: 60, maxRange: [100, 190] as readonly [number, number], cooldown: [11, 4.5] as readonly [number, number], jitter: 1.5,
    windup: [0.6, 0.4] as readonly [number, number], recover: [0.6, 0.4] as readonly [number, number],
    hop: [70, 150] as readonly [number, number], aim: [0, 0.7] as readonly [number, number], radius: 20,
    mult: [0.5, 0.9] as readonly [number, number],
  },
  /**
   * Ember marker (rosters/pressure.ts markerDropper): after a spit, an eruptionWarning drops on where the player will be
   * `delay` s from now, then leaves a burning pool. Tier 1: one every ~14 s, 1.6 s notice, half damage, on where they
   * stand (40% lead), a 2 s pool. Full ramp: every ~5.5 s, 1.0 s notice, the full intercept, a 4.5 s pool.
   */
  spitterMark: {
    kind: 'eruptionWarning' as const, radius: 32, delay: [1.6, 1.0] as readonly [number, number],
    cooldown: [14, 5.5] as readonly [number, number], jitter: 1.5, lead: [0.4, 1] as readonly [number, number],
    mult: [0.5, 1] as readonly [number, number], spacing: 50,
    linger: { kind: 'firePool' as const, mult: [0.15, 0.25] as readonly [number, number], duration: [2, 4.5] as readonly [number, number] },
  },
  skitter: { reach: 4, biteTime: 0.15, cooldown: 0.9, zigzagFreq: 6, zigzagAmp: 0.9, burstFreq: 5 },
  // Spit lands where the player will be `lead` seconds after release (partial lead: walking dodges it).
  spitter: {
    near: 140, far: 220, fireRange: 300, cooldown: 2.4, windup: 0.45, lead: 0.5, minRange: 40, range: 360, radius: 5, spread: 0.2,
  },
  stalker: { trigger: 190, minTrigger: 30, cooldown: 4, windup: 0.35, flight: 0.25, recover: 0.45, radius: 26 },
  brute: { windup: 0.9, radius: 42, cooldown: 3.2, recover: 0.4 },
  // The Herald's summons (GAME_SPEC §8: 6 ashlings every 6 s). A Herald left alive — it kited at 110–170 on foot at
  // 38, the horde screening it — used to add an ashling a second until the boss wave (balance pass: Tier 4–6 maps
  // with 800–940 kills). It now keeps closer and walks faster (MonsterDef speed 50), so a player who wants it can
  // reach it, and like every summoner it calls nobody onto a saturated field (SUMMON_FIELD_CAP).
  herald: {
    keepNear: 90, keepFar: 140, summonEvery: 6, summonCount: 6, summonCastTime: 0.45, orbEvery: 3, orbCount: 5,
    orbSpread: 0.7, orbRange: 420, orbRadius: 6, castTime: 0.5, releaseTime: 0.3,
    // Orb speed and intercept share [tier 1, full ramp]; the fan gains `orbExtra` orbs at the full ramp.
    orbSpeed: [140, 280] as readonly [number, number], orbAim: [0.3, 1] as readonly [number, number], orbFallbackLead: 0.3, orbExtra: 2,
  },
} as const;

/** Cinder Matriarch. */
export const MATRIARCH = {
  keep: 64,
  meleeCd: 1.3,
  spiralDuration: 2.0,
  spiralInterval: 0.1,
  spiralTurn: 0.23,
  spiralSpeed: 110,
  spiralRange: 520,
  orbRadius: 7,
  orbDamage: 0.5,
  spiralCd: [6, 5, 4.5],
  slamRadius: 70,
  slamWindup: 1.1,
  slamCd: 5,
  slamRange: 120,
  slamDamage: 1.8,
  slamRecover: 0.5,
  meteorCd: [9, 9, 7],
  meteorRadius: 28,
  meteorDamage: 1.2,
  meteorSpread: 150,
  /** Players within this distance of her share the meteor rain. */
  meteorReach: 520,
  poolDuration: 5,
  poolDamage: 0.25,
  chargeWindup: 0.9,
  chargeSpeed: 480,
  chargeCd: 8,
  chargeDamage: 1.6,
  chargeRadius: 26,
  chargeSpacing: 34,
  chargeRecover: 0.6,
  summonCd: [10, 10, 8],
  summonCount: 5,
  roar: 1.2,
} as const;
