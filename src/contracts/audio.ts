// FROZEN CONTRACT — procedural WebAudio engine. src/audio/index.ts must `export function createAudio(): AudioEngine`.
// No audio files: every sound effect and the music are synthesised with the Web Audio API.

export const SFX_IDS = [
  // skills
  'castEmber', 'castNova', 'castWave', 'castFrost', 'castArc', 'dash', 'ward', 'notEnoughFocus',
  // impacts
  'hitFire', 'hitCold', 'hitLightning', 'hitVoid', 'hitPhysical', 'crit', 'evade',
  // monsters
  'monsterDeath', 'monsterDeathBig', 'monsterAttack', 'monsterSpit', 'monsterLeap', 'monsterSlam',
  'heraldCall', 'bossRoar', 'bossSlam', 'eruption',
  // player
  'playerHurt', 'playerDeath', 'levelUp', 'flaskLife', 'flaskFocus', 'allyJoin', 'partyInvite', 'chat',
  // loot
  'dropNormal', 'dropMagic', 'dropRare', 'dropUnique', 'dropCurrency', 'dropMap',
  'pickupItem', 'pickupCurrency', 'mote',
  // run flow
  'waveTell', 'waveStart', 'bossSpawn', 'cleared', 'chestOpen', 'portalOpen', 'portalEnter',
  // ui & crafting
  'uiClick', 'uiHover', 'uiOpen', 'uiClose', 'uiError', 'equip',
  'craftArm', 'craftApply', 'craftRare', 'craftScar', 'craftFinish', 'craftCorrupt', 'buy',
  // wave 5: player debuffs + Rimed Ossuary / Iron Coliseum rosters (see contracts/bestiary.ts)
  'debuffChill', 'debuffFreeze', 'debuffRoot', 'debuffBurn', 'debuffBleed', 'debuffShock', 'debuffWither', 'debuffCleanse',
  'boneRattle', 'ghostWail', 'webShot', 'wispPulse', 'wispBurst', 'golemSlam', 'choirSing',
  'wardenNova', 'glacialSpikes', 'icePrison', 'blizzardLoop',
  'houndBite', 'chainThrow', 'crossbowAim', 'crossbowShot', 'shieldBlock', 'tarSplat',
  'chainWhirl', 'varkusCharge', 'varkusWhirl', 'executionMark', 'arenaSpikes', 'crowdRoar',
  // map events (Event Director v2): omen, onset, ladder step, lock/whiff/hit, return, seal, erupt, grade chords, fail, heartbeat
  'eventOmen', 'eventOnset', 'eventStep', 'eventLock', 'eventWhiff', 'eventHit', 'eventReturn', 'eventSeal', 'eventErupt',
  'eventBronze', 'eventSilver', 'eventGold', 'eventFail', 'eventBeat',
  // map events, wave 2: the Echoing's choir hum (a loop), Caravan wheels and shield line, Pact Altar, Ashseed Orchard, Champion's
  // Ring, Stasis Host, Wayside Anvil, Bellwatch, Void Breach
  'eventHum', 'wheelBreak', 'shieldBreak',
  'pactStone', 'pactSeal', 'pactWave',
  'bloomGrow', 'bloomHarvest', 'bloomBite', 'bloomWither',
  'ringRise', 'ringChain', 'ringSlam',
  'hostThaw', 'prismShatter', 'hostWake',
  'anvilStrike', 'anvilCharged', 'anvilForge',
  'bellToll', 'cantorFall', 'dirge',
  'voidTide', 'voidSurge', 'heartCrack',
  // the Atlas (brief A 5.5 and D slice F1): table open, node hover/select, zoom, the discovery road and reveal, a sealed door
  // opening, pins, and the daily surge (a charge spent at activation, Hourglass Sand / Grand Hourglass refills)
  'atlasOpen', 'atlasHover', 'atlasSelect', 'atlasRoute', 'atlasReveal', 'atlasSeal', 'atlasZoom',
  'atlasPin', 'atlasUnpin', 'surgeSpend', 'surgeRefill',
  // power rework SK2 roster batch 1: casts (Spark, Cinder Mortar, Umbral Bolt, Kinetic Lance, Frost Orb, Storm Call), the two
  // self-buffs (Phase Stride, Arcane Reprieve), Glacial Nova's burst, the mortar's landing, a Storm Call bolt, a Glacial Spike
  'castSpark', 'castMortar', 'castUmbral', 'castKinetic', 'castOrb', 'castStormCall', 'phaseStride', 'arcaneReprieve',
  'glacialNovaBurst', 'mortarBlast', 'stormCallStrike', 'frostSpike',
] as const;
export type SfxId = (typeof SFX_IDS)[number];

export const MUSIC_IDS = ['title', 'hideout', 'map', 'boss'] as const;
export type MusicId = (typeof MUSIC_IDS)[number];

export interface PlayOptions {
  /** World position for stereo pan + distance attenuation relative to the listener. */
  x?: number;
  y?: number;
  volume?: number;   // 0..1 multiplier
  /** Playback pitch multiplier (1 = normal); callers add small random variation. */
  pitch?: number;
}

export interface AudioEngine {
  readonly unlocked: boolean;
  /** Must be called from a user gesture (click / keydown). Safe to call repeatedly. */
  unlock(): Promise<void>;
  play(id: SfxId, opts?: PlayOptions): void;
  setListener(x: number, y: number): void;
  /** Crossfade to a track (null = silence). */
  setMusic(id: MusicId | null): void;
  /** 0..1 — raises music energy (wave pressure, boss). */
  setIntensity(v: number): void;
  setVolumes(v: { master: number; music: number; sfx: number }): void;
  dispose(): void;
}

export type CreateAudio = () => AudioEngine;
