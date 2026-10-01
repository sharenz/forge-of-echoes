// Event Director v2 (docs/atlas-rework/C-map-events.md 4). Hidden creation plans (server-only, from the map seed) become live
// event instances that OVERLAY the waves: up to three at once, each a small state machine owned by a script in ./events. The
// director owns what they share: the reveal window, the fairness budget (onset gap, capacity, clearance), the kill log, the
// monster-brain override, grades and the payout path (RunHooks.rollEventReward), views for the HUD and the clean-up.
//
// Deterministic and server-authoritative: every choice comes from the event stream (a fork of the run seed) or from positions the
// sim already has; timers count ticks. A party wipe freezes every event (the whole update returns while nobody lives).
import type { MapEventKind, MapEventPlan } from '../contracts/map-events';
import type { RunConfig } from '../contracts/sim';
import { AILMENT_BIT } from '../contracts/sim';
import { createRng } from '../core/rng';
import { EVENT_RESULT_SECONDS, MAP_EVENT_MAX_LIVE, MAP_EVENT_TIMEOUT_FACTOR } from '../data/progression/map-events';
import { DT } from './constants';
import { anvilScript } from './events/anvil';
import { bellwatchScript } from './events/bellwatch';
import { breachScript } from './events/breach';
import { caravanScript } from './events/caravan';
import { echoingScript } from './events/echoing';
import { faultScript } from './events/fault';
import { hostScript } from './events/host';
import { blankView, finish } from './events/kit';
import { orchardScript } from './events/orchard';
import { pactScript } from './events/pact';
import { relayScript } from './events/relay';
import { ringScript } from './events/ring';
import { rivalPending, rivalScript } from './events/rival';
import { EXPOSED_TAKEN, stalkerScript } from './events/stalker';
import type { EventDirector, EventInstance, EventKill, EventScript } from './events/types';
import { ECHO_LOG_SIZE } from '../data/progression/map-events';
import { pactForWave, type PlayerState, type World } from './world';

export type { EventDirector, EventInstance } from './events/types';

const SCRIPTS: Record<MapEventKind, EventScript> = {
  hunted: stalkerScript, echoRift: echoingScript, blackout: relayScript, vaultbreakers: caravanScript, secondCrown: rivalScript,
  wound: faultScript, pactAltar: pactScript, orchard: orchardScript, ring: ringScript, host: hostScript, anvil: anvilScript,
  bellwatch: bellwatchScript, voidBreach: breachScript,
};

const EVENT_STREAM_SALT = 0xe7e176;

function queue(d: EventDirector, plan: MapEventPlan | undefined): void {
  // A plan and the plans that run beside it (`also`); its own `next` sequence follows when it ends.
  for (let p = plan; p; p = p.also) d.pending.push(p);
}

function flatKinds(plan: MapEventPlan | null | undefined): MapEventKind[] {
  const out: MapEventKind[] = [];
  const visit = (p: MapEventPlan | undefined) => { for (; p; p = p.next) { out.push(p.kind); visit(p.also); } };
  visit(plan ?? undefined);
  return out;
}

/** The director of a map (null in the hideout). */
export function createEventDirector(config: RunConfig): EventDirector | null {
  if (config.mode !== 'map') return null;
  const d: EventDirector = {
    pending: [], live: [], nextUid: 1, rng: createRng(config.seed >>> 0).fork(EVENT_STREAM_SALT), killLog: [],
    keepKillLog: flatKinds(config.event).includes('echoRift'), members: new Map(), exposed: new Map(), spectral: new Set(), views: [],
    lootBonus: new Map(), boons: null, steerers: [], monsterSpeed: 1,
    modifiers: config.eventModifiers ?? {}, lastOnset: -1e9, results: [], requiredOpen: 0, planned: !!config.event,
  };
  queue(d, config.event ?? undefined);
  return d;
}

const isOver = (e: EventInstance) => e.phase === 'complete' || e.phase === 'failed';

function rebuildViews(d: EventDirector): void {
  d.views.length = 0;
  for (const e of d.live) d.views.push(e.view);
}

function drop(w: World, d: EventDirector, e: EventInstance): void {
  SCRIPTS[e.kind].cancel?.(w, e);
  for (const id of e.members) d.members.delete(id);
  e.members.clear();
  e.finished = true;
  const k = d.live.indexOf(e);
  if (k >= 0) d.live.splice(k, 1);
}

