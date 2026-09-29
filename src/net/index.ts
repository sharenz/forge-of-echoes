// Shared networking code (contracts/net.ts): the binary snapshot codec, the client-side world replica with
// interpolation + prediction, input helpers and strict JSON message validation. No DOM, no Node APIs.
//
// SERVER
//   const encoder = createSnapshotEncoder();              // one per server is fine (stateless apart from a buffer)
//   const r = parseClientMessage(rawFrame);                // strict: exact shapes/ranges; r.ok ? r.value : r.error
//                                                          // (reject isBinary frames from clients outright)
//                                                          // Shapes only: ownership, reach, trade state etc. are
//                                                          // the server's/rules' checks (tradeOffer uids arrive
//                                                          // de-duplicated and ≤ TRADE_MAX_ITEMS).
//   Inputs: one createInputQueue() per connection; on an input message queue.push(msg). Per sim tick, per player:
//     run.setIntent(id, queue.next(intent));               // same `intent` object every tick (it repeats when starved)
//     run.step();
//     every SNAPSHOT_EVERY ticks: ws.send(encoder.encode(run.view, id, queue.ackSeq))   // after the step
//   The queue applies one input per tick; a TCP burst (> 6 queued) skips to the newest 2 and coalesces the skipped
//   inputs into the first kept one (flask presses and skill taps survive — coalesceInputs); after 250 ms without
//   input the repeated intent stops moving. Prediction blends the resulting position differences out.
//   Snapshot contents per viewer: all players (the viewer's own record also carries focus/slots/flasks), monsters,
//   projectiles, motes, areas, the viewer's OWN drops and the PUBLIC drops (spec.owner 0: items players dropped on
//   the floor) inside the AOI (AOI_HALF_WIDTH/HEIGHT + AOI_MARGIN around the viewer's server position), and every
//   dynamic prop (chest/portal/returnPortal or state ≠ 0). Other players' instanced loot is never sent. Drops carry
//   spec.autoPickup (walk-over pickup) — click-to-pick-up drops are the ones with autoPickup false. Own drops come
//   first (≤ MAX_WIRE_DROPS), then ≤ MAX_WIRE_PUBLIC_DROPS (64) public ones; over a cap the nearest are kept. Each
//   drop record repeats its label + icon id (~70 B), so the server should still cap live public drops per instance.
//   SNAPSHOT_VERSION: bump on any layout OR meaning change. A stale bundle then fails to decode and reloads itself
//   (client/connection.ts, MAX_SNAPSHOT_FAILURES); that is how open tabs pick up a deploy.
//   13 B per ordinary monster (+2 with ailments/elite mods, +8 for rares/bosses), 14 B per projectile, 7 B per
//   mote; 200 monsters + a full HUD record ≈ 2.9 KB. A real 2-player map run averages ~2.1 KB per snapshot.
//
// CLIENT
//   ws.binaryType = 'arraybuffer';                         // browsers default to Blob
//   const world = createClientWorld(); const events = createEventTimeline();
//   on 'zone'      → world.setZone(msg.zone); events.clear(); events.setLocalPlayer(msg.zone.localPlayerId)
//   on 'character' → world.setPredictionHints({ moveSpeed, castTimes })   // optional, from rules.playerRuntime
//   on binary      → world.pushSnapshot(buf, performance.now())           // stamp in onmessage, not per frame
//   on 'events'    → events.push(msg.tick, msg.events)
//   on 'pong'      → world.setRtt(now − msg.time)
//   60 Hz input    → const input = {..., seq: ++seq}; ws.send(JSON.stringify(input)); world.predict(input)
//   every frame    → run the input ticks first, then
//                    const alpha = world.update(performance.now());
//                    presenter.frame({ world: world.view, localPlayerId: world.localPlayerId, alpha,
//                                      events: events.drain(world.renderTick), … })
//
// VIEW SEMANTICS (see client-world.ts for the full rationale)
//   • Remote entities (monsters, projectiles, motes, other players, appearing drops) are on the render timeline
//     ~50–150 ms behind the newest snapshot (adaptive jitter buffer sized from the 95th-percentile delivery jitter;
//     single stalls/hitches are bridged by ≤ 100 ms extrapolation and a paused render clock instead): prev* = older
//     bracketing snapshot, x/y = newer one, use the returned alpha. animTime/age/hitFlash/castProgress fields are
//     already evaluated at the render time.
//   • Areas (telegraphs), dynamic props, drop removal, the run state and the local player's HUD data come from the
//     newest snapshot; area ages, cooldowns and her cast bar keep ticking between snapshots. Events tied to these
//     (areaResolve, chestOpen, pickups, …) are released at once by the EventTimeline.
//   • The local player is predicted with the shared sim `movePlayer`, including the cast slow (CastModel replays
//     the sim's casting rules per input); her position is written into BOTH prevX and x, so it is independent of
//     alpha. Locomotion anim/facing/aim follow local input at once; cast/dash/hit/death anims come from the server.
//     Her own bolts leave her predicted hand position and blend onto their true path within 0.25 s.
//   • Monster/projectile/mote view indices are the server's store slots; ids are (generation & 0xff) << 16 | slot.
//     Normal/magic monsters carry life as a fraction (maxLife = 1); rare, lieutenant and boss carry the real maxLife.
//   • Drops: the local player's own loot plus public drops (owner 0) — the presenter shows both, marking public ones
//     as "ground" items. `blocked` is only set on her own drops.
//   • Objects and arrays of the view are stable for the lifetime of the ClientWorld (setZone clears in place).
//   • Beyond the contract, createClientWorld() returns a NetClientWorld: renderTick (feed events.drain),
//     interpDelayMs, liveTick(now), predictedPosition(), setPredictionHints() and stats() (bytes, jitter, drift,
//     corrections — for a net HUD).
//
// SANDBOX: node scripts/shot.mjs /src/net/dev/netlab.html — a real sim instance as server behind a simulated TCP
// link (latency/jitter/stalls), server truth next to the client view, and prediction/interpolation traces.
export { createSnapshotEncoder } from './encoder';
export type { NetSnapshotEncoder } from './encoder';
export { createClientWorld, CLIENT_MONSTER_CAPACITY, CLIENT_MOTE_CAPACITY, CLIENT_PROJECTILE_CAPACITY, MAX_EXTRAPOLATION_TICKS } from './client-world';
export type { ClientWorldStats, NetClientWorld } from './client-world';
export { createEventTimeline, isImmediateEvent } from './events';
export type { EventTimeline } from './events';
export {
  INPUT_BACKLOG_KEEP, INPUT_BACKLOG_MAX, INPUT_STARVE_TICKS, coalesceInputs, createInputQueue,
} from './input-queue';
export type { InputQueue } from './input-queue';
export {
  HELD_MASK_ALL, heldToMask, inputFromIntent, intentFromInput, isSlotHeld, maskToHeld, moveVector, setSlotHeld,
} from './input';
export {
  MAX_CHAT_LENGTH, MAX_CLIENT_MESSAGE_LENGTH, MAX_SERVER_MESSAGE_LENGTH, MAX_STASH_TAB_NAME_LENGTH, encodeMessage,
  parseClientMessage, parseServerMessage, validateClientMessage, validateServerMessage,
} from './messages';
export type { MoveVector } from './input';
export type { ParseResult } from './messages';
export { Snapshot, decodeSnapshot } from './snapshot';
export { SnapshotDecodeError } from './bytes';
export { MAX_DRIFT, MAX_INTERP_DELAY_MS, MIN_INTERP_DELAY_MS, TICK_MS } from './clock';
export { CORRECTION_RATE, DEFAULT_MOVE_SPEED, SNAP_DISTANCE } from './prediction';
export type { PredictionHints } from './prediction';
export { AOI_MARGIN, MAX_WIRE_DROPS, MAX_WIRE_PUBLIC_DROPS, SNAPSHOT_VERSION } from './protocol';
