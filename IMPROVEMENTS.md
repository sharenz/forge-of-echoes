# Netcode and engine improvements

Review of the server–client connection and core simulation engine for performance,
stability and production readiness. Performed 22 Aug 2026 against the working tree at
`a351a74` plus uncommitted changes. Scope: `server/engine`, `server/rooms`, `multiplayer/`,
`app/multiplayer`, `app/game2d`, coordination/persistence hot paths, and the Colyseus 0.17
internals the rooms depend on. Benchmarks and test suites were re-run locally.

## Re-review after fixes (23 Aug 2026)

All 14 findings below were addressed in the working tree; the two P0s are closed and
covered by tests. Typecheck and lint are clean; 105 engine/server-engine/perf tests and
25 room integration tests pass (including the new reconnect → resync → exit → cleanup
test). Engine benchmark on this tree: 2,000 monsters + 1,000 projectiles 0.76 ms avg /
0.97 ms p95 / 1.81 ms max; 5,000 sleeping monsters 0.84 ms avg / 1.23 ms p95.

| # | Finding | Status | How |
|---|---|---|---|
| 1 | Reconnect rebinding | **Fixed** | `releasePartyClient` captures `allowReconnection`'s client, rebinds `activeClients`, identity checks use `sessionId`, `onReconnected` rebuilds the replicator and resends drop payloads; integration test added. |
| 2 | Auto-pickup spam | **Fixed** | Client picks the nearest drop at ≤6.7/s and suppresses rejected drops until the profile revision changes or range is re-entered; server caps 8 pickups/s per player and short-circuits `inventory_full` from an in-room profile cache before the DB. |
| 3 | Polling + reap-on-read | **Fixed** | HTTP polling removed; the hideout room pushes party/trade/public-party snapshots driven by a Postgres LISTEN/NOTIFY bus; reaping runs on a 5 s timer; snapshots are one lateral-join query; lease renewals have a dedicated 2-connection pool and a 45 s lease. See new finding A for the remaining fan-out cost. |
| 4 | Clock drift after dropped sim time | **Fixed** | `World.advance` skips stale steps so `tickNumber` stays wall-aligned and exports `droppedSimulationSteps`; both interpolators re-anchor after three consecutive render-ahead packets; `/healthz` exposes world/tick/rejection metrics. |
| 5 | 20 Hz React mirror | **Fixed** | Hideout presence mirror throttled to 500 ms with a shallow presence compare; adapter views cached per server tick. |
| 6 | Prediction lead / dash | **Improved** | Lead now includes the tick pipeline (RTT/2 + 50 ms, clamped); dash is predicted locally with sequence-gated correction suppression. Tick-stamped replay remains future work (see B-6). |
| 7 | Fatal on unhandled rejection | **Fixed** | Logged and counted; exit only on `uncaughtException`. |
| 8 | Deploy drain / single reconnect attempt | **Fixed** | `/admin/drain` (loopback-only) + `activate-release.sh` waits up to 600 s for `activeMapRooms === 0`; map creation and `/maps/open` refuse during drain; client retries reconnect with backoff for the full 12 s window. |
| 9 | Protocol version | **Fixed** | `protocolVersion` literal required in join options; `X-Crafty-Protocol-Version` header checked on every HTTP response and on reconnect failure. |
| 10 | XP checkpoints | **Fixed** | 30 s checkpoint through the write queue. |
| 11 | Flask DB latency | **Fixed** | Optimistic in-room flask belt; recovery starts next tick; persistence async with explicit rollback. |
| 12 | Full-profile rewrite per save | **Fixed** | `mutateProfile` locks, hydrates, transforms and persists only the delta on one connection; stash tabs rewritten only when changed. |
| 13 | Hot-path allocations | **Fixed** | Per-tick cached views, drop lookup by id, drop sync short-circuit. |
| 14 | Auth | **Fixed** | Password login/register (scrypt), DB-backed revocable sessions checked on HTTP, room auth and presence renewal; logout revokes. |

### New findings from the fixes (all P2 unless noted)

**A. (P1, scale) Public-party listing fan-out is N rooms × the same query.**
`server/rooms/HideoutRoom.ts:151-197`. On any `publicPartiesChanged` invalidation (party
create/join/leave, map open, reaping) every hideout room on the process recomputes
`listPublicPartyListings` (two queries) after its own 25 ms coalesce — a burst of
2 × (number of hideout rooms) queries against the 8-connection pool. With ~1,000 solo
hideouts that is ~2,000 queries per public-party event. Fix: compute the listing once per
process per invalidation (a shared, debounced cache in `PublicPartyService`), have rooms
read from it and only filter themselves out. The same shared cache should serve
`GET /parties`.

