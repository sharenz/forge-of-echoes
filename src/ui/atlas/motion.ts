// The Atlas "Calm" switch. Motion follows the OS setting (prefers-reduced-motion) unless the viewer picks otherwise;
// the choice is a per-viewer convenience kept in localStorage and shared by the chart, the Codex, the rail and the
// dock so one toggle calms the whole table. Calm switches off parallax, embers, plume sway, pulses, the discovery
// cinematic and the activation/allocation bursts (state still changes, just without the show). On "system" (auto) the game's own
// Screen shake slider at 0 counts as a wish for a still screen too (brief A 5.4), so it calms the table like the OS setting.
import { useContext, useEffect, useState } from 'preact/hooks';
import { StoreContext } from '../store';

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
/** True when animation should be minimal under `pref`; `stillScreen` = the game's screen shake is off. */
export function isCalm(pref: MotionPref, os = osPrefersReducedMotion(), stillScreen = false): boolean {
  return pref === 'calm' || (pref === 'auto' && (os || stillScreen));
}

/** Cycle order: follow the system, then calm, then full motion. */
export const nextPref = (pref: MotionPref): MotionPref => (pref === 'auto' ? 'calm' : pref === 'calm' ? 'full' : 'auto');

export function useMotion(): { calm: boolean; pref: MotionPref; cycle: () => void } {
  const [pref, setPref] = useState<MotionPref>(readMotionPref);
  // The store is optional here (dev sandboxes render parts of the table without one).
  const store = useContext(StoreContext);
  const stillOf = (): boolean => (store?.get().settings?.screenShake ?? 1) <= 0;
  const [still, setStill] = useState<boolean>(stillOf);
  useEffect(() => {
    const on = (): void => setPref(readMotionPref());
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, []);
  useEffect(() => {
    if (!store) return;
    const check = (): void => setStill(stillOf());
    check();
    return store.subscribe(check);
  }, [store]);
  return { calm: isCalm(pref, osPrefersReducedMotion(), still), pref, cycle: () => writeMotionPref(nextPref(pref)) };
}

export const MOTION_LABEL: Record<MotionPref, string> = { auto: 'Motion: system', calm: 'Motion: calm', full: 'Motion: full' };
