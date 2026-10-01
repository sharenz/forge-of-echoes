// Forge of Echoes — DOM UI (Preact) over the game canvas. Implements src/contracts/ui.ts:
//
//   mountUi(root, store) → unmount
//
// The UI is a pure view over UiState that calls UiActions; item / crafting / skill text comes from the shared
// rules (store.rules), icons and the portrait from store.art. It never touches the network, sim or renderer.
//
// INTEGRATION NOTES (for src/client)
//   • Layering: the root covers the viewport with `pointer-events: none`; only real surfaces (panels, HUD
//     widgets, dialogs — class `fe-solid`) take the pointer. Put the canvas underneath and listen for world
//     input on the canvas itself, so clicks on the UI never reach the game.
//   • Keys the UI owns (window keydown, bubble phase): I / C / K / P toggle inventory / character / skills /
//     party, Enter opens chat, Esc runs the close chain (drag → dialog → affix choice → armed currency → chat
//     → run summary → top panel, where a visible trade window always goes first → open menu), Ctrl/⌘+F focuses the stash search while the stash is open (only
//     then is the browser's find prevented). Keys are ignored while a text field has focus, and while a modal
//     (menu, help, run summary, confirm dialog, affix choice) is up only Esc gets through. Everything else
//     (WASD, skills, flasks, T auto-attack, Alt) belongs to the client input layer.
//   • Focus: in game, UI controls hand focus back on pointerup, so Space / Enter never re-press a button. The
//     client should still preventDefault its own game keys (Space scrolls / activates by default).
//   • Alt: set `altHeld` from the input layer and preventDefault Alt (otherwise the browser menu takes focus).
//   • Chat: while `chatOpen` the client must not treat keys as movement. The UI closes the chat itself when the
//     field loses focus to anything outside it (a click on the world), keeping the draft. ChatLine.time is epoch
//     milliseconds (shown as local HH:MM).
//   • Crafting: one application per click; Shift keeps the currency armed (PoE). The UI calls disarm() after
//     applyArmed() / chooseAffix() itself. A right-click on the WORLD while `armed` should call disarm() (the UI
//     never sees canvas clicks).
//   • `derived`: in a map, compute it with deriveRunStats (map-aware); in hideouts with rules.deriveStats. The map
//     device shows derived.itemQuantity / itemRarity as the gear share of the personal luck.
//   • Layout: docked panels stop above the command deck (tokens.css --deck-clear), and the top HUD, toasts and
//     overlays centre in the area the panels leave free. Toasts never take the pointer.
//   • Panels: the UI keeps `openPanels` consistent through actions — only the newest left panel stays open,
//     and stash / merchant / map device open the inventory with them (and close when the player closes the
//     inventory under them). Opening the menu calls setPaused(true); closing it setPaused(false).
//   • Toasts are dismissed by the UI after ~5 s via actions.dismissToast(id); at most 3 show at once.
//   • The inventory calls actions.clearNewFlags() when it closes and any item still carries isNew.
//   • Item drags validate with rules.moveItem / canEquip (pure) before calling actions.moveItem; releasing an
//     item over the world (inside the window, outside every .fe-solid surface) calls actions.dropItem(uid): a
//     public drop at your feet. A release outside the browser window, or over a UI surface that is not a drop
//     target, cancels the drag; the map in the map device is never offered to dropItem (it goes back to the bags
//     first). Two drop targets are not item locations: the crafting bench socket (actions.setBenchItem(uid)) and
//     your side of the trade window (actions.tradeOffer(all uids)).
//   • Ctrl/⌘-click, by the visible left panel: trade window + backpack item → add to / remove from your offer;
//     crafting bench + gear or map (anywhere) → setBenchItem(uid); map device (own hideout) + map →
//     moveItem(uid, mapDevice); every other Ctrl-click calls actions.quickMove(uid). Ctrl/⌘+Shift-click on gear
//     or a map in the stash (hideout) → setBenchItem(uid) + openPanel('craftingBench').
//   • Crafting bench ('craftingBench'; the client opens it from the anvil in any hideout): recipes come from
//     rules.benchRecipes (display), crafting is actions.benchCraft(recipeId) / benchClear() on state.benchItemUid.
//     The currency palette applies a stack in one click as armCurrency(uid) → applyArmed(benchUid) → disarm(),
//     synchronously, so armCurrency must update `armed` before it returns. The UI resets a benchItemUid whose item
//     is gone with setBenchItem(null). A bench item that is in your trade offer stays placed but locked (no recipe,
//     clear or currency until the trade closes).
//   • Trading: when state.trade turns non-null the UI opens the 'trade' panel (the inventory comes along); when it
//     turns null the panel closes. Closing the window on purpose (its X, Esc, Cancel) calls tradeCancel(); hiding
//     it behind another left panel keeps the trade and a HUD chip brings it back. Offered backpack items are locked
//     (no drag, move, merge, craft or drop). acceptLockedUntil is compared with Date.now() + state.serverClockOffset.
//     Give the UI display rules wrapped like the server's, withItemLocks(rules, () => uids of state.trade.yourItems)
//     (src/game/online.ts), so move previews, bench recipes, craft previews and merchant affordability match what
//     the server allows; the UI guards the lock itself too.
//     Chat "/trade <name>" calls actions.tradeRequest(name) and is never sent as chat; the party panel has a Trade
//     button per online member.
//   • Reconnecting: the disconnected screen (connection 'reconnecting' / 'connecting') shows `state.error` as its
//     headline when set, else "The link to the server broke." Set it to "Server updating — reconnecting…" on close
//     code 4004 (GAME_SPEC §11 drain) and back to null once online; the screen always says the character, party
//     and open maps are kept.
//   • Stash search is UI-local (Local.search): it applies while the stash is the visible left panel and marks
//     matching stash and backpack items, Map Stash maps and filled Crafting Stash slots (lib/search.ts over
//     rules.describeItem).
//   • Right-click on a currency calls actions.armCurrency(uid) only when state.craftingAllowed; left-click on
//     a target calls actions.applyArmed(uid) only when rules.craftingTargetError is null. For Seal / Catalyst
//     / Fracture Core the store sets `affixChoice`; the popover calls actions.chooseAffix(i) where i indexes
//     item.affixes (== describeItem(item).affixes).
//   • Map device personal luck: rules.openMap(ch) is called as a pure PREVIEW and fed to rules.lootLuck.
//     Activating while your own portal still has entries asks for confirmation first.
//   • HUD map mods: HudRun.modLines are coloured danger / reward by matching them against
//     describeItem(state.run.map).affixes, so keep `state.run` set while in a map.
//   • Special stash tabs (GAME_SPEC §12): state.stashTab may be 'maps' | 'currency' | 'mapCurrency' (after the normal
//     tabs; setStashTab(tab)). Pass it on as quickMove's ctx.stashTab; maps and currency file into their special
//     storage from any stash tab, while equipment and flasks use the selected normal tab. The UI calls:
//       moveItem(uid, { kind: 'currencyStash' })  a currency dropped on either Crafting Stash tab (button or page)
//       moveItem(uid, { kind: 'mapStash' })       a map dropped on the Map Stash tab / page / the device's picker
//       moveItem('cstash:<id>', backpack cell)    a slot dragged out (no count: the rules take a full stack)
//       moveItem(mapUid, { kind: 'mapDevice' })   click / Ctrl-click / drag in the map device's Map Stash picker
//       quickMove('cstash:<id>')                  Ctrl-click a slot: a stack;  quickMove('cstash:<id>', 1): Shift+Ctrl
//       quickMove(mapUid)                         Ctrl-click a Map Stash map (to the backpack)
//       armCurrency('cstash:<id>')                right-click a slot; applyArmed(target) then crafts from the slot, so
//                                                 armCurrency must accept slot uids (rules.findItem resolves them).
//                                                 The UI disarms by itself once the armed slot is empty.
//       depositAllCurrency()                      the "Deposit all" button on the Crafting Stash tabs
//     The crafting bench palette also offers Crafting Stash currency (uid cstash:<id> when the backpack has none),
//     and Rook's / the inventory's Forge Scrap wallet counts the backpack, stash tabs and the Crafting Stash (what
//     the rules let you spend). A slot dragged onto the world is refused in the UI (the rules refuse it too).
//   • Debuffs: HudState.debuffs drives the bar above the command deck (icon/debuff/<id>, radial timer from
//     remaining / duration, stacks). Send `remaining` in seconds at the HUD rate; a jump up in `remaining` or
//     `stacks` is read as a re-application (the icon pops). Empty while dead. The deck slot that answers an
//     active debuff (Rift Step for a root, the Life flask for burning / bleeding, the Focus flask for withered)
//     glows meanwhile.
//   • Bestiary names: the Tell banner names the lieutenant / boss of state.run.map.baseId (THEME_ROSTER) and lists
//     the debuffs the wave can bring. HudRun.boss / lieutenant `name` may be a display name or a MonsterKind id;
//     the bars show the full title ("hollowWarden" / "Hollow Warden" → "The Hollow Warden", "Varkus" →
//     "Varkus, the Iron Champion"; src/ui/lib/content.ts).
//   • CSS: tokens, layout geometry and the 14/16/19/28 type scale live in src/ui/styles/tokens.css (the only
//     font sizes).
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/alegreya-sans/latin-400.css';
import '@fontsource/alegreya-sans/latin-500.css';
import '@fontsource/alegreya-sans/latin-700.css';
import '@fontsource/alegreya-sans/latin-400-italic.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/screens.css';
import './styles/hud.css';
import './styles/items.css';
import './styles/panels.css';
import './styles/bench.css';
import './styles/trade.css';
import './styles/stash.css';
import './styles/workslot.css';
import './styles/debuffs.css';
import './styles/merchant.css';

