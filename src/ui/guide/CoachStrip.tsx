// The tracker's line repeated inside the panel the step is about (docs/onboarding-ux.md 6.2): when a docked panel covers the tracker (the Atlas
// plus the inventory fill a 1024x600 screen), the open panel shows "Step 3 of 5: Drag a map into the slot" under its title instead.
import type { Panel } from '../../contracts/ui';
import { gt } from '../../data/guide/strings';
import { stepText, useGuideView } from './hooks';
import { trackerLines } from './steps';

export function CoachStrip({ panel }: { panel: Panel }) {
  const { view, snap } = useGuideView();
  if (!view.visible || !view.step || view.variant !== 'normal') return null;
  const s = view.step;
  const about =
    (panel === 'mapDevice' && (s === 'area' || s === 'map' || s === 'open'))
    || (panel === 'inventory' && (s === 'map' || s === 'equip'))
    || (panel === 'character' && s === 'points' && snap.unspent.attribute > 0)
    || (panel === 'skills' && s === 'points' && snap.unspent.skill > 0);
  if (!about) return null;
  const lines = trackerLines(view);
  const index = lines.findIndex((l) => l.id === s) + 1;
  const text = stepText(s, 'normal', snap);
  return (
    <div class="fe-coachstrip" data-coach-strip={s} role="note">
      <span class="fe-coachstrip__step ui-type-caption">{gt('tracker.progress', { done: index, total: lines.length })}</span>
      <span class="fe-coachstrip__text ui-type-secondary"><b>{text.title}.</b> {text.body}</span>
    </div>
  );
}