**B. Presence renewal re-coupled to the general pool.** `server/rooms/PartyRoom.ts:26-37`.
The 5 s presence loop now awaits `isAuthSessionActive` (players pool) before
`renewConnection` (lease pool), so a saturated players pool again delays presence leases.
Check the auth session less often (e.g., every 60 s, or on a revocation signal over the
social bus) and renew the lease unconditionally. Relatedly, batch renewals per room
(`connection_id = ANY(...)`) — the 2-connection lease pool handles ~200 renewals/s
comfortably but becomes tight past a few thousand concurrent players.

**C. Reconnected socket that lost the race is not kicked.** `server/rooms/PartyRoom.ts:68-69`.
If a page refresh replaced the character (`joinById` → `registerPartyClient`) while the
old socket's 12 s reconnection seat was still open, and the old tab then reconnects,
`releasePartyClient` returns `false` and leaves the reconnected socket attached: two live
sockets for one character. Call `reconnectedClient.leave(4000)` in that branch.

**D. Missing protocol header reads as "game updated".**
`app/multiplayer/MultiplayerClient.ts:79-82`. A proxy error page or network failure has
no `X-Crafty-Protocol-Version` header, so every outage becomes a misleading "reload the
page" prompt. Throw `ProtocolMismatchError` only when the header is present and different;
otherwise surface a connectivity error.

**E. Rejected dash stays predicted for up to 1 s.** `app/game2d/PhaserRuntime.ts`
(`predictedDashSequence`, `PREDICTED_DASH_TIMEOUT_SECONDS`). A `rate_limited`/`invalid`
dash leaves the client 105 px ahead until the timeout, then slides back. Clear the
prediction when `command/rejected` arrives for `player/attack`.

**F. Flask rollback can kill.** `server/rooms/MapRoom.ts:969-983`. Rolling back
`appliedAmount` after a persistence failure can take life to 0 if damage arrived in
between. Clamp to ≥1, or keep the heal and only resync the belt.

**G. Re-anchor can fire on a ≥300 ms network stall.**
`app/game2d/MonsterInterpolationBuffer.ts:51-64`, `NetworkEntityInterpolator.ts:33-43`.
Three consecutive late packets re-anchor to the late offset; normal packets then snap the
min-filter forward again — a visible double-jump. Consider a longer confirmation (5
packets / 500 ms) or blending the re-anchor over a few frames.

**H. Login hardening.** `server/http/createApiRouter.ts:105-116`,
`server/persistence/PostgresPlayerRepository.ts` (`createAuthSession`). No per-IP/handle
rate limit on `/accounts/session` (scrypt at N=16384 is a CPU amplifier for brute force);
the per-login `DELETE FROM auth_sessions WHERE expires_at < now() - 7 days` has no index
on `expires_at`. Add a limiter and move cleanup to the reap timer.

**I. Disconnected players are untargetable for 12 s.** `server/engine/World.ts` skips
`!connected` players in targeting and contact damage, so pulling the plug is a free
escape during the reconnect window. Design decision; either keep them targetable or
freeze their state explicitly.

**J. Invalidation payload edge cases.** `server/coordination/PostgresCoordination.ts:463-469`,
`server/http/createApiRouter.ts` (`/parties/leave`). `pg_notify` payloads cap at 8000
bytes — a large reap with many party ids fails and the invalidation is lost (logged); send
`publicPartiesChanged` without ids or chunk. `leave` of a dissolved party publishes
`partyIds: undefined`, which makes every hideout room refresh its party snapshot.

## Original review (22 Aug 2026)

## Verdict

The architecture is the right one and the simulation core is genuinely fast: a modern,
server-authoritative design with a fixed-step deterministic world over struct-of-arrays
typed memory, binary delta-compressed area-of-interest replication, tick-based client
interpolation and durable leases. The headless world runs 2,000 monsters and 1,000 live
projectiles in under 1 ms per tick, so the simulation is not the constraint.

It is not yet production-grade in three places:

1. the **reconnection path is broken** in a way that leaks whole map rooms (P0);
2. the **auto-pickup loop** can exceed the Colyseus message limit, which is a hard
   disconnect (P0);
3. the **meta layer** (HTTP polling plus reap-on-every-read) is the real scale ceiling, not
   the sim (P1) — plus a few client-feel gaps (clock resync, unpredicted dash, 20 Hz React
   mirroring).

