import { MAP_MODIFIERS } from "../game/content";
import type { MapItem, Materials } from "../game/domain";
import { mapDanger, mapRewardBonus } from "../game/maps";

interface MapWorkshopProps {
  maps: MapItem[];
  selectedMapId: string | null;
  materials: Materials;
  onSelect: (id: string) => void;
  onCraft: (action: "dust" | "threat" | "reward") => void;
  onEnter: () => void;
}

const ACTIONS = [
  { id: "dust" as const, name: "Map Dust", description: "Reroll all modifiers", material: "mapDust" as const },
  { id: "threat" as const, name: "Threat Glyph", description: "Add a danger modifier", material: "threatGlyph" as const },
  { id: "reward" as const, name: "Reward Ink", description: "Add a reward modifier", material: "rewardInk" as const },
];

export function MapWorkshop({ maps, selectedMapId, materials, onSelect, onCraft, onEnter }: MapWorkshopProps) {
  const selectedMap = maps.find((map) => map.id === selectedMapId) ?? maps[0];

  return (
    <section className="workshop-layout" aria-label="Map forge">
      <aside className="map-case panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Cartographer&apos;s case</span>
            <h2>Map inventory</h2>
          </div>
          <span className="count-badge">{maps.length}</span>
        </div>
        <div className="map-list">
          {maps.map((map) => (
            <button
              type="button"
              className={`map-list-item rarity-${map.rarity} ${map.id === selectedMap?.id ? "selected" : ""}`}
              key={map.id}
              onClick={() => onSelect(map.id)}
            >
              <span className="map-tier">T{map.tier}</span>
              <span><strong>{map.baseName}</strong><small>{map.rarity} · {map.modifiers.length} affixes</small></span>
            </button>
          ))}
        </div>
        {maps.length === 0 && <p className="empty-state">No maps remain. Complete runs to sustain your map case.</p>}
      </aside>

      <div className="map-focus panel">
        {selectedMap ? (
          <>
            <div className="map-title-row">
              <div>
                <span className={`rarity-label rarity-${selectedMap.rarity}`}>{selectedMap.rarity} map · tier {selectedMap.tier}</span>
                <h1>{selectedMap.baseName}</h1>
                <p>{selectedMap.implicit}</p>
              </div>
              <div className="map-seal" aria-hidden="true"><span>{selectedMap.tier}</span></div>
            </div>

            <div className="map-metrics">
              <div><span>Danger</span><strong>{mapDanger(selectedMap)}</strong></div>
              <div><span>Reward bonus</span><strong>+{mapRewardBonus(selectedMap)}%</strong></div>
              <div><span>Quality</span><strong>{selectedMap.quality}%</strong></div>
              <div><span>Waves</span><strong>6</strong></div>
            </div>

            <div className="map-affixes">
              <span className="eyebrow">Crafted affixes</span>
              {selectedMap.modifiers.length === 0 && <p className="empty-affixes">Unmodified. Safe, predictable, and modestly rewarding.</p>}
              {selectedMap.modifiers.map((id) => {
                const modifier = MAP_MODIFIERS[id];
                return (
                  <div className="map-affix" key={id}>
                    <div><strong>{modifier.name}</strong><span>{modifier.description}</span></div>
                    <em>{modifier.rewardDescription}</em>
                  </div>
                );
              })}
            </div>

            <button type="button" className="primary-action" onClick={onEnter}>
              <span>Open the Crucible</span><small>Consumes this map · 3 lives</small>
            </button>
          </>
        ) : (
          <div className="empty-focus"><strong>Your map case is empty</strong><span>A blank map will be granted for the next prototype run.</span></div>
        )}
      </div>

      <aside className="craft-actions panel">
        <div className="panel-heading">
          <div><span className="eyebrow">Map workbench</span><h2>Shape the run</h2></div>
        </div>
        <p className="panel-copy">Craft danger into the map before you enter. Greater risk directs better rewards.</p>
        <div className="action-list">
          {ACTIONS.map((action) => (
            <button
              type="button"
              key={action.id}
              onClick={() => onCraft(action.id)}
              disabled={!selectedMap || materials[action.material] <= 0 || selectedMap.corrupted}
            >
              <span className="material-icon">{action.name.charAt(0)}</span>
              <span><strong>{action.name}</strong><small>{action.description}</small></span>
              <em>{materials[action.material]}</em>
            </button>
          ))}
        </div>
        <div className="craft-note"><span>i</span> Exact danger and rewards are always shown before a map is consumed.</div>
      </aside>
    </section>
  );
}

