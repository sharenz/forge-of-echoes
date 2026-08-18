import type { EquipmentItem, Materials, PlayerProfile } from "../game/domain";
import { InventoryGrid } from "./InventoryGrid";
import { ItemCard } from "./ItemCard";

interface InventoryPanelProps {
  profile: PlayerProfile;
  backpackItems: EquipmentItem[];
  selectedItem: EquipmentItem | null;
  selectedItemId: string | null;
  showStash?: boolean;
  freshItemIds?: string[];
  runMaterials?: Partial<Materials>;
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
  freshItemIds = [],
  runMaterials,
  onSelect,
  onEquip,
  onUnequip,
  onTransfer,
}: InventoryPanelProps) {
  const selectedIsEquipped = Boolean(selectedItem && profile.equipped[selectedItem.slot]?.id === selectedItem.id);
  const selectedIsInStash = Boolean(selectedItem && profile.stash.some((item) => item.id === selectedItem.id));
  const freshItems = new Set(freshItemIds);
  const materialDrops = [
    ["scrap", "Scrap", runMaterials?.scrap ?? 0],
    ["essence", "Essence", runMaterials?.essence ?? 0],
    ["map-dust", "Map Dust", runMaterials?.mapDust ?? 0],
  ] as const;
  const hasRunPickups = freshItems.size > 0 || materialDrops.some(([, , amount]) => amount > 0);

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
        {hasRunPickups && (
          <section className="run-pickup-ledger" aria-label="Items collected in this map">
            <header><div><span>Collected this map</span><strong>{freshItems.size} new equipment</strong></div><small>Picked up and secured</small></header>
            <div>
              {materialDrops.map(([kind, label, amount]) => (
                <span className={`run-material material-${kind}`} key={kind}><i>{label.charAt(0)}</i><small>{label}</small><strong>{amount}</strong></span>
              ))}
            </div>
          </section>
        )}
        {showStash && <InventoryGrid items={profile.stash} columns={12} rows={8} selectedId={selectedItemId} onSelect={onSelect} label="Stash" />}
        <InventoryGrid items={backpackItems} columns={12} rows={5} selectedId={selectedItemId} onSelect={onSelect} label="Backpack" highlightedIds={freshItems} />
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
