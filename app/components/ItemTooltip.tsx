"use client";

import { createPortal } from "react-dom";
import type { EquipmentItem } from "../game/domain";
import { itemDisplayName } from "../game/items";

interface ItemTooltipProps {
  item: EquipmentItem;
  x: number;
  y: number;
  hint?: string;
}

export function ItemTooltip({ item, x, y, hint }: ItemTooltipProps) {
  if (typeof document === "undefined") return null;
  const left = Math.max(12, Math.min(x + 18, window.innerWidth - 322));
  const top = Math.max(12, Math.min(y + 18, window.innerHeight - 350));

  return createPortal(
    <aside className={`item-tooltip rarity-${item.rarity}`} style={{ left, top }} role="tooltip">
      <span>{item.rarity} · item level {item.itemLevel}</span>
      <strong>{itemDisplayName(item)}</strong>
      <em>{item.baseName} · {item.slot}</em>
      <div className="tooltip-implicit">{item.implicit}</div>
      <div className="tooltip-affixes">
        {item.affixes.length > 0
          ? item.affixes.map((affix) => <div key={affix.id}><i>T{affix.tier}</i><b>+{affix.value}{affix.unit === "percent" ? "%" : ""} {affix.tag}</b></div>)
          : <small>No explicit modifiers</small>}
      </div>
      <footer><span>Stability</span><strong>{item.stability}/{item.maxStability}</strong></footer>
      {hint && <small>{hint}</small>}
    </aside>,
    document.body,
  );
}
