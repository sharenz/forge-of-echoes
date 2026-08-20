"use client";

import { useState, type CSSProperties, type DragEvent } from "react";
import { ITEM_CONTAINER_DEFINITIONS } from "../game/config/containers";
import { CURRENCY_DEFINITIONS } from "../game/config/currencies";
import { FLASK_DEFINITIONS } from "../game/config/flasks";
import type { InventoryItem, ItemContainer, PlayerProfile } from "../game/domain";
import { canPlaceItem, findContainerEntry, itemFootprint } from "../game/item-container";
import { isCurrencyItem, isEquipmentItem, isFlaskItem, isMapItem } from "../game/inventory";
import { itemDisplayName } from "../game/items";
import { ItemIcon } from "./ItemIcon";
import { ItemTooltip } from "./ItemTooltip";
import { useQuickAction } from "./useQuickAction";

interface InventoryGridProps {
  container: ItemContainer;
  profile?: PlayerProfile;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  highlightedIds?: ReadonlySet<string>;
  draggedItem?: InventoryItem | null;
  draggedOffset?: GridOffset | null;
  onDragItem?: (id: string, offset: GridOffset) => void;
  onDragEnd?: () => void;
  onDropItem?: (id: string, containerId: ItemContainer["id"], x: number, y: number) => void;
  onQuickMove?: (id: string) => void;
  quickMoveHint?: string;
}

interface DropPreview {
  x: number;
  y: number;
  valid: boolean;
}

export interface GridOffset {
  x: number;
  y: number;
}

function itemTitle(item: InventoryItem): string {
  if (isEquipmentItem(item)) return itemDisplayName(item);
  if (isMapItem(item)) return `${item.baseName} · Tier ${item.tier}`;
  if (isFlaskItem(item)) return FLASK_DEFINITIONS[item.baseId].name;
  return CURRENCY_DEFINITIONS[item.baseId].name;
}

function dragOffset(event: DragEvent, item: InventoryItem): GridOffset {
  const rect = event.currentTarget.getBoundingClientRect();
  const size = itemFootprint(item);
  return {
    x: Math.max(0, Math.min(size.width - 1, Math.floor((event.clientX - rect.left) / (rect.width / size.width)))),
    y: Math.max(0, Math.min(size.height - 1, Math.floor((event.clientY - rect.top) / (rect.height / size.height)))),
  };
}

function readOffset(event: DragEvent): { x: number; y: number } {
  try {
    const parsed = JSON.parse(event.dataTransfer.getData("application/x-crafty-offset")) as { x?: number; y?: number };
    return { x: Number.isInteger(parsed.x) ? parsed.x ?? 0 : 0, y: Number.isInteger(parsed.y) ? parsed.y ?? 0 : 0 };
  } catch {
    return { x: 0, y: 0 };
  }
}

