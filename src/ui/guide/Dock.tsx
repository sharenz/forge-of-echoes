// The two things that sit above the command deck: the controls cheat-sheet on map entry (docs/onboarding-ux.md 6.5) and the coach card of
// a first-time hint (6.6). Neither takes the pointer except on its own buttons, neither ever blocks input, and the card never repeats text
// that another surface already shows. The sheet is a static `role="note"`; the card is a polite `role="status"` with a labelled dismiss.
import { useEffect, useRef, useState } from 'preact/hooks';
import { gt } from '../../data/guide/strings';
import { Keycap, cx } from '../components/common';
import { useLocal } from '../local';
import { useSignal, useStore } from '../store';
import { CHIPS, cheatsheetState, type ChipId } from './cheatsheet';
import { HINT_SHOW_MS } from './hints';
import { useGuideView, useTick } from './hooks';

const CHIP_KEYS: Record<ChipId, string[]> = {
  cast: ['LMB'], move: ['W', 'A', 'S', 'D'], flasks: ['1', '2', '3'], dash: ['Q'], panels: ['I', 'C', 'K', 'P', 'H'],
};

export function CheatSheet() {
  const local = useLocal();
  const { view, snap } = useGuideView();
  const live = useSignal(local.guide);
  const wanted = view.visible && !view.completed.has('fight');
  useTick(wanted && snap.zone === 'map', 400);
  const state = cheatsheetState({ wanted, inMap: snap.zone === 'map', startedAt: live.sheetAt, coreDoneAt: live.coreAt, used: live.used, now: performance.now() });
  if (!state.visible) return null;
  return (
    <div class={cx('fe-cheat', state.fading && 'fe-cheat--fading')} role="note" aria-label={gt('cheatsheet.title')} data-cheatsheet>
      {CHIPS.map((id) => (
        <span key={id} class={cx('fe-cheat__chip ui-type-secondary', state.dimmed.has(id) && 'fe-cheat__chip--used')} data-chip={id} data-used={state.dimmed.has(id) ? '1' : '0'}>
          <span class="fe-cheat__keys">{CHIP_KEYS[id].map((k) => <Keycap key={k}>{k}</Keycap>)}</span>
          <span class="fe-cheat__text">{gt(`cheatsheet.${id}.body`)}</span>
        </span>
      ))}
    </div>
  );
}

export function CoachCard() {
  const store = useStore();
  const local = useLocal();
  const live = useSignal(local.guide);
  const card = live.card;
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = card?.id ?? null;
  const at = card?.at ?? 0;
  // Auto-dismiss after nine seconds; hover or keyboard focus on the card pauses it (the timer restarts when the pointer leaves).
  useEffect(() => {
    if (!id) return;
    if (timer.current) clearTimeout(timer.current);
    if (paused) return;
    timer.current = setTimeout(() => local.guide.update((l) => (l.card?.at === at ? { ...l, card: null } : l)), HINT_SHOW_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [id, at, paused, local]);
  if (!card) return null;
  const close = (): void => { store.actions.uiSound('close'); local.guide.update((l) => ({ ...l, card: null })); };
  return (
    // The card takes the pointer only on its buttons: the cursor may rest over its text while aiming and casting, and a click there still reaches the world.
    <div class="fe-coach" role="status" aria-live="polite" data-coach={card.id}
      onFocusIn={() => setPaused(true)} onFocusOut={() => setPaused(false)}>
      <span class="fe-coach__mark" aria-hidden="true" />
      <p class="fe-coach__text ui-type-body">{gt(`hints.${card.id}`)}</p>
      <span class="fe-coach__acts" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
        <button type="button" class="fe-guide__btn fe-guide__btn--go ui-type-caption" data-coach-ok onClick={close}>{gt('hint.gotIt')}</button>
        <button type="button" class="fe-guide__btn ui-type-caption" data-coach-mute onClick={() => { store.actions.updateSettings({ hints: false }); close(); }}>{gt('hint.mute')}</button>
      </span>
    </div>
  );
}
