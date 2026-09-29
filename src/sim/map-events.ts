// Hidden creation plans become encounters in the simulation; every reward is attached to a real kill.
import type { MapEventKind, MapEventPlan, MapEventView } from '../contracts/map-events';
import { ELITE_BIT } from '../contracts/sim';
import { BLACKOUT_PACKS, ECHO_RIFT_PACK_SIZE, ECHO_RIFT_PULSES, ECHO_RIFT_REACH, MAP_EVENT_WARNING_SECONDS,
  MAP_EVENT_GRACE_SECONDS, VAULTBREAKER_COUNT, VAULTBREAKER_SECONDS, WOUND_PACKS } from '../data/progression/map-events';
import { removeOwnedAreas, spawnArea } from './areas';
import { moveAlong, MONSTER_ANIM, setAnim } from './behaviour';
import { startBoss } from './bosses';
import { DT } from './constants';
import { resolvePlayerAt } from './movement';
import { DAMAGE_INDEX } from './math';
import { monsterDef } from './rosters';
import { allocPack, spawnMonster } from './spawn';
import type { PlayerState, World } from './world';

export interface MapEventState {
  plan: MapEventPlan;
  view: MapEventView | null;
  finished: boolean;
  timer: number;
  grace: number;
  pulses: number;
  members: Set<number>;
  deadline: number;
}

export function createMapEvent(plan?: MapEventPlan | null): MapEventState | null {
  return plan ? { plan, view: null, finished: false, timer: 0, grace: MAP_EVENT_GRACE_SECONDS, pulses: 0,
    members: new Set(), deadline: 0 } : null;
}

function arrivalPoint(w: World, angle: number): { x: number; y: number } {
  const p = w.living[0], radius = Math.min(230, w.arenaRadius * 0.3);
  return resolvePlayerAt(p.x + Math.cos(angle) * radius, p.y + Math.sin(angle) * radius, w.arenaRadius, w.props);
}

/** A first crown killed during the warning must not clear the map before its twin arrives. */
export function crownPending(w: World): boolean {
  const e = w.mapEvent;
  return !!e && !e.finished && e.plan.kind === 'secondCrown' && e.pulses === 0;
}

const pulsesFor = (kind: MapEventKind) => kind === 'echoRift' ? ECHO_RIFT_PULSES
  : kind === 'blackout' ? BLACKOUT_PACKS : kind === 'wound' ? WOUND_PACKS : 1;
const packSize = (kind: MapEventKind) => kind === 'hunted' || kind === 'secondCrown' ? 1 : kind === 'vaultbreakers' ? VAULTBREAKER_COUNT : ECHO_RIFT_PACK_SIZE;
const isOptional = (kind: MapEventKind) => kind === 'echoRift' || kind === 'wound';

function reveal(w: World, e: MapEventState): void {
  const at = arrivalPoint(w, e.plan.angle), kind = e.plan.kind;
  const total = kind === 'secondCrown' ? 2 : packSize(kind) * pulsesFor(kind);
  e.view = { kind, phase: isOptional(kind) || kind === 'blackout' ? 'available' : 'warning',
    ...at, remaining: total, total };
  if (kind === 'secondCrown') {
    const id = w.director.bossId;
    if (id >= 0 && w.monsters.slotOf(id) >= 0) e.members.add(id);
    else e.view.remaining = 1; // The first boss may already have fallen on the previous tick.
  }
  e.timer = MAP_EVENT_WARNING_SECONDS;
}

function spawnPulse(w: World, e: MapEventState): boolean {
  const v = e.view!, count = packSize(e.plan.kind);
  if (w.monsters.capacity - w.monsters.count < count) return false;
  const family = w.roster.family;
  const hunter = family.find(k => monsterDef(k).role === 'hunter')
    ?? family.find(k => monsterDef(k).role === 'fast') ?? family[0];
  const crown = e.plan.kind === 'secondCrown', hunt = e.plan.kind === 'hunted';
  const carrier = e.plan.kind === 'vaultbreakers';
  const kind = crown ? w.roster.boss : hunt ? hunter : family[0];
  const pack = allocPack(w, v.x, v.y, w.director.wave, true, hunt ? 'rare' : 'magic', true);
  for (let k = 0; k < count; k++) {
    const angle = e.plan.angle + k * Math.PI * 2 / count;
    const at = resolvePlayerAt(v.x + Math.cos(angle) * (carrier ? 55 : 22), v.y + Math.sin(angle) * (carrier ? 55 : 22), w.arenaRadius, w.props);
    const rare = hunt || (e.plan.kind === 'wound' && e.pulses === WOUND_PACKS - 1 && k === 0);
    const slot = spawnMonster(w, kind, at.x, at.y, {
      rarity: crown ? 'normal' : rare ? 'rare' : 'magic', pack, boss: crown,
      mods: crown ? 0 : rare ? ELITE_BIT.swift | ELITE_BIT.fierce : ELITE_BIT.swift,
    });
    if (slot < 0) continue;
    const m = w.monsters;
    e.members.add(m.id[slot]);
    if (carrier) m.speed[slot] = 80;
    if (crown) {
      const def = monsterDef(kind);
      startBoss(w, slot, def);
      if (m.slotOf(w.director.bossId) < 0) { w.director.bossId = m.id[slot]; w.boss = w.bossStates.get(m.id[slot])!; }
      w.director.bossDefeated = false;
      w.events.push({ t: 'bossSpawn', x: at.x, y: at.y });
      def.onSpawn?.(w, slot, pack, at.x, at.y);
    }
  }
  e.pulses++;
  v.phase = 'active';
  if (carrier) { e.deadline = VAULTBREAKER_SECONDS; v.seconds = VAULTBREAKER_SECONDS; }
  if (e.plan.kind === 'wound') {
    // Every pulse telegraphs an eruption at the players' last position; moving is the counterplay.
    for (const p of w.living) spawnArea(w, 'eruptionWarning', p.x, p.y, 50, 1.5, {
      damage: 14 * w.config.monsters.damageMultiplier, dtype: DAMAGE_INDEX.fire, hurts: 'player',
    });
  }
  return true;
}

