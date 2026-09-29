// Items on the floor (GAME_SPEC §12): the `dropItem` and `pickup` commands and the life of public drops.
//
//   dropItem  an item you carry (backpack, equipment, belt; the stash — its tabs and the Map Stash — and the map
//             device only where they are usable; a Crafting Stash slot is not an item and cannot be dropped)
//             goes onto the floor at your feet as a PUBLIC drop (DropSpec.owner 0, never auto-collected):
//             the sim tosses it first (it throws before changing anything), then the item leaves the
//             character and the dropper's save is flushed at once. The first drop of a session explains
//             that ground items vanish after GROUND_ITEM_TTL_MS or when the area closes.
//   pickup    a click on a drop (own loot or a public one): SimRun.requestPickup in the player's instance.
//             'tooFar' is not answered at once: the server's position trails the client's prediction by
//             the inputs still queued, so the click stays pending and is retried after every tick for
//             PICKUP_RETRY_TICKS (a click on another drop, leaving the area or dying answers it "Too far
//             away." / "You are dead."; another click on the SAME drop joins it and both get its result).
//             The result of a pending click therefore arrives later (still exactly one result per
//             command). A public item picked up is flushed to the picker's save at once.
// Expiry: GameMaintenance calls expire() — the drop leaves the sim and its token is forgotten. An instance
// that closes loses its ground items (logged by Instance.dispose); a hideout with items on the ground stays
// open until they expire.
import type { Item } from '../contracts/items';
import type { PickupResult } from '../contracts/sim';
import { rules } from '../game';
import { MAX_WIRE_PUBLIC_DROPS } from '../net';
import { isStashLocation, missingItem } from './commands';
import type { CommandResult } from './commands';
import type { Game } from './game';
import type { GroundItem, Instance } from './instance';
import type { PlayerSession } from './session';
import { ITEM_IN_TRADE } from './trade';

/** Public ground items vanish after this long. */
export const GROUND_ITEM_TTL_MS = 10 * 60_000;
/** At most this many public items lie on the ground of one instance (everyone in view receives them). */
export const MAX_GROUND_ITEMS = MAX_WIRE_PUBLIC_DROPS;
/** A click that is 'tooFar' is retried after every tick for this many ticks (0.5 s) before it fails. */
export const PICKUP_RETRY_TICKS = 30;
export const GROUND_HINT = 'Items on the ground vanish after 10 minutes or when the area closes.';

const OK: CommandResult = { ok: true };
const fail = (error: string): CommandResult => ({ ok: false, error });
const TOO_FAR = 'Too far away.';

/** Clicks on the same drop that may wait together; beyond this the oldest is answered "Too far away.". */
const MAX_JOINED_CLICKS = 8;

interface PendingPickup {
  /** Command ids waiting for this pickup (repeated clicks on the same drop all get its final result). */
  readonly ids: number[];
  readonly dropId: number;
  readonly inst: Instance;
  untilTick: number;
}

function pickupAnswer(r: PickupResult): CommandResult {
  switch (r) {
    case 'ok':
      return OK;
    case 'tooFar':
      return fail(TOO_FAR);
    case 'notYours':
      return fail('That item belongs to someone else.');
    case 'full':
      return fail('Your inventory is full.');
    case 'missing':
      return fail('That item is gone.');
  }
}

function withoutNewFlag(item: Item): Item {
  if (!item.isNew) return item;
  const { isNew: _drop, ...rest } = item;
  return rest as Item;
}

export class GroundService {
  private readonly pending = new Map<PlayerSession, PendingPickup>();
  /** The session whose click the sim is resolving right now (its pickup hook runs synchronously). */
  private clicker: PlayerSession | null = null;

  constructor(private readonly game: Game) {}

  /** True while `s`'s own click is being resolved (a full backpack is then the command's error, not a toast). */
  isClicking(s: PlayerSession): boolean {
    return this.clicker === s;
  }

  get pendingPickups(): number {
    return this.pending.size;
  }

  // =========================================================================================
  // dropItem
  // =========================================================================================

