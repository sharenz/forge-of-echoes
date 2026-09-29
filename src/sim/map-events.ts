// Optional mid-map encounters. Their creation roll is separate from simulation RNG streams.
import type { MapEventKind, MapEventPlan, MapEventView } from '../contracts/map-events';
import { ELITE_BIT } from '../contracts/sim';
import { ECHO_RIFT_PACK_SIZE, ECHO_RIFT_PULSES, ECHO_RIFT_REACH, MAP_EVENT_WARNING_SECONDS, MAP_EVENT_GRACE_SECONDS } from '../data/progression/map-events';
import { DT } from './constants';
import { resolvePlayerAt } from './movement';
import { monsterDef } from './rosters';
import { allocPack, spawnMonster } from './spawn';
import type { World } from './world';

export interface MapEventState {
  plan: MapEventPlan;
  view: MapEventView | null;
  finished: boolean;
  timer: number;
  grace: number;
  pulses: number;
  members: Set<number>;
}

export function createMapEvent(plan?: MapEventPlan | null): MapEventState | null {
  return plan ? { plan, view: null, finished: false, timer: 0, grace: MAP_EVENT_GRACE_SECONDS, pulses: 0, members: new Set() } : null;
}

/** A ring point near a living player, pulled inside the arena and out of solid scenery. */
function arrivalPoint(w: World, angle: number): { x: number; y: number } {
  const p = w.living[0];
  const radius = Math.min(230, w.arenaRadius * 0.3);
  return resolvePlayerAt(p.x + Math.cos(angle) * radius, p.y + Math.sin(angle) * radius, w.arenaRadius, w.props);
}

export function updateMapEvent(w: World): void {
  const e = w.mapEvent;
  if (!e || e.finished || w.living.length === 0) return;
  if (w.director.cleared) { e.finished = true; e.view = null; return; }
  if (!e.view) {
    if (w.director.wave < e.plan.wave || w.director.tellWave > 0) return;
    const at = arrivalPoint(w, e.plan.angle);
    e.view = { kind: e.plan.kind, phase: e.plan.kind === 'hunted' ? 'warning' : 'available',
      x: at.x, y: at.y, remaining: e.plan.kind === 'hunted' ? 1 : ECHO_RIFT_PACK_SIZE * ECHO_RIFT_PULSES,
      total: e.plan.kind === 'hunted' ? 1 : ECHO_RIFT_PACK_SIZE * ECHO_RIFT_PULSES };
    e.timer = MAP_EVENT_WARNING_SECONDS;
  }
  const v = e.view;
  if (v.phase === 'available') {
    // Optional: leave it alone and continue the map. It closes before the final boss.
    if (w.director.wave >= w.config.waves.bossWave && w.config.waves.bossWave > 0) {
      e.finished = true; e.view = null; return;
    }
    if (!w.living.some(p => Math.hypot(p.x - v.x, p.y - v.y) <= ECHO_RIFT_REACH)) return;
    v.phase = 'warning';
    e.timer = MAP_EVENT_WARNING_SECONDS;
  }
  if (v.phase === 'warning' || v.phase === 'active') e.grace = Math.max(0, e.grace - DT);
  if (v.phase === 'complete') {
    e.timer -= DT;
    if (e.timer <= 0) { e.view = null; e.finished = true; }
    return;
  }
  if (v.phase === 'warning' || (v.phase === 'active' && e.members.size === 0)) {
    e.timer -= DT;
    if (e.timer > 0) return;
    const count = e.plan.kind === 'hunted' ? 1 : ECHO_RIFT_PACK_SIZE;
    // Capacity pressure must neither lose a reward nor leave an unwinnable encounter.
    if (w.monsters.capacity - w.monsters.count < count) return;
    const family = w.roster.family;
    const hunter = family.find(k => monsterDef(k).role === 'hunter')
      ?? family.find(k => monsterDef(k).role === 'fast') ?? family[0];
    const kind = e.plan.kind === 'hunted' ? hunter : family[0];
    const rarity = e.plan.kind === 'hunted' ? 'rare' : 'magic';
    const pack = allocPack(w, v.x, v.y, w.director.wave, true, rarity, true);
    for (let k = 0; k < count; k++) {
      const angle = e.plan.angle + k * Math.PI * 2 / count;
      const at = resolvePlayerAt(v.x + Math.cos(angle) * 22, v.y + Math.sin(angle) * 22, w.arenaRadius, w.props);
      const slot = spawnMonster(w, kind, at.x, at.y, {
        rarity, pack, mods: e.plan.kind === 'hunted' ? ELITE_BIT.swift | ELITE_BIT.fierce : ELITE_BIT.swift,
      });
      if (slot >= 0) e.members.add(w.monsters.id[slot]);
    }
    e.pulses++;
    v.phase = 'active';
  }
  if (e.plan.kind === 'hunted' && e.members.size > 0) {
    const slot = w.monsters.slotOf(e.members.values().next().value!);
    if (slot >= 0) { v.x = w.monsters.x[slot]; v.y = w.monsters.y[slot]; }
  }
}

/** Called before the slot is released. Only a real final kill can carry the one-time reward. */
export function mapEventKill(w: World, id: number, credited: boolean): MapEventKind | undefined {
  const e = w.mapEvent;
  if (!e?.view || !e.members.delete(id)) return;
  const v = e.view;
  if (!credited) { e.finished = true; e.view = null; return; }
  v.remaining = Math.max(0, v.remaining - 1);
  if (e.members.size !== 0) return;
  if (e.plan.kind === 'echoRift' && e.pulses < ECHO_RIFT_PULSES) {
    e.timer = 2;
    return;
  }
  v.phase = 'complete';
  e.timer = 5;
  return e.plan.kind;
}
