"use client";

import { useMemo, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { CURRENCY_DEFINITIONS } from "../game/config/currencies";
import { FLASK_DEFINITIONS } from "../game/config/flasks";
import { MERCHANTS, type MerchantId, type MerchantOffer } from "../game/config/merchants";
import type { CurrencyAmounts, InventoryItem, ItemContainerId, PlayerProfile } from "../game/domain";
import { findContainerEntry } from "../game/item-container";
import { createMerchantOfferItem, merchantOfferBadge, merchantOfferIcon } from "../game/merchant";
import { InventoryGrid, type GridOffset } from "./InventoryGrid";
import { ItemTooltip } from "./ItemTooltip";
import { useQuickAction } from "./useQuickAction";

interface MerchantStockItem {
  key: string;
  offer: MerchantOffer;
  icon: string;
  badge: string;
  visualClass: string;
  previewItem: InventoryItem;
}

interface MerchantPanelProps {
  merchantId: MerchantId;
  profile: PlayerProfile;
  currencies: CurrencyAmounts;
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
  onMoveItem: (id: string, targetId: ItemContainerId, x: number, y: number) => void;
  onBuy: (merchantId: MerchantId, offerId: string, position?: { x: number; y: number }) => void;
}

function buildMerchantStock(merchantId: MerchantId): MerchantStockItem[] {
  return MERCHANTS[merchantId].offers.map((offer) => {
    const previewItem = createMerchantOfferItem(merchantId, offer.id, `merchant-stock:${merchantId}:${offer.id}`);
    if (!previewItem) throw new Error(`Merchant ${merchantId} has an invalid offer ${offer.id}`);
    return {
      key: `${merchantId}:${offer.id}`,
      offer,
      icon: merchantOfferIcon(offer),
      badge: merchantOfferBadge(offer),
      visualClass: `merchant-stock-${offer.kind}${offer.kind === "flask" ? ` flask-${FLASK_DEFINITIONS[offer.flaskId].resource}` : offer.kind === "equipment" ? ` rarity-${offer.rarity}` : ""}`,
      previewItem,
    };
  });
}

export function MerchantPanel({ merchantId, profile, currencies, selectedItemId, onSelectItem, onMoveItem, onBuy }: MerchantPanelProps) {
  const merchant = MERCHANTS[merchantId];
  const stock = useMemo(() => buildMerchantStock(merchantId), [merchantId]);
  const [selectedOfferKey, setSelectedOfferKey] = useState(stock[0]?.key ?? "");
  const [hoveredOffer, setHoveredOffer] = useState<{ key: string; x: number; y: number } | null>(null);
  const [dragState, setDragState] = useState<{ itemId: string; offset: GridOffset } | null>(null);
  const [draggedOfferKey, setDraggedOfferKey] = useState<string | null>(null);
  const quickAction = useQuickAction();
  const selectedOffer = stock.find((item) => item.key === selectedOfferKey) ?? stock[0];
  const draggedOffer = draggedOfferKey ? stock.find((item) => item.key === draggedOfferKey) ?? null : null;
  const draggedItem: InventoryItem | null = draggedOffer?.previewItem
    ?? (dragState ? findContainerEntry(profile.inventory, dragState.itemId)?.item ?? null : null);

  const canAfford = (stockItem: MerchantStockItem) => currencies[stockItem.offer.price.currency] >= stockItem.offer.price.amount;
  const buy = (stockItem: MerchantStockItem, position?: { x: number; y: number }) => {
    if (!canAfford(stockItem)) return;
    onBuy(merchantId, stockItem.offer.id, position);
  };

  const startOfferDrag = (event: DragEvent<HTMLButtonElement>, stockItem: MerchantStockItem) => {
    if (!canAfford(stockItem)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-forge-of-echoes-item", stockItem.previewItem.id);
    event.dataTransfer.setData("application/x-forge-of-echoes-offset", JSON.stringify({ x: 0, y: 0 }));
    event.dataTransfer.setData("text/plain", stockItem.previewItem.id);
    setHoveredOffer(null);
    setSelectedOfferKey(stockItem.key);
    setDragState(null);
    setDraggedOfferKey(stockItem.key);
  };

  const finishDrag = () => {
    setDragState(null);
    setDraggedOfferKey(null);
  };

  const dropIntoBackpack = (itemId: string, targetId: ItemContainerId, x: number, y: number) => {
    const stockItem = stock.find((candidate) => candidate.previewItem.id === itemId);
    if (stockItem) buy(stockItem, { x, y });
    else onMoveItem(itemId, targetId, x, y);
  };

  const handleOfferClick = (event: MouseEvent<HTMLButtonElement>, stockItem: MerchantStockItem) => {
    if (canAfford(stockItem) && quickAction.fromClick(event, stockItem.key, () => buy(stockItem))) return;
    setSelectedOfferKey(stockItem.key);
  };

  const handleOfferContextMenu = (event: MouseEvent<HTMLButtonElement>, stockItem: MerchantStockItem) => {
    if (canAfford(stockItem) && quickAction.fromContextMenu(event, stockItem.key, () => buy(stockItem))) return;
    event.preventDefault();
  };

  const handleOfferKeyDown = (event: KeyboardEvent<HTMLButtonElement>, stockItem: MerchantStockItem) => {
    if ((event.ctrlKey || event.metaKey) && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      if (canAfford(stockItem)) buy(stockItem);
    }
  };

  return (
    <div className="merchant-trade-interface" aria-label={`${merchant.name} trade window`}>
      <section className="merchant-inventory" aria-label={`${merchant.name}'s inventory`}>
        <header className="merchant-trade-heading">
          <div className="merchant-identity"><i aria-hidden="true">{merchant.name.charAt(0)}</i><div><span>{merchant.title}</span><h3>{merchant.name}&apos;s Stock</h3></div></div>
          <div className="merchant-wallet"><span>Your Scrap</span><strong>{currencies.scrap}</strong></div>
        </header>

        <div className="merchant-grid-label"><span>Shop inventory</span><em>Drag to buy · Ctrl/⌘-click to fast buy</em></div>
        <div className="merchant-stock-grid" role="listbox" aria-label="Items for sale">
          {stock.map((stockItem, index) => {
            const affordable = canAfford(stockItem);
            const priceDefinition = CURRENCY_DEFINITIONS[stockItem.offer.price.currency];
            return (
              <button
                type="button"
                role="option"
                aria-selected={selectedOffer?.key === stockItem.key}
                aria-disabled={!affordable}
                aria-label={`${stockItem.offer.name}, ${stockItem.offer.price.amount === 0 ? "free" : `${stockItem.offer.price.amount} ${priceDefinition.name}`}. Ctrl or Command click to buy.`}
                className={`merchant-stock-item ${stockItem.visualClass} ${selectedOffer?.key === stockItem.key ? "selected" : ""} ${affordable ? "" : "unaffordable"}`}
                style={{
                  "--merchant-item-icon": `url("${stockItem.icon}")`,
                  gridColumn: `${(index % 12) + 1} / span 1`,
                  gridRow: `${Math.floor(index / 12) + 1} / span 1`,
                } as CSSProperties}
                onClick={(event) => handleOfferClick(event, stockItem)}
                onContextMenu={(event) => handleOfferContextMenu(event, stockItem)}
                onKeyDown={(event) => handleOfferKeyDown(event, stockItem)}
                draggable={affordable}
                onDragStart={(event) => startOfferDrag(event, stockItem)}
                onDragEnd={finishDrag}
                onPointerEnter={(event) => setHoveredOffer({ key: stockItem.key, x: event.clientX, y: event.clientY })}
                onPointerMove={(event) => setHoveredOffer({ key: stockItem.key, x: event.clientX, y: event.clientY })}
                onPointerLeave={() => setHoveredOffer(null)}
                onFocus={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setHoveredOffer({ key: stockItem.key, x: rect.right, y: rect.top }); }}
                onBlur={() => setHoveredOffer(null)}
                key={stockItem.key}
              >
                <span className="merchant-item-art" aria-hidden="true" />
                <b>{stockItem.badge}</b>
                <small>{stockItem.offer.price.amount === 0 ? "FREE" : stockItem.offer.price.amount}</small>
              </button>
            );
          })}
        </div>

        {hoveredOffer && (() => {
          const stockItem = stock.find((candidate) => candidate.key === hoveredOffer.key);
          if (!stockItem) return null;
          const currencyName = CURRENCY_DEFINITIONS[stockItem.offer.price.currency].name;
          const price = stockItem.offer.price.amount === 0 ? "Free" : `${stockItem.offer.price.amount} ${currencyName}`;
          const action = canAfford(stockItem) ? "Drag to place · Ctrl/⌘-click to fast buy" : `Not enough ${currencyName}`;
          return <ItemTooltip item={stockItem.previewItem} profile={profile} x={hoveredOffer.x} y={hoveredOffer.y} hint={`${price} · ${action}`} />;
        })()}

        <footer className="merchant-trade-help"><span>{merchant.greeting}</span><strong>Purchases are server-authoritative.</strong></footer>
      </section>

      <section className="merchant-player-inventory" aria-label="Your backpack">
        <header className="merchant-trade-heading">
          <div><span>Character inventory</span><h3>Your Backpack</h3></div>
          <small>Purchased items appear where dropped, or in the first fitting space when fast-bought</small>
        </header>
        <InventoryGrid
          container={profile.inventory}
          profile={profile}
          selectedId={selectedItemId}
          onSelect={onSelectItem}
          draggedItem={draggedItem}
          draggedOffset={draggedOffer ? { x: 0, y: 0 } : dragState?.offset}
          onDragItem={(itemId, offset) => { setDraggedOfferKey(null); setDragState({ itemId, offset }); onSelectItem(itemId); }}
          onDragEnd={finishDrag}
          onDropItem={dropIntoBackpack}
          dropEffect={draggedOffer ? "copy" : "move"}
        />
        <footer><span>Arrange items freely while shopping.</span><small>Invalid positions and insufficient funds are rejected by the server.</small></footer>
      </section>
    </div>
  );
}
