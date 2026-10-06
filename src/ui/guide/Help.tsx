// The Help window (docs/onboarding-ux.md 6.7): opened by the "?" button, H, F1 or Shift+/ and from the Esc menu. Four tabs: Controls (the full
// reference, laid out so it never clips: the body scrolls under a fixed header with a visible scrollbar), How a run works, a searchable
// Glossary of the game's jargon, and Tutorial (progress, reset, skip, hide, tips). Keyboard: arrows move between tabs. Every string lives in
// src/data/guide/strings.ts.
import { useMemo, useRef, useState } from 'preact/hooks';
import { GUIDE_STEP_IDS } from '../../contracts/guide';
import { CONTROLS, GLOSSARY, gt } from '../../data/guide/strings';
import { Button, Frame, Keycap, PanelHead, Switch, cx } from '../components/common';
import { useLocal } from '../local';
import { useStore, useUi } from '../store';
import { TRACKED } from './steps';

type TabId = 'controls' | 'run' | 'glossary' | 'tutorial';
const TABS: TabId[] = ['controls', 'run', 'glossary', 'tutorial'];

export function HelpWindow() {
  const store = useStore();
  const local = useLocal();
  const [tab, setTab] = useState<TabId>('controls');
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const guide = useUi((s) => s.character?.guide);
  const tips = useUi((s) => s.settings.hints !== false);
  const close = (): void => {
    store.actions.uiSound('close');
    store.actions.closePanel('help');
  };
  const onTabKey = (e: KeyboardEvent): void => {
    const i = TABS.indexOf(tab);
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    setTab(TABS[next]);
    tabs.current[next]?.focus();
  };
  const glossary = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? GLOSSARY.filter((g) => g.term.toLowerCase().includes(q) || g.def.toLowerCase().includes(q)) : GLOSSARY;
  }, [query]);

  return (
    <div class="fe-backdrop fe-solid" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <Frame class="fe-modal fe-help fe-help2" role="dialog" aria-modal="true" aria-label={gt('help.title')} data-help-window>
        <PanelHead title={gt('help.title')} onClose={close} />
        <div class="fe-help2__tabs" role="tablist" aria-label={gt('help.title')}>
          {TABS.map((id, i) => (
            <button
              key={id}
              ref={(el) => { tabs.current[i] = el; }}
              type="button"
              role="tab"
              id={`fe-help-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="fe-help-panel"
              tabIndex={tab === id ? 0 : -1}
              data-help-tab={id}
              class={cx('fe-help2__tab ui-type-body', tab === id && 'fe-help2__tab--on')}
              onKeyDown={onTabKey as never}
              onClick={() => { store.actions.uiSound('click'); setTab(id); }}
            >
              {gt(`help.tabs.${id}`)}
            </button>
          ))}
        </div>
        <div class="fe-help2__body" id="fe-help-panel" role="tabpanel" aria-labelledby={`fe-help-tab-${tab}`} tabIndex={0}>
          {tab === 'controls' && (
            <>
              <div class="fe-help__grid fe-help2__grid">
                {CONTROLS.map((g) => (
                  <section key={g.title} class="fe-help__group">
                    <div class="fe-section-title">{g.title}</div>
                    {g.rows.map(([keys, what], i) => (
                      <div class="fe-help__row" key={i}>
                        <span class="fe-help__keys">{keys.map((k) => <Keycap key={k}>{k}</Keycap>)}</span>
                        <span class="fe-help__what">{what}</span>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
              <p class="fe-help__foot fe-muted ui-type-caption">{gt('help.controls.foot')}</p>
            </>
          )}
          {tab === 'run' && (
            <section class="fe-help2__run">
              <div class="fe-section-title">{gt('help.run.title')}</div>
              <ol class="fe-help2__steps ui-type-body">
                {GUIDE_RUN.map((_, i) => <li key={i}>{gt(`help.run.steps.${i}`)}</li>)}
              </ol>
            </section>
          )}
          {tab === 'glossary' && (
            <section class="fe-help2__gloss">
              <input class="fe-help2__search ui-type-secondary" type="search" placeholder={gt('help.glossary.search')} aria-label={gt('help.glossary.search')} value={query}
                onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }} />
              <dl class="fe-help2__terms">
                {glossary.map((g) => (
                  <div key={g.id} class="fe-help2__term" data-term={g.id}>
                    <dt class="ui-type-body">{g.term}</dt>
                    <dd class="ui-type-secondary">{g.def}</dd>
                  </div>
                ))}
                {glossary.length === 0 && <p class="fe-muted ui-type-secondary">{gt('help.glossary.empty')}</p>}
              </dl>
            </section>
          )}
          {tab === 'tutorial' && (
            <section class="fe-help2__tut">
              <p class="ui-type-body" data-tutorial-state>{guide ? gt(`help.tutorial.state.${guide.mode}`) : ''}</p>
              <div class="fe-section-title">{gt('help.tutorial.steps')}</div>
              <ul class="fe-help2__tasks ui-type-secondary">
                {TRACKED.map((id) => (
                  <li key={id} class={cx('fe-help2__task', guide?.done.includes(id) && 'fe-help2__task--done')} data-task={id} data-done={guide?.done.includes(id) ? '1' : '0'}>
                    <span class="fe-guide__mark" aria-hidden="true" />
                    {gt(`steps.${id as Exclude<typeof GUIDE_STEP_IDS[number], 'next'>}.title`, { area: 'Cinder Crossing', boss: 'the boss', portals: 8, wave: 1, waves: 6, name: '' })}
                  </li>
                ))}
              </ul>
              <div class="fe-help2__acts">
                <Button variant="ember" data-tutorial-replay onClick={() => { store.actions.guide({ op: 'replay' }); local.guide.update((l) => ({ ...l, hiddenStep: null, nextClosed: false })); setNote(gt('help.tutorial.replayed')); }}>{gt('help.tutorial.replay')}</Button>
                <Button data-tutorial-skip disabled={guide?.mode === 'skipped'} onClick={() => { store.actions.guide({ op: 'skip' }); setNote(gt('help.tutorial.skipped')); }}>{gt('help.tutorial.skip')}</Button>
              </div>
              <label class="fe-help2__tips ui-type-secondary">
                <span>{gt('help.tutorial.tips')}</span>
                <Switch label={gt('help.tutorial.tips')} checked={tips} onChange={(v) => store.actions.updateSettings({ hints: v })} />
              </label>
              {note && <p class="fe-help2__note ui-type-secondary" role="status" data-tutorial-note>{note}</p>}
            </section>
          )}
        </div>
      </Frame>
    </div>
  );
}

const GUIDE_RUN = [0, 1, 2, 3, 4, 5];
