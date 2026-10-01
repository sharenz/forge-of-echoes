// The starter-map "drag me" hand (docs/onboarding-ux.md 6.4): while the tracker asks to drag a map into the slot and the area modal is open, a
// pointing hand loops from the first map that fits (the inventory already outlines those) to the map slot: rest, press, glide, release, fade,
// every 2.4 s. It stops at the first pointer-down on an item and comes back only after 10 idle seconds with nothing dragged. With reduced motion
// it is a static dashed arrow with the label "Drag". Pure decoration: aria-hidden, no pointer events; the keyboard and Ctrl/Cmd-click paths exist.
import { useEffect, useRef, useState } from 'preact/hooks';
import { cx } from '../components/common';
import { useMotion } from '../atlas/motion';
import { useLocal } from '../local';
import { useSignal } from '../store';
import { useGuideView } from './hooks';

const IDLE_RETURN_MS = 10_000;

interface Pair { x0: number; y0: number; x1: number; y1: number }

const center = (r: DOMRect): { x: number; y: number } => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

export function DragHand() {
  const local = useLocal();
  const { view, snap } = useGuideView();
  const { calm } = useMotion();
  const fits = useSignal(local.fits);
  const drag = useSignal(local.drag);
  const [pair, setPair] = useState<Pair | null>(null);
  const stopped = useRef<number | null>(null);
  const [, bump] = useState(0);
  const wanted = view.visible && view.step === 'map' && snap.areaModal && !snap.deviceMap && !!fits && fits.size > 0;

  // A drag of anything stops the hand; it returns after ten quiet seconds.
  useEffect(() => {
    if (drag) { stopped.current = performance.now(); bump((n) => n + 1); }
  }, [drag]);
  useEffect(() => {
    if (!wanted || stopped.current === null) return;
    const t = setTimeout(() => { stopped.current = null; bump((n) => n + 1); }, IDLE_RETURN_MS);
    return () => clearTimeout(t);
  }, [wanted, drag, stopped.current]);

  // Measure the first fitting item and the slot; they move with layout, so re-measure twice a second.
  useEffect(() => {
    if (!wanted) { setPair(null); return; }
    const measure = (): void => {
      const uid = [...(local.fits.get() ?? [])][0];
      const item = uid ? document.querySelector<HTMLElement>(`.fe-item[data-uid="${CSS.escape(uid)}"]`) : null;
      const slot = document.querySelector<HTMLElement>('[data-slot="mapDevice"]');
      if (!item || !slot) { setPair(null); return; }
      const a = center(item.getBoundingClientRect());
      const b = center(slot.getBoundingClientRect());
      setPair((p) => (p && Math.abs(p.x0 - a.x) < 1 && Math.abs(p.y0 - a.y) < 1 && Math.abs(p.x1 - b.x) < 1 && Math.abs(p.y1 - b.y) < 1 ? p : { x0: a.x, y0: a.y, x1: b.x, y1: b.y }));
    };
    measure();
    const t = setInterval(measure, 500);
    return () => clearInterval(t);
  }, [wanted, local]);

  if (!wanted || !pair || (stopped.current !== null && !calm)) return null;
  const dx = pair.x1 - pair.x0;
  const dy = pair.y1 - pair.y0;
  if (calm) {
    const len = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    return (
      <div class="fe-hand fe-hand--calm" aria-hidden="true" data-drag-hand="static">
        <span class="fe-hand__line" style={{ left: `${pair.x0}px`, top: `${pair.y0}px`, width: `${len}px`, transform: `rotate(${angle}deg)` }} />
        <span class="fe-hand__label ui-type-caption" style={{ left: `${(pair.x0 + pair.x1) / 2}px`, top: `${(pair.y0 + pair.y1) / 2}px` }}>Drag</span>
      </div>
    );
  }
  return (
    <div class="fe-hand" aria-hidden="true" data-drag-hand="loop">
      <span class={cx('fe-hand__pointer')} style={{ left: `${pair.x0}px`, top: `${pair.y0}px`, '--dx': `${dx}px`, '--dy': `${dy}px` } as never}>
        <svg viewBox="0 0 24 24" width="34" height="34"><path d="M8 3.5a1.6 1.6 0 0 1 3.2 0V9l.5-.2a1.6 1.6 0 0 1 2.1 1l.3-.1a1.6 1.6 0 0 1 2 1.1l.2-.1a1.6 1.6 0 0 1 1.9 1.6v4.2c0 2.6-1.8 4.5-4.4 4.5h-1.6c-1.7 0-2.8-.6-3.8-1.8L5 15.1a1.7 1.7 0 0 1 2.5-2.2L8 13.4z" fill="#f4e6c4" stroke="#1a1310" stroke-width="1.2" stroke-linejoin="round" /></svg>
        <span class="fe-hand__label ui-type-caption">Drag me</span>
      </span>
    </div>
  );
}
