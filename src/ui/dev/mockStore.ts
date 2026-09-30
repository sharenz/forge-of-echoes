// A realistic in-browser UiStore for dev/ui.html: the REAL rules (src/game) and art (src/art) with a mocked
// server. Item moves, crafting, the crafting bench, merchant, skills and attributes run through the shared rules
// exactly as the server would; party, chat, zones, trading (a scripted partner, Mira) and the HUD are simulated
// (HUD values animate at ~15 Hz). Like the server, the rules are wrapped with the trade locks (withItemLocks): items
// in your trade offer cannot be moved, merged into, crafted, spent or dropped; the swap itself uses the plain rules.
// Dev-only: presentation code, so Math.random / Date.now are fine here.
import type { ArtBundle } from '../../contracts/art';
import { PLAYER_DEBUFFS, THEME_ROSTER, type PlayerDebuff } from '../../contracts/bestiary';
import type { CurrencyId, EquipSlot, MapBaseId, MonsterKind } from '../../contracts/content';
import type { GameRulesApi, RunSetup } from '../../contracts/game';
import type { CharacterSave, EquipmentItem, GridContainer, Item, ItemTone, MapItem, Settings, SpecialStashTab } from '../../contracts/items';
import { BACKPACK_SIZE, LOADOUT_KEYS, STASH_TAB_SIZE } from '../../contracts/items';
import type { PartyInfo, PortalInfo, RunSummaryInfo, TradeInfo } from '../../contracts/net';
import { PORTALS_PER_MAP, TRADE_ACCEPT_LOCK_MS, TRADE_MAX_ITEMS } from '../../contracts/net';
import type { ChatLine, HudAlly, HudRun, HudSlot, HudState, Panel, Screen, Toast, UiActions, UiState, UiStore } from '../../contracts/ui';
import { createRng } from '../../core/rng';
import { deriveRunStats, rules as gameRules, withItemLocks } from '../../game';
import { currencyStack, flaskStack, generateEquipment, generateUnique, placeItem } from '../../game/items';
import { rollMapWithRarity } from '../../game/progression';
import { MONSTER_NAMES } from '../lib/content';
import { parseCurrencyStashUid } from '../lib/stash';

export interface MockOptions {
  screen?: Screen;
  panels?: Panel[];
  zone?: 'hideout' | 'map' | 'visit' | 'partymap';
  boss?: boolean;
  lieutenant?: boolean;
  tell?: boolean;
  cleared?: boolean;
  dead?: boolean;
  summary?: RunSummaryInfo['result'] | null;
  alt?: boolean;
  /** Arm a backpack currency stack by currency id, or a Crafting Stash slot as `cstash:<id>`. */
  armed?: string | null;
  affix?: CurrencyId | null;
  party?: boolean;
  /** You lead the party (shows kick / promote and the invite field). */
  leader?: boolean;
  invite?: boolean;
  chat?: boolean;
  chatOpen?: boolean;
  elite?: 'magic' | 'rare' | null;
  toasts?: boolean;
  levelUp?: boolean;
  error?: string | null;
  fatal?: boolean;
  busy?: boolean;
  portal?: boolean;
  noCharacters?: boolean;
  /** Freeze HUD animation (stable screenshots). */
  still?: boolean;
  /** Put an item on the crafting bench: the rare wand, or ('crafted') the circlet with a bench-crafted affix. */
  bench?: boolean | 'crafted';
  /**
   * A trade with Mira in progress: true = she accepted, 'locked' = an offer just changed (accept countdown),
   * 'waiting' = you accepted and wait for her.
   */
  trade?: boolean | 'locked' | 'waiting';
  /** An incoming trade request from Corvin. */
  tradeRequest?: boolean;
  /** Open the stash on this tab (a normal tab index or a special tab). */
  stash?: number | SpecialStashTab | null;
  /** false = the Map Stash and the Crafting Stash start empty. */
  specialStash?: boolean;
  /** The map device starts empty (its map is filed in the Map Stash): the device panel opens on its picker. */
  emptyDevice?: boolean;
  /** Active player debuffs on the HUD: true = a showcase set, or a list of ids. */
  debuffs?: boolean | PlayerDebuff[];
  /** Map theme of the run (zone=map): its tiles, roster, lieutenant and boss. */
  theme?: MapBaseId;
}

export interface MockStore extends UiStore {
  /** Patch state directly (dev console helpers). */
  patch(p: Partial<UiState>): void;
  dispose(): void;
}

const ME = { id: 'ch-ashveil', name: 'Ashveil' };
const MIRA = { id: 'ch-mira', name: 'Mira' };
const CORVIN = { id: 'ch-corvin', name: 'Corvin' };
const SABLE = { id: 'ch-sable', name: 'Sable' };

/** The contract's lootLuck while src/game is still being adapted: map-side luck plus the looter's gear. */
function withLootLuck(r: GameRulesApi): GameRulesApi {
  if (typeof (r as Partial<GameRulesApi>).lootLuck === 'function') return r;
  return {
    ...r,
    lootLuck(setup: RunSetup, looter: CharacterSave) {
      const d = r.deriveStats(looter);
      return { itemQuantity: setup.itemQuantity + d.itemQuantity, itemRarity: setup.itemRarity + d.itemRarity };
    },
  };
}

