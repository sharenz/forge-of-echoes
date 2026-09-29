import type { StatModifier, StatBreakdown, StatId } from '../contracts/items';

/**
 * The one numeric contract of the game:
 *   value = (base + Σflat) × (1 + Σincreased/100) × Π(1 + more/100)
 * Used for player stats, monster scaling, map quantity/rarity — everything.
 */
export function resolveStat(base: number, mods: readonly StatModifier[]): number {
  let flat = 0;
  let increased = 0;
  let more = 1;
  for (const m of mods) {
    if (m.mode === 'flat') flat += m.value;
    else if (m.mode === 'increased') increased += m.value;
    else more *= 1 + m.value / 100;
  }
  return (base + flat) * (1 + increased / 100) * more;
}

/** Resolve with a full, labelled breakdown so the UI can explain every number. */
export function resolveStatBreakdown(stat: StatId, base: number, mods: readonly StatModifier[]): StatBreakdown {
  let flat = 0;
  let increased = 0;
  const more: number[] = [];
  const sources: StatModifier[] = [];
  for (const m of mods) {
    if (m.stat !== stat) continue;
    sources.push(m);
    if (m.mode === 'flat') flat += m.value;
    else if (m.mode === 'increased') increased += m.value;
    else more.push(m.value);
  }
  const moreMult = more.reduce((acc, v) => acc * (1 + v / 100), 1);
  return { stat, base, flat, increased, more, value: (base + flat) * (1 + increased / 100) * moreMult, sources };
}
