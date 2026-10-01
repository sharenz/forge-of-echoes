// Text formatting shared by tooltips, crafting previews and history lines.
import { STAT_LABEL, STAT_TEXT } from '../../data/items';
import type { ModLineDef } from '../../data/items';

/** Typographic minus for negative numbers ("−8% to Fire Resistance"). */
export const MINUS = '−';
/** En dash for ranges ("(12–16)"). */
export const EN_DASH = '–';

/** Absolute value, integer when whole, otherwise one decimal. */
export function formatNumber(v: number): string {
  const a = Math.abs(v);
  if (Number.isInteger(a)) return String(a);
  return a.toFixed(1).replace(/\.0$/, '');
}

/** A whole count with thousands separators: "5,000", "1,234", "40" (locale-independent). */
export function formatCount(n: number): string {
  const v = Number.isFinite(n) ? Math.floor(Math.abs(n)) : 0;
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "+24" / "−8". */
export function formatSigned(v: number): string {
  return (v < 0 ? MINUS : '+') + formatNumber(v);
}

/** Resolve a stat text template for a value (see src/data/items/stat-text.ts for placeholders). */
export function fillTemplate(template: string, value: number): string {
  return template.replace(/\{(\+v|v|inc|more|s)\}/g, (_m, key: string) => {
    switch (key) {
      case '+v':
        return formatSigned(value);
      case 'v':
        return formatNumber(value);
      case 'inc':
        return value < 0 ? 'reduced' : 'increased';
      case 'more':
        return value < 0 ? 'less' : 'more';
      default:
        return Math.abs(value) === 1 ? '' : 's';
    }
  });
}

/** The template for a modifier line (explicit text, the stat table, or a generic fallback). */
export function lineTemplate(line: ModLineDef): string {
  if (line.text) return line.text;
  const stat = line.stats[0];
  const table = STAT_TEXT[stat]?.[line.mode];
  if (table) return table;
  const label = STAT_LABEL[stat] ?? stat;
  if (line.mode === 'flat') return `{+v} to ${label}`;
  if (line.mode === 'increased') return `{v}% {inc} ${label}`;
  return `{v}% {more} ${label}`;
}

/** "+24 to maximum Life", "18% increased Fire Damage", "8% reduced maximum Life". */
export function formatLine(line: ModLineDef, value: number): string {
  return fillTemplate(lineTemplate(line), value);
}

/**
 * A modifier line with its whole roll range in place of the value, PoE-style: "+(32–40) to maximum Life",
 * "(24–30)% increased Fire Damage", "Regenerate (8–11) Life per second". A fixed range reads like
 * formatLine. Signs and increased/reduced wording follow the range's larger magnitude.
 */
export function formatRangeLine(line: ModLineDef, min: number, max: number): string {
  if (min === max) return formatLine(line, min);
  const lo = Math.min(Math.abs(min), Math.abs(max));
  const hi = Math.max(Math.abs(min), Math.abs(max));
  const sign = Math.abs(max) >= Math.abs(min) ? Math.sign(max) : Math.sign(min);
  const span = `(${formatNumber(lo)}${EN_DASH}${formatNumber(hi)})`;
  return lineTemplate(line).replace(/\{(\+v|v|inc|more|s)\}/g, (_m, key: string) => {
    switch (key) {
      case '+v':
        return (sign < 0 ? MINUS : '+') + span;
      case 'v':
        return span;
      case 'inc':
        return sign < 0 ? 'reduced' : 'increased';
      case 'more':
        return sign < 0 ? 'less' : 'more';
      default:
        return 's';
    }
  });
}

/** Roll range shown with Alt: "(12–16)"; undefined for fixed values. Uses magnitudes for negative lines. */
export function formatRange(min: number, max: number): string | undefined {
  if (min === max) return undefined;
  const a = Math.abs(min);
  const b = Math.abs(max);
  return `(${formatNumber(Math.min(a, b))}${EN_DASH}${formatNumber(Math.max(a, b))})`;
}

/** Bare range for inline lists: "24–30" (or "1" when fixed). */
export function formatSpan(min: number, max: number): string {
  if (min === max) return formatNumber(min);
  return `${formatNumber(min)}${EN_DASH}${formatNumber(max)}`;
}

/**
 * Round a probability distribution (summing to 1) into `steps` units that add up exactly
 * (largest-remainder method). steps = 100 gives whole percents, 1000 gives tenths.
 */
export function distributeSteps(probs: readonly number[], steps: number): number[] {
  const total = probs.reduce((s, p) => s + p, 0);
  if (total <= 0) return probs.map(() => 0);
  const raw = probs.map((p) => (p / total) * steps);
  const out = raw.map((r) => Math.floor(r));
  let missing = steps - out.reduce((s, v) => s + v, 0);
  const order = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; missing > 0 && k < order.length; k++, missing--) out[order[k].i] += 1;
  return out;
}

/** Tenths of a percent that sum to exactly 1000. */
export function distributeTenths(probs: readonly number[]): number[] {
  return distributeSteps(probs, 1000);
}

/**
 * Format mutually exclusive outcomes so the shown percentages sum to exactly 100%.
 * Whole percents when every outcome is at least 1%, otherwise tenths ("<0.1%" for vanishing ones).
 */
export function formatDistribution(items: readonly { label: string; chance: number }[]): string[] {
  const total = items.reduce((s, o) => s + o.chance, 0) || 1;
  const whole = items.every((o) => o.chance <= 0 || o.chance / total >= 0.01);
  if (whole) {
    const pct = distributeSteps(items.map((o) => o.chance), 100);
    return items.map((o, i) => `${o.label} ${pct[i]}%`);
  }
  const tenths = distributeTenths(items.map((o) => o.chance));
  return items.map((o, i) => {
    const t = tenths[i];
    const text = t === 0 && o.chance > 0 ? '<0.1%' : t % 10 === 0 ? `${t / 10}%` : `${(t / 10).toFixed(1)}%`;
    return `${o.label} ${text}`;
  });
}

/** Format an independent chance (not part of a distribution): "42%", "4.2%", "<0.1%", "100%". */
export function formatChance(p: number): string {
  if (p >= 1 - 1e-9) return '100%';
  const pct = p * 100;
  if (pct >= 10) return `${Math.min(99, Math.round(pct))}%`;
  if (pct >= 0.1) return `${pct.toFixed(1).replace(/\.0$/, '')}%`;
  return p > 0 ? '<0.1%' : '0%';
}

/** Join list entries with a middle dot for compact preview lines. */
export function joinDots(parts: readonly string[]): string {
  return parts.join(' · ');
}

/** "a", "a and b", "a, b and c". */
export function joinWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