Items 1 and 2 should land before any other investment.

## What is already right (keep it)

- **Authority boundary is clean.** The browser only sends intents; every message is
  validated with strict zod schemas; items, damage, drops and progression are server-only.
  Solo play is the same path as four-player co-op.
- **Simulation engine is well engineered** (`server/engine/World.ts`): fixed 50 ms step with
  bounded catch-up, seeded RNG with a separate content stream, slot stores with
  generation-tagged ids, spatial hash rebuilt per tick, allocation-free event ring,
  non-dropping outcome buffer, pack-shared targeting, sleeping monsters outside the
  activation radius.
- **Replication is thoughtful.** Custom binary codecs, ¼-px quantization, per-client delta
  compression, AOI culling, priority-ordered event selection with a hard per-client cap,
  kills routed through the non-dropping path. The reusable 16 KB event buffer is safe
  because Colyseus copies before sending (`@colyseus/core` `Protocol.mjs raw()`).
- **Client smoothing is tick-based, not arrival-based.** Both monster and remote-player
  interpolators derive motion from server ticks with a min-filter clock offset.
- **Durability model is sound.** Renewable leases for presence and room ownership,
  optimistic-concurrency profile saves with retry, per-character write queues, idempotent
  portal consumption, socket replacement on refresh.
- **Tests have teeth.** Perf budgets, bandwidth budgets, interpolation behaviour under
  jitter, and room integration tests against the real Colyseus stack.

## Findings, ranked

### 1. P0 — Reconnected sockets are never re-bound → room leak, ghost players, broken exit/resync

Where: `server/rooms/PartyRoom.ts:47-70`, `server/rooms/MapRoom.ts:300-305, 768-794, 260-285`;
verified against `node_modules/@colyseus/core/build/Room.mjs:697-763`.

Colyseus 0.17 handles a reconnection by pushing a **new `Client` object**, copying `auth`
onto it, pointing the old client's `ref` at the new socket, and binding the `message` and
`close` handlers to the **new** object. `onJoin` is not re-run. The rooms key identity on
the original object: `activeClients` still holds the old client, and `releasePartyClient`
discards the client that `allowReconnection` resolves with.

Consequences after any successful reconnect:

- `world/request-sync` and `map/prepare-exit` are rejected as `unauthorized`
  (`activeClients.get(id) !== client`). The client has just reset its monster buffer and
  drop payloads, so monsters and ground items stay missing; the portal exit times out after
  10 s.
- When the player finally leaves, `releasePartyClient` returns `false`: the character is
  never removed, `worldPlayer.connected` stays true (monsters keep hunting a ghost), XP is
  not persisted, and the presence lease keeps renewing.
- `activeClients.size` never reaches zero and `MapRoom` has `autoDispose = false`, so the
  room keeps simulating at 20 Hz until the 12-hour expedition expiry. Every
  "drop → reconnect → leave" leaks a map.

No test exercises reconnection.

Fix:

- `const next = await this.allowReconnection(client, seconds); this.activeClients.set(characterId, next)`.
- Treat a reconnect like `requestWorldSync` on the server: fresh `MonsterReplicator`,
  resend drop payloads.
- Prefer identity checks by `client.sessionId` over object identity.
- Add an integration test: join → kill socket → `reconnect()` → assert resync, exit, and
  leave cleanup.

### 2. P0 — Auto-pickup loop can exceed 120 msg/s → Colyseus force-closes the socket

Where: `app/game2d/PhaserRuntime.ts:2018-2030`, `server/rooms/PartyRoom.ts:20`,
`Room.mjs:971-977`, `server/rooms/MapRoom.ts:721-766`.

The client sends `player/pickup` for **every** drop within 38 px every 0.8 s and never backs
off on rejection (`inventory_full`, `conflict`). Standing on a 40-drop pile with a full
backpack is ~50 msg/s before movement (12.5/s), held attacks (up to 20/s) and the ping
probe. Exceeding `maxMessagesPerSecond` is a hard disconnect in Colyseus, which then enters
the broken reconnect path above. Each attempt also costs a `loadProfile` + `saveProfile`
transaction (~10 queries).

Fix:

- Client: pick the nearest one or two drops per tick; after a rejection, suppress retries
  for that drop until the profile revision changes or the player leaves and re-enters range.
- Server: per-player pickup rate cap and a cheap `inventory_full` short-circuit before
  touching the database.
- Keep total client traffic well under the limit, because the limit's response is
  disconnection, not dropping.

