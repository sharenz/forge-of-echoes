"use client";

import { useState } from "react";
import type { EquipmentItem } from "../game/domain";
import { itemDisplayName } from "../game/items";
import { ItemTooltip } from "./ItemTooltip";

interface ItemCardProps {
  item: EquipmentItem;
  compact?: boolean;
  selected?: boolean;
  onClick?: () => void;
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLButtonElement>;
  onDragEnd?: React.DragEventHandler<HTMLButtonElement>;
}

export function ItemCard({ item, compact = false, selected = false, onClick, draggable = false, onDragStart, onDragEnd }: ItemCardProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        type="button"
        className={`item-card rarity-${item.rarity} ${compact ? "compact" : ""} ${selected ? "selected" : ""}`}
        onClick={onClick}
        draggable={draggable}
        onDragStart={(event) => { setTooltip(null); onDragStart?.(event); }}
        onDragEnd={onDragEnd}
        onPointerEnter={(event) => setTooltip({ x: event.clientX, y: event.clientY })}
        onPointerMove={(event) => setTooltip({ x: event.clientX, y: event.clientY })}
        onPointerLeave={() => setTooltip(null)}
        onFocus={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setTooltip({ x: rect.right, y: rect.top }); }}
        onBlur={() => setTooltip(null)}
      >
        <span className="item-card-kicker">{item.rarity} · item level {item.itemLevel}</span>
        <strong>{itemDisplayName(item)}</strong>
        <span className="item-implicit">{item.implicit}</span>
        {!compact && item.affixes.map((affix) => (
          <span className="item-affix" key={affix.id}>
            <em>T{affix.tier}</em> +{affix.value}{affix.unit === "percent" ? "%" : ""} {affix.tag}
          </span>
        ))}
        {!compact && <span className="item-stability">Stability {item.stability}/{item.maxStability}</span>}
      </button>
      {compact && tooltip && <ItemTooltip item={item} x={tooltip.x} y={tooltip.y} hint={draggable ? "Drag to move this equipped item" : undefined} />}
    </>
  );
}
