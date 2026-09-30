// Synthetic server-side WorldViews for net tests (independent of the sim's internals).
import type { SkillId } from '../../src/contracts/content';
import { BELT_SLOTS, LOADOUT_SLOTS } from '../../src/contracts/items';
import { SIM_DT } from '../../src/contracts/sim';
import type {
  AreaView, DropView, FlaskSlotView, MonsterStoreView, MoteStoreView, PlayerView, ProjectileStoreView, PropView,
  SlotView, WorldView,
} from '../../src/contracts/sim';
import type { ZoneInfo } from '../../src/contracts/net';

export const CAP = 2048;

function f(n: number): Float32Array {
  return new Float32Array(n);
}

export function makeMonsterStore(cap = CAP): MonsterStoreView {
  return {
    capacity: cap, count: 0, alive: new Uint8Array(cap), id: new Uint32Array(cap), kind: new Uint8Array(cap),
    rarity: new Uint8Array(cap), x: f(cap), y: f(cap), prevX: f(cap), prevY: f(cap), radius: f(cap),
    facing: new Int8Array(cap), anim: new Uint8Array(cap), animTime: f(cap), life: f(cap), maxLife: f(cap),
    hitFlash: f(cap), ailments: new Uint16Array(cap), mods: new Uint16Array(cap),
  };
}

export function makeProjectileStore(cap = CAP): ProjectileStoreView {
  return {
    capacity: cap, count: 0, alive: new Uint8Array(cap), id: new Uint32Array(cap), kind: new Uint8Array(cap),
    hostile: new Uint8Array(cap), x: f(cap), y: f(cap), prevX: f(cap), prevY: f(cap), vx: f(cap), vy: f(cap),
    radius: f(cap), age: f(cap), life: f(cap),
  };
}

export function makeMoteStore(cap = 1024): MoteStoreView {
  return { capacity: cap, count: 0, alive: new Uint8Array(cap), x: f(cap), y: f(cap), prevX: f(cap), prevY: f(cap), size: new Uint8Array(cap) };
}

export function makePlayer(id: number, over: Partial<PlayerView> = {}): PlayerView {
  const slots: SlotView[] = [];
  for (let k = 0; k < LOADOUT_SLOTS; k++) {
    slots.push({ skillId: null, cooldown: 0, cooldownTotal: 0, charges: 0, maxCharges: 0, focusCost: 0, usable: false });
  }
  const flasks: (FlaskSlotView | null)[] = [];
  for (let k = 0; k < BELT_SLOTS; k++) flasks.push(null);
  return {
    id, name: `Player${id}`, level: 1, x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, facing: 'south',
    aimX: 0, aimY: 40, anim: 'idle', animTime: 0, castSkill: null, castProgress: 0, life: 80, maxLife: 80,
    focus: 70, maxFocus: 70, wardTime: 0, wardDuration: 0, invulnTime: 0, hitFlash: 0, dead: false, debuffs: [], slots, flasks,
    ...over,
  };
}

export function makeView(over: Partial<WorldView> = {}): WorldView {
  return {
    tick: 0, time: 0, arenaRadius: 900, theme: 'ashenForge', players: [], monsters: makeMonsterStore(),
    projectiles: makeProjectileStore(), motes: makeMoteStore(), areas: [], drops: [], props: [],
    run: {
      phase: 'fight', wave: 2, waveCount: 6, waveTime: 12.5, waveDuration: 60, elapsed: 75.25, kills: 123,
      monstersAlive: 42, boss: null, lieutenant: null, portalOpen: false, playersAlive: 1, events: [],
    },
    ...over,
  };
}

export interface MonsterSpec {
  slot: number;
  gen?: number;
  kind?: number;
  rarity?: number;
  x: number;
  y: number;
  radius?: number;
  facing?: number;
  anim?: number;
  animTime?: number;
  life?: number;
  maxLife?: number;
  hitFlash?: number;
  ailments?: number;
  mods?: number;
}

