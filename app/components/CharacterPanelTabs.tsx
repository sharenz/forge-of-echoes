export type CharacterPanelView = "inventory" | "attributes" | "skills";

interface CharacterPanelTabsProps {
  active: CharacterPanelView;
  onChange: (view: CharacterPanelView) => void;
}

const CHARACTER_VIEWS: readonly {
  id: CharacterPanelView;
  glyph: string;
  label: string;
  description: string;
}[] = [
  { id: "inventory", glyph: "▦", label: "Inventory", description: "Equipment and backpack" },
  { id: "attributes", glyph: "◆", label: "Attributes", description: "Core and derived stats" },
  { id: "skills", glyph: "✦", label: "Skills", description: "Active skill progression" },
];

export function CharacterPanelTabs({ active, onChange }: CharacterPanelTabsProps) {
  return (
    <nav className="character-panel-tabs" aria-label="Character interfaces">
      {CHARACTER_VIEWS.map((view) => (
        <button
          type="button"
          className={active === view.id ? "active" : ""}
          aria-current={active === view.id ? "page" : undefined}
          onClick={() => onChange(view.id)}
          key={view.id}
        >
          <i>{view.glyph}</i>
          <span><strong>{view.label}</strong><small>{view.description}</small></span>
        </button>
      ))}
    </nav>
  );
}
