// Pure display formatting helpers (no DOM). Covered by tests/ui/helpers.test.ts.

export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Safe fraction a / b in 0..1 (0 when b <= 0). */
export function fraction(a: number, b: number): number {
  return b > 0 ? clamp01(a / b) : 0;
}

/** Integer with thousands separators: 12345 → "12,345". */
export function formatInt(n: number): string {
  const r = Math.round(n);
  const s = Math.abs(r)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return r < 0 ? `-${s}` : s;
}

/** Elapsed time: 67 → "1:07", 3725 → "1:02:05". */
export function formatDuration(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Cooldown label on a skill slot: one decimal under 10 s, whole seconds above. Empty when ready. */
export function formatCooldown(seconds: number): string {
  if (!(seconds > 0.05)) return '';
  if (seconds < 10) return seconds.toFixed(1);
  return String(Math.ceil(seconds));
}

/** "Mira" → "Mira's", "Aris" → "Aris'". */
export function possessive(name: string): string {
  const n = name.trim();
  if (!n) return 'Unknown';
  return /s$/i.test(n) ? `${n}'` : `${n}'s`;
}

/** Signed number for deltas: 3 → "+3", -2.5 → "−2.5" (true minus sign), 0 → "0". */
export function formatSigned(n: number, digits = 0): string {
  const v = Number(n.toFixed(digits));
  if (v === 0) return '0';
  const body = Math.abs(v).toFixed(digits);
  return v > 0 ? `+${body}` : `−${body}`;
}

/** Personal luck as shown on the HUD: 100 → "+0%", 164 → "+64%", 90 → "−10%". */
export function formatLuck(percentOfBase: number): string {
  const v = Math.round(percentOfBase - 100);
  return v < 0 ? `−${-v}%` : `+${v}%`;
}

/** Latency colour class bucket. */
export function pingQuality(ms: number): 'good' | 'fair' | 'poor' {
  if (ms < 90) return 'good';
  if (ms < 180) return 'fair';
  return 'poor';
}

/** Local clock time "14:05" for chat lines. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