import { h, render } from 'preact';
import type { MountUi, UiStore } from '../contracts/ui';
import { App } from './App';
import { isControlTarget } from './lib/keys';
import { LocalContext, createLocal } from './local';
import { StoreContext } from './store';

export function mountUi(root: HTMLElement, store: UiStore): () => void {
  const local = createLocal();
  root.classList.add('fe-root');
  const block = (e: Event): void => {
    // The browser menu would cover right-click crafting on UI surfaces.
    if ((e.target as Element | null)?.closest?.('.fe-solid')) e.preventDefault();
  };
  // In game a clicked button / switch / slider hands its focus back straight away, so keyboard input cannot
  // press the control again (an attribute point, a purchase, a map activation). Click still fires.
  const releaseFocus = (): void => {
    if (store.get().screen !== 'game') return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && root.contains(el) && isControlTarget(el)) el.blur();
  };
  root.addEventListener('contextmenu', block);
  window.addEventListener('pointerup', releaseFocus, true);
  render(h(StoreContext.Provider, { value: store }, h(LocalContext.Provider, { value: local }, h(App, { store, local }))), root);
  return () => {
    render(null, root);
    root.removeEventListener('contextmenu', block);
    window.removeEventListener('pointerup', releaseFocus, true);
    root.classList.remove('fe-root');
  };
}

// Compile-time check that the implementation matches the frozen contract type.
const contractCheck: MountUi = mountUi;
void contractCheck;