/** Called once per tick before the wave director. */
export function updateMapEvent(w: World): void {
  const d = w.mapEvent;
  if (!d || w.living.length === 0) return;
  const cleared = w.director.cleared;
  // The map is won: whatever is unfinished is dropped (its result, if it has one, stays for its five seconds).
  if (cleared) {
    d.pending.length = 0;
    for (const e of [...d.live]) if (!isOver(e)) drop(w, d, e);
  }
  // Reveal at most one plan per tick, in queue order, when its wave has come and nothing is holding the slots.
  if (!cleared && d.pending.length > 0 && w.director.tellWave === 0) {
    const active = d.live.filter(e => !isOver(e)).length;
    for (let k = 0; k < d.pending.length && active < MAP_EVENT_MAX_LIVE; k++) {
      const plan = d.pending[k];
      if (w.director.wave < plan.wave) continue;
      const e: EventInstance = { uid: d.nextUid, plan, kind: plan.kind, phase: 'available', stage: 0, age: 0, timer: 0, members: new Set(),
        grade: 0, tally: 0, finished: false, hold: 0, activeAge: -1, view: blankView(d.nextUid, plan.kind), s: null };
      if (!SCRIPTS[plan.kind].reveal(w, e)) continue;
      d.nextUid++;
      d.pending.splice(k, 1);
      d.live.push(e);
      break;
    }
  }
  for (const e of [...d.live]) {
    if (isOver(e)) {
      e.timer -= DT;
      SCRIPTS[e.kind].view(w, e);
      e.view.phase = e.phase; e.view.grade = e.grade;
      if (e.timer <= 0) {
        drop(w, d, e);
        queue(d, e.plan.next);
      }
      continue;
    }
    e.age += DT;
    if (e.hold > 0 && w.director.tellWave > 0) e.hold -= DT;
    SCRIPTS[e.kind].tick(w, e);
    if (e.finished) continue;
    // Sworn to the Veil: a soft timeout. An event still running long after its onset fails and pays nothing (never a penalty).
    const timeout = (d.modifiers.timeoutSeconds ?? 0) * (MAP_EVENT_TIMEOUT_FACTOR[e.kind] ?? 1);
    if (timeout > 0 && e.phase === 'active') {
      if (e.activeAge < 0) e.activeAge = e.age;
      if (e.age - e.activeAge >= timeout) finish(w, e, 0, { pay: false, lost: true });
    }
    // Optional encounters close when the boss wave begins (Rival Crowns lives on it and is required to finish).
    SCRIPTS[e.kind].view(w, e);
    e.view.phase = e.phase;
    e.view.uid = e.uid;
    if (isOver(e)) e.timer = EVENT_RESULT_SECONDS;
  }
  // Optional events that never opened end at the boss wave.
  const bossWave = w.config.waves.bossWave;
  if (bossWave > 0 && w.director.wave >= bossWave) {
    for (const e of [...d.live]) if (e.phase === 'available' && !e.plan.required && e.kind !== 'secondCrown') drop(w, d, e);
  }
  d.steerers.length = 0;
  for (const e of d.live) if (!isOver(e) && SCRIPTS[e.kind].steer) d.steerers.push(e);
  rebuildViews(d);
}

/** The brain override: the script owns the monster this tick when it returns true. */
export function driveEventMonster(w: World, i: number, t: PlayerState | null): boolean {
  const d = w.mapEvent;
  if (!d) return false;
  const e = d.members.size > 0 ? d.members.get(w.monsters.id[i]) : undefined;
  if (e) return SCRIPTS[e.kind].drive?.(w, e, i, t) ?? false;
  for (let k = 0; k < d.steerers.length; k++) {
    const s = d.steerers[k];
    if (SCRIPTS[s.kind].steer!(w, s, i, t)) return true;
  }
  return false;
}

/** AILMENT_BIT extras of an event monster (Exposed, spectral). */
export function eventAilments(w: World, id: number): number {
  const d = w.mapEvent;
  if (!d) return 0;
  let bits = d.spectral.has(id) ? AILMENT_BIT.spectral : 0;
  const until = d.exposed.get(id);
  if (until !== undefined) {
    if (w.time < until) bits |= AILMENT_BIT.exposed;
    else d.exposed.delete(id);
  }
  return bits;
}

