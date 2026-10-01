# Forge of Echoes contributor guidance

Read `CONCEPTS.md` first: it is the design brief for this from-scratch rewrite. The
previous implementation lives on the `archive/v1-phaser` branch for reference only.

## Engine

No game-engine libraries (no Phaser, Pixi, Colyseus, etc.). Game loop, renderer,
input, and audio are implemented in this codebase.

## UI typography

All game-facing interface text must use one shared four-step type scale, defined once as CSS tokens. Do not introduce one-off `font-size` values in components or feature styles.

- `--font-ui-caption` / `.ui-type-caption` — 14px: hotkeys, kickers, short metadata, and compact status labels. This is the smallest permitted game UI text.
- `--font-ui-secondary` / `.ui-type-secondary` — 16px: descriptions, supporting copy, item details, and secondary labels.
- `--font-ui-body` / `.ui-type-body` — 19px: controls, values, primary labels, and normal readable interface text.
- `--font-ui-title` / `.ui-type-title` — 28px: panel and modal titles.

Choose the nearest semantic class or token instead of adding another size. Text rendered inside the game canvas may use a separate pixel-font scale when required for world-space readability, but DOM overlays, menus, tooltips, inventory, character, and skill interfaces must use this scale.

## UI interaction: inventory first, drag and drop

This is a game-wide rule from the owner. Any panel that uses items (Atlas and map device, scarabs, crafting and stash work slots, selling, and so on) opens **together with the player's inventory**, and items go into the panel's slots by **dragging them out of the inventory**. Items in the stash are moved into the inventory first, then dragged into slots. Do not add stash drawers, pickers or shortcut lists that replace the inventory as the way to load an item. A quick modifier-click may exist only as an extra. Layouts must work at 1280x720 and 1024x600, so a panel and the inventory have to fit side by side.
