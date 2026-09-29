// Run assembly: builds the World for a RunConfig, lets players join and leave, and advances it one
// fixed tick at a time.
import type {
  DropSpec, PickupResult, PlayerIntent, PlayerJoin, PlayerUpdate, RunConfig, RunView, SimRun, WorldView,
} from '../contracts/sim';
import { createRng } from '../core/rng';
import { updateMonsters } from './ai';
import { removePlayerAreas, updateAreas } from './areas';
import {
  DT, GRID_CELL, HIDEOUT_MONSTER_CAPACITY, HIDEOUT_MOTE_CAPACITY, HIDEOUT_PROJECTILE_CAPACITY, JOIN_RING_RADIUS,
  MAX_MONSTER_RADIUS, MAX_PLAYER_ID, MAX_PLAYERS, MONSTER_CAPACITY, MOTE_CAPACITY, PROJECTILE_CAPACITY, START_INVULN,
} from './constants';
import { digestWorld } from './digest';
import { EventBuffer } from './events';
import { PropGrid, SpatialGrid } from './grid';
import { createHookErrorLog } from './hooks';
import { removeDrop, removePlayerDrops, requestPickup, spawnFloorDrop, updateDrops, updateMotes } from './loot';
import { resolvePlayerAt } from './movement';
import {
  applyPlayerPushes, applyPlayerUpdate, createPlayer, refreshLiving, storeIntent, updatePlayer, writePlayerView,
  type SimPlayerJoin, type SimPlayerUpdate,
} from './player';
import {
  hideoutDummyPosition, hideoutSpawn, latchPortalsUnder, layoutHideout, layoutMap, setHideoutPortal, updatePropInteractions,
} from './props';
import { updateProjectiles } from './projectiles';
import { spawnMonster } from './spawn';
import { MonsterStore, MoteStore, ProjectileStore } from './stores';
import { createDirector, updateDirector } from './waves';
import type { PlayerState, World } from './world';

const LOOT_SALT = 0x10070;
const WORLD_SALT = 0x3013d;

/** Entity store sizes of an instance. */
export interface StoreCapacities {
  monsters: number;
  projectiles: number;
  motes: number;
}

/** Maps get room for the densest waves; hideouts (the dummy and some spell practice) stay tiny. */
export function defaultCapacities(mode: RunConfig['mode']): StoreCapacities {
  return mode === 'hideout'
    ? { monsters: HIDEOUT_MONSTER_CAPACITY, projectiles: HIDEOUT_PROJECTILE_CAPACITY, motes: HIDEOUT_MOTE_CAPACITY }
    : { monsters: MONSTER_CAPACITY, projectiles: PROJECTILE_CAPACITY, motes: MOTE_CAPACITY };
}

function validate(config: RunConfig): number {
  const R = config.arenaRadius;
  if (!(R > 50) || !Number.isFinite(R)) throw new Error(`sim: arenaRadius must be a finite number > 50 (got ${R})`);
  return R;
}

export function createWorld(config: RunConfig, capacities: StoreCapacities = defaultCapacities(config.mode)): World {
  const R = validate(config);
  const combatRng = createRng(config.seed >>> 0);
  const lootRng = combatRng.fork(LOOT_SALT);
  const worldRng = combatRng.fork(WORLD_SALT);
  const monsters = new MonsterStore(capacities.monsters);
  const projectiles = new ProjectileStore(capacities.projectiles);
  const motes = new MoteStore(capacities.motes);
  const half = R + GRID_CELL * 2;
  const director = createDirector(config.mode);

  const run: RunView = {
    phase: director.phase,
    wave: 0,
    waveCount: config.mode === 'map' ? config.waves.count : 0,
    waveTime: 0,
    waveDuration: config.waves.waveDuration,
    elapsed: 0,
    kills: 0,
    monstersAlive: 0,
    boss: null,
    lieutenant: null,
    portalOpen: false,
    playersAlive: 0,
  };
  const areas: World['areas'] = [];
  const drops: World['drops'] = [];
  const props: World['props'] = [];
  const view: WorldView = {
    tick: 0,
    time: 0,
    arenaRadius: R,
    theme: config.theme,
    players: [],
    monsters,
    projectiles,
    motes,
    areas,
    drops,
    props,
    run,
  };

  const w: World = {
    config,
    arenaRadius: R,
    tick: 0,
    time: 0,
    combatRng,
    lootRng,
    worldRng,
    players: [],
    playerById: new Array<PlayerState | undefined>(MAX_PLAYER_ID + 1).fill(undefined),
    living: [],
    monsters,
    projectiles,
    motes,
    grid: new SpatialGrid(half, GRID_CELL, monsters.capacity),
    propGrid: new PropGrid(half, GRID_CELL, MAX_MONSTER_RADIUS),
    areas,
    drops,
    props,
    packs: [],
    director,
    boss: {
      phase: 1, spiral: 0, spiralAngle: 0, spiralDir: 1, spiralEmit: 0, spiralCd: 0, slamCd: 0, meteorCd: 0,
      chargeCd: 0, summonCd: 0, roar: 0, chargeDirX: 0, chargeDirY: 0,
    },
    events: new EventBuffer(),
    outcomes: [],
    view,
    nextAreaId: 1,
    nextDropId: 1,
    nextPropId: 1,
    kills: 0,
    xpCarry: 0,
    vacuum: false,
    portal: null,
    hookErrors: createHookErrorLog(),
    scratch: new Int32Array(monsters.capacity),
    scratch2: new Int32Array(monsters.capacity),
    scratchT: new Float32Array(monsters.capacity),
  };

  if (config.mode === 'hideout') {
    layoutHideout(w);
    const d = hideoutDummyPosition(R);
    spawnMonster(w, 'trainingDummy', d.x, d.y, { animate: false });
  } else {
    layoutMap(w);
  }
  syncView(w);
  return w;
}

