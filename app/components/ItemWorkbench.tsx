import type { EquipmentItem, Materials } from "../game/domain";
import { ItemCard } from "./ItemCard";

interface ItemWorkbenchProps {
  items: EquipmentItem[];
  equippedIds: Set<string>;
  materials: Materials;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCraft: (action: "scrap" | "essence") => void;
  onEquip: () => void;
}

export function ItemWorkbench({ items, equippedIds, materials, selectedId, onSelect, onCraft, onEquip }: ItemWorkbenchProps) {
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  return (
    <section className="item-workshop workshop-layout">
      <aside className="item-inventory panel">
        <div className="panel-heading"><div><span className="eyebrow">Stash</span><h2>Equipment</h2></div><span className="count-badge">{items.length}</span></div>
        <div className="item-grid">
          {items.map((item) => (
            <div className="item-grid-cell" key={item.id}>
              {equippedIds.has(item.id) && <span className="equipped-flag">E</span>}
              <ItemCard item={item} compact selected={selected?.id === item.id} onClick={() => onSelect(item.id)} />
            </div>
          ))}
        </div>
        {items.length === 0 && <p className="empty-state">Defeat elites and bosses to recover equipment.</p>}
      </aside>
      <div className="item-focus panel">
        {selected ? <>
          <div className="item-focus-card"><ItemCard item={selected} /></div>
          <button type="button" className="secondary-action" onClick={onEquip} disabled={equippedIds.has(selected.id)}>
            {equippedIds.has(selected.id) ? "Currently equipped" : `Equip ${selected.slot}`}
          </button>
        </> : <div className="empty-focus"><strong>No item selected</strong><span>Equipment recovered from maps appears here.</span></div>}
      </div>
      <aside className="craft-actions panel">
        <div className="panel-heading"><div><span className="eyebrow">Item workbench</span><h2>Develop the item</h2></div></div>
        <p className="panel-copy">Every structural craft consumes Stability. At zero Stability, the item is finished—not destroyed.</p>
        <div className="action-list">
          <button type="button" onClick={() => onCraft("scrap")} disabled={!selected || selected.affixes.length === 0 || selected.stability <= 0 || materials.scrap <= 0}>
            <span className="material-icon">S</span><span><strong>Refine with Scrap</strong><small>Reroll all affix values</small></span><em>{materials.scrap}</em>
          </button>
          <button type="button" onClick={() => onCraft("essence")} disabled={!selected || selected.affixes.length >= 4 || selected.stability < 2 || materials.essence <= 0}>
            <span className="material-icon essence">E</span><span><strong>Shape with Essence</strong><small>Add a fire-tagged affix</small></span><em>{materials.essence}</em>
          </button>
        </div>
        <div className="craft-note"><span>i</span> The prototype exposes all deterministic costs before you commit.</div>
      </aside>
    </section>
  );
}

