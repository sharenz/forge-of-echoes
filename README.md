# Crafty — The Crucible

Crafty is a browser-native, fixed-isometric action RPG prototype built around deep item and map crafting. The current vertical slice begins with character creation, moves into a persistent 3D hideout, and opens crafted map items into six-wave combat arenas.

## Stack

- React 19 and TypeScript
- Babylon.js with WebGPU and WebGL2 fallback
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

The game is split into three layers so that browser rendering does not own progression logic:

- `app/game/` contains serializable domain models, item generation, crafting, maps, combat balance, and profile migration.
- `app/game3d/` owns Babylon scene construction and the fixed-step runtime. It consumes normalized combat configuration rather than reading profile state directly.
- `app/components/` adapts React state to the runtime and renders accessible HUD, inventory, stash, workbench, and map-device interfaces.

`BabylonRuntime` maintains a 30 Hz simulation step independent from rendering. Enemy packs use Babylon thin instances, while WebGPU initialization falls back to WebGL2 if adapter creation fails. The Babylon bundle is loaded dynamically, keeping it out of the initial server-rendered application shell.

## Current playable loop

1. Choose Amazon, Barbarian, or Sorceress and name the character.
2. Move through the hideout with WASD or click-to-move.
3. Use the stash, crafting bench, and map device as physical world stations.
4. Craft a map item, consume it to open a portal, and enter the arena.
5. Defeat six increasingly dense waves; character stats and map modifiers affect the live simulation and its rewards.
6. Return rewards to the inventory, improve equipment, and craft the next map.

The broader systems and long-term progression targets are documented in [GAME_DESIGN.md](./GAME_DESIGN.md).
