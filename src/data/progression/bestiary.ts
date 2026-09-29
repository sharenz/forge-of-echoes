// Player-facing bestiary text (GAME_SPEC §13–§14): monster names for item histories and map readouts, and
// the debuffs each map base's roster inflicts, with their counterplay. The sim owns the behaviour; the
// rosters themselves (family, lieutenant, boss per map theme) come from contracts/bestiary.ts THEME_ROSTER
// (see MAP_BASES in ./maps), so text and waves cannot drift apart.
import type { MapBaseId, MonsterKind } from '../../contracts/content';
import type { PlayerDebuff } from '../../contracts/bestiary';

/** Display names, as a boss bar or a label shows them. */
export const MONSTER_NAMES: Record<MonsterKind, string> = {
  ashling: 'Ashling',
  emberSkitter: 'Ember Skitter',
  cinderSpitter: 'Cinder Spitter',
  riftStalker: 'Rift Stalker',
  ironhideBrute: 'Ironhide Brute',
  ashboundHerald: 'Ashbound Herald',
  cinderMatriarch: 'Cinder Matriarch',
  trainingDummy: 'Training Dummy',
  boneThrall: 'Bone Thrall',
  rimeshade: 'Rimeshade',
  frostWeaver: 'Frost Weaver',
  glacialWisp: 'Glacial Wisp',
  ossuaryGolem: 'Ossuary Golem',
  boneChorister: 'Bone Chorister',
  hollowWarden: 'The Hollow Warden',
  pitHound: 'Pit Hound',
  chainThrall: 'Chain Thrall',
  ironCrossbowman: 'Iron Crossbowman',
  shieldbearer: 'Shieldbearer',
  tarSlinger: 'Tar Slinger',
  chainmaster: 'The Chainmaster',
  varkus: 'Varkus, the Iron Champion',
};

/** Plural display names (map readout roster lines: "Bone Thralls, Rimeshades, …"). */
export const MONSTER_PLURALS: Partial<Record<MonsterKind, string>> = {
  ashling: 'Ashlings',
  emberSkitter: 'Ember Skitters',
  cinderSpitter: 'Cinder Spitters',
  riftStalker: 'Rift Stalkers',
  ironhideBrute: 'Ironhide Brutes',
  boneThrall: 'Bone Thralls',
  rimeshade: 'Rimeshades',
  frostWeaver: 'Frost Weavers',
  glacialWisp: 'Glacial Wisps',
  ossuaryGolem: 'Ossuary Golems',
  pitHound: 'Pit Hounds',
  chainThrall: 'Chain Thralls',
  ironCrossbowman: 'Iron Crossbowmen',
  shieldbearer: 'Shieldbearers',
  tarSlinger: 'Tar Slingers',
};

/**
 * How a sentence names each lieutenant and boss: "Dropped by the Cinder Matriarch", "Wave 6: The Hollow
 * Warden" (titled names keep their capital "The"). Other monsters read "a rare Bone Thrall".
 */
export const MONSTER_SENTENCE_NAMES: Partial<Record<MonsterKind, string>> = {
  ashboundHerald: 'the Ashbound Herald',
  cinderMatriarch: 'the Cinder Matriarch',
  boneChorister: 'the Bone Chorister',
  hollowWarden: 'The Hollow Warden',
  chainmaster: 'The Chainmaster',
  varkus: 'Varkus, the Iron Champion',
};

export interface DebuffDef {
  id: PlayerDebuff;
  name: string;
  /** What it does (GAME_SPEC §13), a sentence fragment: "30% slower movement and casting for 2 seconds". */
  effect: string;
  /** How to deal with it, a sentence fragment: "Rift Step breaks it". */
  counterplay: string;
}

/** Player debuffs (GAME_SPEC §13). Cinder Ward halves every debuff duration while it is active. */
export const DEBUFFS: Record<PlayerDebuff, DebuffDef> = {
  chilled: {
    id: 'chilled', name: 'Chilled', effect: '30% slower movement and casting for 2 seconds',
    counterplay: 'Cold Resistance shortens it',
  },
  frozen: {
    id: 'frozen', name: 'Frozen', effect: 'cannot move or act for 0.8 seconds, then immune to Freeze for 3 seconds',
    counterplay: 'dodge the telegraph (only telegraphed attacks freeze); Cold Resistance shortens it',
  },
  rooted: {
    id: 'rooted', name: 'Rooted', effect: 'cannot move for 1.4 seconds, but can still cast',
    counterplay: 'Rift Step breaks it',
  },
  burning: {
    id: 'burning', name: 'Burning', effect: 'Fire damage over 3 seconds',
    counterplay: 'a Life Flask removes it; Fire Resistance shortens it',
  },
  bleeding: {
    id: 'bleeding', name: 'Bleeding', effect: 'Physical damage over 4 seconds, doubled while you move; stacks up to 3 times',
    counterplay: 'a Life Flask removes it; standing still avoids the doubling',
  },
  shocked: {
    id: 'shocked', name: 'Shocked', effect: '20% more damage taken for 2 seconds',
    counterplay: 'Lightning Resistance shortens it',
  },
  withered: {
    id: 'withered', name: 'Withered', effect: '12% lower resistances per stack for 4 seconds; stacks up to 3 times',
    counterplay: 'a Focus Flask removes it',
  },
};

/**
 * Which debuffs a map base's roster inflicts, and from what (map device readout: the phrases are joined as
 * "a, b and c"). Kept in step with the sim's riders by tests/game-progression/bestiary.test.ts. The Volcanic
 * map mod's eruptions (any base) add Burning; the readout adds that itself.
 */
export const MAP_AFFLICTIONS: Record<MapBaseId, readonly { debuff: PlayerDebuff; sources: readonly string[] }[]> = {
  ashenForge: [
    { debuff: 'burning', sources: ['Cinder Spitter lobs', 'the Matriarch’s orbs', 'fire pools'] },
    { debuff: 'withered', sources: ['Rift Stalker leaps', 'the Herald’s void orbs'] },
  ],
  rimedOssuary: [
    { debuff: 'chilled', sources: ['Rimeshades', 'Glacial Wisps', 'frost slams', 'the Choir Wave', 'the Warden’s frost'] },
    { debuff: 'rooted', sources: ['Frost Weaver web shots'] },
    { debuff: 'frozen', sources: ['Glacial Wisps bursting at point blank', 'the Warden’s Ice Prison'] },
  ],
  ironColiseum: [
    { debuff: 'bleeding', sources: ['Pit Hound bites', 'crossbow bolts', 'the Chainmaster’s whirling chains', 'Varkus'] },
    { debuff: 'rooted', sources: ['chain hooks', 'tar pools'] },
  ],
};

/** The source phrase the Volcanic map mod's eruptions add (any map base). */
export const HAZARD_AFFLICTION: { debuff: PlayerDebuff; source: string } = { debuff: 'burning', source: 'Volcanic eruptions' };
