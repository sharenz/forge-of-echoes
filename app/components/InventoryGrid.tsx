"use client";

import { useState } from "react";
import { CURRENCY_DEFINITIONS } from "../game/config/currencies";
import type { EquipmentItem, InventoryItem } from "../game/domain";
import { isCurrencyItem, isEquipmentItem, isMapItem } from "../game/inventory";
import { itemDisplayName } from "../game/items";
import { ItemTooltip } from "./ItemTooltip";

interface InventoryGridProps {
  items: InventoryItem[];
  columns: number;
  rows: number;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  label: string;
  highlightedIds?: ReadonlySet<string>;
  onDragItem?: (id: string) => void;
  onDragEnd?: () => void;
  onEquipItem?: (id: string) => void;
}

interface Placement {
  item: InventoryItem;
  x: number;
  y: number;
  width: number;
  height: number;
}

const EQUIPMENT_SIZE: Record<EquipmentItem["slot"], { width: number; height: number }> = {
  weapon: { width: 2, height: 4 },
  chest: { width: 2, height: 3 },
  boots: { width: 2, height: 2 },
  ring: { width: 1, height: 1 },
};

function itemSize(item: InventoryItem): { width: number; height: number } {
  return isEquipmentItem(item) ? EQUIPMENT_SIZE[item.slot] : { width: 1, height: 1 };
}

function packItems(items: InventoryItem[], columns: number, rows: number): Placement[] {
  const occupied = Array.from({ length: rows }, () => Array.from({ length: columns }, () => false));
  const placements: Placement[] = [];
  for (const item of items) {
    const size = itemSize(item);
    let placed = false;
    for (let y = 0; y <= rows - size.height && !placed; y += 1) {
      for (let x = 0; x <= columns - size.width && !placed; x += 1) {
        let available = true;
        for (let dy = 0; dy < size.height; dy += 1) {
          for (let dx = 0; dx < size.width; dx += 1) if (occupied[y + dy][x + dx]) available = false;
        }
        if (!available) continue;
        for (let dy = 0; dy < size.height; dy += 1) {
          for (let dx = 0; dx < size.width; dx += 1) occupied[y + dy][x + dx] = true;
        }
        placements.push({ item, x, y, ...size });
        placed = true;
      }
    }
  }
  return placements;
}

function itemTitle(item: InventoryItem): string {
  if (isEquipmentItem(item)) return itemDisplayName(item);
  if (isMapItem(item)) return `${item.baseName} · Tier ${item.tier}`;
  return CURRENCY_DEFINITIONS[item.baseId].name;
}

export function InventoryGrid({ items, columns, rows, selectedId, onSelect, label, highlightedIds, onDragItem, onDragEnd, onEquipItem }: InventoryGridProps) {
  const placements = packItems(items, columns, rows);
  const [tooltip, setTooltip] = useState<{ item: InventoryItem; x: number; y: number } | null>(null);
  return (
    <div className="poe-grid-wrap">
      <div className="poe-grid-label"><span>{label}</span><em>{placements.length}/{items.length} placed</em></div>
      <div className="poe-grid" style={{ "--grid-columns": columns, "--grid-rows": rows } as React.CSSProperties} role="listbox" aria-label={label}>
        {placements.map(({ item, x, y, width, height }) => {
          const highlighted = highlightedIds?.has(item.id) ?? false;
          const currency = isCurrencyItem(item) ? CURRENCY_DEFINITIONS[item.baseId] : null;
          const visualClass = isEquipmentItem(item) || isMapItem(item) ? `rarity-${item.rarity}` : "inventory-currency";
          return (
            <button
              type="button"
              role="option"
              aria-selected={selectedId === item.id}
              className={`poe-grid-item ${visualClass} item-kind-${item.kind} ${selectedId === item.id ? "selected" : ""} ${highlighted ? "new-drop" : ""}`}
              style={{ gridColumn: `${x + 1} / span ${width}`, gridRow: `${y + 1} / span ${height}` }}
              onClick={() => onSelect(item.id)}
              onDoubleClick={() => { if (isEquipmentItem(item)) onEquipItem?.(item.id); }}
              draggable={Boolean(onDragItem)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-crafty-item", item.id);
                event.dataTransfer.setData("text/plain", item.id);
                setTooltip(null);
                onDragItem?.(item.id);
              }}
              onDragEnd={() => onDragEnd?.()}
              onPointerEnter={(event) => setTooltip({ item, x: event.clientX, y: event.clientY })}
              onPointerMove={(event) => setTooltip({ item, x: event.clientX, y: event.clientY })}
              onPointerLeave={() => setTooltip(null)}
              onFocus={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setTooltip({ item, x: rect.right, y: rect.top }); }}
              onBlur={() => setTooltip(null)}
              title={itemTitle(item)}
              key={item.id}
            >
              {highlighted && <em className="new-drop-badge">New</em>}
              <span>{isEquipmentItem(item) ? item.baseName.split(" ").map((word) => word[0]).join("") : isMapItem(item) ? `T${item.tier}` : currency?.symbol}</span>
              {isCurrencyItem(item) && <b className="stack-count">{item.stackSize}</b>}
              {height > 1 && isEquipmentItem(item) && <small>{item.baseName}</small>}
            </button>
          );
        })}
      </div>
      {tooltip && <ItemTooltip item={tooltip.item} x={tooltip.x} y={tooltip.y} hint={isEquipmentItem(tooltip.item) ? "Drag to a matching slot · double-click to equip" : undefined} />}
    </div>
  );
}
