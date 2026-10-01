// Fixtures for client tests: a hand-built WorldView (the shape the ClientWorld exposes) and a minimal fake
// NetClientWorld that records predictions.
import type { InputMessage, ZoneInfo } from '../../src/contracts/net';
import { MONSTER_KINDS } from '../../src/contracts/content';
import type {
  DropSpec, DropView, MonsterStoreView, MoteStoreView, PlayerView, ProjectileStoreView, PropView, RunView, SimEvent, SlotView,
  WorldView,
} from '../../src/contracts/sim';
import type { NetClientWorld } from '../../src/net';

export function monsterStore(capacity = 16): MonsterStoreView {
  const f = () => new Float32Array(capacity);
  return {
    capacity, count: 0,
    alive: new Uint8Array(capacity), id: new Uint32Array(capacity), kind: new Uint8Array(capacity),
    rarity: new Uint8Array(capacity), x: f(), y: f(), prevX: f(), prevY: f(), radius: f(),
    facing: new Int8Array(capacity), anim: new Uint8Array(capacity), animTime: f(), life: f(), maxLife: f(),
    hitFlash: f(), ailments: new Uint16Array(capacity), mods: new Uint16Array(capacity),
  };
}

export function addMonster(m: MonsterStoreView, x: number, y: number, kind: (typeof MONSTER_KINDS)[number] = 'ashling', prev?: { x: number; y: number }): number {
  let i = 0;
  while (i < m.capacity && m.alive[i]) i++;
  m.alive[i] = 1;
  m.kind[i] = MONSTER_KINDS.indexOf(kind);
  m.x[i] = x;
  m.y[i] = y;
  m.prevX[i] = prev ? prev.x : x;
  m.prevY[i] = prev ? prev.y : y;
  m.radius[i] = 6;
  m.life[i] = 1;
  m.maxLife[i] = 1;
  m.count++;
  return i;
}

function projectileStore(capacity = 8): ProjectileStoreView {
  const f = () => new Float32Array(capacity);
  return {
    capacity, count: 0, alive: new Uint8Array(capacity), id: new Uint32Array(capacity), kind: new Uint8Array(capacity),
    hostile: new Uint8Array(capacity), x: f(), y: f(), prevX: f(), prevY: f(), vx: f(), vy: f(), radius: f(), age: f(), life: f(),
  };
}

function moteStore(capacity = 8): MoteStoreView {
  const f = () => new Float32Array(capacity);
  return { capacity, count: 0, alive: new Uint8Array(capacity), x: f(), y: f(), prevX: f(), prevY: f(), size: new Uint8Array(capacity) };
}

const slot = (skillId: SlotView['skillId'] = null): SlotView => ({
  skillId, cooldown: 0, cooldownTotal: 0, charges: skillId ? 1 : 0, maxCharges: skillId ? 1 : 0, focusCost: 0, usable: !!skillId,
});

export function player(id: number, name: string, x = 0, y = 0, p: Partial<PlayerView> = {}): PlayerView {
  return {
    id, name, level: 3, x, y, prevX: x, prevY: y, vx: 0, vy: 0, facing: 'south', aimX: x, aimY: y + 10,
    anim: 'idle', animTime: 0, castSkill: null, castProgress: 0, life: 80, maxLife: 100, focus: 30, maxFocus: 60,
    wardTime: 0, wardDuration: 0, invulnTime: 0, hitFlash: 0, dead: false, debuffs: [],
    slots: [slot('emberLance'), slot('emberNova'), slot(), slot(), slot(), slot()],
    flasks: [
      { flaskId: 'lifeFlask', count: 3, resource: 'life', active: 1.5, duration: 3 },
      null,
      { flaskId: 'focusFlask', count: 2, resource: 'focus', active: 0, duration: 3 },
      null,
    ],
    ...p,
  };
}

export function runView(p: Partial<RunView> = {}): RunView {
  return {
    phase: 'fight', wave: 2, waveCount: 6, waveTime: 15, waveDuration: 60, elapsed: 75, kills: 40, monstersAlive: 30,
    boss: null, lieutenant: null, portalOpen: false, playersAlive: 1, events: [], ...p,
  };
}

export function worldView(p: Partial<WorldView> = {}): WorldView {
  return {
    tick: 100, time: 100 / 60, arenaRadius: 900, theme: 'ashenForge', players: [], monsters: monsterStore(),
    projectiles: projectileStore(), motes: moteStore(), areas: [], drops: [], props: [], run: runView(), ...p,
  };
}

export function prop(id: number, kind: PropView['kind'], x: number, y: number, state = 0): PropView {
  // As the sim flags them: hideout objects (incl. the anvil), the hideout portal while open, the return portal.
  const interactive =
    kind === 'mapDevice' || kind === 'stash' || kind === 'merchant' || kind === 'anvil' || kind === 'returnPortal' || (kind === 'portal' && state > 0);
  return { id, kind, x, y, radius: 0, state, variant: 0, interactive };
}

/** A ground item: equipment (click to pick up) owned by player 1 unless `spec` says otherwise. */
export function drop(id: number, x: number, y: number, spec: Partial<DropSpec> = {}): DropView {
  return {
    id,
    spec: { token: id, owner: 1, autoPickup: false, label: 'Ashen Robe', tone: 'normal', sprite: 'equipment', iconId: 'icon/base/ashenRobe', ...spec },
    x, y, prevX: x, prevY: y, z: 0, age: 1, blocked: false,
  };
}

export function zoneInfo(p: Partial<ZoneInfo> = {}): ZoneInfo {
  return {
    instanceId: 'h1', kind: 'hideout', ownerCharacterId: 'me', ownerName: 'Ysolde', theme: 'hideout', arenaRadius: 360,
    mapName: '', tier: 0, localPlayerId: 1, props: [], setup: null, portal: null, ...p,
  };
}

/** A NetClientWorld stand-in: a fixed view, predictions and noted event batches recorded. */
export interface FakeWorld extends NetClientWorld {
  predicted: InputMessage[];
  zones: ZoneInfo[];
  noted: { tick: number; events: readonly SimEvent[] }[];
}

export function fakeWorld(view: WorldView = worldView()): FakeWorld {
  const predicted: InputMessage[] = [];
  const zones: ZoneInfo[] = [];
  const noted: FakeWorld['noted'] = [];
  let local = 1;
  const w = {
    view,
    predicted,
    zones,
    noted,
    get localPlayerId() {
      return local;
    },
    latestTick: 0,
    renderTick: 0,
    interpDelayMs: 100,
    rtt: 0,
    setZone(z: ZoneInfo) {
      zones.push(z);
      local = z.localPlayerId;
    },
    pushSnapshot() {},
    predict(input: InputMessage) {
      predicted.push(input);
    },
    update() {
      return 1;
    },
    setRtt() {},
    liveTick() {
      return 0;
    },
    stats() {
      return {} as ReturnType<NetClientWorld['stats']>;
    },
    predictedPosition() {
      return null;
    },
    setPredictionHints() {},
    noteEvents(tick: number, events: readonly SimEvent[]) {
      noted.push({ tick, events });
    },
  };
  return w as unknown as FakeWorld;
}
