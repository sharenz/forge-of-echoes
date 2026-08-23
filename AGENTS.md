# Forge of Echoes contributor guidance

## UI typography

All game-facing interface text must use the shared four-step type scale from `app/globals.css`. Do not introduce one-off `font-size` values in components or feature styles.

- `--font-ui-caption` / `.ui-type-caption` — 12px: hotkeys, kickers, short metadata, and compact status labels. This is the smallest permitted game UI text.
- `--font-ui-secondary` / `.ui-type-secondary` — 14px: descriptions, supporting copy, item details, and secondary labels.
- `--font-ui-body` / `.ui-type-body` — 17px: controls, values, primary labels, and normal readable interface text.
- `--font-ui-title` / `.ui-type-title` — 25px: panel and modal titles.

Choose the nearest semantic class or token instead of adding another size. Text rendered inside the Phaser canvas may use a separate pixel-font scale when required for world-space readability, but DOM overlays, menus, tooltips, inventory, character, and skill interfaces must use this scale.
