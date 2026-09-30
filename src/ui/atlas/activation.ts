// Activation feedback plumbing (brief A, 6.7). Activating a map is decided in MapDevice and answered by the server with
// an open portal (hud.portal). The table watches that portal: a NEW one means "the device just lit", which flares the
// course node on the chart and closes a sigil ring over the dock's map slot; an open portal also pins a portal glyph
// to the node it leads to. The portal carries no area id, so the area that was the course at that moment is remembered
// per viewer (localStorage) against the portal's identity.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PortalInfo } from '../../contracts/net';
import { useUi } from '../store';

export interface ActivationSnap {
  /** Counts activations seen while the table was open. */
  pulse: number;
  /** The area the open portal leads to, when known. */
  area: string | null;
  /** Portal identity the area belongs to. */
  sig: string | null;
}

const KEY = 'foe.atlas.portal.v1';
let snap: ActivationSnap = { pulse: 0, area: null, sig: null };
const subs = new Set<() => void>();
const notify = (): void => subs.forEach((fn) => fn());

export const portalSig = (p: Pick<PortalInfo, 'ownerCharacterId' | 'mapName' | 'tier'>): string => `${p.ownerCharacterId}|${p.mapName}|${p.tier}`;

/**
 * True when `next` is a portal that was just opened: a fresh one (every entry still unused) that replaces nothing, another
 * map, or the same map with its counter refilled. A portal that is already part-used is never "new".
 */
export function isNewActivation(prev: PortalInfo | null, next: PortalInfo | null): boolean {
  if (!next || next.cleared || next.remaining < next.total) return false;
  if (!prev) return true;
  return prev.ownerCharacterId !== next.ownerCharacterId || prev.mapName !== next.mapName || prev.tier !== next.tier || next.remaining > prev.remaining;
}

export function portalOpen(p: PortalInfo | null): boolean { return !!p && p.remaining > 0 && !p.cleared; }

function readStored(): { sig: string; area: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.sig === 'string' && typeof v.area === 'string' ? v : null;
  } catch { return null; }
}
function writeStored(sig: string, area: string): void {
  try { localStorage.setItem(KEY, JSON.stringify({ sig, area })); } catch { /* per-viewer convenience only */ }
}

/** Mounted once by the chart: turns portal changes into pulses and remembers which area the portal leads to. */
export function useActivationWatcher(courseId: string): void {
  const portal = useUi((s) => s.hud?.portal ?? null);
  const own = useUi((s) => s.hud?.zoneIsOwn ?? true);
  const prev = useRef<PortalInfo | null | undefined>(undefined);
  const course = useRef(courseId);
  course.current = courseId;
  useEffect(() => {
    const p = portal && own ? portal : null;
    if (prev.current === undefined) {
      const stored = p ? readStored() : null;
      snap = { ...snap, area: p && stored && stored.sig === portalSig(p) ? stored.area : null, sig: p ? portalSig(p) : null };
      prev.current = p ? { ...p } : null;
      notify();
      return;
    }
    if (p && isNewActivation(prev.current, p)) {
      const sig = portalSig(p);
      snap = { pulse: snap.pulse + 1, area: course.current, sig };
      writeStored(sig, course.current);
      notify();
    } else if (!p && snap.area) {
      snap = { ...snap, area: null, sig: null };
      notify();
    }
    // a copy: the store may update a portal object in place
    prev.current = p ? { ...p } : null;
  }, [own, portal ? `${portal.ownerCharacterId}|${portal.mapName}|${portal.tier}|${portal.remaining}|${portal.total}|${portal.cleared}` : '']);
}

/** The latest activation state (pulse counter and portal target). */
export function useActivation(): ActivationSnap {
  const [s, setS] = useState(snap);
  useEffect(() => {
    const on = (): void => setS(snap);
    subs.add(on);
    on();
    return () => { subs.delete(on); };
  }, []);
  return s;
}

/** Test seam: reset the shared state. */
export function resetActivation(): void { snap = { pulse: 0, area: null, sig: null }; notify(); }
