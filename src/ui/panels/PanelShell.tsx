import type { ComponentChildren } from 'preact';
import type { Panel } from '../../contracts/ui';
import { Frame, PanelHead, cx } from '../components/common';
import { panelSide } from '../lib/panels';
import { useStore } from '../store';

/** A docked panel: left (stash, character, skills, party, map device, merchant, bench, trade) or right (inventory). */
export function PanelShell({
  panel,
  title,
  children,
  class: klass,
  aside,
  onClose,
}: {
  panel: Panel;
  title: string;
  children: ComponentChildren;
  class?: string;
  /** Small content in the head's top-left (counters such as unspent points). */
  aside?: ComponentChildren;
  /** Runs before the panel closes from its close button (the trade window cancels the trade). */
  onClose?: () => void;
}) {
  const store = useStore();
  const side = panelSide(panel);
  return (
    <Frame class={cx('fe-panel fe-solid', `fe-panel--${side}`, klass)} role="region" aria-label={title} data-panel={panel}>
      <PanelHead
        title={title}
        onClose={() => {
          store.actions.uiSound('close');
          onClose?.();
          store.actions.closePanel(panel);
        }}
      />
      {aside && <div class="fe-panel__aside">{aside}</div>}
      <div class="fe-panel__body">{children}</div>
    </Frame>
  );
}
