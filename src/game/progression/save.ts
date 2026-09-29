// Persistence (GAME_SPEC §0): a versioned JSON save. parseSave never throws — garbage becomes a fresh
// save, and every character is migrated and normalised field by field: unknown ids are dropped, numbers
// clamped, affix tiers/values repaired, rarities made consistent with their affixes, grid entries that
// overlap or fall outside a container re-placed (backpack, then stash), and duplicate uids re-minted.
// The special stash tabs (GAME_SPEC §12) normalise too: a save from before them gets an empty Crafting
// Stash ({}) and Map Stash ([]); slot counts are clamped to CURRENCY_STASH_MAX, and maps beyond
// MAP_STASH_CAPACITY (or anything in the Map Stash that is not a map) are re-homed like any overflow.
// Re-homing tries the backpack, the item's special tab (a currency's Crafting Stash slot, the Map Stash),
// every stash tab and new "Recovered" tabs up to MAX_STASH_TABS. Only an item that fits none of those is
// lost — which takes a corrupted save holding far more than a character can — and
// normalizeCharacterReport returns such items so the caller can log them.
import type {
  BeltSlot, CharacterSave, CharacterStatsLog, CurrencyStack, EquipmentItem, FlaskStack, GridContainer, Item, MapItem,
  Rarity, RolledAffix, RolledMapMod, RolledScar, SaveGame, Settings, StashTab,
} from '../../contracts/items';
import {
  BACKPACK_SIZE, BELT_SLOTS, CURRENCY_STASH_MAX, MAP_STASH_CAPACITY, MAX_STASH_TABS, MAX_PRESERVED_STASH_TABS, STASH_TAB_SIZE,
} from '../../contracts/items';
import type { CurrencyId, EquipSlot, FlaskId, MapBaseId, SkillId, UniqueId } from '../../contracts/content';
import { CURRENCY_IDS, EQUIP_SLOTS, FLASK_IDS, MAP_BASE_IDS, SKILL_IDS } from '../../contracts/content';
import { createRng, hashString } from '../../core/rng';
import {
  AFFIX_LIMITS, AFFIX_VERSION, BELT_SLOT_CAPACITY, FLASK_STACK, MAX_HISTORY_LINES, MAX_SCARS, STASH_TAB_NAME_MAX, findBase,
  findCurrency, findUnique, getAffix, getScar,
} from '../../data/items';
import type { BaseDef } from '../../data/items';
import { LEGACY_AFFIX_TIERS } from '../../data/items/affixes-v1';
import {
  DEFAULT_SETTINGS, DEFAULT_STASH_TABS, LEVEL_CAP, MAX_DANGER_MODS, MAX_MAP_QUALITY, MAX_REWARD_MODS, MAX_SKILL_RANK,
  SAVE_VERSION, getMapMod,
} from '../../data/progression';
import {
  autoPlace, canPlace, clampItemLevel, createGrid, createStashTab, isReservedUid, placeItem, rollRareName, sortAffixes, uniqueModId,
} from '../items';
import { sanitizeName, xpToNext } from './character';
import { clampTier, rarityForDangerCount, sortMapMods } from './maps';
import { normalizeLoadout } from './skills';
import { clamp, finite, intIn } from './util';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback);

// ---------------------------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------------------------

export function newSave(): SaveGame {
  return { version: SAVE_VERSION, characters: [], lastCharacterId: null, settings: { ...DEFAULT_SETTINGS } };
}

export function serializeSave(save: SaveGame): string {
  return JSON.stringify(save);
}

/** Schema migrations keyed by the version they upgrade from. v0 = unversioned pre-release saves. */
const MIGRATIONS: Record<number, (raw: Json) => Json> = {
  0: (raw) => raw,
};

function migrate(raw: Json): Json {
  let v = intIn(raw.version, 0, SAVE_VERSION, 0);
  let out = raw;
  while (v < SAVE_VERSION) {
    out = (MIGRATIONS[v] ?? ((x: Json) => x))(out);
    v += 1;
  }
  return out;
}

