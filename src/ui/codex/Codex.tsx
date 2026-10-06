// The Codex tab of the Cartography Table: the 145-node Atlas tree as a wheel of six branches around the Cinder Crossing
// brazier (docs/atlas-rework/A-atlas-visuals.md section 8, B-atlas-tree.md). The generic tree stage (Stage.tsx) draws
// board, threads and plates (render.ts) and puts one DOM <button data-map-node> per node on top for pointer, keyboard
// and screen readers; this file adds the Atlas parts: branch banners, points, search, tooltip, controls and the rail.
// Names, tooltips, counters and the inspector rail are DOM text on the shared type scale.
import { gt } from '../../data/guide/strings';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AtlasAreaId } from '../../contracts/atlas';
import type { MapItem } from '../../contracts/items';
import { ATLAS_START, findAtlasArea } from '../../data/progression/atlas';
import { ATLAS_BRANCHES, ATLAS_FREE_REFUNDS, ATLAS_ORIGIN_ID, MAP_TREE_POINTS, atlasNodeAllocatable, findAtlasNode } from '../../data/progression/map-tree';
import { mapTreeBreakdown, mapTreeChangeError, mapTreeFreePoints, mapTreePoints, mapTreeSpent, refundCost } from '../../game/progression/map-tree';
import { TONES, type Tone } from '../../art/codex/tones';
import { CODEX_C, BRANCH_AXIS, ringRadius } from '../../art/codex/board';
import { cx } from '../components/common';
import { useStore, useUi } from '../store';
import { MOTION_LABEL, useMotion } from '../atlas/motion';
import { ATLAS_TREE, CX_BY_ID, CX_NODES, canRefund, exclusionOf, groupLabel, kindLabel, nodeState, pathTo, searchNodes, verdict, type CxNode, type PathPreview } from './model';
import { ZOOMS } from './render';
import { mapHint, type Hint } from './hint';
import { CodexRail, PlateArt } from './Rail';
import { ATLAS_VIEW } from './atlasView';
import { TreeStage, planTreeLabels, useTreeStage } from './Stage';
import '../styles/codex.css';

const compactQuery = '(max-width: 1179px), (max-height: 679px)';
function useCompact(): boolean {
  const [compact, setCompact] = useState(() => { try { return window.matchMedia(compactQuery).matches; } catch { return false; } });
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia(compactQuery); } catch { return; }
    const on = (): void => setCompact(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}

/** Which Atlas node names to print at this zoom (see planTreeLabels). */
export function planLabels(zoom: number, focus: readonly (string | null)[], allocated: ReadonlySet<string>, hidden: (id: string) => boolean): Set<string> {
  return planTreeLabels(ATLAS_TREE, zoom, focus, allocated, hidden);
}

export interface CodexProps {
  onBack: () => void;
  /** The Atlas area the device is pointed at: the live "what this does to your map" hint is computed for it. */
  areaId?: AtlasAreaId;
}

