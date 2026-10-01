// The closing "What next?" card (docs/onboarding-ux.md 6.2.1): shown once after the last tracked step. Four rows; pressing one puts the
// world marker on the object (anvil, Rook, Map Device) and closes the card. It never opens a panel the player did not ask for.
import { gt } from '../../data/guide/strings';
import { cx } from '../components/common';
import { useLocal } from '../local';
import { useSignal, useStore } from '../store';
import { useGuideView } from './hooks';
import type { GuideOverrideKind } from './live';

const ROWS: { id: 'craft' | 'rook' | 'atlas' | 'map'; go: 'craftGo' | 'rookGo' | 'atlasGo'; kind: GuideOverrideKind }[] = [
  { id: 'craft', go: 'craftGo', kind: 'anvil' },
  { id: 'rook', go: 'rookGo', kind: 'merchant' },
  { id: 'atlas', go: 'atlasGo', kind: 'mapDevice' },
  { id: 'map', go: 'atlasGo', kind: 'mapDevice' },
];

export function WhatNext() {
  const store = useStore();
  const local = useLocal();
  const { view } = useGuideView();
  const live = useSignal(local.guide);
  if (!view.visible || view.step !== 'next' || live.nextClosed) return null;
  const close = (kind?: GuideOverrideKind): void => {
    store.actions.uiSound('close');
    local.guide.update((l) => ({ ...l, nextClosed: true, override: kind ? { kind, at: performance.now() } : l.override }));
    store.actions.guide({ op: 'finish' });
  };
  return (
    <section class="fe-guide fe-guide--next" role="region" aria-label={gt('next.title')} data-guide-next>
      <header class="fe-guide__head">
        <span class="fe-guide__chapter ui-type-caption">{gt('next.title')}</span>
      </header>
      <p class="fe-guide__intro ui-type-secondary">{gt('next.intro')}</p>
      <ul class="fe-guide__rows">
        {ROWS.map((r) => (
          <li key={r.id} class="fe-guide__row">
            <span class="fe-guide__rowtext">
              <b class="ui-type-body">{gt(`next.${r.id}.title`)}</b>
              <span class="ui-type-secondary">{gt(`next.${r.id}.body`)}</span>
            </span>
            <button type="button" class={cx('fe-guide__btn fe-guide__btn--go ui-type-caption')} data-next-row={r.id} onClick={() => close(r.kind)}>{gt(`next.${r.go}`)}</button>
          </li>
        ))}
      </ul>
      <footer class="fe-guide__foot">
        <span class="fe-guide__fill" />
        <button type="button" class="fe-guide__btn ui-type-caption" data-next-done onClick={() => close()}>{gt('next.done')}</button>
      </footer>
    </section>
  );
}
