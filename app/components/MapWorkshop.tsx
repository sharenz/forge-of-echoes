"use client";

import { useState } from "react";
import { MAP_MODIFIERS } from "../game/config/maps";
import type { CurrencyAmounts, InventoryItem, ItemContainerId, MapItem, PlayerProfile } from "../game/domain";
import { containerItems, findContainerEntry } from "../game/item-container";
import { isMapItem } from "../game/inventory";
import { mapDanger, mapModifierDescription, mapModifierRewardDescription, mapStatSummary } from "../game/maps";
import { InventoryGrid, type GridOffset } from "./InventoryGrid";
import { ItemIcon } from "./ItemIcon";

interface MapWorkshopProps {
  profile: PlayerProfile;
  slottedMap: MapItem | null;
  activeMap: MapItem | null;
  portalsRemaining: number;
  currencies: CurrencyAmounts;
  selectedItemId: string | null;
  onSelect: (id: string) => void;
  onMoveItem: (id: string, targetId: ItemContainerId, x: number, y: number) => void;
  onSlot: (id: string) => void;
  onRemove: () => void;
  onCraft: (action: "dust" | "threat" | "reward") => void;
  onOpen: () => void;
}

const ACTIONS = [
  { id: "dust" as const, name: "Map Dust", description: "Reroll all modifiers", currency: "mapDust" as const },
  { id: "threat" as const, name: "Threat Glyph", description: "Add a danger modifier", currency: "threatGlyph" as const },
  { id: "reward" as const, name: "Reward Ink", description: "Add a reward modifier", currency: "rewardInk" as const },
];

export function MapWorkshop({ profile, slottedMap, activeMap, portalsRemaining, currencies, selectedItemId, onSelect, onMoveItem, onSlot, onRemove, onCraft, onOpen }: MapWorkshopProps) {
  const [dragState, setDragState] = useState<{ itemId: string; offset: GridOffset } | null>(null);
  const backpackItems = containerItems(profile.inventory);
  const maps = backpackItems.filter(isMapItem);
  const draggedItem: InventoryItem | null = dragState
    ? findContainerEntry(profile.inventory, dragState.itemId)?.item ?? null
    : null;
  const displayedMap = slottedMap ?? activeMap;
  const mapStats = displayedMap ? mapStatSummary(displayedMap) : null;
  const readItemId = (event: React.DragEvent) => event.dataTransfer.getData("application/x-crafty-item") || event.dataTransfer.getData("text/plain") || dragState?.itemId || "";
  const slotDroppedMap = (event: React.DragEvent) => {
    event.preventDefault();
    const itemId = readItemId(event);
    if (maps.some((map) => map.id === itemId)) onSlot(itemId);
    setDragState(null);
  };

  return (
    <div className="map-device-interface">
      <section className="map-device-console" aria-label="Map device">
        <header className="map-device-console-heading">
          <div><span>Ancient mechanism</span><h3>Map Device</h3></div>
          <i aria-hidden="true">◇</i>
        </header>

        {activeMap && (
          <div className="active-expedition-card">
            <span>Expedition active</span>
            <strong>{activeMap.baseName}</strong>
            <small>Tier {activeMap.tier} · {portalsRemaining} of 6 portals remain</small>
            <div className="portal-use-pips" aria-label={`${portalsRemaining} portals remaining`}>
              {Array.from({ length: 6 }, (_, index) => <i className={index < portalsRemaining ? "available" : "used"} key={index} />)}
            </div>
          </div>
        )}

        <div
          className={`map-device-single-slot ${slottedMap ? "filled" : "empty"} ${draggedItem && isMapItem(draggedItem) ? "drop-ready" : ""}`}
          onDragOver={(event) => {
            if (!draggedItem || !isMapItem(draggedItem)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={slotDroppedMap}
        >
          {slottedMap ? (
            <>
              <ItemIcon item={slottedMap} />
              <div><span className={`rarity-${slottedMap.rarity}`}>{slottedMap.rarity} map · tier {slottedMap.tier}</span><strong>{slottedMap.baseName}</strong><small>{slottedMap.implicit}</small></div>
              <button type="button" onClick={onRemove} aria-label="Return map to backpack">×</button>
            </>
          ) : (
            <><i aria-hidden="true">◇</i><strong>One map slot</strong><small>{activeMap ? "Empty · insert a map to replace the expedition" : "Drag a map from your backpack"}</small></>
          )}
        </div>

        {displayedMap && mapStats && (
          <div className="map-device-summary">
            <div><span>Danger</span><strong>{mapDanger(displayedMap)}</strong></div>
            <div><span>Item quantity</span><strong>+{mapStats.itemQuantity}%</strong></div>
            <div><span>Item rarity</span><strong>+{mapStats.itemRarity}%</strong></div>
            <div><span>Monster count</span><strong>+{mapStats.monsterCount}%</strong></div>
            <div><span>Monster rarity</span><strong>+{mapStats.monsterRarity}%</strong></div>
          </div>
        )}

        {slottedMap && (
          <div className="map-device-affixes">
            <span>Map modifiers</span>
            {slottedMap.modifiers.length === 0 && <small>Normal map · no crafted modifiers</small>}
            {slottedMap.modifiers.map((id) => {
              const modifier = MAP_MODIFIERS[id];
              return <div key={id}><strong>{modifier.name}</strong><small>{mapModifierDescription(id, slottedMap.tier)}</small><em>{mapModifierRewardDescription(id)}</em></div>;
            })}
          </div>
        )}

        <button type="button" className="map-device-open" onClick={onOpen} disabled={!slottedMap}>
          <span>{activeMap ? "Open New Map" : "Open Map"}</span>
          <small>{slottedMap ? activeMap ? "Consume map · replace old portals with 6 new portals" : "Consume map · create 6 one-use portals" : "Insert a map first"}</small>
        </button>

        <div className="map-device-crafting">
          <header><span>Craft slotted map</span><small>Currency from inventory or stash</small></header>
          <div>
            {ACTIONS.map((action) => (
              <button type="button" key={action.id} onClick={() => onCraft(action.id)} disabled={!slottedMap || currencies[action.currency] <= 0 || slottedMap.corrupted}>
                <i>{action.name.charAt(0)}</i><span><strong>{action.name}</strong><small>{action.description}</small></span><em>{currencies[action.currency]}</em>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="map-device-backpack" aria-label="Backpack inventory">
        <header>
          <div><span>Character inventory</span><h3>Backpack</h3></div>
          <small><strong>{maps.length}</strong> map{maps.length === 1 ? "" : "s"} available · drag one into the device</small>
        </header>
        <InventoryGrid
          container={profile.inventory}
          profile={profile}
          selectedId={selectedItemId}
          onSelect={onSelect}
          draggedItem={draggedItem}
          draggedOffset={dragState?.offset}
          onDragItem={(itemId, offset) => { setDragState({ itemId, offset }); onSelect(itemId); }}
          onDragEnd={() => setDragState(null)}
          onDropItem={onMoveItem}
          onQuickMove={(itemId) => {
            if (maps.some((map) => map.id === itemId)) onSlot(itemId);
          }}
          quickMoveHint="Ctrl/⌘-click a map to insert it"
        />
        <footer><span>Only map items fit the device slot.</span><small>Drag or Ctrl/⌘-click a map · item positions remain unchanged.</small></footer>
      </section>
    </div>
  );
}
