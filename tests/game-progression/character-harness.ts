// Character harness (power rework P3, build-plan 4.2): builds a real CharacterSave for an archetype, a band and a monster
// level THROUGH THE REAL RULES and hands it to rules.playerRuntime:
//   - gear: buildEquipment (it validates every affix against the real tables: class, group, item-level gate, tier range) at
//     item level = monster level, tiers by band (fair: the expected roll of the ladder's weights, good: best available minus
//     one, endgame: best available), spread over the ten slots by a greedy solver that respects the 3 prefix / 3 suffix limits;
//   - points: attributes spent by the band's policy, skill ranks chosen so the main skill's effectiveness matches the band's
//     rank (2 / 5 / 8 / 10 of 10), whatever MAX_SKILL_RANK is today;
//   - everything the rules do not have yet (the passive tree's increased damage, cast and crit; the `more` pool; the
//     damage-taken multiplier of tree and ward uptime) is a STAND-IN taken from the band model and applied to the runtime. Each
//     stand-in sits behind a capability flag (CAPABILITIES) and switches itself off the day the real mechanic exists.
//   - the 14 archetypes and 2 baselines of build-plan 4.2. Skills, passives, augments, uniques and stats that do not exist yet
//     are listed in `wants` and reported as `missing`; the archetype runs today with the `loadout` fallback.
//
// Constants come from the data modules (affix ladders, bases, skills, class) and the band model: nothing here is a copy of a
// number that P0, P1 or P2 may move.
import { appendFileSync } from 'node:fs';
import type { EquipSlot, SkillId, BaseId } from '../../src/contracts/content';
import { SKILL_IDS } from '../../src/contracts/content';
import type { RunSetup } from '../../src/contracts/game';
import type { CharacterSave, EquipmentItem, StatId } from '../../src/contracts/items';
import { LOADOUT_SLOTS } from '../../src/contracts/items';
import type { PlayerRuntime, SkillRuntimeDef } from '../../src/contracts/sim';
import { createRng } from '../../src/core/rng';
import { BASES, getAffix } from '../../src/data/items';
import type { AffixDef, BaseDef } from '../../src/data/items';
import { MAX_SKILL_RANK, SKILLS } from '../../src/data/progression';
import { rules } from '../../src/game';
import { buildEquipment, flaskStack } from '../../src/game/items';
import { affixAllowedOnBase } from '../../src/game/items/affix-pool';
import { buildPlayerModel } from '../../src/game/progression/model';
import { mapPlayerModifiers } from '../../src/game/progression/maps';
import { damageStatsFor, normalizeLoadout, resolveSkill } from '../../src/game/progression/skills';
import { computeCombat } from '../../src/game/progression/stats';
import type { BotOptions } from '../sim/bot';
import {
  BAND_PARAMS, build, levelFor, rankFractionFor, treeCredit,
  type Band, type BandParams,
} from './character-model';
import { bareCharacter, map as mapFixture, setupFor } from './fixtures';

export type { Band } from './character-model';

// ---------------------------------------------------------------------------------------------
// Capabilities: what the game can do today (the harness grows with later releases)
// ---------------------------------------------------------------------------------------------

export interface Capabilities {
  /** The Orrery passive tree exists in the rules (R5). While false the tree's offence credit is a band-model stand-in. */
  passives: boolean;
  /** Skill augments exist (R2/R3). */
  augments: boolean;
  /** Player penetration stats and affixes exist (P1/P2). */
  penetration: boolean;
  /** Void and physical damage affixes exist (P2). */
  voidDamage: boolean;
  physicalDamage: boolean;
  /** The `more` pool has real sources on the player (passives, augments, uniques): while false it is a stand-in. */
  moreSources: boolean;
  /** Conversion and exposure exist in the damage pipeline (P1 + skills). */
  conversion: boolean;
  exposure: boolean;
}

/** Flip when the archetype presets carry passive node ids and spend them through rules.allocatePassive. */
export const PRESETS_ALLOCATE_PASSIVES = false;

export function detectCapabilities(): Capabilities {
  const api = rules as unknown as Record<string, unknown>;
  // The Orrery's rules exist since PT0 (rules.allocatePassive), but the presets below still name their passives by design label (not
  // node ids) and most keystone behaviours are structural rules that are not live yet (PASSIVE_RULES): the tree's credit stays a
  // band-model stand-in until each preset allocates real nodes through the rules (harness lane, with B1).
  const passives = typeof api.allocatePassive === 'function' && PRESETS_ALLOCATE_PASSIVES;
  const augments = Object.values(SKILLS).some((s) => 'augments' in (s as object));
  return {
    passives,
    augments,
    penetration: !!getAffix('firePen'),
    voidDamage: !!getAffix('voidDamage'),
    physicalDamage: !!getAffix('physicalDamage'),
    // TODO(P5): flips with the Orrery; until then the band model's `more` pool is applied as a stand-in.
    moreSources: passives && augments,
    // TODO(SK3): conversion / exposure are skill primitives (Frostfire Core, Entropy Hex); detected by the augment system.
    conversion: augments,
    exposure: augments,
  };
}

/** Evaluated once per module load; tests can pass their own to exercise the future. */
export const CAPABILITIES: Capabilities = detectCapabilities();

// ---------------------------------------------------------------------------------------------
// Tier selection by band
// ---------------------------------------------------------------------------------------------

/** Where in its range an endgame (crafted) affix rolls: 0 = the minimum, 1 = the maximum. */
export const ENDGAME_ROLL = 0.85;

export interface TierPick { tier: number; value: number }

/** The tiers a monster/item level unlocks, best (T1) first. */
export function availableTiers(def: AffixDef, ilvl: number) {
  return def.tiers.filter((t) => t.itemLevel <= ilvl).sort((a, b) => a.tier - b.tier);
}

