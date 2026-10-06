// The Sorceress passive tree, "the Orrery" (docs/power-rework/passive-tree.md). Contract types only: the 252 nodes live in
// src/data/progression/passives, the rules in src/game/progression/passives.ts. The Orrery never shares an id namespace, a
// store path, a point counter or a hotkey with the Atlas tree (map-tree): passive ids all start with `pas.`.

/** A passive node id: `pas.<region>.<key>` (e.g. `pas.fire.kindle`, `pas.hub.spark`, `pas.cold.s4`). */
export type PassiveNodeId = `pas.${string}`;

/** The id namespace of every passive node. */
export const PASSIVE_ID_PREFIX = 'pas.';

/** Seven sectors clockwise from the top, around the hub. */
export const PASSIVE_SECTORS = ['fire', 'lightning', 'cold', 'bulwark', 'vitality', 'void', 'arcana'] as const;
export type PassiveSector = (typeof PASSIVE_SECTORS)[number];
export type PassiveRegion = 'hub' | PassiveSector;

export type PassiveKind = 'start' | 'small' | 'notable' | 'mastery' | 'keystone' | 'gate' | 'bridge';

/** A mastery offers this many riders; CharacterSave.masteries stores the index (0, 1 or 2) of the chosen one. */
export const MASTERY_CHOICES = 3;

/** The source prefix of every StatModifier a passive node adds: "Orrery: Kindle", "Orrery: small nodes". */
export const ORRERY_SOURCE = 'Orrery';

/** What a passive refund or mastery change costs right now (the client shows it, the command repeats it as `expectedScrap`). */
export interface PassiveRefundPrice {
  /** Forge Scrap (0 while the character's free refunds last). */
  scrap: number;
  /** Free refunds left before this one. */
  freeLeft: number;
}
