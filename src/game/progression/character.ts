// Character lifecycle: creation with the starting kit (GAME_SPEC §3), experience and levels, attribute
// points, flask charges and the run log.
import type { Result, RunEndInput } from '../../contracts/game';
import type { CharacterSave, GridContainer, Item } from '../../contracts/items';
import { BACKPACK_SIZE, BELT_SLOTS, LOADOUT_SLOTS } from '../../contracts/items';
import type { Attribute, SkillId } from '../../contracts/content';
import { ATTRIBUTES, SKILL_IDS } from '../../contracts/content';
import type { FlaskRuntime } from '../../contracts/sim';
import { createRng, hashString, hashU32 } from '../../core/rng';
import {
  CHARACTER_NAME_MAX, CHARACTER_NAME_MIN, DEFAULT_CHARACTER_NAME, DEFAULT_STASH_TABS, LEVEL_CAP, SORCERESS, STARTING_KIT, XP_BASE,
  XP_EXPONENT,
} from '../../data/progression';
import { STAT_LABEL, getFlask } from '../../data/items';
import {
  beltSlots, buildEquipment, createGrid, createStashTab, currencyStack, flaskRecovery, mintUid, placeItem,
} from '../items';
import { createMapItem } from './maps';
import { fail, ok } from './util';

// ---------------------------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------------------------

/** XP needed to go from `level` to `level + 1`: floor(90 × level^1.75). */
export function xpToNext(level: number): number {
  const l = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return Math.floor(XP_BASE * l ** XP_EXPONENT);
}

/** Grant experience: levels up (to the cap of 60), +3 attribute points and +1 skill point per level. */
export function grantXp(ch: CharacterSave, amount: number): { character: CharacterSave; levelsGained: number } {
  if (!Number.isFinite(amount) || amount <= 0 || ch.level >= LEVEL_CAP) {
    return { character: ch.level >= LEVEL_CAP && ch.xp !== 0 ? { ...ch, xp: 0 } : ch, levelsGained: 0 };
  }
  let level = ch.level;
  let xp = ch.xp + amount;
  let gained = 0;
  while (level < LEVEL_CAP && xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    gained += 1;
  }
  if (level >= LEVEL_CAP) xp = 0;
  if (gained === 0) return { character: { ...ch, xp }, levelsGained: 0 };
  return {
    character: {
      ...ch,
      level,
      xp,
      unspentAttributePoints: ch.unspentAttributePoints + gained * SORCERESS.attributePointsPerLevel,
      unspentSkillPoints: ch.unspentSkillPoints + gained * SORCERESS.skillPointsPerLevel,
    },
    levelsGained: gained,
  };
}

export function allocateAttribute(ch: CharacterSave, attr: Attribute): Result<CharacterSave> {
  if (!(ATTRIBUTES as readonly string[]).includes(attr)) return fail('Unknown attribute.');
  if (ch.unspentAttributePoints < 1) return fail('No attribute points left. You gain 3 every level.');
  return ok({
    ...ch,
    unspentAttributePoints: ch.unspentAttributePoints - 1,
    allocated: { ...ch.allocated, [attr]: (ch.allocated[attr] ?? 0) + 1 },
  });
}

/** Human attribute label (for UI toasts). */
export function attributeLabel(attr: Attribute): string {
  return STAT_LABEL[attr];
}

// ---------------------------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------------------------

/** Whitespace-normalised name: control characters dropped, runs of whitespace collapsed, trimmed. */
function normalizeName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '';
}

/**
 * The stored form of a name: normalised and cut to 16 characters, falling back to "Sorceress" when
 * nothing is left. Lenient on purpose — it normalises old or damaged saves (parseSave) and never
 * fails; a NEW name must pass validateCharacterName first.
 */
export function sanitizeName(name: unknown): string {
  return normalizeName(name).slice(0, CHARACTER_NAME_MAX).trim() || DEFAULT_CHARACTER_NAME;
}