  drop(s: PlayerSession, uid: string): CommandResult {
    const inst = s.instance;
    if (!inst) return fail('You are not in an area.');
    if (inst.isDead(s)) return fail("You can't drop items while you are dead.");
    const ch = s.record.ch;
    const found = rules.findItem(ch, uid);
    // An empty Crafting Stash slot names the currency it lacks, as in every other item command.
    if (!found) return fail(missingItem(uid));
    if (this.game.trades.isLocked(s.characterId, uid)) return fail(ITEM_IN_TRADE);
    const where = found.location.kind;
    // Every stash tab counts: the normal tabs and the Map Stash (a Crafting Stash slot is refused by the rules).
    if (isStashLocation(found.location) && inst.kind !== 'hideout') return fail('Stash items can only be dropped in a hideout.');
    if (where === 'mapDevice' && (inst.kind !== 'hideout' || inst.ownerId !== s.characterId)) return fail('The map device is in your own hideout.');
    if (found.item.kind === 'flask' && found.item.count <= 0) return fail('That belt slot is empty.');
    if (inst.groundItems.size >= MAX_GROUND_ITEMS) return fail('There are too many items on the ground here. Pick some up first.');
    const view = inst.viewOf(s);
    if (!view) return fail('You are not in an area.');
    const removed = this.game.serverRules.discardItem(ch, uid);
    if (!removed.ok) return fail(removed.error);
    const now = this.game.now();
    let ground: GroundItem;
    try {
      // The sim places it first and throws before changing anything; only then does it leave the character.
      ground = inst.dropOnGround(withoutNewFlag(found.item), s, view.x, view.y, now, GROUND_ITEM_TTL_MS);
    } catch (err) {
      this.game.log.error('drop failed', { character: s.name, instance: inst.id, err });
      return fail('That item could not be dropped here.');
    }
    this.game.setCharacter(s, removed.value);
    if (where === 'equipment' || where === 'belt') inst.updateRuntime(s);
    this.game.flushSave(s);
    if (!s.groundHintShown) {
      s.groundHintShown = true;
      s.toast(GROUND_HINT, 'info');
    }
    this.game.log.info('item dropped', { character: s.name, item: ground.label, instance: inst.id, owner: inst.ownerName });
    return OK;
  }

  // =========================================================================================
  // pickup
  // =========================================================================================

  /**
   * Resolve a click now, or keep it pending (null: the result is sent later by afterTick). A click on a
   * different drop supersedes a pending one ("Too far away."); a repeated click on the same drop (a
   * double-click, or the client asking again after walking up) joins it with a fresh retry window, and every
   * waiting click gets the same final result.
   */
  pickup(s: PlayerSession, id: number, dropId: number): CommandResult | null {
    const inst = s.instance;
    const prev = this.pending.get(s);
    const joined = prev && prev.dropId === dropId && prev.inst === inst ? prev : null;
    if (!joined) this.cancel(s);
    const settle = (res: CommandResult): CommandResult => {
      if (joined) this.settle(s, joined, res);
      return res;
    };
    if (!inst) return settle(fail('You are not in an area.'));
    if (inst.isDead(s)) return settle(fail('You are dead.'));
    const r = this.attempt(s, inst, dropId);
    if (r !== 'tooFar') return settle(pickupAnswer(r));
    const untilTick = inst.run.view.tick + PICKUP_RETRY_TICKS;
    if (joined) {
      joined.ids.push(id);
      joined.untilTick = untilTick;
      while (joined.ids.length > MAX_JOINED_CLICKS) {
        const oldest = joined.ids.shift();
        if (oldest !== undefined) this.game.answer(s, oldest, fail(TOO_FAR));
      }
    } else this.pending.set(s, { ids: [id], dropId, inst, untilTick });
    return null;
  }

  /** Answer every click waiting in `p` with `res` and forget it. */
  private settle(s: PlayerSession, p: PendingPickup, res: CommandResult): void {
    if (this.pending.get(s) === p) this.pending.delete(s);
    for (const id of p.ids) this.game.answer(s, id, res);
  }

  private attempt(s: PlayerSession, inst: Instance, dropId: number): PickupResult {
    this.clicker = s;
    try {
      return inst.run.requestPickup(s.playerId, dropId);
    } finally {
      this.clicker = null;
    }
  }

  /** Retry the pending clicks of `inst`'s players (after every tick of it). */
  afterTick(inst: Instance): void {
    if (this.pending.size === 0) return;
    for (const [s, p] of this.pending) {
      if (p.inst !== inst) continue;
      let answer: CommandResult | null;
      try {
        if (s.instance !== inst) answer = fail(TOO_FAR);
        else if (inst.isDead(s)) answer = fail('You are dead.');
        else {
          const r = this.attempt(s, inst, p.dropId);
          answer = r === 'tooFar' && inst.run.view.tick < p.untilTick ? null : pickupAnswer(r);
        }
      } catch (err) {
        // Never let one click take the instance's tick down with it.
        this.game.log.error('pickup retry failed', { character: s.name, instance: inst.id, err });
        answer = fail('Something went wrong. Please try again.');
      }
      if (!answer) continue;
      this.settle(s, p, answer);
    }
  }

  /** Answer `s`'s pending click(s) (it moved, left, disconnected or clicked another drop). */
  cancel(s: PlayerSession, error = TOO_FAR): void {
    const p = this.pending.get(s);
    if (p) this.settle(s, p, fail(error));
  }

  // =========================================================================================
  // Expiry
  // =========================================================================================

  /** Remove every expired ground item (maintenance). */
  expire(now: number): void {
    for (const inst of this.game.instances.list()) {
      if (inst.disposed || inst.groundItems.size === 0) continue;
      const gone = inst.expireGroundItems(now);
      if (gone.length > 0) {
        this.game.log.info('ground items expired', { instance: inst.id, owner: inst.ownerName, count: gone.length, items: gone.map((g) => g.label).join(', ') });
      }
    }
  }

  /** Forget every pending click (shutdown; the sockets are closed already). */
  clear(): void {
    this.pending.clear();
  }
}
