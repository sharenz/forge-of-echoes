import type { EquipmentItem } from "../game/domain";
import { itemDisplayName } from "../game/items";

interface InventoryGridProps {
  items: EquipmentItem[];
  columns: number;
  rows: number;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  label: string;
}

interface Placement {
  item: EquipmentItem;
  x: number;
  y: number;
  width: number;
  height: number;
}

const ITEM_SIZE: Record<EquipmentItem["slot"], { width: number; height: number }> = {
  weapon: { width: 2, height: 4 },
  chest: { width: 2, height: 3 },
  boots: { width: 2, height: 2 },
  ring: { width: 1, height: 1 },
};

function packItems(items: EquipmentItem[], columns: number, rows: number): Placement[] {
  const occupied = Array.from({ length: rows }, () => Array.from({ length: columns }, () => false));
  const placements: Placement[] = [];
  for (const item of items) {
    const size = ITEM_SIZE[item.slot];
    let placed = false;
    for (let y = 0; y <= rows - size.height && !placed; y += 1) {
      for (let x = 0; x <= columns - size.width && !placed; x += 1) {
        let available = true;
        for (let dy = 0; dy < size.height; dy += 1) {
          for (let dx = 0; dx < size.width; dx += 1) {
            if (occupied[y + dy][x + dx]) available = false;
          }
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

export function InventoryGrid({ items, columns, rows, selectedId, onSelect, label }: InventoryGridProps) {
  const placements = packItems(items, columns, rows);
  return (
    <div className="poe-grid-wrap">
      <div className="poe-grid-label"><span>{label}</span><em>{placements.length}/{items.length} placed</em></div>
      <div
        className="poe-grid"
        style={{ "--grid-columns": columns, "--grid-rows": rows } as React.CSSProperties}
        role="listbox"
        aria-label={label}
      >
        {placements.map(({ item, x, y, width, height }) => (
          <button
            type="button"
            role="option"
            aria-selected={selectedId === item.id}
            className={`poe-grid-item rarity-${item.rarity} ${selectedId === item.id ? "selected" : ""}`}
            style={{ gridColumn: `${x + 1} / span ${width}`, gridRow: `${y + 1} / span ${height}` }}
            onClick={() => onSelect(item.id)}
            title={itemDisplayName(item)}
            key={item.id}
          >
            <span>{item.baseName.split(" ").map((word) => word[0]).join("")}</span>
            {height > 1 && <small>{item.baseName}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

