// Per-viewer fan-out of the sim's cosmetic events (contracts/net.ts 'events').
//
// Every event is classified for one viewer:
//   -1  not for this viewer (someone else's loot, someone else's "not enough focus", outside the AOI)
//    0  essential — never capped: the viewer's own feedback (incl. their debuffs, cleanses and chain-hook pulls —
//       the client's prediction replays its own pull), their own drops, public ground items (owner 0)
//       appearing / picked up in view, run-wide cues (wave tells, boss phases, the clear, portals opening),
//       and party-relevant moments (players joining / dying)
//    1  important: the viewer's own hits on monsters and motes (wherever they are), and in view: deaths,
//       monster attacks, telegraphs resolving, shield blocks, allies' casts, crits and killing blows, allies
//       getting hit, debuffed, cleansed or pulled
//    2  low — AOI-filtered: other players' plain hits, motes, evades, projectile ends, ailment pops
// Every event carrying the viewer's own playerId / owner is delivered (class 0 or 1).
// A packet (one per snapshot) keeps every class-0 event, then class 1, then class 2 up to EVENTS_PER_PACKET,
// preserving chronological order.
import { AOI_HALF_HEIGHT, AOI_HALF_WIDTH } from '../contracts/net';
import { RARITY_CODE, type SimEvent } from '../contracts/sim';
import { AOI_MARGIN } from '../net';

/** Cap per packet (two sim ticks) for class 1 + 2 events combined. */
export const EVENTS_PER_PACKET = 240;
/** Essential (class 0) events kept for a congested viewer whose snapshots are being skipped. */
export const MAX_ESSENTIAL_BACKLOG = 200;

const HW = AOI_HALF_WIDTH + AOI_MARGIN;
const HH = AOI_HALF_HEIGHT + AOI_MARGIN;

function inAoi(x: number, y: number, vx: number, vy: number): boolean {
  return Math.abs(x - vx) <= HW && Math.abs(y - vy) <= HH;
}

/** Classify `e` for viewer `viewer` standing at (vx, vy). */
export function eventClass(e: SimEvent, viewer: number, vx: number, vy: number): number {
  switch (e.t) {
    case 'dropSpawn':
      if (e.owner === viewer) return 0;
      return e.owner === 0 && inAoi(e.x, e.y, vx, vy) ? 0 : -1;
    case 'pickup':
      // Own loot: only its owner. A public item: whoever picked it up, and everyone who could see it.
      if (e.owner === viewer || (e.owner === 0 && e.playerId === viewer)) return 0;
      return e.owner === 0 && inAoi(e.x, e.y, vx, vy) ? 0 : -1;
    case 'notEnoughFocus':
      return e.playerId === viewer ? 0 : -1;
    case 'flank':
      // The target's warning is essential; allies who can see where it comes from get it too.
      if (e.playerId === viewer) return 0;
      return inAoi(e.x, e.y, vx, vy) ? 1 : -1;
    case 'mapEvent': // an omen, a whiff, a lit brazier: the whole party plays it
    case 'waveTell':
    case 'waveStart':
    case 'bossSpawn':
    case 'bossPhase':
    case 'cleared':
    case 'chestOpen':
    case 'playerDeath':
    case 'playerJoin':
      return 0;
    case 'portal':
      if (e.kind === 'open' || e.playerId === viewer) return 0;
      return inAoi(e.x, e.y, vx, vy) ? 1 : -1;
    case 'cast':
    case 'nova':
    case 'ward':
      if (e.playerId === viewer) return 0;
      return inAoi(e.x, e.y, vx, vy) ? 1 : -1;
    case 'dash':
      if (e.playerId === viewer) return 0;
      return inAoi(e.fromX, e.fromY, vx, vy) || inAoi(e.toX, e.toY, vx, vy) ? 1 : -1;
    case 'chain': {
      if (e.playerId === viewer) return 0;
      const p = e.points;
      for (let k = 0; k + 1 < p.length; k += 2) if (inAoi(p[k], p[k + 1], vx, vy)) return 1;
      return -1;
    }
    case 'flask':
      if (e.playerId === viewer) return 0;
      return 2;
    case 'hit':
      // The viewer's own hits (dealt or taken) always go out; others' only in view.
      if (e.playerId === viewer) return e.target === 'player' ? 0 : 1;
      if (!inAoi(e.x, e.y, vx, vy)) return -1;
      if (e.target === 'player' || e.crit || e.killed) return 1;
      return 2;
    case 'evade':
      if (e.playerId === viewer) return e.target === 'player' ? 0 : 1;
      return inAoi(e.x, e.y, vx, vy) ? 2 : -1;
    case 'mote':
      if (e.playerId === viewer) return 1;
      return inAoi(e.x, e.y, vx, vy) ? 2 : -1;
    case 'death':
      // Rare, lieutenant and boss deaths are big moments (loot fountains): always worth sending in view.
      if (!inAoi(e.x, e.y, vx, vy)) return e.rarity >= RARITY_CODE.lieutenant ? 0 : -1;
      return e.rarity >= RARITY_CODE.rare ? 0 : 1;
    case 'debuff':
    case 'cleanse':
      // Debuff state itself travels in every snapshot (PlayerView.debuffs); these are its cues (sound, flash).
      if (e.playerId === viewer) return 0;
      return inAoi(e.x, e.y, vx, vy) ? 1 : -1;
    case 'pull':
      // The viewer's own drag is essential: the client's prediction replays it (ClientWorld.noteEvents).
      if (e.playerId === viewer) return 0;
      return inAoi(e.fromX, e.fromY, vx, vy) || inAoi(e.toX, e.toY, vx, vy) ? 1 : -1;
    case 'blocked':
    case 'monsterAttack':
    case 'monsterSpawn':
    case 'areaResolve':
      return inAoi(e.x, e.y, vx, vy) ? 1 : -1;
    case 'projectileEnd':
    case 'ailment':
      return inAoi(e.x, e.y, vx, vy) ? 2 : -1;
    default: {
      // Every SimEvent must be classified above: a new contract event fails `tsc` here until it is. At run time
      // an unknown event (a sim ahead of this build) fails closed — nobody gets it rather than every viewer.
      const unhandled: never = e;
      void unhandled;
      return -1;
    }
  }
}