### 3. P1 — Party/trade polling plus reap-on-every-read is the real scale ceiling

Where: `app/multiplayer/useMultiplayerHideout.ts:170-222`,
`server/coordination/PostgresCoordination.ts:116-137, 417-459`,
`server/http/createApiRouter.ts:160-189`.

Every client polls `GET /parties/current` every 1.5 s, `GET /parties` every 2 s (whenever
not in a public party — most players) and `GET /trades` every 1 s: about 2.2 requests per
second per online player, forever, including during maps. `getForMember`, `get`, `isMember`
and `listPublic` each begin with `reapExpired()` — a transaction with two scanning `DELETE`s
over `party_connections`/`party_members` — then 2–4 queries per snapshot, per party for
listings. Order of magnitude: 1,000 concurrent players ≈ 15–20k queries/s on an
8-connection pool.

That pool is shared with `renewRoom` and `renewConnection`. Lease renewals queue behind
polling; a starved renewal expires a 30 s room lease (renewed every 10 s) and
`disconnect(1012)` kicks an entire map.

Fix:

- Reap on one timer every few seconds instead of inside reads.
- Collapse `getSnapshot` and `listPublic` into single queries (`json_agg`).
- Push party and trade changes through the hideout room state (it is already a room) or a
  light WS channel instead of HTTP polling.
- Give lease renewal its own small pool, and size leases to at least three renewal
  intervals.

### 4. P1 — Client clock sync cannot recover after the server drops simulation time

Where: `server/engine/World.ts:277-291`, `app/game2d/MonsterInterpolationBuffer.ts:46-57, 128-153`,
`app/game2d/NetworkEntityInterpolator.ts:27-39`.

`World.advance()` caps catch-up at four ticks (200 ms); any event-loop stall beyond that
discards simulation time, so `tick × 50 ms` falls behind wall-clock permanently. The
client's min-filter offset only nudges upward 0.02 ms per packet (≈0.2 ms/s at 10 Hz).
Recovering 100 ms of lost time takes roughly eight minutes, during which render time sits
ahead of the newest frame: every monster is pinned at the 100 ms extrapolation cap and steps
forward per packet instead of gliding.

Fix:

- Keep the tick clock wall-aligned (advance `tickNumber` by the dropped steps, or carry a
  server monotonic timestamp in the snapshot header), and/or
- On the client, re-anchor the offset when render time has been ahead of the latest frame
  for N consecutive packets (jitter-buffer resync).
- Export `World.events.dropped` and slow-tick counts as metrics rather than only asserting
  them in tests.

### 5. P1 — Hideout state is mirrored into React at patch rate

Where: `app/multiplayer/useMultiplayerHideout.ts:106-126`, `server/rooms/HideoutRoom.ts:103`
(uncommitted change).

The in-flight change that increments `serverTick` every hideout tick makes `onStateChange`
fire 20×/s, and the hook answers each with `setConnectedPlayers(newArray)`. `GameShell` and
every open panel (inventory grid, stash, skill tree) re-render 20 times a second whenever
the player is in the hideout — while Phaser already reads the room state directly through
the adapter. Only `MultiplayerPanel` consumes `connectedPlayers`.

Fix: derive `connectedPlayers` on demand, or throttle to ~2 Hz with a shallow compare on
characterId/name/connected. Keep per-tick data in refs only.

### 6. P1 — Local prediction is heuristic rather than reconciled; dash is not predicted

Where: `app/game2d/PhaserRuntime.ts:813-881, 442-457`, `server/engine/World.ts:383-390`.

The client integrates held input locally and exponentially corrects toward
`serverPos + input × (RTT/2 + 25 ms)`. That lead ignores the server tick (≤50 ms) and patch
(≤50 ms) latency, so there is a steady 10–19 px drag while moving at 190 px/s and a forward
nudge on stop. Dash is never applied locally: the 105 px teleport is below the 180 px snap
threshold, so a dash renders as a ~300 ms slide, and the rift-step afterimages interpolate
from start to an unchanged position. (Move-speed units are consistent between client and
server via `buildArenaBalance`.)

Fix:

- Now: include tick and patch delay in the lead estimate; predict the dash displacement
  locally (snap or special-case).
- Later, for PoE-grade feel: tick-stamped inputs replayed from the last acknowledged server
  state — the sequence numbers and `lastProcessedMovement` already exist.

### 7. P2 — Any unhandled rejection shuts down the whole process

Where: `server/index.ts:25-26`.

