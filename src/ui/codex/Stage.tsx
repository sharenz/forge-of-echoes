// The generic tree stage: the canvas (render.ts), one DOM <button> per node on top for pointer, keyboard and screen
// readers, node names on the shared type scale, drag to pan, wheel and keys to zoom, arrow keys between nodes. Any
// tree view (view.ts) mounts through it; the Atlas Codex (Codex.tsx) adds its HUD, tooltip, banners and rail around it.
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { PLATE_SIZE } from '../../art/codex/tones';
import { drawFrameSurface, frameToSurface, newCanvas, ctx2d } from '../../art/atlas/canvas';
import { cx } from '../components/common';
import { ZOOMS, type TreeEvents, type TreeInput, type TreeRenderer, type TreeZoom } from './render';
import type { TreeModel, TreeNode, TreeNodeData, TreeState } from './tree';
import type { TreeView } from './view';

/** A plate drawn crisply at a whole scale (tooltips and rails). */
export function TreePlateArt<N extends TreeNodeData, T extends string>({ view, node, state, scale }: { view: TreeView<N, T>; node: TreeNode<N, T>; state: TreeState; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const side = PLATE_SIZE[node.cls];
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const surf = frameToSurface(view.plate(node, node.id === view.model.originId ? 'on' : state));
    el.width = side * scale; el.height = side * scale;
    const c = el.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, el.width, el.height);
    const tmp = newCanvas(side, side);
    drawFrameSurface(ctx2d(tmp), surf, 0, 0, 0.9);
    c.drawImage(tmp, 0, 0, el.width, el.height);
  }, [view, node.id, state, scale]);
  return <canvas ref={ref} class="fe-cx__plate" width={side * scale} height={side * scale} style={{ width: side * scale, height: side * scale }} aria-hidden="true" />;
}

/** Names show from this zoom up: keystones at 1x, the other named plates at 2x, every node at 3x. */
const NAME_LABEL: Record<string, number> = { keystone: 1, notable: 2, lens: 2, seal: 2, tier: 2, small: 3 };
const PRIORITY: Record<string, number> = { keystone: 0, notable: 1, lens: 1, seal: 1, tier: 1, small: 2 };

/**
 * Which names to print at this zoom: greedily, most important first (picked, hovered, allocated, then by class), skipping
 * any whose box would overlap one already placed, so dense clusters such as a row of keystones never pile up.
 */
