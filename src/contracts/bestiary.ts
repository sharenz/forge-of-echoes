// FROZEN CONTRACT — per-map-type monster rosters, player debuffs, and the sprite/sound ids they need (GAME_SPEC §13–§14).
// These ids are merged into content.ts MONSTER_KINDS, sim.ts PROJECTILE_KINDS / AREA_KINDS, art.ts REQUIRED_SPRITES and
// audio.ts SFX_IDS (all appended, so existing wire indices stay stable).

export const OSSUARY_MONSTERS = ['boneThrall', 'rimeshade', 'frostWeaver', 'glacialWisp', 'ossuaryGolem', 'boneChorister', 'hollowWarden'] as const;
export const COLISEUM_MONSTERS = ['pitHound', 'chainThrall', 'ironCrossbowman', 'shieldbearer', 'tarSlinger', 'chainmaster', 'varkus'] as const;
export const NEW_MONSTER_KINDS = [...OSSUARY_MONSTERS, ...COLISEUM_MONSTERS] as const;
export type NewMonsterKind = (typeof NEW_MONSTER_KINDS)[number];

/** Which roster a map theme uses (the Ashen Forge / hideout keep the original kinds). */
export const THEME_ROSTER = {
  ashenForge: { family: ['ashling', 'emberSkitter', 'cinderSpitter', 'riftStalker', 'ironhideBrute'], lieutenant: 'ashboundHerald', boss: 'cinderMatriarch' },
  rimedOssuary: { family: ['boneThrall', 'rimeshade', 'frostWeaver', 'glacialWisp', 'ossuaryGolem'], lieutenant: 'boneChorister', boss: 'hollowWarden' },
  ironColiseum: { family: ['pitHound', 'chainThrall', 'ironCrossbowman', 'shieldbearer', 'tarSlinger'], lieutenant: 'chainmaster', boss: 'varkus' },
} as const;

export const PLAYER_DEBUFFS = ['chilled', 'frozen', 'rooted', 'burning', 'bleeding', 'shocked', 'withered'] as const;
export type PlayerDebuff = (typeof PLAYER_DEBUFFS)[number];

export const NEW_PROJECTILE_KINDS = [
  'webShot',        // frost weaver: slow, roots
  'frostShard',     // warden / golem shards
  'crossbowBolt',   // iron crossbowman: fast, bleed
  'chainHook',      // chain thrall / chainmaster: line projectile, roots + pulls
  'tarGlob',        // tar slinger: lob (uses ProjectileStoreView.life), leaves a tar pool
  'boneShard',      // chorister / thrall debris
] as const;

export const NEW_AREA_KINDS = [
  'frostNovaWarning', // warden nova ring telegraph
  'glacialSpike',     // sequential spike eruption (telegraph → burst)
  'icePrison',        // shrinking ring around a player; frozen if inside when it closes
  'blizzard',         // drifting frost storm zone (chills inside)
  'choirWave',        // chorister's expanding frost ring with gaps
  'wispBurst',        // glacial wisp pulse telegraph
  'tarPool',          // tar: slow inside, root on first contact
  'chargeLine',       // varkus / crossbow aim telegraph along a line (x,y = start; radius = length)
  'executionMark',    // mark under a player; heavy strike after 3 s
  'arenaSpikes',      // crowd's favour spike tile telegraph → burst
  'whirlwind',        // varkus/chainmaster spinning damage ring
] as const;

const MONSTER_ANIMS = ['idle', 'move', 'windup', 'attack'] as const;

/** Sprites art must provide for wave 5 (same conventions as art.ts: monsters face east, bottom-centre anchored). */
export const NEW_REQUIRED_SPRITES: readonly string[] = [
  ...NEW_MONSTER_KINDS.flatMap((m) => [...MONSTER_ANIMS.map((a) => `monster/${m}/${a}`), `monster/${m}/corpse`]),
  // extra action sets
  'monster/glacialWisp/burst', 'monster/chainThrall/throw', 'monster/shieldbearer/block', 'monster/varkus/charge', 'monster/varkus/whirl',
  'monster/hollowWarden/cast', 'monster/boneChorister/sing', 'monster/chainmaster/whirl',
  // projectiles (centre anchored, pointing east)
  ...NEW_PROJECTILE_KINDS.map((p) => `proj/${p}`),
  // debuff overlays on the player (centre/feet anchored; looped where it makes sense)
  'fx/debuff/chilled', 'fx/debuff/frozen', 'fx/debuff/rooted', 'fx/debuff/burning', 'fx/debuff/bleeding', 'fx/debuff/shocked', 'fx/debuff/withered',
  // area visuals
  'fx/iceSpike', 'fx/icePrison', 'fx/blizzard', 'fx/tarPool', 'fx/web', 'fx/chain', 'fx/arenaSpike', 'fx/executionMark', 'fx/shieldArc',
];

/** HUD icons (DOM) for debuffs: `icon/debuff/<id>`. */
export const DEBUFF_ICON_IDS: readonly string[] = PLAYER_DEBUFFS.map((d) => `icon/debuff/${d}`);

/** Sounds audio must provide for wave 5. */
export const NEW_SFX_IDS = [
  'debuffChill', 'debuffFreeze', 'debuffRoot', 'debuffBurn', 'debuffBleed', 'debuffShock', 'debuffWither', 'debuffCleanse',
  'boneRattle', 'ghostWail', 'webShot', 'wispPulse', 'wispBurst', 'golemSlam', 'choirSing',
  'wardenNova', 'glacialSpikes', 'icePrison', 'blizzardLoop',
  'houndBite', 'chainThrow', 'crossbowAim', 'crossbowShot', 'shieldBlock', 'tarSplat',
  'chainWhirl', 'varkusCharge', 'varkusWhirl', 'executionMark', 'arenaSpikes', 'crowdRoar',
] as const;
