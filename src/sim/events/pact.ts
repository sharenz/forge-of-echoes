// PACT ALTAR (event id 'pactAltar'). Stones round an altar offer bargains for the NEXT wave: two bold pacts and Ember Tax (the safe
// decline); a fourth, always-hard stone with the Pact Broker lens. Standing on a stone for a second chooses it (the most-occupied
// stone wins). A chosen bold pact reshapes the next wave through the wave-plan seam (w.pact: budget, pack rarity, ambush, life, drop
// quantity/rarity, resistances). Two rounds: the pact chosen during wave n shapes wave n+1, round two opens when n+1 starts and
// shapes n+2 (harder when round one was bold). docs/atlas-rework/C-map-events.md 7.2.
import type { MapEventGrade, PactId, WavePact } from '../../contracts/map-events';
import { PACT_IDS } from '../../contracts/map-events';
import { MAP_EVENT_WARNING_SECONDS } from '../../data/progression/map-events';
import {
  PACT_BOLD, PACT_CHOICE_TAX, PACT_CLEARANCE, PACT_DEFS, PACT_DWELL, PACT_ESCALATION, PACT_HARD_ORDER,
  PACT_RIM, PACT_STONE_RADIUS, PACT_STONE_RING,
} from '../../data/progression/events/pact-altar';
import { DT } from '../constants';
import type { World } from '../world';
import { anchorSite, beat, canOnset, finish, markOnset, mods, pay, pickSite, ringPoints, stoneZones, makeStone, tickStones, type Stone } from './kit';
import type { EventInstance, EventScript } from './types';

interface PactState {
  altar: { x: number; y: number };
  stones: Stone[];
  /** Stone index -> pact offered. */
  offers: PactId[];
  /** 0 before the first round opens, then 1 and 2. */
  round: 0 | 1 | 2;
  /** Whether the stones can be stood on right now. */
  open: boolean;
  /** The wave the open round was opened in (it expires when that wave's successor is announced). */
  openWave: number;
  /** Chosen pacts in wave order: the first is running (or next), a second waits behind it (w.pact / w.pactNext mirror them). */
  queue: WavePact[];
  /** Round one was a bold pact (round two is harder). */
  firstBold: boolean;
  /** Rounds resolved (chosen or expired), bold pacts whose wave has ended. */
  resolved: number;
  kept: number;
  deaths: number;
  /** Pact waves that were still running (monsters alive or streams pending) when the next wave was announced. */
  uncleared: number;
  /** The pact wave whose tell-time clear check already ran. */
  checked: number;
  dead: Set<number>;
  /** Hint to show (index into MAP_EVENT_TEXT.pactAltar.hints). */
  hint: number;
  done: boolean;
}

const state = (e: EventInstance) => e.s as PactState;

/** Pact grade: bold pacts kept (1 Bronze, 2 Silver), Gold when both were kept, nobody fell and at most one pact wave ran past its tell. */
export function pactGrade(kept: number, deaths: number, uncleared = 0): MapEventGrade {
  return kept >= 2 ? (deaths === 0 && uncleared <= 1 ? 3 : 2) : kept >= 1 ? 1 : 0;
}

/** A pact with the round-two escalation applied to its deltas over neutral. */
export function escalate(def: Omit<WavePact, 'wave'>, k: number): Omit<WavePact, 'wave'> {
  return { ...def, monsters: 1 + (def.monsters - 1) * k, life: 1 + (def.life - 1) * k, quantity: def.quantity * k, rarity: def.rarity * k, resist: def.resist * k };
}

/** The last wave a pact may shape: the wave count, never the boss wave (the fight after it has no next wave to announce). */
function lastPactWave(w: World): number {
  const cfg = w.config.waves;
  return cfg.bossWave > 0 ? Math.min(cfg.count, cfg.bossWave - 1) : cfg.count;
}

function reveal(w: World, e: EventInstance): boolean {
  if (!canOnset(w)) return false;
  const rule = { minPlayer: PACT_CLEARANCE, rim: PACT_RIM };
  const at = anchorSite(w, e, 'altar', rule) ?? pickSite(w, e.plan.angle, { ...rule, from: 0.1, to: 0.7 });
  const altar = { x: at.x, y: at.y };
  e.s = { altar, stones: [], offers: [], round: 0, open: false, openWave: 0, queue: [], firstBold: false, resolved: 0, kept: 0, deaths: 0, uncleared: 0, checked: 0,
    dead: new Set(), hint: 0, done: false } satisfies PactState;
  openRound(w, e, 1);
  e.phase = 'warning';
  e.timer = MAP_EVENT_WARNING_SECONDS;
  markOnset(w);
  beat(w, e, 'omen', altar.x, altar.y);
  return true;
}

/** Lay out the stones of a round: two distinct bold pacts from the event stream, then Ember Tax, then the Broker's hard pact. */
function openRound(w: World, e: EventInstance, round: 1 | 2): void {
  const s = state(e), rng = w.mapEvent!.rng;
  const pool = [...PACT_BOLD];
  const offers: PactId[] = [];
  for (let k = 0; k < 2; k++) offers.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
  offers.push('emberTax');
  if ((mods(w).pactExtra ?? 0) > 0) offers.push(PACT_HARD_ORDER.find(p => !offers.includes(p)) ?? 'ironhide');
  const ring = offers.length > 3 ? PACT_STONE_RING + 10 : PACT_STONE_RING;
  const pts = ringPoints(w, s.altar.x, s.altar.y, ring, offers.length, e.plan.angle + (round - 1) * 0.6);
  s.stones = pts.map((p, k) => makeStone(p.x, p.y, PACT_STONE_RADIUS, PACT_IDS.indexOf(offers[k])));
  s.offers = offers;
  s.round = round;
  s.open = true;
  s.openWave = w.director.wave;
  s.hint = round === 1 ? 0 : 8;
}