export function InventoryGrid({ container, profile, selectedId, onSelect, highlightedIds, draggedItem, draggedOffset, onDragItem, onDragEnd, onDropItem, onQuickMove, quickMoveHint }: InventoryGridProps) {
  const definition = ITEM_CONTAINER_DEFINITIONS[container.id];
  const [tooltip, setTooltip] = useState<{ item: InventoryItem; x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<DropPreview | null>(null);
  const quickAction = useQuickAction();

  const quickMove = (itemId: string) => {
    if (!onQuickMove) return;
    setTooltip(null);
    onQuickMove(itemId);
  };

  const targetFromEvent = (event: DragEvent): DropPreview | null => {
    if (!draggedItem) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    // The HTML drag data store is protected during dragover in some browsers.
    // Keep the grabbed cell in React state and use the payload only as a drop fallback.
    const offset = draggedOffset ?? readOffset(event);
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * definition.columns) - offset.x;
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * definition.rows) - offset.y;
    const ignoreId = findContainerEntry(container, draggedItem.id) ? draggedItem.id : undefined;
    return { x, y, valid: canPlaceItem(container, draggedItem, x, y, ignoreId) };
  };

  return (
    <div className={`poe-grid-wrap container-${container.id}`}>
      <div className="poe-grid-label"><span>{definition.name}</span><em>{container.entries.length} items · positions saved</em></div>
      <div
        className={`poe-grid ${preview ? preview.valid ? "drop-valid" : "drop-invalid" : ""}`}
        style={{ "--grid-columns": definition.columns, "--grid-rows": definition.rows } as CSSProperties}
        role="listbox"
        tabIndex={0}
        aria-label={definition.name}
        onDragOver={(event) => {
          if (!draggedItem || !onDropItem) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setPreview(targetFromEvent(event));
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreview(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const target = targetFromEvent(event);
          const itemId = event.dataTransfer.getData("application/x-crafty-item") || event.dataTransfer.getData("text/plain") || draggedItem?.id;
          if (target?.valid && itemId) onDropItem?.(itemId, container.id, target.x, target.y);
          setPreview(null);
          onDragEnd?.();
        }}
      >
        {preview && draggedItem && (
          <span
            className={`grid-drop-preview ${preview.valid ? "valid" : "invalid"}`}
            style={{
              gridColumn: `${Math.max(0, Math.min(definition.columns - itemFootprint(draggedItem).width, preview.x)) + 1} / span ${itemFootprint(draggedItem).width}`,
              gridRow: `${Math.max(0, Math.min(definition.rows - itemFootprint(draggedItem).height, preview.y)) + 1} / span ${itemFootprint(draggedItem).height}`,
            }}
          />
        )}
        {container.entries.map(({ item, x, y }) => {
          const size = itemFootprint(item);
          const highlighted = highlightedIds?.has(item.id) ?? false;
          const visualClass = isEquipmentItem(item) || isMapItem(item) ? `rarity-${item.rarity}` : isFlaskItem(item) ? `inventory-flask flask-${item.baseId}` : "inventory-currency";
          return (
            <button
              type="button"
              role="option"
              aria-selected={selectedId === item.id}
              className={`poe-grid-item ${visualClass} item-kind-${item.kind} ${selectedId === item.id ? "selected" : ""} ${highlighted ? "new-drop" : ""}`}
              style={{ gridColumn: `${x + 1} / span ${size.width}`, gridRow: `${y + 1} / span ${size.height}` }}
              onClick={(event) => {
                if (onQuickMove && quickAction.fromClick(event, item.id, () => quickMove(item.id))) return;
                onSelect(item.id);
              }}
              onContextMenu={(event) => {
                if (onQuickMove) quickAction.fromContextMenu(event, item.id, () => quickMove(item.id));
              }}
              draggable={Boolean(onDragItem)}
              onDragStart={(event) => {
                const offset = dragOffset(event, item);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-crafty-item", item.id);
                event.dataTransfer.setData("application/x-crafty-offset", JSON.stringify(offset));
                event.dataTransfer.setData("text/plain", item.id);
                setTooltip(null);
                onDragItem?.(item.id, offset);
              }}
              onDragEnd={() => { setPreview(null); onDragEnd?.(); }}
              onPointerEnter={(event) => setTooltip({ item, x: event.clientX, y: event.clientY })}
              onPointerMove={(event) => setTooltip({ item, x: event.clientX, y: event.clientY })}
              onPointerLeave={() => setTooltip(null)}
              onFocus={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setTooltip({ item, x: rect.right, y: rect.top }); }}
              onBlur={() => setTooltip(null)}
              title={itemTitle(item)}
              key={item.id}
            >
              {highlighted && <em className="new-drop-badge">New</em>}
              <ItemIcon item={item} />
              {isMapItem(item) && <b className="item-tier-badge">T{item.tier}</b>}
              {(isCurrencyItem(item) || isFlaskItem(item)) && <b className="stack-count">{item.stackSize}</b>}
              {size.height > 1 && isEquipmentItem(item) && <small>{item.baseName}</small>}
            </button>
          );
        })}
      </div>
      {tooltip && <ItemTooltip item={tooltip.item} profile={profile} x={tooltip.x} y={tooltip.y} hint={onQuickMove ? `${quickMoveHint ?? "Ctrl/⌘-click for quick action"} · drag to place` : isEquipmentItem(tooltip.item) ? "Drag to move or equip" : isFlaskItem(tooltip.item) ? "Drag to move or load into belt" : "Drag to place"} />}
    </div>
  );
}
