# Server engine refactor

Working document for making the multiplayer core hold up under "a lot" of monsters and
projectiles, and for fixing the structural issues found in the 2026-08-19 server review.
Tick the boxes as you go; numbers in the tables are the baseline to beat.

> **Status:** Phases 0–6 are done (§4). §6 below is the **round-2 review of the refactored
> code** — what was verified, what is still open, and the new TODO list (Phase 7+).
> §1–§5 are kept as the original baseline and design.

---

## 0. TL;DR

* Architecture is the right shape (protocol → rooms → services → repositories, server
  authoritative, optimistic concurrency, real Postgres constraints, real multi-client tests).
  Keep it.
* The hot path is fine at today's scale (124 monsters: ~1 ms/tick, 34 KB/s per client).
* It falls over at scale for one root reason: **monsters and projectiles *are* Colyseus
  `Schema` objects and the simulation runs directly on the replicated state.** There is no
  place to cull, batch, quantize, or index anything.
* Two correctness/robustness issues need fixing regardless of scale:
  * an async room message handler that rejects **crashes the whole process** (confirmed);
  * `saveProfile` rewrites every item with one round-trip each (~300 queries / ~175 ms at
    mid-game) inside a lock, on every pickup/flask/drop.

---

## 1. Measured baseline (current code)

Setup: real server booted with `@colyseus/testing`, 4 connected clients, all monsters
aggro'd (`finalRageActive`), projectiles made piercing so they stay alive. `simulate()`,
`encoder.encode()` and `room.broadcast()` instrumented. Apple Silicon dev machine.

### 1.1 Room hot path

| monsters | projectiles | `simulate()` ms/tick | of which projectile hits | state patch per client | combat broadcasts/s | sim rate achieved |
|---:|---:|---:|---:|---:|---:|---:|
| 124 | 0 | 0.5 | – | 1.7 KB/patch → 34 KB/s (0.3 Mbit/s) | 7 | 20 Hz ✅ |
| 500 | 0 | 1.5 | – | 7.1 KB → 139 KB/s (1.1 Mbit/s) | 26 | 20 Hz ✅ |
| 1000 | 0 | 1.7 | – | 14.3 KB → 280 KB/s (**2.3 Mbit/s**) | 40 | 20 Hz ⚠️ bandwidth |
| 2000 | 0 | 3.4 | – | 29.6 KB → 591 KB/s (**4.8 Mbit/s**) | 58 | 20 Hz ⚠️ bandwidth |
| 1000 | 200 | **29** | 28 | 270 KB/s | 1,091 | 19 Hz ⚠️ |
| 1000 | 1000 | **157** | 155 | – | 4,032 (≈1 MB/s JSON) | **6 Hz** ❌ |
| 2000 | 500 | **139** | 136 | – | 4,792 (≈1.2 MB/s JSON) | **7 Hz** ❌ |

Other numbers: heap ≈ 2–3.4 KB per monster (Schema + ChangeTree + UUID string);
full state at 2000 monsters = 331 KB (sent on every join/reconnect); spawning 2000 = 44 ms;
idle room = 9 B/patch (delta encoding works).

Failure order:
1. projectile↔monster brute force (`O(P×M)` segment tests) — CPU wall;
2. one JSON broadcast per hit — message flood;
3. per-entity Schema replication, ~14 B/monster/tick, to every client regardless of distance — bandwidth wall;
4. `moveMonsters` is fine (3 ms at 2000) only because there is no separation/flocking yet; add it naively and it is `O(M²)`;
5. per-entity object churn (spawn/despawn hundreds per wave).

### 1.2 Persistence (local Docker Postgres, ~0.6 ms RTT)

| operation | queries | median |
|---|---:|---:|
| `loadProfile` starter (13 items) | 3 | 1.8 ms |
| `saveProfile` starter | 37 | 19 ms |
| `loadProfile` mid-game (139 items, 7 tabs) | 3 | 5 ms |
| `saveProfile` mid-game | **292** | **173 ms** |
| pickup = load + save, mid-game | 295 | **195 ms** |

`persistProfile` = `SELECT … FOR UPDATE` all items → 1 round-trip per item UPDATE/INSERT →
`DELETE item_locations` → 1 INSERT per item → tabs → character. `2N + T + 4` sequential
queries in one transaction. On a managed DB (1–2 ms RTT) expect 0.5–1 s per save.

### 1.3 Target budgets (acceptance criteria for the refactor)

| metric | target |
|---|---|
| `World.tick()` at 2000 monsters + 1000 live projectiles, 4 players | **≤ 8 ms** (20 Hz → <16% core) |
| state/snapshot bandwidth per client at 2000 monsters | **≤ 80 KB/s** |
| combat event messages | **≤ 1 per client per tick** |
| heap per monster | ≤ 200 B (typed-array slots) |
| `saveProfile` mid-game | ≤ 10 queries, **≤ 20 ms** locally |
| async handler error | logged + `rejected` to client, process stays up |
| regression guard | perf test in CI fails above budget |

