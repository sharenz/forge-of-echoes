// Hooks shared by the guide's components: the derived tracker view, a coarse clock for timed UI, and the text of a step.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { GuideStepId } from '../../contracts/guide';
import { gt } from '../../data/guide/strings';
import { areaModalSignal } from '../atlas/area-modal';
import { useSignal, useStore, useUi } from '../store';
import { selectGuideSnapshot, snapshotEq } from './snapshot';
import { deriveGuide, type GuideSnapshot, type GuideView } from './steps';

/** The guide's snapshot and the view derived from it. Cheap: the selector only builds a small struct, `snapshotEq` stops re-renders. */
export function useGuideView(): { snap: GuideSnapshot; view: GuideView } {
  const store = useStore();
  const modal = useSignal(areaModalSignal);
  const snap = useUi((s) => selectGuideSnapshot(s, store.rules, !!modal), snapshotEq);
  const view = useMemo(() => deriveGuide(snap), [snap]);
  return { snap, view };
}

/** Re-render every `ms` while `active` (timed fades; the guide has no per-frame work in React). */
export function useTick(active: boolean, ms = 500): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN((v) => v + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return n;
}

export interface StepText { title: string; body: string }

/** The title and body of a tracker step for this snapshot (variants for a fall, a spent map, a friend's portal). */
export function stepText(step: GuideStepId, variant: GuideView['variant'], snap: GuideSnapshot): StepText {
  const portals = snap.portal?.total ?? 8;
  const params = {
    area: snap.area, portals, boss: (snap.run?.bossName ?? 'the boss').replace(/^The /, 'the '), wave: Math.max(1, snap.run?.wave ?? 1), waves: snap.run?.waveCount ?? 6,
    name: snap.portal?.ownerName ?? '',
  };
  if (variant === 'retryPortal') return { title: gt('retry.portal.title', params), body: gt('retry.portal.body', { ...params, portals: snap.portal?.remaining ?? 0 }) };
  if (variant === 'retryNoPortal') return { title: gt('retry.noPortal.title', params), body: gt('retry.noPortal.body', params) };
  if (variant === 'partyJoin') return { title: gt('retry.partyJoin.title', params), body: gt('retry.partyJoin.body', params) };
  if (step === 'next') return { title: gt('next.title'), body: gt('next.intro') };
  return { title: gt(`steps.${step}.title`, params), body: gt(`steps.${step}.body`, params) };
}
