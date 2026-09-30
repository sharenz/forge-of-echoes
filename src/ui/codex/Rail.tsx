// The Codex inspector rail: the selected node with its plate, full effect text, gates and exclusions, what it would
// do to the map in the device, and the one primary action (allocate or refund) with its price and its reason to refuse.
import { useEffect, useRef } from 'preact/hooks';
import { ATLAS_FREE_REFUNDS, ATLAS_RESPEC_COST, ATLAS_RESPEC_SESSION_CAP, ATLAS_ORIGIN_ID, MAP_TREE_POINTS, atlasRespecCost, findAtlasNode } from '../../data/progression/map-tree';
import { refundCost } from '../../game/progression/map-tree';
import { cachedPlate } from '../../art/codex/plates';
import { PLATE_SIZE, TONES } from '../../art/codex/tones';
import { drawFrameSurface, frameToSurface, newCanvas, ctx2d } from '../../art/atlas/canvas';
import { Button, cx } from '../components/common';
import { useUi } from '../store';
import type { CxNode, CxState } from './model';
import { dependants, groupLabel, kindLabel, verdict } from './model';
import type { Hint } from './hint';

/** A plate drawn crisply at a whole scale (tooltip and rail). */
export function PlateArt({ node, state, scale }: { node: CxNode; state: CxState; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const side = PLATE_SIZE[node.cls];
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const surf = frameToSurface(cachedPlate({ cls: node.cls, tone: node.tone, ...(node.tone2 ? { tone2: node.tone2 } : {}), glyph: node.glyph, state: node.id === ATLAS_ORIGIN_ID ? 'on' : state }));
    el.width = side * scale; el.height = side * scale;
    const c = el.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, el.width, el.height);
    const tmp = newCanvas(side, side);
    drawFrameSurface(ctx2d(tmp), surf, 0, 0, 0.9);
    c.drawImage(tmp, 0, 0, el.width, el.height);
  }, [node.id, state, scale]);
  return <canvas ref={ref} class="fe-cx__plate" width={side * scale} height={side * scale} style={{ width: side * scale, height: side * scale }} aria-hidden="true" />;
}

export interface RailProps {
  node: CxNode;
  allocated: ReadonlySet<string>;
  free: number;
  earned: number;
  parts: { areas: number; tiers: number; events: number; bosses: number; milestones: number };
  freeRefunds: number;
  hint: Hint | null;
  areaName: string | null;
  onAllocate: () => void;
  onRefund: () => void;
  onBack: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
  compact: boolean;
  error: string | null;
  canRefundNow: boolean;
  changeError: string | null;
}

