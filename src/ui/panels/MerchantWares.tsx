// Rook's wares (GAME_SPEC §9): his stock laid out on one plain item grid, like a Path of Exile vendor with tabs (Gear, Maps, Supplies).
// The board (four maps and eight items, mostly junk, sometimes a really good find) comes from the server and stays deterministic per epoch;
// the staples (flasks, Kindling, Map Dust) are always in stock. Which tab shelves an item is decided here by its class (lib/merchant.ts
// vendorTabOf); where it sits is decided by packVendor (slot order, first fit), so the layout is stable all epoch and a sold item leaves a gap.
// The price lives in the hover card. Buying: drag an item onto your backpack, or Ctrl/Cmd-click / right-click it.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MerchantBoard, MerchantOffer, MerchantWare } from '../../contracts/game';
import type { CurrencyId } from '../../contracts/content';
import { cx } from '../components/common';
import { safe } from '../items/hooks';
import { VendorGrid, type VendorEntry } from '../items/VendorGrid';
import { useLocal } from '../local';
import { newWaresText, priceLine, rerollBlocked, revealFor, rotationMsLeft, vendorTabOf, wareBlocked, type VendorTab } from '../lib/merchant';
import { currencyHoldings } from '../lib/stash';
import { useSignal, useStore, useUi } from '../store';

const SEEN_KEY = 'forge.rook.seenEpoch';

/** The epoch the player last looked at, per character (browser storage may be blocked: then the flourish simply plays again). */
function readSeen(characterId: string): string | null {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}')[characterId] ?? null; } catch { return null; }
}
function writeSeen(characterId: string, epoch: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}');
    all[characterId] = epoch;
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch { /* storage blocked */ }
}

