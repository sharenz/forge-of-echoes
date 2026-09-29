// Trade window (GAME_SPEC §12; docked left with the inventory). Two sides: the partner's offer (read-only, full
// tooltips with Alt compare) and yours (a drop zone for backpack items: drag or Ctrl-click them in; click one to take
// it back; at most TRADE_MAX_ITEMS). Offered items stay in your backpack, locked. Accepting is a toggle; after any
// offer change the server blocks it for TRADE_ACCEPT_LOCK_MS (acceptLockedUntil is server time, so the countdown
// uses state.serverClockOffset). Closing the window on purpose (its X, Esc, Cancel) cancels the trade; hiding it
// behind another panel does not (see screens/Game.tsx and the HUD trade chip).
import type { JSX } from 'preact';
import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import type { Item } from '../../contracts/items';
import { TRADE_ACCEPT_LOCK_MS, TRADE_MAX_ITEMS, type TradeInfo } from '../../contracts/net';
import { Button, PixelIcon, cx } from '../components/common';
import { safe } from '../items/hooks';
import { useLocal } from '../local';
import { possessive } from '../lib/format';
import { itemIconId, itemTone, stackCount } from '../lib/items';
import { acceptLockLeft, addedUids, offerWithout } from '../lib/trade';
import { useSignal, useStore, useUi } from '../store';
import { PanelShell } from './PanelShell';

const FRESH_MS = 2600;

function Tile({ item, onClick, onEnter, fresh, removable }: {
  item: Item;
  onClick?: (e: MouseEvent) => void;
  onEnter: (el: Element) => void;
  fresh?: boolean;
  removable?: boolean;
}) {
  const store = useStore();
  const local = useLocal();
  const size = safe(() => store.rules.itemSize(item), { w: 1, h: 1 });
  const span = Math.max(size.w, size.h);
  const count = stackCount(item);
  const style: JSX.CSSProperties = { width: `${(78 * size.w) / span}%`, height: `${(78 * size.h) / span}%` };
  return (
    <button
      type="button"
      class={cx('fe-ttile', `fe-item--${itemTone(item)}`, fresh && 'fe-ttile--fresh', removable && 'fe-ttile--removable')}
      data-uid={item.uid}
      onPointerEnter={(e) => onEnter(e.currentTarget)}
      onPointerLeave={() => local.hideTooltip()}
      onClick={(e) => onClick?.(e as unknown as MouseEvent)}
      tabIndex={onClick ? 0 : -1}
    >
      <PixelIcon id={itemIconId(item)} class="fe-ttile__icon" width={style.width as string} height={style.height as string} />
      {count !== null && <span class="fe-item__count">{count}</span>}
      {item.kind === 'map' && <span class="fe-item__tier">T{item.tier}</span>}
      {removable && <span class="fe-ttile__x" aria-hidden="true" />}
    </button>
  );
}

function EmptyTiles({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <span key={`e${i}`} class="fe-ttile fe-ttile--empty" aria-hidden="true" />
      ))}
    </>
  );
}

function SideHead({ title, count, accepted, who }: { title: string; count: number; accepted: boolean; who: string }) {
  return (
    <div class="fe-tside__head">
      <span class="fe-tside__title">{title}</span>
      <span class="fe-tside__n">
        {count}/{TRADE_MAX_ITEMS}
      </span>
      <span class={cx('fe-tside__state', accepted && 'fe-tside__state--on')} title={accepted ? `${who} accepted` : `${who} has not accepted`}>
        <i class="fe-tside__check" aria-hidden="true" />
        {accepted ? 'Accepted' : 'Not accepted'}
      </span>
    </div>
  );
}

/** Re-renders at ~20 Hz while the accept lock runs, so the countdown ring moves. */
function useLockLeft(trade: TradeInfo, offset: number): number {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const left = acceptLockLeft(trade, Date.now(), offset);
  const running = left > 0;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick(0), 50);
    return () => clearInterval(t);
  }, [running, trade.acceptLockedUntil, offset]);
  return left;
}

