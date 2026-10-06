// The chart of the Cartography Table (brief A): a canvas-drawn Ember Chart with one DOM <button data-area> per node
// on top (keyboard, screen readers, the existing browser scenarios), region banners, names and a hover tooltip as DOM
// text on the shared type scale, discrete 1x/2x/3x zoom, drag/arrow-key panning and the discovery cinematic.
// Clicking an area opens its modal (src/ui/atlas/AreaModal.tsx); MapDevice.tsx composes the table.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AtlasAreaId, AtlasProgress } from '../../contracts/atlas';
import { ATLAS_AREAS, findAtlasArea } from '../../data/progression/atlas';
import { ATLAS_POS, CHART_H, CHART_W, PLATE_R, REGIONS, THEMES, regionOf } from '../../art/atlas/geometry';
import { mapBosses } from '../../game/progression/maps';
import { cx } from '../components/common';
import { useStore, useUi } from '../store';
import { ChartAssets, ChartRenderer, type CineItem } from '../atlas/render';
import { nearestInDirection, allNodeModels, fillZoom, type ChartContext, type NodeModel } from '../atlas/model';
export { fillZoom };
import type { SpriteDef } from '../../contracts/art';
import { useAtlasSprites } from '../atlas/sprites';
import { MOTION_LABEL, osPrefersReducedMotion, useMotion } from '../atlas/motion';
import { portalOpen, useActivation, useActivationWatcher } from '../atlas/activation';
import { CURRENCIES } from '../../data/items';
import { KEY_COLOUR } from '../../art/atlas/geometry';
import { PixelIcon } from '../components/common';
import { DEFAULT_LENS, LENSES, formatShare, stockBand, type ChartLens, type SourceEdge, type StockEntry, type TerritoryView } from '../atlas/lens';
import { PinTray } from '../atlas/PinTray';
import { SourcesPanel } from '../atlas/SourcesPanel';
import type { RoutingReadout } from '../../game/progression/map-routing';
import '../styles/atlas.css';

const SEEN_KEY = 'foe.atlas.seen.v1';
const FRESH_KEY = 'foe.atlas.fresh.v1';
const assetCache = new WeakMap<object, Promise<ChartAssets>>();

function loadAssets(sprites: SpriteDef[]): Promise<ChartAssets> {
  let p = assetCache.get(sprites);
  if (!p) { p = ChartAssets.load(sprites); assetCache.set(sprites, p); }
  return p;
}

function readList(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch { return null; }
}
function writeList(key: string, list: Iterable<string>): void {
  try { localStorage.setItem(key, JSON.stringify([...list])); } catch { /* per-viewer convenience only */ }
}

export function prefersReducedMotion(): boolean {
  return osPrefersReducedMotion();
}

/** The discoverer of a new area: a neighbour this viewer has already seen, preferring one that was completed. */
export function discoverer(id: AtlasAreaId, seen: ReadonlySet<string>, completed: ReadonlySet<string>): AtlasAreaId | null {
  const area = findAtlasArea(id);
  if (!area || area.sealed) return null;
  const ns = area.neighbours.filter((n) => seen.has(n));
  return (ns.find((n) => completed.has(n)) ?? ns[0] ?? null) as AtlasAreaId | null;
}

/** What the chart shows for pins and lenses (brief D 3, 5.1): owned by the Device panel, drawn here. */
export interface ChartExtras {
  lens: ChartLens;
  onLens: (lens: ChartLens) => void;
  pins: readonly AtlasAreaId[];
  pinSlots: number;
  pinMultiplier: number;
  /** Why the area cannot be pinned (null = it can). */
  pinBlocked: (id: AtlasAreaId) => string | null;
  onPin: (id: AtlasAreaId, pinned: boolean) => void;
  stock: ReadonlyMap<string, StockEntry>;
  /** The slotted map's drop table (Sources lens); null with an empty slot. */
  sources: RoutingReadout | null;
  edges: readonly SourceEdge[];
  /** Beacons and the sigils that reach each area (Territory lens). */
  territory: TerritoryView;
  /** Pan to an area and inspect it (bumps `n` to repeat the same area). */
  focus: { id: AtlasAreaId; n: number } | null;
  onFocus: (id: AtlasAreaId) => void;
}