/** Whether another round can still shape a wave. */
function canOffer(w: World, wave: number): boolean {
  return wave + 1 <= lastPactWave(w);
}

function resolveRound(w: World, e: EventInstance, id: PactId | null): void {
  const s = state(e);
  s.open = false;
  s.resolved++;
  const pactWave = s.openWave + 1;
  if (id && id !== 'emberTax') {
    const base = PACT_DEFS[id];
    const def = s.round === 2 && s.firstBold ? escalate(base, PACT_ESCALATION) : base;
    s.queue.push({ ...def, wave: pactWave });
    sync(w, s);
    if (s.round === 1) s.firstBold = true;
    s.hint = 1 + PACT_IDS.indexOf(id);
  } else {
    if (id === 'emberTax') pay(w, e, 1, PACT_CHOICE_TAX, s.altar.x, s.altar.y);
    s.hint = id ? 6 : 7;
  }
}

/** Mirror the queue into the wave-plan seam. */
function sync(w: World, s: PactState): void {
  w.pact = s.queue[0] ?? null;
  w.pactNext = s.queue[1] ?? null;
}

/** The running pact's wave is over: it counts as kept and the next one moves up. */
function endPact(w: World, s: PactState): void {
  if (s.queue.length > 0) { s.queue.shift(); s.kept++; }
  sync(w, s);
  w.pactResist = 0;
}

function tick(w: World, e: EventInstance): void {
  const s = state(e);
  if (e.phase === 'warning') {
    e.timer -= DT;
    if (e.timer <= 0) { e.phase = 'active'; beat(w, e, 'onset', s.altar.x, s.altar.y); }
    return;
  }
  if (e.phase !== 'active') return;
  const d = w.director, cfg = w.config.waves;
  // The boss wave closes the altar (a pact never shapes the boss fight).
  if (cfg.bossWave > 0 && d.wave >= cfg.bossWave && !e.plan.required) return end(w, e);
  // An open round expires when the next wave is announced (its plan is drawn then) or has started.
  if (s.open && (d.tellWave > 0 || d.wave > s.openWave)) { s.stones.forEach(st => { st.state = 2; st.dwell.clear(); }); resolveRound(w, e, null); }
  if (s.open) {
    const k = tickStones(w, s.stones, PACT_DWELL);
    if (k >= 0) {
      const st = s.stones[k];
      beat(w, e, 'pick', st.x, st.y, st.n);
      resolveRound(w, e, s.offers[k]);
    }
  }
  // The pact's wave: resistances drop only while it runs; it ends when the following wave starts.
  const cur = s.queue[0];
  if (cur && d.wave === cur.wave && d.tellWave === cur.wave + 1 && s.checked !== cur.wave) {
    s.checked = cur.wave;
    if (w.monsters.count > 0 || d.stream.remaining > 0) s.uncleared++;
  }
  if (cur) {
    if (d.wave === cur.wave) {
      w.pactResist = cur.resist / 100;
      for (const p of w.players) {
        if (!p.dead) s.dead.delete(p.id);
        else if (!s.dead.has(p.id)) { s.dead.add(p.id); s.deaths++; }
      }
    } else if (d.wave > cur.wave) { endPact(w, s); beat(w, e, 'step', s.altar.x, s.altar.y, s.kept); }
  }
  // Round two opens when the first pact's wave (or, after a declined round, the next wave) has begun.
  if (!s.open && s.round === 1 && s.resolved >= 1 && d.tellWave === 0 && d.wave > s.openWave) {
    if (canOffer(w, d.wave)) { openRound(w, e, 2); beat(w, e, 'onset', s.altar.x, s.altar.y); }
    else { s.round = 2; s.resolved = 2; }
  }
  // Done: both rounds resolved and no pact pending.
  if (!s.open && s.queue.length === 0 && s.resolved >= 2) end(w, e);
}

function end(w: World, e: EventInstance): void {
  const s = state(e);
  if (s.done) return;
  s.done = true;
  s.open = false;
  while (s.queue.length > 0) endPact(w, s);
  e.tally = s.kept;
  const g = pactGrade(s.kept, s.deaths, s.uncleared);
  finish(w, e, g, { pay: g >= 1, x: s.altar.x, y: s.altar.y });
}

function view(w: World, e: EventInstance): void {
  const s = state(e), v = e.view;
  v.objectives.length = 0; v.timers.length = 0; v.zones.length = 0; v.markers.length = 0;
  v.x = s.altar.x; v.y = s.altar.y;
  v.zones.push({ kind: 'altar', x: s.altar.x, y: s.altar.y, r: PACT_STONE_RING, a: 0, v: s.round * 50, n: s.queue[0] ? PACT_IDS.indexOf(s.queue[0].id) + 1 : 0 });
  stoneZones(s.stones, PACT_DWELL, v.zones);
  if (e.phase !== 'active') { v.hint = e.phase === 'complete' ? 0 : s.hint; v.grade = e.grade; return; }
  v.objectives.push({ id: 0, cur: s.kept, max: 2 });
  v.grade = pactGrade(s.kept, s.deaths, s.uncleared);
  if (s.open) {
    const total = Math.max(1, w.config.waves.waveDuration - w.config.waves.tellDuration);
    v.timers.push({ id: 0, seconds: Math.max(0, total - w.director.waveTime), total });
  }
  v.hint = s.hint;
}

function cancel(w: World, e: EventInstance): void {
  const s = e.s as PactState | undefined;
  if (!s) return;
  s.queue.length = 0;
  sync(w, s);
  w.pactResist = 0;
}

export const pactScript: EventScript = { kind: 'pactAltar', reveal, tick, view, cancel };
