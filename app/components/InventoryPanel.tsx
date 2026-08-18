"use client";

import { useState } from "react";
import type { EquipmentItem, Materials, PlayerProfile } from "../game/domain";
import { InventoryGrid } from "./InventoryGrid";
import { ItemCard } from "./ItemCard";

interface InventoryPanelProps {
  profile: PlayerProfile;
  backpackItems: EquipmentItem[];
  selectedItemId: string | null;
  showStash?: boolean;
  freshItemIds?: string[];
  runMaterials?: Partial<Materials>;
  onSelect: (id: string) => void;
  onEquipItem: (id: string) => void;
  onUnequipItem: (id: string) => void;
  onTransferItem?: (id: string) => void;
}

const EQUIPMENT_SLOTS = ["weapon", "chest", "ring", "boots"] as const;

export function InventoryPanel({
  profile,
  backpackItems,
  selectedItemId,
  showStash = false,
  freshItemIds = [],
  runMaterials,
  onSelect,
  onEquipItem,
  onUnequipItem,
  onTransferItem,
}: InventoryPanelProps) {
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const freshItems = new Set(freshItemIds);
  const equippedItems = Object.values(profile.equipped).filter(Boolean) as EquipmentItem[];
  const allItems = [...equippedItems, ...backpackItems, ...profile.stash];
  const draggedItem = allItems.find((item) => item.id === draggedItemId) ?? null;
  const draggedIsEquipped = Boolean(draggedItem && profile.equipped[draggedItem.slot]?.id === draggedItem.id);
  const draggedIsInStash = Boolean(draggedItem && profile.stash.some((item) => item.id === draggedItem.id));
  const materialDrops = [
    ["scrap", "Scrap", runMaterials?.scrap ?? 0],
    ["essence", "Essence", runMaterials?.essence ?? 0],
    ["map-dust", "Map Dust", runMaterials?.mapDust ?? 0],
  ] as const;
  const hasRunPickups = freshItems.size > 0 || materialDrops.some(([, , amount]) => amount > 0);

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
    if (item?.slot === slot) onEquipItem(item.id);
    endDrag();
  };
  const dropIntoBackpack = (event: React.DragEvent) => {
    event.preventDefault();
    const itemId = readDroppedItem(event);
    if (!itemId) return;
    if (draggedIsEquipped) onUnequipItem(itemId);
    else if (draggedIsInStash) onTransferItem?.(itemId);
    endDrag();
  };
  const dropIntoStash = (event: React.DragEvent) => {
    event.preventDefault();
    const itemId = readDroppedItem(event);
    if (itemId && !draggedIsEquipped && !draggedIsInStash) onTransferItem?.(itemId);
    endDrag();
  };

  return (
    <div className="inventory-window">
      <div className="equipment-paperdoll">
        <div className="paperdoll-heading"><span className="eyebrow">Equipped</span><small>Drag gear into a matching slot</small></div>
        {EQUIPMENT_SLOTS.map((slot) => (
          <div
            className={`equipment-slot slot-${slot} ${draggedItem ? draggedItem.slot === slot ? "drop-compatible" : "drop-incompatible" : ""}`}
            onDragOver={(event) => { if (draggedItem?.slot === slot) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
            onDrop={(event) => dropIntoSlot(event, slot)}
            key={slot}
          >
            <small>{slot}</small>
            {profile.equipped[slot]
              ? <ItemCard compact draggable item={profile.equipped[slot]} onClick={() => onSelect(profile.equipped[slot]?.id ?? "")} onDragStart={(event) => { const id = profile.equipped[slot]?.id; if (!id) return; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-crafty-item", id); beginDrag(id); }} onDragEnd={endDrag} selected={selectedItemId === profile.equipped[slot]?.id} />
              : <span>Empty</span>}
          </div>
        ))}
      </div>
      <div className="inventory-containers">
        {hasRunPickups && (
          <section className="run-pickup-ledger" aria-label="Items collected in this map">
            <header><div><span>Collected this map</span><strong>{freshItems.size} new equipment</strong></div><small>Picked up and secured</small></header>
            <div>
              {materialDrops.map(([kind, label, amount]) => (
                <span className={`run-material material-${kind}`} key={kind}><i>{label.charAt(0)}</i><small>{label}</small><strong>{amount}</strong></span>
              ))}
            </div>
          </section>
        )}
        {showStash && (
          <div className={`inventory-drop-zone ${draggedItem && !draggedIsEquipped && !draggedIsInStash ? "drop-compatible" : ""}`} onDragOver={(event) => { if (draggedItem && !draggedIsEquipped && !draggedIsInStash) event.preventDefault(); }} onDrop={dropIntoStash}>
            <InventoryGrid items={profile.stash} columns={12} rows={8} selectedId={selectedItemId} onSelect={onSelect} onDragItem={beginDrag} onDragEnd={endDrag} label="Stash" />
          </div>
        )}
        <div className={`inventory-drop-zone ${draggedIsEquipped || draggedIsInStash ? "drop-compatible" : ""}`} onDragOver={(event) => { if (draggedIsEquipped || draggedIsInStash) event.preventDefault(); }} onDrop={dropIntoBackpack}>
          {(draggedIsEquipped || draggedIsInStash) && <span className="drop-zone-prompt">Drop here to move into backpack</span>}
          <InventoryGrid items={backpackItems} columns={12} rows={5} selectedId={selectedItemId} onSelect={onSelect} onDragItem={beginDrag} onDragEnd={endDrag} onEquipItem={onEquipItem} label="Backpack" highlightedIds={freshItems} />
        </div>
      </div>
    </div>
  );
}