/** The instance entry point: the hideout courtyard spot, or the map start. */
function entryPoint(w: World): { x: number; y: number } {
  return w.config.mode === 'hideout' ? hideoutSpawn(w.arenaRadius) : { x: 0, y: 0 };
}

/**
 * Add a player. Without an explicit position they appear at the entry point, fanned out on a
 * small ring by how many are already present so a party arriving together doesn't stack.
 * `join.life` / `join.focus` (SimPlayerJoin) resume a player's vitals instead of full ones.
 */
export function addPlayer(w: World, join: SimPlayerJoin): PlayerState {
  const id = join.id;
  if (!Number.isInteger(id) || id < 1 || id > MAX_PLAYER_ID) throw new Error(`sim: player id must be an integer 1..${MAX_PLAYER_ID} (got ${id})`);
  if (w.playerById[id]) throw new Error(`sim: player id ${id} is already in this instance`);
  if (w.players.length >= MAX_PLAYERS) throw new Error(`sim: an instance holds at most ${MAX_PLAYERS} players`);
  let x: number;
  let y: number;
  if (typeof join.x === 'number' && typeof join.y === 'number' && Number.isFinite(join.x) && Number.isFinite(join.y)) {
    x = join.x;
    y = join.y;
  } else {
    const e = entryPoint(w);
    const k = w.players.length;
    // First arrival on the spot itself, later ones around it (south-west, south-east, north…).
    const a = Math.PI * 0.75 + k * (Math.PI / 2);
    x = e.x + (k === 0 ? 0 : Math.cos(a) * JOIN_RING_RADIUS);
    y = e.y + (k === 0 ? 0 : Math.sin(a) * JOIN_RING_RADIUS);
  }
  const o = resolvePlayerAt(x, y, w.arenaRadius, w.props);
  const p = createPlayer(join, o.x, o.y);
  if (w.config.mode === 'map') p.invulnTime = START_INVULN;
  w.players.push(p);
  w.playerById[id] = p;
  w.view.players.push(p.view);
  refreshLiving(w);
  latchPortalsUnder(w, p);
  writePlayerView(p);
  w.events.push({ t: 'playerJoin', playerId: id, x: p.x, y: p.y });
  syncRunView(w);
  return p;
}

/** Remove a player and everything only they could see or that only they were doing. */
export function removePlayer(w: World, id: number): void {
  const p = Number.isInteger(id) && id >= 1 && id <= MAX_PLAYER_ID ? w.playerById[id] : undefined;
  if (!p) return;
  const k = w.players.indexOf(p);
  w.players.splice(k, 1);
  const vk = w.view.players.indexOf(p.view);
  if (vk >= 0) w.view.players.splice(vk, 1);
  w.playerById[id] = undefined;
  refreshLiving(w);
  // Their instanced drops vanish with them (public floor items stay for everyone else); their
  // burning trail goes out. Monsters and motes that were after them pick someone else on the next
  // tick; kill credit for their lingering burns and projectiles falls to nobody (the kill and its
  // loot for everyone else still happen).
  removePlayerDrops(w, id);
  removePlayerAreas(w, id);
  syncRunView(w);
}

/** prev ← current for the first `n` slots of a store (everything past its high-water mark is dead). */
function copyPrev(n: number, x: Float32Array, y: Float32Array, prevX: Float32Array, prevY: Float32Array): void {
  for (let i = 0; i < n; i++) {
    prevX[i] = x[i];
    prevY[i] = y[i];
  }
}

function snapshotPrev(w: World): void {
  for (const p of w.players) {
    p.prevX = p.x;
    p.prevY = p.y;
  }
  const m = w.monsters;
  copyPrev(m.hwm, m.x, m.y, m.prevX, m.prevY);
  const pr = w.projectiles;
  copyPrev(pr.hwm, pr.x, pr.y, pr.prevX, pr.prevY);
  const mo = w.motes;
  copyPrev(mo.hwm, mo.x, mo.y, mo.prevX, mo.prevY);
  for (const d of w.drops) {
    d.prevX = d.x;
    d.prevY = d.y;
  }
}

/**
 * One fixed 60 Hz tick. The order matters: see the notes in the module README (index.ts).
 * An instance nobody is in holds perfectly still (only the clock runs), so empty hideouts and maps
 * waiting for someone to come back through a portal cost next to nothing.
 */
