# Forge of Echoes v2 — Architecture

This is an online browser game built from scratch in TypeScript. There are **no game-engine libraries**:
- The **server** is Node 22 with `ws` for WebSockets, `node:http` and `node:sqlite`. It is authoritative and runs the rules and the simulation.
- The **client** is Vite, WebGL2, WebAudio and Preact, which is used only for the DOM UI.

## Module map

```
src/
  contracts/   FROZEN shared interfaces (orchestrator-owned). Everything talks through these.
  core/        rng (mulberry32, forkable, serializable), modifier resolver, small math helpers
  data/        content tables: bases, affixes, uniques, scars, currencies, skills, maps, loot, merchant
  game/        pure rules → `export const rules: GameRulesApi` (src/game/index.ts)
  sim/         deterministic 60 Hz world → `export function createRun(config): SimRun` (src/sim/index.ts)
  render/      WebGL2 renderer → `export function createRenderer(canvas): Renderer`
  art/         procedural pixel art → `export function generateArt(): ArtBundle`
  audio/       procedural WebAudio → `export function createAudio(): AudioEngine`
  ui/          Preact DOM UI → `export function mountUi(root, store): () => void`
  present/     WorldView + events → renderer/audio → `export function createPresenter(renderer, art, audio): Presenter`
  net/         shared protocol code: binary snapshot codec (server encodes) + ClientWorld (client decodes,
               interpolates, predicts) → `createSnapshotEncoder()`, `createClientWorld()`
  server/      Node game server: HTTP auth API, WebSocket sessions, SQLite persistence, hideout/map instances
               hosting SimRuns, parties, portals, command handling via rules  (entry: src/server/main.ts)
  client/      browser app: connection, UiStore implementation, input → InputMessage, loop, presenter wiring
  main.ts      client boot (imports src/client)
dev/           per-module sandbox pages (dev/render.html, dev/art.html, dev/ui.html, dev/audio.html, dev/sim.html)
tests/         vitest suites (tests/<module>/*.test.ts)
scripts/       shot.mjs (headless screenshots), e2e.mjs
```

## Dependency rules

- `contracts` imports nothing but other contracts.
- `core` → contracts only.
- `data` and `game` → contracts, core. No DOM.
- `sim` → contracts, core. No DOM, no items. It never imports `game`.
- `art` → contracts, core. DOM only lazily inside `icon()` and `portrait()`.
- `render` → contracts. It's DOM/WebGL.
- `audio` → contracts. It's WebAudio.
- `ui` → contracts (+ preact). It gets rules and art through the `UiStore`. It never imports sim, render or present.
- `present` → contracts, core. It never imports game or ui.
- `net` → contracts, core, and `sim` (only for the shared `movePlayer`). No DOM.
- `server` → contracts, core, game, sim, net. Node only; it never imports render, art, audio, ui, present or client.
- `client` → contracts, core, game (for display-only rules), net, render, art, audio, ui, present. It never imports server.

## Timing

- The server sim runs at a fixed **60 Hz** (`SIM_DT`) per instance, with at most 5 catch-up steps.
- The server sends snapshots at 30 Hz.
- The client renders remote entities about 100 ms behind the server, interpolating between snapshots, and predicts the local player at 60 Hz input ticks.
- All sim timers are in ticks or sim seconds, never wall-clock time.

## Determinism

`game` and `sim` must never call `Math.random()`, `Date.now()` or `performance.now()`. Randomness comes from these sources:
- The **sim** uses `createRng(config.seed)`, with separate `fork()` streams for combat and loot. The loot stream is passed to `hooks.rollKillLoot`.
- The **rules** use `CharacterSave.rngState`, advanced and stored back after each operation.
- **Presentation** (particles, shake, UI) may use `Math.random()`.

The sim exposes `digest()`. The same seed and intents must give the same digest.

## Data flow in a map (online)

**Client**
1. Keyboard and mouse input becomes an `InputMessage` (60 Hz ticks with a seq number).
2. `clientWorld.predict(input)` moves the local player at once, and the message goes to the server.

**Server**
1. Queued input → `sim.setIntent(playerId, intent)`.
2. `sim.step()` runs at 60 Hz.
3. The outcomes are drained:

   | Outcome | Server action |
   |---|---|
   | xp | `rules.grantXp` for every player; on a level-up, `sim.updatePlayer` |
   | pickup `(playerId, token)` | `rules.addToBackpack` for that player |
   | portal | Move the player to another instance |

4. Every 2 ticks, `encoder.encode(view, viewerId, ackSeq)` per client produces a binary frame. The AOI-filtered events for that client are sent as JSON.
5. A changed `CharacterSave` is pushed to its owner (debounced).

**Client, on each snapshot and frame**
1. `clientWorld.pushSnapshot()` stores it.
2. `alpha = clientWorld.update(now)`.
3. `presenter.frame({ world: clientWorld.view, localPlayerId, alpha, events })` draws and plays sound.
4. The HUD is sent to the UiStore at about 15 Hz.

**Loot (instanced)**
1. The sim calls `hooks.rollKillLoot(ctx, playerIds, lootRng)`.
2. For each player, the server calls `rules.rollKillLoot(setup, ctx, lootRng, thatCharacter)` → `Item[]`.
3. It stores each item under a token and returns `rules.dropSpec(item, token, playerId)[]`.

Belt flasks have no item uid. The rules address belt slot `i` as the synthetic uid `belt:<i>`; see `src/game/items` for `beltUid` and `parseBeltUid`.

## Conventions

- TypeScript `strict`. Don't use `any` in public signatures.
- Hot paths (sim, net, render, present, server tick) use no per-frame allocation where avoidable: SoA typed arrays, pooled particles, and reused buffers.
- UI typography follows the 12/14/17/25 scale (see `AGENTS.md`).
- **Contracts are frozen.** If you believe a contract must change, don't edit it: work around it locally and report it.
- Each module ships a `dev/<module>.html` sandbox so it can be screenshotted in isolation:

  ```
  node scripts/shot.mjs /dev/<module>.html --out .shots/<name>.png
  ```

  Then look at the PNG with the Read tool.
- Tests live under `tests/<module>/`. Run a single module with:

  ```
  npx vitest run tests/<module>
  ```
