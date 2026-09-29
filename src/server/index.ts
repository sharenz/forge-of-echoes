// The authoritative game server (GAME_SPEC §11, contracts/net.ts). Entry: src/server/main.ts.
//
//   const server = await startServer({ port: 0, dbPath: ':memory:', logger: silentLogger });
//   server.port; await server.close();
//
// LAYOUT
//   server.ts      node:http + ws (noServer, upgrade on /ws) + static dist/ in production
//   http-api.ts    /api/register · login · logout · me · characters (POST, DELETE /:id) · health
//   db.ts          node:sqlite schema + migrations (PRAGMA user_version), WAL
//   characters.ts  CharacterStore: load via rules.parseSave (migrate + normalise), debounced saves (1 s)
//   game.ts        Game: sessions, instances, portals, parties, outcome handling, the 60 Hz scheduler
//   instance.ts    HideoutInstance / MapInstance: SimRun + members + input queues + snapshots + instanced loot
//   commands.ts    Command authority checks → rules
//   ground.ts      GroundService: dropItem (public drops), click pickups (with a short reach retry), expiry
//   trade.ts       TradeDesk: trade requests, offers, accept lock, the atomic swap, item locks
//   party.ts       PartyService (max 4, invites expire after 60 s, leader rules; persisted, restored on start)
//   event-filter.ts per-viewer event classes (AOI + priority cap per packet)
//   session.ts     PlayerSession: connection, input queue, rate limits, debounced 'character' pushes, link pacing
//   net-address.ts client addresses (X-Forwarded-For from trusted proxies only), private/loopback ranges
//   threadpool.ts  imported first by main.ts: UV_THREADPOOL_SIZE 8 (scrypt + ws compression share the pool)
//
// OPERATIONS
//   Logs one line per notable event (joins, maps opened/cleared/closed/restored, level-ups, items dropped /
//   picked up / expired / lost with their area, trades, errors) and a status line every 5 minutes while anyone
//   is online (players, instances, avg/worst tick ms, overruns).
//   RESTART SAFETY (GAME_SPEC §11). SQLite (migration 2) holds, written on every change:
//     parties + members (+ last active)   → restored on start, leader included; members show offline until
//                                           they return. For RESTORED_LEADER_WAIT_MS (2 min) after a start the
//                                           stored leader keeps the lead even while only others are back. A
//                                           party also survives all its members going offline; one nobody
//                                           returned to for PARTY_IDLE_TTL_MS (14 days of uptime — every start,
//                                           graceful or after a crash, begins that window afresh) is dissolved.
//     open_maps (setup incl. map + seed,  → every uncleared one is recreated on start as a FRESH run of the
//       portals left/total, cleared,         same setup (rules.restoreRunSetup) with the same portals left; its
//       participants, created)               portal shows in the owner's hideout. One that cannot be rebuilt is
//                                           refunded (stowItem: device, backpack, stash). Cleared ones are dropped.
//                                           A row is only written in one transaction with its owner's consumed
//                                           map item, and a refund only with the row's deletion: no crash can
//                                           leave a map both restorable and back in its owner's hands.
//     character_maps (who stands in which → a fresh session of such a character goes straight back INTO the
//       map, by persistent map id)          recreated map without spending a portal (toast RESTORED_MAP_TOAST),
//                                           or, when the map is gone, to the map owner's hideout.
//                                           At shutdown, visitors of a party member's hideout get a row
//                                           'hideout:<ownerId>' and come back to that hideout.
//   SIGTERM: drain — a system chat line + toast "Server update in N seconds — your party and open maps are
//   kept.", new logins are refused with 4004, the world keeps running for DRAIN_SECONDS (main.ts; 20 in
//   production), then every socket closes with 4004 and saves are flushed. Open uncleared maps are KEPT (no
//   refund, nobody moved; the runs so far end neutrally: kills/time/finds count, mapsFailed does not), and
//   parties stay exactly as they are. A socket that drops during the drain keeps its character in place
//   (no reconnect grace expiry), so it is put back where it stood. Open trades are cancelled; items players
//   dropped on the floor go back to whoever dropped them (backpack, stash, or a "Recovered" tab; marked new);
//   other ground loot is lost (logged). SIGINT or a second signal skips the drain.
//   Env (main.ts): PORT, DB_PATH, NODE_ENV, STATIC_DIR, TRUST_PROXY=<number of your proxies>, DRAIN_SECONDS,
//   RATE_LIMITS=strict|dev (dev — the default outside production — exempts loopback clients from the
//   per-address limits, since the Vite proxy makes every dev player 127.0.0.1). Active limits are logged
//   at startup. Connected sockets re-check their login every 60 s (expired/revoked → 4001).
//
// PROTOCOL NOTES FOR THE CLIENT (beyond the frozen contract text)
//   • Connect order: welcome → character → zone → (party, invites) → binary snapshots every 2 ticks, each
//     followed by an 'events' message when there are events for this viewer (tick = the snapshot's tick).
//   • 'character' is always redacted (rngState 0) and ZoneInfo.setup has seed 0 (src/game/online.ts).
//     Pushes: at most 5 Hz; XP-only changes (a stream during maps) at most once per second.
//   • ZoneInfo.portal: in a hideout the owner's open map portal (null when none or 0 portals left); in a
//     map zone it is that map's own PortalInfo, so the HUD can show "portals left". 'portal' messages go to
//     everyone in the owner's hideout (null when closed / 0 left) and to everyone inside the map (always the
//     map's info) whenever the count or the cleared flag changes.
//   • Every command gets exactly one { t: 'result', id } — also malformed 'cmd' frames when their id is
//     readable. Other invalid frames get a 'bad' toast. Limits per socket: ~180 messages/s (burst 360; excess
//     is dropped), 15 commands/s (burst 30; excess answered "You are doing that too quickly."), chat 1/s
//     (burst 5). More than 50 invalid or 900 dropped messages within 60 s close the socket (1008).
//   • ORDERING: a successful command that changed the character is answered only AFTER the 'character'
//     push carrying that change (the push may wait ≤ 200 ms for its 5 Hz slot; the result waits with it).
//     So on ok: the state is already there — a client may keep a dragged item "pending" until the result
//     and never shows it snapping back. Results of commands that changed nothing come at once, so results
//     can arrive out of id order.
//   • Close codes beyond the contract: 1008 (policy: abuse, too many sockets from one address, more than
//     MAX_PARTY_SIZE characters of one account in play) and 1011 (a character that cannot be loaded or keeps
//     crashing instances). Show the close reason; don't auto-reconnect on 1008.
//   • Inputs go through src/net createInputQueue (one per tick in seq order, last intent repeats while
//     starved, bursts > 6 skip to the newest 2 with taps/flask presses coalesced); snapshots ack its ackSeq.
//   • Link pacing per viewer: unsent data at two snapshot times in a row → every second snapshot (15 Hz)
//     until the socket drains to 0; more than 32 KB unsent → snapshots skipped (cosmetic events shed,
//     essential ones — own drops, wave tells, deaths — kept for the next packet). The next snapshot always
//     supersedes skipped ones, so a slow link shows choppy but current frames, never a stale stream.
//     'events' frames go out uncompressed below 8 KB (compression would hold the next snapshot back).
//   • Chat is party chat (fromName '' = system line: joins, leaves, deaths, level-ups, maps opened,
//     leadership changes). Solo players get "Join a party to chat." as the command error.
//   • Parties: 'partyLeave' sends the LEAVER home if they stand in someone else's instance; everyone else
//     stays where they are (friends in the leaver's map finish their run but can't re-enter) and only
//     visitors of hideouts they may no longer visit go home. 'partyKick' is a clean cut: the kicked player
//     leaves the others' instances and the others leave the kicked player's. Former members left behind in
//     a map don't block its owner from opening a new one (they are sent home when it replaces the old).
//   • Invites: re-inviting someone with a pending invite only renews it (no second 'invite' message).
//     An invite is withdrawn when its sender joins another party or stops leading; accepting it then fails
//     ("That invite has expired or was withdrawn."). After a decline, the same inviter waits 20 s.
//     'partyPromote' refuses offline members; a party never stays led by someone offline (except for the
//     first RESTORED_LEADER_WAIT_MS after a server start, while its stored leader may still reconnect).
//   • runSummary.result: 'cleared' (the map was cleared), 'failed' (left while dead), 'abandoned' (left alive,
//     or the instance crashed); the numbers cover the player's whole involvement in that map instance (all
//     entries). A run that ended while the player had no socket (crash, reconnect grace ran out) is
//     summarised right after 'zone' on their next login.
//   • A dropped socket keeps the character in its instance for 20 s (idle, can still be hit): reconnecting
//     with the same character resumes in place (new 'welcome'/'character'/'zone'; input seqs restart).
//   • XP is shared among LIVING players in the instance (src/sim guidance; the contract text says "every"):
//     the death screen should say that no XP is gained while dead (respawn + a portal gets you back in).
//   • Loot rolls use fresh server entropy per kill/chest instead of the sim's loot stream (GameOptions
//     privateLootRng, default on), so item uids seen by a client reveal nothing about later drops.
//   • Stash moves / quick-move to a stash tab / tab edits need any hideout; crafting and the crafting bench
//     (benchCraft / benchClear) need any hideout; the merchant works in any hideout; the map device (load,
//     unload, activate) needs the player's own hideout.
//   • Coming back from a map (respawn, leaveMap, the return portal, the map closing) a player appears just in front
//     of (52 units south of) the open portal of the hideout they land in — the map owner's — fanned out sideways
//     when others already stand there; with no portal open, at the usual courtyard spot.
//   • 4004 means "server updating": reconnect with backoff. During a drain new sockets are closed with 4004
//     at once. After the restart a character that was inside a map receives its 'zone' for that map
//     (kind 'map', a fresh run from wave 1) followed by a toast — no portal was spent.
//   • pickup: the result may come LATER than other results — a click the server finds out of reach
//     (PICKUP_REACH, measured on the server's position) is retried after every tick for 0.5 s
//     (PICKUP_RETRY_TICKS) and only then answered "Too far away."; a click on ANOTHER drop answers the older
//     one at once ("Too far away."), while another click on the SAME drop (double-click, asking again after
//     walking up) joins it with a fresh 0.5 s window and every joined click gets the same final result.
//     Walk to within PICKUP_APPROACH (src/sim) before sending. Other errors:
//     "That item belongs to someone else.", "Your inventory is full." (no extra toast), "That item is gone.",
//     "You are dead.". A public item (owner 0) picked up arrives flagged isNew; both characters involved in a
//     hand-over are saved at once.
//   • dropItem: backpack, equipment, belt ("belt:<i>"), stash (in a hideout) and map device (own hideout)
//     items; not while dead; at most MAX_GROUND_ITEMS (64) per area. The first drop of a session gets the
//     toast GROUND_HINT. Ground items vanish after 10 minutes or when their area closes (an empty hideout
//     with items on the ground stays open until they expire). 'dropSpawn' / 'pickup' events of public items
//     go to everyone in view (the pickup always to the picker).
//   • Trading: 'tradeRequest' pops up at the target (the requester gets a toast; a repeat only renews it;
//     asking back opens the trade). 'trade' carries the whole window after every change; acceptLockedUntil
//     is in the server's wall clock (welcome/pong serverTime). tradeAccept is refused until then ("The offer
//     just changed…"). When both have accepted the swap happens inside the second accept: success → 'trade'
//     null with result 'Trade completed' + a toast to each; refusal (no room, offer changed) → that command's
//     error, a 'bad' toast to the partner, and a 'trade' update with both accepts cleared (still open).
//     Closing: 'trade' null with result "You cancelled the trade." / "<name> cancelled the trade." /
//     "<name> disconnected. The trade was cancelled.". A resumed socket (new login taking over) receives the
//     open trade and pending requests again. Offered items are locked: commands aimed at them fail with
//     "That item is in a trade. …" (ITEM_IN_TRADE); merchant prices and pickups never touch them. The chat
//     line "/trade <name>" is a trade request.
export { startServer } from './server';
export { RESTORED_LEADER_WAIT_MS, RESTORED_MAP_TOAST } from './game';
export { GROUND_HINT, GROUND_ITEM_TTL_MS, MAX_GROUND_ITEMS, PICKUP_RETRY_TICKS } from './ground';
export { ITEM_IN_TRADE, TRADE_COMPLETED } from './trade';
export type { ServerHandle, ServerOptions } from './server';
export { Game, CLOSE_BAD_AUTH, CLOSE_POLICY, CLOSE_PROTOCOL, CLOSE_REPLACED, CLOSE_SERVER_ERROR, CLOSE_SHUTDOWN } from './game';
export type { GameOptions } from './game';
export { GameDatabase } from './db';
export { CharacterStore, MAX_CHARACTERS_PER_ACCOUNT } from './characters';
export { createConsoleLogger, silentLogger } from './log';
export type { Logger } from './log';
export type { Connection } from './connection';
export { newConnectionId } from './connection';
export { DEFAULT_HTTP_LIMITS } from './http-api';
export { clientIp, isLoopback, isPrivateAddress } from './net-address';
export type { HttpLimits } from './http-api';
