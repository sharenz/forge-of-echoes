# Crafty server architecture

## Authority boundary

The browser is an input and presentation adapter. It may request movement, attacks,
inventory commands, party commands, trades, and map entry, but it never creates an item,
decides damage, advances progression, or mutates a persisted profile.

The server has two deliberately different kinds of state:

1. **Durable realm state** lives in PostgreSQL. Accounts, characters, items, trades,
   parties, party membership, connection leases, expeditions, portal uses, room claims,
   and recovery checkpoints must survive a Node process restart.
2. **Live simulation state** lives in the Colyseus process that owns a room. Positions,
   monsters, projectiles, cooldown clocks, and the 20 Hz world are latency-sensitive and
   are not written to PostgreSQL every tick.

This is not an offline/online split. Solo play is a private one-member party and follows
the same server-authoritative path as four-player co-op.

## Ports and adapters

Rooms and HTTP routes depend on asynchronous domain ports, never on process-local maps or
PostgreSQL calls directly:

- `PlayerRepository` owns character/profile/item persistence.
- `TradeRepository` owns transactional trades and item locks.
- `PartyCoordinator` owns party lifecycle, membership, leadership, discovery, and presence
  leases.
- `ExpeditionCoordinator` owns map opening, the party's active expedition, six one-use
  portals, room ownership leases, supersession, and crash recovery metadata.

The production and local-development adapters for coordination are PostgreSQL-backed.
Fast in-memory adapters are permitted only as test doubles and must pass the same contract
tests as PostgreSQL.

All ports are asynchronous even when a test double could answer synchronously. That keeps
room and API code independent from whether a future implementation uses PostgreSQL, Redis,
or another network service.

## Transactional invariants

Coordination exposes semantic commands rather than load/mutate/save CRUD. PostgreSQL rows,
constraints, conditional updates, and transactions enforce these invariants:

- one character belongs to at most one party;
- a party has at most four members;
- only the leader can open a map;
- consuming the map item, incrementing the profile revision, creating the expedition,
  creating six portals, and making it active is one transaction;
- a portal index can be consumed once, by one eligible party member;
- a map ticket can claim one authoritative room;
- a stale process cannot overwrite a newer room owner or party revision.

In-process locks and timers may optimize work, but they are never the source of truth.

## Leases and restart behavior

Connections and room ownership use renewable leases with explicit expiry timestamps.
Leases are preferable to permanent `connected` flags because a killed process cannot run
cleanup code. A live room renews its leases; any coordinator instance can reap expired
leases and transfer leadership or remove an abandoned party safely.

The initial crash policy is intentionally conservative:

- every successful pickup is already committed and is never rolled back on death or crash;
- after a room-owner lease expires, party discovery stops advertising the stale room ID and
  another process may claim the same signed expedition ticket;
- the recovered room rebuilds its transient world from wave one while preserving the map,
  party, expiry, and already-consumed portals;
- a fenced stale room cannot renew or clear the newer room owner's expedition.

Exact wave, monster, ground-drop, and mid-projectile restoration is outside the first recovery
contract. The schema reserves expedition checkpoint data for that later increment. Before
completion rewards become durable rather than world drops, their grant must also receive an
idempotency key. Both additions extend the expedition port without moving authority back into
room memory.

## Scale-out path

The first production topology is one Node/Colyseus process plus PostgreSQL, but the authority
boundary is multi-process safe. Scaling happens in stages:

1. run multiple Colyseus workers on a larger VM;
2. add Colyseus distributed discovery/routing and a worker registry;
3. route a room consistently to its lease owner;
4. add Redis only when measured discovery, fan-out, or high-frequency presence traffic
   justifies it.

PostgreSQL remains the durable source of truth. Redis, when introduced, is an acceleration
and notification layer; losing Redis must not create items, duplicate portals, or forget an
active expedition.

## Testing standard

Every durable coordinator needs both behavior tests and PostgreSQL integration tests. The
minimum concurrency/recovery suite proves:

- two coordinator instances cannot admit a fifth member;
- concurrent joins cannot place one character in two parties;
- concurrent consumers cannot use one portal twice;
- two rooms cannot claim one ticket;
- state created by adapter instance A is readable by a fresh adapter instance B;
- expired presence and room leases are recoverable after simulated process death;
- a failed map-open transaction neither consumes the map nor creates an expedition.
