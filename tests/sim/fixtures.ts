// Realistic fixtures for sim tests (numbers follow GAME_SPEC §3–§4 so the sim is exercised with
// the same shapes the rules will hand it).
import type { SkillId, Theme } from '../../src/contracts/content';
import type { EventRewardContext } from '../../src/contracts/map-events';
import type { Rng } from '../../src/contracts/rng';
import type {
  DropSpec, DropSprite, FlaskRuntime, KillLootContext, MonsterScaling, PlayerCombatStats, PlayerIntent, PlayerJoin, PlayerRuntime, RunConfig,
  RunHooks, SimRun, SkillRuntimeDef, WaveConfig,
} from '../../src/contracts/sim';
import { createRunInternal } from '../../src/sim/run';
import type { World } from '../../src/sim/world';

export interface SkillOpts {
  /** Character level (spell power = 5 + 1.6·(L−1)). */
  level?: number;
  addedSpellDamage?: number;
  /** Σ increased spell/element damage in percent. */
  increased?: number;
  castSpeed?: number;
  critMultiplier?: number;
  flags?: string[];
}

const lerpRank = (a: number, b: number, rank: number) => a + ((b - a) * (rank - 1)) / 19;

/** A SkillRuntimeDef resolved the way GAME_SPEC §4 describes. */
export function makeSkill(id: SkillId, rank = 1, o: SkillOpts = {}): SkillRuntimeDef {
  const level = o.level ?? 1;
  const power = 5 + 1.6 * (level - 1) + (o.addedSpellDamage ?? 0);
  const inc = 1 + (o.increased ?? 0) / 100;
  const cs = o.castSpeed ?? 1;
  const base: SkillRuntimeDef = {
    id, rank, focusCost: 0, castTime: 0, cooldown: 0, charges: 1, damage: 0, damageType: 'fire', critChance: 0.05,
    critMultiplier: o.critMultiplier ?? 1.5, ailmentChance: 0, projectiles: 1, pierce: 0, projectileSpeed: 0, range: 0,
    spread: 0, radius: 0, duration: 0, chains: 0, distance: 0, damageReduction: 0, flags: o.flags ?? [],
  };
  const dmg = (eff: number) => power * eff * inc;
  switch (id) {
    case 'emberLance':
      return {
        ...base, castTime: 0.42 / cs, damage: dmg(lerpRank(1, 2.3, rank)), critChance: 0.06, ailmentChance: 0.1,
        projectileSpeed: 420, range: 320, pierce: (rank >= 6 ? 1 : 0) + (rank >= 12 ? 1 : 0) + (rank >= 18 ? 1 : 0),
      };
    case 'emberNova':
      return {
        ...base, focusCost: 12, castTime: 0.55 / cs, cooldown: 3, damage: dmg(lerpRank(0.7, 1.5, rank)),
        projectiles: Math.min(24, 12 + Math.max(0, rank - 4)), range: 170, projectileSpeed: 260, pierce: 1 + Math.floor(rank / 5),
        critChance: 0.05, ailmentChance: 0.15,
      };
    case 'flameWave':
      return {
        ...base, focusCost: 16, castTime: 0.5 / cs, cooldown: 4, damage: dmg(lerpRank(1.1, 2.4, rank)),
        projectiles: 5 + Math.floor((4 * (rank - 1)) / 19), spread: 0.9, projectileSpeed: 180, range: 170, radius: 14,
        ailmentChance: 0.25,
      };
    case 'rimeShards':
      return {
        ...base, focusCost: 8, castTime: 0.34 / cs, damage: dmg(lerpRank(0.55, 1.2, rank)), damageType: 'cold',
        projectiles: 3 + Math.floor(rank / 4), spread: 0.35, projectileSpeed: 360, range: 260, pierce: 2,
        ailmentChance: 0.3, critChance: 0.08,
      };
    case 'arcChain':
      return {
        ...base, focusCost: 14, castTime: 0.38 / cs, cooldown: 1, damage: dmg(lerpRank(0.9, 2.0, rank)), damageType: 'lightning',
        chains: 3 + Math.floor((5 * (rank - 1)) / 19), radius: 90, ailmentChance: 0.25, critChance: 0.1,
      };
    case 'riftStep':
      return {
        ...base, focusCost: 8, castTime: 0, cooldown: 3.5, charges: 2 + (rank >= 10 ? 1 : 0) + (rank >= 20 ? 1 : 0),
        distance: lerpRank(90, 120, rank), damageType: 'void', critChance: 0,
      };
    case 'cinderWard':
      return {
        ...base, focusCost: 20, castTime: 0.3 / cs, cooldown: lerpRank(14, 9, rank), duration: lerpRank(4, 7, rank),
        damageReduction: lerpRank(0.35, 0.55, rank), radius: 40, damage: dmg(0.25),
      };
  }
}