/** Damage-taken multiplier of an Exposed monster. */
export function exposedMult(w: World, i: number): number {
  const d = w.mapEvent;
  if (!d || d.exposed.size === 0) return 1;
  const until = d.exposed.get(w.monsters.id[i]);
  return until !== undefined && w.time < until ? 1 + EXPOSED_TAKEN : 1;
}

/** A living player was hurt (after mitigation): carried Embers burn down. */
export function notePlayerHit(w: World, p: PlayerState, amount: number): void {
  const d = w.mapEvent;
  if (!d || d.live.length === 0) return;
  for (const e of d.live) if (!isOver(e)) SCRIPTS[e.kind].onPlayerHit?.(w, e, p, amount);
}

/**
 * Called by killMonster after the monster's slot was released. Feeds the kill log (The Echoing), tells the owning event and returns
 * 'secondCrown' when this death completed the crown pair (the reliquary's unique rides on it).
 */
export function mapEventKill(w: World, k: EventKill & { summoned: boolean; isLieutenant: boolean; packEmpty: boolean; wave: number }): KillExtras | undefined {
  const d = w.mapEvent;
  const live = pactForWave(w, k.wave);
  const pact = live && (live.quantity > 0 || live.rarity > 0) ? live : null;
  if (!d) return pact ? { quantityMore: pact.quantity, rarityMore: pact.rarity } : undefined;
  const bonus = d.lootBonus.get(k.id);
  d.lootBonus.delete(k.id);
  const e = d.members.get(k.id);
  const extras: KillExtras = {};
  if (pact) { extras.quantityMore = pact.quantity; extras.rarityMore = pact.rarity; }
  if (bonus) { extras.quantityMore = (extras.quantityMore ?? 0) + bonus.quantity; extras.rarityMore = (extras.rarityMore ?? 0) + bonus.rarity; }
  if (bonus?.rival !== undefined) extras.rival = bonus.rival;
  const tail = (): KillExtras | undefined => (Object.keys(extras).length > 0 ? extras : undefined);
  if (!e) {
    if (k.credited) for (const ev of d.live) if (!isOver(ev)) SCRIPTS[ev.kind].onAnyKill?.(w, ev, k);
    if (d.keepKillLog && k.credited && !k.summoned && !k.isBoss && !k.isLieutenant && (k.rarity >= 1 || k.packEmpty)) {
      const rec = { x: k.x, y: k.y, kind: k.kind, rarity: k.rarity, mods: k.mods, wave: k.wave };
      if (d.killLog.length < ECHO_LOG_SIZE) d.killLog.push(rec);
      else { d.killLog.shift(); d.killLog.push(rec); }
    }
    return tail();
  }
  d.members.delete(k.id);
  e.members.delete(k.id);
  d.exposed.delete(k.id);
  d.spectral.delete(k.id);
  SCRIPTS[e.kind].onKill?.(w, e, k);
  if (e.kind === 'secondCrown' && e.phase === 'complete') extras.eventReward = 'secondCrown';
  return tail();
}

/** What an event adds to the loot context of a kill (see KillLootContext). */
export interface KillExtras {
  eventReward?: MapEventKind;
  quantityMore?: number;
  rarityMore?: number;
  rival?: number;
}

/** A first crown killed during the warning must not clear the map before its rival arrives. */
export function crownPending(w: World): boolean {
  const d = w.mapEvent;
  if (!d) return false;
  if (d.pending.some(p => p.kind === 'secondCrown')) return true;
  return d.live.some(e => e.kind === 'secondCrown' && !isOver(e) && rivalPending(e));
}

/** Keyed encounters cannot be bypassed by rushing the final boss before a later encounter appears. */
export function requiredEventPending(w: World): boolean {
  const d = w.mapEvent;
  if (!d) return false;
  if (d.pending.some(p => p.required)) return true;
  return d.live.some(e => e.plan.required && !isOver(e));
}

/** Boss-time events may hold the NEXT wave tell (never a spawn) for at most eight seconds. */
export function eventHoldsWaveTell(w: World): boolean {
  const d = w.mapEvent;
  return !!d && d.live.some(e => !isOver(e) && e.hold > 0);
}
