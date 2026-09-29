// Command handling (contracts/net.ts Command): authority checks, then the shared rules. Every command answers
// with a CommandResult (sent as { t: 'result', id, ok, error?, message?, offers? }); state changes are pushed
// as 'character' (debounced) and, while the player stands in an instance, refreshed into the sim.
// handleCommand returns null when the answer comes later (a pickup click still out of reach: src/server/ground.ts).
//
// Where things may happen (GAME_SPEC §11–12):
//   anywhere          inventory moves between backpack / equipment / belt, discarding, dropping items on the
//                     floor, picking items up, attributes, skills, loadout, party and trade commands, chat
//   any hideout       crafting (applyCurrency) and the crafting bench, the stash (moves in or out, quick-move to a
//                     tab, tabs, dropping stash items), and the merchant (Rook trades with everyone; you pay with
//                     your own currency)
//   own hideout       the map device (loading / unloading / activating)
// Leaving a map (leaveMap, respawn, the return portal) goes back to the map owner's hideout — where its portals
// are — while you may still visit it; otherwise to your own hideout (Game.sendBackFromMap).
//
// Items in an open trade offer are LOCKED: a command aimed at one is refused with ITEM_IN_TRADE, and every
// item rule runs through game.serverRules (withItemLocks), which also refuses side effects on locked items.
import type { MerchantOffer } from '../contracts/game';
import type { CharacterSave, ItemLocation } from '../contracts/items';
import type { Command } from '../contracts/net';
import { rules } from '../game';
import type { Game } from './game';
import type { PlayerSession } from './session';
import { ITEM_IN_TRADE } from './trade';

export type CommandResult =
  | { ok: true; message?: string; offers?: MerchantOffer[] }
  | { ok: false; error: string };

/** Longest chat line (the wire allows a little more; the server trims and enforces this). */
export const MAX_CHAT_CHARS = 200;

const OK: CommandResult = { ok: true };
const fail = (error: string): CommandResult => ({ ok: false, error });

function inHideout(s: PlayerSession): boolean {
  return s.instance?.kind === 'hideout';
}

function inOwnHideout(s: PlayerSession): boolean {
  return s.instance?.kind === 'hideout' && s.instance.ownerId === s.characterId;
}

const NEED_HIDEOUT_STASH = 'The stash can only be used in a hideout.';
const NEED_OWN_HIDEOUT_DEVICE = 'The map device is in your own hideout.';
const NEED_HIDEOUT_BENCH = 'The crafting bench is in the hideout.';

/** Whether any of `uids` sits in the sender's open trade offer. */
function lockedIn(game: Game, s: PlayerSession, ...uids: string[]): boolean {
  return uids.some((uid) => game.trades.isLocked(s.characterId, uid));
}

/** Location rules for moving an item from `from` to `to` (null = not a move, e.g. discard). */
function locationError(s: PlayerSession, from: ItemLocation, to: ItemLocation | null): string | null {
  if ((from.kind === 'stash' || to?.kind === 'stash') && !inHideout(s)) return NEED_HIDEOUT_STASH;
  if ((from.kind === 'mapDevice' || to?.kind === 'mapDevice') && !inOwnHideout(s)) return NEED_OWN_HIDEOUT_DEVICE;
  return null;
}

/** Commit a rules result: save, push, and refresh the sim runtime when it can affect combat. */
function commit(game: Game, s: PlayerSession, next: CharacterSave, runtime: boolean): void {
  if (next === s.record.ch) return;
  game.setCharacter(s, next);
  if (runtime && s.instance) s.instance.updateRuntime(s);
}

function applyResult(
  game: Game, s: PlayerSession, r: { ok: true; value: CharacterSave } | { ok: false; error: string }, runtime: boolean, message?: string,
): CommandResult {
  if (!r.ok) return fail(r.error);
  commit(game, s, r.value, runtime);
  return message === undefined ? OK : { ok: true, message };
}