export function MerchantWares({ tab, onShelf }: { tab: VendorTab; onShelf?: (tab: VendorTab) => void }) {
  const store = useStore();
  const local = useLocal();
  const stored = useSignal(local.merchantBoard);
  const ch = useUi((s) => s.character);
  // A board kept from another character (back to the menu and into a different one) is never shown.
  const view = stored && ch && stored.characterId === ch.id ? stored : null;
  const level = useUi((s) => s.character?.level ?? 0);
  const [now, setNow] = useState(() => performance.now());
  const [reveal, setReveal] = useState<'jackpot' | 'good' | null>(null);
  const busy = useRef(false);

  const keep = (board: MerchantBoard): void => {
    const id = store.get().character?.id;
    if (id) local.merchantBoard.set({ board, receivedAt: performance.now(), characterId: id });
  };
  const refresh = (): void => {
    void store.actions.merchantWares().then((board) => { if (board) keep(board); });
  };
  const apply = (next: Promise<MerchantBoard | null>): void => {
    if (busy.current) return;
    busy.current = true;
    void next.then((board) => {
      busy.current = false;
      // A refused purchase (stale epoch, sold, no Scrap) leaves the old board on screen: look again so it is current.
      if (board) keep(board); else refresh();
    });
  };

  // Look at the board when the panel opens and whenever the character levels up (new level, new wares).
  useEffect(refresh, [level]);
  // A clock for the countdown; when the rotation runs out the board is asked for again.
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const left = view ? rotationMsLeft(view.board, view.receivedAt, now) : 0;
  useEffect(() => {
    if (!view) return;
    const ms = rotationMsLeft(view.board, view.receivedAt, performance.now());
    const t = setTimeout(refresh, ms + 750);
    return () => clearTimeout(t);
  }, [view?.board.epoch]);

  // The lucky-find flourish: once per epoch, the first time the board is on screen with something good in it.
  const epoch = view?.board.epoch;
  useEffect(() => {
    if (!view || !ch) return;
    const kind = revealFor(readSeen(ch.id), view.board);
    writeSeen(ch.id, view.board.epoch);
    if (!kind) return;
    setReveal(kind);
    store.actions.uiSound(kind === 'jackpot' ? 'jackpot' : 'find');
    const t = setTimeout(() => setReveal(null), 2600);
    return () => clearTimeout(t);
  }, [epoch]);

  const staples = useMemo(() => safe(() => store.actions.merchantOffers(), [] as MerchantOffer[]).filter((o) => o.kind === 'flask' || o.kind === 'currency'), [store, ch]);
  // A new board that has nothing on the open shelf (say no gear this time) opens on the first shelf that has something.
  useEffect(() => {
    if (!view || !onShelf) return;
    const has = (t: VendorTab): boolean => (t === 'supplies' && staples.length > 0) || view.board.wares.some((w) => !w.sold && vendorTabOf(w.item) === t);
    if (has(tab)) return;
    const next = (['gear', 'maps', 'supplies'] as const).find(has);
    if (next) onShelf(next);
  }, [epoch]);

  if (!ch) return null;
  const onHand = (id: CurrencyId): number => { const h = currencyHoldings(ch, id); return h.backpack + h.stash + h.crafting; };
  const scrap = onHand('scrap');
  const currencies = store.rules.content.currencies;
  const priceText = (price: { currencyId: CurrencyId; count: number }[]): string => price.map((c) => `${c.count} ${c.currencyId === 'scrap' ? 'Scrap' : (currencies[c.currencyId]?.name ?? c.currencyId)}`).join(', ');

  const poorFor = (price: { currencyId: CurrencyId; count: number }[]): boolean => !price.every((c) => onHand(c.currencyId) >= c.count);
  const ware = (w: MerchantWare): VendorEntry => {
    const blocked = wareBlocked(w, scrap);
    const tag = `Buy for ${priceText(w.price)}`;
    return {
      key: w.id, attr: 'data-ware', slot: w.slot, item: w.item, hidden: w.sold, luck: w.quality === 'good' || w.quality === 'jackpot' ? w.quality : undefined,
      priceTag: String(w.price.reduce((n, c) => n + c.count, 0)), poor: !!blocked,
      tooltip: { kind: 'preview', item: w.item, compare: w.item.kind === 'equipment', price: priceLine(w.price, (id) => currencies[id]?.name ?? id, !blocked) },
      stock: { blocked, tag, buy: (at) => apply(store.actions.buyWare(w.id, at)) },
    };
  };
  const staple = (o: MerchantOffer): VendorEntry[] => {
    const item = o.item;
    if (!item) return [];
    const poor = poorFor(o.price);
    return [{
      key: o.id, attr: 'data-offer', item, poor, priceTag: String(o.price.reduce((n, c) => n + c.count, 0)),
      tooltip: { kind: 'preview', item, price: priceLine(o.price, (id) => currencies[id]?.name ?? id, !poor) },
      stock: {
        blocked: poor ? `Can't afford: needs ${priceText(o.price)} (you have ${scrap}).` : null, tag: `Buy for ${priceText(o.price)}`,
        buy: (at) => { void store.actions.buyOffer(o.id, at); },
      },
    }];
  };

  const board = view?.board;
  // The whole stock in a fixed order (staples, then the board by slot), shelved by item class.
  const entries = [...staples.flatMap(staple), ...(board?.wares.map(ware) ?? [])].filter((e) => vendorTabOf(e.item) === tab);
  const blockedReroll = board ? rerollBlocked(board, scrap) : 'Rook is looking.';

  return (
    <div class={cx('fe-wares', reveal && `fe-wares--reveal fe-wares--reveal-${reveal}`)} data-testid="rook-wares" data-epoch={board?.epoch} data-vendor-tab={tab}>
      <div class="fe-wares__grid">
        <VendorGrid entries={entries} label={`Rook's ${tab}`} testId={`rook-grid-${tab}`} />
        {!board ? <p class="fe-panel__note fe-wares__loading">Rook is digging through his crates...</p>
          : entries.every((e) => e.hidden) && <p class="fe-panel__note fe-wares__loading">Nothing here right now.</p>}
      </div>
      {board && (
        <div class="fe-wares__foot">
          <span class="ui-type-secondary fe-wares__clock" data-testid="rook-countdown">{newWaresText(left)}</span>
          <button
            type="button"
            class={cx('fe-btn fe-btn--small', blockedReroll && 'fe-btn--ghost')}
            data-testid="rook-reroll"
            disabled={!!blockedReroll}
            title={blockedReroll ?? 'Rook rummages for a fresh set. The price doubles each time until the next rotation.'}
            onClick={() => { store.actions.uiSound('click'); local.hideTooltip(); apply(store.actions.rerollWares(board.epoch, board.rerollCost)); }}
          >
            Ask for new wares ({board.rerollCost} Scrap)
          </button>
        </div>
      )}
    </div>
  );
}