function AcceptControl({ trade }: { trade: TradeInfo }) {
  const store = useStore();
  const offset = useUi((s) => s.serverClockOffset);
  const left = useLockLeft(trade, offset);
  const locked = left > 0;
  const both = trade.youAccepted && trade.theyAccepted;
  const empty = trade.yourItems.length === 0 && trade.theirItems.length === 0;
  const frac = locked ? left / TRADE_ACCEPT_LOCK_MS : 0;

  let status: string;
  if (both) status = 'Both accepted. Completing the trade…';
  else if (locked) status = 'An offer changed: both accepts were cleared. Look again before accepting.';
  else if (trade.youAccepted) status = `Waiting for ${trade.partnerName}. Click again to withdraw.`;
  else if (trade.theyAccepted) status = `${trade.partnerName} accepted. Check their offer, then accept.`;
  else if (empty) status = 'Nothing is offered yet.';
  else status = 'Accept when both offers look right. Any change clears both accepts.';

  return (
    <div class="fe-trade__foot">
      <div class={cx('fe-trade__status', locked && 'fe-trade__status--warn', both && 'fe-trade__status--done')} role="status">
        {status}
      </div>
      <div class="fe-trade__actions">
        <Button variant="danger" onClick={() => store.actions.tradeCancel()}>
          Cancel trade
        </Button>
        <button
          type="button"
          class={cx(
            'fe-btn fe-btn--large fe-accept',
            trade.youAccepted ? 'fe-accept--on' : 'fe-btn--ember',
            locked && 'fe-accept--locked',
          )}
          disabled={locked || both || empty}
          aria-pressed={trade.youAccepted}
          onClick={() => {
            store.actions.uiSound(trade.youAccepted ? 'close' : 'equip');
            store.actions.tradeAccept(!trade.youAccepted);
          }}
        >
          <span
            class={cx('fe-accept__ring', locked && 'fe-accept__ring--lock', trade.youAccepted && 'fe-accept__ring--on')}
            style={{ '--p': frac.toFixed(3) } as unknown as JSX.CSSProperties}
            aria-hidden="true"
          >
            {locked && <span class="fe-accept__secs">{Math.ceil(left / 1000)}</span>}
          </span>
          {both ? 'Trading' : trade.youAccepted ? 'Accepted' : 'Accept'}
        </button>
      </div>
    </div>
  );
}

export function TradePanel() {
  const store = useStore();
  const local = useLocal();
  const trade = useUi((s) => s.trade);
  const drag = useSignal(local.drag);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const prevTheirs = useRef<string[] | null>(null);
  const theirUids = trade?.theirItems.map((i) => i.uid).join('|') ?? '';

  // The partner changed their offer: flash what is new, so nothing slips in unnoticed.
  useEffect(() => {
    const next = trade?.theirItems.map((i) => i.uid) ?? [];
    const prev = prevTheirs.current;
    prevTheirs.current = next;
    if (!prev) return;
    const added = addedUids(prev, next);
    if (!added.length) return;
    setFresh(new Set(added));
    const t = setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => clearTimeout(t);
  }, [theirUids]);

  if (!trade) {
    return (
      <PanelShell panel="trade" title="Trade" class="fe-trade">
        <p class="fe-trade__none">
          No trade is open. Use <b>Trade</b> on a party member, or type <b>/trade name</b> in chat.
        </p>
      </PanelShell>
    );
  }

  const offering = drag && drag.target?.offer;
  const zoneState = offering ? (drag!.target!.valid || drag!.target!.noop ? 'ok' : 'bad') : null;
  const zoneAccepts = !!drag && drag.from.kind === 'backpack' && !trade.yourItems.some((i) => i.uid === drag.uid);

  return (
    <PanelShell panel="trade" title="Trade" class="fe-trade" onClose={() => store.actions.tradeCancel()}>
      <div class="fe-trade__partner">
        <span class="fe-trade__sigil" aria-hidden="true" />
        Trading with <b>{trade.partnerName}</b>
      </div>

      <section class={cx('fe-tside fe-tside--theirs', trade.theyAccepted && 'fe-tside--accepted')}>
        <SideHead title={`${possessive(trade.partnerName)} offer`} count={trade.theirItems.length} accepted={trade.theyAccepted} who={trade.partnerName} />
        <div class="fe-tside__grid">
          {trade.theirItems.map((it) => (
            <Tile
              key={it.uid}
              item={it}
              fresh={fresh.has(it.uid)}
              onEnter={(el) =>
                local.showTooltip({ kind: 'preview', item: it, compare: true, label: `${possessive(trade.partnerName)} offer` }, el)
              }
            />
          ))}
          <EmptyTiles n={TRADE_MAX_ITEMS - trade.theirItems.length} />
          {trade.theirItems.length === 0 && <span class="fe-tside__empty">{trade.partnerName} has not offered anything yet</span>}
        </div>
      </section>

      <section class={cx('fe-tside fe-tside--yours', trade.youAccepted && 'fe-tside--accepted')}>
        <SideHead title="Your offer" count={trade.yourItems.length} accepted={trade.youAccepted} who="You" />
        <div
          class={cx(
            'fe-tside__grid fe-solid',
            zoneAccepts && 'fe-tside__grid--accepts',
            zoneState && `fe-tside__grid--${zoneState}`,
          )}
          data-drop="offer"
        >
          {trade.yourItems.map((it) => (
            <Tile
              key={it.uid}
              item={it}
              removable
              onEnter={(el) => local.showTooltip({ kind: 'item', uid: it.uid }, el)}
              onClick={() => {
                local.hideTooltip();
                store.actions.uiSound('click');
                store.actions.tradeOffer(offerWithout(trade, it.uid));
              }}
            />
          ))}
          <EmptyTiles n={TRADE_MAX_ITEMS - trade.yourItems.length} />
          {trade.yourItems.length === 0 && <span class="fe-tside__empty">Drag items here from your backpack, or Ctrl-click them</span>}
        </div>
        <div class="fe-tside__hint">Click an offered item to take it back. Offered items stay locked in your backpack.</div>
      </section>

      <AcceptControl trade={trade} />
    </PanelShell>
  );
}