Room handlers are already wrapped by `onUncaughtException`, so the remaining exposure is
stray `void promise` calls — one of which tears down every map on the process. Prefer
log + metric for `unhandledRejection` and reserve exit for `uncaughtException`, or keep the
strict policy and invest in drain and recovery so the blast radius is survivable.

### 8. P2 — Deploys interrupt every map; the client reconnects once, without retry

Where: `deploy/docker-compose.prod.yml`, `app/multiplayer/useMultiplayerHideout.ts:422-452`,
`ARCHITECTURE.md` (recovery "from wave one" not implemented).

Colyseus' SIGTERM handling disconnects rooms immediately; `onDispose` persists XP but the
map is gone. Add a drain mode (lock room creation, let maps finish for up to N minutes)
before restarts. On the client, retry reconnection with backoff for the full 12 s seat
window instead of a single attempt.

### 9. P2 — No wire-protocol version handshake

Where: `multiplayer/wire/events.ts:45, 217`, `multiplayer/wire/snapshot.ts:3, 107`.

Codecs throw on a mismatched version byte; during a rolling deploy every snapshot throws
inside the SDK's message dispatch (frozen monsters, console spam). Send a protocol version
at join or in a hello message and prompt a reload on mismatch.

### 10. P2 — XP is only persisted on leave, dispose or completion

Where: `server/rooms/MapRoom.ts:929-960`.

Pickups are already durable; cheap periodic checkpoints (every 30–60 s or N kills) bound the
loss on a crash.

### 11. P2 — Flask use waits on a database round-trip before healing

Where: `server/rooms/MapRoom.ts:860-893`.

A latency-sensitive action is gated on `loadProfile` + `saveProfile`. Keep an authoritative
in-room flask cache and persist asynchronously, or apply recovery immediately and roll back
only if persistence fails.

### 12. P2 — Every profile save diffs the whole inventory and rewrites stash tabs

Where: `server/persistence/PostgresPlayerRepository.ts:372-486, 215-249`.

Fine today; O(inventory) per pickup or flask, with `loadProfile` and `saveProfile` on
separate connections (~10 queries across two checkouts). Will matter with large stashes.

### 13. P2 — Hot-path allocations in the 60 Hz fixed step

Where: `app/game2d/PhaserRuntime.ts:813-829, 1996-2016`,
`app/multiplayer/useMultiplayerHideout.ts:703-777`.

`getPlayers()` and `getMap()` rebuild arrays via `schemaValues(...).map/flatMap` two to
three times per fixed step, and `syncNetworkDrops` is O(drops²) with `Array.find`. Cache per
frame or drive drops from `MapSchema.onAdd/onRemove`. Small, easy GC wins.

### 14. P2 — Accounts authenticate by handle alone; tokens are unrevocable 12 h HMACs

Where: `server/http/createApiRouter.ts:105-116`, `server/auth/session-token.ts`.

Outside the performance scope, but blocking for "production grade": fine for development,
must become real authentication with revocation before launch.

## Measured this run

| Workload | avg | p95 | max | budget |
|---|---:|---:|---:|---:|
| 124 monsters (sanity floor) | 0.043 ms | 0.158 ms | 0.406 ms | 2 / 4 / 20 ms |
| 2,000 monsters + 1,000 live projectiles | 0.782 ms | 1.058 ms | 2.131 ms | 8 / 12 / 50 ms |
| 5,000 monsters, activation sleep + pack steering | 0.843 ms | 1.292 ms | 2.190 ms | 8 / 12 / 50 ms |
| Per-client snapshot bandwidth, 2,000-monster rush | — | 69.6 KiB/s | — | 80 KB/s |

Engine tests: 24 pass. Room integration tests (map room, hideout room, four-player
end-to-end, map service, party service): 12 pass. Stack: Colyseus 0.17.10,
@colyseus/schema 4.0.31, ws transport 0.17.13, default `maxPayload` 4 KB, ping 3 s × 2
retries, per-message deflate off.

## Suggested order

1. Fix reconnection binding and add the reconnect integration test (#1).
2. Bound auto-pickup on the client and server (#2).
3. Stop mirroring hideout state into React at patch rate (#5) — a small change with a
   large client win.
4. Move reaping to a timer, collapse snapshot queries, isolate the lease pool, replace
   polling (#3).
5. Wall-align the tick clock or add resync; export engine health metrics (#4).
6. Tighten prediction lead and predict dash; plan tick-stamped replay (#6).
7. Hardening: rejection policy, drain mode, protocol version, XP checkpoints, flask
   latency, auth (#7–14).