export function planTreeLabels<N extends TreeNodeData, T extends string>(model: TreeModel<N, T>, zoom: number, focus: readonly (string | null)[], allocated: ReadonlySet<string>, hidden: (id: string) => boolean): Set<string> {
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const out = new Set<string>();
  const rank = (n: TreeNode<N, T>): number => (focus.includes(n.id) ? -2 : allocated.has(n.id) ? PRIORITY[n.cls] - 1 : PRIORITY[n.cls]);
  const order = [...model.nodes].filter((n) => n.id !== model.originId).sort((a, b) => rank(a) - rank(b));
  for (const n of order) {
    const forced = focus.includes(n.id);
    if (!forced && (hidden(n.id) || zoom < NAME_LABEL[n.cls])) continue;
    const w = Math.min(132, n.node.name.length * 7.6 + 6), h = n.node.name.length * 7.6 > 132 ? 34 : 18;
    const box = { x0: n.x * zoom - w / 2, y0: (n.y + n.r + 3) * zoom, x1: n.x * zoom + w / 2, y1: (n.y + n.r + 3) * zoom + h };
    if (!forced && placed.some((q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0)) continue;
    placed.push(box);
    out.add(n.id);
  }
  return out;
}

export interface TreeStageOptions<N extends TreeNodeData, T extends string> {
  view: TreeView<N, T>;
  /** What the renderer draws this frame (allocation, selection, hover, search, path preview, motion). */
  input: TreeInput;
  onBeat?: TreeEvents<N, T>['onBeat'];
  /** A zoom step through the controls, keys or wheel (the Codex plays its hover tick). */
  onZoomStep?(): void;
  /** Where "show the whole tree" centres (default: the board centre). */
  overviewAt?: { x: number; y: number };
  /** Pointer downs inside these elements never start a pan (HUD, controls, rail). */
  noDrag?: string;
}

/** Camera and renderer state of one mounted tree stage, shared by the stage and the overlays around it. */
export interface TreeStageApi<N extends TreeNodeData, T extends string> {
  view: TreeView<N, T>;
  stage: { current: HTMLDivElement | null };
  canvas: { current: HTMLCanvasElement | null };
  world: { current: HTMLDivElement | null };
  renderer: { current: TreeRenderer<N, T> | null };
  zoom: TreeZoom;
  size: { w: number; h: number };
  /** True while (and right after) a drag pans the view: the click that ends a drag must not select. */
  dragMoved(): boolean;
  /** Zoom with the step cue, about an anchor in world px (default: the view centre). */
  setZoom(z: TreeZoom, anchor?: { x: number; y: number }): void;
  stepZoom(dir: 1 | -1, anchor?: { x: number; y: number }): void;
  /** Zoom without the cue (jumps, search hits). */
  zoomTo(z: TreeZoom, focus: { x: number; y: number }): void;
  panTo(x: number, y: number): void;
  /** The whole tree at the smallest zoom. */
  overview(): void;
  /** Back to 1x on the board centre. */
  home(): void;
  onPointerDown(e: PointerEvent): void;
  /** Pointer-hover state the stage drives (enter, leave, drag start). */
  setHovered(fn: string | null | ((h: string | null) => string | null)): void;
}

export function useTreeStage<N extends TreeNodeData, T extends string>(opts: TreeStageOptions<N, T> & { setHovered: TreeStageApi<N, T>['setHovered'] }): TreeStageApi<N, T> {
  const { view, input } = opts;
  const { cx: CX, cy: CY } = view.board;
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const renderer = useRef<TreeRenderer<N, T> | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const wheelAt = useRef(0);
  const [zoom, setZoomState] = useState<TreeZoom>(1);
  const [size, setSize] = useState({ w: 640, h: 480 });
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (!canvas.current || !stage.current) return;
    const r = view.createRenderer(canvas.current, {
      onTransform: (ox, oy, z) => {
        const w = world.current;
        if (w) { w.style.transform = `translate(${ox}px, ${oy}px)`; w.dataset.zoom = String(z); }
      },
      onBeat: (beat, n) => latest.current.onBeat?.(beat, n),
    });
    renderer.current = r;
    const el = stage.current;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(64, Math.floor(rect.width)), h = Math.max(64, Math.floor(rect.height));
      r.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
      setSize({ w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const first = latest.current.input;
    r.setInput({ ...first, hovered: null, matches: new Set(), searching: false, preview: null, previewOk: false }, true);
    r.panTo(CX, CY, true);
    r.start();
    return () => { r.stop(); ro.disconnect(); renderer.current = null; };
  }, []);

  const { allocated, selected, hovered, matches, searching, preview, previewOk, reduceMotion } = input;
  useEffect(() => {
    renderer.current?.setInput({ allocated, selected, hovered, matches, searching, preview, previewOk, reduceMotion });
  }, [allocated, selected, hovered, matches, searching, preview, previewOk, reduceMotion]);

  const setZoom = useCallback((z: TreeZoom, anchor?: { x: number; y: number }): void => {
    const r = renderer.current;
    if (!r || z === r.zoom) return;
    latest.current.onZoomStep?.();
    r.setZoom(z, anchor ?? r.center);
    setZoomState(z);
  }, []);
  const stepZoom = (dir: 1 | -1, anchor?: { x: number; y: number }): void => {
    const r = renderer.current;
    if (!r) return;
    const i = ZOOMS.indexOf(r.zoom) + dir;
    if (i >= 0 && i < ZOOMS.length) setZoom(ZOOMS[i], anchor);
  };
  const zoomTo = (z: TreeZoom, focus: { x: number; y: number }): void => {
    const r = renderer.current;
    if (r && r.zoom !== z) { r.setZoom(z, focus); setZoomState(z); }
  };
  const panTo = (x: number, y: number): void => renderer.current?.panTo(x, y);
  const overview = (): void => {
    const at = latest.current.overviewAt ?? { x: CX, y: CY };
    setZoom(ZOOMS[0], at);
    renderer.current?.panTo(at.x, at.y);
  };
  const home = (): void => {
    const r = renderer.current;
    if (!r) return;
    zoomTo(1, { x: CX, y: CY });
    r.panTo(CX, CY);
  };

  // ---- pointer: drag to pan, wheel to zoom ------------------------------------------------------------------------
  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const noDrag = latest.current.noDrag;
    if (noDrag && (e.target as HTMLElement).closest(noDrag)) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    const move = (ev: PointerEvent): void => {
      const d = drag.current;
      if (!d) return;
      const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      if (!d.moved) { d.moved = true; renderer.current?.setDragging(true); latest.current.setHovered(null); }
      d.x = ev.clientX; d.y = ev.clientY;
      renderer.current?.panByScreen(dx, dy);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      renderer.current?.setDragging(false);
      // the click that follows a drag must not select a node
      const moved = drag.current?.moved;
      setTimeout(() => { if (drag.current?.moved === moved) drag.current = null; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const onWheel = (e: WheelEvent): void => {
    const r = renderer.current;
    if (!r) return;
    e.preventDefault();
    const now = performance.now();
    if (now - wheelAt.current < 150) return;
    wheelAt.current = now;
    const i = ZOOMS.indexOf(r.zoom) + (e.deltaY < 0 ? 1 : -1);
    if (i < 0 || i >= ZOOMS.length) return;
    const rect = stage.current!.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const w0 = r.screenToWorld(px, py);
    const next = ZOOMS[i];
    // keep the world point under the cursor fixed
    setZoom(next, { x: w0.x - (px - rect.width / 2) / next, y: w0.y - (py - rect.height / 2) / next });
  };
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  return {
    view, stage, canvas, world, renderer, zoom, size,
    dragMoved: () => !!drag.current?.moved,
    setZoom, stepZoom, zoomTo, panTo, overview, home, onPointerDown,
    setHovered: opts.setHovered,
  };
}

export interface TreeStageProps<N extends TreeNodeData, T extends string> {
  api: TreeStageApi<N, T>;
  input: TreeInput;
  /** Accessible name of the stage (it lists the keys). */
  ariaLabel: string;
  /** Attribute that carries the node id on each node button (the Atlas Codex: `data-map-node`). */
  nodeAttr: string;
  /** The node that holds the roving tab stop. */
  focusId: string;
  setFocusId(id: string): void;
  /** Ids whose names print (planTreeLabels). */
  labels: ReadonlySet<string>;
  /** Accessible name of a node button. */
  nodeAria(n: TreeNode<N, T>, state: TreeState): string;
  onSelect(n: TreeNode<N, T>, pan?: boolean): void;
  /** Allocate (true) or refund (false). */
  onAct(id: string, allocate: boolean): void;
  /** The pointer entered a node (hover cue). */
  onNodeEnter?(n: TreeNode<N, T>): void;
  /** Key presses the owner handles before the stage (search box, drawers); return true when handled. */
  onKey?(e: KeyboardEvent, cur: TreeNode<N, T> | null): boolean;
  /** `/` pressed on the stage. */
  onSlash?(): void;
  /** World-space overlays drawn before (under) and after (over) the node buttons. */
  worldBefore?: ComponentChildren;
  worldAfter?: ComponentChildren;
  /** Screen-space overlays (HUD, tooltip, controls). */
  children?: ComponentChildren;
}

export function TreeStage<N extends TreeNodeData, T extends string>(p: TreeStageProps<N, T>) {
  const { api, input, nodeAttr } = p;
  const { view, zoom } = api;
  const { model } = view;
  const { allocated, selected, searching, matches } = input;
  const tones = view.palette.tones;

  const focusEl = (id: string): void => { (api.stage.current?.querySelector(`[${nodeAttr}="${id}"]`) as HTMLElement | null)?.focus({ preventScroll: true }); };
  const onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    const cur = model.byId.get(target.closest?.(`[${nodeAttr}]`)?.getAttribute(nodeAttr) ?? '') ?? null;
    if (p.onKey?.(e, cur)) return;
    const dirs: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const eat = (): void => { e.preventDefault(); e.stopPropagation(); };
    if (dirs[e.key]) {
      eat();
      const from = cur ?? model.byId.get(p.focusId) ?? model.nodes[0];
      const next = model.nearestNode(from, dirs[e.key]);
      if (next) { p.setFocusId(next.id); api.panTo(next.x, next.y); focusEl(next.id); }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (!cur) return;
      eat();
      if (e.key === ' ' && selected === cur.id && !allocated.has(cur.id)) p.onAct(cur.id, true);
      else p.onSelect(cur);
    } else if ((e.key === 'a' || e.key === 'A') && cur && !e.ctrlKey && !e.metaKey) { eat(); p.onSelect(cur); p.onAct(cur.id, true); }
    else if ((e.key === 'r' || e.key === 'R' || e.key === 'Delete' || e.key === 'Backspace') && cur && !e.ctrlKey && !e.metaKey) { eat(); p.onSelect(cur); if (allocated.has(cur.id)) p.onAct(cur.id, false); }
    else if (e.key === '+' || e.key === '=') { eat(); api.stepZoom(1); }
    else if (e.key === '-' || e.key === '_') { eat(); api.stepZoom(-1); }
    else if (e.key === 'f' || e.key === 'F') { eat(); api.overview(); }
    else if (e.key === 'Home') { eat(); api.home(); }
    else if (e.key === '/') { eat(); p.onSlash?.(); }
  };

  return (
    <div class="fe-cx__stage" ref={api.stage} role="application" tabIndex={-1} onKeyDown={onKey as never} onPointerDown={api.onPointerDown as never} aria-label={p.ariaLabel}>
      <canvas class="fe-cx__canvas" ref={api.canvas} aria-hidden="true" />
      <div class="fe-cx__world" ref={api.world} data-zoom={zoom}>
        {p.worldBefore}
        {model.nodes.map((n) => {
          const st = model.nodeState(n.node, allocated);
          const hit = Math.max(n.r * 2, 14 / zoom) * zoom;
          const isOrigin = n.id === model.originId;
          const on = allocated.has(n.id) || isOrigin;
          const dimmed = searching && !matches.has(n.id) && !isOrigin;
          const attrs = { [nodeAttr]: n.id };
          return (
            <div key={n.id} class="fe-cx__slot" style={{ left: n.x * zoom, top: n.y * zoom }}>
              <button type="button" {...attrs} data-state={st} data-class={n.cls}
                aria-label={p.nodeAria(n, st)}
                aria-pressed={selected === n.id}
                tabIndex={p.focusId === n.id ? 0 : -1}
                class={cx('fe-cx__node', st === 'gated' && 'fe-cx__node--gated', selected === n.id && 'fe-cx__node--sel')}
                style={{ width: hit, height: hit }}
                onClick={() => { if (api.dragMoved()) return; p.onSelect(n); }}
                onDblClick={() => { if (api.dragMoved() || isOrigin) return; if (allocated.has(n.id)) return; p.onAct(n.id, true); }}
                onPointerEnter={() => { api.setHovered(n.id); p.onNodeEnter?.(n); }}
                onPointerLeave={() => api.setHovered((h) => (h === n.id ? null : h))}
                onFocus={() => { api.setHovered(n.id); p.setFocusId(n.id); }}
                onBlur={() => api.setHovered((h) => (h === n.id ? null : h))} />
              {p.labels.has(n.id) && !dimmed && !isOrigin && (
                <span class={cx('fe-cx__label ui-type-caption', on && 'fe-cx__label--on', selected === n.id && 'fe-cx__label--sel')} style={{ top: (n.r + 3) * zoom, '--tone': tones[n.tone].css }}>{n.node.name}</span>
              )}
            </div>
          );
        })}
        {p.worldAfter}
      </div>
      <div class="fe-cx__vignette" aria-hidden="true" />
      {p.children}
    </div>
  );
}