function uidMaker(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function place(grid: GridContainer, item: Item, x: number, y: number): GridContainer {
  const next = placeItem(grid, item, x, y);
  if (!next) throw new Error(`mock: cannot place ${item.uid} at ${x},${y}`);
  return next;
}

function emptyGrid(w: number, h: number): GridContainer {
  return { w, h, entries: [] };
}

/** Crafting Stash showcase: Forge Scrap full, a few ghosted (empty) slots, some map currency. */
const STASHED_CURRENCY: Partial<Record<CurrencyId, number>> = {
  kindling: 184,
  scrap: 5000,
  reforge: 46,
  essenceEmber: 22,
  essenceRime: 9,
  essenceVital: 14,
  essenceSwift: 3,
  catalyst: 31,
  solvent: 12,
  seal: 7,
  mapDust: 96,
  threatGlyph: 41,
  rewardInk: 6,
};

/** Map Stash showcase: 58 maps over T1–T12 (T11 and T13–15 empty), all three bases, some corrupted, two new. */
function stashedMaps(rng: ReturnType<typeof createRng>, uid: () => string): MapItem[] {
  const perTier = [4, 6, 8, 9, 7, 6, 6, 4, 3, 3, 0, 2];
  const bases: MapBaseId[] = ['ashenForge', 'rimedOssuary', 'ironColiseum'];
  const out: MapItem[] = [];
  let n = 0;
  perTier.forEach((count, i) => {
    for (let k = 0; k < count; k++) {
      n += 1;
      const rarity = n % 4 === 0 ? 'rare' : n % 3 === 0 ? 'magic' : n % 5 === 1 ? 'rare' : 'normal';
      const m = rollMapWithRarity(rng, bases[(n * 7 + k) % 3], i + 1, rarity, uid(), (n * 5) % 21, n === 21 || n === 22);
      out.push(n % 9 === 0 && rarity !== 'normal' ? { ...m, corrupted: true } : m);
    }
  });
  return out;
}

/** A level 24 Sorceress with a full paperdoll and an inventory that shows every tooltip and crafting case. */
function buildCharacter(r: GameRulesApi, specialStash: boolean, emptyDevice = false): CharacterSave {
  const rng = createRng(20260928);
  const uid = uidMaker('m');
  const base = r.createCharacter(ME.name, 7);
  const eq = (
    baseId: Parameters<typeof generateEquipment>[0],
    ilvl: number,
    rarity: 'normal' | 'magic' | 'rare',
    isNew = false,
  ): EquipmentItem => generateEquipment(baseId, ilvl, rarity, rng, { uid: uid(), isNew });

  const sceptre = eq('emberSceptre', 32, 'rare');
  const visor = eq('ironVisor', 28, 'rare');
  const boots = eq('pathfinderBoots', 22, 'magic');
  const belt = eq('chainBelt', 26, 'rare');
  const ring1 = eq('emberRing', 30, 'rare');
  const ring2 = eq('stormLoop', 18, 'magic');
  const tome = eq('runedTome', 25, 'magic');
  const amulet = generateUnique('echoOfTheMatriarch', rng, { uid: uid(), itemLevel: 30 });

  // backpack showcase
  const glass = eq('glassboneWand', 44, 'normal', true);
  const wand = eq('ashwoodWand', 36, 'rare', true);
  wand.affixes = wand.affixes.map((a, i) => (i === 0 ? { ...a, sealed: true } : a));
  wand.history = [...wand.history, 'Ember Essence added Blazing (T4)', 'Binding Seal sealed Blazing'];
  const spark = generateUnique('thePatientSpark', rng, { uid: uid(), itemLevel: 34 });
  const orb = eq('cinderOrb', 40, 'rare');
  orb.affixes = orb.affixes.map((a, i) => (i === orb.affixes.length - 1 ? { ...a, fractured: true } : a));
  orb.scars = [{ scarId: 'frail', value: 7 }];
  orb.stability = 2;
  orb.history = [...orb.history, 'Reforging Ember made it Rare', 'Fracture Core fractured a suffix', 'The strain left a scar: Frail'];
  const wraps = eq('silkWraps', 20, 'magic');
  wraps.stability = 0;
  wraps.history = [
    ...wraps.history,
    'Forge Scrap rerolled 2 values',
    'Tempering Catalyst upgraded a prefix',
    'Finished: no stability left',
  ];
  const circlet = eq('ritualCirclet', 24, 'magic');
  // A bench-crafted affix, for the "Crafted" tooltip marker and "Clear crafted affix".
  circlet.affixes = circlet.affixes.map((a, i) => (i === circlet.affixes.length - 1 ? { ...a, crafted: true } : a));
  circlet.history = [...circlet.history, 'Bench: added a suffix (T4)'];
  const signet = eq('voidSignet', 33, 'rare', true);
  const pendant = eq('cinderPendant', 20, 'magic');

  let bp = emptyGrid(BACKPACK_SIZE.w, BACKPACK_SIZE.h);
  bp = place(bp, glass, 0, 0);
  bp = place(bp, wand, 1, 0);
  bp = place(bp, spark, 2, 0);
  bp = place(bp, circlet, 0, 3);
  bp = place(bp, signet, 2, 3);
  bp = place(bp, pendant, 3, 3);
  const currencies: [CurrencyId, number][] = [
    ['scrap', 24],
    ['kindling', 6],
    ['reforge', 2],
    ['essenceEmber', 3],
    ['essenceRime', 2],
    ['essenceStorm', 1],
    ['essenceVital', 2],
    ['essenceSwift', 1],
    ['catalyst', 3],
    ['solvent', 2],
    ['seal', 2],
    ['fractureCore', 1],
    ['mapDust', 5],
    ['threatGlyph', 3],
    ['rewardInk', 1],
    ['voidNeedle', 1],
  ];
  currencies.forEach(([id, n], i) => {
    bp = place(bp, currencyStack(id, n, uid(), id === 'catalyst'), 4 + (i % 8), Math.floor(i / 8));
  });
  bp = place(bp, orb, 4, 2);
  bp = place(bp, wraps, 6, 2);
  const maps: [MapBaseId, number, 'normal' | 'magic' | 'rare', boolean][] = [
    ['ashenForge', 1, 'normal', false],
    ['rimedOssuary', 2, 'magic', false],
    ['ironColiseum', 4, 'rare', true],
    ['ashenForge', 5, 'rare', false],
  ];
  maps.forEach(([b, t, rar, isNew], i) => {
    const m = rollMapWithRarity(rng, b, t, rar, uid(), i * 6, isNew);
    bp = place(bp, i === 3 ? { ...m, corrupted: true } : m, 8 + i, 2);
  });
  bp = place(bp, flaskStack('lifeFlask', 4, uid()), 8, 3);
  bp = place(bp, flaskStack('focusFlask', 2, uid()), 9, 3);

  // stash tabs
  let main = emptyGrid(STASH_TAB_SIZE.w, STASH_TAB_SIZE.h);
  main = place(main, eq('rivetedCoat', 30, 'rare'), 0, 0);
  main = place(main, eq('ashenRobe', 36, 'normal'), 2, 0);
  main = place(main, generateUnique('cinderwalkers', rng, { uid: uid(), itemLevel: 30 }), 4, 0);
  main = place(main, generateUnique('ruinheartBand', rng, { uid: uid(), itemLevel: 30 }), 6, 0);
  main = place(main, eq('graspingGauntlets', 27, 'magic'), 7, 0);
  main = place(main, eq('ashenSandals', 31, 'rare'), 9, 0);
  main = place(main, eq('ironrootWand', 29, 'magic'), 11, 0);
  main = place(main, eq('runedSash', 33, 'rare'), 4, 2);
  main = place(main, eq('rimeBand', 21, 'normal'), 6, 1);
  main = place(main, eq('boneTalisman', 30, 'rare'), 6, 2);
  main = place(main, currencyStack('scrap', 40, uid()), 0, 7);
  main = place(main, currencyStack('scrap', 17, uid()), 1, 7);
  main = place(main, currencyStack('kindling', 12, uid()), 2, 7);
  let mapsTab = emptyGrid(STASH_TAB_SIZE.w, STASH_TAB_SIZE.h);
  for (let i = 0; i < 14; i++) {
    const tier = 1 + (i % 6);
    const rar = i % 5 === 0 ? 'rare' : i % 3 === 0 ? 'magic' : 'normal';
    const bases: MapBaseId[] = ['ashenForge', 'rimedOssuary', 'ironColiseum'];
    mapsTab = place(mapsTab, rollMapWithRarity(rng, bases[i % 3], tier, rar, uid(), (i * 3) % 20, false), i % 12, Math.floor(i / 12));
  }

  const skillRanks = {
    ...base.skillRanks,
    emberLance: 9,
    emberNova: 6,
    flameWave: 3,
    rimeShards: 5,
    arcChain: 2,
    riftStep: 4,
    cinderWard: 0,
  };
  const equipment: Partial<Record<EquipSlot, EquipmentItem>> = {
    mainHand: sceptre,
    offHand: tome,
    helmet: visor,
    chest: base.equipment.chest,
    boots,
    belt,
    amulet,
    ring1,
    ring2,
  };
  const level = 24;
  const deviceMap = rollMapWithRarity(rng, 'ashenForge', 4, 'rare', uid(), 8, false);
  return {
    ...base,
    id: ME.id,
    level,
    xp: Math.floor(r.xpToNext(level) * 0.62),
    unspentAttributePoints: 6,
    allocated: { str: 12, dex: 9, int: 30 },
    unspentSkillPoints: 2,
    skillRanks,
    loadout: ['emberLance', 'riftStep', 'emberNova', 'rimeShards', 'flameWave', 'arcChain'],
    equipment,
    backpack: bp,
    stash: [
      { name: 'Main', grid: main },
      { name: 'Maps', grid: mapsTab },
      { name: 'Crafting', grid: emptyGrid(STASH_TAB_SIZE.w, STASH_TAB_SIZE.h) },
    ],
    belt: [
      { flaskId: 'lifeFlask', count: 4 },
      { flaskId: 'lifeFlask', count: 2 },
      { flaskId: 'focusFlask', count: 3 },
      { flaskId: 'focusFlask', count: 0 },
    ],
    mapDevice: emptyDevice ? null : deviceMap,
    currencyStash: specialStash ? { ...STASHED_CURRENCY } : {},
    mapStash: [...(specialStash ? stashedMaps(rng, uid) : []), ...(emptyDevice ? [deviceMap] : [])],
  };
}

/** What a trade partner puts up: a rare amulet, magic boots, a rare ring, catalysts and a rare map. */
function partnerItems(seq: number): Item[] {
  const rng = createRng(4242 + seq);
  const uid = uidMaker(`t${seq}-`);
  const amulet = generateEquipment('boneTalisman', 38, 'rare', rng, { uid: uid() });
  const boots = generateEquipment('ashenSandals', 30, 'magic', rng, { uid: uid() });
  const ring = generateEquipment('stormLoop', 35, 'rare', rng, { uid: uid() });
  return [amulet, boots, ring, currencyStack('catalyst', 3, uid()), rollMapWithRarity(rng, 'rimedOssuary', 5, 'rare', uid(), 7, false)];
}

function toneOfOutcome(kind: string): Toast['tone'] {
  if (kind === 'scar' || kind === 'corrupted') return 'bad';
  if (kind === 'finished') return 'rare';
  return 'good';
}

export function createMockStore(art: ArtBundle, opts: MockOptions = {}): MockStore {
  // Assigned once the character exists (below); the trade locks read it lazily (null until then).
  let state: UiState = null as unknown as UiState;
  let lockCache: { items: readonly Item[]; uids: ReadonlySet<string> } | null = null;
  /** The uids of your current trade offer (withItemLocks' lockedOf). */
  const offeredNow = (): ReadonlySet<string> | null => {
    const items = (state as UiState | null)?.trade?.yourItems;
    if (!items?.length) return null;
    if (lockCache?.items !== items) lockCache = { items, uids: new Set(items.map((i) => i.uid)) };
    return lockCache.uids;
  };
  /** Plain rules: building the character and the trade swap (the server's tradeItems is not wrapped either). */
  const plainRules = withLootLuck(gameRules);
  const rules = withItemLocks(plainRules, offeredNow);
  let ch = buildCharacter(plainRules, opts.specialStash !== false, !!opts.emptyDevice);
  const listeners = new Set<() => void>();
  let toastId = 0;
  let chatId = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const later = (ms: number, fn: () => void): void => {
    timers.push(setTimeout(fn, ms));
  };

  // --- zone & run setup -------------------------------------------------------------------------
  const zone = opts.zone ?? 'hideout';
  const inMap = zone === 'map' || zone === 'partymap';
  let runSetup: RunSetup | null = null;
  const theme: MapBaseId = opts.theme ?? 'ashenForge';
  const roster = THEME_ROSTER[theme];
  if (inMap) {
    const rng = createRng(99);
    const map = rollMapWithRarity(rng, theme, 4, 'rare', 'run-map', 10, false);
    const opened = rules.openMap({ ...ch, mapDevice: map });
    if (opened.ok) runSetup = opened.value.setup;
  }

  const settings: Settings = { masterVolume: 0.8, musicVolume: 0.55, sfxVolume: 0.9, screenShake: 0.7, showFps: true, autoAttack: true };

  const partyInfo = (): PartyInfo => ({
    id: 'party-1',
    leaderId: opts.leader ? ME.id : MIRA.id,
    members: [
      {
        characterId: MIRA.id,
        name: MIRA.name,
        level: 26,
        online: true,
        isLeader: !opts.leader,
        zone:
          zone === 'partymap'
            ? { kind: 'map', ownerName: MIRA.name, mapName: 'Ashen Forge', tier: 3 }
            : { kind: 'hideout', ownerName: MIRA.name },
        activeMap: {
          ownerCharacterId: MIRA.id,
          ownerName: MIRA.name,
          mapName: 'Ashen Forge',
          tier: 3,
          remaining: 6,
          total: PORTALS_PER_MAP,
          cleared: false,
        },
      },
      {
        characterId: ME.id,
        name: ME.name,
        level: ch.level,
        online: true,
        isLeader: !!opts.leader,
        zone: inMap
          ? { kind: 'map', ownerName: zone === 'partymap' ? MIRA.name : ME.name, mapName: 'Ashen Forge', tier: 4 }
          : { kind: 'hideout', ownerName: zone === 'visit' ? MIRA.name : ME.name },
        activeMap:
          opts.portal === false
            ? null
            : {
                ownerCharacterId: ME.id,
                ownerName: ME.name,
                mapName: 'Ashen Forge',
                tier: 4,
                remaining: 7,
                total: PORTALS_PER_MAP,
                cleared: false,
              },
      },
      {
        characterId: CORVIN.id,
        name: CORVIN.name,
        level: 22,
        online: true,
        isLeader: false,
        zone: { kind: 'map', ownerName: MIRA.name, mapName: 'Ashen Forge', tier: 3 },
        activeMap: null,
      },
      // As leader the party has a free seat, so the invite field shows.
      ...(opts.leader
        ? []
        : [{ characterId: SABLE.id, name: SABLE.name, level: 19, online: false, isLeader: false, zone: null, activeMap: null }]),
    ],
  });

  const ownPortal: PortalInfo = {
    ownerCharacterId: ME.id,
    ownerName: ME.name,
    mapName: 'Ashen Forge',
    tier: 4,
    remaining: 7,
    total: PORTALS_PER_MAP,
    cleared: false,
  };
  const miraPortal: PortalInfo = {
    ownerCharacterId: MIRA.id,
    ownerName: MIRA.name,
    mapName: 'Ashen Forge',
    tier: 3,
    remaining: 6,
    total: PORTALS_PER_MAP,
    cleared: false,
  };

  const chatLines: ChatLine[] = opts.chat
    ? [
        { id: ++chatId, fromName: '', text: 'Mira joined the party.', time: Date.now() - 240_000 },
        { id: ++chatId, fromName: MIRA.name, text: 'portal is up in my hideout, 6 left', time: Date.now() - 180_000 },
        { id: ++chatId, fromName: CORVIN.name, text: 'grabbing flasks from Rook, one sec', time: Date.now() - 120_000 },
        { id: ++chatId, fromName: ME.name, text: 'on my way. anyone need a Rime Essence?', time: Date.now() - 60_000 },
        { id: ++chatId, fromName: '', text: 'Corvin has fallen.', time: Date.now() - 20_000 },
        { id: ++chatId, fromName: MIRA.name, text: 'boss at 30%, meteors incoming', time: Date.now() - 4_000 },
        { id: ++chatId, fromName: 'Thane', text: 'Anyone up for a map?', time: Date.now() - 2_000, channel: 'global' },
      ]
    : [];

  const summary: RunSummaryInfo | null = opts.summary
    ? {
        result: opts.summary,
        mapName: 'Howling Crucible',
        tier: 4,
        seconds: 684,
        kills: 1432,
        xpGained: 48_210,
        levelsGained: opts.summary === 'cleared' ? 1 : 0,
        itemsFound: [
          { label: 'Carrion Fang', tone: 'rare' },
          { label: 'The Patient Spark', tone: 'unique' },
          { label: 'Grim Coil', tone: 'rare' },
          { label: 'Ashen Forge (T5)', tone: 'map' },
          { label: 'Tempering Catalyst', tone: 'currency' },
          { label: 'Fracture Core', tone: 'currency' },
          { label: 'Lucid Ritual Circlet', tone: 'magic' },
          { label: 'Forge Scrap x14', tone: 'currency' },
          { label: 'Life Flask x2', tone: 'flask' },
        ],
      }
    : null;

  // --- HUD ----------------------------------------------------------------------------------------
  let t = 7.3;
  // During the boss fight one ally lies dead, to show the fallen party frame.
  const deaths = { corvin: !!opts.boss };
  function hudRun(): HudRun | null {
    if (!inMap || !runSetup) return null;
    const luck = rules.lootLuck(runSetup, ch);
    const desc = rules.describeItem(runSetup.map, ch);
    const bossPhase = opts.boss ? 2 : 0;
    const wave = opts.boss ? 6 : opts.lieutenant ? 3 : opts.tell ? 3 : 2;
    return {
      mapName: desc.title,
      tier: runSetup.map.tier,
      monsterLevel: runSetup.monsterLevel,
      phase: opts.cleared ? 'cleared' : opts.tell ? 'tell' : opts.boss ? 'boss' : 'fight',
      wave: opts.tell ? 2 : wave,
      waveCount: 6,
      waveProgress: opts.still ? 0.42 : (t % 60) / 60,
      monstersAlive: opts.cleared ? 0 : Math.round(64 + 22 * Math.sin(t / 2)),
      kills: 612 + Math.floor(t * 3),
      elapsed: 382 + t,
      // The sim sends a plain name; the HUD shows the full title ("Varkus" → "Varkus, the Iron Champion").
      boss: opts.boss
        ? { name: MONSTER_NAMES[roster.boss].one, life: 21000 * (0.52 - ((t / 400) % 0.2)), maxLife: 21000, phase: bossPhase }
        : null,
      lieutenant: opts.lieutenant
        ? { name: MONSTER_NAMES[roster.lieutenant].one, life: 3600 * (0.7 - ((t / 300) % 0.3)), maxLife: 3600 }
        : null,
      tell: opts.tell
        ? { wave: 3, families: roster.family.slice(0, 3) as MonsterKind[], lieutenant: true, boss: false }
        : null,
      itemQuantity: luck.itemQuantity,
      itemRarity: luck.itemRarity,
      modLines: [...desc.implicits, ...desc.affixes].map((l) => l.text),
      portalsRemaining: zone === 'partymap' ? 6 : 5,
      portalsTotal: PORTALS_PER_MAP,
    };
  }

  /**
   * Debuff showcase. Each debuff runs its own loop: applied, ticking down (stacking ones gain a stack every
   * `every` seconds, which refreshes the timer), gone for a moment, applied again. So the bar shows arrivals,
   * refreshes, stacks and expiry. `still` freezes a representative moment.
   */
  const DEBUFF_LOOPS: Record<PlayerDebuff, { duration: number; period: number; offset: number; maxStacks: number; every: number }> = {
    frozen: { duration: 0.8, period: 7, offset: 0.3, maxStacks: 1, every: 0 },
    rooted: { duration: 1.4, period: 5.5, offset: 1.1, maxStacks: 1, every: 0 },
    chilled: { duration: 2, period: 2.6, offset: 0.4, maxStacks: 1, every: 0 },
    shocked: { duration: 2, period: 6, offset: 2.2, maxStacks: 1, every: 0 },
    withered: { duration: 4, period: 8, offset: 1.5, maxStacks: 3, every: 1.3 },
    bleeding: { duration: 4, period: 7, offset: 0.8, maxStacks: 3, every: 0.9 },
    burning: { duration: 3, period: 3.8, offset: 2.6, maxStacks: 1, every: 0 },
  };
  const STILL_DEBUFFS: HudState['debuffs'] = [
    { id: 'rooted', remaining: 0.9, duration: 1.4, stacks: 1 },
    { id: 'chilled', remaining: 1.5, duration: 2, stacks: 1 },
    { id: 'withered', remaining: 2.8, duration: 4, stacks: 2 },
    { id: 'bleeding', remaining: 1.2, duration: 4, stacks: 3 },
    { id: 'burning', remaining: 2.2, duration: 3, stacks: 1 },
  ];
  const debuffIds: PlayerDebuff[] = Array.isArray(opts.debuffs) ? opts.debuffs : opts.debuffs ? [...PLAYER_DEBUFFS] : [];
  function debuffs(): HudState['debuffs'] {
    if (!debuffIds.length) return [];
    if (opts.still) {
      return debuffIds.map(
        (id) => STILL_DEBUFFS.find((x) => x.id === id) ?? { id, remaining: DEBUFF_LOOPS[id].duration * 0.6, duration: DEBUFF_LOOPS[id].duration, stacks: 1 },
      );
    }
    const out: HudState['debuffs'] = [];
    for (const id of debuffIds) {
      const loop = DEBUFF_LOOPS[id];
      const phase = (t + loop.offset) % loop.period;
      const stacks = loop.maxStacks > 1 ? Math.min(loop.maxStacks, 1 + Math.floor(phase / loop.every)) : 1;
      const lastApplied = (stacks - 1) * loop.every;
      const remaining = loop.duration - (phase - lastApplied);
      if (remaining > 0) out.push({ id, remaining, duration: loop.duration, stacks });
    }
    return out;
  }

  function hud(): HudState {
    const rt = rules.playerRuntime(ch, runSetup);
    const d = state?.derived ?? rules.deriveStats(ch);
    const maxLife = Math.round(d.combat.maxLife);
    const maxFocus = Math.round(d.combat.maxFocus);
    const wave = (period: number, phase: number): number => 0.5 + 0.5 * Math.sin(t / period + phase);
    const slots: HudSlot[] = LOADOUT_KEYS.map((key, i) => {
      const id = ch.loadout[i] ?? null;
      const def = rt.skills.find((s) => s.id === id);
      if (!id || !def) return { key, skillId: null, cooldown: 0, cooldownTotal: 0, charges: 0, maxCharges: 0, focusCost: 0, usable: false };
      const total = def.cooldown;
      const cycle = total > 0 ? (t * 0.9 + i * 1.7) % (total + 2.5) : total + 1;
      const cooldown = total > 0 && cycle < total ? total - cycle : 0;
      const maxCharges = def.charges;
      const charges = maxCharges > 1 ? (cooldown > 0 ? maxCharges - 1 : maxCharges) : cooldown > 0 ? 0 : 1;
      const starved = id === 'flameWave' && Math.floor(t / 4) % 2 === 0;
      return {
        key,
        skillId: id,
        cooldown,
        cooldownTotal: total,
        charges,
        maxCharges,
        focusCost: def.focusCost,
        usable: !starved && (charges > 0 || cooldown === 0),
      };
    });
    const flasks = ch.belt.map((b, i) =>
      b
        ? {
            key: String(i + 1),
            flaskId: b.flaskId,
            count: b.count,
            resource: rules.content.flasks[b.flaskId].resource,
            active: i === 0 ? Math.max(0, 1 - ((t * 0.35) % 1.6)) : i === 2 ? wave(3, 1) * 0.6 : 0,
          }
        : null,
    );
    const allies: HudAlly[] =
      zone === 'visit'
        ? [{ name: MIRA.name, level: 26, life: 380 * (0.8 + 0.2 * wave(2, 0)), maxLife: 412, dead: false }]
        : inMap
          ? [
              { name: MIRA.name, level: 26, life: 412 * (0.45 + 0.4 * wave(1.7, 0.4)), maxLife: 412, dead: false },
              {
                name: CORVIN.name,
                level: 22,
                life: deaths.corvin ? 0 : 290 * (0.3 + 0.5 * wave(1.3, 2)),
                maxLife: 330,
                dead: deaths.corvin,
              },
            ]
          : [];
    return {
      zone: inMap ? 'map' : 'hideout',
      hoveredMonster: opts.elite ? { id: 1, kind: 'ashling', rarity: opts.elite, mods: opts.elite === 'rare' ? 72 : 1, life: 0.65 } : null,
      debuffs: opts.dead ? [] : debuffs(),
      zoneOwnerName: zone === 'visit' || zone === 'partymap' ? MIRA.name : ME.name,
      zoneIsOwn: !(zone === 'visit' || zone === 'partymap'),
      life: opts.dead ? 0 : Math.round(maxLife * (0.55 + 0.35 * wave(2.2, 0))),
      maxLife,
      focus: Math.round(maxFocus * (0.4 + 0.5 * wave(1.6, 1))),
      maxFocus,
      wardFraction: Math.max(0, 1 - ((t * 0.12) % 1.8)),
      level: ch.level,
      xp: ch.xp,
      xpToNext: rules.xpToNext(ch.level),
      slots,
      flasks,
      run: hudRun(),
      portal: inMap ? null : opts.portal === false ? null : zone === 'visit' ? miraPortal : ownPortal,
      allies,
      fps: opts.still ? 60 : Math.round(58 + 2 * Math.random()),
      pingMs: opts.still ? 42 : Math.round(38 + 14 * wave(0.7, 0)),
      dead: !!opts.dead,
    };
  }

  const derive = (): UiState['derived'] => (runSetup ? deriveRunStats(ch, runSetup) : rules.deriveStats(ch));

  state = {
    screen: opts.screen ?? 'game',
    connection: opts.screen === 'disconnected' ? (opts.fatal ? 'offline' : 'reconnecting') : 'online',
    error: opts.error ?? (opts.fatal ? 'The server closed the connection: your character logged in from another window.' : null),
    busy: !!opts.busy,
    account: { id: 'acc-1', username: 'roman' },
    characters: opts.noCharacters
      ? []
      : [
          { id: ME.id, name: ME.name, level: ch.level, classId: 'sorceress' },
          { id: 'ch-ember', name: 'Emberwyn', level: 41, classId: 'sorceress' },
          { id: 'ch-frost', name: 'Hollowfrost', level: 9, classId: 'sorceress' },
        ],
    character: ch,
    derived: derive(),
    zone: inMap ? 'map' : 'hideout',
    openPanels: opts.panels ?? [],
    stashTab: opts.stash ?? 0,
    armed: null,
    affixChoice: null,
    craftingAllowed: !inMap,
    isOwnHideout: zone === 'hideout',
    run: runSetup,
    hud: null,
    toasts: [],
    benchItemUid: null,
    trade: null,
    tradeRequests: opts.tradeRequest ? [{ requestId: 'tr-1', fromCharacterId: CORVIN.id, fromName: CORVIN.name }] : [],
    // The mock server clock runs a little ahead, so the accept countdown really uses the offset.
    serverClockOffset: 240,
    runSummary: summary,
    party: opts.party === false ? null : partyInfo(),
    invites: opts.invite ? [{ inviteId: 'inv-1', fromCharacterId: 'ch-thane', fromName: 'Thane' }] : [],
    chat: chatLines,
    chatOpen: !!opts.chatOpen,
    paused: false,
    settings,
    altHeld: !!opts.alt,
    levelUpCount: 0,
  };
  // In game, the HUD arrives with the first zone snapshot a moment after mount (as with the real client), so the
  // zone banner and seeded toasts animate in on a settled page.
  const entering = state.screen === 'game';
  if (!entering) state = { ...state, hud: hud() };

  const emit = (): void => {
    for (const l of [...listeners]) l();
  };
  const set = (patch: Partial<UiState>): void => {
    state = { ...state, ...patch };
    emit();
  };
  const setCharacter = (next: CharacterSave): void => {
    ch = next;
    set({ character: ch, derived: derive() });
  };
  const toast = (text: string, tone: Toast['tone'] = 'info'): void => {
    set({ toasts: [...state.toasts, { id: ++toastId, text, tone }] });
  };
  const chat = (fromName: string, text: string, channel: import('../../contracts/net').ChatChannel = 'party'): void => {
    set({ chat: [...state.chat, { id: ++chatId, fromName, text, time: Date.now(), channel }].slice(-120) });
  };

  if (opts.armed) {
    const slot = parseCurrencyStashUid(opts.armed);
    const e = ch.backpack.entries.find((x) => x.item.kind === 'currency' && x.item.currencyId === opts.armed);
    if (slot) state = { ...state, armed: { uid: opts.armed, currencyId: slot } };
    else if (e && e.item.kind === 'currency') state = { ...state, armed: { uid: e.item.uid, currencyId: e.item.currencyId } };
  }
  if (opts.affix) {
    const cur = ch.backpack.entries.find((x) => x.item.kind === 'currency' && x.item.currencyId === opts.affix);
    const target = ch.backpack.entries.find(
      (x) => x.item.kind === 'equipment' && x.item.rarity === 'rare' && x.item.stability > 2 && !x.item.affixes.some((a) => a.sealed),
    );
    if (cur && target) {
      state = {
        ...state,
        armed: { uid: cur.item.uid, currencyId: opts.affix },
        affixChoice: { currencyUid: cur.item.uid, targetUid: target.item.uid, currencyId: opts.affix },
      };
    }
  }
  // --- crafting bench ------------------------------------------------------------------------------
  if (opts.bench !== false && (opts.bench || opts.panels?.includes('craftingBench'))) {
    const pick = ch.backpack.entries.find((e) =>
      opts.bench === 'crafted'
        ? e.item.kind === 'equipment' && e.item.affixes.some((a) => a.crafted)
        : e.item.kind === 'equipment' && e.item.baseId === 'ashwoodWand' && e.item.rarity === 'rare',
    );
    if (pick) state = { ...state, benchItemUid: pick.item.uid };
  }

  // --- trading (a scripted partner) ----------------------------------------------------------------
  let tradeSeq = 0;
  let droppedOnce = false;
  let partnerTimer: ReturnType<typeof setTimeout> | null = null;
  const serverNow = (): number => Date.now() + state.serverClockOffset;
  const partnerLater = (ms: number, fn: () => void): void => {
    if (partnerTimer) clearTimeout(partnerTimer);
    partnerTimer = setTimeout(fn, ms);
    timers.push(partnerTimer);
  };
  /** Any offer change clears both accepts and blocks accepting for TRADE_ACCEPT_LOCK_MS (server time). */
  const changed = (t: TradeInfo): TradeInfo => ({ ...t, youAccepted: false, theyAccepted: false, acceptLockedUntil: serverNow() + TRADE_ACCEPT_LOCK_MS });
  const completeTrade = (): void => {
    const t = state.trade;
    if (!t || !t.youAccepted || !t.theyAccepted) return;
    // The swap itself moves the locked items: plain rules, as the server's tradeItems.
    let next = ch;
    for (const it of t.yourItems) {
      const r = plainRules.discardItem(next, it.uid);
      if (!r.ok) return fail(r.error);
      next = r.value;
    }
    for (const it of t.theirItems) {
      const r = plainRules.addToBackpack(next, { ...it, isNew: true });
      if (!r.ok) {
        set({ trade: { ...t, youAccepted: false, theyAccepted: false } });
        return fail('Not enough room in your backpack for their offer. Nothing was traded.');
      }
      next = r.value;
    }
    setCharacter(next);
    set({ trade: null });
    toast(`Trade with ${t.partnerName} completed`, 'good');
    chat('', `You traded with ${t.partnerName}.`);
  };
  /** The partner looks at the offers and accepts a few seconds after the last change. */
  const partnerReviews = (): void =>
    partnerLater(3400, () => {
      const t = state.trade;
      if (!t || t.theyAccepted) return;
      set({ trade: { ...t, theyAccepted: true } });
      if (t.youAccepted) later(900, completeTrade);
    });
  const openTrade = (partner: { id: string; name: string }, scripted: boolean): void => {
    tradeSeq += 1;
    set({
      trade: {
        tradeId: `trade-${tradeSeq}`,
        partnerCharacterId: partner.id,
        partnerName: partner.name,
        yourItems: [],
        theirItems: [],
        youAccepted: false,
        theyAccepted: false,
        acceptLockedUntil: 0,
      },
    });
    chat('', `Trade with ${partner.name} opened.`);
    if (!scripted) return;
    const seq = tradeSeq;
    partnerLater(1600, () => {
      if (!state.trade || state.trade.tradeId !== `trade-${seq}`) return;
      set({ trade: changed({ ...state.trade, theirItems: partnerItems(seq).slice(0, 3) }) });
      partnerReviews();
    });
  };
  if (opts.trade) {
    tradeSeq += 1;
    const yours = ch.backpack.entries
      .filter((e) => (e.item.kind === 'equipment' && e.item.baseId === 'voidSignet') || (e.item.kind === 'currency' && e.item.currencyId === 'kindling'))
      .map((e) => e.item);
    state = {
      ...state,
      trade: {
        tradeId: `trade-${tradeSeq}`,
        partnerCharacterId: MIRA.id,
        partnerName: MIRA.name,
        yourItems: yours,
        theirItems: partnerItems(tradeSeq),
        youAccepted: opts.trade === 'waiting',
        theyAccepted: opts.trade === true,
        acceptLockedUntil: 0,
      },
    };
    // Mira keeps fiddling with her offer: every change restarts the accept countdown, so it is always running.
    if (opts.trade === 'locked') {
      const relock = (): void => {
        if (!state.trade) return;
        set({ trade: changed(state.trade) });
        later(TRADE_ACCEPT_LOCK_MS + 150, relock);
      };
      later(300, relock);
    }
  }

  const seededToasts = (): Toast[] => {
    if (!opts.toasts) return [];
    const seed: [string, Toast['tone']][] = [
      ['Carrion Fang', 'rare'],
      ['Tempering Catalyst', 'currency'],
      ['Mira invited Corvin to the party', 'info'],
      ['Ember Essence added Smouldering (T5)', 'good'],
    ];
    return seed.map(([text, tone]) => ({ id: ++toastId, text, tone }));
  };
  if (entering) later(600, () => set({ hud: hud(), toasts: seededToasts() }));

  // --- animation loop -------------------------------------------------------------------------------
  const tick = setInterval(() => {
    if (state.screen !== 'game' || opts.still) return;
    t += 1 / 15;
    set({ hud: hud() });
  }, 1000 / 15);

  if (opts.levelUp) later(400, () => set({ levelUpCount: state.levelUpCount + 1 }));

  // --- Alt tracking (the real client sets altHeld from its input layer) ------------------------------
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Alt') return;
    e.preventDefault();
    const down = e.type === 'keydown';
    if (state.altHeld !== down) set({ altHeld: down });
  };
  const onBlur = (): void => {
    if (state.altHeld && !opts.alt) set({ altHeld: false });
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', onBlur);

  // --- actions ---------------------------------------------------------------------------------------
  const fail = (error: string): void => toast(error, 'bad');
  const busyThen = (ms: number, fn: () => void): void => {
    set({ busy: true, error: null });
    later(ms, () => {
      set({ busy: false });
      fn();
    });
  };

  const actions: UiActions = {
    register(username) {
      busyThen(900, () => set({ screen: 'characters', account: { id: 'acc-1', username } }));
    },
    login(username) {
      busyThen(700, () => {
        if (username.toLowerCase() === 'fail') set({ error: 'Wrong username or password.' });
        else set({ screen: 'characters', account: { id: 'acc-1', username } });
      });
    },
    logout() {
      set({ screen: 'auth', account: null, openPanels: [], armed: null, affixChoice: null });
    },
    createCharacter(name) {
      if (state.characters.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        set({ error: `The name ${name} is taken.` });
        return;
      }
      busyThen(600, () =>
        set({ characters: [...state.characters, { id: `ch-${name.toLowerCase()}`, name, level: 1, classId: 'sorceress' }] }),
      );
    },
    playCharacter() {
      busyThen(500, () => set({ screen: 'game', hud: hud() }));
    },
    deleteCharacter(id) {
      set({ characters: state.characters.filter((c) => c.id !== id) });
    },
    toCharacterSelect() {
      set({ screen: 'characters', openPanels: [], armed: null, affixChoice: null, connection: 'online', error: null });
    },
    retryConnection() {
      set({ connection: 'reconnecting', error: null });
      later(1500, () => set({ screen: 'game', connection: 'online' }));
    },

    togglePanel(p) {
      set({ openPanels: state.openPanels.includes(p) ? state.openPanels.filter((x) => x !== p) : [...state.openPanels, p] });
    },
    openPanel(p) {
      if (!state.openPanels.includes(p)) set({ openPanels: [...state.openPanels, p] });
    },
    closePanel(p) {
      if (state.openPanels.includes(p)) set({ openPanels: state.openPanels.filter((x) => x !== p) });
    },
    closeAllPanels() {
      set({ openPanels: [] });
    },
    setStashTab(tab) {
      set({ stashTab: tab });
    },

    depositAllCurrency() {
      const r = rules.depositAllCurrency(ch);
      if (!r.ok) fail(r.error);
      else setCharacter(r.value);
    },

    // Offered items: the trade-locked rules refuse (as the server does).
    moveItem(uid, to, count) {
      const r = rules.moveItem(ch, uid, to, count);
      if (!r.ok) {
        fail(r.error);
        return false;
      }
      setCharacter(r.value);
      return true;
    },
    quickMove(uid, count) {
      const r = rules.quickMove(ch, uid, { stashTab: state.openPanels.includes('stash') ? state.stashTab : null, count });
      if (!r.ok) fail(r.error);
      else setCharacter(r.value);
    },
    discardItem(uid) {
      const r = rules.discardItem(ch, uid);
      if (!r.ok) fail(r.error);
      else setCharacter(r.value);
    },
    dropItem(uid) {
      const f = rules.findItem(ch, uid);
      if (!f) return;
      if (f.location.kind === 'mapDevice') return fail('Take the map out of the device first.');
      if (f.location.kind === 'stash' && inMap) return fail('Stash items can only be dropped in a hideout.');
      const title = rules.describeItem(f.item, ch).title;
      // The mock has no world: the item simply leaves the character, as it would onto the floor.
      const r = rules.discardItem(ch, uid);
      if (!r.ok) return fail(r.error);
      setCharacter(r.value);
      toast(
        droppedOnce ? `Dropped ${title}` : `Dropped ${title}. Anyone nearby can pick it up; it vanishes after 10 minutes.`,
        'info',
      );
      droppedOnce = true;
    },
    armCurrency(uid) {
      const f = rules.findItem(ch, uid);
      if (!f || f.item.kind !== 'currency') return;
      if (!state.craftingAllowed) {
        fail('Crafting only works in a hideout.');
        return;
      }
      set({ armed: { uid, currencyId: f.item.currencyId } });
    },
    disarm() {
      set({ armed: null, affixChoice: null });
    },
    applyArmed(targetUid) {
      const armed = state.armed;
      if (!armed) return;
      const info = rules.content.currencies[armed.currencyId];
      const err = rules.craftingTargetError(ch, armed.uid, targetUid);
      if (err) {
        fail(err);
        return;
      }
      if (info.needsAffixChoice) {
        set({ affixChoice: { currencyUid: armed.uid, targetUid, currencyId: armed.currencyId } });
        return;
      }
      applyCraft(armed.uid, targetUid);
    },
    chooseAffix(i) {
      const c = state.affixChoice;
      if (!c) return;
      set({ affixChoice: null });
      applyCraft(c.currencyUid, c.targetUid, i);
    },
    cancelAffixChoice() {
      set({ affixChoice: null });
    },
    addStashTab() {
      const r = rules.addStashTab(ch);
      if (!r.ok) fail(r.error);
      else setCharacter(r.value);
    },
    renameStashTab(tab, name) {
      const r = rules.renameStashTab(ch, tab, name);
      if (!r.ok) fail(r.error);
      else setCharacter(r.value);
    },
    clearNewFlags() {
      setCharacter(rules.clearNewFlags(ch));
    },

    setBenchItem(uid) {
      set({ benchItemUid: uid });
    },
    benchCraft(recipeId) {
      const uid = state.benchItemUid;
      if (!uid) return;
      if (!state.craftingAllowed) return fail('Crafting only works in a hideout.');
      const r = rules.applyBenchRecipe(ch, uid, recipeId);
      if (!r.ok) return fail(r.error);
      setCharacter(r.value.character);
      toast(r.value.message, toneOfOutcome(r.value.kind));
    },
    benchClear() {
      const uid = state.benchItemUid;
      if (!uid) return;
      const r = rules.clearCraftedAffix(ch, uid);
      if (!r.ok) return fail(r.error);
      setCharacter(r.value.character);
      toast(r.value.message, 'info');
    },

    tradeRequest(name) {
      const n = name.trim();
      if (n.toLowerCase() === ME.name.toLowerCase()) return fail('You cannot trade with yourself.');
      if (state.trade) return fail('Finish your current trade first.');
      const member = state.party?.members.find((m) => m.name.toLowerCase() === n.toLowerCase());
      if (member && !member.online) return fail(`${member.name} is offline.`);
      const partner = { id: member?.characterId ?? `ch-${n.toLowerCase()}`, name: member?.name ?? n };
      toast(`Trade request sent to ${partner.name}`, 'info');
      later(1400, () => {
        if (!state.trade) openTrade(partner, true);
      });
    },
    tradeRespond(requestId, accept) {
      const req = state.tradeRequests.find((r) => r.requestId === requestId);
      set({ tradeRequests: state.tradeRequests.filter((r) => r.requestId !== requestId) });
      if (!req || !accept) return;
      if (state.trade) set({ trade: null });
      openTrade({ id: req.fromCharacterId, name: req.fromName }, true);
    },
    tradeOffer(uids) {
      const t = state.trade;
      if (!t) return;
      if (uids.length > TRADE_MAX_ITEMS) return fail(`At most ${TRADE_MAX_ITEMS} items per offer.`);
      const items: Item[] = [];
      for (const u of uids) {
        const e = ch.backpack.entries.find((x) => x.item.uid === u);
        if (!e) return fail('Only items in your backpack can be traded.');
        items.push(e.item);
      }
      set({ trade: changed({ ...t, yourItems: items }) });
      partnerReviews();
    },
    tradeAccept(accept) {
      const t = state.trade;
      if (!t) return;
      if (accept && t.acceptLockedUntil > serverNow()) return fail('An offer just changed. Look again before accepting.');
      set({ trade: { ...t, youAccepted: accept } });
      if (accept && t.theyAccepted) later(900, completeTrade);
    },
    tradeCancel() {
      const t = state.trade;
      if (!t) return;
      if (partnerTimer) clearTimeout(partnerTimer);
      set({ trade: null });
      toast(`Trade with ${t.partnerName} cancelled`, 'info');
      chat('', `The trade with ${t.partnerName} was cancelled.`);
    },

    allocateAttribute(attr) {
      const r = rules.allocateAttribute(ch, attr);
      if (!r.ok) fail(r.error);
      else setCharacter(r.value);
    },
    rankUpSkill(id) {
      const r = rules.rankUpSkill(ch, id);
      if (!r.ok) fail(r.error);
      else setCharacter(r.value);
    },
    setLoadoutSlot(slot, id) {
      const r = rules.setLoadoutSlot(ch, slot, id);
      if (!r.ok) fail(r.error);
      else {
        setCharacter(r.value);
        set({ hud: hud() });
      }
    },

    setMapTreeNode(nodeId, allocate) {
      const r = rules.setMapTreeNode(ch, nodeId, allocate);
      if (!r.ok) fail(r.error); else setCharacter(r.value);
    },
    activateMapDevice(areaId, lootClass) {
      const r = rules.openMap(ch, areaId, lootClass);
      if (!r.ok) {
        fail(r.error);
        return;
      }
      setCharacter(r.value.character);
      const name = rules.describeItem(r.value.setup.map, ch).title;
      ownPortal.mapName = name;
      ownPortal.tier = r.value.setup.map.tier;
      ownPortal.remaining = PORTALS_PER_MAP;
      set({ hud: hud() });
      toast(`${PORTALS_PER_MAP} portals to ${name} opened beside the device`, 'good');
    },
    merchantOffers() {
      return rules.merchantOffers(ch);
    },
    buyOffer(id) {
      const r = rules.buyOffer(ch, id);
      if (!r.ok) {
        fail(r.error);
        return;
      }
      setCharacter(r.value.character);
      const tone: ItemTone =
        r.value.item.kind === 'equipment'
          ? r.value.item.rarity
          : r.value.item.kind === 'map'
            ? 'map'
            : r.value.item.kind === 'flask'
              ? 'flask'
              : 'currency';
      toast(`Bought ${rules.describeItem(r.value.item, ch).title}`, tone);
    },

    partyInvite(name) {
      toast(`Invite sent to ${name}`, 'info');
      chat('', `You invited ${name} to the party.`);
    },
    partyRespond(inviteId, accept) {
      const inv = state.invites.find((i) => i.inviteId === inviteId);
      set({ invites: state.invites.filter((i) => i.inviteId !== inviteId) });
      if (inv && accept) {
        toast(`You joined ${inv.fromName}'s party`, 'good');
        chat('', `You joined ${inv.fromName}'s party.`);
      }
    },
    partyLeave() {
      set({ party: null });
      chat('', 'You left the party.');
    },
    partyKick(id) {
      if (!state.party) return;
      set({ party: { ...state.party, members: state.party.members.filter((m) => m.characterId !== id) } });
    },
    partyPromote(id) {
      if (!state.party) return;
      set({ party: { ...state.party, leaderId: id, members: state.party.members.map((m) => ({ ...m, isLeader: m.characterId === id })) } });
    },
    visitHideout(id) {
      const m = state.party?.members.find((x) => x.characterId === id);
      toast(`Travelling to ${m?.name ?? 'a'} hideout`, 'info');
    },
    goHome() {
      toast('Travelling to your hideout', 'info');
    },
    setChatOpen(open) {
      set({ chatOpen: open });
    },
    sendChat(text, channel = 'global') {
      chat(ME.name, text, channel);
    },

    leaveMap() {
      toast('You left the map. Coming back costs a portal.', 'info');
    },
    respawn() {
      set({ hud: { ...hud(), dead: false } });
      opts.dead = false;
      toast('You wake in your hideout.', 'info');
    },
    dismissRunSummary() {
      set({ runSummary: null });
    },

    setPaused(paused) {
      set({ paused });
    },
    updateSettings(patch) {
      set({ settings: { ...state.settings, ...patch } });
    },
    dismissToast(id) {
      set({ toasts: state.toasts.filter((x) => x.id !== id) });
    },
    uiSound() {
      // The real client plays procedural UI sounds here.
    },
  };

  function applyCraft(currencyUid: string, targetUid: string, affixIndex?: number): void {
    const r = rules.applyCurrency(ch, currencyUid, targetUid, affixIndex);
    if (!r.ok) {
      fail(r.error);
      return;
    }
    setCharacter(r.value.character);
    toast(r.value.message, toneOfOutcome(r.value.kind));
    if (!rules.findItem(ch, currencyUid)) set({ armed: null });
  }

  return {
    get: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    actions,
    rules,
    art: { icon: (id, size) => art.icon(id, size), portrait: (size) => art.portrait(size) },
    patch: set,
    dispose() {
      clearInterval(tick);
      timers.forEach(clearTimeout);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    },
  };
}
