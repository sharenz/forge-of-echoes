// The guide's layer over the world (docs/onboarding-ux.md 6.3): a pulsing ring on the floor plus a bouncing chevron above the object the
// current step wants (Map Device, portal, chest, return portal), an edge arrow with its name when that object is off screen, and name plates
// on the hideout props of a new player. Positions come from the client's per-frame projection (store.world) and are written to the DOM
// directly from one requestAnimationFrame loop, so markers glide with the camera without re-rendering React. Everything is aria-hidden: the
// tracker carries the text equivalent. Reduced motion (the motion setting or the OS) keeps the ring and the chevron static.
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { PropKind } from '../../contracts/sim';
import { gt } from '../../data/guide/strings';
import { cx } from '../components/common';
import { useMotion } from '../atlas/motion';
import { useLocal } from '../local';
import { useSignal, useStore, useUi } from '../store';
import { useGuideView } from './hooks';
import { inside, edgePoint, pickAnchor, platePosition, plateKinds, visibleRect, MARKER_PROP, type MarkerKind } from './geometry';

/** A marker for an unhurried step appears after this long without progress (ms). */
export const STALL_MS = 20_000;
/** A "What next" marker stays this long (ms). */
export const OVERRIDE_MS = 12_000;

const PLATE_NAME: Partial<Record<PropKind, string>> = {
  mapDevice: 'world.mapDevice', stash: 'world.stash', anvil: 'world.anvil', merchant: 'world.merchant', portal: 'world.portal',
  returnPortal: 'world.returnPortal', chest: 'world.chest',
};

export function WorldGuide() {
  const store = useStore();
  const local = useLocal();
  const { view, snap } = useGuideView();
  const live = useSignal(local.guide);
  const { calm } = useMotion();
  const guide = useUi((s) => s.character?.guide);
  const root = useRef<HTMLDivElement>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  const viewRef = useRef(view);
  viewRef.current = view;

  const active = view.visible;
  const cleared = snap.run?.phase === 'cleared';
  const override = live.override && performance.now() - live.override.at < OVERRIDE_MS ? live.override.kind : null;
  const marker: MarkerKind | null = override ?? view.target;
  const plates = useMemo(
    () => plateKinds({ active, zone: snap.zone, ownHideout: snap.ownHideout, used: guide?.used ?? [], cleared: !!cleared, chest: snap.run?.chest ?? null, marker }),
    [active, snap.zone, snap.ownHideout, guide?.used, cleared, snap.run?.chest, marker],
  );

  useEffect(() => {
    const el = root.current;
    const world = store.world;
    if (!el || !world || (plates.length === 0 && !marker)) return;
    let raf = 0;
    let deckTop = 0;
    let lastDeck = 0;
    const q = <T extends HTMLElement>(sel: string): T | null => el.querySelector<T>(sel);
    const ring = q('[data-ring]');
    const chev = q('[data-chev]');
    const edge = q('[data-edge]');
    const edgeName = q('[data-edge-name]');
    const edgeArrow = q('[data-edge-arrow]');
    const plateEls = new Map<string, HTMLElement>();
    el.querySelectorAll<HTMLElement>('[data-plate]').forEach((p) => plateEls.set(p.dataset.plate!, p));
    const hideAll = (): void => {
      for (const p of plateEls.values()) p.style.display = 'none';
      for (const x of [ring, chev, edge]) if (x) x.style.display = 'none';
    };
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const anchors = world.anchors();
      const { width, height } = world.viewport();
      const now = performance.now();
      if (now - lastDeck > 500) {
        lastDeck = now;
        deckTop = document.querySelector('.fe-deck')?.getBoundingClientRect().top ?? height - 130;
      }
      if (!anchors.length) { hideAll(); return; }
      const rect = visibleRect(width, height, Math.max(0, height - deckTop) + 8);
      const current = viewRef.current;
      const l = liveRef.current;
      // 1. name plates (the marked object's plate goes under it: its top belongs to the chevron)
      const l0 = liveRef.current;
      const v0 = viewRef.current;
      const ov0 = l0.override && now - l0.override.at < OVERRIDE_MS ? l0.override.kind : null;
      const t0 = ov0 ?? ((v0.target && (v0.urgent || now - l0.stepAt > STALL_MS)) ? v0.target : null);
      const markedProp = t0 ? MARKER_PROP[t0] : null;
      for (const [kind, p] of plateEls) {
        const a = anchors.find((x) => x.kind === kind);
        if (!a) { p.style.display = 'none'; continue; }
        const pos = platePosition(a, width, p.offsetWidth || 120, p.offsetHeight || 24, 24, 8, kind === markedProp);
        const clipped = pos.y > rect.bottom;
        p.style.display = clipped ? 'none' : '';
        p.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px) translateX(-50%)`;
      }
      // 2. the marker: immediate for urgent steps, after a stall for the rest, or a What-next request
      const ov = l.override && now - l.override.at < OVERRIDE_MS ? l.override.kind : null;
      const target: MarkerKind | null = ov ?? ((current.target && (current.urgent || now - l.stepAt > STALL_MS)) ? current.target : null);
      const a = target ? pickAnchor(anchors, target) : null;
      if (!target || !a) {
        for (const x of [ring, chev, edge]) if (x) x.style.display = 'none';
        return;
      }
      const tipY = a.y - a.height;
      const onScreen = inside(rect, a.x, tipY) || inside(rect, a.x, a.y);
      if (onScreen) {
        if (edge) edge.style.display = 'none';
        if (ring) {
          const w = Math.max(40, a.radius * 2.8);
          ring.style.display = '';
          ring.style.width = `${w}px`;
          ring.style.height = `${w * 0.46}px`;
          ring.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px) translate(-50%, -50%)`;
        }
        if (chev) {
          chev.style.display = '';
          chev.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(Math.max(6, tipY - 38))}px) translateX(-50%)`;
        }
      } else {
        for (const x of [ring, chev]) if (x) x.style.display = 'none';
        if (edge) {
          const e = edgePoint(rect, a.x, tipY);
          edge.style.display = '';
          edge.style.transform = `translate(${Math.round(e.x)}px, ${Math.round(e.y)}px)`;
          edge.dataset.side = Math.abs(Math.cos(e.angle)) > Math.abs(Math.sin(e.angle)) ? (Math.cos(e.angle) > 0 ? 'right' : 'left') : (Math.sin(e.angle) > 0 ? 'down' : 'up');
          if (edgeArrow) edgeArrow.style.transform = `rotate(${(e.angle * 180) / Math.PI}deg)`;
          if (edgeName) edgeName.textContent = gt(PLATE_NAME[MARKER_PROP[target]] ?? 'world.portal');
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      hideAll();
    };
  }, [store, plates.join(','), marker, view.urgent]);

  if (!store.world) return null;
  return (
    <div ref={root} class={cx('fe-gw', calm && 'fe-gw--calm')} aria-hidden="true" data-guide-world data-marker={marker ?? ''}>
      <div class="fe-gw__ring" data-ring style={{ display: 'none' }} />
      <div class="fe-gw__chev" data-chev style={{ display: 'none' }}><i /></div>
      <div class="fe-gw__edge" data-edge style={{ display: 'none' }}>
        <span class="fe-gw__edgearrow" data-edge-arrow />
        <span class="fe-gw__edgename ui-type-caption" data-edge-name />
      </div>
      {plates.map((kind) => (
        <div key={kind} class="fe-gw__plate ui-type-caption" data-plate={kind} style={{ display: 'none' }}>{gt(PLATE_NAME[kind] ?? 'world.portal')}</div>
      ))}
    </div>
  );
}