export function makeStats(o: Partial<PlayerCombatStats> = {}): PlayerCombatStats {
  return {
    maxLife: 80,
    lifeRegen: 0,
    maxFocus: 70,
    focusRegen: 3 + 0.02 * 70,
    armor: 0,
    evasion: 0.1,
    resist: { physical: 0, fire: 0, cold: 0, lightning: 0, void: 0 },
    damageTaken: 1,
    moveSpeed: 110,
    pickupRadius: 60,
    lifeOnKill: 0,
    focusOnKill: 0,
    flaskEffect: 1,
    pen: { physical: 0, fire: 0, cold: 0, lightning: 0, void: 0 },
    maxResist: 75,
    flags: [],
    ...o,
  };
}

/** A well-geared level ~24 sorceress: comfortably clears a tier-5 map with the bot. */
export function strongStats(o: Partial<PlayerCombatStats> = {}): PlayerCombatStats {
  return makeStats({
    maxLife: 500, lifeRegen: 3, maxFocus: 200, focusRegen: 18, armor: 60, evasion: 0.2,
    resist: { physical: 0, fire: 0.3, cold: 0.3, lightning: 0.3, void: 0.2 }, moveSpeed: 125, pickupRadius: 80,
    lifeOnKill: 2, focusOnKill: 1, ...o,
  });
}

export function strongSkills(): SkillRuntimeDef[] {
  const o: SkillOpts = { level: 24, addedSpellDamage: 10, increased: 110, castSpeed: 1.2, critMultiplier: 1.6 };
  return [
    makeSkill('emberLance', 12, o),
    makeSkill('emberNova', 12, o),
    makeSkill('rimeShards', 8, o),
    makeSkill('arcChain', 10, o),
    makeSkill('riftStep', 10, o),
    makeSkill('cinderWard', 8, o),
  ];
}

/**
 * A level ~22 sorceress geared *fairly* for a tier-5 map: she clears it, but the waves hurt (no
 * life-on-kill sustain, modest defences), so a pacing regression that turns maps into a stroll
 * shows up as a missing dip in her life.
 */
export function fairStats(o: Partial<PlayerCombatStats> = {}): PlayerCombatStats {
  return makeStats({
    maxLife: 320, lifeRegen: 1.5, maxFocus: 160, focusRegen: 12, armor: 35, evasion: 0.15,
    resist: { physical: 0, fire: 0.25, cold: 0.2, lightning: 0.2, void: 0.1 }, moveSpeed: 120, pickupRadius: 70,
    lifeOnKill: 0, focusOnKill: 1, ...o,
  });
}

export function fairSkills(): SkillRuntimeDef[] {
  const o: SkillOpts = { level: 22, addedSpellDamage: 8, increased: 60, castSpeed: 1.15, critMultiplier: 1.55 };
  return [
    makeSkill('emberLance', 10, o),
    makeSkill('emberNova', 10, o),
    makeSkill('rimeShards', 6, o),
    makeSkill('arcChain', 8, o),
    makeSkill('riftStep', 8, o),
    makeSkill('cinderWard', 6, o),
  ];
}

/** Monster scaling of a tier-5 map (life ×1.16⁴, damage ×1.10⁴). Level 28 is the real Tier 5; pack chances sit a little under the old 15%/5% since the Tier 2+ rare/magic life floor (power rework) made each elite pack tougher. */
export const TIER5: Partial<MonsterScaling> = { level: 28, lifeMultiplier: 1.8, damageMultiplier: 1.46, magicPackChance: 0.1, rarePackChance: 0.04 };

export const STRONG_LOADOUT: (SkillId | null)[] = ['emberLance', 'emberNova', 'arcChain', 'rimeShards', 'cinderWard', 'riftStep'];

export function makeFlasks(): (FlaskRuntime | null)[] {
  return [
    { flaskId: 'lifeFlask', count: 3, resource: 'life', amount: 120, duration: 3 },
    { flaskId: 'lifeFlask', count: 3, resource: 'life', amount: 120, duration: 3 },
    { flaskId: 'focusFlask', count: 3, resource: 'focus', amount: 80, duration: 3 },
    null,
  ];
}

