"use client";

import { useState } from "react";
import { ITEM_CONTAINER_DEFINITIONS } from "../game/config/containers";
import { CHARACTER_EQUIPMENT_SLOTS } from "../game/config/equipment-slots";
import { STASH_RULES } from "../game/config/stash";
import { FLASK_DEFINITIONS } from "../game/config/flasks";
import type { CharacterEquipmentSlot, EquipmentItem, InventoryItem, ItemContainerId, PlayerProfile } from "../game/domain";
import { equipmentSlotAccepts } from "../game/equipment";
import { containerItems, itemFootprint } from "../game/item-container";
import { currencyAmounts, isEquipmentItem, isFlaskItem } from "../game/inventory";
import { firstCompatibleFlaskSlot } from "../game/flasks";
import { activeStashTab, stashItems as allStashItems } from "../game/stash";
import { InventoryGrid, type GridOffset } from "./InventoryGrid";
import { ItemCard } from "./ItemCard";
import { ItemIcon } from "./ItemIcon";

interface InventoryPanelProps {
  profile: PlayerProfile;
  selectedItemId: string | null;
  showStash?: boolean;
  freshItemIds?: string[];
  onSelect: (id: string) => void;
  onEquipItem: (id: string, slot?: CharacterEquipmentSlot) => void;
  onMoveItem: (id: string, target: ItemContainerId, x: number, y: number) => void;
  onQuickStash: (id: string) => void;
  onSelectStashTab: (tabId: string) => void;
  onRenameStashTab: (tabId: string, name: string) => void;
  onCreateStashTab: () => void;
  onLoadFlask: (id: string, slotIndex: number) => void;
  onUnloadFlask: (slotIndex: number) => void;
  onDropToGround: (id: string) => void;
}