/**
 * Handle one command for `s`. `id` is the client's request id (for answers that come later). Returns the
 * result, or null when it will be sent later through game.answer (exactly one result per command).
 */
export function handleCommand(game: Game, s: PlayerSession, cmd: Command, id = 0): CommandResult | null {
  const ch = s.record.ch;
  const r = game.serverRules;
  switch (cmd.c) {
    // --- items & crafting ------------------------------------------------------------------
    case 'moveItem': {
      const found = rules.findItem(ch, cmd.uid);
      if (!found) return fail('That item no longer exists.');
      if (lockedIn(game, s, cmd.uid)) return fail(ITEM_IN_TRADE);
      const where = locationError(s, found.location, cmd.to);
      if (where) return fail(where);
      return applyResult(game, s, r.moveItem(ch, cmd.uid, cmd.to), true);
    }
    case 'quickMove': {
      const found = rules.findItem(ch, cmd.uid);
      if (!found) return fail('That item no longer exists.');
      if (lockedIn(game, s, cmd.uid)) return fail(ITEM_IN_TRADE);
      if (cmd.stashTab !== null && !inHideout(s)) return fail(NEED_HIDEOUT_STASH);
      if (cmd.stashTab !== null && (cmd.stashTab < 0 || cmd.stashTab >= ch.stash.length)) return fail('That stash tab does not exist.');
      const where = locationError(s, found.location, null);
      if (where) return fail(where);
      return applyResult(game, s, r.quickMove(ch, cmd.uid, { stashTab: cmd.stashTab }), true);
    }
    case 'discardItem': {
      const found = rules.findItem(ch, cmd.uid);
      if (!found) return fail('That item no longer exists.');
      if (lockedIn(game, s, cmd.uid)) return fail(ITEM_IN_TRADE);
      const where = locationError(s, found.location, null);
      if (where) return fail(where);
      return applyResult(game, s, r.discardItem(ch, cmd.uid), true);
    }
    case 'dropItem':
      return game.ground.drop(s, cmd.uid);
    case 'pickup':
      return game.ground.pickup(s, id, cmd.dropId);
    case 'applyCurrency': {
      if (!inHideout(s)) return fail('Crafting only works in a hideout.');
      if (!rules.findItem(ch, cmd.currencyUid) || !rules.findItem(ch, cmd.targetUid)) return fail('That item no longer exists.');
      if (lockedIn(game, s, cmd.currencyUid, cmd.targetUid)) return fail(ITEM_IN_TRADE);
      const crafted = r.applyCurrency(ch, cmd.currencyUid, cmd.targetUid, cmd.affixIndex);
      if (!crafted.ok) return fail(crafted.error);
      commit(game, s, crafted.value.character, true);
      return { ok: true, message: crafted.value.message };
    }
    case 'benchCraft': {
      if (!inHideout(s)) return fail(NEED_HIDEOUT_BENCH);
      if (!rules.findItem(ch, cmd.targetUid)) return fail('That item no longer exists.');
      if (lockedIn(game, s, cmd.targetUid)) return fail(ITEM_IN_TRADE);
      const crafted = r.applyBenchRecipe(ch, cmd.targetUid, cmd.recipeId);
      if (!crafted.ok) return fail(crafted.error);
      commit(game, s, crafted.value.character, true);
      return { ok: true, message: crafted.value.message };
    }
    case 'benchClear': {
      if (!inHideout(s)) return fail(NEED_HIDEOUT_BENCH);
      if (!rules.findItem(ch, cmd.targetUid)) return fail('That item no longer exists.');
      if (lockedIn(game, s, cmd.targetUid)) return fail(ITEM_IN_TRADE);
      const cleared = r.clearCraftedAffix(ch, cmd.targetUid);
      if (!cleared.ok) return fail(cleared.error);
      commit(game, s, cleared.value.character, true);
      return { ok: true, message: cleared.value.message };
    }
    case 'addStashTab':
      if (!inHideout(s)) return fail(NEED_HIDEOUT_STASH);
      return applyResult(game, s, r.addStashTab(ch), false);
    case 'renameStashTab':
      if (!inHideout(s)) return fail(NEED_HIDEOUT_STASH);
      return applyResult(game, s, r.renameStashTab(ch, cmd.tab, cmd.name.trim()), false);
    case 'clearNewFlags':
      commit(game, s, rules.clearNewFlags(ch), false);
      return OK;

    // --- character -------------------------------------------------------------------------
    case 'allocateAttribute':
      return applyResult(game, s, rules.allocateAttribute(ch, cmd.attr), true);
    case 'rankUpSkill':
      return applyResult(game, s, rules.rankUpSkill(ch, cmd.skillId), true);
    case 'setLoadoutSlot':
      return applyResult(game, s, rules.setLoadoutSlot(ch, cmd.slot, cmd.skillId), true);

    // --- hideout ---------------------------------------------------------------------------
    case 'activateMapDevice':
      return game.activateMapDevice(s);
    case 'merchantOffers':
      if (!inHideout(s)) return fail('Rook only trades in a hideout.');
      return { ok: true, offers: r.merchantOffers(ch) };
    case 'buyOffer': {
      if (!inHideout(s)) return fail('Rook only trades in a hideout.');
      const bought = r.buyOffer(ch, cmd.offerId);
      if (!bought.ok) return fail(bought.error);
      commit(game, s, bought.value.character, true);
      return { ok: true, message: `Bought ${rules.describeItem(bought.value.item, bought.value.character).title}.` };
    }

    // --- party & social --------------------------------------------------------------------
    case 'partyInvite':
      return partyInvite(game, s, cmd.name);
    case 'partyRespond':
      return partyRespond(game, s, cmd.inviteId, cmd.accept);
    case 'partyLeave':
      if (!game.leaveParty(s.characterId, 'left')) return fail('You are not in a party.');
      return OK;
    case 'partyKick': {
      const error = game.parties.kickError(s.characterId, cmd.characterId);
      if (error) return fail(error);
      game.sessions.get(cmd.characterId)?.toast('You were removed from the party.', 'bad');
      game.leaveParty(cmd.characterId, 'kicked');
      return OK;
    }
    case 'partyPromote': {
      // Leadership must go to someone who can use it: an offline leader would leave the party stuck.
      if (game.parties.sameParty(s.characterId, cmd.characterId) && cmd.characterId !== s.characterId && !game.sessions.has(cmd.characterId)) {
        return fail(`${game.nameOf(cmd.characterId)} is offline.`);
      }
      const r = game.parties.promote(s.characterId, cmd.characterId);
      if (!r.ok) return fail(r.error);
      game.systemChat(r.value.members, `${game.nameOf(cmd.characterId)} now leads the party.`);
      game.markParty(s.characterId);
      return OK;
    }
    case 'visitHideout':
      return visitHideout(game, s, cmd.characterId);
    case 'usePortal':
      return game.usePortal(s, cmd.propId);
    case 'leaveMap':
      if (s.instance?.kind !== 'map') return fail('You are not in a map.');
      game.sendBackFromMap(s, s.instance);
      return OK;
    case 'respawn':
      if (s.instance?.kind !== 'map') return fail('There is nothing to return from.');
      if (!s.instance.isDead(s)) return fail('You are still alive.');
      game.sendBackFromMap(s, s.instance);
      return OK;
    case 'chat':
      return chat(game, s, cmd.text);

    // --- trading ---------------------------------------------------------------------------
    case 'tradeRequest':
      return game.trades.request(s, cmd.name);
    case 'tradeRespond':
      return game.trades.respond(s, cmd.requestId, cmd.accept);
    case 'tradeOffer':
      return game.trades.offer(s, cmd.tradeId, cmd.uids);
    case 'tradeAccept':
      return game.trades.accept(s, cmd.tradeId, cmd.accept);
    case 'tradeCancel':
      return game.trades.cancel(s, cmd.tradeId);
  }
}