/** A viewer's pending events between two snapshots (reused buffers, no per-tick allocation). */
export class EventOutbox {
  private events: SimEvent[] = [];
  private classes: number[] = [];
  private counts = [0, 0, 0];

  /** Filter a tick's events for this viewer and queue the ones it should get. */
  collect(events: readonly SimEvent[], viewer: number, vx: number, vy: number): void {
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      const c = eventClass(e, viewer, vx, vy);
      if (c < 0) continue;
      this.events.push(e);
      this.classes.push(c);
      this.counts[c]++;
    }
  }

  get size(): number {
    return this.events.length;
  }

  /** The capped packet contents (chronological) and reset. Returns null when empty. */
  take(cap = EVENTS_PER_PACKET): SimEvent[] | null {
    const n = this.events.length;
    if (n === 0) return null;
    let out: SimEvent[];
    if (this.counts[1] + this.counts[2] <= cap) {
      out = this.events;
      this.events = [];
    } else {
      let quota1 = Math.min(this.counts[1], cap);
      let quota2 = Math.max(0, cap - quota1);
      out = [];
      for (let k = 0; k < n; k++) {
        const c = this.classes[k];
        if (c === 0) out.push(this.events[k]);
        else if (c === 1 && quota1 > 0) {
          quota1--;
          out.push(this.events[k]);
        } else if (c === 2 && quota2 > 0) {
          quota2--;
          out.push(this.events[k]);
        }
      }
      this.events.length = 0;
    }
    this.classes.length = 0;
    this.counts[0] = this.counts[1] = this.counts[2] = 0;
    return out;
  }

  /**
   * The viewer's link is congested and this packet is skipped: forget the cosmetic events, keep the
   * essential ones (own drops and pickups, wave tells, deaths…) for the next packet — the newest
   * MAX_ESSENTIAL_BACKLOG of them, so a long stall cannot grow the backlog without bound.
   */
  shed(): void {
    let w = 0;
    for (let k = 0; k < this.events.length; k++) {
      if (this.classes[k] !== 0) continue;
      this.events[w] = this.events[k];
      this.classes[w] = 0;
      w++;
    }
    const drop = Math.max(0, w - MAX_ESSENTIAL_BACKLOG);
    if (drop > 0) {
      this.events.copyWithin(0, drop, w);
      this.classes.copyWithin(0, drop, w);
    }
    this.events.length = w - drop;
    this.classes.length = w - drop;
    this.counts[0] = w - drop;
    this.counts[1] = this.counts[2] = 0;
  }

  clear(): void {
    this.events.length = 0;
    this.classes.length = 0;
    this.counts[0] = this.counts[1] = this.counts[2] = 0;
  }
}