export function stepWorld(w: World): void {
  w.tick++;
  w.time = w.tick * DT;
  w.events.beginTick();
  if (w.players.length === 0) {
    w.view.tick = w.tick;
    w.view.time = w.time;
    w.view.run.elapsed = w.time;
    return;
  }
  snapshotPrev(w);
  // Players act (in join order) on the monster positions everyone saw last frame.
  w.grid.build(w.monsters);
  const players = w.players;
  for (let k = 0; k < players.length; k++) updatePlayer(w, players[k]);
  updateDirector(w);
  updateMonsters(w);
  applyPlayerPushes(w);
  // Projectiles and ground effects resolve against the monsters' new positions.
  w.grid.build(w.monsters);
  updateProjectiles(w);
  updateAreas(w);
  updateMotes(w);
  updateDrops(w);
  updatePropInteractions(w);
  syncView(w);
}

function syncRunView(w: World): void {
  const d = w.director;
  const r = w.view.run;
  const alive = w.living.length;
  r.playersAlive = alive;
  // A wiped party reads as 'failed' until someone comes back through a portal (the instance keeps
  // its state, frozen); an empty instance keeps showing where it stands.
  r.phase = d.phase !== 'cleared' && d.phase !== 'hideout' && w.players.length > 0 && alive === 0 ? 'failed' : d.phase;
  let portal = false;
  for (const p of w.props) if ((p.kind === 'portal' || p.kind === 'returnPortal') && p.state > 0) portal = true;
  r.portalOpen = portal;
}

function syncView(w: World): void {
  const v = w.view;
  v.tick = w.tick;
  v.time = w.time;
  for (const p of w.players) writePlayerView(p);
  const d = w.director;
  const r = v.run;
  const m = w.monsters;
  r.wave = d.wave;
  r.waveTime = d.waveTime;
  r.elapsed = w.time;
  r.kills = w.kills;
  r.monstersAlive = w.config.mode === 'map' ? m.count : 0;
  const bossSlot = d.bossId >= 0 ? m.slotOf(d.bossId) : -1;
  if (bossSlot >= 0) {
    if (!r.boss) r.boss = { name: 'Cinder Matriarch', life: 0, maxLife: 0, phase: 1 };
    r.boss.life = Math.max(0, m.life[bossSlot]);
    r.boss.maxLife = m.maxLife[bossSlot];
    r.boss.phase = w.boss.phase;
  } else r.boss = null;
  const heraldSlot = d.heraldId >= 0 ? m.slotOf(d.heraldId) : -1;
  if (heraldSlot >= 0) {
    if (!r.lieutenant) r.lieutenant = { name: 'Ashbound Herald', life: 0, maxLife: 0 };
    r.lieutenant.life = Math.max(0, m.life[heraldSlot]);
    r.lieutenant.maxLife = m.maxLife[heraldSlot];
  } else r.lieutenant = null;
  syncRunView(w);
}

/** The World behind every SimRun made here (for index.ts helpers such as drainHookErrors). */
const worlds = new WeakMap<SimRun, World>();

export function worldOf(run: SimRun): World | undefined {
  return worlds.get(run);
}

export interface InternalRunOptions {
  /** Override the mode's store sizes (tests build busy arenas in hideout mode). */
  capacities?: Partial<StoreCapacities>;
}

/** Build a run and also hand back its World (tests and debug tools inspect internals). */
export function createRunInternal(config: RunConfig, opts: InternalRunOptions = {}): { run: SimRun; world: World } {
  const w = createWorld(config, { ...defaultCapacities(config.mode), ...opts.capacities });
  const run: SimRun = {
    config,
    view: w.view,
    addPlayer(join: PlayerJoin): void {
      addPlayer(w, join);
    },
    removePlayer(id: number): void {
      removePlayer(w, id);
    },
    spawnDrop(spec: DropSpec, x: number, y: number): number {
      return spawnFloorDrop(w, spec, x, y);
    },
    requestPickup(playerId: number, dropId: number): PickupResult {
      return requestPickup(w, playerId, dropId);
    },
    removeDrop(dropId: number): void {
      removeDrop(w, dropId);
    },
    setIntent(id: number, intent: PlayerIntent): void {
      const p = Number.isInteger(id) && id >= 1 && id <= MAX_PLAYER_ID ? w.playerById[id] : undefined;
      if (p && intent) storeIntent(p, intent);
    },
    step(): void {
      stepWorld(w);
    },
    drainEvents() {
      return w.events.drain();
    },
    drainOutcomes() {
      const out = w.outcomes;
      w.outcomes = [];
      return out;
    },
    updatePlayer(id: number, update: PlayerUpdate): void {
      const p = Number.isInteger(id) && id >= 1 && id <= MAX_PLAYER_ID ? w.playerById[id] : undefined;
      if (!p || !update) return;
      applyPlayerUpdate(p, update as SimPlayerUpdate);
      writePlayerView(p);
    },
    setPortal(remaining: number): void {
      setHideoutPortal(w, remaining);
      syncRunView(w);
    },
    digest() {
      return digestWorld(w);
    },
  };
  worlds.set(run, w);
  return { run, world: w };
}
