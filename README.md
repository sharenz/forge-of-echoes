# Crafty — The Crucible

Crafty is a browser-native, fixed-camera pixel-art action RPG built around deep item and map crafting. The vertical slice begins with character creation, moves into a persistent hideout, and opens crafted map items into six-wave combat arenas.

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

The world uses a fixed 960×960 logical canvas with screen-aligned movement and no camera translation or rotation. Enemies and projectiles are pooled GPU-batched sprites. Collision queries use a spatial hash so projectile checks do not scan the full enemy population. Phaser is dynamically loaded after the server-rendered shell.

## Current playable loop

1. Choose Amazon, Barbarian, or Sorceress and name the character.
2. Move through the fixed-camera hideout with screen-aligned WASD.
3. Use the stash, crafting bench, and map device as world stations.
4. Craft a map item, consume it to open a portal, and enter the arena.
5. Defeat six increasingly dense waves; character stats and map modifiers affect combat and rewards.
6. Return rewards to the inventory, improve equipment, and craft the next map.

The broader systems and long-term progression targets are documented in [GAME_DESIGN.md](./GAME_DESIGN.md).
