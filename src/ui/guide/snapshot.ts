// Builds the tracker's GuideSnapshot (and the hints' HintSnapshot) from the UI state. The only impure inputs are the shared display
// rules (for "gear that fits a free slot") and the area modal signal, both passed in. Cheap: the gear count is cached per character.
import type { GameRulesApi } from '../../contracts/game';
import { EQUIP_SLOTS } from '../../contracts/content';
import type { CharacterSave } from '../../contracts/items';
import type { UiState } from '../../contracts/ui';
import { ATLAS_START, findAtlasArea } from '../../data/progression/atlas';
import { mapTreeFreePoints } from '../../game/progression/map-tree';
import { safe } from '../items/hooks';
import { visiblePanels } from '../lib/panels';
import { monsterTitle, rosterFor } from '../lib/content';
import type { HintSnapshot } from './hints';
import type { GuideSnapshot } from './steps';
import { countGearToEquip } from './steps';

const gearCache = new WeakMap<CharacterSave, number>();

/** Backpack equipment that can be worn in a currently empty slot. */
export function gearToEquipOf(ch: CharacterSave | null, rules: Pick<GameRulesApi, 'canEquip'>): number {
  if (!ch) return 0;
  const hit = gearCache.get(ch);
  if (hit !== undefined) return hit;
  const free = EQUIP_SLOTS.filter((slot) => !ch.equipment[slot]);
  const gear = ch.backpack.entries.flatMap((e) => (e.item.kind === 'equipment' ? [e.item] : []));
  const n = free.length === 0 ? 0 : countGearToEquip(gear, (item) => free.some((slot) => safe(() => rules.canEquip(ch, item, slot).ok, false)));
  gearCache.set(ch, n);
  return n;
}

/** The area name the first map opens: the loaded map's area, else the starting area. */
export function firstAreaName(ch: CharacterSave | null): string {
  const id = ch?.mapDevice?.areaId ?? ATLAS_START;
  return findAtlasArea(id)?.name ?? 'your first area';
}

/** The boss of the map the player is in, for "Defeat the Cinder Matriarch". */
export function bossTitleOf(s: UiState): string | null {
  const run = s.run;
  if (!run) return s.hud?.run?.boss?.name ?? null;
  return monsterTitle(rosterFor(run.map.baseId).boss);
}

export function selectGuideSnapshot(s: UiState, rules: Pick<GameRulesApi, 'canEquip'>, areaModal: boolean): GuideSnapshot {
  const ch = s.character;
  const guide = ch?.guide;
  const run = s.hud?.run ?? null;
  const portal = s.hud?.portal ?? null;
  const left = visiblePanels(s.openPanels).left;
  const home = s.zone === 'hideout';
  // The gear count only matters once the walk is done and the player is home.
  const needGear = !!guide && home && guide.done.includes('boss');
  return {
    mode: guide?.mode ?? 'skipped',
    done: guide?.done ?? [],
    zone: s.zone,
    ownHideout: s.hud?.zoneIsOwn ?? s.isOwnHideout,
    atlasOpen: left === 'mapDevice',
    areaModal: areaModal && left === 'mapDevice',
    deviceMap: !!ch?.mapDevice,
    portal: portal ? { remaining: portal.remaining, total: portal.total, cleared: portal.cleared, ownerName: portal.ownerName } : null,
    run: run
      ? {
          phase: run.phase, kills: run.kills, wave: run.wave, waveCount: run.waveCount, chest: run.chest ?? null,
          bossName: bossTitleOf(s),
        }
      : null,
    unspent: { attribute: ch?.unspentAttributePoints ?? 0, skill: ch?.unspentSkillPoints ?? 0 },
    gearToEquip: needGear && ch ? gearToEquipOf(ch, rules) : 0,
    area: firstAreaName(ch),
  };
}

export function snapshotEq(a: GuideSnapshot, b: GuideSnapshot): boolean {
  if (a === b) return true;
  const sh = (x: object | null, y: object | null): boolean => {
    if (x === y) return true;
    if (!x || !y) return false;
    const kx = Object.keys(x) as (keyof typeof x)[];
    return kx.every((k) => Object.is(x[k], y[k as keyof typeof y]));
  };
  return a.mode === b.mode && a.done === b.done && a.zone === b.zone && a.ownHideout === b.ownHideout && a.atlasOpen === b.atlasOpen
    && a.areaModal === b.areaModal && a.deviceMap === b.deviceMap && a.gearToEquip === b.gearToEquip && a.area === b.area
    && sh(a.portal, b.portal) && sh(a.run, b.run) && sh(a.unspent, b.unspent);
}

/** The pieces of UiState the hint rules read. `leveledUp`, `seen` and the panel flags come from the caller. */
export function selectHintSnapshot(
  s: UiState, extra: { leveledUp: boolean; seen: HintSnapshot['seen'] },
): HintSnapshot {
  const ch = s.character;
  const hud = s.hud;
  const open = new Set(s.openPanels);
  return {
    zone: s.zone,
    dead: hud?.dead ?? false,
    life: hud?.life ?? 0,
    maxLife: hud?.maxLife ?? 1,
    focus: hud?.focus ?? 0,
    maxFocus: hud?.maxFocus ?? 1,
    needsFocus: !!hud?.slots.some((slot) => slot.skillId && slot.focusCost > 0),
    flasks: (hud?.flasks ?? []).map((f) => (f ? { resource: f.resource, count: f.count } : null)),
    leveledUp: extra.leveledUp,
    unspent: { attribute: ch?.unspentAttributePoints ?? 0, skill: ch?.unspentSkillPoints ?? 0, atlas: s.zone === 'hideout' ? Math.max(0, mapTreeFreePoints(ch?.atlas)) : 0 },
    deaths: ch?.stats.deaths ?? 0,
    debuffs: hud?.debuffs.length ?? 0,
    events: hud?.run?.events.length ?? 0,
    panels: { bench: open.has('craftingBench'), merchant: open.has('merchant'), stash: open.has('stash') },
    itemsCrafted: ch?.stats.itemsCrafted ?? 0,
    mapsCompleted: ch?.stats.mapsCompleted ?? 0,
    seen: extra.seen,
  };
}
