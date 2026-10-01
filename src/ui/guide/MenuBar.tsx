// Visible panel buttons with their hotkeys (docs/onboarding-ux.md F-7): Inventory (I), Character (C), Skills (K) to the left of the command deck,
// Party (P), the Atlas (the Map Device) and Help (?) to its right, so the panels never depend on a hotkey a new player has not learned.
// A dot on a button says there are points to spend there. The hotkeys keep working; this only makes them visible.
import type { ComponentChildren } from 'preact';
import type { Panel } from '../../contracts/ui';
import { gt } from '../../data/guide/strings';
import { mapTreeFreePoints } from '../../game/progression/map-tree';
import { cx } from '../components/common';
import { panelHotkey } from '../lib/points';
import { useLocal } from '../local';
import { shallowEqual, useStore, useUi } from '../store';

const Glyph = ({ children }: { children: ComponentChildren }) => (
  <svg class="fe-menubtn__glyph" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{children}</svg>
);

const GLYPHS: Record<string, ComponentChildren> = {
  inventory: <Glyph><path d="M7 8a5 5 0 0 1 10 0" /><path d="M5 9h14l-1 11H6z" /><path d="M9 14h6" /></Glyph>,
  character: <Glyph><circle cx="12" cy="7.5" r="3.4" /><path d="M5 20c0-4.2 3-6.6 7-6.6s7 2.4 7 6.6" /></Glyph>,
  skills: <Glyph><path d="M12 3l2.4 5.6 6 .6-4.6 4 1.4 6-5.2-3.2L6.8 19.2l1.4-6-4.6-4 6-.6z" /></Glyph>,
  party: <Glyph><circle cx="8.5" cy="8" r="3" /><circle cx="16.5" cy="9" r="2.5" /><path d="M2.8 19c0-3.6 2.6-5.6 5.7-5.6s5.7 2 5.7 5.6" /><path d="M14.6 14c3.4-.6 6.6 1 6.6 4.8" /></Glyph>,
  atlas: <Glyph><path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z" /><path d="M9 4.5v13M15 6.5v13" /></Glyph>,
  help: <Glyph><circle cx="12" cy="12" r="9" /><path d="M9.3 9.4a2.8 2.8 0 1 1 4.1 2.5c-.9.5-1.4 1-1.4 2" /><circle cx="12" cy="17" r=".6" fill="currentColor" /></Glyph>,
};

interface Entry { id: 'inventory' | 'character' | 'skills' | 'party' | 'atlas' | 'help'; panel: Panel; key: string; name: string; dot?: number }

export function MenuBar({ side }: { side: 'l' | 'r' }) {
  const store = useStore();
  const local = useLocal();
  const open = useUi((s) => s.openPanels, shallowEqual);
  const zone = useUi((s) => s.zone);
  const pts = useUi((s) => ({
    attr: s.character?.unspentAttributePoints ?? 0,
    skill: s.character?.unspentSkillPoints ?? 0,
    atlas: s.zone === 'hideout' && s.isOwnHideout ? Math.max(0, mapTreeFreePoints(s.character?.atlas)) : 0,
  }), shallowEqual);
  const all: Entry[] = [
    { id: 'inventory', panel: 'inventory', key: panelHotkey('inventory') ?? 'I', name: gt('panels.inventory') },
    { id: 'character', panel: 'character', key: panelHotkey('character') ?? 'C', name: gt('panels.character'), dot: pts.attr },
    { id: 'skills', panel: 'skills', key: panelHotkey('skills') ?? 'K', name: gt('panels.skills'), dot: pts.skill },
    { id: 'party', panel: 'party', key: panelHotkey('party') ?? 'P', name: gt('panels.party') },
    { id: 'atlas', panel: 'mapDevice', key: panelHotkey('mapDevice') ?? 'M', name: gt('panels.atlas'), dot: pts.atlas },
    { id: 'help', panel: 'help', key: '?', name: gt('panels.help') },
  ];
  const list = side === 'l' ? all.slice(0, 3) : all.slice(3);
  return (
    <div class={cx('fe-menubar', `fe-menubar--${side}`, 'fe-solid')} role="toolbar" aria-label={side === 'l' ? 'Character panels' : 'Party, Atlas and help'}>
      {list.map((e) => {
        const on = open.includes(e.panel);
        const blocked = e.id === 'atlas' && zone !== 'hideout';
        const hint = e.id === 'atlas' ? (blocked ? 'Open it in your hideout: click the Map Device' : 'Press M, or click the Map Device in your hideout') : e.key ? `Press ${e.key}` : '';
        return (
          <button
            key={e.id}
            type="button"
            class={cx('fe-menubtn', on && 'fe-menubtn--on', blocked && 'fe-menubtn--off')}
            data-menubtn={e.id}
            aria-pressed={on}
            aria-label={`${e.name}${e.key ? ` (${e.key})` : ''}`}
            onPointerEnter={(ev) => local.showTooltip({ kind: 'text', title: `${e.name}${e.key ? ` (${e.key})` : ''}`, lines: [hint, ...(e.dot ? [`${e.dot} to spend`] : [])].filter(Boolean) }, ev.currentTarget, 'above')}
            onPointerLeave={() => local.hideTooltip()}
            onClick={() => {
              local.hideTooltip();
              if (e.id === 'atlas' && zone !== 'hideout') { store.actions.uiSound('error'); local.flashHint('The Map Device is in your hideout.'); return; }
              store.actions.uiSound(on ? 'close' : 'open');
              store.actions.togglePanel(e.panel);
            }}
          >
            {GLYPHS[e.id]}
            <span class="fe-menubtn__key ui-type-caption" aria-hidden="true">{e.key}</span>
            {!!e.dot && <span class="fe-menubtn__dot" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
