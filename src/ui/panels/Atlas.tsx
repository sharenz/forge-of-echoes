import { useState } from 'preact/hooks';
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
  const area = findAtlasArea(inspected)!;
  const visible = new Set(progress.discovered);
  const completed = new Set(progress.completed);
  const y = (n: number) => 10 + n * 0.8;
  const fits = tier === null || tier <= atlasTierCeiling(area);
  const preferences = [
    ...Object.entries(area.classWeights ?? {}).map(([id, value]) => `${CLASS_LABEL[id as keyof typeof CLASS_LABEL]} bases ×${value}`),
    ...Object.entries(area.currencyWeights ?? {}).map(([id, value]) => `${CURRENCIES[id as keyof typeof CURRENCIES].name} ×${value}`),
  ];
  return (
    <>
      <div class="fe-atlas__intro ui-type-secondary">
        <span>{completed.size}/{ATLAS_AREAS.length} areas completed · shared by your account</span>
        <span class="ui-type-caption">Each boss reveals two neighbours. Any map item works up to the area's tier limit.</span>
      </div>
      <div class="fe-atlas__viewport" aria-label="Atlas areas">
        <div class="fe-atlas__world">
          <svg class="fe-atlas__routes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {ATLAS_AREAS.flatMap((a) => a.neighbours.filter((id) => a.id < id).map((id) => {
              const b = findAtlasArea(id)!;
              return <line key={`${a.id}-${id}`} x1={a.x} y1={y(a.y)} x2={b.x} y2={y(b.y)}
                class={visible.has(a.id) && visible.has(id) ? 'fe-atlas__route--open' : ''} />;
            }))}
          </svg>
          {ATLAS_AREAS.map((a) => {
            const known = visible.has(a.id);
            return <button key={a.id} type="button" disabled={!known} aria-pressed={known && inspected === a.id}
              aria-label={known ? `${a.name}, ${ATLAS_AREA_TYPE_LABELS[a.type]}, up to Tier ${atlasTierCeiling(a)}` : 'Unexplored area'}
              class={cx('fe-atlas__node', known && 'fe-atlas__node--known', completed.has(a.id) && 'fe-atlas__node--complete', inspected === a.id && 'fe-atlas__node--selected')}
              style={{ left: `${a.x}%`, top: `${y(a.y)}%` }} onClick={() => inspect(a.id)}>
              <span class="fe-atlas__name ui-type-secondary">{known ? a.name : 'Unexplored'}</span>
              {known && <span class="ui-type-caption">{completed.has(a.id) ? '✓ ' : ''}{ATLAS_AREA_TYPE_LABELS[a.type]} · T{atlasTierCeiling(a)}</span>}
            </button>;
          })}
        </div>
      </div>
      <div class="fe-atlas__detail">
        <strong class="ui-type-body">{area.name} · maps up to Tier {atlasTierCeiling(area)}</strong>
        <p class="ui-type-secondary">{area.description}</p>
        <p class="ui-type-caption">{MAP_BASES[area.baseId].name} · Boss: {mapBosses(area.baseId).boss.name}</p>
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