function normalizeSettings(raw: unknown): Settings {
  const r = isObj(raw) ? raw : {};
  const unit = (v: unknown, d: number) => clamp(finite(v, d), 0, 1);
  return {
    masterVolume: unit(r.masterVolume, DEFAULT_SETTINGS.masterVolume),
    musicVolume: unit(r.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: unit(r.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    screenShake: unit(r.screenShake, DEFAULT_SETTINGS.screenShake),
    showFps: typeof r.showFps === 'boolean' ? r.showFps : DEFAULT_SETTINGS.showFps,
    autoAttack: typeof r.autoAttack === 'boolean' ? r.autoAttack : DEFAULT_SETTINGS.autoAttack,
  };
}

/** Normalise any parsed JSON value into a valid SaveGame. */
export function normalizeSave(raw: unknown): SaveGame {
  if (!isObj(raw)) return newSave();
  const data = migrate(raw);
  const characters: CharacterSave[] = [];
  const ids = new Set<string>();
  for (const c of arr(data.characters)) {
    let ch: CharacterSave | null = null;
    try {
      ch = normalizeCharacter(c);
    } catch {
      ch = null;
    }
    if (!ch) continue;
    if (ids.has(ch.id)) {
      let n = 2;
      while (ids.has(`${ch.id}-${n}`)) n++;
      ch = { ...ch, id: `${ch.id}-${n}` };
    }
    ids.add(ch.id);
    characters.push(ch);
  }
  const last = typeof data.lastCharacterId === 'string' && ids.has(data.lastCharacterId) ? data.lastCharacterId : null;
  return { version: SAVE_VERSION, characters, lastCharacterId: last, settings: normalizeSettings(data.settings) };
}

/** Parse + migrate + normalise. Never throws: unreadable input gives a fresh save. */
export function parseSave(json: string | null): SaveGame {
  if (typeof json !== 'string' || !json.trim()) return newSave();
  try {
    return normalizeSave(JSON.parse(json));
  } catch {
    return newSave();
  }
}

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

function affixAllowed(base: BaseDef, affixId: string): boolean {
  const def = getAffix(affixId);
  if (!def || !def.classes.includes(base.itemClass)) return false;
  return !def.requiresProperty || base.properties.some((p) => p.stat === def.requiresProperty);
}

function normalizeHistory(v: unknown): string[] {
  return arr(v).filter((h): h is string => typeof h === 'string').map((h) => h.slice(0, 200)).slice(-MAX_HISTORY_LINES);
}

function normalizeEquipment(raw: Json, uid: string): EquipmentItem | null {
  const base = findBase(str(raw.baseId));
  if (!base) return null;
  const itemLevel = clampItemLevel(finite(raw.itemLevel, 1));
  let rarity = oneOf<Rarity>(raw.rarity, ['normal', 'magic', 'rare', 'unique'], 'normal');
  const implicitValues = base.implicits.map((imp, i) => {
    const lo = Math.min(imp.min, imp.max);
    const hi = Math.max(imp.min, imp.max);
    return clamp(Math.round(finite(arr(raw.implicitValues)[i], lo)), lo, hi);
  });
  const rawAffixes = arr(raw.affixes).filter(isObj);

  const unique = rarity === 'unique' ? findUnique(str(raw.uniqueId)) : undefined;
  if (rarity === 'unique' && (!unique || unique.baseId !== base.id)) rarity = 'normal';
  if (unique && rarity === 'unique') {
    const affixes: RolledAffix[] = unique.mods.map((m, i) => {
      const id = uniqueModId(unique.id, i);
      const found = rawAffixes.find((a) => a.affixId === id);
      const lo = Math.min(m.min, m.max);
      const hi = Math.max(m.min, m.max);
      return { affixId: id, tier: 1, value: clamp(Math.round(finite(found?.value, lo)), lo, hi) };
    });
    return {
      kind: 'equipment', affixVersion: AFFIX_VERSION, uid, baseId: base.id, itemLevel, rarity: 'unique', name: unique.name, uniqueId: unique.id as UniqueId,
      implicitValues, affixes, scars: [], stability: 0, maxStability: 0, history: normalizeHistory(raw.history),
      ...(raw.isNew === true ? { isNew: true } : {}),
    };
  }

  // Craftable item: repair affixes, then make the rarity agree with them.
  const groups = new Set<string>();
  const counts = { prefix: 0, suffix: 0 };
  let sealed = false;
  let fractured = false;
  let crafted = false;
  const affixes: RolledAffix[] = [];
  for (const a of rawAffixes) {
    const id = str(a.affixId);
    const def = getAffix(id);
    if (!def || !affixAllowed(base, id) || groups.has(def.group)) continue;
    if (counts[def.kind] >= AFFIX_LIMITS.rare[def.kind]) continue;
    // Old tier numbers referred to a shorter ladder. Preserve the old unlock level and relative roll,
    // then persist the revision so reconnects/restarts cannot apply the reduction twice.
    let savedTier = a.tier;
    let savedValue = a.value;
    if (finite(raw.affixVersion, 1) < AFFIX_VERSION) {
      const legacy = Object.prototype.hasOwnProperty.call(LEGACY_AFFIX_TIERS, id) ? LEGACY_AFFIX_TIERS[id] : undefined;
      const old = legacy?.find((t) => t[0] === a.tier);
      if (old) {
        const gate = Math.min(itemLevel, old[1]);
        const next = def.tiers.find((t) => t.itemLevel <= gate) ?? def.tiers[def.tiers.length - 1];
        const fraction = old[3] === old[2] ? 0 : clamp((finite(a.value, old[2]) - old[2]) / (old[3] - old[2]), 0, 1);
        savedTier = next.tier;
        savedValue = Math.round(next.min + fraction * (next.max - next.min));
      }
    }
    const tierNo = clamp(Math.floor(finite(savedTier, def.tiers.length)), 1, def.tiers.length);
    const tier = def.tiers.find((t) => t.tier === tierNo) ?? def.tiers[def.tiers.length - 1];
    const rolled: RolledAffix = { affixId: id, tier: tier.tier, value: clamp(Math.round(finite(savedValue, tier.min)), tier.min, tier.max) };
    if (a.fractured === true && !fractured) {
      rolled.fractured = true;
      fractured = true;
    } else if (a.sealed === true && !sealed) {
      rolled.sealed = true;
      sealed = true;
    }
    // At most one bench-crafted affix, never a fractured one (Fracture Core refuses crafted affixes).
    if (a.crafted === true && !crafted && !rolled.fractured) {
      rolled.crafted = true;
      crafted = true;
    }
    groups.add(def.group);
    counts[def.kind] += 1;
    affixes.push(rolled);
  }
  const fitsMagic = counts.prefix <= AFFIX_LIMITS.magic.prefix && counts.suffix <= AFFIX_LIMITS.magic.suffix;
  if (!affixes.length) rarity = 'normal';
  else if (rarity === 'normal' || rarity === 'unique') rarity = fitsMagic ? 'magic' : 'rare';
  else if (rarity === 'magic' && !fitsMagic) rarity = 'rare';

  const scars: RolledScar[] = [];
  for (const s of arr(raw.scars).filter(isObj)) {
    const def = getScar(str(s.scarId));
    if (!def || scars.length >= MAX_SCARS || scars.some((x) => x.scarId === def.id)) continue;
    scars.push({ scarId: def.id, value: clamp(Math.round(finite(s.value, def.min)), def.min, def.max) });
  }
  const maxStability = intIn(raw.maxStability, 0, base.maxStability + 4, base.maxStability);
  const stability = intIn(raw.stability, 0, maxStability, maxStability);
  let name: string | null = null;
  if (rarity === 'rare') {
    const n = str(raw.name).replace(/\s+/g, ' ').trim().slice(0, 40);
    name = n || rollRareName(createRng(hashString(uid || 'item')));
  }
  return {
    kind: 'equipment', affixVersion: AFFIX_VERSION, uid, baseId: base.id, itemLevel, rarity, name, implicitValues, affixes: sortAffixes(affixes), scars,
    stability, maxStability, history: normalizeHistory(raw.history), ...(raw.isNew === true ? { isNew: true } : {}),
  };
}

function normalizeCurrency(raw: Json, uid: string): CurrencyStack | null {
  const id = oneOf<CurrencyId>(raw.currencyId, CURRENCY_IDS, 'scrap');
  if (raw.currencyId !== id) return null;
  const max = findCurrency(id)?.maxStack ?? 40;
  const count = intIn(raw.count, 0, max, 0);
  if (count < 1) return null;
  return { kind: 'currency', uid, currencyId: id, count, ...(raw.isNew === true ? { isNew: true } : {}) };
}

function normalizeFlask(raw: Json, uid: string): FlaskStack | null {
  const id = oneOf<FlaskId>(raw.flaskId, FLASK_IDS, 'lifeFlask');
  if (raw.flaskId !== id) return null;
  const count = intIn(raw.count, 0, FLASK_STACK, 0);
  if (count < 1) return null;
  return { kind: 'flask', uid, flaskId: id, count, ...(raw.isNew === true ? { isNew: true } : {}) };
}

export function normalizeMap(raw: Json, uid: string): MapItem | null {
  const baseId = oneOf<MapBaseId>(raw.baseId, MAP_BASE_IDS, 'ashenForge');
  if (raw.baseId !== baseId) return null;
  const mods: RolledMapMod[] = [];
  let danger = 0;
  let reward = 0;
  let corruptedMods = false;
  for (const m of arr(raw.mods).filter(isObj)) {
    const def = getMapMod(str(m.modId));
    if (!def || mods.some((x) => x.modId === def.id)) continue;
    if (def.kind === 'danger' && danger >= MAX_DANGER_MODS) continue;
    if (def.kind === 'reward' && reward >= MAX_REWARD_MODS) continue;
    if (def.kind === 'danger') danger++;
    if (def.kind === 'reward') reward++;
    const rolled: RolledMapMod = { modId: def.id, value: intIn(m.value, 1, 500, 100) };
    if (m.corrupted === true || def.kind === 'corrupted' || def.kind === 'echo') {
      rolled.corrupted = true;
      if (def.kind !== 'danger') corruptedMods = true;
    }
    mods.push(rolled);
  }
  return {
    kind: 'map',
    uid,
    baseId,
    tier: clampTier(finite(raw.tier, 1)),
    rarity: rarityForDangerCount(danger),
    mods: sortMapMods(mods),
    quality: intIn(raw.quality, 0, MAX_MAP_QUALITY, 0),
    corrupted: raw.corrupted === true || corruptedMods,
    ...(raw.isNew === true ? { isNew: true } : {}),
  };
}

/** Normalise one item (uid handled by the caller). Returns null when it cannot be repaired. */
export function normalizeItem(raw: unknown, uid: string): Item | null {
  if (!isObj(raw)) return null;
  switch (raw.kind) {
    case 'equipment': return normalizeEquipment(raw, uid);
    case 'currency': return normalizeCurrency(raw, uid);
    case 'flask': return normalizeFlask(raw, uid);
    case 'map': return normalizeMap(raw, uid);
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------------------------

const MINTED_UID = /^i([0-9a-z]+)$/;

interface UidMinter {
  used: Set<string>;
  next: number;
  prefix: string;
}

/** Keep a valid unique uid (never a synthetic belt / Crafting Stash / offer uid), otherwise mint a fresh "i…" one. */
function claimUid(m: UidMinter, raw: unknown): string {
  const uid = str(raw);
  if (!isReservedUid(uid) && !m.used.has(uid)) {
    m.used.add(uid);
    return uid;
  }
  let fresh = `${m.prefix}i${m.next.toString(36)}`;
  while (m.used.has(fresh)) fresh = `${m.prefix}i${(++m.next).toString(36)}`;
  m.next += 1;
  m.used.add(fresh);
  return fresh;
}

function highestMinted(raw: Json, prefix: string): number {
  let max = 0;
  const visit = (item: unknown) => {
    if (!isObj(item)) return;
    const uid = str(item.uid);
    const m = MINTED_UID.exec(prefix && uid.startsWith(prefix) ? uid.slice(prefix.length) : uid);
    if (m) max = Math.max(max, parseInt(m[1], 36) + 1);
  };
  const equipment = isObj(raw.equipment) ? raw.equipment : {};
  Object.values(equipment).forEach(visit);
  if (isObj(raw.backpack)) arr(raw.backpack.entries).forEach((e) => isObj(e) && visit(e.item));
  for (const tab of arr(raw.stash)) if (isObj(tab) && isObj(tab.grid)) arr(tab.grid.entries).forEach((e) => isObj(e) && visit(e.item));
  visit(raw.mapDevice);
  arr(raw.mapStash).forEach(visit);
  return max;
}

/** Place grid entries at their saved positions; anything that does not fit goes to `overflow`. */
function normalizeGrid(raw: unknown, w: number, h: number, minter: UidMinter, overflow: Item[]): GridContainer {
  let grid = createGrid(w, h);
  const entries = isObj(raw) ? arr(raw.entries) : [];
  for (const e of entries) {
    if (!isObj(e) || !isObj(e.item)) continue;
    const item = normalizeItem(e.item, claimUid(minter, e.item.uid));
    if (!item) continue;
    const x = Math.floor(finite(e.x, -1));
    const y = Math.floor(finite(e.y, -1));
    const placed = canPlace(grid, item, x, y) ? placeItem(grid, item, x, y) : null;
    if (placed) grid = placed;
    else overflow.push(item);
  }
  return grid;
}

function normalizeStats(raw: unknown): CharacterStatsLog {
  const r = isObj(raw) ? raw : {};
  const n = (v: unknown) => Math.max(0, finite(v, 0));
  const i = (v: unknown) => Math.floor(n(v));
  return {
    mapsCompleted: i(r.mapsCompleted),
    mapsFailed: i(r.mapsFailed),
    highestTierCompleted: i(r.highestTierCompleted),
    kills: i(r.kills),
    deaths: i(r.deaths),
    raresFound: i(r.raresFound),
    uniquesFound: i(r.uniquesFound),
    itemsCrafted: i(r.itemsCrafted),
    playSeconds: n(r.playSeconds),
  };
}

/** Crafting Stash counts: known currencies only, whole numbers clamped to 0..CURRENCY_STASH_MAX; empty slots dropped. */
function normalizeCurrencyStash(raw: unknown): Partial<Record<CurrencyId, number>> {
  const r = isObj(raw) ? raw : {};
  const out: Partial<Record<CurrencyId, number>> = {};
  for (const id of CURRENCY_IDS) {
    if (!Object.prototype.hasOwnProperty.call(r, id)) continue;
    const n = intIn(r[id], 0, CURRENCY_STASH_MAX, 0);
    if (n > 0) out[id] = n;
  }
  return out;
}

function normalizeBelt(raw: unknown): (BeltSlot | null)[] {
  const src = arr(raw);
  const out: (BeltSlot | null)[] = [];
  for (let i = 0; i < BELT_SLOTS; i++) {
    const s = src[i];
    if (isObj(s) && (FLASK_IDS as readonly unknown[]).includes(s.flaskId)) {
      out.push({ flaskId: s.flaskId as FlaskId, count: intIn(s.count, 0, BELT_SLOT_CAPACITY, 0) });
    } else out.push(null);
  }
  return out;
}

/** Normalise one character; null when the value is not a character at all. */
export function normalizeCharacter(raw: unknown): CharacterSave | null {
  return normalizeCharacterReport(raw)?.character ?? null;
}

/** What normalising a character did beyond the character itself. */
export interface NormalizeReport {
  character: CharacterSave;
  /** Items that lost their place and fit nowhere (only a corrupted save can hold that many); empty normally. */
  lost: Item[];
}

/** normalizeCharacter, also returning the items it could not re-home (null when the value is not a character). */
export function normalizeCharacterReport(raw: unknown): NormalizeReport | null {
  if (!isObj(raw)) return null;
  const name = sanitizeName(raw.name);
  const level = intIn(raw.level, 1, LEVEL_CAP, 1);
  const xpMax = level >= LEVEL_CAP ? 0 : xpToNext(level) - 1;
  const idRaw = str(raw.id).trim().slice(0, 64);
  const id = idRaw || `ch-${hashString(`${name}:${finite(raw.createdAt, 0)}`).toString(36)}`;

  const skillRanks = {} as Record<SkillId, number>;
  const rawRanks = isObj(raw.skillRanks) ? raw.skillRanks : {};
  for (const s of SKILL_IDS) skillRanks[s] = intIn(rawRanks[s], 0, MAX_SKILL_RANK, 0);
  skillRanks.emberLance = Math.max(1, skillRanks.emberLance);
  const rawLoadout = (Array.isArray(raw.loadout) ? raw.loadout : ['emberLance'])
    .map((s) => ((SKILL_IDS as readonly unknown[]).includes(s) ? (s as SkillId) : null));
  const allocatedRaw = isObj(raw.allocated) ? raw.allocated : {};

  const prefix = typeof raw.uidNamespace === 'string' && /^[a-z0-9-]{1,36}:$/.test(raw.uidNamespace) ? raw.uidNamespace : '';
  const minter: UidMinter = { used: new Set(), prefix, next: Math.max(intIn(raw.nextUid, 1, 1e9, 1), highestMinted(raw, prefix)) };
  const overflow: Item[] = [];

  const equipment: Partial<Record<EquipSlot, EquipmentItem>> = {};
  const rawEquipment = isObj(raw.equipment) ? raw.equipment : {};
  for (const slot of EQUIP_SLOTS) {
    const r = rawEquipment[slot];
    if (!isObj(r)) continue;
    const item = normalizeItem(r, claimUid(minter, r.uid));
    if (!item) continue;
    if (item.kind === 'equipment' && findBase(item.baseId)?.slots.includes(slot)) equipment[slot] = item;
    else overflow.push(item);
  }

  const backpack = normalizeGrid(raw.backpack, BACKPACK_SIZE.w, BACKPACK_SIZE.h, minter, overflow);
  const stash: StashTab[] = [];
  const stashCapacity = intIn(raw.stashCapacity, MAX_STASH_TABS, MAX_PRESERVED_STASH_TABS, MAX_STASH_TABS);
  for (const t of arr(raw.stash).slice(0, stashCapacity)) {
    if (!isObj(t)) continue;
    const tabName = str(t.name).replace(/\s+/g, ' ').trim().slice(0, STASH_TAB_NAME_MAX) || `Tab ${stash.length + 1}`;
    stash.push({ name: tabName, grid: normalizeGrid(t.grid, STASH_TAB_SIZE.w, STASH_TAB_SIZE.h, minter, overflow) });
  }
  if (!stash.length) for (const n of DEFAULT_STASH_TABS) stash.push(createStashTab(n));

  let mapDevice: MapItem | null = null;
  if (isObj(raw.mapDevice)) {
    const item = normalizeItem(raw.mapDevice, claimUid(minter, raw.mapDevice.uid));
    if (item?.kind === 'map') mapDevice = item;
    else if (item) overflow.push(item);
  }

  const mapStash: MapItem[] = [];
  for (const r of arr(raw.mapStash)) {
    if (!isObj(r)) continue;
    const item = normalizeItem(r, claimUid(minter, r.uid));
    if (item?.kind === 'map' && mapStash.length < MAP_STASH_CAPACITY) mapStash.push(item);
    else if (item) overflow.push(item);
  }

  // Re-home everything that lost its place: the backpack, then its special tab (a currency's Crafting Stash
  // slot, as far as it has room; the Map Stash), then the stash tabs, then new recovery tabs.
  const currencyStash = normalizeCurrencyStash(raw.currencyStash);
  let bp = backpack;
  const lost: Item[] = [];
  const intoStashTabs = (item: Item): boolean => {
    for (let t = 0; t < stash.length; t++) {
      const g = autoPlace(stash[t].grid, item);
      if (g) {
        stash[t] = { ...stash[t], grid: g };
        return true;
      }
    }
    return false;
  };
  for (const item of overflow) {
    const intoBackpack = autoPlace(bp, item);
    if (intoBackpack) {
      bp = intoBackpack;
      continue;
    }
    let rest: Item = item;
    if (rest.kind === 'map' && mapStash.length < MAP_STASH_CAPACITY) {
      mapStash.push(rest);
      continue;
    }
    if (rest.kind === 'currency') {
      const have = currencyStash[rest.currencyId] ?? 0;
      const n = Math.min(rest.count, CURRENCY_STASH_MAX - have);
      if (n > 0) currencyStash[rest.currencyId] = have + n;
      if (n >= rest.count) continue;
      rest = { ...rest, count: rest.count - n };
    }
    if (intoStashTabs(rest)) continue;
    if (stash.length < stashCapacity) {
      const tab = createStashTab('Recovered');
      const g = autoPlace(tab.grid, rest);
      if (g) {
        stash.push({ ...tab, grid: g });
        continue;
      }
    }
    lost.push(rest);
  }

  const character: CharacterSave = {
    id,
    name,
    classId: 'sorceress',
    level,
    xp: clamp(finite(raw.xp, 0), 0, xpMax),
    unspentAttributePoints: intIn(raw.unspentAttributePoints, 0, 1e6, 0),
    allocated: {
      str: intIn(allocatedRaw.str, 0, 1e6, 0),
      dex: intIn(allocatedRaw.dex, 0, 1e6, 0),
      int: intIn(allocatedRaw.int, 0, 1e6, 0),
    },
    unspentSkillPoints: intIn(raw.unspentSkillPoints, 0, 1e6, 0),
    skillRanks,
    loadout: normalizeLoadout({ skillRanks, loadout: rawLoadout }),
    equipment,
    backpack: bp,
    stash,
    ...(stashCapacity > MAX_STASH_TABS ? { stashCapacity } : {}),
    currencyStash,
    mapStash,
    belt: normalizeBelt(raw.belt),
    mapDevice,
    rngState: typeof raw.rngState === 'number' && Number.isFinite(raw.rngState) ? raw.rngState >>> 0 : hashString(id),
    nextUid: minter.next,
    ...(prefix ? { uidNamespace: prefix } : {}),
    stats: normalizeStats(raw.stats),
    createdAt: Math.max(0, finite(raw.createdAt, 0)),
    updatedAt: Math.max(0, finite(raw.updatedAt, 0)),
  };
  return { character, lost };
}
