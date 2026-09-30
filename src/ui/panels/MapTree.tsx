import { useState } from 'preact/hooks';
import type { MapTreeNodeId } from '../../contracts/atlas';
import { MAP_TREE, MAP_TREE_BRANCHES, MAP_TREE_POINT_CAP, MAP_TREE_REFUND_COST } from '../../data/progression/map-tree';
import { mapTreePoints } from '../../game/progression/map-tree';
import { Button, cx } from '../components/common';
import { useStore, useUi } from '../store';

export function MapTreeView({ onBack }: { onBack: () => void }) {
  const store = useStore(), ch = useUi(s => s.character)!;
  const [selected, select] = useState<MapTreeNodeId>('trailblazer');
  const nodes = ch.atlas?.nodes ?? [], earned = mapTreePoints(ch.atlas);
  const node = MAP_TREE.find(n => n.id === selected)!;
  const allocated = nodes.includes(selected);
  // Preview through the wrapped rules so trade-locked Scrap is excluded exactly as on the server.
  const preview = store.rules.setMapTreeNode(ch, selected, !allocated);
  return <>
    <div class="fe-atlas__intro ui-type-secondary">
      <strong>{earned - nodes.length} unspent · {nodes.length}/{earned} points allocated</strong>
      <span class="ui-type-caption">One point per first Atlas area completion, up to {MAP_TREE_POINT_CAP}. Shared by your account.</span>
      <span class="ui-type-caption">Your choices apply to newly opened maps for the whole party. Open maps keep their choices. Character stats are unchanged.</span>
    </div>
    <div class="fe-maptree__viewport" aria-label="Map tree paths">
      <div class="fe-maptree__paths">
        {MAP_TREE_BRANCHES.map(branch => <section key={branch} class="fe-maptree__path" aria-label={branch}>
          <h3 class="ui-type-body">{branch}</h3>
          {MAP_TREE.filter(n => n.branch === branch).map(n => {
            const active = nodes.includes(n.id), reachable = !n.parent || nodes.includes(n.parent);
            return <button key={n.id} class={cx('fe-maptree__node', active && 'fe-maptree__node--active', !reachable && 'fe-maptree__node--locked')}
              data-map-node={n.id} aria-pressed={selected === n.id} onClick={() => select(n.id)}>
              <strong class="ui-type-secondary">{n.name}</strong>
              <span class="ui-type-caption">{active ? '✓ Allocated' : reachable ? '1 map point' : 'Requires previous node'}</span>
            </button>;
          })}
        </section>)}
      </div>
    </div>
    <div class="fe-maptree__detail" aria-live="polite">
      <strong class="ui-type-body">{node.name}</strong>
      <p class="ui-type-secondary">{node.text}</p>
      <p class="ui-type-caption">{allocated ? `Refund this point for ${MAP_TREE_REFUND_COST} Scrap. Refund later nodes on the path first.` : node.parent ? `Requires ${MAP_TREE.find(n => n.id === node.parent)!.name}. Costs 1 map point.` : 'Starts a new path. Costs 1 map point.'}</p>
      {!preview.ok && <p class="fe-atlas__error ui-type-caption">{preview.error}</p>}
    </div>
    <div class="fe-atlas__actions">
      <Button onClick={onBack}>Back</Button>
      <Button disabled={!preview.ok} onClick={() => store.actions.setMapTreeNode(selected, !allocated)}>
        {allocated ? `Refund · ${MAP_TREE_REFUND_COST} Scrap` : 'Allocate point'}
      </Button>
    </div>
  </>;
}
