// What the area modal says about the AREA itself (the old inspector rail's content, merged into the modal): the hero band with the boss and
// the monster family standing on the theme's floor, the key facts, what the area pays, what can happen there and what entering costs.
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
import { PixelIcon, cx } from '../components/common';
import { MONSTER_NAMES } from '../lib/content';
import { useAtlasSprites } from './sprites';
import { useMotion } from './motion';
import type { NodeModel } from './model';
import { AreaSurgePips } from './SurgePips';

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

const fitScale = (w: number, h: number, box: number): number => Math.max(1, Math.floor(box / Math.max(w, h)));

export function Portrait({ sprites, id, box, motion, label }: { sprites: SpriteDef[] | null; id: string; box: number; motion: boolean; label: string }) {
  const info = sprites ? spriteInfo(sprites, id) : null;
  const scale = info ? fitScale(info.width, info.height, box) : 1;
  const url = useSpriteFrames(sprites, id, scale, motion);
  if (!info || !url) return <span class="fe-amodal__mob fe-amodal__mob--missing" style={{ width: box, height: box }} aria-label={label} />;
  return <img class="fe-px fe-amodal__mob" src={url} alt="" title={label} aria-label={label} draggable={false} style={{ width: info.width * scale, height: info.height * scale }} />;
}

/** What the header shows about pins: the state, the slots and the toggle (brief D 5.1). */
export interface AreaPin {
  pinned: boolean;
  /** Pins in use and slots available. */
  used: number;
  slots: number;
  /** Why the toggle is disabled (a full tray, a passage area), or null. */
  blocked: string | null;
  multiplier: number;
  onToggle: () => void;
}

/** The hero band: the theme's floor with a glow, the boss and the monster family standing on it, the name, the status and the pin. */
export function AreaHero({ area, model, pin, headingId, onClose }: {
  area: AtlasAreaDef; model: NodeModel; pin: AreaPin; headingId: string; onClose: () => void;
}) {
  const sprites = useAtlasSprites();
  const { calm } = useMotion();
  // `calm` already follows the OS on "system"; a viewer who picked "full" gets the motion they asked for.
  const motion = !calm;
  const theme = THEMES[area.baseId];
  const bosses = mapBosses(area.baseId);
  const roster = (THEME_ROSTER as Record<string, { family: readonly string[] }>)[area.baseId];
  const floor = sprites ? spriteUrl(sprites, `tile/${area.baseId}/floor`, 1, 2) : '';
  const bossId = area.noBoss ? null : `monster/${bosses.boss.kind}/idle`;
  return (
    <header class="fe-amodal__hero" style={{ backgroundImage: floor ? `url(${floor})` : undefined, ['--glow' as string]: theme.glow }}>
      <div class="fe-amodal__pool" aria-hidden="true" />
      <div class="fe-amodal__stage" aria-hidden="true">
        {(roster?.family ?? []).slice(0, 4).map((kind) => <Portrait sprites={sprites} key={kind} id={`monster/${kind}/idle`} box={36} motion={motion} label={MONSTER_NAMES[kind as keyof typeof MONSTER_NAMES]?.one ?? kind} />)}
        {bossId
          ? <Portrait sprites={sprites} id={bossId} box={80} motion={motion} label={bosses.boss.name} />
          : <><Portrait sprites={sprites} id="prop/banner" box={56} motion={motion} label="Banner" /><Portrait sprites={sprites} id="prop/brazier" box={56} motion={motion} label="Brazier" /></>}
      </div>
      <div class="fe-amodal__title">
        <img class="fe-px fe-amodal__plate" src={plateUrl(model.material, model.rivets, area.baseId, 42)} alt="" width={40} height={40} />
        <div class="fe-amodal__titletext">
          <span class="fe-amodal__kicker ui-type-caption">{model.status}</span>
          <h2 class="fe-amodal__name" id={headingId} data-area-name>{area.name}</h2>
          <span class="fe-amodal__sub ui-type-caption">
            {area.sealed ? 'Sealed area' : ATLAS_AREA_TYPE_LABELS[area.type]} · Maps up to Tier {model.ceiling}
            <AreaSurgePips areaId={area.id} class="fe-amodal__pips" />
          </span>
        </div>
      </div>
      <div class="fe-amodal__heroacts">
        {!area.sealed && (
          <button type="button" class={cx('fe-amodal__pin fe-btn fe-btn--icon fe-btn--ghost', pin.pinned && 'fe-amodal__pin--on')} aria-pressed={pin.pinned} data-pin-toggle={area.id}
            disabled={!pin.pinned && !!pin.blocked} aria-label={pin.pinned ? `Unpin ${area.name}` : `Pin ${area.name}`}
            title={pin.pinned ? `Unpin ${area.name}` : pin.blocked ?? `Pin ${area.name}: its maps drop x${pin.multiplier} as often (${pin.used}/${pin.slots} pins used)`} onClick={pin.onToggle}>
            <i class="fe-pinglyph" aria-hidden="true" />
          </button>
        )}
        <button type="button" class="fe-amodal__close fe-btn fe-btn--icon fe-btn--ghost" aria-label="Close" title="Close (Esc)" data-modal-close onClick={onClose}><span class="fe-x" /></button>
      </div>
    </header>
  );
}

