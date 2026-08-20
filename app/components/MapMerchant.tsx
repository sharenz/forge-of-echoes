"use client";

import { useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { FLASK_DEFINITIONS } from "../game/config/flasks";
import { MAP_BASES_BY_ID } from "../game/config/maps";
import { MAP_MERCHANT } from "../game/config/merchants";
import type { InventoryItem, ItemContainerId, PlayerProfile } from "../game/domain";
import { findContainerEntry } from "../game/item-container";
import { InventoryGrid, type GridOffset } from "./InventoryGrid";
import { ItemTooltip } from "./ItemTooltip";
import { useQuickAction } from "./useQuickAction";

type MerchantStockItem = {
  key: string;
  kind: "map" | "flask";
  offerId: string;
  name: string;
  icon: string;
  price: number;
  badge: string;
  visualClass: string;
  previewItem: InventoryItem;
};

interface MapMerchantProps {
  profile: PlayerProfile;
  scrap: number;
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
  onMoveItem: (id: string, targetId: ItemContainerId, x: number, y: number) => void;
  onBuyMap: (offerId: string, position?: { x: number; y: number }) => void;
  onBuyFlask: (offerId: string, position?: { x: number; y: number }) => void;
}

const MERCHANT_STOCK: readonly MerchantStockItem[] = [
  ...MAP_MERCHANT.offers.map((offer) => {
    const mapBase = MAP_BASES_BY_ID[offer.mapBaseId];
    return {
      key: `map:${offer.id}`,
      kind: "map" as const,
      offerId: offer.id,
      name: offer.name,
      icon: mapBase.icon,
      price: offer.price.amount,
      badge: `T${offer.tier}`,
      visualClass: "merchant-stock-map",
      previewItem: {
        kind: "map" as const,
        id: `merchant-stock:${offer.id}`,
        baseId: offer.mapBaseId,
        baseName: mapBase.name,
        tier: offer.tier,
        rarity: "normal" as const,
        quality: 0,
        corrupted: false,
        implicit: mapBase.implicit,
        modifiers: [],
      },
    };
  }),
  ...MAP_MERCHANT.flaskOffers.map((offer) => {
    const flask = FLASK_DEFINITIONS[offer.flaskId];
    return {
      key: `flask:${offer.id}`,
      kind: "flask" as const,
      offerId: offer.id,
      name: flask.name,
      icon: flask.icon,
      price: offer.price.amount,
      badge: `×${offer.amount}`,
      visualClass: `merchant-stock-flask flask-${flask.resource}`,
      previewItem: {
        kind: "flask" as const,
        id: `merchant-stock:${offer.id}`,
        baseId: offer.flaskId,
        stackSize: offer.amount,
      },
    };
  }),
];

export function MapMerchant({ profile, scrap, selectedItemId, onSelectItem, onMoveItem, onBuyMap, onBuyFlask }: MapMerchantProps) {
  const [selectedOfferKey, setSelectedOfferKey] = useState(MERCHANT_STOCK[0]?.key ?? "");
  const [hoveredOffer, setHoveredOffer] = useState<{ key: string; x: number; y: number } | null>(null);
  const [dragState, setDragState] = useState<{ itemId: string; offset: GridOffset } | null>(null);
  const [draggedOfferKey, setDraggedOfferKey] = useState<string | null>(null);
  const quickAction = useQuickAction();
  const selectedOffer = MERCHANT_STOCK.find((offer) => offer.key === selectedOfferKey) ?? MERCHANT_STOCK[0];
  const draggedOffer = draggedOfferKey ? MERCHANT_STOCK.find((offer) => offer.key === draggedOfferKey) ?? null : null;
  const draggedItem: InventoryItem | null = draggedOffer?.previewItem
    ?? (dragState ? findContainerEntry(profile.inventory, dragState.itemId)?.item ?? null : null);

  const buy = (offer: MerchantStockItem, position?: { x: number; y: number }) => {
    if (offer.price > scrap) return;
    if (offer.kind === "map") onBuyMap(offer.offerId, position);
    else onBuyFlask(offer.offerId, position);
  };

  const startOfferDrag = (event: DragEvent<HTMLButtonElement>, offer: MerchantStockItem) => {
    if (offer.price > scrap) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-crafty-item", offer.previewItem.id);
    event.dataTransfer.setData("application/x-crafty-offset", JSON.stringify({ x: 0, y: 0 }));
    event.dataTransfer.setData("text/plain", offer.previewItem.id);
    setHoveredOffer(null);
    setSelectedOfferKey(offer.key);
    setDragState(null);
    setDraggedOfferKey(offer.key);
  };

  const finishDrag = () => {
    setDragState(null);
    setDraggedOfferKey(null);
  };

  const dropIntoBackpack = (itemId: string, targetId: ItemContainerId, x: number, y: number) => {
    const offer = MERCHANT_STOCK.find((candidate) => candidate.previewItem.id === itemId);
    if (offer) buy(offer, { x, y });
    else onMoveItem(itemId, targetId, x, y);
  };

  const handleOfferClick = (event: MouseEvent<HTMLButtonElement>, offer: MerchantStockItem) => {
    if (offer.price <= scrap && quickAction.fromClick(event, offer.key, () => buy(offer))) return;
    setSelectedOfferKey(offer.key);
  };

  const handleOfferContextMenu = (event: MouseEvent<HTMLButtonElement>, offer: MerchantStockItem) => {
    if (offer.price <= scrap && quickAction.fromContextMenu(event, offer.key, () => buy(offer))) return;
    event.preventDefault();
  };

  const handleOfferKeyDown = (event: KeyboardEvent<HTMLButtonElement>, offer: MerchantStockItem) => {
    if ((event.ctrlKey || event.metaKey) && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      if (offer.price <= scrap) buy(offer);
    }
  };

  return (
    <div className="merchant-trade-interface" aria-label="Merchant trade window">
      <section className="merchant-inventory" aria-label={`${MAP_MERCHANT.name}'s inventory`}>
        <header className="merchant-trade-heading">
          <div className="merchant-identity"><i aria-hidden="true">R</i><div><span>{MAP_MERCHANT.title}</span><h3>{MAP_MERCHANT.name}&apos;s Stock</h3></div></div>
          <div className="merchant-wallet"><span>Your Scrap</span><strong>{scrap}</strong></div>
        </header>

        <div className="merchant-grid-label"><span>Shop inventory</span><em>Ctrl/⌘-click to buy</em></div>
        <div className="merchant-stock-grid" role="listbox" aria-label="Items for sale">
          {MERCHANT_STOCK.map((offer, index) => {
            const affordable = offer.price === 0 || scrap >= offer.price;
            return (
              <button
                type="button"
                role="option"
                aria-selected={selectedOffer?.key === offer.key}
                aria-disabled={!affordable}
                aria-label={`${offer.name}, ${offer.price === 0 ? "free" : `${offer.price} Scrap`}. Ctrl or Command click to buy.`}
                className={`merchant-stock-item ${offer.visualClass} ${selectedOffer?.key === offer.key ? "selected" : ""} ${affordable ? "" : "unaffordable"}`}
                style={{
                  "--merchant-item-icon": `url("${offer.icon}")`,
                  gridColumn: `${(index % 12) + 1} / span 1`,
                  gridRow: `${Math.floor(index / 12) + 1} / span 1`,
                } as CSSProperties}
                onClick={(event) => handleOfferClick(event, offer)}
                onContextMenu={(event) => handleOfferContextMenu(event, offer)}
                onKeyDown={(event) => handleOfferKeyDown(event, offer)}
                draggable={affordable}
                onDragStart={(event) => startOfferDrag(event, offer)}
                onDragEnd={finishDrag}
                onPointerEnter={(event) => setHoveredOffer({ key: offer.key, x: event.clientX, y: event.clientY })}
                onPointerMove={(event) => setHoveredOffer({ key: offer.key, x: event.clientX, y: event.clientY })}
                onPointerLeave={() => setHoveredOffer(null)}
                onFocus={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setHoveredOffer({ key: offer.key, x: rect.right, y: rect.top }); }}
                onBlur={() => setHoveredOffer(null)}
                key={offer.key}
              >
                <span className="merchant-item-art" aria-hidden="true" />
                <b>{offer.badge}</b>
                <small>{offer.price === 0 ? "FREE" : offer.price}</small>
              </button>
            );
          })}
        </div>

        {hoveredOffer && (() => {
          const offer = MERCHANT_STOCK.find((candidate) => candidate.key === hoveredOffer.key);
          if (!offer) return null;
          const price = offer.price === 0 ? "Free" : `${offer.price} Scrap`;
          const action = offer.price <= scrap ? "Drag to place · Ctrl/⌘-click to fast buy" : "Not enough Scrap";
          return <ItemTooltip item={offer.previewItem} profile={profile} x={hoveredOffer.x} y={hoveredOffer.y} hint={`${price} · ${action}`} />;
        })()}

        <footer className="merchant-trade-help"><span>Click to inspect · drag to place.</span><strong>Ctrl/⌘-click fast-buys into the first fitting space.</strong></footer>
      </section>

      <section className="merchant-player-inventory" aria-label="Your backpack">
        <header className="merchant-trade-heading">
          <div><span>Character inventory</span><h3>Your Backpack</h3></div>
          <small>Purchased items appear in the first fitting space</small>
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
        <footer><span>Arrange items freely while shopping.</span><small>Purchases are priced, created, and placed by the server.</small></footer>
      </section>
    </div>
  );
}
