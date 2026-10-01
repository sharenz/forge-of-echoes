// Small shared helpers for the progression rules: results, clamping, rank curves, number text.
import type { Result } from '../../contracts/game';
import type { ModifierMode } from '../../contracts/items';
import type { Rng } from '../../contracts/rng';
import type { RankValue } from '../../data/progression';
import { MINUS, formatNumber } from '../items';

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T>(error: string): Result<T> => ({ ok: false, error });

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Finite number or the fallback. */
export function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Integer clamped into [lo, hi]; non-numbers become the fallback. */
export function intIn(v: unknown, lo: number, hi: number, fallback: number): number {
  return clamp(Math.floor(finite(v, fallback)), lo, hi);
}

/** Evaluate a rank-dependent number (see RankValue in src/data/progression/types.ts). */
export function rankValue(v: RankValue, rank: number, maxRank: number): number {
  const r = Math.max(1, Math.floor(rank));
  if (typeof v === 'number') return v;
  if ('lerp' in v) {
    const [a, b] = v.lerp;
    const t = maxRank > 1 ? (Math.min(r, maxRank) - 1) / (maxRank - 1) : 0;
    const x = a + (b - a) * t;
    if (v.round === 'floor') return Math.floor(x + 1e-9);
    if (v.round === 'round') return Math.round(x);
    return x;
  }
  if ('steps' in v) return v.base + v.steps.filter((s) => r >= s).length;
  const n = v.base + Math.floor(Math.max(0, r - v.after) / v.every);
  return v.cap !== undefined ? Math.min(v.cap, n) : n;
}

/** Combine modifiers with the one formula of the game: (base + Σflat) × (1 + Σinc/100) × Π(1 + more/100). */
export function resolveModes(base: number, mods: readonly { mode: ModifierMode; value: number }[]): number {
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

/** Strip floating-point noise from a resolved value (1e-6 precision). */
export function clean(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** A number with its sign kept ("−20", "12.5"): formatNumber alone prints the absolute value. */
export function plainNumber(v: number): string {
  return `${v < 0 ? MINUS : ''}${formatNumber(v)}`;
}

/** "+12%" / "−8%" for a percentage delta (rounded to whole percent unless small). */
export function signedPercent(v: number, decimals = 0): string {
  const r = decimals > 0 ? Number(v.toFixed(decimals)) : Math.round(v);
  return `${r < 0 ? MINUS : '+'}${formatNumber(Math.abs(r))}%`;
}

/** "12%" with up to `decimals` decimals (trailing zeros trimmed). */
export function percent(fraction: number, decimals = 0): string {
  const v = fraction * 100;
  const text = decimals > 0 ? v.toFixed(decimals).replace(/\.?0+$/, '') : String(Math.round(v));
  return `${text}%`;
}

/** Seconds: "0.42 s", "0.3 s" below one second, otherwise one decimal ("3.0 s", "13.7 s"). */
export function seconds(v: number): string {
  if (v < 1) {
    const text = v.toFixed(2).replace(/0$/, '');
    return `${text} s`;
  }
  return `${v.toFixed(1)} s`;
}

/** A number with at most one decimal. */
export function oneDecimal(v: number): string {
  const r = Math.round(v * 10) / 10;
  const text = Number.isInteger(r) ? String(Math.abs(r)) : Math.abs(r).toFixed(1);
  return r < 0 ? `${MINUS}${text}` : text;
}

/** Weighted pick of a count from a {count, weight} table. */
export function rollCountTable(rng: Rng, table: readonly { count: number; weight: number }[]): number {
  return rng.weighted(table, (c) => c.weight)?.count ?? table[0].count;
}

/** Drop labels are drawn with the in-world ASCII pixel font: fold typographic glyphs to ASCII. */
export function asciiLabel(s: string): string {
  return s
    .replace(/[×]/g, 'x')
    .replace(/[−–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e]/g, '');
}

/** Deterministic u32 from a string (for stable per-item choices such as rare map names). */
export function stableIndex(hash: number, length: number): number {
  return length > 0 ? (hash >>> 0) % length : 0;
}
