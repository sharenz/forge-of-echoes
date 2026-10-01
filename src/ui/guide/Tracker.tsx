// The objective tracker (docs/onboarding-ux.md 6.2): a compact card in the top-left HUD column with the current chapter's steps (at most
// five lines), the current step in body type with one line of help, a "Hide" that folds it to a pill until the next step, "Help" and a
// way out. It only points: pointer-events stay off its text, nothing is ever gated. Done lines fade away after 3 seconds. A screen
// reader hears one polite line per step change, never a progress tick.
import { useEffect, useRef } from 'preact/hooks';
import type { GuideStepId } from '../../contracts/guide';
import { gt } from '../../data/guide/strings';
import { cx } from '../components/common';
import { useMotion } from '../atlas/motion';
import { useLocal } from '../local';
import { useSignal, useStore } from '../store';
import { stepText, useGuideView } from './hooks';
import { chapterProgress, trackerLines } from './steps';

/** The step lines whose current state offers "take me there" (the keyboard path of a world click). */
const WALKABLE: Partial<Record<GuideStepId, 'mapDevice' | 'portal' | 'returnPortal'>> = { device: 'mapDevice', enter: 'portal', home: 'returnPortal' };

export function Tracker() {
  const store = useStore();
  const local = useLocal();
  const { view, snap } = useGuideView();
  const live = useSignal(local.guide);
  const { calm } = useMotion();
  const lines = trackerLines(view);
  const seen = useRef<Map<GuideStepId, 'initial' | 'fresh'>>(new Map());
  const first = useRef(true);

  // Keep the step's start time for the marker's escalation (UI-local; the persisted facts are on the account).
  useEffect(() => {
    if (view.step) local.guide.update((l) => ({ ...l, stepAt: performance.now() }));
  }, [view.step, view.variant, local]);

  if (!view.visible || !view.step || view.step === 'next') {
    first.current = false;
    return null;
  }
  // Steps that were already done when the card first appeared stay folded away; ones that complete in front of the player linger 3 s.
  for (const l of lines) if (l.state === 'done' && !seen.current.has(l.id)) seen.current.set(l.id, first.current ? 'initial' : 'fresh');
  first.current = false;

  const text = stepText(view.step, view.variant, snap);
  const progress = chapterProgress(view);
  const hidden = live.hiddenStep === view.step;
  const walk = view.variant === 'partyJoin' || view.variant === 'retryPortal' ? 'portal' : WALKABLE[view.step];
  const total = lines.length;
  const index = Math.max(1, lines.findIndex((l) => l.id === view.step) + 1);
  const spoken = view.variant === 'normal' && total > 1 ? `${gt('tracker.progress', { done: index, total })}: ${text.title}` : text.title;

  const walkTo = (): void => {
    const kind = walk;
    const anchor = kind ? store.world?.anchors().find((a) => a.kind === kind) : undefined;
    if (anchor) store.world?.walkTo(anchor.id);
  };

  if (hidden) {
    return (
      <div class="fe-guide fe-guide--pill" data-guide-step={view.step}>
        <button type="button" class="fe-guide__pill fe-solid ui-type-secondary" onClick={() => { store.actions.uiSound('open'); local.guide.update((l) => ({ ...l, hiddenStep: null })); }}
          aria-label={`${gt('tracker.region')}: ${text.title}`}>
          <span class="fe-guide__pilldot" aria-hidden="true" />
          {text.title}
        </button>
      </div>
    );
  }

  return (
    <section class={cx('fe-guide', calm && 'fe-guide--calm')} role="region" aria-label={gt('tracker.region')} data-guide-step={view.step} data-guide-variant={view.variant}>
      <div class="fe-guide__live" aria-live="polite" aria-atomic="true">{spoken}</div>
      {view.variant === 'normal' && (
        <header class="fe-guide__head">
          <span class="fe-guide__chapter ui-type-caption">{gt(`tracker.chapter.${view.chapter}`)}</span>
          <span class="fe-guide__count ui-type-caption" data-guide-count>{gt('tracker.progress', progress)}</span>
        </header>
      )}
      <ol class="fe-guide__lines">
        {lines.map((l) => {
          const mode = seen.current.get(l.id);
          if (l.state === 'done' && mode === 'initial') return null;
          const current = l.state === 'current';
          const t = current ? text : { title: gt(`steps.${l.id}.title`, { area: snap.area, boss: snap.run?.bossName ?? 'the boss', portals: snap.portal?.total ?? 8, wave: 1, waves: 6, name: '' }), body: '' };
          return (
            <li key={l.id} class={cx('fe-guide__line', `fe-guide__line--${l.state}`, l.state === 'done' && 'fe-guide__line--fold')} data-step={l.id} data-state={l.state} aria-current={current ? 'step' : undefined}>
              <span class="fe-guide__mark" aria-hidden="true" />
              <span class="fe-guide__text">
                <span class={cx('fe-guide__title', current ? 'ui-type-body' : 'ui-type-secondary')}>{t.title}</span>
                {current && <span class="fe-guide__body ui-type-secondary">{t.body}</span>}
                {current && snap.zone === 'map' && view.step === 'fight' && snap.run?.wave === 0 && !snap.done.includes('fight') && !live.used.has('move') && !live.used.has('cast') && (
                  <span class="fe-guide__body fe-guide__body--warm ui-type-secondary">{gt('warmup')}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {walk && (
        <div class="fe-guide__go">
          <button type="button" class="fe-guide__btn fe-guide__btn--go ui-type-caption" data-guide-walk onClick={walkTo}>{gt('tracker.walkTo')}</button>
        </div>
      )}
      <footer class="fe-guide__foot">
        <button type="button" class="fe-guide__btn ui-type-caption" data-guide-hide onClick={() => { store.actions.uiSound('close'); local.guide.update((l) => ({ ...l, hiddenStep: view.step })); }}>{gt('tracker.hide')}</button>
        <button type="button" class="fe-guide__btn ui-type-caption" data-guide-help onClick={() => { store.actions.uiSound('open'); store.actions.openPanel('help'); }}>? {gt('tracker.help')}</button>
        <span class="fe-guide__fill" />
        <button type="button" class="fe-guide__btn ui-type-caption" data-guide-skip title={gt('tracker.skipTitle')} onClick={() => { store.actions.uiSound('close'); store.actions.guide({ op: 'skip' }); }}>{gt('tracker.skip')}</button>
      </footer>
    </section>
  );
}