export function makeScaling(o: Partial<MonsterScaling> = {}): MonsterScaling {
  return {
    level: 12, lifeMultiplier: 1, damageMultiplier: 1, speedMultiplier: 1, countMultiplier: 1, magicPackChance: 0.1,
    rarePackChance: 0.03, resistBonus: 0, xpMultiplier: 1, extraProjectiles: 0, hazards: false, ...o,
  };
}

export function makeWaves(o: Partial<WaveConfig> = {}): WaveConfig {
  return { count: 6, baseMonsters: 40, monstersPerWave: 18, waveDuration: 60, tellDuration: 3, lieutenantWave: 0, bossWave: 6, ...o };
}

export interface KillRoll {
  ctx: KillLootContext;
  playerIds: number[];
}

export interface HookLog {
  killRolls: KillRoll[];
  chestRolls: number[][];
  /** Every map-event payout the sim asked for (Event Director v2). */
  eventRolls: { ctx: EventRewardContext; playerIds: number[] }[];
  /** Tokens picked up, in order (any player). */
  pickups: number[];
  pickupsBy: { playerId: number; token: number }[];
  blocked: number;
  specs: DropSpec[];
}

export interface HookOptions {
  /** Chance a regular kill drops something for each player (rolled on the provided loot rng). */
  dropChance?: number;
  /** When it returns true, tryPickup fails for that player (inventory full). */
  full?: (playerId: number) => boolean;
  /**
   * DropSpec.autoPickup of the rolled loot: true (default — every drop is walked over, the shape most
   * flow tests and the bot rely on), false, or per sprite (`rulesAutoPickup`: what the rules do).
   */
  autoPickup?: boolean | ((sprite: DropSprite) => boolean);
}

/** The rules' default (rules.dropSpec): equipment is clicked, currency / flasks / maps are walked over. */
export const rulesAutoPickup = (sprite: DropSprite): boolean => sprite !== 'equipment';

/** A public floor item (what the server hands SimRun.spawnDrop for an item a player dropped). */
export function floorSpec(token: number, o: Partial<DropSpec> = {}): DropSpec {
  return {
    token, owner: 0, autoPickup: false, label: 'Ashwood Wand', tone: 'magic', sprite: 'equipment', iconId: 'icon/base/ashwoodWand', ...o,
  };
}

const TONES: DropSpec['tone'][] = ['normal', 'magic', 'rare', 'currency', 'map', 'flask'];

/**
 * Recording hooks that behave like the server's: loot is rolled separately for every player id
 * handed in (instanced), tokens are minted here and resolved on pickup.
 */
export function makeHooks(opts: HookOptions = {}): { hooks: RunHooks; log: HookLog } {
  const log: HookLog = { killRolls: [], chestRolls: [], eventRolls: [], pickups: [], pickupsBy: [], blocked: 0, specs: [] };
  let token = 1;
  const spec = (rng: Rng, owner: number): DropSpec => {
    const tone = rng.pick(TONES);
    const sprite: DropSprite = tone === 'currency' ? 'currency' : tone === 'map' ? 'map' : tone === 'flask' ? 'flask' : 'equipment';
    const auto = opts.autoPickup ?? true;
    const s: DropSpec = {
      token: token++, owner, autoPickup: typeof auto === 'function' ? auto(sprite) : auto, label: `${tone} drop`, tone, sprite,
      iconId: 'icon/currency/scrap',
    };
    log.specs.push(s);
    return s;
  };
  const hooks: RunHooks = {
    rollKillLoot(ctx, playerIds, rng) {
      log.killRolls.push({ ctx, playerIds: [...playerIds] });
      const out: DropSpec[] = [];
      for (const id of playerIds) {
        const n = ctx.isBoss ? 5 : ctx.isLieutenant ? 3 : rng.chance(opts.dropChance ?? 0.08) ? 1 : 0;
        for (let k = 0; k < n; k++) out.push(spec(rng, id));
      }
      return out;
    },
    rollChestLoot(playerIds, rng) {
      log.chestRolls.push([...playerIds]);
      const out: DropSpec[] = [];
      for (const id of playerIds) for (let k = 0; k < 6; k++) out.push(spec(rng, id));
      return out;
    },
    rollEventReward(ctx, playerIds, rng) {
      log.eventRolls.push({ ctx, playerIds: [...playerIds] });
      const out: DropSpec[] = [];
      for (const id of playerIds) out.push(spec(rng, id));
      return out;
    },
    tryPickup(playerId, t) {
      if (opts.full?.(playerId)) {
        log.blocked++;
        return false;
      }
      log.pickups.push(t);
      log.pickupsBy.push({ playerId, token: t });
      return true;
    },
  };
  return { hooks, log };
}

