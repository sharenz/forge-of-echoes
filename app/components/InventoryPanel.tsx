"use client";

import { useState } from "react";
import { CHARACTER_EQUIPMENT_SLOTS } from "../game/config/equipment-slots";
import type { CharacterEquipmentSlot, EquipmentItem, InventoryItem, ItemContainerId, PlayerProfile } from "../game/domain";
import { equipmentSlotAccepts } from "../game/equipment";
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
  onEquipItem: (id: string, slot?: CharacterEquipmentSlot) => void;
  onMoveItem: (id: string, target: ItemContainerId, x: number, y: number) => void;
}

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
  const dropIntoSlot = (event: React.DragEvent, slot: CharacterEquipmentSlot) => {
    event.preventDefault();
    const itemId = readDroppedItem(event);
    const item = allItems.find((candidate) => candidate.id === itemId);
    if (item && isEquipmentItem(item) && equipmentSlotAccepts(slot, item)) onEquipItem(item.id, slot);
    endDrag();
  };

  return (
    <div className="inventory-window">
      <div className="equipment-paperdoll">
        <div className="paperdoll-heading"><span className="eyebrow">Equipped</span><small>Drag gear into a matching slot</small></div>
        {CHARACTER_EQUIPMENT_SLOTS.map((slot) => {
          const equipped = profile.equipped[slot.id];
          const compatible = Boolean(draggedItem && isEquipmentItem(draggedItem) && equipmentSlotAccepts(slot.id, draggedItem));
          return (
            <div
              className={`equipment-slot slot-${slot.id} ${draggedItem ? compatible ? "drop-compatible" : "drop-incompatible" : ""}`}
              onDragOver={(event) => { if (compatible) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
              onDrop={(event) => dropIntoSlot(event, slot.id)}
              key={slot.id}
            >
              <small>{slot.label}</small>
              {equipped
                ? <ItemCard compact draggable item={equipped} onClick={() => onSelect(equipped.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-crafty-item", equipped.id); event.dataTransfer.setData("application/x-crafty-offset", JSON.stringify({ x: 0, y: 0 })); beginDrag(equipped.id); }} onDragEnd={endDrag} selected={selectedItemId === equipped.id} />
                : <span>Empty</span>}
            </div>
          );
        })}
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
