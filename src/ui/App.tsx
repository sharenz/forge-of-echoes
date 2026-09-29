// Root component: picks the screen, owns the global keyboard handling and hosts the shared overlays.
import { useEffect } from 'preact/hooks';
import type { UiStore } from '../contracts/ui';
import { ArmedCursor } from './items/Crafting';
import { CursorHintHost, DialogHost, DragGhost, TooltipHost } from './components/Overlays';
import { escapeStep, isActivationKey, isControlTarget, isTypingTarget, keyAllowedWhile, keyCommand } from './lib/keys';
import { escapePanel, visiblePanels } from './lib/panels';
import type { Local } from './local';
import { AuthScreen, CharactersScreen, DisconnectedScreen, LoadingScreen } from './screens/Title';
import { GameScreen } from './screens/Game';
import { useUi } from './store';
import { cx } from './components/common';

/** Enter → chat field focus happens a frame later (store update + layout effect); keys in between go to the field. */
const CHAT_FOCUS_WINDOW_MS = 250;

function focusChatField(): boolean {
  const field = document.querySelector<HTMLInputElement>('.fe-chat__input');
  if (!field) return false;
  field.focus();
  return true;
}

function focusStashSearch(): boolean {
  const field = document.querySelector<HTMLInputElement>('.fe-search__input');
  if (!field) return false;
  field.focus();
  field.select();
  return true;
}

function handleKey(e: KeyboardEvent, store: UiStore, local: Local): void {
  const s = store.get();
  const typing = isTypingTarget(e.target);
  const inGame = s.screen === 'game';

  // In game a control never keeps keyboard focus (see mountUi's pointerup guard); if one still has it, the key
  // must not press it again (Space is a skill key) and is handled as a hotkey instead. Modals keep keyboard use.
  if (inGame && isControlTarget(e.target) && !(e.target as Element).closest('.fe-backdrop')) {
    if (isActivationKey(e.key)) e.preventDefault();
    (e.target as HTMLElement).blur();
  }

  // Chat was opened but its field has not taken focus yet, or the player clicked into the chat log: the
  // keystroke belongs to the field. Moving focus during keydown makes the browser insert the character there.
  if (inGame && s.chatOpen && !typing && e.key !== 'Escape') {
    const inChat = !!(document.activeElement as Element | null)?.closest?.('.fe-chat');
    const justOpened = performance.now() - local.chatOpenedAt < CHAT_FOCUS_WINDOW_MS;
    if ((inChat || justOpened) && focusChatField()) return;
  }
  const cmd = keyCommand(e, typing);
  if (!cmd) return;

  // Ctrl/⌘+F searches the stash while it is open (also from another text field); otherwise the browser keeps it.
  if (cmd.kind === 'search') {
    const blocked = !!visiblePanels(s.openPanels).modal || !!local.dialog.get() || !!s.affixChoice;
    if (inGame && !blocked && visiblePanels(s.openPanels).left === 'stash' && focusStashSearch()) e.preventDefault();
    return;
  }

  if (cmd.kind === 'escape' && local.dialog.get()) {
    e.preventDefault();
    local.dialog.set(null);
    return;
  }
  if (!inGame) return;
  if (typing) {
    // Text fields keep their keys; Esc just leaves the field (the chat input closes itself).
    if (cmd.kind === 'escape') {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
    return;
  }
  const blocked = !!visiblePanels(s.openPanels).modal || !!s.runSummary || !!local.dialog.get() || !!s.affixChoice;
  if (!keyAllowedWhile(cmd, blocked)) return;
  if (cmd.kind === 'toggle') {
    e.preventDefault();
    const wasOpen = s.openPanels.includes(cmd.panel);
    store.actions.uiSound(wasOpen ? 'close' : 'open');
    store.actions.togglePanel(cmd.panel);
    return;
  }
  if (cmd.kind === 'chat') {
    e.preventDefault();
    if (s.chatOpen) focusChatField();
    else {
      local.chatOpenedAt = performance.now();
      store.actions.setChatOpen(true);
    }
    return;
  }
  e.preventDefault();
  local.hideTooltip();
  const step = escapeStep({
    dragging: !!local.drag.get(),
    dialog: false,
    affixChoice: !!s.affixChoice,
    armed: !!s.armed,
    chatOpen: s.chatOpen,
    runSummary: !!s.runSummary,
    topPanel: escapePanel(s.openPanels),
  });
  switch (step.kind) {
    case 'cancelDrag':
      local.drag.set(null);
      break;
    case 'closeDialog':
      local.dialog.set(null);
      break;
    case 'cancelAffix':
      store.actions.cancelAffixChoice();
      break;
    case 'disarm':
      store.actions.disarm();
      break;
    case 'closeChat':
      store.actions.setChatOpen(false);
      break;
    case 'dismissSummary':
      store.actions.dismissRunSummary();
      break;
    case 'closePanel':
      store.actions.uiSound('close');
      // Esc on a visible trade window (whichever of trade / inventory opened last) closes it on purpose, which
      // cancels the trade; hiding it behind another panel does not.
      if (step.panel === 'trade' && s.trade) store.actions.tradeCancel();
      store.actions.closePanel(step.panel);
      if (step.panel === 'menu') store.actions.setPaused(false);
      break;
    case 'openMenu':
      store.actions.uiSound('open');
      store.actions.openPanel('menu');
      store.actions.setPaused(true);
      break;
  }
}

export function App({ store, local }: { store: UiStore; local: Local }) {
  const screen = useUi((s) => s.screen);
  const armed = useUi((s) => !!s.armed);
  const alt = useUi((s) => s.altHeld);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => handleKey(e, store, local);
    const onMove = (e: PointerEvent): void => {
      local.pointer.x = e.clientX;
      local.pointer.y = e.clientY;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', onMove);
    };
  }, [store, local]);

  // Tooltips and drags never survive a screen change.
  useEffect(() => {
    local.hideTooltip();
    local.drag.set(null);
  }, [screen, local]);

  return (
    <div class={cx('fe-app', armed && 'fe-app--armed', alt && 'fe-app--alt')}>
      {screen === 'loading' && <LoadingScreen />}
      {screen === 'auth' && <AuthScreen />}
      {screen === 'characters' && <CharactersScreen />}
      {screen === 'disconnected' && <DisconnectedScreen />}
      {screen === 'game' && <GameScreen />}
      <TooltipHost />
      <DragGhost />
      <ArmedCursor />
      <CursorHintHost />
      <DialogHost />
    </div>
  );
}
