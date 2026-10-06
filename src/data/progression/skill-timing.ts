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
} as const;
