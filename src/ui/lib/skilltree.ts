// Skills panel v2 (docs/power-rework/skills.md 10): the skill book rail grouped by element, the augment graph of one skill
// (tiers at ranks 2/5/8, slots, exclusions, costs) and before/after number deltas for ranks, augments and Alt comparisons.
// Everything is read generically from SkillInfo, so a skill appears as soon as its data says `available`. Pure; covered by
// tests/ui/skills-panel.test.ts (which also checks the augment states against rules.canPickAugment).
import type { SkillId } from '../../contracts/content';
import type { AugmentInfo, SkillElement, SkillInfo } from '../../contracts/game';
import type { CharacterSave } from '../../contracts/items';
import type { SkillRuntimeDef } from '../../contracts/sim';
import { AUGMENT_RULES } from '../../data/progression';

export const ELEMENT_ORDER: readonly SkillElement[] = ['fire', 'cold', 'lightning', 'void', 'physical', 'utility'];
export const ELEMENT_LABEL: Readonly<Record<SkillElement, string>> = {
  fire: 'Fire',
  cold: 'Cold',
  lightning: 'Lightning',
  void: 'Void',
  physical: 'Physical',
  utility: 'Utility',
};

// ---------------------------------------------------------------------------------------------
// Skill book
// ---------------------------------------------------------------------------------------------

/** learned: rank ≥ 1; learnable: your level reached its unlock level; locked: "Level 28". */
export type BookState = 'learned' | 'learnable' | 'locked';

export interface BookEntry {
  id: SkillId;
  name: string;
  rank: number;
  maxRank: number;
  unlockLevel: number;
  state: BookState;
  /** Loadout slot index, or -1. */
  slot: number;
  /** Augments picked on it. */
  augments: number;
}

export interface BookGroup {
  element: SkillElement;
  label: string;
  entries: BookEntry[];
}

export interface SkillBook {
  groups: BookGroup[];
  /** Flat order of the visible entries (keyboard navigation). */
  order: SkillId[];
  /** Skills in the data whose behaviour has not shipped yet (hidden from the rail; the rail says how many are coming). */
  coming: number;
}

type BookCharacter = Pick<CharacterSave, 'level' | 'skillRanks' | 'loadout'> & Partial<Pick<CharacterSave, 'augments'>>;

