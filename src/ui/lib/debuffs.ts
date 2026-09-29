// Player debuffs on the HUD (GAME_SPEC §13): names, effect and counterplay text for the debuff bar tooltips, the order
// the bar shows them in, and which skill / flask on the command deck is the answer to each. Pure; covered by
// tests/ui/debuffs.test.ts.
import { PLAYER_DEBUFFS, type PlayerDebuff } from '../../contracts/bestiary';
import type { MonsterKind, SkillId } from '../../contracts/content';
import type { HudState } from '../../contracts/ui';
import { formatCooldown } from './format';

export type HudDebuff = HudState['debuffs'][number];

export interface DebuffInfo {
  name: string;
  /** What it does to you, one short line. */
  effect: string;
  /** How to deal with it. */
  counter: string;
  /** Colour family of the frame. */
  tone: 'cold' | 'fire' | 'physical' | 'lightning' | 'void' | 'earth';
  /** Hard control (can't move / act): the bar makes it louder. */
  control: boolean;
  /** Max stacks (1 = refreshes, doesn't stack). */
  maxStacks: number;
  /** A resistance shortens it (elemental durations × (1 − res / 2)). */
  resistance: string | null;
}

export const DEBUFF_INFO: Readonly<Record<PlayerDebuff, DebuffInfo>> = {
  chilled: {
    name: 'Chilled',
    effect: '30% slower movement and casting.',
    counter: 'Cold resistance shortens it. Refreshes; does not stack.',
    tone: 'cold',
    control: false,
    maxStacks: 1,
    resistance: 'Cold',
  },
  frozen: {
    name: 'Frozen',
    effect: 'You cannot move or cast (flasks still work). Afterwards you cannot be frozen for 3 seconds.',
    counter: 'Only telegraphed attacks freeze: step out of the ring before it closes. Cold resistance shortens it.',
    tone: 'cold',
    control: true,
    maxStacks: 1,
    resistance: 'Cold',
  },
  rooted: {
    name: 'Rooted',
    effect: 'You cannot move, but you can still cast. Afterwards no root can hold you for 3 seconds.',
    counter: 'Rift Step breaks it.',
    tone: 'earth',
    control: true,
    maxStacks: 1,
    resistance: null,
  },
  burning: {
    name: 'Burning',
    effect: 'Fire damage over time: 40% of the hit that set you alight. A new burn refreshes it; the strongest stays.',
    counter: 'Your Life flask puts it out. Fire resistance shortens it.',
    tone: 'fire',
    control: false,
    maxStacks: 1,
    resistance: 'Fire',
  },
  bleeding: {
    name: 'Bleeding',
    effect: 'Physical damage over time: 20% of the hit per stack. Deals double damage while you move. Stacks up to 3 times.',
    counter: 'Your Life flask stops it. Standing still avoids the double damage.',
    tone: 'physical',
    control: false,
    maxStacks: 3,
    resistance: null,
  },
  shocked: {
    name: 'Shocked',
    effect: 'You take 20% more damage.',
    counter: 'Lightning resistance shortens it.',
    tone: 'lightning',
    control: false,
    maxStacks: 1,
    resistance: 'Lightning',
  },
  withered: {
    name: 'Withered',
    effect: '−12% to fire, cold, lightning and void resistance per stack. Stacks up to 3 times; each stack refreshes it.',
    counter: 'Your Focus flask removes it.',
    tone: 'void',
    control: false,
    maxStacks: 3,
    resistance: null,
  },
};

/** Bar order: hard control first (it explains why you can't move), then the rest by urgency. */
const ORDER: readonly PlayerDebuff[] = ['frozen', 'rooted', 'chilled', 'shocked', 'withered', 'bleeding', 'burning'];

/**
 * The debuffs the bar shows, in bar order. Ids this client does not know (a newer server) are left out rather than
 * shown without a name or icon.
 */
