import { MAP_MODIFIERS } from "../game/content";
import type { CurrencyAmounts, MapItem } from "../game/domain";
import { mapDanger, mapModifierDescription, mapModifierRewardDescription, mapRewardBonus } from "../game/maps";

interface MapWorkshopProps {
  maps: MapItem[];
  slottedMap: MapItem | null;
  currencies: CurrencyAmounts;
  portalActive: boolean;
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

export function MapWorkshop({ maps, slottedMap, currencies, portalActive, onSlot, onRemove, onCraft, onOpen }: MapWorkshopProps) {
  const readMapId = (event: React.DragEvent) => event.dataTransfer.getData("application/x-crafty-map") || event.dataTransfer.getData("text/plain");

  return (
    <section className="workshop-layout map-device-layout" aria-label="Map device">
      <aside className="map-case panel">
        <div className="panel-heading">
          <div><span className="eyebrow">Backpack</span><h2>Map items</h2></div>
          <span className="count-badge">{maps.length}</span>
        </div>
        <div className="map-list">
          {maps.map((map) => (
            <button
              type="button"
              className={`map-list-item rarity-${map.rarity}`}
              key={map.id}
              onClick={() => onSlot(map.id)}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-crafty-map", map.id);
                event.dataTransfer.setData("text/plain", map.id);
              }}
            >
              <span className="map-tier">T{map.tier}</span>
              <span><strong>{map.baseName}</strong><small>{map.rarity} · {map.modifiers.length} affixes</small></span>
              <em>Insert</em>
            </button>
          ))}
        </div>
        {maps.length === 0 && <p className="empty-state">No map items are currently in your backpack.</p>}
      </aside>

      <div className="map-focus panel map-device-focus">
        <div className="map-device-heading"><span className="eyebrow">Map device</span><h2>One map slot</h2></div>
        <div
          className={`map-device-slot ${slottedMap ? "filled" : "empty"}`}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
          onDrop={(event) => { event.preventDefault(); const id = readMapId(event); if (id) onSlot(id); }}
        >
          {slottedMap ? (
            <>
              <div className="map-title-row">
                <div><span className={`rarity-label rarity-${slottedMap.rarity}`}>{slottedMap.rarity} map · tier {slottedMap.tier}</span><h1>{slottedMap.baseName}</h1><p>{slottedMap.implicit}</p></div>
                <div className="map-seal" aria-hidden="true"><span>{slottedMap.tier}</span></div>
              </div>
              <button type="button" className="map-slot-remove" onClick={onRemove}>Return to backpack</button>
            </>
          ) : (
            <div className="empty-map-slot"><span>◇</span><strong>Empty map slot</strong><small>Click a map item or drag one here</small></div>
          )}
        </div>

        {slottedMap && (
          <>
            <div className="map-metrics">
              <div><span>Danger</span><strong>{mapDanger(slottedMap)}</strong></div>
              <div><span>Reward bonus</span><strong>+{mapRewardBonus(slottedMap)}%</strong></div>
              <div><span>Quality</span><strong>{slottedMap.quality}%</strong></div>
              <div><span>Waves</span><strong>6</strong></div>
            </div>
            <div className="map-affixes compact-map-affixes">
              <span className="eyebrow">Crafted affixes</span>
              {slottedMap.modifiers.length === 0 && <p className="empty-affixes">Unmodified. Safe, predictable, and modestly rewarding.</p>}
              {slottedMap.modifiers.map((id) => {
                const modifier = MAP_MODIFIERS[id];
                return <div className="map-affix" key={id}><div><strong>{modifier.name}</strong><span>{mapModifierDescription(id, slottedMap.tier)}</span></div><em>{mapModifierRewardDescription(id)}</em></div>;
              })}
            </div>
          </>
        )}

        <button type="button" className="primary-action" onClick={onOpen} disabled={!slottedMap || portalActive}>
          <span>{portalActive ? "Portal already open" : "Open Map"}</span><small>{slottedMap ? "Consumes the map item in this slot" : "Insert one map item first"}</small>
        </button>
      </div>

      <aside className="craft-actions panel">
        <div className="panel-heading"><div><span className="eyebrow">Map crafting</span><h2>Shape slotted map</h2></div></div>
        <p className="panel-copy">Crafting currency is consumed from real stacks in your backpack or stash.</p>
        <div className="action-list">
          {ACTIONS.map((action) => (
            <button type="button" key={action.id} onClick={() => onCraft(action.id)} disabled={!slottedMap || currencies[action.currency] <= 0 || slottedMap.corrupted}>
              <span className="material-icon">{action.name.charAt(0)}</span>
              <span><strong>{action.name}</strong><small>{action.description}</small></span>
              <em>{currencies[action.currency]}</em>
            </button>
          ))}
        </div>
        <div className="craft-note"><span>i</span> Only the single map inside the device can be crafted or opened.</div>
      </aside>
    </section>
  );
}
