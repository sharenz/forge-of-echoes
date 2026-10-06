// Behaviour timings of the roster skills (power rework SK2) that both the sim executor (src/sim/skills/behaviours) and the
// tooltips (game/progression/skills.ts) read, so the text and the behaviour cannot drift. Seconds unless noted.
export const SKILL_TIMING = {
  /** Spark: one spark hits the same enemy at most this often. */
  sparkRehit: 0.4,
  /** Cinder Mortar: the shell's flight time (it flies over cover and shields). */
  mortarFlight: 0.9,
  /** Storm Call: telegraph before each strike falls. */
  stormTelegraph: 0.7,
  /** Glacial Spikes: the first spike erupts after `spikeLead`, each next one `spikeStep` later. */
  spikeLead: 0.1,
  spikeStep: 0.05,
  /** Glacial Spikes, Twin Lines: the two lines leave this far either side of the aim (radians, 15°). */
  twinLineAngle: Math.PI / 12,
  /** Frost Orb: seconds between the orb's shards, their speed, reach and hit radius. */
  orbShardInterval: 0.25,
  orbShardSpeed: 360,
  orbShardRange: 180,
  /** Kinetic Lance: knockback multiplier of its hits (other skills 1, Ember Lance and friends). */
  kineticKnockback: 2,
  // Roster batch 2 (SK3)
  /** Zones and sigils land at the cursor, at most this far from her. */
  zoneReach: 360,
  /** A zone's slow, damage-taken bonus and Hex weakening last this long after a monster leaves it (seconds). */
  zoneLinger: 0.25,
  /** Immolation Sigil: seconds from the brand to the pillar; Twin Sigils sit this far either side of the cursor. */
  sigilTelegraph: 0.8,
  sigilTwinOffset: 40,
  /** Immolation Sigil, Brand Sigil: the pillar exposes fire by this many points (EXPOSURE.duration seconds). */
  brandExposure: 15,
  /** Voltaic Pulse: the ring's speed outward (units per second). */
  pulseSpeed: 500,
  /** Concussive Blast: knockback multiplier of its hits. */
  coneKnockback: 3,
  /** Static Lash: Arc Lash's second target takes this share; Tethered Chain's jump (range, share). */
  lashSecondShare: 0.6,
  lashChainShare: 0.5,
  lashJump: 90,
  /** Static Aegis: retaliation at most this often (seconds). */
  aegisGap: 0.25,
  /** Rime Bulwark: attackers within this radius are chilled; Brittle Retort's nova radius. */
  bulwarkChillRadius: 70,
  bulwarkRetortRadius: 90,
} as const;