export function InventoryPanel({ profile, selectedItemId, showStash = false, freshItemIds = [], onSelect, onEquipItem, onMoveItem, onQuickStash, onSelectStashTab, onRenameStashTab, onCreateStashTab, onLoadFlask, onUnloadFlask, onDropToGround }: InventoryPanelProps) {
  const [dragState, setDragState] = useState<{ itemId: string; offset: GridOffset } | null>(null);
  const draggedItemId = dragState?.itemId ?? null;
  const freshItems = new Set(freshItemIds);
  const backpackItems = containerItems(profile.inventory);
  const currentStashTab = activeStashTab(profile.stash);
  const stashItems = allStashItems(profile.stash);
  const equippedItems = Object.values(profile.equipped).filter(Boolean) as EquipmentItem[];
  const allItems: InventoryItem[] = [...equippedItems, ...profile.flaskBelt.filter(Boolean), ...backpackItems, ...stashItems] as InventoryItem[];
  const draggedItem = allItems.find((item) => item.id === draggedItemId) ?? null;
  const freshInventory = backpackItems.filter((item) => freshItems.has(item.id));
  const freshCurrency = currencyAmounts(freshInventory);
  const materialDrops = [
    ["scrap", "Scrap", freshCurrency.scrap],
    ["essence", "Essence", freshCurrency.essence],
    ["map-dust", "Map Dust", freshCurrency.mapDust],
  ] as const;
  const hasRunPickups = freshItems.size > 0;
  const backpackCapacity = ITEM_CONTAINER_DEFINITIONS.backpack.columns * ITEM_CONTAINER_DEFINITIONS.backpack.rows;
  const occupiedBackpackCells = profile.inventory.entries.reduce((total, entry) => {
    const footprint = itemFootprint(entry.item);
    return total + footprint.width * footprint.height;
  }, 0);
  const backpackCurrency = currencyAmounts(backpackItems);

  const beginDrag = (id: string, offset: GridOffset = { x: 0, y: 0 }) => {
    setDragState({ itemId: id, offset });
    onSelect(id);
  };
  const endDrag = () => setDragState(null);
  const readDroppedItem = (event: React.DragEvent) => event.dataTransfer.getData("application/x-crafty-item") || event.dataTransfer.getData("text/plain") || draggedItemId;
  const dropIntoSlot = (event: React.DragEvent, slot: CharacterEquipmentSlot) => {
    event.preventDefault();
    const itemId = readDroppedItem(event);
    const item = allItems.find((candidate) => candidate.id === itemId);
    if (item && isEquipmentItem(item) && equipmentSlotAccepts(slot, item)) onEquipItem(item.id, slot);
    endDrag();
  };
  const loadFirstFlaskSlot = (itemId: string) => {
    const item = backpackItems.find((candidate) => candidate.id === itemId);
    if (!item || !isFlaskItem(item)) return;
    const slotIndex = firstCompatibleFlaskSlot(profile, item.baseId);
    if (slotIndex !== null) onLoadFlask(item.id, slotIndex);
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
                ? <ItemCard compact draggable item={equipped} profile={profile} onClick={() => onSelect(equipped.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-crafty-item", equipped.id); event.dataTransfer.setData("application/x-crafty-offset", JSON.stringify({ x: 0, y: 0 })); beginDrag(equipped.id); }} onDragEnd={endDrag} selected={selectedItemId === equipped.id} />
                : <span>Empty</span>}
            </div>
          );
        })}
      </div>
      <div className="inventory-containers">
        <section className="inventory-flask-belt" aria-label="Flask belt slots">
          <header><div><span>Flask belt</span><strong>Combat consumables</strong></div><small>Keys 1–5 · 5 per slot</small></header>
          <div>
            {profile.flaskBelt.map((flask, index) => {
              const compatible = Boolean(draggedItem && isFlaskItem(draggedItem) && (!flask || flask.baseId === draggedItem.baseId));
              const definition = flask ? FLASK_DEFINITIONS[flask.baseId] : null;
              return (
                <div
                  className={`inventory-flask-slot ${definition ? `flask-${definition.resource}` : "empty"} ${draggedItem ? compatible ? "drop-compatible" : "drop-incompatible" : ""}`}
                  onDragOver={(event) => { if (compatible) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
                  onDrop={(event) => { event.preventDefault(); const id = readDroppedItem(event); if (id) onLoadFlask(id, index); endDrag(); }}
                  key={index}
                >
                  <kbd>{index + 1}</kbd>
                  {flask && definition ? <><ItemIcon item={flask} /><strong>{flask.stackSize}</strong><button type="button" onClick={() => onUnloadFlask(index)} aria-label={`Move ${definition.name} to backpack`}>×</button></> : <span>Empty</span>}
                </div>
              );
            })}
          </div>
        </section>
        <section
          className={`inventory-ground-drop ${draggedItem ? "drop-ready" : ""}`}
          aria-label="Drop item on the ground"
          onDragOver={(event) => {
            if (!draggedItem) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const itemId = readDroppedItem(event);
            if (itemId) onDropToGround(itemId);
            endDrag();
          }}
        >
          <i aria-hidden="true"><b>↓</b></i>
          <div><span>Drop to ground</span><strong>Drag an item here to place it beside your character</strong></div>
          <small>It remains in this area until you leave.</small>
        </section>
        <section className="inventory-overview" aria-label="Inventory overview">
          <div><span>Backpack space</span><strong>{occupiedBackpackCells}<small> / {backpackCapacity} cells</small></strong><i><b style={{ width: `${occupiedBackpackCells / backpackCapacity * 100}%` }} /></i></div>
          <div><span>Equipped</span><strong>{equippedItems.length}<small> / {CHARACTER_EQUIPMENT_SLOTS.length} slots</small></strong></div>
          <div><span>Crafting wealth</span><strong>{backpackCurrency.scrap}<small> Scrap</small></strong><em>{backpackCurrency.essence} Essence · {backpackCurrency.mapDust} Dust</em></div>
        </section>
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
          <section className="stash-tab-section" aria-label="Stash tabs">
            <div className="stash-tab-bar" role="tablist" aria-label="Stash tabs">
              {profile.stash.tabs.map((tab, index) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.id === currentStashTab.id}
                  className={tab.id === currentStashTab.id ? "active" : ""}
                  onClick={() => onSelectStashTab(tab.id)}
                  key={tab.id}
                ><small>{index + 1}</small><span>{tab.name}</span></button>
              ))}
              <button type="button" className="stash-tab-add" onClick={onCreateStashTab} disabled={profile.stash.tabs.length >= STASH_RULES.maximumTabs} aria-label="Create stash tab">+</button>
            </div>
            <div className="stash-tab-tools">
              <label key={currentStashTab.id}>
                <span>Tab name</span>
                <input
                  defaultValue={currentStashTab.name}
                  maxLength={STASH_RULES.maximumNameLength}
                  onBlur={(event) => {
                    const fallback = `Tab ${profile.stash.tabs.findIndex((tab) => tab.id === currentStashTab.id) + 1}`;
                    const name = event.currentTarget.value.trim().slice(0, STASH_RULES.maximumNameLength) || fallback;
                    event.currentTarget.value = name;
                    onRenameStashTab(currentStashTab.id, name);
                  }}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                  aria-label="Rename active stash tab"
                />
              </label>
              <small>Ctrl-click a backpack item to send it to this tab.</small>
            </div>
            <InventoryGrid container={currentStashTab.container} profile={profile} selectedId={selectedItemId} onSelect={onSelect} draggedItem={draggedItem} draggedOffset={dragState?.offset} onDragItem={beginDrag} onDragEnd={endDrag} onDropItem={onMoveItem} />
          </section>
        )}
        <InventoryGrid container={profile.inventory} profile={profile} selectedId={selectedItemId} onSelect={onSelect} highlightedIds={freshItems} draggedItem={draggedItem} draggedOffset={dragState?.offset} onDragItem={beginDrag} onDragEnd={endDrag} onDropItem={onMoveItem} onEquipItem={onEquipItem} onActivateItem={loadFirstFlaskSlot} onQuickMove={showStash ? onQuickStash : undefined} />
      </div>
    </div>
  );
}