export function AtlasChart({ progress, inspected, onInspect, courseId, tier, corrupted, keys, modalOpen, tab, extras }: {
  progress: AtlasProgress;
  inspected: AtlasAreaId;
  onInspect: (id: AtlasAreaId) => void;
  /** Where the slotted map opens (its bound area, or its passage destination); null = no map slotted, the chart is browse-only. */
  courseId: AtlasAreaId | null;
  tier: number | null;
  corrupted: boolean;
  keys: ReadonlySet<string>;
  /** An area modal is open over the chart: the chart is inert behind it. */
  modalOpen: boolean;
  tab: 'chart' | 'codex';
  extras?: ChartExtras;
}) {
  const store = useStore();
  const [zoom, setZoomState] = useState<1 | 2 | 3>(2);
  const [assets, setAssets] = useState<ChartAssets | null>(null);
  const [hovered, setHovered] = useState<AtlasAreaId | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set(readList(FRESH_KEY) ?? []));
  const { calm: reduce, pref: motionPref, cycle: cycleMotion } = useMotion();
  useActivationWatcher(courseId ?? '');
  const activation = useActivation();
  const [keyAnchors, setKeyAnchors] = useState<{ keyId: string; x: number; y: number }[]>([]);
  const keyTray = useRef<HTMLDivElement>(null);
  /** Nodes still under the fog while their discovery plays: no name, no hit box until the plate is forged. */
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const renderer = useRef<ChartRenderer | null>(null);
  const cineDone = useRef(false);
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);
  const discovered = useMemo(() => new Set<string>(progress.discovered), [progress.discovered]);
  const completed = useMemo(() => new Set<string>(progress.completed), [progress.completed]);
  const pinSet = useMemo(() => new Set<string>(extras?.pins ?? []), [extras?.pins]);
  const lens = extras?.lens ?? DEFAULT_LENS;
  const lensInput = useMemo(() => ({ lens, from: extras?.sources?.from ?? null, edges: extras?.edges ?? [], beacons: extras?.territory.beacons ?? [], inspected }),
    [lens, extras?.sources, extras?.edges, extras?.territory, inspected]);
  const beaconOf = useMemo(() => new Map((extras?.territory.beacons ?? []).map((b) => [b.areaId as string, b])), [extras?.territory]);
  const ctx: ChartContext = useMemo(() => ({ discovered, completed, tier, keys, fresh, corrupted, home: courseId, pins: pinSet, ...(extras ? { stock: extras.stock } : {}) }), [discovered, completed, tier, keys, fresh, corrupted, courseId, pinSet, extras?.stock]);
  const models = useMemo(() => allNodeModels(ctx), [ctx]);
  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
  const portal = portalOpen(useUi((st) => (st.hud?.zoneIsOwn ?? true ? st.hud?.portal ?? null : null))) ? (activation.area as AtlasAreaId | null) : null;
  const [size, setSize] = useState({ w: 900, h: 480 });
  const minZoom = fillZoom(size.w, size.h);

  // ---- assets, renderer -----------------------------------------------------------------------------------
  const sprites = useAtlasSprites();
  useEffect(() => {
    if (!sprites) return;
    let live = true;
    loadAssets(sprites).then((a) => { if (live) setAssets(a); });
    return () => { live = false; };
  }, [sprites]);

  useEffect(() => {
    if (!assets || !canvas.current) return;
    const r = new ChartRenderer(canvas.current, assets, {
      onTransform: (ox, oy, z) => {
        const w = world.current;
        if (w) { w.style.transform = `translate(${ox}px, ${oy}px)`; w.dataset.zoom = String(z); }
      },
      onBeat: (beat, id) => {
        if (beat === 'arrive' || beat === 'forge') store.actions.uiSound(beat === 'forge' ? 'open' : 'hover');
        if (beat === 'forge') setPending((prev) => { const n = new Set(prev); n.delete(id); return n; });
      },
      onCinematicDone: (ids) => {
        const seen = new Set(readList(SEEN_KEY) ?? []);
        ids.forEach((id) => seen.add(id));
        writeList(SEEN_KEY, seen);
        setPending(new Set());
      },
    });
    renderer.current = r;
    const el = viewport.current!;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(64, Math.floor(rect.width)), h = Math.max(64, Math.floor(rect.height));
      r.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
      setSize({ w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const z0 = Math.max(2, fillZoom(r.viewport.w, r.viewport.h)) as 1 | 2 | 3;
    r.setZoom(z0, undefined, true);
    setZoomState(z0);
    const start = findAtlasArea(inspected) ?? findAtlasArea('cinderCrossing')!;
    r.panTo(ATLAS_POS[start.id].x, ATLAS_POS[start.id].y, true);
    r.start();
    return () => { r.stop(); ro.disconnect(); renderer.current = null; };
  }, [assets]);

  // the chart stops drawing while the Codex is showing
  useEffect(() => {
    const r = renderer.current;
    if (!r) return;
    if (tab === 'chart') r.start(); else r.stop();
  }, [assets, tab]);

  // ---- feed the renderer ----------------------------------------------------------------------------------
  useEffect(() => {
    const r = renderer.current;
    if (!r) return;
    r.setInput({ ctx, selected: inspected, hovered, course: courseId, reduceMotion: reduce, portal, keyAnchors, lens: lensInput });
  }, [assets, ctx, inspected, hovered, courseId, reduce, portal, keyAnchors, lensInput]);

  // a focus request from the pin tray, the Sources rows or "Show home": inspect the area and bring it to the middle
  const lastFocus = useRef<number>(extras?.focus?.n ?? 0);
  useEffect(() => {
    const f = extras?.focus;
    if (!f || f.n === lastFocus.current) return;
    lastFocus.current = f.n;
    renderer.current?.panTo(ATLAS_POS[f.id].x, ATLAS_POS[f.id].y);
  }, [extras?.focus?.n, assets]);

  // slotting a map: the chart eases to the area it lives in
  useEffect(() => {
    if (courseId && renderer.current) renderer.current.panTo(ATLAS_POS[courseId].x, ATLAS_POS[courseId].y);
  }, [courseId, assets]);

  // activation: the course node flares when the device lights (a new portal opens)
  const lastPulse = useRef(activation.pulse);
  useEffect(() => {
    if (activation.pulse === lastPulse.current) return;
    lastPulse.current = activation.pulse;
    if (activation.area) renderer.current?.flare(activation.area as AtlasAreaId);
  }, [activation.pulse]);

  // keys you carry that open a door on the chart: a tray of chips, each with a dashed thread to its door
  const heldKeys = useMemo(() => {
    const out = new Map<string, { keyId: string; door: string }>();
    for (const m of models) if (m.known && m.kind === 'sealedKeyed' && m.keyId && !out.has(m.keyId)) out.set(m.keyId, { keyId: m.keyId, door: m.area.name });
    return [...out.values()];
  }, [models]);
  useLayoutEffect(() => {
    const tray = keyTray.current, vp = viewport.current;
    if (!tray || !vp) { setKeyAnchors((prev) => (prev.length ? [] : prev)); return; }
    const vr = vp.getBoundingClientRect();
    const next = [...tray.querySelectorAll<HTMLElement>('[data-key]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { keyId: el.dataset.key!, x: Math.round(r.right - vr.left), y: Math.round(r.top - vr.top + r.height / 2) };
    });
    setKeyAnchors((prev) => (prev.length === next.length && prev.every((p, i) => p.keyId === next[i].keyId && p.x === next[i].x && p.y === next[i].y) ? prev : next));
  }, [heldKeys, size, extras?.pins.length, extras?.pinSlots]);

  // ---- the discovery cinematic: once per viewer, skippable ------------------------------------------------
  useEffect(() => {
    const r = renderer.current;
    if (!r || !assets) return;
    const stored = readList(SEEN_KEY);
    if (stored === null) { writeList(SEEN_KEY, progress.discovered); return; }
    const seen = new Set(stored);
    const newIds = progress.discovered.filter((id) => !seen.has(id)) as AtlasAreaId[];
    if (!newIds.length || r.cinematic) return;
    const known = new Set([...seen].filter((id) => discovered.has(id)));
    const items: CineItem[] = newIds
      .sort((a, b) => findAtlasArea(a)!.depth - findAtlasArea(b)!.depth)
      .map((id, i) => ({ id, from: discoverer(id, known, completed), start: i * 0.7 }));
    setFresh((prev) => { const n = new Set(prev); newIds.forEach((id) => n.add(id)); writeList(FRESH_KEY, n); return n; });
    r.setInput({ ctx, selected: inspected, hovered, course: courseId, reduceMotion: reduce, portal, keyAnchors, lens: lensInput });
    setPending(new Set(newIds));
    r.startCinematic(items, reduce);
    cineDone.current = true;
  }, [assets, progress.discovered]);

  // ---- selection, focus and zoom --------------------------------------------------------------------------
  const select = useCallback((id: AtlasAreaId, pan = true) => {
    store.actions.uiSound('click');
    onInspect(id);
    setFresh((prev) => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); writeList(FRESH_KEY, n); return n; });
    if (pan) renderer.current?.panTo(ATLAS_POS[id].x, ATLAS_POS[id].y);
  }, [store, onInspect]);

  // the chart never zooms out below the level that fills the view
  useEffect(() => {
    const r = renderer.current;
    if (!r || r.zoom >= minZoom) return;
    r.setZoom(minZoom, r.center, true);
    setZoomState(minZoom);
  }, [minZoom, assets]);

  const setZoom = useCallback((z0: 1 | 2 | 3, anchor?: { x: number; y: number }) => {
    const z = Math.max(minZoom, z0) as 1 | 2 | 3;
    const r = renderer.current;
    if (!r || z === r.zoom) return;
    store.actions.uiSound('hover');
    r.setZoom(z, anchor ?? r.center);
    setZoomState(z);
  }, [store, minZoom]);

  const fit = useCallback(() => {
    const r = renderer.current;
    if (!r) return;
    const pts = ATLAS_AREAS.filter((a) => discovered.has(a.id)).map((a) => ATLAS_POS[a.id]);
    if (!pts.length) return;
    const x0 = Math.min(...pts.map((p) => p.x)) - 50, x1 = Math.max(...pts.map((p) => p.x)) + 50;
    const y0 = Math.min(...pts.map((p) => p.y)) - 50, y1 = Math.max(...pts.map((p) => p.y)) + 50;
    const { w, h } = r.viewport;
    const z = ([3, 2, 1] as const).find((zz) => zz >= minZoom && (x1 - x0) * zz <= w && (y1 - y0) * zz <= h) ?? minZoom;
    r.setZoom(z, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
    r.panTo((x0 + x1) / 2, (y0 + y1) / 2);
    setZoomState(z);
  }, [discovered, minZoom]);

  const goto = useCallback((x: number, y: number) => renderer.current?.panTo(x, y), []);

  const onKey = (e: KeyboardEvent): void => {
    if (tab !== 'chart') return;
    const r = renderer.current;
    const target = e.target as HTMLElement;
    const inNode = target.closest?.('[data-area]') as HTMLElement | null;
    const step = 48 / (r?.zoom ?? 2);
    const dirs: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (dirs[e.key]) {
      e.preventDefault(); e.stopPropagation();
      if (inNode) {
        const next = nearestInDirection(inNode.dataset.area as AtlasAreaId, dirs[e.key], discovered);
        if (next) { (viewport.current?.querySelector(`[data-area="${next}"]`) as HTMLElement | null)?.focus({ preventScroll: true }); r?.panTo(ATLAS_POS[next].x, ATLAS_POS[next].y); }
      } else if (r) {
        r.panByScreen(e.key === 'ArrowLeft' ? step * r.zoom : e.key === 'ArrowRight' ? -step * r.zoom : 0, e.key === 'ArrowUp' ? step * r.zoom : e.key === 'ArrowDown' ? -step * r.zoom : 0);
      }
      return;
    }
    // The game keeps keyboard focus off controls and swallows Enter and Space, so the chart claims them for nodes
    if (inNode && !inNode.hasAttribute('disabled') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); e.stopPropagation();
      const id = inNode.dataset.area as AtlasAreaId;
      select(id, false);
      return;
    }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); e.stopPropagation(); setZoom(Math.min(3, (r?.zoom ?? 2) + 1) as 1 | 2 | 3); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); e.stopPropagation(); setZoom(Math.max(minZoom, (r?.zoom ?? 2) - 1) as 1 | 2 | 3); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); e.stopPropagation(); fit(); }
    else if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); goto(ATLAS_POS.cinderCrossing.x, ATLAS_POS.cinderCrossing.y); }
    else if (e.key === 'g' || e.key === 'G') {
      e.preventDefault(); e.stopPropagation();
      // G: go to where the slotted map opens
      const hit = courseId ? byId.get(courseId) : null;
      if (hit) { goto(hit.x, hit.y); }
    }
  };

  // ---- pointer: drag to pan, wheel to zoom, any press skips the cinematic ----------------------------------
  const onPointerDown = (e: PointerEvent): void => {
    const r = renderer.current;
    if (r?.cinematic) { r.skipCinematic(); return; }
    if ((e.target as HTMLElement).closest('button, .fe-chart__controls, .fe-chart__ruler')) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    r?.setDragging(true);
  };
  const onPointerMove = (e: PointerEvent): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    d.x = e.clientX; d.y = e.clientY;
    renderer.current?.panByScreen(dx, dy);
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (drag.current?.id === e.pointerId) drag.current = null;
    renderer.current?.setDragging(false);
  };
  const wheelAt = useRef(0);
  const onWheel = (e: WheelEvent): void => {
    const r = renderer.current;
    if (!r || tab !== 'chart') return;
    e.preventDefault();
    const now = performance.now();
    if (now - wheelAt.current < 160) return;
    wheelAt.current = now;
    const next = Math.max(minZoom, Math.min(3, r.zoom + (e.deltaY < 0 ? 1 : -1))) as 1 | 2 | 3;
    if (next === r.zoom) return;
    const rect = viewport.current!.getBoundingClientRect();
    const c = r.center;
    const ax = c.x + (e.clientX - rect.left - rect.width / 2) / r.zoom;
    const ay = c.y + (e.clientY - rect.top - rect.height / 2) / r.zoom;
    // keep the point under the cursor fixed
    setZoom(next, { x: ax - (e.clientX - rect.left - rect.width / 2) / next, y: ay - (e.clientY - rect.top - rect.height / 2) / next });
  };
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // ---- tooltip --------------------------------------------------------------------------------------------
  const tip = hovered ? byId.get(hovered) : null;
  const tipPos = useMemo(() => {
    const r = renderer.current;
    if (!tip || !r) return null;
    const p = r.artToScreen(tip.x, tip.y);
    const w = 248, h = 136;
    const rightSide = p.x + (PLATE_R + 8) * zoom + w < size.w;
    const x = rightSide ? p.x + (PLATE_R + 8) * zoom : p.x - (PLATE_R + 8) * zoom - w;
    return { x: Math.max(6, Math.min(size.w - w - 6, x)), y: Math.max(6, Math.min(size.h - h - 6, p.y - 40)) };
  }, [tip, zoom, size, assets]);

  const bannersOn = REGIONS.map((reg) => ({ reg, seen: ATLAS_AREAS.some((a) => discovered.has(a.id) && regionOf(a) === reg.id) }));
  const ceilings = useMemo(() => {
    const counts = new Array<number>(16).fill(0);
    for (const m of models) if (m.known && !m.area.sealed) counts[m.ceiling]++;
    return counts;
  }, [models]);
  const sourceShare = useMemo(() => new Map((extras?.edges ?? []).map((e) => [e.to as string, { label: e.pending ? 'next' : formatShare(e.share), pinned: e.pinned, pending: e.pending }])), [extras?.edges]);
  // DOM order is graph order (depth, then chart y), so Tab walks the chart the way the roads run
  const ordered = useMemo(() => [...models].sort((a, b) => a.area.depth - b.area.depth || a.y - b.y), [models]);
  const ariaFor = (m: NodeModel): string => (m.known ? `${m.area.name}, ${m.area.sealed ? 'Sealed area' : m.area.type === 'vault' ? 'Dead end' : ({ frontier: 'Frontier', forge: 'Forge', crypt: 'Crypt', arena: 'Arena', reliquary: 'Sealed area' } as const)[m.area.type]}, up to Tier ${m.ceiling}. ${m.status}` : 'Unexplored area');

  return (
    <div class={'fe-chartwrap'} hidden={tab !== 'chart'}>
      <div class="fe-chart" ref={viewport} role="application" aria-label="Atlas chart. Arrow keys pan, plus and minus zoom, F fits the charted area. Enter on an area opens it." tabIndex={-1} inert={modalOpen ? true : undefined}
        onKeyDown={onKey as never} onScroll={(e) => { const el = e.currentTarget as HTMLElement; if (el.scrollLeft || el.scrollTop) el.scrollTo(0, 0); }} onPointerDown={onPointerDown as never} onPointerMove={onPointerMove as never} onPointerUp={onPointerUp as never} onPointerCancel={onPointerUp as never}>
        <canvas class="fe-chart__canvas" ref={canvas} aria-hidden="true" />
        {!assets && <div class="fe-chart__loading ui-type-secondary" role="status">Unrolling the chart…</div>}
        <div class="fe-chart__world" ref={world} style={{ width: CHART_W * zoom, height: CHART_H * zoom }} data-zoom={zoom}>
          {bannersOn.map(({ reg, seen }) => (
            <div key={reg.id} class={cx('fe-chart__banner', `fe-chart__banner--z${zoom}`, !seen && 'fe-chart__banner--unknown')} style={{ left: reg.banner.x * zoom, top: reg.banner.y * zoom }} aria-hidden={!seen}>
              {seen ? <span class="fe-chart__banner-text">{reg.name}</span> : <span class="fe-chart__stamp ui-type-body" aria-hidden="true">?</span>}
            </div>
          ))}
          {ordered.map((m) => {
            const sealed = !!m.area.sealed;
            const w = (sealed ? 44 : 46) * zoom, h = (sealed ? 54 : 46) * zoom;
            const hiding = pending.has(m.id);
            const showName = m.known && !hiding && (zoom >= 2 || hovered === m.id || inspected === m.id);
            return (
              <div key={m.id} class="fe-chart__slot" style={{ left: m.x * zoom, top: m.y * zoom }}>
                <button type="button" disabled={!m.known || hiding} aria-pressed={m.known && inspected === m.id} data-area={m.id}
                  aria-label={ariaFor(m)} tabIndex={m.known ? 0 : -1}
                  class={cx('fe-atlas__node', m.known && 'fe-atlas__node--known', m.completed && 'fe-atlas__node--complete', inspected === m.id && 'fe-atlas__node--selected', m.kind.startsWith('sealed') && 'fe-atlas__node--sealed', m.tooShallow && 'fe-atlas__node--shallow')}
                  style={{ width: w, height: h, marginTop: sealed ? -2 * zoom : 0 }}
                  onClick={() => select(m.id)}
                  onDblClick={() => select(m.id, false)}
                  onPointerEnter={() => { if (m.known) { setHovered(m.id); store.actions.uiSound('hover'); } }}
                  onPointerLeave={() => setHovered((h0) => (h0 === m.id ? null : h0))}
                  onFocus={() => { if (m.known) { setHovered(m.id); renderer.current?.panTo(m.x, m.y); } }}
                  onBlur={() => setHovered((h0) => (h0 === m.id ? null : h0))} />
                {extras && lens === 'stock' && m.known && !hiding && m.stock && (
                  <span class={cx('fe-chart__badge ui-type-caption', `fe-chart__badge--${stockBand(m.stock.highest)}`)} style={{ left: -20 * zoom, top: -17 * zoom }} data-stock={m.id}
                    title={`${m.stock.count} map${m.stock.count === 1 ? '' : 's'} of ${m.area.name}: Tier ${m.stock.lowest === m.stock.highest ? m.stock.lowest : `${m.stock.lowest} to ${m.stock.highest}`}`}>{m.stock.count}</span>
                )}
                {extras && lens === 'sources' && m.known && !hiding && sourceShare.get(m.id) && (
                  <span class={cx('fe-chart__share ui-type-caption', sourceShare.get(m.id)!.pinned && 'fe-chart__share--pinned', sourceShare.get(m.id)!.pending && 'fe-chart__share--pending')} style={{ left: 0, top: -(30 * zoom) }} data-share={m.id}>{sourceShare.get(m.id)!.label}</span>
                )}
                {extras && lens === 'territory' && m.known && !hiding && (beaconOf.get(m.id) || extras.territory.coveredBy.get(m.id)) && (
                  <span class={cx('fe-chart__share ui-type-caption', beaconOf.get(m.id) && 'fe-chart__share--pinned')} style={{ left: 0, top: -(34 * zoom) }} data-territory={m.id}
                    title={[
                      beaconOf.get(m.id) ? `Beacon: ${beaconOf.get(m.id)!.slots.filter(Boolean).length} of ${beaconOf.get(m.id)!.slots.length} sigil slots filled, reaches ${beaconOf.get(m.id)!.coverage.length - 1} area${beaconOf.get(m.id)!.coverage.length === 2 ? '' : 's'}` : null,
                      ...(extras.territory.coveredBy.get(m.id) ?? []).map((c) => `${c.name} (${findAtlasArea(c.beacon)?.name ?? ''})`),
                    ].filter(Boolean).join('\n')}>
                    {beaconOf.get(m.id) ? `${beaconOf.get(m.id)!.slots.filter(Boolean).length}/${beaconOf.get(m.id)!.slots.length}` : `${extras.territory.coveredBy.get(m.id)!.length} sigil${extras.territory.coveredBy.get(m.id)!.length === 1 ? '' : 's'}`}
                  </span>
                )}
                {extras && m.known && !hiding && !m.area.sealed && inspected === m.id && (
                  <button type="button" class="fe-chart__pinbtn" style={{ left: 20 * zoom, top: -(20 * zoom) }} aria-pressed={m.pinned} data-pin-node={m.id}
                    disabled={!m.pinned && !!extras.pinBlocked(m.id)}
                    aria-label={m.pinned ? `Unpin ${m.area.name}` : `Pin ${m.area.name}`}
                    title={m.pinned ? `Unpin ${m.area.name}` : extras.pinBlocked(m.id) ?? `Pin ${m.area.name}: its maps drop x${extras.pinMultiplier} as often`}
                    onClick={(e) => { e.stopPropagation(); extras.onPin(m.id, !m.pinned); }}
                    onPointerDown={(e) => e.stopPropagation()}><i class="fe-pinglyph" aria-hidden="true" /></button>
                )}
                {showName && (
                  <span class={cx('fe-chart__label ui-type-secondary', m.completed && 'fe-chart__label--done', inspected === m.id && 'fe-chart__label--sel')} style={{ top: (sealed ? 34 : 34) * zoom }}>
                    {m.area.name}
                    {zoom >= 2 && <small class="ui-type-caption"> T{m.ceiling}</small>}
                    {m.isNew && <em class="ui-type-caption fe-chart__new"> New</em>}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div class="fe-chart__vignette" aria-hidden="true" />
        {extras && (
          <div class="fe-chart__bar" onPointerDown={(e) => e.stopPropagation()}>
            <div class="fe-lens" role="group" aria-label="Chart lens">
              <span class="fe-lens__label ui-type-caption">Lens</span>
              {LENSES.filter((l) => l.available).map((l) => (
                <button key={l.id} type="button" class="fe-lens__btn ui-type-caption" aria-pressed={lens === l.id} title={l.hint} data-lens={l.id}
                  onClick={() => { store.actions.uiSound('click'); extras.onLens(l.id); }}>{l.label}</button>
              ))}
            </div>
            <PinTray pins={extras.pins} slots={extras.pinSlots} multiplier={extras.pinMultiplier} onFocus={extras.onFocus} onUnpin={(id) => extras.onPin(id, false)} />
            {heldKeys.length > 0 && (
              <div class="fe-chart__keys" ref={keyTray} role="group" aria-label="Keys in hand">
                {heldKeys.map((k) => (
                  <span key={k.keyId} class="fe-chart__key ui-type-caption" data-key={k.keyId} style={{ '--key': KEY_COLOUR[k.keyId] ?? '#c07bff' }} title={`${CURRENCIES[k.keyId as keyof typeof CURRENCIES]?.name ?? 'Key'} opens ${k.door}`}>
                    <PixelIcon id={`icon/currency/${k.keyId}`} width={22} height={22} />
                    <span>{k.door}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {extras && lens === 'sources' && (
          <div class="fe-chart__sources" onPointerDown={(e) => e.stopPropagation()}>
            <SourcesPanel readout={extras.sources} onFocus={extras.onFocus} limit={3} />
          </div>
        )}
        {tip && tipPos && (
          <div class="fe-chart__tip" style={{ left: tipPos.x, top: tipPos.y }} role="tooltip">
            <strong class="fe-chart__tip-name ui-type-body">{tip.area.name}</strong>
            <span class="ui-type-caption fe-chart__tip-meta">{tip.area.sealed ? 'Sealed' : ({ frontier: 'Frontier', forge: 'Forge', crypt: 'Crypt', arena: 'Arena', vault: 'Dead end', reliquary: 'Sealed' } as const)[tip.area.type]} · {THEMES[tip.area.baseId].label} · T1–T{tip.ceiling}</span>
            <span class="ui-type-secondary">{tip.area.noBoss ? 'No final boss' : `Boss: ${tipBoss(tip)}`}</span>
            <span class={cx('ui-type-caption fe-chart__tip-status', tip.tooShallow && 'fe-chart__tip-status--bad')}>{tip.status}</span>
            <span class="ui-type-caption fe-chart__tip-meta fe-chart__tip-open">Click to open</span>
            {(tip.pinned || tip.stock) && <span class="ui-type-caption fe-chart__tip-meta">{tip.pinned ? `Pinned: x${extras?.pinMultiplier ?? 3} map drops` : ''}{tip.pinned && tip.stock ? ' · ' : ''}{tip.stock ? `You hold ${tip.stock.count} map${tip.stock.count === 1 ? '' : 's'}` : ''}</span>}
          </div>
        )}
        <div class="fe-chart__controls" role="group" aria-label="Zoom">
          <button class="fe-chart__btn ui-type-body" aria-label="Zoom out" disabled={zoom <= minZoom} onClick={() => setZoom(Math.max(minZoom, zoom - 1) as 1 | 2 | 3)}>−</button>
          <span class="fe-chart__zoomread ui-type-caption" aria-live="polite">{zoom}×</span>
          <button class="fe-chart__btn ui-type-body" aria-label="Zoom in" disabled={zoom === 3} onClick={() => setZoom(Math.min(3, zoom + 1) as 1 | 2 | 3)}>+</button>
          <button class="fe-chart__btn fe-chart__btn--fit ui-type-caption" title="Fit the charted area (F)" onClick={fit}>Fit</button>
          <button class={cx('fe-chart__btn fe-chart__btn--fit ui-type-caption', reduce && 'fe-chart__btn--on')} aria-label={MOTION_LABEL[motionPref]} title={`${MOTION_LABEL[motionPref]}. Calm turns off animation; System follows your device setting.`} onClick={cycleMotion}>{motionPref === 'auto' ? 'Motion: auto' : motionPref === 'calm' ? 'Motion: calm' : 'Motion: full'}</button>
        </div>
        <div class="fe-chart__ruler ui-type-caption" role="img" aria-label={`Tier ruler: ${tier ? `your map is Tier ${tier}` : 'no map slotted'}`}>
          <span class="fe-chart__ruler-label">Tier</span>
          {Array.from({ length: 15 }, (_, i) => i + 1).map((t) => (
            <span key={t} class={cx('fe-chart__tick', tier === t && 'fe-chart__tick--map', ceilings[t] > 0 && 'fe-chart__tick--ceiling')} title={ceilings[t] ? `${ceilings[t]} charted area${ceilings[t] > 1 ? 's' : ''} up to T${t}` : undefined}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function tipBoss(m: NodeModel): string {
  return mapBosses(m.area.baseId).boss.name;
}
