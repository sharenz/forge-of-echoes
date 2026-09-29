// Deterministic 60 Hz multiplayer simulation (see src/contracts/sim.ts). Runs on the server.
//
//   const run = createRun(config);    // an instance: a hideout or a map, 0..4 players
//   run.addPlayer({ id, name, level, runtime });   // throws on a taken id, id ∉ 1..255, or a 5th player
//   run.setIntent(id, intent);        // held state; kept until replaced (flask presses apply once)
//   run.step();                       // exactly one SIM_DT tick for everyone, players in join order
//   run.view                          // read-only WorldView, updated in place (stable object references)
//   run.drainEvents()                 // cosmetic, capped per tick (plain hits / projectile ends drop first)
//   run.drainOutcomes()               // authoritative, never dropped
//   run.removePlayer(id)              // left / disconnected / respawned home
//   run.spawnDrop(spec, x, y)         // an item a player put on the floor (public: spec.owner 0) → drop id
//   run.requestPickup(playerId, id)   // a click on a drop → 'ok' | 'tooFar' | 'notYours' | 'full' | 'missing'
//   run.removeDrop(id)                // a drop expired (no event)
//
// Client prediction: `movePlayer` (contract MovePlayer) is the exact movement step the sim uses for
// players. `params.slow` is a FRACTION OF SPEED REMOVED: the sim passes
// `playerSlow(castSlow, debuffSlowOf(view.debuffs), areaSlowAt(view.areas, x, y))` — CAST_SLOW (0.3)
// while a timed active is cast, 1 while frozen or rooted (held), PLAYER_CHILL_SLOW (0.3) while chilled,
// TAR_SLOW (0.5) with the feet in a tarPool, combined as 1 − Π(1 − s). `predictionSlow(playerView)`
// gives the first two from a snapshot; `params.speed` is the player's PlayerCombatStats.moveSpeed. A
// chilled cast progresses at `castRateOf(view.debuffs)` (0.7) per tick; frozen, casts hold. What
// prediction can't know — the crowd slow of a horde in front, shoves from heavy bodies and knockback,
// a chain hook's drag, easing apart from allies, blinks, a debuff starting between snapshots — arrives
// as a server correction. (`import … from 'src/sim/movement'` avoids pulling in the rest.)
//
// Monster rosters (GAME_SPEC §14): RunConfig.theme picks the wave family, lieutenant and boss
// (contracts/bestiary.ts THEME_ROSTER). Every kind is a MonsterDef in src/sim/rosters — see the guide
// at the top of src/sim/rosters/index.ts for the extension API.
//
// Player debuffs (GAME_SPEC §13, src/sim/debuffs.ts): PlayerView.debuffs lists the active ones
// (PLAYER_DEBUFFS order; remaining/duration in seconds, stacks, the root's source). 'debuff' fires when
// one starts or its stacks change (refreshes at most once a second), 'cleanse' when a flask (life:
// burning + bleeding, focus: withered), Rift Step (rooted), the map's clear or death removes some.
// Burning and bleeding damage arrive as 'hit' events (target 'player') every 0.5 s. 'pull' = a chain
// hook dragging a player (from → to over PULL_TIME = 0.25 s, at most PULL_MAX_DISTANCE = 140 units);
// 'blocked' = a Shieldbearer's shield stopped a player projectile at (x, y) (the event names no
// monster: the bearer is the nearest shieldbearer; its `facing` shows the shield side).
// Server: a player re-joining an instance can resume their debuffs like their life and focus —
// SimPlayerJoin.debuffs = a copy of their last PlayerView.debuffs taken when they left
// (`view.debuffs.map((d) => ({ ...d }))`; the entries carry an extra `dps`, see SimDebuffView).
//
// Projectiles: a chainHook is drawn as a chain from its launch point, (x − vx·age, y − vy·age) in
// ProjectileStoreView, to (x, y) — the store has no thrower; a tarGlob is a lob (life > 0).
//
// Areas (src/sim/area-geometry.ts, importable on its own): the id packs a heading and a variant
// (`areaAngle(a)`, `areaVariant(a)`). chargeLine = a lane from (x, y) along areaAngle, length radius,
// half-width CHARGE_LINE_HALF_WIDTH[variant] (0 = a harmless aim laser); choirWave = an expanding band
// (radius = its current radius) with variant + 1 gaps (`choirGapAngles`); icePrison = a ring closing
// to ICE_PRISON_END_FRACTION of its start (radius is current; close = age / duration); wispBurst freezes
// within WISP_FREEZE_FRACTION of its radius; blizzard drifts (x/y move; its areaAngle is the heading
// it was spawned with — it bounces off the arena edge, so draw motion from the x/y deltas); whirlwind
// variant 0 = the harmless windup, 1 = the spinning blades. Everything else is a disc.
//
// Multiplayer semantics:
//  - Monsters chase the nearest *living* player (kept until another is 1.25× closer); hunters,
//    spitters and lieutenants aim at their own player; the Matriarch charges a player in charging
//    range and rains meteors on every living player near her.
//  - Everyone inside is dead: the wave director freezes (no timers, no spawns), hunters stand, idle
//    packs mill, and RunView.phase reads 'failed'. That word is the contract's; it means "party down,
//    the map is frozen", NOT "map lost" (GAME_SPEC §11: a map never fails while portals remain). The
//    UI should say e.g. "Party down — N portals left". The map resumes when a living player joins.
//  - Nobody inside at all: the instance holds perfectly still (only tick/time advance), so stepping
//    an empty hideout or a map waiting for re-entry costs next to nothing.
//  - Party scaling from the LIVING count n (a deliberate reading of "current player count": corpses
//    don't fight): life ×(1 + 0.5·(n−1)) at spawn, wave budget ×(1 + 0.25·(n−1)) fixed at wave start
//    (a change after the tell goes into the stream), magic and rare pack chance ×(1 + 0.1·(n−1)).
//    Server: grant { t: 'xp' } only to players whose PlayerView.dead is false, or a party member
//    lying dead beside a carry would level for free while costing the party no pressure.
//  - Loot is instanced: on a kill (never for summons) rollKillLoot(ctx, livingIds, lootRng) is called
//    once; every DropSpec carries its owner and only that (living) player can pick it up. Dead
//    players get no rolls — they can't pick anything up and leave by respawning. removePlayer
//    deletes the leaver's own drops and fire trail (public drops stay) — so a server should NOT
//    call it the moment a socket drops: keep the player in the instance (idle intent) for a grace
//    window and re-bind them on reconnect.
//  - Pickup: only spec.autoPickup drops (currency, flasks, maps) of a living owner are magnetised
//    inside their pickup radius and collected by walking over them (tryPickup(owner, token) on the
//    first touch after DROP_PICKUP_DELAY). Everything else — equipment, and every public drop even
//    for the player who dropped it — lies still until clicked: requestPickup(playerId, dropId)
//    answers, in this order, 'missing' (no such drop, or the player isn't in the instance),
//    'notYours' (someone else's instanced loot), 'tooFar' (dead, or feet > PICKUP_REACH = 72 from
//    the drop), 'full' (tryPickup(playerId, token) refused: the drop stays, DropView.blocked =
//    true), else 'ok' (drop removed, 'pickup' event + outcome for playerId). It works on auto-pickup
//    drops too (a click retries a blocked one) and on drops still in the air.
//  - Click pickups under input lag: reach is measured on the SERVER's position, which trails the
//    client's prediction by the inputs still queued there (2–15 units at 110–150 units/s). So:
//      client: walk the predicted feet to within PICKUP_APPROACH (= PICKUP_REACH − 16, exported
//        here and from './movement') before sending `pickup`, not to PICKUP_REACH itself;
//      server: requestPickup changes nothing unless it answers 'ok' or 'full', so on 'tooFar' it may
//        keep that one click pending and simply ask again after each tick for ~0.5 s (drop it on
//        a newer click or command) before reporting "too far".
//  - hooks.tryPickup must be all-or-nothing and COMMIT LAST: refuse (false) without side effects;
//    consume the token together with the grant; never throw after granting (wrap the immediate
//    save / pushes in try/catch and still return true). A throw counts as a refusal and leaves the
//    drop on the floor, so a throw after the grant would duplicate the item. The sim reports every
//    false as 'full' (and flags the drop blocked), so check any other eligibility before calling
//    requestPickup and let the hook refuse only for a full backpack. For a public drop (owner 0)
//    the hook is called with the CLICKER's id: its token must be grantable to anyone present.
//  - Public drops (spec.owner 0): spawnDrop(spec, x, y) tosses the item a short hop (z arc, one
//    small bounce) from the nearest open ground to (x, y) inside the arena and out of solid props;
//    it lands ~14–28 units IN FRONT of that point (towards the camera, +y ± 45°), never behind the
//    dropper's feet where it and its label would sit under her sprite. Emits 'dropSpawn'
//    { owner: spec.owner }, returns its id. The toss direction is hashed from the drop id and tick,
//    so dropping items never draws from the world rng (wave spawns are unaffected). It throws
//    (before changing anything) on a malformed spec or an owner that is neither 0 nor a player in
//    the instance; spawn before committing the item's removal. removeDrop(id) (expiry) removes
//    without an event. The sim never expires drops itself.
//  - A kill/chest spec without a boolean autoPickup is kept with the rules' default for its sprite
//    (equipment clicked, the rest walked over) and reported through drainHookErrors.
//  - Hooks can't break the world: the sim commits a death / an opened chest before calling out, a
//    throwing (or malformed) rollKillLoot / rollChestLoot yields no drops, a throwing tryPickup
//    refuses the pickup. The errors are collected: `drainHookErrors(run)` (the first one per
//    instance is also console.error'd). Specs whose owner isn't one of the ids passed are dropped.
//  - XP is shared immediately on monster death: one { t: 'xp' } outcome goes to every living
//    player in the instance. No pickup, proximity check or XP orb is involved.
//  - The completion chest opens for everyone when the first player touches it:
//    rollChestLoot(livingIds, lootRng), outcome chestOpened { playerId: opener }.
//  - Portals are walk-in and per player: a living player who STAYS inside an open portal for 0.5 s
//    (PORTAL_DWELL) gets their own enterPortal / returnPortal outcome; walking through or brushing
//    one does nothing. After an entry (or when a portal opens under someone, or they arrive on
//    one) they must step out (> 26 units) and back in. The hideout portal opens south-east of the
//    map device, off the spawn → device walk; the map's return portal opens near the player
//    nearest the boss's fall but ≥ 140 units from that spot and the chest and ≥ 60 from any drop.
//    setPortal(n) shows the hideout portal with PropView.state = n (0 hides it; the prop keeps its id).
//    A portal can also be clicked (the server's usePortal): the hideout portal is `interactive` while
//    open, the map's return portal always. The hideout's anvil is the Crafting Bench and interactive
//    like the map device, stash and merchant (it sits a step south of the stash, towards the spawn).
//    A client routing clicks on `interactive` props must send usePortal(prop.id) for kind 'portal' /
//    'returnPortal' (they open no panel) and open the crafting bench for 'anvil'.
//  - Kill credit: outcome kill.playerId is the player whose hit (or burn / trail) crossed zero, 0 when
//    that player has left. On-kill life/focus goes to them. Monster 'hit' events carry the same id.
//  - Events with no acting player (portal 'open') use playerId 0.
//  - Two optional fields beyond the frozen contract (types exported below):
//      SimPlayerUpdate.level — PlayerUpdate has no level, and PlayerView.level changes ONLY through
//        this field (restore alone is just a refill). Send `{ ...update, restore: true, level }` on
//        every level-up.
//      SimPlayerJoin.life / .focus / .debuffs — resume a player's vitals (clamped to 1..maxLife /
//        0..maxFocus) and debuffs (their remaining times; copy PlayerView.debuffs when they leave)
//        instead of full / none when re-adding them after a short absence, so a disconnect is never
//        a free heal or a free cleanse.
//
// Other semantics the presenter/app can rely on:
//  - 'cast' fires on the release frame of every skill except Rift Step (which emits 'dash').
//    'nova' / 'chain' / 'ward' add the skill-specific visual; a Nova echo emits only 'nova'.
//  - Monster 'hit' amounts are post-mitigation. Ignite damage is batched into one fire 'hit'
//    per monster every 0.5 s. Crits, killing blows and dummy hits are never dropped.
//  - Telegraphs are areas that resolve at age == duration with an 'areaResolve' event; the
//    Matriarch's charge is a line of 'slamWarning' circles that resolve as she passes over them.
//    Telegraphs, eruptions and fire pools hurt every living player inside them. An ice prison that
//    breaks (its player walked out) also ends with an 'areaResolve'; choirWave, tarPool, blizzard,
//    whirlwind, fire pools and the herald aura end silently, and so does a chargeLine (its damage, if
//    any, still lands; 'areaResolve' has no heading — the 'monsterAttack' charge / bolt marks it).
//  - 'xp' outcomes are whole numbers batched per tick (fractions carry over).
//  - 'pickup' outcomes only follow a successful hooks.tryPickup; a refused drop stays with
//    DropView.blocked = true and is retried when its owner walks onto it again (auto-pickup) or
//    anyone allowed clicks it. The 'pickup' event carries the drop's owner (0 = public) and the
//    picker's playerId.
//  - After 'flaskUsed' the app may push new flask counts via updatePlayer(id, { flasks }); an
//    in-progress recovery keeps running when the slot's flaskId is unchanged.
//  - Held slots fire as soon as usable. An instant skill (Rift Step) fires on the first held tick
//    and then at most every 0.4 s while the key stays held; releasing and pressing again always
//    fires at once. PlayerView.vx/vy is the *effective* velocity (after the 0.7× slow of timed
//    actives — never the basic attack — and the forward crowd slow), for locomotion playback.
//  - 'cinderSpit' is a lob: it flies exactly ProjectileStoreView.life = SPIT_FLIGHT = 1.1 s and only
//    bursts where it lands (radius 12, then 'projectileEnd'). Draw its height as 4h·u(1−u) with
//    u = age / life; the landing point is (x, y) + (vx, vy)·(life − age). life = 0: flat projectile.
//  - MonsterStoreView.mods is the ELITE_BIT mask (magic packs share one mod, rare leaders two).
//  - Bosses, lieutenants and heavy kinds (Ironhide Brutes, golems, shieldbearers) are heavy: players
//    can't shove them. Armoured kinds (MonsterDef.hitReduction: brutes 40%) take less damage from
//    hits (not from burning: ignite, fire trail, ward embers). Ghosts (rimeshades) drift through
//    monsters and props and never slow a player.
//  - Summoned minions never call rollKillLoot and carry half XP.
//  - Every boss phase threshold emits its own 'bossPhase' (2, then 3), each with a roar.
//  - RunView.boss.name / lieutenant.name come from the roster (e.g. 'The Hollow Warden').
//  - A map arrival (join) gets 1 s of invulnerability; players joining together fan out on a
//    16-unit ring around the entry point unless PlayerJoin gives x/y.
//  - RNG streams: combat = createRng(seed); loot = combat.fork(0x10070) (handed to the hooks);
//    world (spawns, AI, layout, drop scatter) = combat.fork(0x3013d).
//  - Store sizes: maps 2048 monsters / 2048 projectiles / 1024 motes; hideouts 16 / 512 / 64. Each
//    store also carries `hwm` (beyond the contract): every slot ≥ hwm is dead, so a snapshot encoder
//    may loop `i < (store.hwm ?? store.capacity)` instead of over the whole capacity.
import type { RunConfig, SimRun } from '../contracts/sim';
import { drainErrors } from './hooks';
import { createRunInternal, worldOf } from './run';