export function CodexView({ onBack, areaId }: CodexProps) {
  const store = useStore();
  const ch = useUi((s) => s.character)!;
  const compact = useCompact();
  const { calm, pref, cycle } = useMotion();
  const search = useRef<HTMLInputElement>(null);
  const hoverAt = useRef(0);
  const [selected, setSelected] = useState<string>(ATLAS_ORIGIN_ID);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string>(ATLAS_ORIGIN_ID);
  const [query, setQuery] = useState('');
  const [matchAt, setMatchAt] = useState(0);
  const [railOpen, setRailOpen] = useState(false);
  const [legend, setLegend] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const allocated = useMemo(() => new Set(ch.atlas?.nodes ?? []), [ch.atlas?.nodes]);
  const free = mapTreeFreePoints(ch.atlas);
  const earned = mapTreePoints(ch.atlas);
  const spent = mapTreeSpent(ch.atlas?.nodes);
  const parts = mapTreeBreakdown(ch.atlas);
  const freeRefunds = Math.max(0, ATLAS_FREE_REFUNDS - (ch.atlas?.refunds ?? 0));
  const matches = useMemo(() => searchNodes(query), [query]);
  const matchList = useMemo(() => CX_NODES.filter((n) => matches.has(n.id)), [matches]);
  const searching = query.trim().length > 0;
  const shown = hovered ?? selected;

  // the path the shown node would take from your tree (unallocated, reachable in principle)
  const preview: PathPreview | null = useMemo(() => (shown && shown !== ATLAS_ORIGIN_ID && !allocated.has(shown) ? pathTo(shown, allocated) : null), [shown, allocated]);
  const previewOk = !!preview && preview.cost <= free;

  // ---- stage: renderer, camera, drag and wheel -------------------------------------------------------------------
  const ts = useTreeStage({
    view: ATLAS_VIEW,
    input: { allocated, selected, hovered, matches, searching, preview, previewOk, reduceMotion: calm },
    setHovered,
    onBeat: (beat, n) => store.actions.uiSound(beat === 'refund' ? 'close' : n.cls === 'keystone' ? 'open' : 'equip'),
    onZoomStep: () => store.actions.uiSound('hover'),
    // the whole wheel sits a little low so the HUD does not cover the top banner
    overviewAt: { x: CODEX_C, y: CODEX_C - 36 },
    noDrag: '.fe-cx__hud, .fe-cx__controls, .fe-cx__railslot, .fe-cx__legend, input',
  });
  const { zoom, size, renderer, stage } = ts;

  // ---- live hint on the current map -------------------------------------------------------------------------
  const area = findAtlasArea(areaId ?? (ch.atlas?.completed.at(-1) as AtlasAreaId | undefined) ?? ATLAS_START) ?? findAtlasArea(ATLAS_START)!;
  const hintFor = useCallback((id: string): Hint | null => {
    const node = findAtlasNode(id);
    if (!node || id === ATLAS_ORIGIN_ID) return null;
    const map: MapItem | null = ch.mapDevice ? ({ ...ch.mapDevice, areaId: area.id, baseId: area.baseId } as MapItem) : null;
    if (!atlasNodeAllocatable(node)) return { lines: [], note: 'Not active yet: no effect on maps until its update lands.' };
    const on = allocated.has(id);
    if (!on && exclusionOf(node, allocated)) return null; // it cannot be taken while its rival is held
    const ids = on ? [id] : (pathTo(id, allocated)?.nodes ?? [id]);
    return mapHint(store.rules, ch, map, ids, !on, id);
  }, [ch, allocated, area, store]);
  const shownHint = useMemo(() => (shown ? hintFor(shown) : null), [shown, hintFor]);

  // ---- selection, focus, zoom ---------------------------------------------------------------------------------
  const select = useCallback((n: CxNode, pan = false): void => {
    store.actions.uiSound('click');
    setSelected(n.id);
    setFocusId(n.id);
    if (pan) renderer.current?.panTo(n.x, n.y);
    if (compact) setRailOpen(true);
  }, [store, compact]);

  const stepZoom = ts.stepZoom;
  const overview = ts.overview;
  const home = ts.home;
  const jumpBranch = (b: (typeof ATLAS_BRANCHES)[number]): void => {
    const a = (BRANCH_AXIS[b] * Math.PI) / 180, R = ringRadius(5.5);
    store.actions.uiSound('hover');
    ts.zoomTo(1, { x: CODEX_C, y: CODEX_C });
    renderer.current?.panTo(CODEX_C + Math.cos(a) * R, CODEX_C + Math.sin(a) * R);
  };

  // ---- allocate / refund ----------------------------------------------------------------------------------------
  const act = useCallback((id: string, allocate: boolean): boolean => {
    const node = findAtlasNode(id);
    if (!node || id === ATLAS_ORIGIN_ID) return false;
    const preview = store.rules.setMapTreeNode(ch, id, allocate);
    if (!preview.ok) { store.actions.uiSound('error'); setNotice(preview.error); return false; }
    setNotice(null);
    store.actions.setMapTreeNode(id, allocate);
    return true;
  }, [store, ch]);

  // ---- search -----------------------------------------------------------------------------------------------
  const goMatch = (dir: 1 | -1): void => {
    if (!matchList.length) return;
    const i = (matchAt + dir + matchList.length) % matchList.length;
    setMatchAt(i);
    const n = matchList[i];
    setSelected(n.id); setFocusId(n.id);
    const r = renderer.current;
    if (r && r.zoom < 1) ts.zoomTo(1, { x: n.x, y: n.y });
    r?.panTo(n.x, n.y);
    r?.pulse(n.id);
    store.actions.uiSound('hover');
  };
  useEffect(() => { setMatchAt(-1); }, [query]);

  // ---- keyboard: the search box and the rail drawer first, then the stage's own keys -----------------------------
  const onKey = (e: KeyboardEvent): boolean => {
    const target = e.target as HTMLElement;
    if (target === search.current) {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); goMatch(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (query) setQuery(''); else stage.current?.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); (stage.current?.querySelector(`[data-map-node="${focusId}"]`) as HTMLElement | null)?.focus({ preventScroll: true }); }
      else e.stopPropagation();
      return true;
    }
    if (e.key === 'Escape' && compact && railOpen) { e.stopImmediatePropagation(); e.preventDefault(); setRailOpen(false); return true; }
    return false;
  };

  // ---- tooltip position -----------------------------------------------------------------------------------------
  const tipNode = hovered ? CX_BY_ID.get(hovered) ?? null : null;
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipH, setTipH] = useState(220);
  useLayoutEffect(() => { if (tipRef.current) setTipH(tipRef.current.offsetHeight); });
  const tipPos = useMemo(() => {
    const r = renderer.current;
    if (!tipNode || !r) return null;
    const p = r.worldToScreen(tipNode.x, tipNode.y);
    const w = 292, gap = (tipNode.r + 8) * zoom;
    const right = p.x + gap + w < size.w;
    const x = right ? p.x + gap : p.x - gap - w;
    return { x: Math.max(6, Math.min(size.w - w - 6, x)), y: Math.max(6, Math.min(size.h - tipH - 6, p.y - 44)) };
  }, [tipNode, zoom, size, tipH]);
  const tipVerdict = tipNode ? verdict(tipNode.node, allocated, free) : null;

  const branchCounts = useMemo(() => {
    const out = new Map<string, { on: number; total: number }>();
    for (const b of ATLAS_BRANCHES) out.set(b, { on: 0, total: 0 });
    for (const n of CX_NODES) {
      const c = out.get(n.node.group);
      if (!c) continue;
      c.total++;
      if (allocated.has(n.id)) c.on++;
    }
    return out;
  }, [allocated]);

  const labels = useMemo(() => planLabels(zoom, [selected, hovered], allocated, (id) => searching && !matches.has(id)), [zoom, selected, hovered, allocated, searching, matches]);
  const selNode = CX_BY_ID.get(selected)!;
  const stateText = (n: CxNode): string => {
    const s = nodeState(n.node, allocated);
    const v = verdict(n.node, allocated, free);
    return s === 'on' ? 'Allocated' : v.kind === 'gated' ? 'Not active yet' : v.kind === 'excluded' ? `Excluded by ${v.by.name}` : s === 'ready' ? 'Available' : 'Not connected';
  };

  return (
    <div class={cx('fe-cx', compact && 'fe-cx--compact', compact && railOpen && 'fe-cx--rail-open', calm && 'fe-cx--calm')} data-codex>
      <TreeStage api={ts} input={{ allocated, selected, hovered, matches, searching, preview, previewOk, reduceMotion: calm }}
        ariaLabel="Atlas Codex. Arrow keys move between nodes, Enter inspects, A allocates, R refunds, plus and minus zoom, F shows the whole wheel, slash searches."
        nodeAttr="data-map-node" focusId={focusId} setFocusId={setFocusId} labels={labels}
        nodeAria={(n) => `${n.node.name}, ${kindLabel(n.node)}, ${groupLabel(n.node)}. ${stateText(n)}.`}
        onSelect={(n) => select(n)} onAct={(id, allocate) => { act(id, allocate); }}
        onNodeEnter={() => { const now = performance.now(); if (now - hoverAt.current > 70) { hoverAt.current = now; store.actions.uiSound('hover'); } }}
        onKey={onKey} onSlash={() => search.current?.focus()}
        worldBefore={<>
          {ATLAS_BRANCHES.map((b) => {
            const a = (BRANCH_AXIS[b] * Math.PI) / 180, R = 432;
            const cnt = branchCounts.get(b)!;
            return (
              <div key={b} class={cx('fe-cx__banner', cnt.on > 0 && 'fe-cx__banner--lit')} style={{ left: (CODEX_C + Math.cos(a) * R) * zoom, top: (CODEX_C + Math.sin(a) * R) * zoom, '--tone': TONES[b as Tone].css }} aria-hidden="true">
                <span class="fe-cx__banner-name ui-type-body">{TONES[b as Tone].label}</span>
                <span class="fe-cx__banner-count ui-type-caption">{cnt.on} / {cnt.total}</span>
              </div>
            );
          })}
        </>}
        worldAfter={<>
          {preview && preview.nodes.length > 0 && shown && (() => {
            const t = CX_BY_ID.get(preview.nodes[preview.nodes.length - 1])!;
            return (
              <div class={cx('fe-cx__cost ui-type-caption', !previewOk && 'fe-cx__cost--bad')} style={{ left: t.x * zoom, top: (t.y - t.r - 4) * zoom }} aria-hidden="true">
                {preview.cost} point{preview.cost === 1 ? '' : 's'}{preview.nodes.length > 1 ? ` · ${preview.nodes.length} nodes` : ''}
              </div>
            );
          })()}
        </>}>

        <div class="fe-cx__hud">
          <div class="fe-cx__points" role="status" aria-live="polite">
            <span class="fe-cx__points-num ui-type-title">{free}</span>
            <span class="fe-cx__points-text">
              <b class="ui-type-body">{free === 1 ? 'point' : 'points'} to spend</b>
              <span class="ui-type-caption">{spent} spent · {earned} / {MAP_TREE_POINTS.total} earned</span>
            </span>
          </div>
          <label class="fe-cx__search">
            <span class="fe-cx__sr">Search the Codex</span>
            <input ref={search} type="search" class="ui-type-secondary" placeholder="Search: essence, keystone, boss…" value={query} disabled={earned === 0 && spent === 0} autocomplete="off" spellcheck={false}
              onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
            {searching && <span class="fe-cx__count ui-type-caption" role="status">{matches.size ? (matchAt >= 0 ? `${matchAt + 1} / ${matches.size}` : `${matches.size} found`) : 'none'}</span>}
          </label>
          <div class="fe-cx__branches" role="group" aria-label="Jump to a branch">
            {ATLAS_BRANCHES.map((b) => {
              const c = branchCounts.get(b)!;
              return (
                <button key={b} class="fe-cx__branch ui-type-caption" style={{ '--tone': TONES[b as Tone].css }} onClick={() => jumpBranch(b)} title={`${TONES[b as Tone].label}: ${c.on} of ${c.total} allocated`} aria-label={`${TONES[b as Tone].label}: ${c.on} of ${c.total} allocated`}>
                  <i class="fe-cx__pip" /><b>{c.on}</b><span class="fe-cx__branch-name">{TONES[b as Tone].label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {notice && <div class="fe-cx__notice fe-atlas__error ui-type-secondary" role="alert">{notice}</div>}
        {earned === 0 && spent === 0 && (
          // Nothing earned yet: say so calmly instead of leaving a new player alone with a 145-node wheel.
          <div class="fe-cx__empty ui-type-body" data-codex-empty role="note">{gt('codex.empty')}</div>
        )}

        {tipNode && tipPos && (
          <div class="fe-cx__tip" ref={tipRef} style={{ left: tipPos.x, top: tipPos.y, '--tone': TONES[tipNode.tone].css }} role="tooltip">
            <div class="fe-cx__tip-head">
              <PlateArt node={tipNode} state={nodeState(tipNode.node, allocated)} scale={2} />
              <span>
                <strong class="fe-cx__tip-name ui-type-body">{tipNode.node.name}</strong>
                <span class="ui-type-caption fe-cx__tip-meta">{kindLabel(tipNode.node)} · {groupLabel(tipNode.node)}</span>
              </span>
            </div>
            {tipNode.node.lines.slice(0, 5).map((l, i) => <p key={i} class="ui-type-secondary fe-cx__tip-line">{l}</p>)}
            {tipVerdict && <p class={cx('ui-type-caption fe-cx__tip-verdict', `fe-cx__tip-verdict--${tipVerdict.kind}`)}>
              {tipVerdict.kind === 'allocated' ? `Allocated · refund ${refundCost(ch.atlas, tipNode.node) === 0 ? 'free' : `${refundCost(ch.atlas, tipNode.node)} Scrap`}${canRefund(tipNode.id, allocated) ? '' : ' after the nodes beyond it'}`
                : tipVerdict.kind === 'ready' ? `Available · ${tipNode.node.cost} point${tipNode.node.cost === 1 ? '' : 's'}`
                : tipVerdict.kind === 'far' ? (preview ? `${preview.cost} points via ${preview.nodes.length} node${preview.nodes.length === 1 ? '' : 's'}${previewOk ? '' : ` (you have ${free})`}` : tipVerdict.reason)
                : tipVerdict.reason}
            </p>}
            {shownHint && hovered === shown && tipVerdict?.kind !== 'gated' && (
              <p class="ui-type-caption fe-cx__tip-hint">
                {shownHint.lines.length ? shownHint.lines.slice(0, 3).map((l, i) => <span key={i}><b>{l.label}</b> {l.from} → <em>{l.to}</em></span>) : shownHint.note}
              </p>
            )}
          </div>
        )}

        <div class="fe-cx__controls" role="group" aria-label="Zoom">
          <button class="fe-chart__btn ui-type-body" aria-label="Zoom out" disabled={zoom === ZOOMS[0]} onClick={() => stepZoom(-1)}>−</button>
          <span class="fe-chart__zoomread ui-type-caption" aria-live="polite">{zoom}×</span>
          <button class="fe-chart__btn ui-type-body" aria-label="Zoom in" disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => stepZoom(1)}>+</button>
          <button class="fe-chart__btn fe-chart__btn--fit ui-type-caption" title="Show the whole wheel (F)" onClick={overview}>Whole</button>
          <button class="fe-chart__btn fe-chart__btn--fit ui-type-caption" title="Back to the origin (Home)" onClick={home}>Origin</button>
          <button class={cx('fe-chart__btn fe-chart__btn--fit ui-type-caption', calm && 'fe-chart__btn--on')} aria-label={MOTION_LABEL[pref]} title={`${MOTION_LABEL[pref]}. Calm turns off animation; System follows your device setting and calms when Screen shake is 0.`} onClick={cycle}>{pref === 'auto' ? 'Motion: auto' : pref === 'calm' ? 'Motion: calm' : 'Motion: full'}</button>
          <button class="fe-chart__btn fe-chart__btn--fit ui-type-caption" aria-expanded={legend} onClick={() => setLegend((v) => !v)}>Key</button>
        </div>
        {legend && (
          <div class="fe-cx__legend ui-type-caption" role="note">
            <span><i class="fe-cx__lg fe-cx__lg--on" />Allocated</span>
            <span><i class="fe-cx__lg fe-cx__lg--ready" />Available now</span>
            <span><i class="fe-cx__lg fe-cx__lg--locked" />Not connected</span>
            <span><i class="fe-cx__lg fe-cx__lg--gated" />Awaits its update</span>
            <span><i class="fe-cx__lg fe-cx__lg--excl" />Excluded pair</span>
            <span class="fe-cx__legend-hint">Double-click allocates. R refunds.</span>
          </div>
        )}
        {compact && !railOpen && (
          <button class="fe-cx__railbtn ui-type-caption" onClick={() => setRailOpen(true)} aria-label="Open node details">Details</button>
        )}
      </TreeStage>
      <div class={cx('fe-cx__railslot', compact && 'fe-cx__railslot--drawer', compact && railOpen && 'fe-cx__railslot--open')} data-rail-slot>
        <CodexRail
          node={selNode} allocated={allocated} free={free} earned={earned} parts={parts} freeRefunds={freeRefunds}
          hint={hintFor(selNode.id)} areaName={ch.mapDevice ? area.name : null}
          onAllocate={() => act(selNode.id, true)} onRefund={() => act(selNode.id, false)} onBack={onBack}
          onSelect={(id) => { const n = CX_BY_ID.get(id); if (n) { select(n, true); } }}
          onClose={() => setRailOpen(false)} compact={compact}
          error={notice} canRefundNow={canRefund(selNode.id, allocated)}
          changeError={selNode.id === ATLAS_ORIGIN_ID ? null : mapTreeChangeError(ch, selNode.id, !allocated.has(selNode.id))}
        />
      </div>
    </div>
  );
}

