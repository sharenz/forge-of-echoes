"use client";

import { useState } from "react";
import type { EquipmentItem, InventoryItem, ItemContainerId, PlayerProfile } from "../game/domain";
import { containerItems } from "../game/item-container";
import { currencyAmounts, isEquipmentItem } from "../game/inventory";
import { InventoryGrid } from "./InventoryGrid";
import { ItemCard } from "./ItemCard";

interface InventoryPanelProps {
  profile: PlayerProfile;
  selectedItemId: string | null;
  showStash?: boolean;
  freshItemIds?: string[];
  onSelect: (id: string) => void;
  onEquipItem: (id: string) => void;
  onMoveItem: (id: string, target: ItemContainerId, x: number, y: number) => void;
}

const EQUIPMENT_SLOTS = ["weapon", "chest", "ring", "boots"] as const;

export function InventoryPanel({ profile, selectedItemId, showStash = false, freshItemIds = [], onSelect, onEquipItem, onMoveItem }: InventoryPanelProps) {
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const freshItems = new Set(freshItemIds);
  const backpackItems = containerItems(profile.inventory);
  const stashItems = containerItems(profile.stash);
  const equippedItems = Object.values(profile.equipped).filter(Boolean) as EquipmentItem[];
  const allItems: InventoryItem[] = [...equippedItems, ...backpackItems, ...stashItems];
  const draggedItem = allItems.find((item) => item.id === draggedItemId) ?? null;
  const freshInventory = backpackItems.filter((item) => freshItems.has(item.id));
  const freshCurrency = currencyAmounts(freshInventory);
  const materialDrops = [
    ["scrap", "Scrap", freshCurrency.scrap],
    ["essence", "Essence", freshCurrency.essence],
    ["map-dust", "Map Dust", freshCurrency.mapDust],
  ] as const;
  const hasRunPickups = freshItems.size > 0;

  const beginDrag = (id: string) => {
    setDraggedItemId(id);
    onSelect(id);
  };
  const endDrag = () => setDraggedItemId(null);
  const readDroppedItem = (event: React.DragEvent) => event.dataTransfer.getData("application/x-crafty-item") || event.dataTransfer.getData("text/plain") || draggedItemId;
  const dropIntoSlot = (event: React.DragEvent, slot: EquipmentItem["slot"]) => {
    event.preventDefault();
    const itemId = readDroppedItem(event);
    const item = allItems.find((candidate) => candidate.id === itemId);
    if (item && isEquipmentItem(item) && item.slot === slot) onEquipItem(item.id);
    endDrag();
  };

  return (
    <div className="inventory-window">
      <div className="equipment-paperdoll">
        <div className="paperdoll-heading"><span className="eyebrow">Equipped</span><small>Drag gear into a matching slot</small></div>
        {EQUIPMENT_SLOTS.map((slot) => (
          <div
            className={`equipment-slot slot-${slot} ${draggedItem ? isEquipmentItem(draggedItem) && draggedItem.slot === slot ? "drop-compatible" : "drop-incompatible" : ""}`}
            onDragOver={(event) => { if (draggedItem && isEquipmentItem(draggedItem) && draggedItem.slot === slot) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
            onDrop={(event) => dropIntoSlot(event, slot)}
            key={slot}
          >
            <small>{slot}</small>
            {profile.equipped[slot]
              ? <ItemCard compact draggable item={profile.equipped[slot]} onClick={() => onSelect(profile.equipped[slot]?.id ?? "")} onDragStart={(event) => { const id = profile.equipped[slot]?.id; if (!id) return; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-crafty-item", id); event.dataTransfer.setData("application/x-crafty-offset", JSON.stringify({ x: 0, y: 0 })); beginDrag(id); }} onDragEnd={endDrag} selected={selectedItemId === profile.equipped[slot]?.id} />
              : <span>Empty</span>}
          </div>
        ))}
      </div>
      <div className="inventory-containers">
        {hasRunPickups && (
          <section className="run-pickup-ledger" aria-label="Items collected in this map">
            <header><div><span>Collected this map</span><strong>{freshItems.size} new inventory items</strong></div><small>Picked up and secured</small></header>
            <div>
              {materialDrops.map(([kind, label, amount]) => (
                <span className={`run-material material-${kind}`} key={kind}><i>{label.charAt(0)}</i><small>{label}</small><strong>{amount}</strong></span>
              ))}
            </div>
          </section>
        )}
        {showStash && (
          <InventoryGrid container={profile.stash} selectedId={selectedItemId} onSelect={onSelect} draggedItem={draggedItem} onDragItem={beginDrag} onDragEnd={endDrag} onDropItem={onMoveItem} />
        )}
        <InventoryGrid container={profile.inventory} selectedId={selectedItemId} onSelect={onSelect} highlightedIds={freshItems} draggedItem={draggedItem} onDragItem={beginDrag} onDragEnd={endDrag} onDropItem={onMoveItem} onEquipItem={onEquipItem} />
      </div>
    </div>
  );
}