export function putMonster(v: WorldView, s: MonsterSpec): number {
  const m = v.monsters;
  const i = s.slot;
  if (!m.alive[i]) m.count++;
  m.alive[i] = 1;
  m.id[i] = (((s.gen ?? 0) << 16) | i) >>> 0;
  m.kind[i] = s.kind ?? 0;
  m.rarity[i] = s.rarity ?? 0;
  m.prevX[i] = m.x[i] = s.x;
  m.prevY[i] = m.y[i] = s.y;
  m.radius[i] = s.radius ?? 6;
  m.facing[i] = s.facing ?? 1;
  m.anim[i] = s.anim ?? 1;
  m.animTime[i] = s.animTime ?? 0;
  m.maxLife[i] = s.maxLife ?? 22;
  m.life[i] = s.life ?? m.maxLife[i];
  m.hitFlash[i] = s.hitFlash ?? 0;
  m.ailments[i] = s.ailments ?? 0;
  m.mods[i] = s.mods ?? 0;
  return i;
}

export function killMonster(v: WorldView, slot: number): void {
  if (v.monsters.alive[slot]) v.monsters.count--;
  v.monsters.alive[slot] = 0;
}

export interface ProjectileSpec {
  slot: number;
  gen?: number;
  kind?: number;
  hostile?: boolean;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  radius?: number;
  age?: number;
  life?: number;
}

export function putProjectile(v: WorldView, s: ProjectileSpec): void {
  const p = v.projectiles;
  const i = s.slot;
  if (!p.alive[i]) p.count++;
  p.alive[i] = 1;
  p.id[i] = (((s.gen ?? 0) << 16) | i) >>> 0;
  p.kind[i] = s.kind ?? 0;
  p.hostile[i] = s.hostile ? 1 : 0;
  p.prevX[i] = p.x[i] = s.x;
  p.prevY[i] = p.y[i] = s.y;
  p.vx[i] = s.vx ?? 420;
  p.vy[i] = s.vy ?? 0;
  p.radius[i] = s.radius ?? 3;
  p.age[i] = s.age ?? 0;
  p.life[i] = s.life ?? 0;
}

export function putMote(v: WorldView, slot: number, x: number, y: number, size = 0): void {
  const m = v.motes;
  if (!m.alive[slot]) m.count++;
  m.alive[slot] = 1;
  m.prevX[slot] = m.x[slot] = x;
  m.prevY[slot] = m.y[slot] = y;
  m.size[slot] = size;
}

export function makeArea(over: Partial<AreaView> = {}): AreaView {
  return { id: 1, kind: 'slamWarning', x: 0, y: 0, radius: 42, age: 0.2, duration: 0.9, ...over };
}

export function makeDrop(over: Partial<DropView> & { owner?: number; label?: string; autoPickup?: boolean } = {}): DropView {
  const { owner, label, autoPickup, ...rest } = over;
  return {
    id: 1,
    spec: {
      token: 77, owner: owner ?? 1, autoPickup: autoPickup ?? true, label: label ?? 'Forge Scrap', tone: 'currency', sprite: 'currency',
      iconId: 'icon/currency/scrap',
    },
    x: 10, y: 20, prevX: 10, prevY: 20, z: 3.5, age: 0.4, blocked: false,
    ...rest,
  };
}

export function makeProp(over: Partial<PropView> = {}): PropView {
  return { id: 1, kind: 'pillar', x: 0, y: 0, radius: 10, state: 0, variant: 0, interactive: false, ...over };
}

/** Standard slots for a viewer with a couple of skills. */
export function fillSlots(p: PlayerView, skills: (SkillId | null)[]): void {
  for (let k = 0; k < p.slots.length; k++) {
    const id = skills[k] ?? null;
    const s = p.slots[k];
    s.skillId = id;
    s.cooldown = id ? 1.25 * k : 0;
    s.cooldownTotal = id ? 3 : 0;
    s.charges = id ? 1 : 0;
    s.maxCharges = id ? 2 : 0;
    s.focusCost = id ? 12.5 : 0;
    s.usable = id !== null && k !== 2;
  }
}

export function setTick(v: WorldView, tick: number): void {
  v.tick = tick;
  v.time = tick * SIM_DT;
}

export function makeZone(over: Partial<ZoneInfo> = {}): ZoneInfo {
  return {
    instanceId: 'map-1', kind: 'map', ownerCharacterId: 'c1', ownerName: 'Mira', theme: 'ashenForge',
    arenaRadius: 900, mapName: 'Ashen Forge', tier: 1, localPlayerId: 1, props: [], setup: null, portal: null,
    ...over,
  };
}