---

## 2. Review findings (ranked)

### P0 — async handler rejection crashes the server (confirmed by repro)
`server/rooms/MapRoom.ts` registers `void this.parsePickup(...)`, `void this.dropItem(...)`,
`void this.useFlask(...)`, `void this.refreshPlayerProfile(...)`, and `void this.completeMap()`.
They catch only `profile_revision_conflict` and rethrow everything else. Neither room defines
`onUncaughtException`; Colyseus only wraps *sync* throws. Any other error → unhandled
rejection → Node exits → every room dies.

Reachable today without a DB outage: `persistProfile` throws `item_locked_for_trade` when
*any* owned item is locked in an open trade (client never auto-cancels trades). Offer an item,
enter a map, pick up loot → process exit code 1.

### P1 — full-profile rewrite on every save
See §1.2. Consequences beyond latency:
* called on every pickup / flask / drop / equip / completion (`completeMap` does it
  sequentially per player); a flask only takes effect after the commit;
* `PostgresPlayerRepository` pool is `max: 8` → ~40 saves/s saturates the server;
* `pickupInFlight` is keyed per **drop**, not per character → two quick pickups race on the
  same revision → second retries, third is rejected `conflict`; nothing serialises writes per
  character;
* "any locked item blocks the whole save" freezes the entire profile while a trade offer is
  open (can't equip, move, flask) — and is the path into P0.

### P1 — all coordination state is in-process memory
`PartyService`, `MapAdmissionService`, presence timers, `activeServices` singleton. Fine for one
process, but: parties vanish on restart/deploy, no horizontal scaling, and
`MapAdmissionService.claimedTicketIds` is never pruned (tickets expire after 10 min, set grows
forever).

### P2 — HTTP layer
`server/createGameServer.ts`: bearer/verify/401 block copy-pasted ~15×, three hand-rolled
`code → status` ladders, no Express error middleware (thrown errors become Express's default
HTML 500 with stack), services reached via global `getServerServices()` (service locator, not
injection), `new ProfileCommandService()` / `new MapService()` per request.
`GET /api/parties` (`listPublic`) is N+1 **with full item hydration** just to read `level`
(`characters.level` is already a column) and the client polls it every 2 s.

### P2 — synced-state hygiene
* `NetworkGroundDrop.itemJson` ships full item JSON for *every* player's personal drops to all
  four clients; drops never despawn → full state grows for the whole map.
* `NetworkMonster` syncs server-only numbers (`damage`, `armor`, `evadeChance`,
  `itemQuantity`, `itemRarity`, `experience`).
* `Encoder.BUFFER_SIZE = 512*1024` as an import side-effect in `createGameServer.ts`.
* Toolchain trap: schema classes use class fields + `defineTypes`; this only works because
  `tsconfig` `target: ES2017` keeps `useDefineForClassFields` off. Bump the target and every
  `MapSchema` child type silently becomes `undefined` (encoder throws on first join). Also
  `tsx` reads the tsconfig from **cwd**, so running the server from another directory breaks
  the same way.

### P2 — determinism
Simulation mixes accumulated `delta` with wall-clock `Date.now()` and global `Math.random`;
tests monkey-patch `Math.random`. No replay possible.

### P3 — minor
* `HideoutRoom` / `MapRoom` duplicate join/leave/reconnect/presence logic.
* errors signalled as `error.message === "profile_revision_conflict"` strings across layers
  (`TradeError` / `PartyError` / `MapOpenError` already show the better pattern).
* `completeMap` awaits per player sequentially; rewards appear late if the DB is slow.

---

## 3. Target engine design

### 3.1 Principle
Separate **simulation** from **transport**. A pure, headless `World` owns all entity data and
rules; `MapRoom` is an adapter that feeds inputs in and decides what to send to whom. Colyseus
keeps rooms, auth, reconnection, matchmaking and `Schema` for the *slow* plane; the
high-frequency plane (monsters, projectiles, combat events) bypasses per-entity `Schema`.

Proposed layout:

```
server/engine/                 pure TS, no colyseus imports
  World.ts                     stores + systems + tick(dt) + input queue + event buffer
  SpatialGrid.ts               uniform grid over the 3840² map
  stores/Monsters.ts           SoA typed arrays + free-list
  stores/Projectiles.ts        SoA typed arrays + free-list
  stores/Players.ts
  systems/input.ts ai.ts movement.ts projectiles.ts combat.ts loot.ts
  rng.ts                       seeded PRNG (map ticket already has `seed`)
  clock.ts                     injectable time source
  snapshot.ts                  AOI-culled, quantized binary entity snapshots
  events.ts                    per-tick event buffer + binary codec
multiplayer/wire/              shared binary codecs (client decodes the same bytes)
server/rooms/MapRoom.ts        adapter: auth/join, input → world, world → Schema (slow) + bytes (fast), persistence
app/game2d/                    client: interpolation buffer, projectile visual sim, event consumer
tests/perf/                    headless World benchmarks with budgets
```

### 3.2 Data layout (stores)
* Struct-of-arrays: `Float32Array x, y, vx, vy, life`, `Uint8Array archetype, rarity, flags`,
  `Uint16Array` slot ids with free-lists. Slot index **is** the entity id on the wire
  (+ a generation counter to detect stale ids).
* No `Map<string, …>` keyed by UUID for per-entity timers/cooldowns — plain arrays indexed by
  slot (`nextActionAt[slot]`).
* Projectiles pooled the same way; thousands created/destroyed per second with zero
  allocation.
* Players stay objects (4 of them) but their per-tick runtime lives in the World, not in the
  room.

### 3.3 Spatial hash grid
One uniform grid (cell ≈ 96–128 px over 3840²), rebuilt or incrementally updated each tick.
Answers every spatial query: projectile sweep (walk cells along the segment, or query the
segment AABB expanded by radius), monster targeting, melee contact, pickup range, AOI culling.
`O(P×k)` instead of `O(P×M)`.

### 3.4 Tick loop
Fixed timestep with accumulator (sim 20–30 Hz), **send rate decoupled** (entity snapshots at
10–15 Hz, events every tick). Injected clock + seeded PRNG → same inputs, same outcome;
replayable; unit-testable without monkey-patching. System order:
`input → ai → movement → projectiles → combat → loot → events`.

### 3.5 Replication planes
**Slow plane — keep Colyseus Schema:** wave/phase/timers, player stats (life/focus/pos at
20 Hz is fine for 4 players), drop *metadata* (id, pos, rarity; item payload only to the owner
via `@view` or a direct message), scores, completion.

**Fast plane — custom binary snapshots** (`client.sendBytes` / raw `broadcast`):
* monsters at 10–15 Hz, **AOI-culled per client** (viewport + margin; on a 4×4-viewport map
  that is typically ≤ ¼ of the population), **quantized** (`u16` pos ×4 subpixel = 2 B each,
  `u8` life %, `u8` flags/anim) ≈ 7 B/monster, only for monsters that moved;
* static data (archetype, rarity, maxLife, name) once, in a reliable `spawn` event keyed by
  `u16` slot id; `despawn` likewise;
* client keeps a ~100 ms interpolation buffer (hang it on the existing fixed-step Phaser
  runtime);
* **projectiles are never position-replicated**: replicate `spawn` (origin, dir, speed,
  range, seed) and `hit/expire` events; client simulates the visual deterministically.

### 3.6 Events
Per-tick event buffer in the World (`damage`, `kill`, `skill`, `monster-action`,
`projectile-spawn/hit/expire`, `drop`). Flushed **once per tick per client** as one binary
message, AOI-filtered. Aggregate damage per `(target, tick)` for floating numbers.

### 3.7 AI at scale
* Pack-level steering (pack has target/path; members keep offsets) → ~M/6 decisions.
* Activation radius / LOD: monsters far from every player sleep or tick at ¼ rate.
* Stagger "think" (retarget, ability choice) every ~200 ms across the population; "move" every
  tick. Separation (when added) via the grid.

### 3.8 Budgets & backpressure
Caps: live projectiles per player (e.g. 64), monsters per room, events per client per tick,
snapshot bytes per client per tick. Per-tick budget monitor: log/metric when a tick exceeds
20 ms. Never let one pathological build degrade the whole process.

### 3.9 Persistence
* `persistProfile` as a handful of set-based statements (`INSERT … SELECT unnest(...) ON
  CONFLICT DO UPDATE`, `DELETE … WHERE id = ANY($1)`, multi-row `item_locations` insert).
* Optional diff vs. the loaded snapshot (write only changed rows; `item_version` exists).
* Per-character async write queue (in the room or the repository) → pickups/flasks serialise,
  never self-conflict.
* Write-behind for XP/kills/highestWave (persist on completion/leave); item moves stay
  immediate.
* Lock only *offered* items against move/delete; do not fail the whole save.
* Typed errors (`ProfileRevisionConflict`, `ItemLockedError`, …) instead of message strings.

### 3.10 Process / transport (later)
`worker_thread` per heavy map room or Colyseus multi-process; `@colyseus/uwebsockets-transport`
(already installed) for lower per-message overhead. Presence/parties to Redis when >1 process.

---

## 4. TODO

### Phase 0 — stop the bleeding (do first, small)
- [x] Wrap every async room message handler (`parsePickup`, `dropItem`, `useFlask`,
      `refreshPlayerProfile`, `completeMap`) in `try/catch` → log + `rejected` reply.
- [x] Define `onUncaughtException` on `MapRoom` and `HideoutRoom`.
- [x] Process-level `unhandledRejection` / `uncaughtException` logger in `server/index.ts`
      (last line of defence; still exit on truly unknown state if you prefer, but log first).
- [x] Replace `error.message === "profile_revision_conflict"` with typed errors exported by
      the repository; same for `item_locked_for_trade`, `character_not_found`.
- [x] Add a regression test: pickup while `saveProfile` throws a non-revision error → client
      gets `rejected`, process alive.
- [x] Prune `MapAdmissionService.claimedTicketIds` by ticket expiry.

### Phase 1 — headless engine (CPU + message flood)
- [x] Create `server/engine/World.ts` with injectable `clock` and seeded `rng`; fixed-timestep
      accumulator; `tick(dt)`; input queue; event buffer.
- [x] `stores/Monsters.ts`, `stores/Projectiles.ts` as SoA typed arrays with free-lists and
      generation counters; `stores/Players.ts`.
- [x] `SpatialGrid.ts` (uniform grid; insert/move/query-AABB/query-segment).
- [x] Port systems from `MapRoom`: movement, monster AI (melee/ranged/jumper), projectiles
      (segment sweep via grid, pierce bookkeeping via per-projectile bitset or hit list),
      combat (armor/evade/ward), loot rolls → `events.drop`.
- [x] Per-tick event buffer + binary codec in `multiplayer/wire/`; aggregate damage per
      `(target, tick)`.
- [x] `MapRoom` becomes the adapter: `onMessage` → `world.enqueueInput`; after `world.tick()`
      copy *players / wave / drops* into Schema (slow plane), flush events as one binary
      message per client.
- [x] Remove per-hit `broadcast()` calls (`broadcastDamage`, `broadcastSkill`,
      `broadcastMonsterAction`) in favour of the event buffer.
- [x] Caps: projectiles per player, monsters per room, events per client per tick; tick
      budget monitor.
- [x] `tests/perf/world.bench.test.ts`: 2000 monsters + 1000 projectiles ≤ 8 ms/tick,
      fails CI above budget; 124-monster baseline as a sanity floor.
- [x] Deterministic replay test: same seed + same input log → identical event stream.

### Phase 2 — replication (bandwidth)
- [x] `snapshot.ts`: per-client AOI query via the grid; quantized `u16` positions, `u8`
      life %, `u8` flags; only moved entities; 10–15 Hz.
- [x] Reliable `spawn`/`despawn` events with static monster data keyed by slot id.
- [x] Remove `monsters` `MapSchema` from `MapRoomState` (keep `players`, wave fields, drop
      metadata). Stop syncing server-only monster stats.
- [x] Projectiles: replicate `spawn`/`hit`/`expire` only; client-side visual simulation.
- [x] Client (`app/game2d/`): snapshot decoder, ~100 ms interpolation buffer, event consumer,
      projectile visual sim, spawn/despawn handling.
- [x] Drops: sync id/pos/rarity/source only; item payload to owner only (`@view` or direct
      message); despawn picked-up/expired drops; TTL for unclaimed drops.
- [x] Bandwidth test: 2000 monsters, 4 clients → ≤ 80 KB/s per client.
- [x] Make `Encoder.BUFFER_SIZE` explicit configuration (or unnecessary once monsters leave
      Schema).

### Phase 3 — AI at scale
- [x] Pack-level steering; members keep offsets.
- [x] Activation radius / sleep tiers; staggered think vs. per-tick move.
- [x] Separation via the grid (only for active monsters).
- [x] Perf test: 5000 monsters (mostly asleep) + 4 players ≤ 8 ms/tick.

### Phase 4 — persistence
- [x] Rewrite `persistProfile` as set-based statements (≤ 10 queries).
- [x] Per-character write queue; replace per-drop `pickupInFlight` with per-character
      serialisation.
- [x] Write-behind for XP / kills / highestWave (flush on completion, leave, dispose).
- [x] Lock semantics: fail only moves/deletes of *offered* items, not the whole save.
- [x] `listPublic` party listing: read `level` from `characters` (extend `findCharacter` or
      add a roster lookup); no profile hydration.
- [x] Bench: mid-game `saveProfile` ≤ 20 ms locally; pickup burst of 20 does not exhaust the
      pool.

### Phase 5 — HTTP / services hygiene
- [x] `requireSession` / `requireAccount` middleware setting `req.session`.
- [x] Single error-mapping middleware (`TradeError` / `PartyError` / `MapOpenError` /
      `ProfileCommandError` → status); JSON 500 for unknown errors.
- [x] Build the router from an injected `ServerServices` (drop the `getServerServices()`
      singleton from route handlers; rooms can receive services via `onCreate` options or a
      room-scoped accessor).
- [x] Extract a `PartyRoom` base class for the shared join/leave/reconnect/presence logic.
- [x] Pin `useDefineForClassFields: false` in `tsconfig` (or move to `@type` decorators) and
      set `TSX_TSCONFIG_PATH` in the `dev:server` script so cwd can't break schema types.

### Phase 6 — process & transport (when needed)
- [x] Decide whether to use a `worker_thread` per map room or Colyseus multi-process with
      Redis-backed presence/parties. **Not activated:** current workloads are below 1 ms/tick;
      triggers and the preferred multi-process migration are recorded in `SERVER_SCALING.md`.
- [x] Evaluate `@colyseus/uwebsockets-transport` — retain the current transport until
      connection-load benchmarks show a material win; see `SERVER_SCALING.md`.

---

## 5. Notes for reproducing the measurements

* Boot the real server with `@colyseus/testing` (`boot(createGameServer())`), connect 4
  clients, set `state.finalRageActive = true` so every monster moves every tick.
* Instrument: wrap `room.simulate`, `room._serializer.encoder.encode` (patch bytes + time),
  `room.broadcast` (event count/bytes); `room._serializer.getFullState().byteLength` for the
  join payload.
* Scale: set `room.arenaBalance.waveStats[5].monsterCount = N`, `state.wave = 6`,
  `room.spawnWave()`; keep monsters alive by setting `maxLife = life = 1e12`; top up
  `room.playerProjectiles` to K each tick with long-range piercing shots.
* DB: wrap `pg.Client.prototype.query` to count round-trips; use a throwaway
  `bench-review-*` account and cascade-delete it afterwards.
* Run with `node --import tsx` from the project root (or `TSX_TSCONFIG_PATH=tsconfig.json`)
  and `"type": "module"` — otherwise `MapSchema` child types are undefined (see §2, toolchain
  trap).

---

## 6. Round-2 review (post-refactor, 2026-08-19)

Scope: `server/engine/**`, `server/rooms/**`, `server/http/**`, `server/persistence/**`,
`multiplayer/wire/**`, `tests/perf`, `tests/server-engine`, and the client-side consumers in
`app/multiplayer/useMultiplayerHideout.ts` / `app/game2d/MonsterInterpolationBuffer.ts`.
`npm run typecheck`, `npm run lint`, the engine/perf/multiplayer suites all pass (15 + 28).

### 6.1 Verdict

The refactor landed the architecture that §3 asked for, and it is good work: a genuinely
headless `World` (SoA typed arrays, free-lists with generation ids, uniform grid, fixed-step
accumulator, injected clock + seeded RNG, per-tick event buffer), a thin `MapRoom` adapter
with per-client AOI replicators and binary snapshots/events, `PartyRoom` extracted, typed
persistence errors, a per-character write queue, set-based `persistProfile`, a real HTTP
router with middleware and one error mapper, and a regression/perf test suite. The original
P0 (crash) and P1 (persistence) are fixed and verified.

What is left is mostly **second-order**: two real replication/authority bugs, GC-driven tick
spikes, an event stream that is still the bandwidth hot spot, and a perf test that measures a
transient rather than steady state. None of it needs another restructure.

### 6.2 Re-measured (same harness as §1, refactored code)

Headless `World.tick()`, steady state (1,200–2,400 ticks, not the 150-tick transient):

| scenario | ticks 0–100 | mid | last 100 | events/tick |
|---|---:|---:|---:|---:|
| 2000 monsters, **sustained 1000 piercing projectiles** (topped up every tick) | 1.0 ms | 2.1 ms | 2.1 ms | ~6,600 |
| 2000 monsters, sustained 300 realistic projectiles (range 700, pierce 3) | 0.8 ms | 1.2 ms | 1.2 ms | ~1,550 |
| 2000 monsters converging on 4 players (2,400 ticks, separation active) | 0.7 ms | 0.5 ms | 0.5 ms | – |
| 5000 monsters, activation radius on | 0.95 ms | 0.7 ms | 0.75 ms | – |

End-to-end (`@colyseus/testing`, 4 clients, bytes counted at `client.raw`):

| scenario | `simulate()` avg / max (incl. flush+encode+send) | wire per client |
|---|---:|---:|
| 124 monsters rushing, ~4 projectile spawns/tick | 1.2 ms / 8 ms | **15 KB/s** |
| 300 monsters converged, 4–12 spawns/tick | 2.6–3.0 ms / 12 ms | 37–45 KB/s |
| 2000 monsters **rushing** (all inside AOI) | 4.3–4.5 ms / 16 ms | **130–140 KB/s** |
| 2000 monsters converged, 4 spawns/tick | 3.1 ms / **21 ms** | 61 KB/s |
| 2000 monsters, harness spawning 300 projectiles/tick (unrealistic flood) | 6.7 ms / 17 ms | **655 KB/s** (= 1024-event cap × 33 B × 20 Hz) |

Observed during the runs: `slow world tick … 26–41 ms` warnings and `simulate()` maxima of
21–55 ms in the 2000-monster scenarios — GC pauses, not algorithmic cost (see 6.3 #3).

Persistence (mid-game profile, 140 items, 7 tabs): `saveProfile` **292 → 9 queries,
173 → 24 ms**; pickup (load+save) 195 → 37 ms. Target was ≤ 20 ms; close enough, and the
remainder is the ~70 KB jsonb payload + full `item_locations` rewrite (diffing would halve it).

Budget scorecard (§1.3):

| metric | target | now |
|---|---|---|
| `World.tick()` 2000 + 1000 proj. | ≤ 8 ms | **2.1 ms steady-state ✅** (avg); max spikes up to 40 ms ⚠️ |
| bandwidth/client at 2000 monsters | ≤ 80 KB/s | 45–61 KB/s converged ✅ · **130–140 KB/s rushing ❌** |
| combat events | ≤ 1 msg/client/tick | ✅ (one packet), but record size/volume still high ⚠️ |
| heap per monster | ≤ 200 B | ✅ (test-enforced) |
| `saveProfile` mid-game | ≤ 10 q, ≤ 20 ms | 9 q ✅ · 24 ms ≈ |
| async handler error | contained | ✅ (`runAsyncTask`, `onUncaughtException`, process hooks) |
| regression guard | perf test in CI | ✅ exists, but see 6.3 #6 (measures a transient) |

### 6.3 Findings (ranked)

#### 1. 🔴 Ghost monsters on slot reuse (replication bug, reproduced)
`server/engine/snapshot.ts` `MonsterReplicator.build`: when a slot is freed and re-allocated
(LIFO free-list → the slot of the *last monster killed* is the *first one reused* by the next
`spawnWave()` in the same `simulate()` call — i.e. exactly at every wave transition), the
replicator sees `knownGeneration[slot] !== generation`, pushes a **spawn** for the new id and
**never pushes a despawn for the old id**. The client's `MonsterInterpolationBuffer` keeps the
old id forever, rendered at its last snapshot (life > 0 if the kill fell between snapshots).
Repro: kill monster in tick T, spawn one in the same tick, build frame → `spawns=[new]`,
`despawns=[]`, client still holds the old id. The client also ignores the `MonsterDespawn`
world event (type 10), so there is no second path that would clean it up.
Fix: in `build`, if `knownGeneration[slot] !== 0 && !== generation` push a despawn for
`(knownGeneration[slot] << 16 | slot)` before the spawn; additionally handle `MonsterDespawn`
/ `Kill` on the client as belt-and-braces; add a regression test (tests/server-engine).

#### 2. 🔴 Authoritative state rides on a droppable event buffer
`MapRoom.applyWorldEvent` derives `monstersAlive`, kill credit, XP and loot **from the
per-tick event buffer**, which is capped (`maximumEventsPerTick = 8192`, `dropped++` on
overflow). `Kill` / `Drop` / `MonsterDespawn` are emitted *last* in the tick (after thousands
of `ProjectileHit`/`Damage` records), so under a flood they are the first to be lost:
`monstersAlive` never reaches 0 → the final wave cannot complete (earlier waves only survive
via the 30 s timeout), kills/XP/drops silently vanish. ~8k events/tick is reachable with
256 live piercing projectiles in a dense crowd. Authoritative consequences must not share a
lossy channel with cosmetics: give the World a separate, unbounded (or reserved-capacity)
outcome queue for kills/drops/XP, and/or derive `monstersAlive` from `world.monsters.count`.
Drop cosmetic event types first when over capacity.

#### 3. 🟠 GC spikes: per-tick object churn
`WorldEventBuffer` allocates one `{…}` object per event (6–7k/tick in heavy scenarios);
`flushWorldTick` does `events.filter(...).slice(...)` and a fresh `Uint8Array` per client per
tick; `moveMonsters` creates a closure per moving monster for `grid.queryAabb`; `thinkMonsters`
allocates a closure per think. Result: average tick is fine, but maxima of 21–55 ms and
`slow world tick` warnings at 26–41 ms — a whole tick budget gone in one pause. Move the event
buffer to a typed-array ring (SoA: `Uint8Array type`, `Uint32Array actor/target`,
`Float32Array amount/x/y`, …), encode straight from it with a per-client index list, reuse
output buffers, and hoist the grid visitor (pass `slot` via a field instead of closing over it).
Measure **p99/max**, not only average.

#### 4. 🟠 Event stream is now the bandwidth hot spot
* Fixed **33 B per event** (`tick`, two `u32` ids, three `f32`, `sequence` in every record).
  A packed record is ~12–14 B: `u8 type`, `u16` slot+`u16` gen (or `u32` id), `u16` qx/qy,
  `u16`/f16 amount, `u8 auxA/auxB`; `tick` once in the header; `sequence` only on
  `Skill`/`ProjectileSpawn` (own-player acks).
* Types the client does not consume are still encoded and sent: `Kill`, `Drop`,
  `MonsterSpawn`, `MonsterDespawn` (~4 extra records per kill per client), plus
  `ProjectileHit` **and** `Damage` per hit — pick one for impact VFX (the aggregated `Damage`
  already carries x/y).
* `MAX_EVENTS_PER_CLIENT_TICK = 1024` × 33 B × 20 Hz = **660 KB/s** — the cap is too high to
  be a bandwidth guard, and truncation is `slice(0, N)` in emission order (cosmetics first,
  lifecycle last). Lower it (≈256) and truncate by priority.
* Event relevance is a 1,300 px radius while the snapshot AOI is a 1,600×1,360 box — unify on
  the AOI box.
* `client.send(type, Uint8Array)` wraps the bytes in msgpack; `client.sendBytes` avoids it.
Net: realistic fire rates are fine today (15–45 KB/s), but the record format and cap are what
would fail first under anything abusive.

#### 5. 🟠 Snapshot bandwidth in the "horde inside the AOI" case
2000 monsters rushing the party = 130–140 KB/s per client (all within the 1,600×1,360 AOI box
at 10 Hz × 10 B). The repo's bandwidth test measures a *spread-out, static* population with a
smaller AOI (960×960+120, 15 Hz) and a single frame, so it does not see this. Options:
`u16` id (slot+gen packed) instead of `u32`; send `lifePercent`/`flags` only when changed
(per-record bitmask); delta-encode positions as `i8` from the last sent value when small;
LOD by distance (10 Hz near, 5 Hz far half of the AOI); shrink the 320 px margin. Add an
end-to-end room bandwidth test for the rush case (p95 ≤ 80 KB/s).

#### 6. 🟠 Perf test measures a transient, not steady state
`tests/perf/world.bench.test.ts` samples 120 ticks from spawn. Projectiles in the 2000+1000
case decay from 1000 to ~630 within 60 ticks (`ProjectileStore.maximumHitRecords = 16` expires
them; verified), monsters have not converged (separation load not exercised), and only the
average is asserted. Top projectiles up every tick, run ≥ 600 ticks after a convergence
warm-up, assert p95 and max alongside the average, and also check `world.events.dropped === 0`
and `rejectedProjectiles`.

#### 7. 🟡 Kill credit / damage attribution goes to the last hitter in the tick
`monsters.damageOwnerThisTick/Skill/Sequence/Type` are overwritten per hit; `damageThisTick`
is the sum. In co-op, the kill XP and the aggregated `Damage` number go
to whichever player's projectile was processed last that tick, regardless of who did the
damage or who crossed zero. Track the owner whose hit crossed zero (apply hits in order), or
aggregate per `(monster, owner)`.

#### 8. 🟡 Player-side damage cap regression
The old room capped melee contact hits **per victim** (`nextMonsterHitAt`, 900 ms; comment:
"an eight-monster pack applies eight independent hits on the same frame and deletes a solo
player"). `World.performMonsterActions` only has per-monster cooldowns, so 8 monsters in contact
hit on the same tick. Re-add a per-victim contact cap (or a per-tick damage clamp) if the old
behaviour was intentional.

#### 9. 🟡 Resources consumed for rejected projectiles
`MapRoom.attack` deducts focus and sets the cooldown, then enqueues a burst; `World` may
reject some/all projectiles (`maximumProjectilesPerPlayer = 64`, `projectileCapacity`) with
no feedback — the player pays for nothing. Check capacity before consuming, or surface the
rejection back to the room/client.

#### 10. 🟡 Two clocks in the room
`MapRoom` uses wall-clock `state.elapsedMilliseconds += delta` for cooldowns, dash recharge,
wave timers and `Date.now()` for drop TTL, while the World advances in fixed steps with a
`maximumCatchUpSteps = 4` clamp. Under a stall > 200 ms the World loses time and room timers
drift relative to world effects (cooldowns shorter than the world's ward/dash). Drive room
timers from `world.simulationSeconds`; keep wall-clock only for TTLs/telemetry.

#### 11. 🟡 Full-capacity loops
Eight `for (slot < capacity)` passes per tick over 8,192 monster + 4,096 × 2 projectile slots
even when 44 monsters exist (~0.2–0.3 ms floor; 124-monster floor is 0.3 ms vs 0.5 before,
could be ~0.05). Maintain a dense `activeSlots` list in `SlotStore` (swap-remove) and iterate
that.

#### 12. 🟢 Smaller items
* `wire/events.ts` imports `WorldEventType` from `server/engine/events` — the client bundle
  now depends on a server module; move the enum/codec types into `multiplayer/wire`.
* Lock order: `PostgresTradeRepository.complete` locks `item_instances` → then updates
  `characters`; `saveProfileNow` updates `characters` → then locks items. Opposite order ⇒
  possible deadlock (40P01) surfacing as `server_error`; align the order or retry on 40P01.
* `process.on("uncaughtException")` logs and continues (Node docs: unsafe). Prefer log →
  graceful shutdown → supervisor restart.
* `onAuth` consumes a portal on every socket join, including a stale-socket replacement
  (fast refresh) for a character already in the room. If that is not intended, exempt
  characters already present in `state.players`.
* `persistProfile` still rewrites every `item_locations` row and ships all item JSON each save;
  a diff against the loaded snapshot would get mid-game saves under 10 ms.
* `MapRoom.isEventRelevant` is called for every event × every client (`O(E×C)` with a sqrt-free
  distance check — fine, but the filtered array allocation per client is not; see #3).
* `SERVER_SCALING.md` quotes 0.6 ms for 2000+1000 — that is the transient number; steady state
  is ~2.1 ms (still comfortably inside budget). Update the doc when #6 is done.
* Client (`getMap()`): rebuilds an array of monster objects with `String(id)` for every
  visible monster on every render frame (2,000 objects + strings @60 fps), and
  `setMapStateVersion` re-renders React on every snapshot (10 Hz) and lifecycle/payload
  message. Hand the interpolation buffer (typed arrays, numeric ids) to the renderer directly.

### 6.4 TODO — Phase 7 (round-2 fixes)

#### Correctness first
- [x] Replicator: emit despawn for the previous generation when a slot is reused inside the
      AOI; client handles `MonsterDespawn`/`Kill` as a fallback; regression test (#1).
- [x] Separate authoritative outcomes (kill, XP, drop, despawn) from the cosmetic event
      buffer — dedicated non-droppable queue or reserved capacity; derive `monstersAlive` from
      `world.monsters.count`; test that a flooded tick still completes the wave (#2).
- [x] Kill/damage attribution per owner (crossing-zero hit or per-(monster, owner)
      aggregation) (#7).
- [x] Decide on the per-victim contact cap and re-add it if intended (#8).
- [x] Check projectile capacity before consuming focus/cooldown, or report rejections (#9).
- [x] Single simulation clock for room timers (#10).

#### Performance / bandwidth
- [x] Typed-array event ring buffer; encode from it; per-client index lists; reuse output
      buffers; hoist grid visitors (#3).
- [x] Packed ~12–14 B event records; header-level tick; sequence only where needed; drop
      unused types before encoding; one hit-VFX event type; lower `MAX_EVENTS_PER_CLIENT_TICK`
      and truncate by priority; unify event relevance with the AOI box; `sendBytes` (#4).
- [x] Snapshot record diet (`u16` id, change bitmask, `i8` deltas) and/or distance LOD;
      end-to-end rush-case bandwidth test p95 ≤ 80 KB/s (#5).
- [x] Dense `activeSlots` iteration in `SlotStore` (#11).
- [x] Perf test: steady-state, topped-up projectiles, convergence warm-up, p95/max,
      `dropped === 0` (#6). Refresh `SERVER_SCALING.md` numbers.

#### Hygiene
- [x] Move `WorldEventType` + codec types to `multiplayer/wire`; no client import of
      `server/engine`.
- [x] Align lock order between trade completion and profile save (or retry 40P01).
- [x] `uncaughtException` → graceful shutdown instead of continue.
- [x] Portal consumption: exempt stale-socket replacement for already-present characters
      (if intended).
- [x] Diff-based `persistProfile` (optional; ≤ 10 ms target).
- [x] Client: renderer consumes the interpolation buffer directly; no per-frame object/string
      rebuild; no React re-render per snapshot.

### 6.5 How round 2 was measured
* Headless: `new World({... maximumProjectilesPerPlayer: 1024, forceAllMonstersActive })`,
  4 players, N monsters spawned in a grid or a ring; projectiles topped up to K each tick via
  `spawnProjectile(spec, false)`; per-tick `performance.now()` samples; windows at start /
  middle / end; `world.events.view().length` and `world.events.dropped` per tick.
* End-to-end: `boot(createGameServer(services))`, `createRoom("map", {token, mapTicket,
  portalIndex})`, 4 `connectTo` clients; wrap each `room.clients[i].raw` to count bytes;
  wrap `room.simulate` for wall time; spawn monsters through `room.world.spawnMonster`, make
  them unkillable (`life 1e12`), `world.config.forceAllMonstersActive = true`; spawn K
  projectiles per tick through `room.world.spawnProjectile`.
* Ghost repro: spawn monster → tick → kill with a projectile in tick T → `spawnMonster` in the
  same tick → `MonsterReplicator.build()` → decode lifecycle: spawn for the new id, no despawn.
* DB: unchanged from §5 (throwaway `bench-review-*` account, cascade-deleted).

### 6.6 Phase 7 verification (implemented 2026-08-19)

All Phase 7 findings above are implemented. Current measured guards on the development
machine:

| guard | measured result |
|---|---:|
| 2,000 monsters + 1,000 continuously topped-up projectiles, 600 ticks | 0.70 ms avg · 0.86 ms p95 · 1.05 ms max |
| 5,000 monsters with activation sleep, 600 ticks | 0.77 ms avg · 1.14 ms p95 · 1.34 ms max |
| 2,000-monster rush snapshot stream | 69.57 KiB/s p95 |
| unchanged 139-item profile diff save | 6 queries · 5.33 ms |
| complete non-DB suite + production build | 99 tests passed (96 node + 3 rendered HTML) |
| PostgreSQL integration suite | 4 tests passed |

The room integration test runs four real clients and measures each server-side snapshot send
during the rush case. The perf test now asserts average, p95, maximum, zero dropped events,
and zero rejected projectile top-ups after convergence warm-up. Monster sample delivery also
bypasses React and the old per-frame object/string projection; Phaser consumes the interpolation
buffer through a numeric-id visitor.