export interface PlayerOptions {
  name?: string;
  level?: number;
  stats?: PlayerCombatStats;
  skills?: SkillRuntimeDef[];
  loadout?: (SkillId | null)[];
  flasks?: (FlaskRuntime | null)[];
  x?: number;
  y?: number;
}

export function makeRuntime(o: PlayerOptions = {}): PlayerRuntime {
  return {
    stats: o.stats ?? makeStats(),
    skills: o.skills ?? [makeSkill('emberLance', 1)],
    loadout: o.loadout ?? ['emberLance', null, null, null, null, null],
    flasks: o.flasks ?? makeFlasks(),
  };
}

/** Test players default to a level above every fixture's monster level, so the character-vs-monster level-gap bonus stays out of unrelated tests. */
export const DEFAULT_PLAYER_LEVEL = 40;

export function makeJoin(id: number, o: PlayerOptions = {}): PlayerJoin {
  const join: PlayerJoin = { id, name: o.name ?? `Sorceress${id}`, level: o.level ?? DEFAULT_PLAYER_LEVEL, runtime: makeRuntime(o) };
  if (o.x !== undefined) join.x = o.x;
  if (o.y !== undefined) join.y = o.y;
  return join;
}

export interface ConfigOptions {
  mode?: 'hideout' | 'map';
  seed?: number;
  theme?: Theme;
  arenaRadius?: number;
  scaling?: Partial<MonsterScaling>;
  waves?: Partial<WaveConfig>;
  hooks?: RunHooks;
  /** Hidden event plan(s) of the map (Event Director v2). */
  event?: RunConfig['event'];
  eventModifiers?: RunConfig['eventModifiers'];
  /** The Atlas area (hand-crafted layout lookup); absent = the procedural generator. */
  areaId?: RunConfig['areaId'];
}

const MAP_NAMES: Record<Theme, string> = {
  hideout: 'Hideout', ashenForge: 'Ashen Forge', rimedOssuary: 'Rimed Ossuary', ironColiseum: 'Iron Coliseum',
  cinderChapel: 'Cinder Chapel', choralCrypt: 'Choral Crypt', chainworks: 'Chainworks',
};

export function makeConfig(o: ConfigOptions = {}): RunConfig {
  const mode = o.mode ?? 'map';
  return {
    mode,
    seed: o.seed ?? 1234,
    theme: o.theme ?? (mode === 'hideout' ? 'hideout' : 'ashenForge'),
    mapName: MAP_NAMES[o.theme ?? (mode === 'hideout' ? 'hideout' : 'ashenForge')],
    tier: 1,
    arenaRadius: o.arenaRadius ?? (mode === 'hideout' ? 300 : 900),
    monsters: makeScaling(o.scaling),
    waves: makeWaves(o.waves),
    hooks: o.hooks ?? makeHooks().hooks,
    ...(o.event !== undefined ? { event: o.event } : {}),
    ...(o.eventModifiers ? { eventModifiers: o.eventModifiers } : {}),
    ...(o.areaId ? { areaId: o.areaId } : {}),
  };
}

/** A run with one player (id 1) already joined — the solo case most tests exercise. */
export function makeSolo(o: ConfigOptions & PlayerOptions = {}): { run: SimRun; world: World } {
  const r = createRunInternal(makeConfig(o));
  r.run.addPlayer(makeJoin(1, o));
  return r;
}

/** A run with a party already joined (ids 1..n, in order). */
export function makeParty(o: ConfigOptions, players: PlayerOptions[]): { run: SimRun; world: World } {
  const r = createRunInternal(makeConfig(o));
  players.forEach((p, k) => r.run.addPlayer(makeJoin(k + 1, p)));
  return r;
}

export function idleIntent(aimX = 0, aimY = 100): PlayerIntent {
  return { moveX: 0, moveY: 0, aimX, aimY, held: [false, false, false, false, false, false], flask: -1 };
}
