"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CURRENCY_DEFINITIONS } from "../game/config/currencies";
import { EQUIPMENT_TYPE_LABELS } from "../game/config/equipment-slots";
import { MAP_MODIFIERS } from "../game/config/maps";
import { FLASK_DEFINITIONS } from "../game/config/flasks";
import type { CharacterStats, EquipmentItem, InventoryItem, PlayerProfile } from "../game/domain";
import { compareEquipmentToCurrent, type EquipmentComparison, type EquipmentStatDelta } from "../game/item-comparison";
import { isCurrencyItem, isEquipmentItem, isFlaskItem } from "../game/inventory";
import { itemDisplayName } from "../game/items";
import { mapDanger, mapModifierDescription, mapStatSummary } from "../game/maps";
import { formatModifier, formatModifierWithRollRange } from "../game/stats";
import { ItemIcon } from "./ItemIcon";

interface ItemTooltipProps {
  item: InventoryItem;
  profile?: PlayerProfile;
  x: number;
  y: number;
  hint?: string;
}

const STAT_PRESENTATION: Record<keyof CharacterStats, { label: string; decimals: number; suffix?: string }> = {
  strength: { label: "Strength", decimals: 0 },
  dexterity: { label: "Dexterity", decimals: 0 },
  intelligence: { label: "Intelligence", decimals: 0 },
  maxLife: { label: "Maximum Life", decimals: 0 },
  maxFocus: { label: "Maximum Focus", decimals: 0 },
  attackDamage: { label: "Attack Damage", decimals: 1 },
  attackSpeed: { label: "Attack Speed", decimals: 2, suffix: "/s" },
  armor: { label: "Armor", decimals: 0 },
  evadeChance: { label: "Evade Chance", decimals: 1, suffix: "%" },
  moveSpeed: { label: "Movement Speed", decimals: 0 },
};

function statNumber(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/\.0+$/, "");
}

function statValue(delta: EquipmentStatDelta, key: "current" | "candidate"): string {
  const presentation = STAT_PRESENTATION[delta.stat];
  const decimals = Math.max(presentation.decimals, Math.abs(delta.delta) < 1 ? 2 : Number.isInteger(delta.delta) ? 0 : 1);
  return `${statNumber(delta[key], decimals)}${presentation.suffix ?? ""}`;
}

function statDelta(delta: EquipmentStatDelta): string {
  const presentation = STAT_PRESENTATION[delta.stat];
  const decimals = Math.max(presentation.decimals, Math.abs(delta.delta) < 1 ? 2 : Number.isInteger(delta.delta) ? 0 : 1);
  const value = statNumber(Math.abs(delta.delta), decimals);
  return `${delta.delta > 0 ? "+" : "−"}${value}${presentation.suffix ?? ""}`;
}

function StatComparison({ comparison }: { comparison: EquipmentComparison }) {
  return (
    <div className="tooltip-stat-comparison">
      <header>
        <span>{comparison.equippedItem ? "Change after replacement" : "Change after equipping"}</span>
        <small>{comparison.slotLabel} · resolved stats</small>
      </header>
      {comparison.statDeltas.length > 0
        ? comparison.statDeltas.map((delta) => (
          <div className={delta.delta > 0 ? "stat-gain" : "stat-loss"} key={delta.stat}>
            <span>{STAT_PRESENTATION[delta.stat].label}</span>
            <small>{statValue(delta, "current")} → {statValue(delta, "candidate")}</small>
            <strong>{statDelta(delta)}</strong>
          </div>
        ))
        : <p>No character stat changes</p>}
    </div>
  );
}

function EquipmentTooltipCard({ item, showRollRanges, heading, comparison, hint }: {
  item: EquipmentItem;
  showRollRanges: boolean;
  heading?: string;
  comparison?: EquipmentComparison;
  hint?: string;
}) {
  return (
    <section className={`item-tooltip-card rarity-${item.rarity}`}>
      <ItemIcon item={item} className="tooltip-item-icon" />
      <span>{heading ?? `${item.rarity} · item level ${item.itemLevel}`}</span>
      <strong>{itemDisplayName(item)}</strong>
      <em>{item.baseName} · {EQUIPMENT_TYPE_LABELS[item.slot]}</em>
      {item.baseStats.map((modifier) => <div className="tooltip-base-stat" key={`${modifier.stat}-${modifier.mode}`}>Base: {formatModifier(modifier)}</div>)}
      <div className="tooltip-implicit">{item.implicit}</div>
      <div className="tooltip-affixes">
        {item.affixes.length > 0
          ? item.affixes.map((affix) => (
            <div key={affix.id}>
              <i>T{affix.tier}</i>
              <b>{affix.rolls.map((roll) => formatModifierWithRollRange(roll, showRollRanges)).join(" · ")}</b>
            </div>
          ))
          : <small>No explicit modifiers</small>}
      </div>
      <footer><span>Stability</span><strong>{item.stability}/{item.maxStability}</strong></footer>
      {comparison && <StatComparison comparison={comparison} />}
      {hint && <small>{hint}</small>}
    </section>
  );
}

