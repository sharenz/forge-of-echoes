# Crafty — The Crucible

Crafty is a browser-native pixel-art action RPG built around deep item and map crafting. The vertical slice begins with character creation, moves into a persistent fixed-camera hideout, and opens crafted map items into large exploration zones with six monster-pack waves.

## Stack

- React 19 and TypeScript
- Phaser 3 with WebGL sprite batching and Canvas fallback
- vinext/Vite on Cloudflare Workers
- Browser-local profile persistence for the MVP

## Local development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Quality gates:

```bash
npm run typecheck
npm run lint
npm test
```

## Architecture

- `app/game/` contains serializable domain models, item generation, crafting, maps, combat balance, and profile migration.
- `app/game2d/` owns the Phaser runtime and fixed-step simulation. It consumes normalized combat configuration instead of reading profile state directly.
- `app/components/` adapts React state to the renderer and supplies the HUD, inventory, stash, workbench, and map-device interfaces.

The hideout uses a fixed 960×960 logical canvas. Maps are 3840×3840—exactly 4×4 viewports—and use a non-rotating follow camera with a large dead zone so the screen remains still until scrolling is necessary. Enemies spawn as geographically distributed packs, idle in their territory, and engage when approached. Slain monsters create pooled physical ground drops; only drops touched by the character enter the run ledger and persistent inventory. Pressing `I` opens a paused in-map inventory where carried and newly collected equipment can be equipped immediately. Enemies, projectiles, and drops are GPU-batched while collision queries use a spatial hash. Phaser is dynamically loaded after the server-rendered shell.

## Current playable loop

1. Choose Amazon, Barbarian, or Sorceress and name the character.
2. Move through the fixed-camera hideout with screen-aligned WASD.
3. Use the stash, crafting bench, and map device as world stations.
4. Craft a map item, consume it to open a portal, and enter the arena.
5. Explore the map and defeat six increasingly dense, distributed pack waves; the combat bar exposes live cooldowns, Focus costs, and Rift Step's three recharging charges.
6. Run over equipment and materials to collect them. Hover inventory items for complete affix tooltips, then drag them into matching equipment slots; the live character sheet updates health, damage, Focus, speed, armor, and evade immediately. There are no temporary run powers.

The broader systems and long-term progression targets are documented in [GAME_DESIGN.md](./GAME_DESIGN.md).
