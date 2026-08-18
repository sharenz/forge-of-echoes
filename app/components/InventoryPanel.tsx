import type { EquipmentItem, PlayerProfile } from "../game/domain";
import { InventoryGrid } from "./InventoryGrid";
import { ItemCard } from "./ItemCard";

interface InventoryPanelProps {
  profile: PlayerProfile;
  backpackItems: EquipmentItem[];
  selectedItem: EquipmentItem | null;
  selectedItemId: string | null;
  showStash?: boolean;
  onSelect: (id: string) => void;
  onEquip: () => void;
  onUnequip: () => void;
  onTransfer?: () => void;
}

const EQUIPMENT_SLOTS = ["weapon", "chest", "ring", "boots"] as const;

export function InventoryPanel({
  profile,
  backpackItems,
  selectedItem,
  selectedItemId,
  showStash = false,
  onSelect,
  onEquip,
  onUnequip,
  onTransfer,
}: InventoryPanelProps) {
  const selectedIsEquipped = Boolean(selectedItem && profile.equipped[selectedItem.slot]?.id === selectedItem.id);
  const selectedIsInStash = Boolean(selectedItem && profile.stash.some((item) => item.id === selectedItem.id));

  return (
    <div className="inventory-window">
      <div className="equipment-paperdoll">
        <span className="eyebrow">Equipped</span>
        {EQUIPMENT_SLOTS.map((slot) => (
          <div className={`equipment-slot slot-${slot}`} key={slot}>
            <small>{slot}</small>
            {profile.equipped[slot]
              ? <ItemCard compact item={profile.equipped[slot]} onClick={() => onSelect(profile.equipped[slot]?.id ?? "")} selected={selectedItemId === profile.equipped[slot]?.id} />
              : <span>Empty</span>}
          </div>
        ))}
      </div>
      <div className="inventory-containers">
        {showStash && <InventoryGrid items={profile.stash} columns={12} rows={8} selectedId={selectedItemId} onSelect={onSelect} label="Stash" />}
        <InventoryGrid items={backpackItems} columns={12} rows={5} selectedId={selectedItemId} onSelect={onSelect} label="Backpack" />
      </div>
      <aside className="inventory-inspector">
        {selectedItem ? (
          <>
            <ItemCard item={selectedItem} />
            <button type="button" className="secondary-action" onClick={selectedIsEquipped ? onUnequip : onEquip}>
              {selectedIsEquipped ? "Unequip item" : "Equip item"}
            </button>
            {showStash && !selectedIsEquipped && onTransfer && (
              <button type="button" className="secondary-action" onClick={onTransfer}>
                {selectedIsInStash ? "Move to backpack" : "Move to stash"}
              </button>
            )}
          </>
        ) : <p>Select an item to inspect it.</p>}
      </aside>
    </div>
  );
}