function partyInvite(game: Game, s: PlayerSession, rawName: string): CommandResult {
  const name = rawName.trim().replace(/\s+/g, ' ');
  const lower = name.toLowerCase();
  let target: PlayerSession | null = null;
  for (const other of game.sessions.values()) if (other.name.toLowerCase() === lower) target = other;
  if (!target) {
    const row = game.db.characterByName(name);
    return fail(row ? `${row.name} is not online.` : `There is no character named "${name}".`);
  }
  const r = game.parties.invite({ id: s.characterId, name: s.name }, { id: target.characterId, name: target.name });
  if (!r.ok) return fail(r.error);
  // A repeated invite only renews the pending one: the invitee already has its popup.
  if (r.value.renewed) return { ok: true, message: `Your invite to ${target.name} is still pending.` };
  const inv = r.value.invite;
  target.send({ t: 'invite', invite: { inviteId: inv.id, fromCharacterId: s.characterId, fromName: s.name } });
  return { ok: true, message: `Invited ${target.name} to your party.` };
}

function partyRespond(game: Game, s: PlayerSession, inviteId: string, accept: boolean): CommandResult {
  if (!accept) {
    const r = game.parties.decline(s.characterId, inviteId);
    if (!r.ok) return fail(r.error);
    game.sessions.get(r.value.fromId)?.toast(`${s.name} declined your party invite.`, 'info');
    return OK;
  }
  const inv = game.parties.getInvite(inviteId);
  if (!inv || inv.toId !== s.characterId) return fail('That invite has expired or was withdrawn.');
  if (!game.sessions.has(inv.fromId)) {
    game.parties.decline(s.characterId, inviteId, false);
    return fail(`${inv.fromName} is no longer online.`);
  }
  const r = game.parties.accept(s.characterId, inviteId);
  if (!r.ok) return fail(r.error);
  game.systemChat(r.value.party.members, `${s.name} joined the party.`);
  game.markParty(s.characterId);
  return { ok: true, message: `You joined ${inv.fromName}'s party.` };
}