/** The facts strip: material and ceiling, the theme, the type and depth. */
export function AreaFacts({ area, model }: { area: AtlasAreaDef; model: NodeModel }) {
  const base = MAP_BASES[area.baseId];
  return (
    <div class="fe-amodal__facts">
      <span class="fe-chip"><img class="fe-px" src={plateUrl(model.material, model.rivets, area.baseId, 42)} alt="" width={24} height={24} /><span class="ui-type-secondary">{MATERIAL_LABEL[model.material]} · T1–{model.ceiling}</span></span>
      <span class="fe-chip"><img class="fe-px" src={emblemUrl(area.baseId, 24)} alt="" width={24} height={24} /><span class="ui-type-secondary">{base.name}</span></span>
      <span class="fe-chip"><span class="ui-type-secondary">{area.sealed ? 'Sealed area' : ATLAS_AREA_TYPE_LABELS[area.type]} · Depth {area.depth}</span></span>
    </div>
  );
}

/** The sections about the area: fights, what it pays, what can happen, entry. `map` is the loaded map when it runs HERE (fee, encounter odds). */
export function AreaDetails({ area, tier, map, odds }: { area: AtlasAreaDef; tier: number | null; map: MapItem | null; odds: Record<string, number> | null }) {
  const bosses = mapBosses(area.baseId);
  const keystone = keystoneRewards(area.id, tier);
  const preferences = [
    ...Object.entries(area.classWeights ?? {}).map(([id, value]) => ({ key: `c-${id}`, icon: null as string | null, text: `${CLASS_LABEL[id as keyof typeof CLASS_LABEL]} bases ×${value}` })),
    ...Object.entries(area.currencyWeights ?? {}).map(([id, value]) => ({ key: `w-${id}`, icon: `icon/currency/${id}`, text: `${CURRENCIES[id as keyof typeof CURRENCIES].name} ×${value}` })),
  ];
  const fee = map ? territoryEntryFee(map.tier, area.id) : null;
  const active = odds ? MAP_EVENT_KINDS.filter((k) => (odds[k] ?? 0) > 0) : [];
  const key = area.entranceKey ? CURRENCIES[area.entranceKey] : null;
  return (
    <div class="fe-amodal__about">
      <p class="fe-amodal__desc ui-type-secondary">{area.description}</p>
      <section class="fe-amodal__sec" aria-label="Fights">
        <h4 class="fe-amodal__h ui-type-caption">Fights</h4>
        <p class="ui-type-secondary fe-amodal__mute">{area.noBoss ? 'No final boss.' : `Lieutenant ${bosses.lieutenant.name} · Boss ${bosses.boss.name}${keystone ? ' (keystone)' : ''}.`}</p>
      </section>
      <section class="fe-amodal__sec" aria-label="What it pays">
        <h4 class="fe-amodal__h ui-type-caption">What it pays</h4>
        <div class="fe-amodal__chips">
          {preferences.length === 0 && <span class="ui-type-secondary fe-amodal__mute">No special weighting.</span>}
          {preferences.map((p) => <span key={p.key} class="fe-chip">{p.icon && <PixelIcon id={p.icon} width={24} height={24} />}<span class="ui-type-secondary">{p.text}</span></span>)}
          {area.ingredientDrops?.map((d) => <span key={d.currencyId} class="fe-chip fe-chip--rare" title={`${d.chance * 100}% on Tier ${d.minTier}+ maps`}><PixelIcon id={`icon/currency/${d.currencyId}`} width={24} height={24} /><span class="ui-type-secondary">{CURRENCIES[d.currencyId].name} · {Math.round(d.chance * 100)}%</span></span>)}
          {keystone && keystone.pool.map((i) => <span key={i.name} class="fe-chip fe-chip--unique"><span class="ui-type-secondary">{i.name} · T{i.minTier}+</span></span>)}
        </div>
        <p class="ui-type-caption fe-amodal__mute">{mapBaseImplicitText(area.baseId)}{keystone ? ' Keystone uniques have a separate 12% base chance per boss, multiplied by your item rarity.' : ''}</p>
      </section>
      <section class="fe-amodal__sec" aria-label="What can happen here">
        <h4 class="fe-amodal__h ui-type-caption">What can happen here</h4>
        {area.encounters ? <div class="fe-amodal__chips">{area.encounters.map((e, i) => <span key={i} class="fe-chip fe-chip--event"><span class="ui-type-secondary">{MAP_EVENT_NAMES[e.kind]} · wave {e.wave}</span></span>)}</div>
          : odds ? <div class="fe-amodal__chips">{active.length ? active.map((k) => <span key={k} class="fe-chip fe-chip--event"><span class="ui-type-secondary">{MAP_EVENT_NAMES[k]} {Math.round(odds[k]! * 1000) / 10}%</span></span>) : <span class="ui-type-secondary fe-amodal__mute">Nothing at this tier.</span>}</div>
          : <p class="ui-type-secondary fe-amodal__mute">Encounter odds show once a map is loaded.{area.eventMultiplier ? ` Chances here are ×${area.eventMultiplier}.` : ''}</p>}
      </section>
      {(key || area.requiresBounty || fee !== null) && (
        <section class="fe-amodal__sec" aria-label="Entry">
          <h4 class="fe-amodal__h ui-type-caption">Entry</h4>
          <div class="fe-amodal__chips">
            {key && <span class="fe-chip"><PixelIcon id={`icon/currency/${area.entranceKey}`} width={24} height={24} /><span class="ui-type-secondary">One {key.name}</span></span>}
            {area.requiresBounty && <span class="fe-chip"><span class="ui-type-secondary">Bounty map required</span></span>}
            {fee !== null && <span class="fe-chip"><PixelIcon id="icon/currency/scrap" width={24} height={24} /><span class="ui-type-secondary">Territory fee {fee} Scrap</span></span>}
          </div>
          {key && <p class="ui-type-caption fe-amodal__mute">{key.description}</p>}
        </section>
      )}
    </div>
  );
}
