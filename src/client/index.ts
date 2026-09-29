// Browser client (ARCHITECTURE.md "client"): connection, UiStore, input → InputMessage, the frame loop and the
// presenter wiring. Entry: `startClient()` from src/main.ts.
//
// PAGE: index.html provides <canvas id="world">, <div id="fade"> and <div id="ui"> (created here if missing).
//
// PUBLIC NOTES
//   • localStorage holds only 'foe.token' (session) and 'foe.settings' (JSON Settings, written 250 ms after the last
//     change). sessionStorage (per tab) holds 'foe.reloadedForProtocol' (time of the last automatic reload; see
//     reload-guard.ts) and 'foe.resumeCharacter' (a reload the client made itself goes straight back into the
//     character).
//   • window.__foe (debug / e2e; ONLY in dev builds or builds made with VITE_FOE_DEBUG=1 — production bundles contain
//     neither the hooks nor the autopilot): { store, world, session, connection, send(cmd) → Promise<result>,
//     bot.enable(opts?) / bot.disable() (client-side autopilot), worldToScreen(x, y), dropOnScreen(dropId), stats(),
//     dropConnection() (simulated network drop → reconnect + in-place resume), dropEvents() (drop/pickup events by
//     owner: own / public / foreign), skewSnapshots('once' | 'always' | 'off') (a stale bundle after a deploy:
//     snapshots it cannot decode) }.
//   • Input: WASD / arrows move, LMB / RMB / Q / E / R / F freely assigned skills, 1–4 flasks, T auto-attack,
//     Alt affix details. The UI owns I C K P, Enter and Esc. Game keys are ignored while a text field has focus,
//     while chat is open, and (as input) while the menu is open. Keycaps follow the keyboard layout where the
//     browser tells it (navigator.keyboard; AZERTY shows A for the Q slot).
//   • World clicks, by priority (world-pick.ts): a ground item's label or sprite (Presenter.dropAt) → `pickup`,
//     walking there first when out of reach (autowalk.ts: steering replaces the keyboard until the predicted feet are
//     within PICKUP_APPROACH; WASD, the item vanishing, death, a zone change, the menu or another click cancel it);
//     an open portal → `usePortal`; the map device / stash / merchant / anvil (Crafting Bench) → their panel, in any
//     hideout. Only a click on none of them is the basic attack (and it holds until the button is released). Hover
//     shows the hand cursor and the presenter's highlight (hoverDropId / hoverPropId); the item being walked to
//     stays highlighted.
//   • Special stash tabs (GAME_SPEC §12): UiState.stashTab is a normal tab index or 'maps' | 'currency' |
//     'mapCurrency' (setStashTab validates; a character update keeps a special tab and clamps a normal one). While the
//     stash panel is open (hideouts only) quickMove(uid, count?) sends the open tab as its stashTab, so a Ctrl-click
//     files a backpack map into the Map Stash / a currency stack into its Crafting Stash slot, and a slot
//     ("cstash:<id>") or a Map Stash map comes back to the backpack; `count` (Shift+Ctrl-click: 1) is a partial
//     withdrawal. moveItem(uid, to, count?) takes { kind: 'currencyStash' | 'mapStash' } and partial stacks too. Both
//     are checked and predicted with the local rules (a count must be a whole 1..CURRENCY_STASH_MAX).
//     depositAllCurrency() is predicted and toasts the server's "Stored N currency…" answer (hideouts only). A slot
//     arms like any currency (armCurrency('cstash:<id>')): crafting draws from the slot, and the armed slot disarms
//     once it is empty. dropItem refuses a slot locally; a Map Stash map drops like a stashed item.
//   • Debuffs (GAME_SPEC §13): HudState.debuffs is a copy of the local PlayerView.debuffs (the replica's predicted
//     timeline) at the HUD rate — seconds, timers within their duration, one card per debuff, empty while dead and
//     after a zone change. Every 'events' batch also goes to ClientWorld.noteEvents (her chain-hook drags), even
//     while the page is hidden.
//   • Music: the map's theme colours the map / boss tracks (src/audio setMusicTheme) from every zone entry
//     (music.ts musicThemeFor; hideouts and the title play the plain tracks).
//   • Items: dropItem(uid) → `dropItem` (shown gone at once where the server allows it). The crafting bench is a UI
//     selection (benchItemUid, cleared when the item leaves the character); benchCraft / benchClear → commands on
//     it (hideout only). The display rules (store.rules) lock your trade offer's items like the server
//     (withItemLocks).
//   • Trading: 'tradeRequest' → a card (tradeRequests; stale cards expire after 3 min); 'trade' → UiState.trade (a
//     NEW trade opens the 'trade' panel, null closes it; the result text is toasted, except "Trade completed",
//     which the server toasts itself). tradeOffer / tradeAccept show at once and roll back on a refusal;
//     tradeCancel closes the window at once. A dropped connection ends the trade (the server cancels it too).
//     serverClockOffset (for the accept lock) comes from welcome/pong serverTime (half the round trip added).
//   • Zone changes: ClientWorld.setZone + EventTimeline.clear + presenter.reset, then a short fade from black. A
//     reconnect that resumes the same instance (same instanceId and player id) keeps the picture: no fade, no reset.
//     After a server update it never counts as a resume (the restarted server's ids start over).
//   • Server updates (close 4004, GAME_SPEC §11): the calm "Server updating — reconnecting…" screen right away (the
//     game state stays underneath; nothing is drawn behind it), retries every 1–3 s for up to ~10 minutes, and the
//     restarted server puts the character back into its party, hideout or restored map (a normal zone entry). The
//     drain announcement arrives as an ordinary toast + system chat line.
//   • After any reconnect the party and invite cards are what the server re-sends: whatever it has not re-sent by
//     the new zone's first snapshot (a party dissolved or a kick while away) is dropped — never a stale party.
//   • Stale bundles: a protocol mismatch (4002) or MAX_SNAPSHOT_FAILURES undecodable snapshots in a row end the
//     session with 'reload'; the page reloads once into the same character. If the world is still unreadable after
//     that reload, the disconnected screen explains (a hard reload) instead of reloading again; ~3 s of readable
//     snapshots re-arm the automatic reload for the next deploy.
//   • Events due at the render tick (EventTimeline) go to the presenter; the local player's own events play at once.
//     At most MAX_FRAME_EVENTS per frame; none are queued while the tab is hidden or kept while frames stall.
//   • Commands that die with a dropped connection resolve { ok: false, lost: true } and stay silent (no toast).
import { ClientApp, type ClientElements } from './app';

export { ClientApp } from './app';
// Types only: the debug hooks and the autopilot must never be pulled into the production bundle by a value export.
export type { ClientStats, FoeDebug } from './debug';
export type { BotOptions } from './bot';

function element<T extends HTMLElement>(id: string, make: () => T): T {
  const found = document.getElementById(id);
  if (found) return found as T;
  const el = make();
  el.id = id;
  document.body.appendChild(el);
  return el;
}

/** Find (or create) the page elements and start the client. */
export function startClient(): ClientApp {
  const els: ClientElements = {
    canvas: element('world', () => document.createElement('canvas')),
    fade: element('fade', () => document.createElement('div')),
    uiRoot: element('ui', () => document.createElement('div')),
  };
  els.canvas.classList.add('foe-world');
  els.fade.classList.add('foe-fade');
  const app = new ClientApp(els);
  app.start().catch((err: unknown) => console.error('[foe] client failed to start', err));
  return app;
}
