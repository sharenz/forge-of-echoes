/** Scrap sinks. Hard crafting currencies retain their separate, scarce drop sources. */
export const STABILITY_REPAIR = { base: 8, perCraft: 3, perRepairSquared: 6 } as const;
export const MAP_MOD_REROLL = { base: 3, perTier: 1 } as const;
export const BOUNTY_COMMISSION = { base: 8, perTier: 2 } as const;
/** T1–T3 free; T4–6 cost 1, T7–9 cost 2, T10–12 cost 3, T13–15 cost 4. */
export const MAX_TERRITORY_FEE = 4;