/** The tier and value a band wears for an affix at an item level; null when the affix has no tier at that level. */
export function pickTier(def: AffixDef, ilvl: number, band: Band): TierPick | null {
  const avail = availableTiers(def, ilvl);
  if (!avail.length) return null;
  const mid = (t: { min: number; max: number }) => (t.min + t.max) / 2;
  switch (BAND_PARAMS[band].gearTier) {
    // The endgame band is crafted: its rolls sit in the top part of the tier (ENDGAME_ROLL of the way from min to max).
    case 'best': return { tier: avail[0].tier, value: avail[0].min + (avail[0].max - avail[0].min) * ENDGAME_ROLL };
    case 'best-1': {
      const t = avail[Math.min(1, avail.length - 1)];
      return { tier: t.tier, value: mid(t) };
    }
    case 'expected': {
      const w = avail.reduce((s, t) => s + t.weight, 0);
      const expected = avail.reduce((s, t) => s + t.weight * mid(t), 0) / w;
      // The tier whose range holds the expected roll (or the nearest one); the value is the expectation itself.
      const t = avail.find((x) => expected >= x.min && expected <= x.max) ?? [...avail].sort((a, b) => Math.abs(mid(a) - expected) - Math.abs(mid(b) - expected))[0];
      return { tier: t.tier, value: Math.min(t.max, Math.max(t.min, expected)) };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Archetypes (build-plan 4.2)
// ---------------------------------------------------------------------------------------------

export type Element = 'fire' | 'cold' | 'lightning' | 'void' | 'physical';
export type Defence = 'armour' | 'evasion';

/** A change to the band's standard affix budget: move `n` affixes of `from` to `to` (to defaults to nothing: dropped). */
export interface GearTweak { from: string; to?: string; n: number }

export interface ArchetypeDef {
  id: string;
  name: string;
  /** The kit the design asks for (build-plan 4.2): skills, passives, augments, uniques. Ids that do not exist yet are `missing`. */
  wants: { skills: string[]; passives: string[]; augments: string[]; uniques: string[]; stats?: string[] };
  /** What runs today: the loadout in slot order (slot 0 is the free basic attack). */
  loadout: SkillId[];
  /** The skill whose damage the archetype is measured by. */
  main: SkillId;
  element: Element;
  defence: Defence;
  /** Affix budget changes on top of the band's (the identity of the gear). */
  tweaks: GearTweak[];
  /** Share of the attribute points spent on Intelligence / Strength (the rest goes to Dexterity). */
  attributes?: { int: number; str: number };
  /**
   * Stand-in for the keystone the design gives the archetype (Glass Orrery: more damage, more damage taken) until the Orrery exists
   * (CAPABILITIES.passives). Applied on top of the band's own `more` and damage-taken stand-ins.
   */
  keystone?: { more: number; damageTaken: number; name: string };
  /** The bot's cast script. */
  cast?: BotOptions['cast'];
  /** One line: what this archetype is for in the acceptance criteria. */
  role: string;
}

const held = (f: (c: Parameters<NonNullable<NonNullable<BotOptions['cast']>['basic']>>[0]) => boolean) => f;

const lanceBasic = held((c) => c.nd < 330);
const crowdNova = held((c) => c.crowd120 >= 2 || c.bd < 160);
const closeFan = held((c) => c.nd < 200 && c.aimClear);
const midRange = held((c) => c.nd < 260 && c.aimClear);
const wardWhenHurt = held((c) => c.p.wardTime <= 0 && (c.crowd60 >= 2 || c.bd < 220 || c.p.life < c.p.maxLife * 0.7));
const blink = held((c) => (c.inDanger || c.crowd60 >= 4 || c.p.life < c.p.maxLife * 0.4 || (c.rooted && c.crowd60 >= 2)) && c.threat > 0.5);

export const ARCHETYPES: readonly ArchetypeDef[] = [
  {
    id: 'pyreLancer', name: 'Pyre Lancer',
    wants: { skills: ['emberLance', 'flameWave'], passives: ['Fire sector', 'Arcana crit', 'Pyre Doctrine'], augments: ['Searing Brand', 'Cinder Fragments'], uniques: [] },
    loadout: ['emberLance', 'flameWave', 'riftStep', 'cinderWard'], main: 'emberLance', element: 'fire', defence: 'armour',
    tweaks: [{ from: 'castSpeed', to: 'critChance', n: 1 }], cast: { basic: lanceBasic, skills: { flameWave: closeFan } },
    role: 'crit and ignite basic attack',
  },
  {
    id: 'novamancer', name: 'Novamancer',
    wants: { skills: ['emberNova', 'echoSigil'], passives: ['Fire sector', 'Arcana area', 'Echo Cascade'], augments: ['Echoing Ring', 'Triple Ring'], uniques: [] },
    loadout: ['emberLance', 'emberNova', 'cinderWard', 'riftStep'], main: 'emberNova', element: 'fire', defence: 'armour',
    tweaks: [{ from: 'critChance', to: 'castSpeed', n: 1 }], cast: { skills: { emberNova: crowdNova, cinderWard: wardWhenHurt } },
    role: 'pack clearing',
  },
  {
    id: 'meteorDoctrine', name: 'Meteor Doctrine',
    wants: { skills: ['immolationSigil', 'meteorRain', 'cinderMortar'], passives: ['Fire sector', 'Arcana cooldown', 'Perfect Tempo'], augments: [], uniques: [], stats: ['cooldown build'] },
    loadout: ['emberLance', 'emberNova', 'flameWave', 'cinderWard'], main: 'emberNova', element: 'fire', defence: 'armour',
    tweaks: [{ from: 'critChance', to: 'cooldownRecovery', n: 1 }], cast: { skills: { emberNova: crowdNova, flameWave: closeFan, cinderWard: wardWhenHurt } },
    role: 'burst on cooldowns',
  },
  {
    id: 'frostfireConverter', name: 'Frostfire Converter',
    wants: { skills: ['emberLance', 'rimeShards', 'frostOrb'], passives: ['Frostfire Gate', 'Frostfire Spiral'], augments: ['Frostfire Core'], uniques: ['frostfireSpiral'], stats: ['conversion'] },
    loadout: ['emberLance', 'rimeShards', 'riftStep'], main: 'emberLance', element: 'fire', defence: 'armour',
    tweaks: [{ from: 'spellDamage', to: 'coldDamage', n: 1 }], cast: { skills: { rimeShards: midRange } },
    role: 'conversion identity (fire and cold)',
  },
  {
    id: 'glacialWarden', name: 'Glacial Warden',
    wants: { skills: ['blizzard', 'glacialNova', 'rimeBulwark'], passives: ['Cold sector', 'Bulwark', 'Absolute Zero'], augments: [], uniques: [] },
    loadout: ['emberLance', 'rimeShards', 'cinderWard', 'riftStep'], main: 'rimeShards', element: 'cold', defence: 'armour',
    tweaks: [{ from: 'critChance', to: 'life', n: 1 }], cast: { skills: { rimeShards: midRange, cinderWard: wardWhenHurt } },
    role: 'control and defence',
  },
  {
    id: 'stormConductor', name: 'Storm Conductor',
    wants: { skills: ['arcChain', 'staticLash'], passives: ['Lightning sector', 'Arcana', "Stormcaller's Lattice"], augments: ['Forking Arc'], uniques: ['stormcallersLattice'], stats: ['extraChains'] },
    loadout: ['emberLance', 'arcChain', 'riftStep'], main: 'arcChain', element: 'lightning', defence: 'armour',
    tweaks: [], cast: { skills: { arcChain: midRange } },
    role: 'chains',
  },
  {
    id: 'staticBarrage', name: 'Static Barrage',
    wants: { skills: ['spark', 'stormCall', 'voltaicPulse'], passives: ['Lightning sector', 'Arcana projectile/area', 'Perfect Tempo'], augments: [], uniques: [] },
    loadout: ['emberLance', 'arcChain', 'rimeShards', 'riftStep'], main: 'arcChain', element: 'lightning', defence: 'armour',
    tweaks: [{ from: 'critChance', to: 'castSpeed', n: 1 }], cast: { skills: { arcChain: midRange, rimeShards: midRange } },
    role: 'cast speed',
  },
  {
    id: 'voidRuin', name: 'Void Ruin',
    wants: { skills: ['umbralBolt', 'witherField', 'entropyHex'], passives: ['Void sector', 'Vitality', 'Hollow Pact'], augments: ['Soulbind Lodge'], uniques: ['hollowCrown'], stats: ['voidDamage affix', 'damageOverTime', 'exposure'] },
    loadout: ['emberLance', 'emberNova', 'cinderWard', 'riftStep'], main: 'emberNova', element: 'void', defence: 'armour',
    tweaks: [{ from: 'castSpeed', to: 'damageOverTime', n: 1 }], cast: { skills: { emberNova: crowdNova, cinderWard: wardWhenHurt } },
    role: 'damage over time and exposure',
  },
  {
    id: 'kineticShatterer', name: 'Kinetic Shatterer',
    wants: { skills: ['kineticLance', 'concussiveBlast'], passives: ['Void (physical)', 'Bulwark', 'Eternal Bastion'], augments: ['Shatter Rounds'], uniques: [], stats: ['physicalDamage affix'] },
    loadout: ['emberLance', 'flameWave', 'cinderWard'], main: 'emberLance', element: 'physical', defence: 'armour',
    tweaks: [{ from: 'castSpeed', to: 'physicalPen', n: 1 }], cast: { skills: { flameWave: closeFan, cinderWard: wardWhenHurt } },
    role: 'physical',
  },
  {
    id: 'evasionBlinker', name: 'Evasion Blinker',
    wants: { skills: ['riftStep', 'stormStep', 'phaseStride', 'spark'], passives: ['Vitality', 'Bulwark', 'Phantom Weave', "Wanderer's Stride"], augments: [], uniques: ['gravewindBoots'] },
    loadout: ['emberLance', 'arcChain', 'riftStep'], main: 'arcChain', element: 'lightning', defence: 'evasion',
    tweaks: [{ from: 'critChance', to: 'moveSpeed', n: 1 }], cast: { skills: { arcChain: midRange, riftStep: blink } },
    attributes: { int: 0.3, str: 0.15 }, role: 'mobility and rush',
  },
  {
    id: 'armourWall', name: 'Armour Wall',
    wants: { skills: ['cinderWard', 'cinderMortar', 'emberNova'], passives: ['Bulwark', 'Vitality', 'Eternal Bastion', 'Unending Vigil'], augments: [], uniques: [] },
    loadout: ['emberLance', 'emberNova', 'cinderWard'], main: 'emberNova', element: 'fire', defence: 'armour',
    tweaks: [{ from: 'critChance', to: 'life', n: 1 }, { from: 'critMultiplier', to: 'armourPercent', n: 1 }], cast: { skills: { emberNova: crowdNova, cinderWard: wardWhenHurt } },
    attributes: { int: 0.25, str: 0.55 }, role: 'tank',
  },
  {
    id: 'focusBattery', name: 'Focus Battery',
    wants: { skills: ['umbralBolt', 'rimeShards', 'arcaneReprieve'], passives: ['Arcana', 'Iron Mind', "Anchorite's Seal"], augments: [], uniques: ['anchoritesSeal'] },
    loadout: ['emberLance', 'rimeShards', 'flameWave', 'cinderWard'], main: 'rimeShards', element: 'cold', defence: 'armour',
    tweaks: [{ from: 'critChance', to: 'focusRegen', n: 1 }, { from: 'critMultiplier', to: 'focus', n: 1 }], cast: { skills: { rimeShards: midRange, flameWave: closeFan } },
    attributes: { int: 0.55, str: 0.25 }, role: 'Focus economy',
  },
  {
    id: 'hexerPenetrator', name: 'Hexer Penetrator',
    wants: { skills: ['entropyHex', 'emberLance'], passives: ['Void + element', 'Razor Doctrine'], augments: ['Hex exposure'], uniques: ['penitentsPrism'], stats: ['penetration', 'exposure'] },
    loadout: ['emberLance', 'emberNova', 'riftStep'], main: 'emberLance', element: 'fire', defence: 'armour',
    tweaks: [{ from: 'castSpeed', to: 'firePen', n: 1 }, { from: 'critChance', to: 'elementalPen', n: 1 }], cast: { skills: { emberNova: crowdNova } },
    role: 'answers proof rares',
  },
  {
    id: 'glassCannon', name: 'Glass Cannon',
    wants: { skills: ['emberLance', 'stormCall'], passives: ['Arcana', 'Glass Orrery', "Gambler's Edge"], augments: [], uniques: [] },
    loadout: ['emberLance', 'arcChain', 'riftStep'], main: 'emberLance', element: 'fire', defence: 'evasion',
    // No resistance, no armour, most of the life gone and every point in Intelligence: the control for "weak builds die". The freed
    // prefixes cannot all carry damage (the caster slots are full), so the gain is the attribute split and the unspent budget.
    tweaks: [{ from: 'res', n: 99 }, { from: 'flat', n: 99 }, { from: 'pct', n: 99 }, { from: 'life', n: 4 }, { from: 'life', to: 'elementalDamage', n: 1 }],
    keystone: { more: 1.3, damageTaken: 1.15, name: 'Glass Orrery' },
    cast: { skills: { arcChain: midRange, riftStep: blink } }, attributes: { int: 0.8, str: 0.02 }, role: 'high damage, low effective life',
  },
  {
    id: 'nakedBaseline', name: 'Naked baseline (B1)',
    wants: { skills: ['emberLance'], passives: [], augments: [], uniques: [] },
    loadout: ['emberLance'], main: 'emberLance', element: 'fire', defence: 'armour', tweaks: [], role: 'the zero: rank-5 Lance, fair gear, no tree',
  },
];

export const ARCHETYPE_BY_ID: Readonly<Record<string, ArchetypeDef>> = Object.fromEntries(ARCHETYPES.map((a) => [a.id, a]));

/** The archetype the band tables are built on: the Lance-class basic attack with the band's own gear (no identity tweaks). */
export const REFERENCE: ArchetypeDef = {
  id: 'reference', name: 'Reference (Lance, band gear)', wants: { skills: ['emberLance'], passives: [], augments: [], uniques: [] },
  loadout: ['emberLance', 'cinderWard'], main: 'emberLance', element: 'fire', defence: 'armour', tweaks: [], role: 'the band tables of power-curve 5.2',
};

/** The 14 archetypes of the acceptance criteria (B1 is separate). */
export const FOURTEEN = ARCHETYPES.filter((a) => a.id !== 'nakedBaseline');

/** What an archetype asks for that the game does not have yet (skills not in SKILL_IDS, missing stats and systems). */
export function missingFor(a: ArchetypeDef, caps: Capabilities = CAPABILITIES): string[] {
  const out: string[] = [];
  for (const s of a.wants.skills) if (!(SKILL_IDS as readonly string[]).includes(s)) out.push(`skill ${s}`);
  if (a.wants.passives.length && !caps.passives) out.push(`passives (${a.wants.passives.join(', ')})`);
  if (a.wants.augments.length && !caps.augments) out.push(`augments (${a.wants.augments.join(', ')})`);
  for (const u of a.wants.uniques) out.push(`unique ${u}`); // TODO(P2/SK6): flips per unique when its behaviour is live
  for (const st of a.wants.stats ?? []) {
    if (st.includes('penetration') && caps.penetration) continue;
    if (st === 'voidDamage affix' && caps.voidDamage) continue;
    if (st === 'physicalDamage affix' && caps.physicalDamage) continue;
    if (st === 'exposure' && caps.exposure) continue;
    if (st === 'conversion' && caps.conversion) continue;
    out.push(`stat ${st}`);
  }
  if (a.element === 'void' && !caps.voidDamage) out.push('void damage affix for the gear');
  if (a.element === 'physical' && !caps.physicalDamage) out.push('physical damage affix for the gear');
  return out;
}

// ---------------------------------------------------------------------------------------------
// Gear
// ---------------------------------------------------------------------------------------------

/** Archetypes that wear bases with a cast-speed implicit (the cast-speed identities); everyone else takes the plain bases the tables use. */
const CAST_IMPLICIT: ReadonlySet<string> = new Set(['staticBarrage', 'novamancer']);

const SLOTS: readonly EquipSlot[] = ['mainHand', 'offHand', 'helmet', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring1', 'ring2'];

/** Bases of a slot, best (highest level requirement) first. `wearable` are the ones the character's level allows. */
function basesFor(slot: EquipSlot, defence: Defence, level: number, o: { castImplicit: boolean }): { wearable: BaseDef[]; all: BaseDef[] } {
  const prop = defence === 'armour' ? 'armor' : 'evasion';
  const noCast = (b: BaseDef) => o.castImplicit || !b.implicits.some((i) => i.stats.includes('castSpeed'));
  const wants: Record<EquipSlot, (b: BaseDef) => boolean> = {
    mainHand: (b) => b.itemClass === 'wand',
    // The tables' offhand is the Cinder Orb (flat crit chance, no cast speed); a cast-speed build takes a cast focus instead.
    offHand: (b) => b.itemClass === 'focus' && (o.castImplicit ? b.implicits.some((i) => i.stats.includes('castSpeed')) : b.id === 'cinderOrb'),
    helmet: (b) => b.itemClass === 'helmet' && hasProp(b, prop),
    chest: (b) => b.itemClass === 'chest' && hasProp(b, prop),
    gloves: (b) => b.itemClass === 'gloves' && hasProp(b, prop) && noCast(b),
    boots: (b) => b.itemClass === 'boots' && hasProp(b, prop),
    belt: (b) => b.itemClass === 'belt' && (defence !== 'armour' || hasProp(b, 'armor') || b.implicits.some((i) => i.stats.includes('maxLife'))),
    amulet: (b) => b.itemClass === 'amulet',
    ring1: (b) => b.itemClass === 'ring' && b.id !== 'voidSignet' && b.id !== 'dusksteelRing',
    ring2: (b) => b.itemClass === 'ring' && b.id !== 'voidSignet' && b.id !== 'dusksteelRing',
  };
  const all = Object.values(BASES).filter((b) => wants[slot](b)).sort((a, b) => b.levelRequirement - a.levelRequirement || a.id.localeCompare(b.id));
  return { all, wearable: all.filter((b) => b.levelRequirement <= level) };
}
const hasProp = (b: BaseDef, stat: StatId) => b.properties.some((p) => p.stat === stat);

/**
 * The base a band wears in a slot: the best the level allows (the tables' armour and evasion columns are built from the best
 * bases). The one exception is the fair weapon, a plain Ashwood Wand (1 + 0.06 per item level, the table's expected roll).
 * When the level allows none (monster levels 4 and 10 of the good and endgame bands are design ceilings, not reachable states)
 * the lowest-level base is worn regardless and the character is flagged `ceiling`.
 */
function pickBase(slot: EquipSlot, defence: Defence, level: number, band: Band, ring: number, o: { castImplicit: boolean }): { base: BaseDef | null; ceiling: boolean } {
  const { wearable, all } = basesFor(slot, defence, level, o);
  if (slot === 'ring1' || slot === 'ring2') {
    const rings = wearable.length ? wearable : all;
    return { base: rings[ring % rings.length] ?? null, ceiling: false };
  }
  if (slot === 'mainHand' && band === 'fair') return { base: all.find((b) => b.id === 'ashwoodWand') ?? all[all.length - 1], ceiling: false };
  if (wearable.length) return { base: wearable[0], ceiling: false };
  return { base: all[all.length - 1] ?? null, ceiling: all.length > 0 };
}

/** Affix demand of a band, with the archetype's tweaks and its element. */
export interface Demand { affixId: string; n: number }

const RES_CYCLE = ['fireResistance', 'coldResistance', 'lightningResistance', 'allResistances', 'voidResistance'];
const ELEMENT_AFFIX: Record<Element, string> = {
  fire: 'fireDamage', cold: 'coldDamage', lightning: 'lightningDamage', void: 'voidDamage', physical: 'physicalDamage',
};

export function demandFor(band: Band, element: Element, defence: Defence, tweaks: readonly GearTweak[]): { demand: Demand[]; notes: string[] } {
  const p: BandParams = BAND_PARAMS[band];
  const notes: string[] = [];
  const d = p.damageAffixes, f = p.defenceAffixes;
  // Pools by role so tweaks can move affixes between roles by name.
  const counts: Record<string, number> = {
    addedSpellDamage: d.added, spellDamage: d.spell, element: d.element, elementalDamage: d.prismatic, castSpeed: d.cast, critChance: d.crit,
    critMultiplier: d.mult, life: f.life, res: f.res, flat: f.flat, pct: f.pct,
  };
  for (const t of tweaks) {
    const have = counts[t.from] ?? 0;
    const moved = Math.min(have, t.n);
    counts[t.from] = have - moved;
    if (t.to) counts[t.to] = (counts[t.to] ?? 0) + moved;
  }
  const elementId = ELEMENT_AFFIX[element];
  const out: Demand[] = [];
  const add = (id: string, n: number) => { if (n > 0) out.push({ affixId: id, n }); };
  for (const [role, n] of Object.entries(counts)) {
    switch (role) {
      case 'element': {
        // A missing element affix (void, physical before P2) falls back to the element of the main skill's family and is reported.
        if (getAffix(elementId)) add(elementId, n);
        else { notes.push(`no ${elementId} affix yet: using fireDamage`); add('fireDamage', n); }
        break;
      }
      case 'res': add('res', n); break;
      case 'flat': add(defence === 'armour' ? 'armourFlat' : 'evasionFlat', n); break;
      case 'pct': add(defence === 'armour' ? 'armourPercent' : 'evasionPercent', n); break;
      case 'elementalDamage': if (element === 'fire' || element === 'cold' || element === 'lightning') add(role, n); else add(getAffix(elementId) ? elementId : 'fireDamage', n); break;
      default: if (getAffix(role)) add(role, n); else notes.push(`no ${role} affix: dropped`);
    }
  }
  // `res` expands into the resistance cycle.
  const expanded: Demand[] = [];
  let r = 0;
  for (const dm of out) {
    if (dm.affixId === 'res') for (let i = 0; i < dm.n; i++) expanded.push({ affixId: RES_CYCLE[r++ % RES_CYCLE.length], n: 1 });
    else expanded.push(dm);
  }
  return { demand: expanded, notes };
}

interface SlotPlan { slot: EquipSlot; base: BaseDef; prefixes: string[]; suffixes: string[] }

/** Greedy assignment of affix demand to slots (most constrained affix first, emptiest slot first). Returns what did not fit. */
export function assignAffixes(plans: SlotPlan[], demand: readonly Demand[], ilvl: number): string[] {
  const units: string[] = [];
  for (const dm of demand) for (let i = 0; i < dm.n; i++) units.push(dm.affixId);
  const eligible = (id: string) => {
    const def = getAffix(id);
    return def ? plans.filter((pl) => affixAllowedOnBase(def, pl.base) && availableTiers(def, ilvl).length > 0) : [];
  };
  const order = units.map((id, i) => ({ id, i, e: eligible(id).length })).sort((a, b) => a.e - b.e || a.i - b.i);
  const left: string[] = [];
  for (const u of order) {
    const def = getAffix(u.id);
    if (!def) { left.push(u.id); continue; }
    const mine = def.kind === 'prefix' ? 'prefixes' : 'suffixes';
    const fits = eligible(u.id)
      .filter((pl) => pl[mine].length < 3 && ![...pl.prefixes, ...pl.suffixes].some((x) => getAffix(x)!.group === def.group))
      .sort((a, b) => a[mine].length - b[mine].length || a.prefixes.length + a.suffixes.length - (b.prefixes.length + b.suffixes.length));
    if (!fits.length) left.push(u.id);
    else fits[0][mine].push(u.id);
  }
  return left;
}

export interface Gear {
  equipment: Partial<Record<EquipSlot, EquipmentItem>>;
  /** Affixes that could not be placed (should stay empty for the standard bands). */
  unplaced: string[];
  notes: string[];
}

export function buildGear(
  band: Band, ml: number, element: Element, defence: Defence, tweaks: readonly GearTweak[], seed = 7, castImplicit = false,
): Gear {
  const level = levelFor(ml);
  const ilvl = Math.max(1, Math.round(ml));
  const plans: SlotPlan[] = [];
  let ring = 0;
  let ceiling = false;
  const opts = { castImplicit };
  for (const slot of SLOTS) {
    const pick = pickBase(slot, defence, level, band, ring, opts);
    if (slot === 'ring1' || slot === 'ring2') ring++;
    if (pick.ceiling) ceiling = true;
    if (pick.base) plans.push({ slot, base: pick.base, prefixes: [], suffixes: [] });
  }
  const { demand, notes } = demandFor(band, element, defence, tweaks);
  if (ceiling) notes.push('design-ceiling row: some bases are above the character level');
  const unplaced = assignAffixes(plans, demand, ilvl);
  const equipment: Gear['equipment'] = {};
  const rng = createRng(seed);
  let uid = 0;
  for (const pl of plans) {
    const ids = [...pl.prefixes, ...pl.suffixes];
    const affixes = ids.flatMap((id) => {
      const pick = pickTier(getAffix(id)!, ilvl, band);
      return pick ? [{ affixId: id, tier: pick.tier, value: pick.value }] : [];
    });
    const rarity = affixes.length === 0 ? 'normal' : affixes.length <= 2 && pl.prefixes.length <= 1 && pl.suffixes.length <= 1 ? 'magic' : 'rare';
    equipment[pl.slot] = buildEquipment({ uid: `h-${pl.slot}-${uid++}`, baseId: pl.base.id as BaseId, itemLevel: ilvl, rarity, affixes }, rng.fork(uid));
  }
  return { equipment, unplaced, notes };
}

// ---------------------------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------------------------

/** Intelligence / Strength shares of the attribute points by band (the rest is Dexterity; the doc's 167 Intelligence at L58 is 40%). */
const ATTRIBUTE_SHARES: Record<Band, { int: number; str: number }> = {
  fair: { int: 0.33, str: 0.34 }, good: { int: 0.4, str: 0.45 }, endgame: { int: 0.4, str: 0.45 },
};

/** The main skill's rank so that its effectiveness matches the band's rank fraction, whatever MAX_SKILL_RANK is. */
export function mainRankFor(ml: number): number {
  return 1 + Math.round(rankFractionFor(ml) * (MAX_SKILL_RANK - 1));
}

// ---------------------------------------------------------------------------------------------
// The character
// ---------------------------------------------------------------------------------------------

export interface BuildOptions {
  archetype?: ArchetypeDef | string;
  band: Band;
  ml: number;
  /** Override the archetype's defence (the band tables list an armour and an evasion column). */
  defence?: Defence;
  seed?: number;
  /** Capabilities (default: what the game has today). */
  caps?: Capabilities;
  /**
   * Until the Orrery exists the tree's defence (life, armour, resistance: the part of the tables' defence columns the gear cannot
   * explain) is a stand-in: the runtime's life, armour and resistances are lifted to the band model's. Off by default so the rules
   * path is measured pure; the sim comparison turns it on so it fights the character the tables describe.
   */
  specDefence?: boolean;
}

export interface Sheet {
  spellPower: number;
  added: number;
  /** Increased damage of the main skill's type: gear + intelligence (rules) + the tree's stand-in. */
  increasedPct: number;
  /** The part of it the rules produce on their own. */
  rulesIncreasedPct: number;
  more: number;
  castX: number;
  critX: number;
  effectiveness: number;
  hit: number;
  castsPerSecond: number;
  /** Single-target DPS of the archetype's main skill, Focus-free. */
  dps: number;
  life: number;
  armour: number;
  evadePct: number;
  /** Mean of the fire, cold and lightning effective resistances, in percent (map penalty applied, caps respected). */
  effectiveResistPct: number;
  resistPct: Record<'fire' | 'cold' | 'lightning' | 'void', number>;
  moveSpeed: number;
  focus: number;
  focusRegen: number;
  damageTaken: number;
}

export interface BuiltCharacter {
  archetype: ArchetypeDef;
  band: Band;
  ml: number;
  level: number;
  save: CharacterSave;
  setup: RunSetup;
  /** The numbers the rules produced alone (no stand-ins). */
  raw: PlayerRuntime;
  /** What the sim gets: raw with the stand-ins of every mechanic the game does not have yet. */
  runtime: PlayerRuntime;
  sheet: Sheet;
  /** What the archetype's design asks for and the game cannot do yet. */
  missing: string[];
  /** Gear affixes that did not fit and fallbacks used. */
  notes: string[];
  /** Stand-ins in force ('tree', 'more', 'damageTaken'). */
  standIns: string[];
}

let cachedSetup: RunSetup | null = null;
/** One plain Tier 1 setup (the rules need a map to hand a runtime out); the monster level is overridden per character. */
function baseSetup(): RunSetup {
  cachedSetup ??= setupFor(mapFixture('ashenForge', 1));
  return cachedSetup;
}

function skillRankFor(arch: ArchetypeDef, id: SkillId, mainRank: number): number {
  if (id === arch.main || id === 'emberLance') return mainRank;
  return Math.max(1, Math.round(mainRank * 0.7));
}

export function buildCharacter(o: BuildOptions): BuiltCharacter {
  const arch = typeof o.archetype === 'string' ? ARCHETYPE_BY_ID[o.archetype] ?? (o.archetype === 'reference' ? REFERENCE : undefined) : o.archetype ?? REFERENCE;
  if (!arch) throw new Error(`unknown archetype ${String(o.archetype)}`);
  const caps = o.caps ?? CAPABILITIES;
  const { band, ml } = o;
  const level = levelFor(ml);
  const defence = o.defence ?? arch.defence;
  // A void or physical archetype has no skill of its element yet (Umbral Bolt, Kinetic Lance arrive with R2/R3): its gear follows the
  // damage type its main skill really deals, so the stub is a coherent fire kit instead of a build that stacks damage it cannot use.
  const skillType = SKILLS[arch.main].runtimeDamageType;
  const element: Element = skillType === arch.element ? arch.element : (skillType as Element);
  const gear = buildGear(band, ml, element, defence, arch.id === 'nakedBaseline' ? [] : arch.tweaks, o.seed ?? 7, CAST_IMPLICIT.has(arch.id));
  if (element !== arch.element) gear.notes.push(`no ${arch.element} skill yet: gear follows ${element}`);

  const shares = arch.attributes ?? ATTRIBUTE_SHARES[band];
  const points = 3 * (level - 1);
  const int = Math.round(points * shares.int), str = Math.round(points * shares.str);
  const allocated = { str, dex: Math.max(0, points - int - str), int };

  const mainRank = arch.id === 'nakedBaseline' ? 5 : mainRankFor(ml);
  const skillRanks = { ...bareCharacter().skillRanks };
  const loadout: (SkillId | null)[] = Array.from({ length: LOADOUT_SLOTS }, () => null);
  arch.loadout.slice(0, LOADOUT_SLOTS).forEach((id, i) => {
    skillRanks[id] = skillRankFor(arch, id, mainRank);
    loadout[i] = id;
  });
  const lifeFlask = flaskStack('lifeFlask', 5, 'h-life');
  const focusFlask = flaskStack('focusFlask', 5, 'h-focus');
  const belt = [{ flaskId: lifeFlask.flaskId, count: 5 }, { flaskId: lifeFlask.flaskId, count: 5 }, { flaskId: focusFlask.flaskId, count: 5 }, null];

  const save: CharacterSave = bareCharacter({
    id: `h-${arch.id}-${band}-${ml}`, name: `H-${arch.id}`, level, allocated, skillRanks, loadout, equipment: gear.equipment, belt,
  });

  const setup: RunSetup = { ...baseSetup(), monsterLevel: ml };
  const raw = rules.playerRuntime(save, setup);

  // --- stand-ins -----------------------------------------------------------------------------
  const tree = treeCredit(ml, band);
  const params = BAND_PARAMS[band];
  const standIns: string[] = [];
  const model = buildPlayerModel(save, mapPlayerModifiers(setup.map, ml, setup.mapTree), undefined, ml);
  const castPct = model.breakdown('castSpeed').value; // 100 + Σ increased
  const useTree = !caps.passives;
  const useMore = !caps.moreSources;
  const key = !caps.passives ? arch.keystone : undefined;
  const moreF = (useMore ? params.more : 1) * (key?.more ?? 1);
  if (useTree) standIns.push('tree');
  if (useMore && params.more !== 1) standIns.push('more');
  if (key) standIns.push(`keystone:${key.name}`);
  if (!caps.passives && params.damageTaken !== 1) standIns.push('damageTaken');
  const rtSkills: SkillRuntimeDef[] = raw.skills.map((s) => {
    if (s.damage <= 0) return s;
    const inc = model.of(...damageStatsFor(s.damageType)).filter((m) => m.mode === 'increased').reduce((x, m) => x + m.value, 0);
    const dmgF = (useTree ? (1 + (inc + tree.incPct) / 100) / (1 + inc / 100) : 1) * moreF;
    const castF = useTree ? (castPct + tree.castPct) / castPct : 1;
    const critF = useTree ? 1 + tree.critPct / 100 : 1;
    return { ...s, damage: s.damage * dmgF, castTime: s.castTime > 0 ? s.castTime / castF : 0, critChance: Math.min(1, s.critChance * critF) };
  });
  let stats = { ...raw.stats, damageTaken: raw.stats.damageTaken * (!caps.passives ? params.damageTaken * (key?.damageTaken ?? 1) : 1) };
  if (o.specDefence && !caps.passives) {
    standIns.push('treeDefence');
    const spec = build(ml, band);
    const lifeF = Math.min(1.8, Math.max(1, spec.life / Math.max(1, raw.stats.maxLife)));
    const armourF = Math.min(2.5, Math.max(1, spec.armour / Math.max(1, raw.stats.armor)));
    const lift = Math.max(0, spec.effectiveResistPct - ((raw.stats.resist.fire + raw.stats.resist.cold + raw.stats.resist.lightning) / 3) * 100);
    const r = (v: number) => Math.min(0.75, v + lift / 100);
    stats = {
      ...stats, maxLife: raw.stats.maxLife * lifeF, armor: raw.stats.armor * armourF,
      resist: { ...raw.stats.resist, fire: r(raw.stats.resist.fire), cold: r(raw.stats.resist.cold), lightning: r(raw.stats.resist.lightning) },
    };
  }
  const runtime: PlayerRuntime = { ...raw, skills: rtSkills, stats };

  // --- sheet of the main skill -----------------------------------------------------------------
  const mainRankNow = skillRanks[arch.main] ?? mainRank;
  const rs = resolveSkill(model, arch.main, mainRankNow);
  const mainRt = runtime.skills.find((s) => s.id === arch.main)!;
  const combat = computeCombat(model).combat;
  const incRules = rs.increased;
  const critX = 1 + mainRt.critChance * (mainRt.critMultiplier - 1);
  const castsPerSecond = mainRt.castTime > 0 ? 1 / mainRt.castTime : 1 / Math.max(0.1, rs.interval);
  const uncappedRes = (k: 'fire' | 'cold' | 'lightning' | 'void') => combat.resist[k] * 100;
  const resistPct = { fire: uncappedRes('fire'), cold: uncappedRes('cold'), lightning: uncappedRes('lightning'), void: uncappedRes('void') };
  const sheet: Sheet = {
    spellPower: rs.basePower - rs.added,
    added: rs.added,
    increasedPct: incRules + (useTree ? tree.incPct : 0),
    rulesIncreasedPct: incRules,
    more: rs.moreMultiplier * moreF,
    castX: (castPct + (useTree ? tree.castPct : 0)) / 100,
    critX,
    effectiveness: rs.effectiveness,
    hit: mainRt.damage * critX,
    castsPerSecond,
    dps: mainRt.damage * critX * castsPerSecond,
    life: combat.maxLife,
    armour: combat.armor,
    evadePct: combat.evasion * 100,
    effectiveResistPct: (resistPct.fire + resistPct.cold + resistPct.lightning) / 3,
    resistPct,
    moveSpeed: combat.moveSpeed,
    focus: combat.maxFocus,
    focusRegen: combat.focusRegen,
    damageTaken: runtime.stats.damageTaken,
  };
  return {
    archetype: arch, band, ml, level, save, setup, raw, runtime, sheet, missing: missingFor(arch, caps),
    notes: [...gear.notes, ...gear.unplaced.map((u) => `unplaced affix ${u}`)], standIns,
  };
}

/** Both defence columns of the band tables for the reference character: armour (life, armour, DPS) and evasion (evade%). */
export function referenceSheets(band: Band, ml: number): { armour: Sheet; evasion: Sheet } {
  return {
    armour: buildCharacter({ archetype: REFERENCE, band, ml, defence: 'armour' }).sheet,
    evasion: buildCharacter({ archetype: REFERENCE, band, ml, defence: 'evasion' }).sheet,
  };
}

// ---------------------------------------------------------------------------------------------
// B2: random allocation
// ---------------------------------------------------------------------------------------------

/** A random legal allocation (seeded): random skills and ranks within the point budget, random attribute split, the band's gear. */
export function randomCharacter(seed: number, band: Band, ml: number): BuiltCharacter {
  const rng = createRng(seed * 40503 + 17);
  const pool = (SKILL_IDS as readonly SkillId[]).filter((id) => id !== 'emberLance');
  const picks = [...pool].sort(() => rng.next() - 0.5).slice(0, 3);
  const damaging = picks.filter((id) => SKILLS[id].effectiveness !== 0);
  const main = damaging[0] ?? 'emberNova';
  const int = 0.2 + rng.next() * 0.5;
  const str = (1 - int) * rng.next();
  const arch: ArchetypeDef = {
    id: `random${seed}`, name: `Random ${seed}`, wants: { skills: [], passives: [], augments: [], uniques: [] }, loadout: ['emberLance', ...picks],
    main, element: SKILLS[main].runtimeDamageType === 'cold' ? 'cold' : SKILLS[main].runtimeDamageType === 'lightning' ? 'lightning' : 'fire',
    defence: rng.next() < 0.5 ? 'armour' : 'evasion', tweaks: [], attributes: { int, str }, role: 'B2 random allocation',
  };
  return buildCharacter({ archetype: arch, band, ml });
}


// ---------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------

/** Print report lines (console.info) and, when CHARACTER_REPORT_FILE is set, append them to that file (tables survive a quiet reporter). */
export function report(lines: readonly string[]): void {
  const text = lines.join('\n');
  console.info(text);
  const file = process.env.CHARACTER_REPORT_FILE;
  if (file) appendFileSync(file, `${text}\n`);
}
