// Dev sandbox for the generic tree view (dev/tree-view.html): the sample graph (src/ui/codex/sample.ts) mounted through
// the same stage, renderer, plates and rail as the Atlas Codex, with local state instead of a store.
//   ?alloc=a1,a2   start with these nodes allocated     ?select=b2   start with this node selected
import { render } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/alegreya-sans/latin-400.css';
import '@fontsource/alegreya-sans/latin-500.css';
import '@fontsource/alegreya-sans/latin-700.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/panels.css';
import '../styles/atlas.css';
import '../styles/codex.css';
import { ZOOMS } from '../codex/render';
import { TreeStage, planTreeLabels, useTreeStage } from '../codex/Stage';
import { TreeRail } from '../codex/Rail';
import { SAMPLE_TREE, SAMPLE_VIEW } from '../codex/sample';

const FREE = 6;
const NO_MATCHES: ReadonlySet<string> = new Set();

function TreeSample() {
  const q = new URLSearchParams(location.search);
  const [allocated, setAllocated] = useState<ReadonlySet<string>>(() => new Set((q.get('alloc') ?? '').split(',').filter((id) => SAMPLE_TREE.byId.has(id))));
  const [selected, setSelected] = useState(q.get('select') ?? SAMPLE_TREE.originId);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusId, setFocusId] = useState(SAMPLE_TREE.originId);
  const spent = [...allocated].reduce((s, id) => s + (SAMPLE_TREE.find(id)?.cost ?? 0), 0);
  const free = FREE - spent;
  const shown = hovered ?? selected;
  const preview = useMemo(() => (shown && shown !== SAMPLE_TREE.originId && !allocated.has(shown) ? SAMPLE_TREE.pathTo(shown, allocated) : null), [shown, allocated]);
  const input = { allocated, selected, hovered, matches: NO_MATCHES, searching: false, preview, previewOk: !!preview && preview.cost <= free, reduceMotion: false };
  const ts = useTreeStage({ view: SAMPLE_VIEW, input, setHovered, noDrag: '.fe-cx__controls, .fe-cx__railslot' });
  const labels = useMemo(() => planTreeLabels(SAMPLE_TREE, Math.max(2, ts.zoom), [selected, hovered], allocated, () => false), [ts.zoom, selected, hovered, allocated]);
  const act = (id: string, allocate: boolean): void => {
    const node = SAMPLE_TREE.find(id);
    if (!node || id === SAMPLE_TREE.originId) return;
    if (allocate ? SAMPLE_TREE.verdict(node, allocated, free).kind !== 'ready' : !SAMPLE_TREE.canRefund(id, allocated)) return;
    const next = new Set(allocated);
    if (allocate) next.add(id); else next.delete(id);
    setAllocated(next);
  };
  const sel = SAMPLE_TREE.byId.get(selected)!;
  const v = SAMPLE_TREE.verdict(sel.node, allocated, free);
  const on = allocated.has(sel.id);
  return (
    <div class="fe-root" style={{ display: 'flex' }}><div class="fe-cx" style={{ pointerEvents: 'auto' }} data-codex data-tree-sample>
      <TreeStage api={ts} input={input} ariaLabel="Sample tree." nodeAttr="data-tree-node" focusId={focusId} setFocusId={setFocusId} labels={labels}
        nodeAria={(n, st) => `${n.node.name}. ${st}.`} onSelect={(n) => { setSelected(n.id); setFocusId(n.id); }} onAct={act}>
        <div class="fe-cx__controls" role="group" aria-label="Zoom">
          <button class="fe-chart__btn ui-type-body" aria-label="Zoom out" disabled={ts.zoom === ZOOMS[0]} onClick={() => ts.stepZoom(-1)}>−</button>
          <span class="fe-chart__zoomread ui-type-caption">{ts.zoom}×</span>
          <button class="fe-chart__btn ui-type-body" aria-label="Zoom in" disabled={ts.zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => ts.stepZoom(1)}>+</button>
          <button class="fe-chart__btn fe-chart__btn--fit ui-type-caption" onClick={() => ts.home()}>Origin</button>
        </div>
      </TreeStage>
      <div class="fe-cx__railslot">
        <TreeRail view={SAMPLE_VIEW} node={sel} state={SAMPLE_TREE.nodeState(sel.node, allocated)} compact={false} onClose={() => {}}
          kicker={`${sel.cls} · ${SAMPLE_VIEW.palette.tones[sel.tone].label}`} name={sel.node.name}
          actions={sel.id === SAMPLE_TREE.originId ? null : on
            ? <button type="button" class="fe-btn fe-btn--ember" disabled={!SAMPLE_TREE.canRefund(sel.id, allocated)} onClick={() => act(sel.id, false)}>Refund</button>
            : <button type="button" class="fe-btn fe-btn--ember" disabled={v.kind !== 'ready'} onClick={() => act(sel.id, true)}>{`Allocate · ${sel.node.cost}`}</button>}>
          <p class="ui-type-secondary">{free} of {FREE} sample points free.</p>
          {v.kind !== 'allocated' && v.kind !== 'ready' && <p class="ui-type-caption fe-cx__gate">{v.reason}</p>}
        </TreeRail>
      </div>
    </div></div>
  );
}

render(<TreeSample />, document.getElementById('ui')!);