/** Escaped carriers leave no corpse, XP or loot, and cannot retain attacks or pack capacity. */
function escapeCarriers(w: World, e: MapEventState): void {
  for (const id of e.members) {
    const i = w.monsters.slotOf(id);
    if (i < 0) continue;
    const pack = w.packs[w.monsters.pack[i]];
    if (pack && --pack.alive <= 0) pack.active = false;
    removeOwnedAreas(w, id); w.memory.delete(id); w.monsters.release(i);
  }
  e.members.clear();
  e.view!.phase = 'failed'; e.view!.seconds = 0; e.timer = 5;
}

export function updateMapEvent(w: World): void {
  const e = w.mapEvent;
  if (!e || e.finished || w.living.length === 0) return;
  if (w.director.cleared && e.view?.phase !== 'complete') { e.finished = true; e.view = null; return; }
  if (!e.view) {
    if (w.director.wave < e.plan.wave || w.director.tellWave > 0) return;
    reveal(w, e);
  }
  const v = e.view!;
  if (v.phase === 'available') {
    if (w.director.wave >= w.config.waves.bossWave && w.config.waves.bossWave > 0) {
      e.finished = true; e.view = null; return;
    }
    if (!w.living.some(p => Math.hypot(p.x - v.x, p.y - v.y) <= ECHO_RIFT_REACH)) return;
    v.phase = 'warning'; e.timer = MAP_EVENT_WARNING_SECONDS;
  }
  if (v.phase === 'warning' || v.phase === 'active') e.grace = Math.max(0, e.grace - DT);
  if (v.phase === 'complete' || v.phase === 'failed') {
    e.timer -= DT;
    if (e.timer <= 0) { e.view = null; e.finished = true; }
    return;
  }
  if (v.phase === 'warning' || (v.phase === 'active' && e.members.size === 0)) {
    e.timer -= DT;
    if (e.timer <= 0) spawnPulse(w, e);
  }
  if (e.plan.kind === 'vaultbreakers' && v.phase === 'active') {
    e.deadline = Math.max(0, e.deadline - DT); v.seconds = Math.ceil(e.deadline);
    if (e.deadline <= 0) { escapeCarriers(w, e); return; }
  }
  if ((e.plan.kind === 'hunted' || e.plan.kind === 'vaultbreakers' || (e.plan.kind === 'secondCrown' && v.phase === 'active')) && e.members.size > 0) {
    const slot = w.monsters.slotOf(e.members.values().next().value!);
    if (slot >= 0) { v.x = w.monsters.x[slot]; v.y = w.monsters.y[slot]; }
  }
}

/** Fleeing carriers still use ordinary collision, chill and knockback integration. */
export function driveEventMonster(w: World, i: number, target: PlayerState | null): boolean {
  const e = w.mapEvent, m = w.monsters;
  if (!e || e.plan.kind !== 'vaultbreakers' || !e.members.has(m.id[i]) || !target) return false;
  let dx = m.x[i] - target.x, dy = m.y[i] - target.y;
  if (Math.hypot(m.x[i], m.y[i]) > w.arenaRadius - 100) {
    dx = -m.y[i] - m.x[i] * 0.4; dy = m.x[i] - m.y[i] * 0.4;
  }
  moveAlong(w, i, dx || 1, dy, 1);
  setAnim(w, i, MONSTER_ANIM.move);
  return true;
}

/** Called before release; overkill and uncredited cleanup never pay an encounter reward. */
export function mapEventKill(w: World, id: number, credited: boolean): MapEventKind | undefined {
  const e = w.mapEvent;
  if (!e?.view || !e.members.delete(id)) return;
  const v = e.view;
  if (!credited) { e.finished = true; e.view = null; return; }
  v.remaining = Math.max(0, v.remaining - 1);
  const carrier = e.plan.kind === 'vaultbreakers';
  if (e.members.size !== 0) return carrier ? 'vaultbreakers' : undefined;
  if (e.plan.kind === 'secondCrown' && e.pulses === 0) return;
  if (e.pulses < pulsesFor(e.plan.kind)) {
    e.timer = 2;
    if (e.plan.kind === 'blackout') {
      const at = arrivalPoint(w, e.plan.angle + e.pulses * Math.PI * 2 / BLACKOUT_PACKS);
      v.x = at.x; v.y = at.y; v.phase = 'available';
    }
    return;
  }
  v.phase = 'complete'; delete v.seconds; e.timer = 5;
  return e.plan.kind;
}
