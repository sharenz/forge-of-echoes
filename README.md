# Crafty — The Crucible

Crafty is a browser-native pixel-art action RPG built around deep item and map crafting. The vertical slice begins with character creation, moves into a persistent fixed-camera hideout, and opens crafted map items into large exploration zones with six monster-pack waves.

## Stack

- React 19 and TypeScript
- Phaser 4 with WebGL sprite batching and Canvas fallback
- React served locally through vinext/Vite
- Colyseus authoritative multiplayer server (Node.js + TypeScript)
- PostgreSQL persistence in a local Docker container
- PostgreSQL-backed account rosters and globally unique character names; browser storage remembers only the non-sensitive player name
- Sorceress is the only currently enabled player class; Amazon and Barbarian remain visible as future classes

## Local development

Requires Node.js 22.13 or newer and Docker Desktop. `npm run dev` starts the isolated PostgreSQL service, the game server on `127.0.0.1:2567`, and the web client together.

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env` only when you need to override the safe local defaults. Crafty's PostgreSQL binds to `127.0.0.1:5434` to avoid colliding with a conventional local PostgreSQL instance.

Quality gates:

```bash
npm run typecheck
npm run lint
npm test
npm run test:multiplayer:db
```

`npm run test:multiplayer` boots real WebSocket rooms and connects four concurrent clients through the complete party-to-map path. The database integration suite expects `npm run db:up` to have been run and verifies persistence, ownership constraints, item locking, trade discovery, and atomic swaps. Use `npm run db:down` to stop the local database.

## Architecture

- `app/game/` contains serializable domain models, item generation, crafting, maps, and combat balance.
- `app/game2d/` is a presentation and input adapter. It interpolates server snapshots, plays animation/VFX/audio, and sends player intent; it does not simulate combat, loot, progression, or waves.
- `app/components/` adapts React state to the renderer and supplies the HUD, inventory, stash, workbench, and map-device interfaces.
- `multiplayer/` contains shared, runtime-validated client/server protocol contracts.
- `server/rooms/` contains authoritative 20 Hz hideout and map simulations capped at four players.
- `server/db/migrations/` owns ordered, transactional PostgreSQL migrations; item ownership is enforced by composite foreign keys.
- `tests/multiplayer/` runs real four-client Colyseus room tests, including fifth-player rejection, forged command rejection, authoritative skills/flasks, free-for-all loot, item dropping, map completion, and rewards.

The browser is never authoritative. It sends small intent commands—move, use a skill, equip an existing item, offer an owned item—and the Node server validates identity, ownership, revision, range, cooldown, resource cost, and room membership. Solo play uses a private one-member server party and the same `HideoutRoom` / `MapRoom` path as co-op; there is no offline gameplay fork. Items use immutable UUIDs and relational owner/location constraints. Trades lock their offered items and complete only after both players accept the same revision; the final ownership and backpack-placement swap is one PostgreSQL transaction.

The hideout uses a fixed 960×960 logical canvas. Maps are 3840×3840—exactly 4×4 viewports—and use a non-rotating follow camera with a large dead zone so the screen remains still until scrolling is necessary. Enemies spawn as geographically distributed packs, idle in their territory, and engage when approached. Slain monsters create server-owned free-for-all ground drops; the first eligible player to touch one persists it through the authoritative profile service. Pressing `I` opens an in-map inventory where carried and newly collected equipment can be equipped immediately. Enemies, projectiles, and drops are GPU-batched while collision queries use a spatial hash. Phaser is dynamically loaded after the server-rendered shell.

## Current playable loop

1. Enter an account handle, select a saved Sorceress from its server roster, or create a uniquely named Sorceress. Amazon and Barbarian are disabled until their gameplay is ready.
2. Move through the fixed-camera hideout with screen-aligned WASD.
3. Use the stash, crafting bench, and map device as world stations.
4. Craft a map item, consume it to open a portal, and enter the arena.
5. Explore the map and defeat six increasingly dense, distributed pack waves; the combat bar exposes live cooldowns, Focus costs, and Rift Step's recharging charges.
6. Run over equipment and materials to collect them. Hover inventory items for complete affix tooltips, then drag them into matching equipment slots; the live character sheet updates health, damage, Focus, speed, armor, and evade immediately. There are no temporary run powers.

The broader systems and long-term progression targets are documented in [GAME_DESIGN.md](./GAME_DESIGN.md).

## Production deployment

Local development stays entirely local. Production runs the frontend, authoritative Node/Colyseus server, and PostgreSQL as an isolated Docker Compose stack on one VM. See [DEPLOYMENT.md](./DEPLOYMENT.md) for setup and deployment.

## Local multiplayer loop

1. Enter an account handle, select a PostgreSQL-backed character from the roster, then open **Party** and create a party.
2. Other players see it in the public Party Finder and can join until all four seats are occupied.
3. Creating or joining a party enters its shared hideout automatically. The leader can open a server-owned map item for every member to join.
4. Use **Trade** beside a party member, select backpack/stash items, lock the exact offer, and accept. Any edit clears both acceptances.
5. Fight, use flasks, race for shared free-for-all loot, change equipment, and drop/re-pick items in the shared map. Death and the completion portal return the player to the shared hideout.

Party membership is ephemeral and presence-leased: hideout/map transitions and quick refreshes retain membership, a newer authenticated socket replaces a stale one, and disconnected members are evicted after a 15-second grace period so abandoned seats and parties cannot remain in discovery.