function useAltKey(): boolean {
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    const update = (event: KeyboardEvent) => setPressed(event.altKey);
    const release = () => setPressed(false);
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("blur", release);
    };
  }, []);

  return pressed;
}

export function ItemTooltip({ item, profile, x, y, hint }: ItemTooltipProps) {
  const showRollRanges = useAltKey();
  const equipmentComparisons = useMemo(() => isEquipmentItem(item) && profile
    ? compareEquipmentToCurrent(profile, item)
    : [], [item, profile]);
  if (typeof document === "undefined") return null;
  const showComparison = showRollRanges && equipmentComparisons.length > 0;
  const panelCount = showComparison ? 1 + equipmentComparisons.length : 1;
  const tooltipWidth = panelCount === 3 ? 960 : panelCount === 2 ? 636 : 304;
  const left = Math.max(12, Math.min(x + 18, window.innerWidth - tooltipWidth - 24));
  const top = Math.max(12, Math.min(y + 18, window.innerHeight - 390));

  if (isCurrencyItem(item)) {
    const definition = CURRENCY_DEFINITIONS[item.baseId];
    return createPortal(
      <aside className="item-tooltip currency-tooltip" style={{ left, top }} role="tooltip">
        <ItemIcon item={item} className="tooltip-item-icon" />
        <span>Stackable crafting currency</span>
        <strong>{definition.name}</strong>
        <em>{item.stackSize} / {definition.maxStackSize} per stack</em>
        <div className="tooltip-implicit">{definition.description}</div>
      </aside>,
      document.body,
    );
  }

  if (isFlaskItem(item)) {
    const definition = FLASK_DEFINITIONS[item.baseId];
    return createPortal(
      <aside className={`item-tooltip flask-tooltip flask-${definition.resource}`} style={{ left, top }} role="tooltip">
        <ItemIcon item={item} className="tooltip-item-icon" />
        <span>Stackable consumable</span>
        <strong>{definition.name}</strong>
        <em>{item.stackSize} / {definition.maxInventoryStack} in inventory · {definition.maxBeltStack} in belt</em>
        <div className="tooltip-implicit">Restores {definition.recovery} {definition.resource === "life" ? "Life" : "Mana"} over {definition.durationSeconds} seconds.</div>
        {hint && <small>{hint}</small>}
      </aside>,
      document.body,
    );
  }

  if (!isEquipmentItem(item)) {
    const mapStats = mapStatSummary(item);
    return createPortal(
      <aside className={`item-tooltip rarity-${item.rarity}`} style={{ left, top }} role="tooltip">
        <ItemIcon item={item} className="tooltip-item-icon" />
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
    <aside className={`item-tooltip equipment-tooltip ${showComparison ? `is-comparing comparison-count-${panelCount}` : ""}`} style={{ left, top }} role="tooltip">
      <div className="equipment-tooltip-grid">
        <EquipmentTooltipCard
          item={item}
          showRollRanges={showRollRanges}
          heading={showComparison ? `Hovered item · item level ${item.itemLevel}` : undefined}
          hint={hint}
        />
        {showComparison && equipmentComparisons.map((comparison) => (
          comparison.equippedItem
            ? <EquipmentTooltipCard item={comparison.equippedItem} showRollRanges heading={`Currently equipped · ${comparison.slotLabel}`} comparison={comparison} key={comparison.slot} />
            : (
              <section className="item-tooltip-card empty-comparison-slot" key={comparison.slot}>
                <span>Currently equipped · {comparison.slotLabel}</span>
                <strong>Empty slot</strong>
                <em>This item adds its full contribution.</em>
                <StatComparison comparison={comparison} />
              </section>
            )
        ))}
      </div>
      <small className={`tooltip-roll-hint ${showRollRanges ? "active" : ""}`}>
        {showComparison ? "Release Alt / Option to hide comparison" : showRollRanges ? "Roll ranges shown" : "Hold Alt / Option for ranges + equipped comparison"}
      </small>
    </aside>,
    document.body,
  );
}
