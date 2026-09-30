// The Atlas "Calm" switch. Motion follows the OS setting (prefers-reduced-motion) unless the viewer picks otherwise;
// the choice is a per-viewer convenience kept in localStorage and shared by the chart, the Codex, the rail and the
// dock so one toggle calms the whole table. Calm switches off parallax, embers, plume sway, pulses, the discovery
// cinematic and the activation/allocation bursts (state still changes, just without the show).
import { useEffect, useState } from 'preact/hooks';

export type MotionPref = 'auto' | 'calm' | 'full';
const KEY = 'foe.atlas.motion.v1';
const listeners = new Set<() => void>();

export function osPrefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function readMotionPref(): MotionPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'calm' || v === 'full' ? v : 'auto';
  } catch { return 'auto'; }
}
export function writeMotionPref(pref: MotionPref): void {
  try { if (pref === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref); } catch { /* per-viewer convenience only */ }
  listeners.forEach((fn) => fn());
}
/** True when animation should be minimal under `pref`. */
export function isCalm(pref: MotionPref, os = osPrefersReducedMotion()): boolean {
  return pref === 'calm' || (pref === 'auto' && os);
}

/** Cycle order: follow the system, then calm, then full motion. */
export const nextPref = (pref: MotionPref): MotionPref => (pref === 'auto' ? 'calm' : pref === 'calm' ? 'full' : 'auto');

export function useMotion(): { calm: boolean; pref: MotionPref; cycle: () => void } {
  const [pref, setPref] = useState<MotionPref>(readMotionPref);
  useEffect(() => {
    const on = (): void => setPref(readMotionPref());
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, []);
  return { calm: isCalm(pref), pref, cycle: () => writeMotionPref(nextPref(pref)) };
}

export const MOTION_LABEL: Record<MotionPref, string> = { auto: 'Motion: system', calm: 'Motion: calm', full: 'Motion: full' };
