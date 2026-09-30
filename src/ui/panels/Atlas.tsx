import { useEffect, useRef, useState } from 'preact/hooks';
import type { AtlasAreaId, AtlasProgress } from '../../contracts/atlas';
import { ATLAS_AREAS, ATLAS_AREA_TYPE_LABELS, atlasTierCeiling, findAtlasArea } from '../../data/progression/atlas';
import { mapBaseImplicitText, mapBosses } from '../../game/progression/maps';
import { MAP_BASES } from '../../data/progression/maps';
import { CLASS_LABEL, CURRENCIES } from '../../data/items';
import { Button, cx } from '../components/common';

/** A fixed world map under fog; all text remains DOM text on the shared type scale. */
export function AtlasView({ progress, selected, tier, onSelect, onBack }: {
  progress: AtlasProgress; selected: AtlasAreaId; tier: number | null;
  onSelect: (id: AtlasAreaId) => void; onBack: () => void;
}) {
  const [inspected, inspect] = useState(selected);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = viewport.current, node = container?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (container && node) container.scrollTo({ left: node.offsetLeft - container.clientWidth / 2, top: node.offsetTop - container.clientHeight / 2 });
  }, [inspected]);
  const area = findAtlasArea(inspected)!;
  const visible = new Set(progress.discovered);
  const completed = new Set(progress.completed);
  const y = (n: number) => 10 + n * 0.8;
  const typeLabel = (id: AtlasAreaId) => {
    const node = findAtlasArea(id)!;
    return node.sealed ? 'Sealed area' : ATLAS_AREA_TYPE_LABELS[node.type];
  };
  const fits = tier === null || tier <= atlasTierCeiling(area);
  const preferences = [
    ...Object.entries(area.classWeights ?? {}).map(([id, value]) => `${CLASS_LABEL[id as keyof typeof CLASS_LABEL]} bases ×${value}`),
    ...Object.entries(area.currencyWeights ?? {}).map(([id, value]) => `${CURRENCIES[id as keyof typeof CURRENCIES].name} ×${value}`),
  ];
  return (
    <>
      <div class="fe-atlas__intro ui-type-secondary">
        <span>{completed.size}/{ATLAS_AREAS.length} areas completed · shared by your account</span>
        <span class="ui-type-caption">Area objectives reveal two neighbours. Scroll to explore; side areas show their entry requirements below.</span>
      </div>
      <div class="fe-atlas__viewport" aria-label="Atlas areas" ref={viewport}>
        <div class="fe-atlas__world">
          <svg class="fe-atlas__routes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {ATLAS_AREAS.flatMap((a) => a.neighbours.filter((id) => a.id < id).map((id) => {
              const b = findAtlasArea(id)!;
              // The sealed destinations sit between the two lanes. Bow cross-lane links into the
              // gap between columns so they cannot look like entrances to an unrelated sealed area.
              const route = a.x === b.x
                ? `M ${a.x} ${y(a.y)} C ${a.x + 6.7} ${y(a.y)}, ${b.x + 6.7} ${y(b.y)}, ${b.x} ${y(b.y)}`
                : Math.abs(a.y - b.y) > 40
                ? `M ${a.x} ${y(a.y)} C ${(a.x + b.x) / 2} ${y(a.y)}, ${(a.x + b.x) / 2} ${y(b.y)}, ${b.x} ${y(b.y)}`
                : `M ${a.x} ${y(a.y)} L ${b.x} ${y(b.y)}`;
              return <path key={`${a.id}-${id}`} d={route} data-from={a.id} data-to={b.id}
                class={visible.has(a.id) && visible.has(id) ? 'fe-atlas__route--open' : ''} />;
            }))}
          </svg>
          {ATLAS_AREAS.map((a) => {
            const known = visible.has(a.id);
            return <button key={a.id} type="button" disabled={!known} aria-pressed={known && inspected === a.id}
              data-area={a.id} aria-label={known ? `${a.name}, ${typeLabel(a.id)}, up to Tier ${atlasTierCeiling(a)}` : 'Unexplored area'}
              class={cx('fe-atlas__node', known && 'fe-atlas__node--known', completed.has(a.id) && 'fe-atlas__node--complete', inspected === a.id && 'fe-atlas__node--selected')}
              style={{ left: `${a.x}%`, top: `${y(a.y)}%` }} onClick={() => inspect(a.id)}>
              <span class="fe-atlas__name ui-type-secondary">{known ? a.name : 'Unexplored'}</span>
              {known && <span class="ui-type-caption">{completed.has(a.id) ? '✓ ' : ''}{typeLabel(a.id)} · T{atlasTierCeiling(a)}</span>}
            </button>;
          })}
        </div>
      </div>
      <div class="fe-atlas__detail">
        <strong class="ui-type-body">{area.name} · maps up to Tier {atlasTierCeiling(area)}</strong>
        <p class="ui-type-secondary">{area.description}</p>
        <p class="ui-type-caption">{MAP_BASES[area.baseId].name} · {area.noBoss ? 'No final boss' : `Boss: ${mapBosses(area.baseId).boss.name}`}</p>
        {area.entranceKey && <p class="ui-type-secondary">Entry: one {CURRENCIES[area.entranceKey].name}. {CURRENCIES[area.entranceKey].description}</p>}
        <p class="ui-type-caption">{mapBaseImplicitText(area.baseId)} {preferences.length > 0 && `Drop weighting: ${preferences.join(' · ')}.`}</p>
        {area.ingredientDrops?.map(d => <p key={d.currencyId} class="ui-type-caption">Boss ingredient: {CURRENCIES[d.currencyId].name} · {d.chance * 100}% chance on Tier {d.minTier}{atlasTierCeiling(area) > d.minTier ? '+' : ''} maps.</p>)}
        {!fits && <p class="fe-atlas__error ui-type-secondary">Your Tier {tier} map needs an area with a higher limit.</p>}
      </div>
      <div class="fe-atlas__actions">
        <Button onClick={onBack}>Back</Button>
        <Button variant="ember" disabled={!fits} onClick={() => onSelect(area.id)}>Use this area</Button>
      </div>
    </>
  );
}