export function sortDebuffs(list: readonly HudDebuff[]): HudDebuff[] {
  const rank = (id: PlayerDebuff): number => {
    const i = ORDER.indexOf(id);
    return i < 0 ? ORDER.length + PLAYER_DEBUFFS.indexOf(id) : i;
  };
  return list.filter((d) => Object.prototype.hasOwnProperty.call(DEBUFF_INFO, d.id)).sort((a, b) => rank(a.id) - rank(b.id));
}

/** Remaining time under the icon: "1.4s", "12s"; empty when it has run out. */
export function debuffTimeText(remaining: number): string {
  const t = formatCooldown(remaining);
  return t ? `${t}s` : '';
}

/**
 * About to run out: the icon blinks. The window scales with the debuff (the last 30%, at most 0.6 s), so a 0.8 s
 * freeze does not blink for most of its life. Hard control never blinks: it keeps its "you can't move" pulse.
 */
export function debuffEnding(d: HudDebuff): boolean {
  if (DEBUFF_INFO[d.id]?.control) return false;
  return d.remaining > 0 && d.remaining < Math.min(0.6, d.duration * 0.3);
}

/** Share of the duration already gone (0 = fresh, 1 = about to end) for the radial sweep. */
export function debuffElapsed(remaining: number, duration: number): number {
  if (!(duration > 0)) return 0;
  const f = 1 - remaining / duration;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/**
 * The debuff was (re)applied between two HUD updates: it is new, gained a stack, or its timer jumped back up.
 * The bar pulses the icon when this is true.
 */
export function debuffReapplied(prev: HudDebuff | undefined, next: HudDebuff): boolean {
  if (!prev) return true;
  return next.stacks > prev.stacks || next.remaining > prev.remaining + 0.15;
}

/** Equality for the HUD slice: ids, stacks and the timer at 0.1 s resolution (the bar redraws at most 10×/s). */
export function debuffsEqual(a: readonly HudDebuff[], b: readonly HudDebuff[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.stacks !== y.stacks || x.duration !== y.duration) return false;
    if (Math.round(x.remaining * 10) !== Math.round(y.remaining * 10)) return false;
  }
  return true;
}

/** The deck slots that answer the active debuffs: they get a soft "use me" ring while the debuff lasts. */
export function counterplay(debuffs: readonly HudDebuff[]): { skills: SkillId[]; flasks: ('life' | 'focus')[] } {
  const skills = new Set<SkillId>();
  const flasks = new Set<'life' | 'focus'>();
  for (const d of debuffs) {
    if (d.id === 'rooted') skills.add('riftStep');
    if (d.id === 'burning' || d.id === 'bleeding') flasks.add('life');
    if (d.id === 'withered') flasks.add('focus');
  }
  return { skills: [...skills], flasks: [...flasks] };
}

/**
 * The debuffs a monster can put on you (GAME_SPEC §14), for the wave warning. The sim owns the behaviour; this is
 * what the spec promises players, so the Tell banner can say what is coming.
 */
export const MONSTER_DEBUFFS: Readonly<Partial<Record<MonsterKind, readonly PlayerDebuff[]>>> = {
  cinderSpitter: ['burning'],
  riftStalker: ['withered'],
  ashboundHerald: ['withered'],
  cinderMatriarch: ['burning'],
  rimeshade: ['chilled'],
  frostWeaver: ['rooted'],
  glacialWisp: ['chilled', 'frozen'],
  ossuaryGolem: ['chilled'],
  boneChorister: ['chilled'],
  hollowWarden: ['chilled', 'frozen'],
  pitHound: ['bleeding'],
  chainThrall: ['rooted'],
  ironCrossbowman: ['bleeding'],
  tarSlinger: ['rooted'],
  chainmaster: ['rooted', 'bleeding'],
  varkus: ['bleeding'],
};

/** Every debuff a wave can bring, in bar order. */
export function waveDebuffs(kinds: readonly MonsterKind[]): PlayerDebuff[] {
  const out = new Set<PlayerDebuff>();
  for (const k of kinds) for (const d of MONSTER_DEBUFFS[k] ?? []) out.add(d);
  return ORDER.filter((d) => out.has(d));
}