export {
  CAST_SLOW, PICKUP_APPROACH, PLAYER_CHILL_SLOW, areaSlowAt, castRateOf, combineSlow, debuffMoveSlow, debuffSlowOf, movePlayer,
  playerSlow, predictionSlow,
} from './movement';
export {
  CHARGE_LINE_HALF_WIDTH, CHOIR_GAP_HALF_ANGLE, CHOIR_RING_HALF_WIDTH, ICE_PRISON_END_FRACTION, TAR_SLOW, WISP_FREEZE_FRACTION,
  areaAngle, areaContains, areaVariant, chargeLineEnd, choirGapAngles, inChoirGap,
} from './area-geometry';
export type { SimPlayerJoin, SimPlayerUpdate } from './player';
export type { DebuffCarry, SimDebuffView } from './debuffs';
export { PULL_MAX_DISTANCE, PULL_TIME } from './constants';

export function createRun(config: RunConfig): SimRun {
  return createRunInternal(config).run;
}

/**
 * Errors thrown (or malformed results returned) by this run's RunHooks since the last call, oldest
 * first (at most 32 are kept between drains). The sim already recovered from each of them.
 */
export function drainHookErrors(run: SimRun): unknown[] {
  const w = worldOf(run);
  return w ? drainErrors(w) : [];
}
