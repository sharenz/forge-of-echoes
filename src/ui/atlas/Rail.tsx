// The inspector rail (brief A, 6.6): hero band with the boss sprite standing on the theme's floor, facts, the
// monster family, what the area pays, what can happen there and entry requirements. A map is bound to its area, so there
// is no course to set: the foot says where the slotted map lives (or that the chart is browse-only).
import { useMotion } from './motion';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { MapItem } from '../../contracts/items';
import type { SpriteDef } from '../../contracts/art';
import { THEME_ROSTER } from '../../contracts/bestiary';
import { MAP_EVENT_KINDS } from '../../contracts/map-events';
import { CLASS_LABEL, CURRENCIES } from '../../data/items';
import { MAP_BASES } from '../../data/progression/maps';
import { MAP_EVENT_NAMES } from '../../data/progression/map-events';
import { ATLAS_AREA_TYPE_LABELS, type AtlasAreaDef } from '../../data/progression/atlas';
import { keystoneRewards } from '../../game/progression/keystones';
import { mapBaseImplicitText, mapBosses } from '../../game/progression/maps';
import { territoryEntryFee } from '../../game/progression/atlas';
import { emblemUrl, plateUrl, spriteInfo, spriteUrl } from '../../art/atlas/sprites';
import { MATERIAL_LABEL, THEMES } from '../../art/atlas/geometry';
import { Button, PixelIcon, cx } from '../components/common';
import { MONSTER_NAMES } from '../lib/content';
import { useAtlasSprites } from './sprites';
import type { NodeModel } from './model';
import { typeLabel } from './model';
import type { RoutingReadout } from '../../game/progression/map-routing';
import { SourcesPanel } from './SourcesPanel';
import { SurgeRail } from './SurgePips';
import type { AtlasAreaId } from '../../contracts/atlas';

/** Cycles a sprite's frames at its own fps as data URLs; static when reduced motion is preferred. */
function useSpriteFrames(sprites: SpriteDef[] | null, id: string, scale: number, motion: boolean): string {
  const info = useMemo(() => (sprites ? spriteInfo(sprites, id) : null), [sprites, id]);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(0);
    if (!info || info.frames < 2 || !motion) return;
    const h = setInterval(() => setFrame((f) => (f + 1) % info.frames), 1000 / Math.max(2, Math.min(8, info.fps || 4)));
    return () => clearInterval(h);
  }, [info, motion]);
  return sprites ? spriteUrl(sprites, id, frame, scale) : '';
}

function fitScale(w: number, h: number, box: number): number {
  return Math.max(1, Math.floor(box / Math.max(w, h)));
}

function Portrait({ sprites, id, box, motion, label }: { sprites: SpriteDef[] | null; id: string; box: number; motion: boolean; label: string }) {
  const info = sprites ? spriteInfo(sprites, id) : null;
  const scale = info ? fitScale(info.width, info.height, box) : 1;
  const url = useSpriteFrames(sprites, id, scale, motion);
  if (!info || !url) return <span class="fe-rail__mob fe-rail__mob--missing" style={{ width: box, height: box }} aria-label={label} />;
  return <img class="fe-px fe-rail__mob" src={url} alt="" title={label} aria-label={label} draggable={false} style={{ width: info.width * scale, height: info.height * scale }} />;
}

/** What the rail shows about pins: the state, the slots and the toggle (brief D 5.1). */
export interface RailPin {
  pinned: boolean;
  /** Pins in use and slots available. */
  used: number;
  slots: number;
  /** Why the toggle is disabled (a full tray, a passage area), or null. */
  blocked: string | null;
  multiplier: number;
  onToggle: () => void;
}

