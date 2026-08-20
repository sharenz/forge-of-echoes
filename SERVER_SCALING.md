# Server scale-out decision

Status: **remain single-process for the local-development milestone**.

The refactored headless world currently simulates the steady-state acceptance workload (2,000
monsters, 1,000 live projectiles continuously topped up, four players) at 0.69 ms average,
0.84 ms p95 and 1.04 ms max per 50 ms tick over 600 measured ticks after convergence warm-up
on the development machine. The 5,000 mostly-sleeping-monster workload remains below 1 ms
average (1.11 ms p95). Moving every map
across a worker boundary now would add command/event serialization, failure coordination,
and operational state without relieving the measured bottleneck.

## Scale-out trigger

Revisit process isolation when production telemetry shows any of these under representative
load:

- `World.tick()` p95 above 8 ms for five minutes;
- event-loop delay p95 above 20 ms;
- more than 25 fully active four-player map rooms per CPU core;
- room memory or GC pauses preventing the 20 Hz simulation deadline.

At that point, prefer Colyseus multi-process room placement over one `worker_thread` per
room. Configure `RedisPresence` and `RedisDriver`, then move `PartyService` and
`MapAdmissionService` coordination out of process memory before allowing traffic to more
than one process. Character/item authority remains in PostgreSQL.

## Transport evaluation

`@colyseus/uwebsockets-transport` is available through the pinned Colyseus dependency, but
is deliberately not selected yet. The current WebSocket transport meets the snapshot budget
(at most 80 KB/s per client in the 2,000-monster test) and preserves the existing Express
HTTP surface. Benchmark uWebSockets under the same room and HTTP workload when connection
count, rather than simulation cost, becomes material. Adopt it only if it reduces transport
CPU by at least 20% without changing authentication, error mapping, shutdown, or test
semantics.

This is a measured deferral, not an architectural dependency: the World, binary wire codecs,
injected services, and room adapter are already separated so a later transport/process change
does not alter gameplay code.
