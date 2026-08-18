"use client";

import { createPortal } from "react-dom";
import { CURRENCY_DEFINITIONS } from "../game/config/currencies";
import { EQUIPMENT_TYPE_LABELS } from "../game/config/equipment-slots";
import { MAP_MODIFIERS } from "../game/config/maps";
import type { InventoryItem } from "../game/domain";
import { isCurrencyItem, isEquipmentItem } from "../game/inventory";
import { itemDisplayName } from "../game/items";
import { mapDanger, mapModifierDescription, mapStatSummary } from "../game/maps";
import { formatModifier } from "../game/stats";

interface ItemTooltipProps {
  item: InventoryItem;
  x: number;
  y: number;
  hint?: string;
}

export function ItemTooltip({ item, x, y, hint }: ItemTooltipProps) {
  if (typeof document === "undefined") return null;
  const left = Math.max(12, Math.min(x + 18, window.innerWidth - 322));
  const top = Math.max(12, Math.min(y + 18, window.innerHeight - 390));

  if (isCurrencyItem(item)) {
    const definition = CURRENCY_DEFINITIONS[item.baseId];
    return createPortal(
      <aside className="item-tooltip currency-tooltip" style={{ left, top }} role="tooltip">
        <span>Stackable crafting currency</span>
        <strong>{definition.name}</strong>
        <em>{item.stackSize} / {definition.maxStackSize} per stack</em>
        <div className="tooltip-implicit">{definition.description}</div>
      </aside>,
      document.body,
    );
  }

  if (!isEquipmentItem(item)) {
    const mapStats = mapStatSummary(item);
    return createPortal(
      <aside className={`item-tooltip rarity-${item.rarity}`} style={{ left, top }} role="tooltip">
        <span>{item.rarity} map · tier {item.tier}</span>
        <strong>{item.baseName}</strong>
        <em>Map item · consumed by the map device</em>
        <div className="tooltip-implicit">{item.implicit}</div>
        <div className="tooltip-affixes">
          {item.modifiers.length > 0
            ? item.modifiers.map((id) => <div key={id}><i>◆</i><b>{MAP_MODIFIERS[id].name}: {mapModifierDescription(id, item.tier)}</b></div>)
            : <small>No explicit modifiers</small>}
        </div>
        <footer><span>Danger {mapDanger(item)} · +{mapStats.monsterCount}% monsters</span><strong>+{mapStats.itemQuantity}% quantity · +{mapStats.itemRarity}% rarity</strong></footer>
      </aside>,
      document.body,
    );
  }

  return createPortal(
    <aside className={`item-tooltip rarity-${item.rarity}`} style={{ left, top }} role="tooltip">
      <span>{item.rarity} · item level {item.itemLevel}</span>
      <strong>{itemDisplayName(item)}</strong>
      <em>{item.baseName} · {EQUIPMENT_TYPE_LABELS[item.slot]}</em>
      {item.baseStats.map((modifier) => <div className="tooltip-base-stat" key={`${modifier.stat}-${modifier.mode}`}>Base: {formatModifier(modifier)}</div>)}
      <div className="tooltip-implicit">{item.implicit}</div>
      <div className="tooltip-affixes">
        {item.affixes.length > 0
          ? item.affixes.map((affix) => <div key={affix.id}><i>T{affix.tier}</i><b>{affix.rolls.map(formatModifier).join(" · ")}</b></div>)
          : <small>No explicit modifiers</small>}
      </div>
      <footer><span>Stability</span><strong>{item.stability}/{item.maxStability}</strong></footer>
      {hint && <small>{hint}</small>}
    </aside>,
    document.body,
  );
}