export function AtlasRail({ area, model, tier, map, odds, homeName, blocked, onGoHome, motion: motionProp, compact, onClose, pin, held, sources, onFocus }: {
  area: AtlasAreaDef;
  model: NodeModel;
  tier: number | null;
  /** The slotted map when it is run in THIS area (fee, encounter odds); null when another area is inspected or the slot is empty. */
  map: MapItem | null;
  odds: Record<string, number> | null;
  /** The area the slotted map opens, when there is one. */
  homeName: string | null;
  blocked: string | null;
  /** Bring the chart back to the slotted map's area. */
  onGoHome: () => void;
  motion: boolean;
  compact: boolean;
  onClose: () => void;
  pin?: RailPin;
  /** Maps of this area you hold (backpack, stash, Map Stash). */
  held?: number;
  /** The slotted map's drop table, shown when this is the area it opens (brief D 3 "Sources"). */
  sources?: RoutingReadout | null;
  onFocus?: (id: AtlasAreaId) => void;
}) {
  const sprites = useAtlasSprites();
  const { calm } = useMotion();
  const motion = motionProp && !calm;
  const theme = THEMES[area.baseId];
  const base = MAP_BASES[area.baseId];
  const bosses = mapBosses(area.baseId);
  const roster = (THEME_ROSTER as Record<string, { family: readonly string[] }>)[area.baseId];
  const keystone = keystoneRewards(area.id, tier);
  const floor = sprites ? spriteUrl(sprites, `tile/${area.baseId}/floor`, 1, 2) : '';
  const bossId = area.noBoss ? null : `monster/${bosses.boss.kind}/idle`;
  const preferences = [
    ...Object.entries(area.classWeights ?? {}).map(([id, value]) => ({ key: `c-${id}`, icon: null as string | null, text: `${CLASS_LABEL[id as keyof typeof CLASS_LABEL]} bases ×${value}` })),
    ...Object.entries(area.currencyWeights ?? {}).map(([id, value]) => ({ key: `w-${id}`, icon: `icon/currency/${id}`, text: `${CURRENCIES[id as keyof typeof CURRENCIES].name} ×${value}` })),
  ];
  const fee = map ? territoryEntryFee(map.tier, area.id) : null;
  const active = odds ? MAP_EVENT_KINDS.filter((k) => (odds[k] ?? 0) > 0) : [];
  const key = area.entranceKey ? CURRENCIES[area.entranceKey] : null;
  return (
    <aside class={cx('fe-rail', compact && 'fe-rail--compact')} aria-label={`${area.name} details`} data-rail>
      <div class="fe-rail__hero" style={{ backgroundImage: floor ? `url(${floor})` : undefined, ['--glow' as string]: theme.glow }}>
        <div class="fe-rail__pool" aria-hidden="true" />
        <div class="fe-rail__stage" aria-hidden="true">
          {bossId ? <Portrait sprites={sprites} id={bossId} box={84} motion={motion} label={bosses.boss.name} /> : <>
            <Portrait sprites={sprites} id="prop/banner" box={60} motion={motion} label="Banner" />
            <Portrait sprites={sprites} id="prop/brazier" box={60} motion={motion} label="Brazier" />
          </>}
        </div>
        <div class="fe-rail__title">
          <span class="fe-rail__kicker ui-type-caption">{model.status}</span>
          <h3 class="fe-rail__name">{area.name}</h3>
          <SurgeRail areaId={area.id} />
        </div>
        {pin && (
          <button type="button" class={cx('fe-rail__pin fe-btn fe-btn--icon fe-btn--ghost', pin.pinned && 'fe-rail__pin--on')} aria-pressed={pin.pinned} data-pin-toggle={area.id}
            disabled={!pin.pinned && !!pin.blocked} aria-label={pin.pinned ? `Unpin ${area.name}` : `Pin ${area.name}`} title={pin.pinned ? `Unpin ${area.name}` : pin.blocked ?? `Pin ${area.name}: its maps drop x${pin.multiplier} as often`} onClick={pin.onToggle}>
            <i class="fe-pinglyph" aria-hidden="true" />
          </button>
        )}
        {compact && <button class="fe-rail__close fe-btn fe-btn--icon fe-btn--ghost" aria-label="Close inspector" onClick={onClose}><span class="fe-x" /></button>}
      </div>
      <div class="fe-rail__scroll">
        <div class="fe-rail__facts">
          <span class="fe-chip"><img class="fe-px" src={plateUrl(model.material, model.rivets, area.baseId, 42)} alt="" width={28} height={28} /><span class="ui-type-secondary">{MATERIAL_LABEL[model.material]} · T1–{model.ceiling}</span></span>
          <span class="fe-chip"><img class="fe-px" src={emblemUrl(area.baseId, 24)} alt="" width={24} height={24} /><span class="ui-type-secondary">{base.name}</span></span>
          <span class="fe-chip"><span class="ui-type-secondary">{area.sealed ? 'Sealed area' : ATLAS_AREA_TYPE_LABELS[area.type]} · Depth {area.depth}</span></span>
        </div>
        <p class="fe-rail__desc ui-type-secondary">{area.description}</p>
        <section class="fe-rail__sec" aria-label="Fights">
          <h4 class="fe-rail__h ui-type-caption">Fights</h4>
          <div class="fe-rail__family">
            {(roster?.family ?? []).map((kind) => <Portrait sprites={sprites} key={kind} id={`monster/${kind}/idle`} box={40} motion={motion} label={MONSTER_NAMES[kind as keyof typeof MONSTER_NAMES]?.one ?? kind} />)}
          </div>
          <p class="ui-type-caption fe-rail__mute">{area.noBoss ? 'No final boss.' : `Lieutenant ${bosses.lieutenant.name} · Boss ${bosses.boss.name}${keystone ? ' (keystone)' : ''}.`}</p>
        </section>
        <section class="fe-rail__sec" aria-label="What it pays">
          <h4 class="fe-rail__h ui-type-caption">What it pays</h4>
          <div class="fe-rail__chips">
            {preferences.length === 0 && <span class="ui-type-secondary fe-rail__mute">No special weighting.</span>}
            {preferences.map((p) => <span key={p.key} class="fe-chip">{p.icon && <PixelIcon id={p.icon} width={24} height={24} />}<span class="ui-type-secondary">{p.text}</span></span>)}
            {area.ingredientDrops?.map((d) => <span key={d.currencyId} class="fe-chip fe-chip--rare" title={`${d.chance * 100}% on Tier ${d.minTier}+ maps`}><PixelIcon id={`icon/currency/${d.currencyId}`} width={24} height={24} /><span class="ui-type-secondary">{CURRENCIES[d.currencyId].name} · {Math.round(d.chance * 100)}%</span></span>)}
            {keystone && keystone.pool.map((i) => <span key={i.name} class="fe-chip fe-chip--unique"><span class="ui-type-secondary">{i.name} · T{i.minTier}+</span></span>)}
          </div>
          <p class="ui-type-caption fe-rail__mute">{mapBaseImplicitText(area.baseId)}{keystone ? ' Keystone uniques have a separate 12% base chance per boss, multiplied by your item rarity.' : ''}</p>
        </section>
        {(pin || held !== undefined) && (
          <section class="fe-rail__sec" aria-label="Your maps">
            <h4 class="fe-rail__h ui-type-caption">Your maps</h4>
            <p class="ui-type-secondary fe-rail__mute" data-rail-held>{held ? `You hold ${held} map${held === 1 ? '' : 's'} of this area.` : 'You hold no maps of this area.'}</p>
            {pin && (
              <div class="fe-rail__pinrow">
                <Button size="small" class={cx(pin.pinned && 'fe-btn--on')} disabled={!pin.pinned && !!pin.blocked} onClick={pin.onToggle}>{pin.pinned ? 'Unpin' : `Pin ${area.name}`}</Button>
                <span class="ui-type-caption fe-rail__mute">{pin.blocked && !pin.pinned ? pin.blocked : `${pin.used}/${pin.slots} pins · its maps drop x${pin.multiplier} as often`}</span>
              </div>
            )}
          </section>
        )}
        {sources && <SourcesPanel readout={sources} onFocus={onFocus} />}
        <section class="fe-rail__sec" aria-label="What can happen here">
          <h4 class="fe-rail__h ui-type-caption">What can happen here</h4>
          {area.encounters ? <div class="fe-rail__chips">{area.encounters.map((e, i) => <span key={i} class="fe-chip fe-chip--event"><span class="ui-type-secondary">{MAP_EVENT_NAMES[e.kind]} · wave {e.wave}</span></span>)}</div>
            : map && odds ? <div class="fe-rail__chips">{active.length ? active.map((k) => <span key={k} class="fe-chip fe-chip--event"><span class="ui-type-secondary">{MAP_EVENT_NAMES[k]} {Math.round(odds[k]! * 1000) / 10}%</span></span>) : <span class="ui-type-secondary fe-rail__mute">Nothing at this tier.</span>}</div>
            : <p class="ui-type-secondary fe-rail__mute">Encounter odds show for the area your slotted map opens.{area.eventMultiplier ? ` Chances here are ×${area.eventMultiplier}.` : ''}</p>}
        </section>
        {(key || area.requiresBounty || fee !== null) && <section class="fe-rail__sec" aria-label="Entry">
          <h4 class="fe-rail__h ui-type-caption">Entry</h4>
          <div class="fe-rail__chips">
            {key && <span class="fe-chip"><PixelIcon id={`icon/currency/${area.entranceKey}`} width={24} height={24} /><span class="ui-type-secondary">One {key.name}</span></span>}
            {area.requiresBounty && <span class="fe-chip"><span class="ui-type-secondary">Bounty map required</span></span>}
            {fee !== null && <span class="fe-chip"><PixelIcon id="icon/currency/scrap" width={24} height={24} /><span class="ui-type-secondary">Territory fee {fee} Scrap</span></span>}
          </div>
          {key && <p class="ui-type-caption fe-rail__mute">{key.description}</p>}
        </section>}
      </div>
      <div class="fe-rail__foot">
        {blocked && <p class="fe-atlas__error ui-type-secondary" role="status">{blocked}</p>}
        {model.home
          ? <p class="fe-rail__mute fe-rail__hint ui-type-secondary">Your slotted map opens here.</p>
          : homeName
            ? <Button class="fe-rail__course" data-show-home onClick={onGoHome} title="Bring the chart back to the area your map opens (G)">Show {homeName}</Button>
            : <p class="fe-rail__mute fe-rail__hint ui-type-caption">Browsing. Drag a map from your inventory into the dock: it opens the area it is bound to.</p>}
      </div>
    </aside>
  );
}

export { typeLabel };
export type { NodeModel };