/** Lower-case words of a search box; every word must match the name, a tag or the element. */
export function matchesSkill(info: SkillInfo, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [info.name, info.element, ELEMENT_LABEL[info.element] ?? '', ...info.tags].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function skillBook(skills: readonly SkillInfo[], ch: BookCharacter, query = ''): SkillBook {
  const level = ch.level ?? 1;
  let coming = 0;
  const groups: BookGroup[] = [];
  for (const element of ELEMENT_ORDER) {
    const entries: BookEntry[] = [];
    for (const s of skills) {
      if ((s.element ?? 'utility') !== element) continue;
      const rank = ch.skillRanks[s.id] ?? 0;
      // A skill whose behaviour has not shipped stays out of the book (unless a save somehow holds ranks in it).
      if (!s.available && rank < 1) {
        coming++;
        continue;
      }
      if (!matchesSkill(s, query)) continue;
      entries.push({
        id: s.id,
        name: s.name,
        rank,
        maxRank: s.maxRank,
        unlockLevel: s.unlockLevel ?? 1,
        state: rank > 0 ? 'learned' : level >= (s.unlockLevel ?? 1) ? 'learnable' : 'locked',
        slot: ch.loadout.indexOf(s.id),
        augments: ch.augments?.[s.id]?.length ?? 0,
      });
    }
    entries.sort((a, b) => a.unlockLevel - b.unlockLevel || a.name.localeCompare(b.name));
    if (entries.length) groups.push({ element, label: ELEMENT_LABEL[element], entries });
  }
  return { groups, order: groups.flatMap((g) => g.entries.map((e) => e.id)), coming };
}

/** The entry `step` places after `from` in the flat book order (arrow keys); wraps around. */
export function stepBook(order: readonly SkillId[], from: SkillId | null, step: number): SkillId | null {
  if (!order.length) return null;
  const i = from ? order.indexOf(from) : -1;
  if (i < 0) return order[step < 0 ? order.length - 1 : 0];
  return order[(((i + step) % order.length) + order.length) % order.length];
}

// ---------------------------------------------------------------------------------------------
// Augment graph
// ---------------------------------------------------------------------------------------------

/**
 * picked; open (pickable now); needsRank (tier gate); excluded (an incompatible augment is picked); noSlot (every slot is
 * used); noPoints; coming (its behaviour ships later). Same order of checks as rules.canPickAugment.
 */
export type AugmentState = 'picked' | 'open' | 'needsRank' | 'excluded' | 'noSlot' | 'noPoints' | 'coming';

export interface AugmentNode {
  info: AugmentInfo;
  state: AugmentState;
  /** Name of the picked augment that excludes it (state 'excluded'). */
  excludedBy: string | null;
  /** Names of the other augments it cannot be combined with (shown as a chain on the plate). */
  excludes: string[];
}

export interface AugmentTier {
  tier: 1 | 2 | 3;
  rankRequired: number;
  /** Your skill rank reaches the tier. */
  unlocked: boolean;
  nodes: AugmentNode[];
}

export interface AugmentGraph {
  tiers: AugmentTier[];
  /** Slots at the current rank: floor(rank / 2), at most 5. */
  slots: number;
  used: number;
  maxSlots: number;
  /** The rank that opens the next slot (null at max slots). */
  nextSlotRank: number | null;
}

/** Augment slots at a rank (mirrors the rules: floor(rank / ranksPerSlot), at most maxSlots). */
export function augmentSlotsAt(rank: number): number {
  return Math.max(0, Math.min(AUGMENT_RULES.maxSlots, Math.floor(Math.max(0, rank) / AUGMENT_RULES.ranksPerSlot)));
}

/** Exclusion is symmetric: either augment naming the other excludes both. */
function excludesEither(a: AugmentInfo, b: AugmentInfo): boolean {
  return (a.excludes ?? []).includes(b.id) || (b.excludes ?? []).includes(a.id);
}

export function augmentGraph(info: SkillInfo, rank: number, picked: readonly string[], points: number): AugmentGraph {
  const slots = augmentSlotsAt(rank);
  const pickedInfos = info.augments.filter((a) => picked.includes(a.id));
  const used = pickedInfos.length;
  const stateOf = (a: AugmentInfo): { state: AugmentState; excludedBy: string | null } => {
    if (picked.includes(a.id)) return { state: 'picked', excludedBy: null };
    if (!a.available) return { state: 'coming', excludedBy: null };
    if (rank < a.rankRequired) return { state: 'needsRank', excludedBy: null };
    const blocker = pickedInfos.find((p) => excludesEither(a, p));
    if (blocker) return { state: 'excluded', excludedBy: blocker.name };
    if (used >= slots) return { state: 'noSlot', excludedBy: null };
    if (points < a.cost) return { state: 'noPoints', excludedBy: null };
    return { state: 'open', excludedBy: null };
  };
  const tiers: AugmentTier[] = ([1, 2, 3] as const)
    .map((tier) => {
      const list = info.augments.filter((a) => a.tier === tier);
      const rankRequired = list[0]?.rankRequired ?? AUGMENT_RULES.tierRank[tier];
      return {
        tier,
        rankRequired,
        unlocked: rank >= rankRequired,
        nodes: list.map((a) => ({
          info: a,
          ...stateOf(a),
          excludes: info.augments.filter((b) => b.id !== a.id && excludesEither(a, b)).map((b) => b.name),
        })),
      };
    })
    .filter((t) => t.nodes.length > 0);
  let nextSlotRank: number | null = null;
  if (slots < AUGMENT_RULES.maxSlots) nextSlotRank = (slots + 1) * AUGMENT_RULES.ranksPerSlot;
  if (nextSlotRank !== null && nextSlotRank > info.maxRank) nextSlotRank = null;
  return { tiers, slots, used, maxSlots: AUGMENT_RULES.maxSlots, nextSlotRank };
}

/** The character with one more augment picked (for before/after previews; the rules resolve augments by id). */
export function withAugment<T extends Pick<CharacterSave, 'augments'>>(ch: T, skill: SkillId, augmentId: string): T {
  const cur = ch.augments?.[skill] ?? [];
  if (cur.includes(augmentId)) return ch;
  return { ...ch, augments: { ...(ch.augments ?? {}), [skill]: [...cur, augmentId] } };
}

/** The character without one augment (preview of a refund). */
export function withoutAugment<T extends Pick<CharacterSave, 'augments'>>(ch: T, skill: SkillId, augmentId: string): T {
  const cur = ch.augments?.[skill] ?? [];
  if (!cur.includes(augmentId)) return ch;
  return { ...ch, augments: { ...(ch.augments ?? {}), [skill]: cur.filter((id) => id !== augmentId) } };
}

// ---------------------------------------------------------------------------------------------
// Number deltas
// ---------------------------------------------------------------------------------------------

export interface SheetNumbers {
  runtime: SkillRuntimeDef;
  dps: number | null;
}

export interface Delta {
  label: string;
  from: string;
  to: string;
  /** The change is an improvement (green) rather than a cost (red). */
  better: boolean;
}

const int = (v: number): string => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v)));
const num1 = (v: number): string => (Math.abs(v) < 10 ? (Math.round(v * 10) / 10).toString() : int(v));
const secs = (v: number): string => `${(Math.round(v * 100) / 100).toString()} s`;
const pct = (v: number): string => `${Math.round(v * 100)}%`;