/** Letters A-Z, digits, spaces, hyphens, apostrophes and underscores (ASCII: the world's pixel font). */
const NAME_CHARS = /^[A-Za-z0-9 '_-]+$/;

/**
 * Why a NEW character name is not allowed (player-facing), or null when it is. Checked on the
 * whitespace-normalised name — the exact form createCharacter stores — so the server should check
 * uniqueness on `createCharacter(name, seed).name` (case-insensitively). ASCII only: names float over
 * players in the world's pixel font, which covers ASCII. Uniqueness is the server's job.
 */
export function validateCharacterName(name: unknown): string | null {
  if (typeof name !== 'string') return 'Choose a name for your character.';
  const clean = normalizeName(name);
  if (clean.length < CHARACTER_NAME_MIN) return `Character names need at least ${CHARACTER_NAME_MIN} characters.`;
  if (clean.length > CHARACTER_NAME_MAX) return `Character names can be at most ${CHARACTER_NAME_MAX} characters.`;
  if (!NAME_CHARS.test(clean)) return 'Use only letters A-Z, digits, spaces, hyphens, apostrophes and underscores.';
  if (!/^[A-Za-z]/.test(clean)) return 'Character names must start with a letter.';
  return null;
}

function emptyRanks(): Record<SkillId, number> {
  const out = {} as Record<SkillId, number>;
  for (const id of SKILL_IDS) out[id] = 0;
  return out;
}

function mint(state: { ch: CharacterSave }): string {
  const m = mintUid(state.ch);
  state.ch = m.character;
  return m.uid;
}

function place(grid: GridContainer, item: Item, x: number, y: number): GridContainer {
  const next = placeItem(grid, item, x, y);
  if (!next) throw new Error(`starting kit: cannot place ${item.uid} at ${x},${y}`);
  return next;
}

/**
 * A new level 1 Sorceress with the starting kit. Deterministic in (name, seed). `createdAt` /
 * `updatedAt` are 0: the rules never read the clock, so the app stamps them. Online: validate the name
 * with validateCharacterName first (this never fails: it sanitises), and pass a server-random seed —
 * it also seeds the character's rng (see src/game/online.ts).
 */
export function createCharacter(name: string, seed: number): CharacterSave {
  const cleanName = sanitizeName(name);
  const s = (Number.isFinite(seed) ? Math.floor(seed) : 0) >>> 0;
  const rng = createRng(hashU32(s ^ 0x5eed));
  const skillRanks = emptyRanks();
  skillRanks[STARTING_KIT.skills.basic] = STARTING_KIT.skills.rank;
  const loadout: (SkillId | null)[] = Array.from({ length: LOADOUT_SLOTS }, () => null);
  loadout[0] = STARTING_KIT.skills.basic;

  const state = {
    ch: {
      id: `ch-${hashU32(s ^ hashString(cleanName)).toString(36)}-${s.toString(36)}`,
      name: cleanName,
      classId: 'sorceress',
      level: 1,
      xp: 0,
      unspentAttributePoints: 0,
      allocated: { str: 0, dex: 0, int: 0 },
      unspentSkillPoints: STARTING_KIT.skills.unspentPoints,
      skillRanks,
      loadout,
      equipment: {},
      backpack: createGrid(BACKPACK_SIZE.w, BACKPACK_SIZE.h),
      stash: DEFAULT_STASH_TABS.map((t) => createStashTab(t)),
      currencyStash: {},
      mapStash: [],
      belt: STARTING_KIT.belt.map((b) => (b ? { ...b } : null)).concat(Array(BELT_SLOTS).fill(null)).slice(0, BELT_SLOTS),
      mapDevice: null,
      rngState: 0,
      nextUid: 1,
      stats: {
        mapsCompleted: 0, mapsFailed: 0, highestTierCompleted: 0, kills: 0, deaths: 0,
        raresFound: 0, uniquesFound: 0, itemsCrafted: 0, playSeconds: 0,
      },
      createdAt: 0,
      updatedAt: 0,
    } as CharacterSave,
  };

  const wand = buildEquipment({
    baseId: 'ashwoodWand', itemLevel: 1, rarity: 'magic', uid: mint(state),
    affixes: [{ affixId: STARTING_KIT.wand.affixId, tier: STARTING_KIT.wand.tier }],
    history: [STARTING_KIT.wandHistory],
  }, rng);
  const robe = buildEquipment({
    baseId: 'ashenRobe', itemLevel: 1, rarity: 'normal', uid: mint(state), history: [STARTING_KIT.robeHistory],
  }, rng);

  let backpack = state.ch.backpack;
  STARTING_KIT.currency.forEach((c, i) => {
    backpack = place(backpack, currencyStack(c.currencyId, c.count, mint(state)), i, 0);
  });
  let x = 0;
  for (const m of STARTING_KIT.maps) {
    for (let k = 0; k < m.count; k++) backpack = place(backpack, createMapItem(m.areaId, 1, mint(state)), x++, 1);
  }

  return {
    ...state.ch,
    equipment: { mainHand: wand, chest: robe },
    backpack,
    rngState: rng.state(),
  };
}

// ---------------------------------------------------------------------------------------------
// Flasks
// ---------------------------------------------------------------------------------------------

/** Belt slot runtime for the sim: charges, resource, total recovery (flask effect applied), duration. */
export function flaskRuntimes(ch: CharacterSave, flaskEffect: number): (FlaskRuntime | null)[] {
  return beltSlots(ch).map((slot) => {
    if (!slot) return null;
    const def = getFlask(slot.flaskId);
    return {
      flaskId: slot.flaskId,
      count: Math.max(0, Math.floor(slot.count)),
      resource: def.resource,
      amount: flaskRecovery(slot.flaskId, ch.level, flaskEffect),
      duration: def.duration,
    };
  });
}

/** A flask charge was drunk in a run: one charge less in that belt slot (the slot stays assigned). */
export function consumeFlask(ch: CharacterSave, slot: number): CharacterSave {
  if (!Number.isInteger(slot) || slot < 0 || slot >= BELT_SLOTS) return ch;
  const belt = beltSlots(ch);
  const s = belt[slot];
  if (!s || s.count <= 0) return ch;
  belt[slot] = { flaskId: s.flaskId, count: s.count - 1 };
  return { ...ch, belt };
}

// ---------------------------------------------------------------------------------------------
// Run log
// ---------------------------------------------------------------------------------------------

/**
 * Record a finished map in the character's log (XP and items are granted as they happen, deaths by
 * recordDeath). Online meaning — call it ONCE per player per map instance they entered, when they are
 * done with it for good (the instance closed, or they went home after the clear):
 *   result   'cleared'   the map was cleared (whether or not this player saw the boss fall);
 *            'failed'    it closed uncleared after every portal was spent;
 *            'abandoned' it closed uncleared with portals left (everyone walked away);
 *   tier     the map's tier;
 *   kills    this player's own kill credits (SimOutcome kill.playerId), not the instance total;
 *   seconds  the time this player spent inside, all entries summed;
 *   raresFound / uniquesFound  the rare / unique items this player picked up there.
 * 'failed' and 'abandoned' both count as a map not completed.
 */
export function applyRunEnd(ch: CharacterSave, input: RunEndInput): CharacterSave {
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const cleared = input.result === 'cleared';
  const stats = { ...ch.stats };
  stats.mapsCompleted += cleared ? 1 : 0;
  stats.mapsFailed += cleared ? 0 : 1;
  if (cleared) stats.highestTierCompleted = Math.max(stats.highestTierCompleted, Math.floor(n(input.tier)));
  stats.kills += Math.floor(n(input.kills));
  stats.raresFound += Math.floor(n(input.raresFound));
  stats.uniquesFound += Math.floor(n(input.uniquesFound));
  stats.playSeconds += n(input.seconds);
  return { ...ch, stats };
}

/**
 * A death in a map (SimOutcome playerDied). Online a player can die, walk back in through a portal and
 * die again in the same map, so deaths are logged here, one per death — not by applyRunEnd.
 */
export function recordDeath(ch: CharacterSave): CharacterSave {
  return { ...ch, stats: { ...ch.stats, deaths: (Number.isFinite(ch.stats.deaths) ? ch.stats.deaths : 0) + 1 } };
}