function visitHideout(game: Game, s: PlayerSession, targetId: string): CommandResult {
  if (targetId === s.characterId) {
    if (inOwnHideout(s)) return { ok: true, message: 'You are already home.' };
    game.sendHome(s);
    return OK;
  }
  if (!game.parties.sameParty(s.characterId, targetId)) return fail('You can only visit the hideouts of your party members.');
  const owner = game.sessions.get(targetId);
  if (!owner) return fail('That party member is offline.');
  const hideout = game.hideoutFor(targetId, owner.name);
  if (s.instance === hideout) return { ok: true, message: `You are already in ${owner.name}'s hideout.` };
  if (!hideout.hasRoom) return fail(`${owner.name}'s hideout is full.`);
  game.moveTo(s, hideout);
  return OK;
}

function chat(game: Game, s: PlayerSession, raw: string): CommandResult {
  const text = raw.trim();
  if (!text) return fail('Type a message first.');
  // "/trade <name>" works even when the client sends it as a chat line.
  const trade = /^\/trade(?:\s+(.*))?$/i.exec(text);
  if (trade) return game.trades.request(s, trade[1] ?? '');
  if (text.length > MAX_CHAT_CHARS) return fail(`Messages can be at most ${MAX_CHAT_CHARS} characters.`);
  const party = game.parties.partyOf(s.characterId);
  if (!party) return fail('Join a party to chat.');
  if (!s.chat.take(game.now())) return fail('You are sending messages too quickly.');
  const msg = { t: 'chat' as const, fromName: s.name, text, time: Date.now() };
  for (const id of party.members) game.sessions.get(id)?.send(msg);
  return OK;
}