interface Metric {
  label: string;
  get: (n: SheetNumbers) => number;
  fmt: (v: number) => string;
  /** Lower is better (costs, cooldowns, cast times). */
  lower?: boolean;
}

const METRICS: readonly Metric[] = [
  { label: 'Damage per second', get: (n) => n.dps ?? 0, fmt: int },
  { label: 'Damage per hit', get: (n) => n.runtime.damage, fmt: num1 },
  { label: 'Projectiles', get: (n) => n.runtime.projectiles, fmt: int },
  { label: 'Pierce', get: (n) => n.runtime.pierce, fmt: int },
  { label: 'Chains', get: (n) => n.runtime.chains, fmt: int },
  { label: 'Radius', get: (n) => n.runtime.radius, fmt: int },
  { label: 'Range', get: (n) => n.runtime.range, fmt: int },
  { label: 'Duration', get: (n) => n.runtime.duration, fmt: secs },
  { label: 'Distance', get: (n) => n.runtime.distance, fmt: int },
  { label: 'Damage reduction', get: (n) => n.runtime.damageReduction, fmt: pct },
  { label: 'Charges', get: (n) => n.runtime.charges, fmt: int },
  { label: 'Critical chance', get: (n) => n.runtime.critChance, fmt: pct },
  { label: 'Ailment chance', get: (n) => n.runtime.ailmentChance, fmt: pct },
  { label: 'Focus cost', get: (n) => n.runtime.focusCost, fmt: num1, lower: true },
  { label: 'Cooldown', get: (n) => n.runtime.cooldown, fmt: secs, lower: true },
  { label: 'Cast time', get: (n) => n.runtime.castTime, fmt: secs, lower: true },
];

/**
 * The numbers that differ between two sheets ("Damage per hit 38 → 45"): a rank up, an augment picked or refunded, or two
 * different skills side by side (Alt comparison). Values that read the same after rounding are left out.
 */
export function sheetDeltas(before: SheetNumbers, after: SheetNumbers): Delta[] {
  const out: Delta[] = [];
  for (const m of METRICS) {
    const a = m.get(before);
    const b = m.get(after);
    if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) continue;
    const from = m.fmt(a);
    const to = m.fmt(b);
    if (from === to) continue;
    out.push({ label: m.label, from, to, better: m.lower ? b < a : b > a });
  }
  return out;
}

/** Plain-text form of a delta for compact lists and aria labels. */
export function deltaText(d: Delta): string {
  return `${d.label} ${d.from} → ${d.to}`;
}

// ---------------------------------------------------------------------------------------------
// Refund confirmation
// ---------------------------------------------------------------------------------------------

export interface RefundSummary {
  /** Confirm button: "Refund for 8 Scrap" / "Refund for free". */
  confirm: string;
  /** Dialog lines: points back, which are free and why, the Scrap price against what you hold. */
  lines: string[];
  /** You hold enough Scrap (backpack, stash and Crafting Stash). */
  affordable: boolean;
}

/**
 * What a refund dialog says before the player confirms (the price is the one sent as `expectedScrap`). Prices follow
 * RESPEC: free below `freeBelowLevel`, the first free refund points of a character free, then Scrap per point.
 */
export function refundSummary(
  price: { points: number; freePoints: number; scrap: number },
  level: number,
  scrapOnHand: number,
  freeBelowLevel: number,
): RefundSummary {
  const pts = (n: number): string => `${n} skill point${n === 1 ? '' : 's'}`;
  const lines = [`You get ${pts(price.points)} back to spend again.`];
  if (price.scrap === 0) {
    lines.push(level < freeBelowLevel ? `Free: refunds cost nothing below level ${freeBelowLevel}.` : 'Free: your free refund points cover it.');
  } else {
    if (price.freePoints > 0) lines.push(`${pts(price.freePoints)} of it ${price.freePoints === 1 ? 'is' : 'are'} free (your last free refund points).`);
    lines.push(`Costs ${price.scrap} Forge Scrap. You have ${scrapOnHand}.`);
  }
  return {
    confirm: price.scrap > 0 ? `Refund for ${price.scrap} Scrap` : 'Refund for free',
    lines,
    affordable: scrapOnHand >= price.scrap,
  };
}
