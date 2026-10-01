// Transient feedback: toasts, the level-up burst, the death overlay and the network readout.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, cx } from '../components/common';
import { pingQuality } from '../lib/format';
import { shallowEqual, useStore, useUi } from '../store';

const TOAST_MS = 5200;
/** Toasts never take the pointer (aim and held attacks go to the canvas), so they only expire. */
const MAX_TOASTS = 3;

export function Toasts() {
  const store = useStore();
  const toasts = useUi((s) => s.toasts);
  const scheduled = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id));
    for (const t of toasts) {
      if (scheduled.current.has(t.id)) continue;
      scheduled.current.set(
        t.id,
        setTimeout(() => {
          scheduled.current.delete(t.id);
          store.actions.dismissToast(t.id);
        }, TOAST_MS),
      );
    }
    for (const [id, timer] of scheduled.current) {
      if (!live.has(id)) {
        clearTimeout(timer);
        scheduled.current.delete(id);
      }
    }
  }, [toasts, store]);
  useEffect(() => () => scheduled.current.forEach((t) => clearTimeout(t)), []);
  if (!toasts.length) return null;
  return (
    <div class="fe-toasts" aria-live="polite">
      {toasts.slice(-MAX_TOASTS).map((t) => (
        <div key={t.id} class={cx('fe-toast', `fe-toast--${t.tone}`)}>
          <span class="fe-toast__mark" />
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function LevelUpBurst() {
  const count = useUi((s) => s.levelUpCount);
  const level = useUi((s) => s.hud?.level ?? s.character?.level ?? 0);
  const first = useRef(count);
  const [show, setShow] = useState<number | null>(null);
  useEffect(() => {
    if (count === first.current) return;
    first.current = count;
    setShow(Date.now());
    const t = setTimeout(() => setShow(null), 3400);
    return () => clearTimeout(t);
  }, [count]);
  if (show === null) return null;
  return (
    <div key={show} class="fe-levelup" aria-live="polite">
      <div class="fe-levelup__rays" />
      <div class="fe-levelup__ring" />
      <div class="fe-levelup__kicker">Level up</div>
      <div class="fe-levelup__level">Level {level}</div>
      <div class="fe-levelup__sub">New attribute points and a skill point are waiting</div>
    </div>
  );
}

export function DeathOverlay() {
  const store = useStore();
  const d = useUi(
    (s) => ({
      dead: s.hud?.dead ?? false,
      alive: s.hud?.allies.filter((a) => !a.dead).length ?? 0,
      portals: s.hud?.run?.portalsRemaining ?? 0,
      zone: s.hud?.zone ?? 'hideout',
    }),
    shallowEqual,
  );
  if (!d.dead) return null;
  return (
    <div class="fe-death fe-solid" role="alertdialog" aria-label="You have fallen">
      <div class="fe-death__card">
        <div class="fe-death__title">You have fallen</div>
        <p class="fe-death__line">
          {d.alive > 0
            ? `${d.alive} ${d.alive === 1 ? 'ally fights' : 'allies fight'} on. Your experience and every item you picked up are safe.`
            : 'Your experience and every item you picked up are safe.'}
        </p>
        {d.zone === 'map' && (
          <p class="fe-death__line fe-muted">
            {d.portals > 0 ? `Coming back uses a portal (${d.portals} left).` : 'No portals are left for this map.'}
          </p>
        )}
        <Button variant="ember" size="large" onClick={() => store.actions.respawn()}>
          Return to hideout
        </Button>
      </div>
    </div>
  );
}

export function NetStats() {
  const n = useUi(
    (s) => ({ ping: Math.round(s.hud?.pingMs ?? 0), fps: Math.round(s.hud?.fps ?? 0), showFps: s.settings.showFps, conn: s.connection }),
    shallowEqual,
  );
  const q = pingQuality(n.ping);
  return (
    <div class="fe-net" aria-label="Network status">
      {n.conn === 'reconnecting' ? (
        <span class="fe-net__item fe-net__item--poor">Reconnecting</span>
      ) : (
        <span class={cx('fe-net__item', `fe-net__item--${q}`)}>
          <i class="fe-net__bars" />
          {n.ping} ms
        </span>
      )}
      {n.showFps && <span class="fe-net__item">{n.fps} fps</span>}
    </div>
  );
}