export function CodexRail(p: RailProps) {
  const ch = useUi((s) => s.character)!;
  const n = p.node.node;
  const on = p.allocated.has(n.id);
  const isOrigin = n.id === ATLAS_ORIGIN_ID;
  const v = verdict(n, p.allocated, p.free);
  const state: CxState = on ? 'on' : v.kind === 'gated' ? 'gated' : v.kind === 'ready' ? 'ready' : 'locked';
  const cost = on ? refundCost(ch.atlas, n) : 0;
  const stuck = on ? dependants(n.id, p.allocated) : [];
  const light = TONES[p.node.tone].css;
  return (
    <aside class="fe-cx__rail fe-maptree__detail" aria-label="Node details" aria-live="polite" style={{ '--tone': light }}>
      {p.compact && <button class="fe-btn fe-btn--icon fe-btn--ghost fe-cx__railclose" aria-label="Close details" onClick={p.onClose}><span class="fe-x" /></button>}
      {isOrigin ? (
        <div class="fe-cx__rail-body">
          <header class="fe-cx__rail-head">
            <PlateArt node={p.node} state="on" scale={2} />
            <span>
              <span class="ui-type-caption fe-cx__kicker">The Codex</span>
              <strong class="ui-type-body fe-cx__name">Cinder Crossing Brazier</strong>
            </span>
          </header>
          <p class="ui-type-secondary">Every path begins here. Wire threads outward, one connected node at a time; an ember runs along each thread you light.</p>
          <ul class="fe-cx__facts ui-type-caption">
            <li><b>{p.free}</b> unspent · {p.earned} / {MAP_TREE_POINTS.total} earned</li>
            <li>Areas {p.parts.areas}/{MAP_TREE_POINTS.areas} · tiers {p.parts.tiers}/{MAP_TREE_POINTS.tiers} · encounters {p.parts.events}/{MAP_TREE_POINTS.events} · bosses {p.parts.bosses}/{MAP_TREE_POINTS.bosses} · milestones {p.parts.milestones}/{MAP_TREE_POINTS.milestones}</li>
            <li>{p.freeRefunds > 0 ? `${p.freeRefunds} of your first ${ATLAS_FREE_REFUNDS} refunds are still free.` : `Refund: small ${ATLAS_RESPEC_COST.small}, notable ${ATLAS_RESPEC_COST.notable}, keystone ${ATLAS_RESPEC_COST.keystone} Scrap, at most ${ATLAS_RESPEC_SESSION_CAP} per session.`}</li>
          </ul>
          <p class="ui-type-caption fe-cx__fine">Your choices apply to newly opened maps for the whole party. Open maps keep their choices. Character stats are unchanged. Shared by your account.{ch.atlas?.redrawn ? ' The Codex was redrawn: your old points are back.' : ''}</p>
          <p class="ui-type-caption fe-cx__fine">Click a node to inspect it. Double-click to allocate. Drag to pan, scroll to zoom.</p>
        </div>
      ) : (
        <div class="fe-cx__rail-body">
          <header class="fe-cx__rail-head">
            <PlateArt node={p.node} state={state} scale={2} />
            <span>
              <span class="ui-type-caption fe-cx__kicker">{kindLabel(n)} · {groupLabel(n)}</span>
              <strong class="ui-type-body fe-cx__name">{n.name}</strong>
            </span>
          </header>
          <div class="fe-cx__effects">
            {n.lines.map((line, i) => <p key={i} class="ui-type-secondary fe-cx__effect">{line}</p>)}
          </div>
          {n.flavor && <p class="ui-type-caption fe-cx__flavor">{n.flavor}</p>}
          {n.excludes.length > 0 && (
            <p class={cx('ui-type-caption fe-cx__excl', v.kind === 'excluded' && 'fe-cx__excl--held')}>
              <i class="fe-cx__lock" aria-hidden="true" />Excludes{' '}
              {n.excludes.map((id, i) => <span key={id}>{i > 0 && ', '}<button class="fe-cx__link" onClick={() => p.onSelect(id)}>{findAtlasNode(id)?.name}</button></span>)}
              . Hold only one.
            </p>
          )}
          {v.kind === 'gated' && <p class="ui-type-caption fe-cx__gate"><i class="fe-cx__lock" aria-hidden="true" />{v.reason}</p>}
          {v.kind === 'far' && <p class="ui-type-caption fe-cx__far">{v.reason}{v.path ? ` The cheapest way in costs ${v.path.cost} points (${v.path.nodes.length} nodes).` : ' No open route reaches it right now.'}</p>}
          {v.kind === 'excluded' && <p class="ui-type-caption fe-cx__gate"><i class="fe-cx__lock" aria-hidden="true" />{v.reason}</p>}
          {p.hint && (
            <div class="fe-cx__hint">
              <span class="ui-type-caption fe-cx__kicker">{on ? 'On your current map' : 'On your map'}{p.areaName ? ` · ${p.areaName}` : ''}</span>
              {p.hint.lines.length > 0
                ? p.hint.lines.map((l, i) => <span key={i} class="ui-type-secondary fe-cx__hintline"><b>{l.label}</b><span>{l.from}</span><i aria-hidden="true">→</i><em>{l.to}</em></span>)
                : <span class="ui-type-caption">{p.hint.note}</span>}
            </div>
          )}
          <p class="ui-type-caption fe-cx__price">
            {on
              ? `Refund for ${cost === 0 ? 'free' : `${cost} Scrap`} (normally ${atlasRespecCost(n)}; your first ${ATLAS_FREE_REFUNDS} refunds are free).${stuck.length ? ` Refund the nodes beyond it first.` : ''}`
              : `Costs ${n.cost} Atlas point${n.cost === 1 ? '' : 's'}. Connect it to your path.`}
          </p>
          {(p.changeError || p.error) && <p class="fe-atlas__error ui-type-caption">{p.error ?? p.changeError}</p>}
        </div>
      )}
      <footer class="fe-cx__rail-actions">
        <Button onClick={p.onBack}>Back</Button>
        {!isOrigin && (on
          ? <Button variant="ember" disabled={!!p.changeError || !p.canRefundNow} onClick={p.onRefund}>{cost === 0 ? 'Refund · free' : `Refund · ${cost} Scrap`}</Button>
          : <Button variant="ember" disabled={!!p.changeError} onClick={p.onAllocate}>{`Allocate · ${n.cost} point${n.cost === 1 ? '' : 's'}`}</Button>)}
      </footer>
    </aside>
  );
}
