import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { MAX_PARTY_SIZE } from '../../contracts/net';
import { Button } from './common';
import { useLocal } from '../local';
import { useSignal, useStore, useUi } from '../store';

/** The same player actions are available from chat and the party portraits. */
export function PlayerMenu() {
  const local = useLocal();
  const menu = useSignal(local.playerMenu);
  const store = useStore();
  const party = useUi((s) => s.party);
  const me = useUi((s) => s.character);
  const trade = useUi((s) => s.trade);
  const root = useRef<HTMLDivElement>(null);
  const close = () => local.playerMenu.set(null);
  useEffect(() => () => local.playerMenu.set(null), [local]);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);
  useLayoutEffect(() => {
    const el = root.current;
    if (!menu || !el) return;
    el.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - el.offsetHeight - 8))}px`;
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [menu]);
  if (!menu) return null;
  const self = me?.name === menu.name;
  const member = party?.members.find((m) => m.characterId === menu.characterId || m.name === menu.name);
  const invite = !self && !member && (!party || (party.leaderId === me?.id && party.members.length < MAX_PARTY_SIZE));
  const run = (fn: () => void) => { close(); fn(); };
  const visit = () => {
    if (!member) return;
    const go = () => store.actions.visitHideout(member.characterId);
    const state = store.get();
    if (state.zone === 'map' && state.hud?.run) {
      const map = state.hud.run;
      const back = map.portalsRemaining > 0
        ? `Returning to ${map.mapName} costs a portal (${map.portalsRemaining} left).`
        : 'No portals are left, so you cannot come back.';
      local.dialog.set({ title: 'Leave map', body: `Join ${menu.name}'s hideout? ${back}`, confirmLabel: 'Join hideout', danger: map.portalsRemaining === 0, onConfirm: go });
    } else go();
  };
  return (
    <div ref={root} class="fe-player-menu fe-solid" role="dialog" aria-label={`Player actions for ${menu.name}`} style={{ left: menu.x, top: menu.y }}>
      <strong>{menu.name}</strong>
      {!self && !member && <Button disabled={!invite} onClick={() => run(() => store.actions.partyInvite(menu.name))}>Invite to party</Button>}
      {member && <Button disabled={!member.online} onClick={() => run(visit)}>Join hideout</Button>}
      {!self && <Button disabled={!!trade || (member && !member.online)} onClick={() => run(() => store.actions.tradeRequest(menu.name))}>Trade</Button>}
      <Button variant="ghost" onClick={close}>Close</Button>
    </div>
  );
}
