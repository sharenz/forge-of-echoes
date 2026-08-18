import type { EquipmentItem } from "../game/domain";
import { itemDisplayName } from "../game/items";

interface ItemCardProps {
  item: EquipmentItem;
  compact?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

export function ItemCard({ item, compact = false, selected = false, onClick }: ItemCardProps) {
  return (
    <button
      type="button"
      className={`item-card rarity-${item.rarity} ${compact ? "compact" : ""} ${selected ? "selected" : ""}`}
      onClick={onClick}
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
  );
}

