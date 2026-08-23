"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CURRENCY_DEFINITIONS } from "../game/config/currencies";
import { CHARACTER_EQUIPMENT_SLOTS } from "../game/config/equipment-slots";
import { STASH_RULES } from "../game/config/stash";
import type { CharacterEquipmentSlot, CurrencyItem, EquipmentItem, InventoryItem, ItemContainerId, PlayerProfile } from "../game/domain";
import { equipmentSlotAccepts } from "../game/equipment";
import { containerItems } from "../game/item-container";
import { isCurrencyItem, isEquipmentItem, isFlaskItem } from "../game/inventory";
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
  onQuickUnstash: (id: string) => void;
  onApplyCurrency: (currencyItemId: string, targetItemId: string) => void;
  onSelectStashTab: (tabId: string) => void;
  onRenameStashTab: (tabId: string, name: string) => void;
  onCreateStashTab: () => void;
  onLoadFlask: (id: string, slotIndex: number) => void;
}

interface CraftingSelection {
  itemId: string;
  x: number;
  y: number;
}

function CraftingCursor({ currency, initialPosition }: { currency: CurrencyItem; initialPosition: Pick<CraftingSelection, "x" | "y"> }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (ref.current) ref.current.style.transform = `translate3d(${event.clientX + 15}px, ${event.clientY + 15}px, 0)`;
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      className="inventory-crafting-cursor"
      style={{ transform: `translate3d(${initialPosition.x + 15}px, ${initialPosition.y + 15}px, 0)` }}
      aria-hidden="true"
    >
      <ItemIcon item={currency} />
      <strong>{currency.stackSize}</strong>
    </div>,
    document.body,
  );
}

export function InventoryPanel({ profile, selectedItemId, showStash = false, freshItemIds = [], onSelect, onEquipItem, onMoveItem, onQuickStash, onQuickUnstash, onApplyCurrency, onSelectStashTab, onRenameStashTab, onCreateStashTab, onLoadFlask }: InventoryPanelProps) {
  const [dragState, setDragState] = useState<{ itemId: string; offset: GridOffset } | null>(null);
  const [activeCurrencySelection, setActiveCurrencySelection] = useState<CraftingSelection | null>(null);
  const draggedItemId = dragState?.itemId ?? null;
  const freshItems = new Set(freshItemIds);
  const backpackItems = containerItems(profile.inventory);
  const currentStashTab = activeStashTab(profile.stash);
  const stashItems = allStashItems(profile.stash);
  const equippedItems = Object.values(profile.equipped).filter(Boolean) as EquipmentItem[];
  const allItems: InventoryItem[] = [...equippedItems, ...profile.flaskBelt.filter(Boolean), ...backpackItems, ...stashItems] as InventoryItem[];
  const draggedItem = allItems.find((item) => item.id === draggedItemId) ?? null;
  const activeCurrencyCandidate = backpackItems.find((item) => item.id === activeCurrencySelection?.itemId);
  const activeCurrency: CurrencyItem | null = activeCurrencyCandidate && isCurrencyItem(activeCurrencyCandidate)
    ? activeCurrencyCandidate
    : null;

  useEffect(() => {
    if (!activeCurrency) return;
    const cancelCrafting = (event: KeyboardEvent) => {
      if (event.code !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setActiveCurrencySelection(null);
    };
    window.addEventListener("keydown", cancelCrafting, { capture: true });
    return () => window.removeEventListener("keydown", cancelCrafting, { capture: true });
  }, [activeCurrency]);

  const beginDrag = (id: string, offset: GridOffset = { x: 0, y: 0 }) => {
    setDragState({ itemId: id, offset });
    onSelect(id);
  };
  const endDrag = () => setDragState(null);
  const readDroppedItem = (event: React.DragEvent) => event.dataTransfer.getData("application/x-forge-of-echoes-item") || event.dataTransfer.getData("text/plain") || draggedItemId;
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
  const quickUseBackpackItem = (itemId: string) => {
    if (showStash) {
      onQuickStash(itemId);
      return;
    }
    const item = backpackItems.find((candidate) => candidate.id === itemId);
    if (item && isEquipmentItem(item)) onEquipItem(item.id);
    else if (item && isFlaskItem(item)) loadFirstFlaskSlot(item.id);
  };
  const applyCurrency = (targetItemId: string) => {
    if (!activeCurrency) return;
    onApplyCurrency(activeCurrency.id, targetItemId);
  };

  return (
    <div className={`inventory-window ${showStash ? "stash-inventory-window" : "character-inventory-window"} ${activeCurrency ? "crafting-active" : ""}`}>
      {activeCurrency && activeCurrencySelection && <CraftingCursor currency={activeCurrency} initialPosition={activeCurrencySelection} />}
      <div className={`equipment-paperdoll paperdoll-${profile.character.classId}`}>
        <div className="paperdoll-character" aria-hidden="true"><i /></div>
        {CHARACTER_EQUIPMENT_SLOTS.map((slot) => {
          const equipped = profile.equipped[slot.id];
          const compatible = Boolean(draggedItem && isEquipmentItem(draggedItem) && equipmentSlotAccepts(slot.id, draggedItem));
          return (
            <div
              className={`equipment-slot slot-${slot.id} ${draggedItem ? compatible ? "drop-compatible" : "drop-incompatible" : ""}`}
              onDragOver={(event) => { if (compatible) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
              onDrop={(event) => dropIntoSlot(event, slot.id)}
              aria-label={slot.label}
              key={slot.id}
            >
              {equipped
                ? <ItemCard compact draggable item={equipped} profile={profile} onClick={() => onSelect(equipped.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-forge-of-echoes-item", equipped.id); event.dataTransfer.setData("application/x-forge-of-echoes-offset", JSON.stringify({ x: 0, y: 0 })); beginDrag(equipped.id); }} onDragEnd={endDrag} selected={selectedItemId === equipped.id} />
                : <span>Empty</span>}
            </div>
          );
        })}
      </div>
      <div className="inventory-containers">
        {activeCurrency && <div className="inventory-crafting-help active" aria-live="polite"><ItemIcon item={activeCurrency} /><span><strong>{CURRENCY_DEFINITIONS[activeCurrency.baseId].name}</strong><small>Choose an item · Esc cancels</small></span></div>}
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
              <small>Ctrl/⌘-click transfers items between this tab and your backpack.</small>
            </div>
            <InventoryGrid container={currentStashTab.container} profile={profile} selectedId={selectedItemId} onSelect={onSelect} draggedItem={draggedItem} draggedOffset={dragState?.offset} onDragItem={beginDrag} onDragEnd={endDrag} onDropItem={onMoveItem} onQuickMove={onQuickUnstash} quickMoveHint="Ctrl/⌘-click to move to backpack" />
          </section>
        )}
        <InventoryGrid container={profile.inventory} profile={profile} selectedId={selectedItemId} onSelect={onSelect} highlightedIds={freshItems} draggedItem={draggedItem} draggedOffset={dragState?.offset} onDragItem={beginDrag} onDragEnd={endDrag} onDropItem={onMoveItem} onQuickMove={quickUseBackpackItem} quickMoveHint={showStash ? "Ctrl/⌘-click to move to stash" : "Ctrl/⌘-click to equip or load"} activeCurrency={activeCurrency} onActivateCurrency={(itemId, position) => setActiveCurrencySelection({ itemId, ...position })} onCancelCurrency={() => setActiveCurrencySelection(null)} onApplyCurrency={applyCurrency} />
      </div>
    </div>
  );
}
