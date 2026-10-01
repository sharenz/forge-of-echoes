# C. Map events: a full redesign

Status: design draft. Numbers are first-pass. Distances are world units; the player's base move speed is 110 u/s
(`src/data/progression/classes.ts`), arena radius 650 to 900, player radius 7. Wave length 60 s, 6 waves, boss on wave 6.

## 0. Pitch

Today an "event" is a hidden 25% roll that puts nine magic monsters at a marker. This redesign makes each event a
**question with a price**: something on the map asks the player to choose *where to stand, what to hit first, what to
give up, or how much to risk*, then pays in proportion to how well they answered (Bronze, Silver, Gold).
Twelve events, five specified in full. Every event is built from the same small set of engine primitives (zones, carried
objects, linked targets, escorts, timers), reuses the sim's telegraph/area system and monster brains, and stays
deterministic, server-authoritative and readable (telegraphs first, VFX never hide a lethal attack, no combat power-ups).

## 1. What exists today

Facts: `src/data/progression/map-events.ts`, `src/sim/map-events.ts` (201 lines), `src/game/progression/map-events.ts`,
`src/contracts/map-events.ts`, `src/present/map-events.ts` (25 lines), HUD text card `MapEventCard` in
`src/ui/hud/TopHud.tsx:233`, rewards `src/game/progression/loot.ts:286-303`.

| Event | What it does today | Why it is weak |
|---|---|---|
| **The Hunted** | 3 s warning, then one Swift/Fierce rare (a family `hunter`-role monster) spawns near a marker; killing it adds one Rare item per living player | a rare monster with a name. No behaviour of its own, nothing to decide, dies like any rare. The reward is generic |
| **Echo Rift** | optional violet sigil; walk within 70 u; 3 packs of 3 Swift magic monsters, 2 s apart; Reforging Ember + Map Dust (+50% Echo Shard T3+) | "walk up, kill nine magic monsters". Indistinguishable from an ordinary pack except the label; wave clock is the only pressure |
| **Blackout** | floor dims; three beacons in sequence, each releases 3 Swift magic guards; Binding Seal + Scrap | the darkness is cosmetic (actors and telegraphs stay lit, by design), so there is no gameplay change at all; again pack-at-marker |
| **Vaultbreakers** | 3 Swift magic carriers flee for 40 s (move away from nearest player, edge circling); each kill gives a currency roll (+20% Twin Ink) | the best concept (a chase), but the AI is "run away", rewards are flat, and there is no choice between them |
| **Second Crown** | at the boss, a twin of the same boss arrives after 3 s; both drop loot, last death gives Atlas credit + Crown Fragment | the same boss twice: double the same fight; no new mechanic, and the second is a copy with the same kit |
| **The Wound** | optional red sigil, three packs of three; each pulse telegraphs an eruption 1.5 s at players' *previous position*; last pack includes a rare | eruptions are a mild tax; movement is the whole counterplay; it is Echo Rift with fire |

Structural weaknesses common to all:
1. **One code path.** `spawnPulse()` spawns N monsters at a point (`packSize`, `pulsesFor`); everything else is a label.
2. **One slot.** `w.mapEvent` is a single `MapEventState`; chains are `Object.assign(e, next)`.
3. **Trigger and pace.** A private 25% roll at map creation, at most one per map, in wave 2 or 4 (`rollMapEvent`), and it
   holds the wave director up to 20 s (`MAP_EVENT_GRACE_SECONDS`), so an event *pauses* the horde instead of overlaying it.
4. **Rewards are flat and attached to a kill** (`KillLootContext.eventReward`), so an event without a final kill (a plant,
   a choice) cannot pay.
5. **No theme identity**: `spawnPulse` uses `family[0]` and a `hunter/fast` role monster, so an Ashen Forge event and a
   Chainworks event differ only in sprites.
6. **Presentation is one ring, one text label, one HUD card of strings** (`drawMapEvent`, `MapEventCard`), and no event has
   its own sound (only generic wave/drop cues).
7. **No interaction with the tree/mods/scarabs** beyond a percent of odds (`MOD_EVENT_BONUS`, `mapTreeBonuses.eventChance`).

## 2. What we keep / what we throw away

**Keep**
- Hidden creation plan, server-only, derived from the map seed (`createRng(seed).fork(0xe7e175)`, never sent in setup);
  exact *odds* displayed in the Map Device (`mapEventOdds`). Restarts preserve plans; legacy maps stay event-free.
- The kill-credited reward principle and "cleanup / overkill never pay twice" (`mapEventKill(w, id, credited)`).
- Fixed area sequences for sealed sites (Vaultbreakers in Gilded Vault, Blackout + Wound in Black Pit, three Hunted in
  Hunting Ground, three Echo Rifts in Rift Nexus) and Bounty's guaranteed hunter: kept as *slate presets* (each preset
  keeps its name and reward promises; the events inside are upgraded).
- Fairness precedents: 3 s warnings, `isHeld` rule (nothing starts on a rooted/frozen/dragged player,
  `src/sim/rosters/pressure.ts`), eruption at *previous* positions, `lockAt` marks that stop tracking (`AreaOptions`).
- The event colour identity table (`MAP_EVENT_COLORS`) and "completed text stays five seconds".
- Existing event-only ingredients: Echo Shard, Twin Ink, Void Splinter, Crown Fragment, Binding Seal (GAME_SPEC section 7).
  They stay the currency of events; their sources move to grades.
- Area-type and mod odds bonuses as a mechanism (`AREA_EVENT_BONUS`, `MOD_EVENT_BONUS`).

**Throw away**
- `spawnPulse` as the universal event body; the single `w.mapEvent` slot; the pause-the-waves grace model; hard-coded
  `packSize/pulsesFor/isOptional` tables; per-kind `if` chains in `updateMapEvent`, `TopHud.MapEventCard`, `loot.ts`.
- Flat rewards ("one Rare item"), "Void Splinter per kill".
- Second Crown as "the same boss twice".
- The idea that an event is a marker + label. Every event gets a signature ground glyph, sound identity and HUD readout.

## 3. The Event Charter (design rules every event must pass)

1. **A question, not a spawn.** Each event must contain at least one *decision* the player can get wrong in a way they can
   see afterwards (which lock, which wedge, which pact, which target first).
2. **Overlay, don't pause.** Waves keep running. Events add a second stream of attention. The only holds are the boss-time
   events (Rival Crowns, Champion's Ring) and they hold only the *next* wave tell, never an active fight.
3. **Grades, not binaries.** Every event pays Bronze / Silver / Gold from a measurable, on-screen quantity (time, whiffs,
   echoes intercepted, locks broken). Failure is *losing upside*, not losing progress.
4. **Readable first.** Every hostile effect a player can take damage from has a telegraph of at least 1.0 s (1.8 s for
   anything larger than 60 u radius) drawn on the telegraph layer, on top of event VFX. Event VFX never sit above the
   telegraph layer, never obscure a monster silhouette or a drop, and never flash the whole screen.
5. **Uses the map's own space and monsters.** Events use the theme's roster (rolls `THEME_ROSTER`), pillars
   (`w.props`) and the arena edge, not generic spawns.
6. **Every event has five beats:** Omen (seen at the wave tell), Onset (3 s telegraph), Play (2 to 3 beats), Payoff (a
   loot moment with anticipation, drop beam per `dropRare` conventions), Residue (a small lasting mark on the ground).
7. **No power-ups for the player.** No event grants temporary damage, speed, or defence (CONCEPTS section 1). Rewards are
   loot, choices about loot, and information. (Events may change *monsters* and *terrain*.)
8. **Deterministic and server-authoritative.** All randomness from the run's `worldRng` or the event's forked stream;
   all decisions are resolved by the server from positions/inputs the sim already receives; the client only draws.
9. **Event-length budget.** 45 to 90 seconds of active play; at most one "big" event decision on screen at a time.
10. **Scale with the party, not the player's gear.** Uses the existing party scaling (life x, budget x); reward is
    per living player, on top of ordinary loot.

## 4. Engine: Event Director v2 (what the sim needs)

### 4.1 Model
```
MapEventPlan[]  (creation-time, server-only)   [{ kind, window, seed, angle, variant, required? }]
  -> EventInstance (runtime)   state machine: dormant -> omen -> onset -> live -> resolve -> residue -> done
       registered EventScript per kind (like registerAreaEffect in src/sim/effects.ts):
       { canStart(w,plan), onOmen, onOnset, onTick, onKill, onEnterZone, onResolve, view(w) }
```
- **Slate.** At creation a map draws 0 to 2 (3 with keystones) plans: slot A in wave 2 to 3, slot B in wave 4 to 5, and an
  optional boss-time slot. Base chance for at least one event rises from 25% to 45% (a single `MAP_EVENT_BASE_CHANCE`
  change plus the slate roll), and the total cap stays at `MAP_EVENT_MAX_CHANCE` (65%) without Sworn to the Veil.
  Sealed areas keep fixed presets. Two events never share a wave window. The *plan* still never leaves the server.
- **Concurrency.** `w.mapEvents: EventInstance[]` (max 3 live). A **budget** rule prevents overlap of two "hot" zones
  within 200 u of each other and never lets two events *onset* within 8 s.
- **Wave interaction.** Replace `eventHolding` (waves pause) with a per-event `holdWaveTell` flag that only delays the next
  wave *tell* (never a spawn), max 8 s, and only for Rival Crowns and the Ring.
- **Primitives** (each maps to existing sim machinery):
  | Primitive | Built on | Used by |
  |---|---|---|
  | Zone (radius, kind, tick/resolve callbacks, enter/leave) | `spawnArea(kind, ..., AreaOptions.effect)` + new kinds | Echoing, Fault, Relay, Anvil, Host |
  | Interactive prop with dwell | `addProp(..., { interactive:true })`, like the portal/chest touch logic in `src/sim/props.ts` | Rift anchor, braziers, altar, anvil |
  | Carried object (a pickup a player holds) | new player field `carrying`; drop on death; speed -12% | Ember Relay |
  | Escort target (a special monster with locks/hardpoints) | monster + `driveEventMonster` hook (exists for carriers) | Caravan, Host prism |
  | Linked target (damage shared / shield link) | `AILMENT_BIT.shielded` + area effect tick | Bellwatch, Rival Crowns |
  | Kill log (ring buffer of notable kills: x, y, kind, rarity, mods, wave) | new, written in the kill path (`combat.ts:243` neighbourhood) | The Echoing |
  | Timer/objective bars | `MapEventView` extension | all |
  | Hostile-to-all area (`hurts: 'all'`) | `Area.hurts` gains a value; `damageMonster` + `damagePlayer` both called | Fault |
  | Reward grade | new hook `RunHooks.rollEventReward(ctx)` | all |
- **Rewards.** `rollEventReward(ctx: { kind, grade: 0|1|2|3, choice?: number, x, y, tier, area }, playerIds, rng)` returns
  `DropSpec[]` (same pattern as `rollChestLoot`, `src/sim/hooks.ts`). Grade 0 = failed (small consolation or none). Existing
  kill-attached rewards become grade-1 payouts inside this hook, so `loot.ts` loses its per-kind `if` chain.
- **View & wire.** `MapEventView` becomes `MapEventViewV2 { kind, phase, glyph, objective: {label, cur, max}[],
  timers: {label, seconds, total}[], zones: {x,y,r,kind}[], markers: {x,y,icon}[], hint: string-id, grade?: 0..3 }`,
  encoded in `src/net/snapshot.ts` (protocol version bump; the run has at most 3 views, so it is a few hundred bytes).
  HUD `MapEventCard` becomes one generic template driven by this view; text comes from a keyed table, not `Record<MapEventKind,string>` in TSX.
- **Persistence/restart.** Plans are serialised as today (`normalizeMapEvent`, extended with `variant`, `slot`); live
  instance state is not restored: a restarted map resumes at wave boundary with events marked `done` (existing behaviour
  "restarts preserve hidden creation plans" plus "unfinished event is cancelled").

### 4.2 Determinism and authority
- Every stochastic choice uses `w.worldRng` (already deterministic and used by `pressure.ts`) or a stream forked from the
  run seed by event id; no `Math.random`, no wall clock; timers count sim ticks (`DT`).
- Player decisions are *positions and damage*, never client messages. The only new input is none: Pact Altar and Anvil
  choices are "stand on the altar for 1 s" (dwell), so no new intent type is required.
- Kill log, echoes and stalker targeting use ids and slots in a fixed order; digest test (`src/sim/digest.ts`) includes
  event state so replays catch drift.
- Reward RNG is drawn from the loot stream at the moment of payout, keyed by (event uid, player id), so retries do not
  double-pay (the same receipt discipline used for Atlas credit).

### 4.3 Fairness budget (enforced in code, tested)
- **F1** A hostile area or pounce that can hurt a player has `duration >= 1.0 s` before first damage (1.8 s if `radius > 60`).
- **F2** No new hostile *start* on a held player (`isHeld`), no more than 2 event-owned lethal telegraphs per player at once.
- **F3** Event props/glyphs are decals; anything solid is a real `Prop` with a footprint, visible and sorted.
- **F4** Event monsters spawn at least 250 u from every living player except where the design says otherwise (Stalker
  pounce, Champion's Ring), and never inside a solid prop (`resolvePlayerAt`).
- **F5** Total live monsters respect `capacity`; an event that cannot spawn waits (never partial pay).
- **F6** A player that dies leaves the event running; a party wipe *freezes* every event timer (existing rule).
- **F7** Grade thresholds are computed before the payout and shown on the HUD (no hidden odds; Pillar 4).

### 4.4 Presentation stack (shared)
- **Ground glyph language:** each event has a signature ring glyph, colour and audio timbre (table 8). Drawn in
  `src/present/map-events.ts` as a table of `EventDrawer`s instead of one function.
- **Omen banner:** a parchment strip (same component as `TellBanner`) with the event glyph, 3 s, e.g.
  "Something is following you." Never blocks the wave tell.
- **HUD card:** glyph + name + 1 objective bar + 1 timer + 1 hint line, under the wave meter (existing slot). Type scale only.
- **Off-screen pointers:** a small claw/rift/wagon glyph at the screen edge toward the objective (one per event).
- **Audio:** per event: omen sting (a rising fifth in the event's timbre), onset hit, a loop that encodes urgency, a
  fixed-pitch progress ladder (each objective step is one note higher, like the level-up ladder), resolve chord by grade,
  and a failure "deflate" (never harsh). New `SfxId`s are appended to the frozen list `src/contracts/audio.ts`; the music
  intensity jumps to the top layer (`MUSIC_INTENSITIES`) for the event window. Payoff uses `impact` alignment so the flash,
  hit-stop (60 ms) and drop beam land on the transient.
- **Residue:** every event leaves a lasting decal (scorch, cracked plate, rune) drawn in the decal layer for the rest of the map.

## 5. The menu (12)

| # | Event | Replaces | Verb | The decision | Min tier | Window | Active time | Difficulty budget |
|---|---|---|---|---|---|---|---|---|
| 1 | **The Stalker** | The Hunted | bait & punish | where to stand when it pounces | 1 | wave 2 to 4 | 45 to 75 s | M |
| 2 | **The Echoing** | Echo Rift | intercept | roam vs guard; which echoes first | 2 | wave 2 to 4 | 50 to 60 s | M |
| 3 | **Laden Caravan** | Vaultbreakers | chase & choose | which locks to crack | 3 | wave 2 to 4 | 60 to 75 s | L |
| 4 | **The Fault** | The Wound | lure | which wedge to lure monsters into | 3 | wave 3 to 5 | 50 to 65 s | M |
| 5 | **Rival Crowns** | Second Crown | prioritise | which boss first | 5 | boss time | boss fight | L |
| 6 | **Ember Relay** | Blackout | carry | risk the flame vs. wait | 3 | wave 2 to 4 | 60 to 90 s | M |
| 7 | **Pact Altar** | new | stake | which pact (monster modifier) to accept | 4 | wave 2 to 5 | 2 rounds | S |
| 8 | **Ashseed Orchard** | new | defend & harvest | harvest now vs let it ripen | 2 | wave 2 to 4 | 60 s | M |
| 9 | **Champion's Ring** | new | duel | which vow (constraint) to take | 4 | wave 3 to 5 | 45 s | M |
| 10 | **Stasis Host** | new | time control | shatter the prism now or later | 6 | wave 3 to 5 | 50 s | L |
| 11 | **Wayside Anvil** | new | craft a boon | which reward boon the anvil forges | 3 | wave 2 to 4 | 60 s | S |
| 12 | **Bellwatch** | new | silence | which cantor to cut first | 5 | wave 3 to 5 | 60 s | M |

Weights (before area/mod bonuses): T1 to T2: Stalker, Echoing (T2), Orchard (T2); T3+: adds Caravan, Fault, Relay, Anvil;
T4+: Pact, Ring; T5+: Rival, Bellwatch; T6+: Stasis Host. Area-type bonuses are kept and extended (forge: Fault/Relay/Anvil,
crypt: Echoing/Host/Bellwatch, arena: Stalker/Ring/Rival, vault: Caravan/Pact, frontier: Orchard).

## 6. Flagship specifications

Each flagship uses this template: Fantasy, Trigger, Beats, Mechanics and decisions, Fairness, Theme variants, Rewards,
Failure, Interactions, Presentation, Engine.

---
### 6.1 THE STALKER (replaces The Hunted)

**Fantasy.** Something has been circling you since the first wave. You can feel it. You decide when it gets to strike, and
you make it miss.

**Trigger and placement.** Slot A or B (wave 2 to 4), spawns after the wave tell at the arena rim at least 320 u from all
living players. One Stalker per map. Bounty maps guarantee one at wave 2; Hunting Ground runs three in sequence (waves 2,
3, 4), each a fresh Stalker with the chosen-class reward.

**Beats.**
| t (from spawn) | Beat | Player sees / hears |
|---|---|---|
| -3 s | **Omen**: pawprint decals trail from the rim toward the party; low growl (theme pitch); banner "Something is following you." | amber eye-slit glyph on the ground at its spawn point |
| 0 | **Stalk**: the Stalker (a rare of the family's hunter role, 2 mods, visible with a broken translucent shimmer but always targetable) circles at 260 to 340 u | heartbeat loop at 60 bpm, off-screen claw pointer |
| every 9 s (7 s once it has 2 Hunt stacks) | **Pounce**: a shadow disc (r 34) appears under the *straggler* and grows for 1.2 s; it tracks until 0.4 s remain then **locks** (`followPlayer` + `lockAt`), then the Stalker leaps to the locked spot (0.25 s flight, the Rift Stalker leap machinery) | disc pulses red, heartbeat doubles, whoosh at lock |
| after pounce | **Hit** (lands on a player): damage + theme rider, Stalker gains 1 **Hunt stack** (+12% damage, +12% speed, max 3) and retreats to stalk range, healing 10% of max life. **Whiff** (lands on empty ground or a solid prop): 4 s **Exposed**, +40% damage taken, and if it hit a prop, 3 s stun | HUD "Whiffs 1", ground scorch mark stays, a hollow thud |
| 3 Hunt stacks | **Frenzy**: stops retreating; pounces every 4 s in a chain; +25% damage | drum roll, HUD hint "Frenzied: kill it" |
| death | **Payoff** (below) | anticipation 0.5 s + drop beam |

**Mechanics and decisions.**
1. *Bait, not race.* The pounce always targets the party's **straggler** (the living player furthest from the others; ties by
   player id), so parties stay together or bait on purpose.
2. *Geometry matters.* The pounce lands exactly on the locked disc; a prop in the flight line (`w.props`, `radius > 0`)
   intercepts it. Standing behind a pillar and stepping out at the lock deliberately produces a stun whiff. Open ground
   requires a dodge after the lock.
3. *Greed vs safety.* Being hit builds Hunt stacks and heals it; whiffs lower its danger and raise your grade. A single-target
   build can burst it during Exposed; an AoE build wants it inside the pack.
4. *Ignoring it is a cost.* Left alive at the boss wave or after 120 s it joins the horde as a permanent rare that pounces every 5 s
   and pays nothing.

**Fairness.** Disc telegraph >= 1.2 s, locks 0.4 s before impact so it is dodgeable at 110 u/s (44 u of margin); no pounce
on a held player (`isHeld`); the leap deals damage only on landing (no contact damage in flight); disc colour and outline are
opaque enough on all floors and drawn on the telegraph layer; never two pounces telegraphed on the same player.

**Theme variants** (three rosters, six themes pick by roster):
| Roster | Stalker | Pounce rider | Extra |
|---|---|---|---|
| Ashen (Forge, Chapel) | **Cinder Prowler** (rift stalker silhouette, large) | landing leaves a firePool 3 s, drawn as the warning disc | whiff into a prop shatters it and spawns embers |
| Ossuary (Ossuary, Crypt) | **Hollow Wolf** (rimeshade-style, passes through monsters) | chill; lands *through* walls but props still stop the disc | Exposed = it turns solid |
| Coliseum (Coliseum, Chainworks) | **Alpha Hound** with dragging chain | bleed; the flight is a chargeLine-style lane | the trailing chain is a visible line that also marks the leap path |

**Rewards (grade by whiff tally at kill; each active danger mod adds +1 to the tally).**
| Grade | Whiffs | Reward per living player |
|---|---|---|
| Bronze | 0 | one Rare equipment base (area class weights; Hunting Ground: chosen class) |
| Silver | 1 to 2 | Bronze + one currency from the map's weighted table |
| Gold | 3+ | two Rare bases + 25% chance of a Compass (or the area ingredient); T5+ adds a 5% chance of one unique-eligible roll |

**Failure/ignore.** No penalty beyond the permanent rare; the map is never blocked.

**Interactions.** Tree: *Hunter's Patience* (whiffs count double), *Warded Hunts* (the Stalker can roll a proof mod: readable in the hover
card), Rare Blood. Mods: Commanded (+1 mod), Restless (+20% speed, whiff windows shrink, +1 tally), Hexed (pounce +10% damage).
Scarabs: Haste shortens the window before the boss wave; Invasion fills waves early so the Stalker appears in a crowd
(planned for: it never spawns inside a pack). Bounty maps: guaranteed and Gold pays a bonus Bounty commission refund chance.

**Presentation.** Growl and heartbeat loops (sound encodes pounce timer), claw-mark edge pointer, HUD card "Stalker - Hunt 1/3 - Whiffs 2",
whiff = slow-mo 80 ms and a crowd-gasp-free hollow thud, kill = 60 ms hit-stop, trophy banner ("Gold Trophy"), a rare drop beam.

**Engine.** New brain `stalker` composed from `gapLeap` + `dropMarker` pieces in `src/sim/rosters/pressure.ts`; the disc is an
existing `leapWarning` area with `followPlayer`/`lockAt`; Exposed/Hunt stacks are two per-monster memory fields; `whiffs`
tally lives in the event instance; straggler selection is a pure function of positions and ids. Small new: prop-interception
test along the flight segment (segment-vs-circle already exists for projectiles).

---
### 6.2 THE ECHOING (replaces Echo Rift)

**Fantasy.** The rift replays everything you killed. The dead come back to the anchor. Do not let them get home.

**Trigger and placement.** Slot A or B (wave 2 to 4; wave 3 to 4 for sealed Rift Nexus, three in sequence). A violet
**Echo Anchor** (interactive prop) appears at least 250 u from all players and at least 200 u from the arena rim. Optional:
walk within 70 u to open it (as today's rift), or ignore it. Ignored anchors close at the boss wave.

**Kill log.** The sim records up to the last 24 **notable kills** (each pack's last-killed member, every rare, every magic
leader): position, monster kind, rarity, mods, wave. If fewer than 6 exist (early), the log is padded deterministically with
the current wave's family (never rares).

**Beats.**
| t | Beat | Notes |
|---|---|---|
| 0 | **Awaken**: 3 s warning; the anchor's rings unfold; banner "The rift remembers." | glyph = three concentric broken rings, violet |
| 3 to 33 s | **Recall**: an **Echo** spawns at the *original death position* every 2.5 s, oldest first, in translucent violet with a visible trail toward the anchor; each spawn has a 1.0 s "shimmer" telegraph at its spot | echoes walk at 65 u/s (0.6x player) straight to the anchor; **echoes of rares carry the rare's mods** (including elemental-proof), at 50% life |
| per echo | **Return**: an echo that reaches the anchor adds 1 **Resonance** (bar on HUD) and vanishes | ring brightens, one note up the ladder |
| ~36 s | **Verdict**: Resonance < 6: rift **seals**. Resonance >= 6: rift **erupts** (5 s telegraphed nova, then a *Rift Warden* rare) | |

**Mechanics and decisions.**
1. *Guard or roam.* Echoes ignore players unless a player is within 110 u; then they fight instead of returning. Standing
   at the anchor makes every echo fight you (safe, but you meet them all at once). Roaming toward their spawn points
   intercepts them piecemeal (efficient, but you leave the waves' front line).
2. *Your success is your difficulty.* A fast, wide clear leaves a long log with rares, so it produces a big echo train; a slow
   clear leaves a short one. The rift is self-scaling to how you played, and readable: the HUD shows "Echoes 14".
3. *Priority.* Echoes of rares (violet with a gold fringe) are worth more grade and are the ones that can carry a proof mod:
   kill those first.
4. *Cap.* At most 12 echoes per rift; extras are dropped oldest-first.

**Fairness.** Each echo shimmers 1.0 s before it can act; echoes deal normal-monster damage; the Warden telegraphs the
nova 5 s (radius 150) and never spawns within 250 u of a player; total echoes obey `capacity`.

**Theme variants.**
| Roster | Echo look | Rider | Origin marker |
|---|---|---|---|
| Ashen | Cinder Wraith (embers, dies in a small ash burst) | leaves a firePool at its *origin* (the lure marker); touching it burns | pool appears at the origin 1 s before the echo |
| Ossuary | Ghost-bone (passes through monsters, chills on touch) | chill | rime ring at origin |
| Coliseum | Crowd phantoms in **chained pairs** (a visible chain line; killing one slows the other 30% for 2 s) | bleed | chain-link decal at origin |

**Rewards.**
| Grade | Echoes intercepted (of total) | Reward per living player |
|---|---|---|
| Bronze | >= 50% | Reforging Ember + Map Dust (today's payout as the floor) |
| Silver | >= 75% | Bronze + 1 Echo Shard |
| Gold | 100% | Silver + 1 extra Echo Shard + one Rare-eligible base whose class follows the majority of intercepted echo families |
Erupt: Bronze only if the Warden dies. Sealed Rift Nexus: each rift additionally guarantees its event ingredient, as today.

**Failure.** Erupted rift = Warden fight (a rare, 3x life) and the payout floor drops to Bronze; nothing worse.

**Interactions.** Tree: *Resonant Rift* (tolerates 2 more, echoes +10% life), Twin Omens, *Echo Dust* (+ingredient). Mods: Teeming/Seething
Horde produce longer logs (more echoes, more reward), Commanded produces rarer echoes; Splitting mod gives echoes +1 projectile if artillery.
Scarabs: Invasion fills the log early (bigger echo train), Haste shrinks it. Rival Crowns/other events do not share an anchor.

**Presentation.** Anchor sound: a low choir hum whose pitch rises with Resonance; echo spawn = glassy "tick"; return = a bell
note one step up the ladder (fixedPitch); seal = full chord + a violet ring pulse; erupt = slow downward drone. HUD:
"Echoes 14 - Home 3/6 - Intercepted 9". Residue: a dim violet sigil stays in the ground.

**Engine.** Kill-log ring buffer; `Echo` = a normal monster spawn with a memory flag (drives movement via a new
`driveEventMonster` branch, precedent in `src/sim/map-events.ts`), 50% life, `drop none`, credited to the event via
`mapEventKill`; anchor = interactive prop + zone; Resonance in the instance; Warden via existing rare spawn.

---
### 6.3 THE LADEN CARAVAN (replaces Vaultbreakers)

**Fantasy.** A treasure wagon crosses your arena on a marked road. You have one minute and can crack two of its three locks.

**Trigger and placement.** Slot A or B (wave 2 to 4); sealed Gilded Vault preset (wave 2, with double escort). A **road** (a
gold chevron path, 1.3 R to 1.6 R long) is drawn from one rim point to another, bent around pillars by sampling
`resolvePlayerAt`; the wagon starts at the far end 3 s after the Omen banner.

**Beats.**
| t | Beat | Detail |
|---|---|---|
| -3 s | **Omen**: hoof and wheel sounds, chevrons flare along the road | banner "A laden wagon crosses the arena." |
| 0 to ~68 s | **Transit**: the wagon travels at 22 u/s (20% of player speed) with 8 escorts in formation (`monsterDef` family: hunters/bruisers) | the next 250 u of road is a **trample lane** (chargeLine telegraph) with pulsing chevrons; standing in it is light damage and a knock aside |
| 45% of route | **Reinforcements**: 4 more escorts drop from the rim (1.0 s shimmer) | horn sound |
| exit | **Escape**: at the far rim the wagon leaves; unbroken locks are lost | |

**Mechanics and decisions.**
1. The wagon is **invulnerable except through three Locks**, small hardpoints on it with their own life bars, each guarding a
   different prize: **Coffer** (currency: 3 rolls, incl. Twin Ink 20% chance, as Vaultbreakers), **Reliquary Chest**
   (one equipment roll, rare-eligible, area class weights), **Cartographer's Tube** (one map at tier+1 with quality, or a
   scarab roll). Lock life is tuned so a well-built party breaks about two in 60 s.
2. *Which locks?* Prizes differ in kind; the party chooses. Locks are hit only from behind the wagon's shield line, so
   killing escorts on that side opens the angle.
3. *Wheels.* Two wheel hardpoints slow the wagon 30% each if broken (extends the window at the cost of damage not spent on locks).
4. *Route knowledge.* The road passes props and packs; parties can pre-position on the route or chase.

**Fairness.** Trample lane is drawn 250 u ahead and pulses; escorts use normal roster attacks with their normal telegraphs;
the wagon does not damage on contact outside the lane; locks have no retaliation; the wagon never pathfinds into a player.

**Theme variants.** Ashen: **Ember Forge-Cart** pulled by Ironhide Brutes, locks are crucibles; breaking one spills a firePool
(hazard, drawn 1.0 s before it burns). Ossuary: **Pallbearer Bier**, bone thralls carrying a coffin; breaking the Reliquary
lock releases a Rimeshade. Coliseum: **Prize Wagon** hauled by Chain Thralls: the thralls' hooks (existing) can root you, so
the escorts are the threat; hooks are a visible line (existing rules).

**Rewards.** Per lock as above, paid at break, per living player; **Gold** (all three broken): + Twin Ink 50% + Compass. Silver
(two): normal. Bronze (one): normal. Escaped locks are lost; partial rewards remain earned (today's rule).

**Failure.** The wagon escapes with unbroken locks. Escorts left alive continue as normal monsters.

**Interactions.** Tree: *Quick Fingers* (locks -20% life, wagon +10% speed), Thick Herds (more escorts), Dead-End Devotee
in Gilded Vault. Mods: Restless (+20% speed), Teeming (+escorts), Fortified (locks +life). Scarabs: Haste
(shorter waves, wagon spawns earlier), Invasion (escorts blend into the horde: F4 forbids overlapped spawn zones).

**Presentation.** Chevron road, wheel loop (rattle), lock-break = chest-open sound (`chestOpen`) + coin/gem burst by prize kind,
escape = a fading gong. HUD: "Locks 1/3 - Wagon 62% - 47 s".

**Engine.** Wagon = large special monster (escort target: damage only via hardpoints; hardpoints are child hitboxes registered as
monsters with `noPack` and linked life), path follower in `driveEventMonster`; trample lane = existing `chargeLine` area
along the next route segment; rewards through `rollEventReward` per lock.

---
### 6.4 THE FAULT (replaces The Wound)

**Fantasy.** The floor is splitting. Use it against them.

**Trigger and placement.** Slot A or B (wave 3 to 5). A glowing **crack** decal (260 u long) appears at least 300 u from all
players inside the arena, optional: touch it (within 70 u) to open it (like the Wound sigil). Ignored cracks close at the boss wave.
Black Pit chains it after Blackout/Relay.

**Field.** When opened, a **Fault Field** (radius 240) is divided into **four wedges** (I to IV, numbered on the ground).

**Beats.**
| t | Beat | Detail |
|---|---|---|
| 0 | **Warning 3 s**, banner "The ground is splitting." | crack glows, wedge numerals appear |
| 3 s | **Pulse I**: 6 Swift magic guardians spawn on the *cracks between wedges* (fissure spawn markers 1.0 s shimmer), then every 8 s another pulse with 6 more (4 pulses, last one includes the *Fault-born* rare) | |
| each pulse +2 s | **Hot wedge**: one wedge is marked (numeral flashes) with a **1.8 s telegraph**, then erupts for 0.6 s: damage to **everything inside**, players and monsters (`hurts: 'all'`), and leaves a cinder crust (firePool 4 s) | the next **two** hot wedges are always shown (planning) |
| after pulse IV dies or 65 s | **Seal**: the field closes; residue cracks stay | |

**Mechanics and decisions.**
1. *Lure.* Monsters take 30% of their max life (15% for rares, 0% bosses) from an eruption: lure packs into the marked wedge
   and step out before the flash. The planning preview (next two wedges) makes it a route, not a reflex.
2. *Stand or spend.* Standing in a wedge that will erupt is deadly, standing in a wedge that just erupted is a crust
   (burning, cheaper). The safest wedge to fight in is the one three pulses away.
3. *Speed grade.* Sealing sooner pays more, so cheap lures are rewarded; ignoring the wedges works but is slower and harder.
4. *The Fault-born rare* carries the elemental mod of the theme (fire/cold/none) and is best killed *inside* an eruption.

**Fairness.** Eruption telegraph 1.8 s (radius > 60), never starts while a player is `isHeld`; wedge order is always
previewed two pulses ahead; damage on players = the Wound's tuned 14 x damage multiplier scaled with tier; no eruption
targets a wedge no player and no monster occupies (that would be a wasted pulse; the sim picks an occupied one deterministically
by (occupancy, id) tie-break, or nothing).

**Theme variants.** Ashen: **lava fissures** (`eruptionWarning`, fire, burning). Ossuary/Crypt: **rime fissures**
(`glacialSpike` lines erupt in sequence; chill; monsters chilled in the wedge are slowed 30%). Coliseum/Chainworks: **arena
spikes** (`arenaSpikes` tile pattern, bleed on players; monsters take physical damage, so shieldbearers can be lured too).

**Rewards.** Seal time <= 25 s Gold / <= 40 s Silver / else Bronze: **Void Splinter** x1 / x1 + one currency (Solvent/Catalyst per area) / x2 + one Rare-eligible base.
Black Pit: last guardian still guarantees Twin Ink + Void Splinter (today's promise).

**Failure.** After 75 s the field **overflows**: each 10 s an extra wedge erupts at a random occupied wedge plus 4 monsters. Ends at boss wave; Bronze at best (grade 0 = a Void Splinter 25% chance).

**Interactions.** Tree: *Fault-Walker* (eruptions +50% to monsters, one fewer preview), Thick Herds (more to lure). Mods: Volcanic (eruptions also spawn
on ordinary ground; the Fault warns and overlays), Fortified (lures hurt less). Scarabs: Haste shortens waves so the pulses stack with streams.

**Presentation.** Crack glyph = red star; deep rumble loop rising with heat; eruption sound = `eruption`; wedge numerals flash;
kill-by-eruption plays a distinct "crunch" and the kill counter shows a small "Fault kill" tag. HUD "Fault - Pulse 2/4 - Seal 24 s".

**Engine.** `Area.hurts` gains `'all'` (both `damagePlayer` and `damageMonster` paths, life-percentage damage for monsters as a
new `damageFrac`); wedge geometry helper in `src/sim/area-geometry.ts`; pulse scheduler in the event instance;
occupancy query through the spatial grid.

---
### 6.5 RIVAL CROWNS (replaces Second Crown)

**Fantasy.** A rival claimant arrives at the throne. The two bosses do not love each other. Choose who dies first.

**Trigger and placement.** Boss-time slot (requires T5+ or the Sealed Reliquary preset "Twin Crown" which keeps a mirror
of the same boss with shared 50% damage sharing as an alternate skin). Announced by an Omen at the wave-5 tell:
"A rival claims the crown."

**Beats.**
| t (from boss A spawn) | Beat |
|---|---|
| 0 | Boss A (the map's boss) enters as today |
| 20 s | **Arrival**: 3 s shimmer at the opposite rim, then **Boss B**, the boss of a *different theme* (deterministic pick: `ROSTER_BOSS[(index(theme) + 1 + seed%5) % 6]`), 60% life, 80% damage of its normal values, **phase-1 kit only**, its own aura and summons |
| B alive with A | **Feud**: each boss's summons and auras are hostile to the other's minions (no friendly fire on the boss bodies themselves) |
| first boss dies | **Spoils**: the survivor heals 20% and gains +25% damage and speed until it dies (the choice's cost is visible) |
| both dead | **Payoff**: chest opens as today; Crown Fragment per living player (Atlas credit still from the last death) |

**Mechanics and decisions.**
1. *Which first?* Killing B (60% life) first is fast but the empowered A is a full boss; killing A first leaves an empowered
   but simpler B. Both are readable: the empowered boss gains a visible crown glow.
2. *Attack budget.* B's timers are offset by 1.5 s from A's; a combined telegraph budget of 2 large (radius > 60) boss areas at a time is enforced by
   delaying B's next cast (never A's).
3. *Two unique pools.* Each boss rolls its own **exclusive unique** chance (12% base, Crowned Challenge multiplies), so
   the loot is a real reward for a real fight. B's pool is *its* theme's uniques (`uniquePool`), which the player
   cannot get from this area otherwise.

**Fairness.** B enters with a 3 s shimmer and a distant spawn (>= 350 u from players); B uses phase-1 kit only; combined
large-telegraph budget; final rage still ends the fight; enrage 240 s after B spawns (both +2% damage per 10 s).

**Theme variants.** B's theme differs by construction (rival's summons come from its own roster, so a Coliseum boss in an Ashen map
fields hounds and crossbowmen). Visual: B's aura ring colour is its theme colour so the two are told apart.

**Rewards.** Per boss: normal boss loot, exclusive-unique roll; Crown Fragment on completion. Grade by total time from B spawn to second death:
<= 150 s Gold (+1 extra unique-eligible roll), <= 240 s Silver (+1 Crown Fragment), else Bronze.

**Failure.** Player death only. If A dies before B arrives, B is *still coming* (holds the wave tell for 8 s, then arrives).

**Interactions.** Tree: *Crown Rivalry* (+50% B unique chance, B +15% life), Kingslayer's Tithe (loot x2), Crowned Challenge, Early Crown
(the boss on wave 3: the rival arrives on wave 4). Mods: Twin-Crowned (both bosses get +25% life), Bloodbound.
Scarabs: Invasion doesn't touch bosses; Haste shortens the fight window only between waves.

**Presentation.** Second boss bar under the first; distinct fanfare for B's arrival (`bossSpawn` + `crowdRoar` layered),
music jumps to `boss` intensity 1; when the first boss dies, the survivor's crown flares. HUD: two bars + "Spoils: +25%".

**Engine.** Second boss instance via `startBoss` (already done for the twin: `bossStates` is a per-id Map, `w.director.bossId`
tracks the first); B's `monsterDef` fetched from `monsterDef(kind)`; feud = hostile flag on summoned minions (their kind hostility
is per-monster memory), spoils = per-boss modifier state; Atlas credit rule already waits for the last death (`crownPending`).

---
## 7. Remaining events (medium specification)

### 7.1 EMBER RELAY (replaces Blackout)
- **Fantasy.** The lights are going out; carry a living flame across the dark.
- **Trigger.** Slot A/B, wave 2 to 4. Three unlit **braziers** (existing `brazier` prop) stand in a triangle >= 300 u apart.
- **Mechanics.** The arena gradually dims *visually* outside lit braziers (readability rule: monsters, drops and telegraphs stay lit).
  Unlit ground is **Shrouded**: monsters standing in it move 15% faster and are *not silhouetted by the floor* (they get the +
  rim treatment; still visible). A **Wickbearer** (a rare with a lantern mod) spawns; killing it drops the **Ember**, a carried pickup:
  the carrier moves 12% slower and its **wick** burns down (30 s, -2 s per hit taken; dropping it on death). Dwell 2 s at a brazier
  to light it, shrinking the shrouded area and awarding the leg. Three braziers to complete; each needs a new Wickbearer (one every
  25 s, or when the previous Ember is spent).
- **Decision.** Carry the Ember through a swarm now (risky, quick) or hold and clear a corridor first (safe, wick ticks anyway)?
  The wick timer makes waiting a cost. Grade by braziers lit within time and Embers lost: 3 lit no losses = Gold.
- **Rewards.** Binding Seal + Scrap (today's) as Bronze; Silver adds a Suffix Rune chance 10%; Gold adds a Fracture Core chance 15% (crafting-flavoured, matching Foundry).
- **Failure.** Wick out: the Ember dies, a new Wickbearer comes; after 3 lost Embers the event ends at Bronze/none.
- **Theme.** Ashen: braziers are forge-mouths; Ossuary: frost lanterns; Coliseum: tar torches (burning tar pools around lit ones).
- **Engine.** Carried object primitive; `dwell` reuses interactive-prop touch logic; shrouded flag = area effect `speed +15%` over monster set (heraldAura precedent);
  presentation dimming is renderer-only (`pen.light` pattern in `present/map-events.ts`).

### 7.2 PACT ALTAR (new)
- **Fantasy.** The altar offers three bargains; you pick one for the next wave.
- **Trigger.** Slot A/B, wave 2 to 5, T4+. At the wave tell, three glowing **pact stones** (1 to 3) appear in a triangle around a central altar.
- **Mechanics.** Standing on a stone for 1 s selects it; in a party, the most-stood-on stone wins (tie: lowest index). Pacts change the *next wave*,
  never the player: e.g. **Swarm** (+40% monsters, +40% quantity), **Blood Moon** (all packs magic, +60% quantity),
  **Ironhide** (+60% monster life, +40% rarity), **Ambush** (monsters arrive from all sides at once, streams -60%, +30% quantity), **Cinder Curse**
  (players -10 resistance, +25% rarity), **Ember Tax** (skip: no pact, +5 Scrap). Each is one line on the stone, readable at the wave tell, priced on the ledger (brief B 4.1).
  Two rounds (waves n and n+2). Round two's pact list is *harder* if round one was Bold.
- **Decision.** Which risk do you want on top of the wave already coming; Bold repeated compounds.
- **Rewards.** The pact's multipliers apply to that wave's drops (personal luck, instanced); plus a Pact Coin (Scrap-tier currency) per round completed, Gold (both rounds cleared, no death) = Binding Seal.
- **Failure.** Death does not void the pact; skipped = nothing.
- **Theme.** Stones are theme props (forge anvils, bone plinths, iron gongs). **Engine.** Pact = a `WavePlan` modifier applied at `beginTell`
  (`planWave` is the seam); quantity multiplier through the run's `RunSetup.itemQuantity` window for that wave (per-wave luck already exists as +2%/wave).

### 7.3 ASHSEED ORCHARD (new)
- **Fantasy.** Three seed-pods burst out of the ground. Grow them, or eat them early.
- **Trigger.** Slot A/B, wave 2 to 4, T2+. Three **blooms** (props with life bars) appear 250 to 450 u apart.
- **Mechanics.** Each bloom ripens over 60 s (visible growth stages 0 to 3). Monsters divert to the *lowest-life* bloom when within 220 u of one.
  **Harvest** any time by dwelling 1.5 s: yield scales with stage (stage 1 = Scrap, 2 = a crafting currency of the bloom's kind, 3 = a *rare-eligible* crafting ingredient of that kind).
  Bloom kinds: *Essence bloom* (essence of the map's theme), *Seal bloom* (Binding Seal/Suffix Rune), *Metal bloom* (Catalyst/Solvent).
- **Decision.** Harvest at 2 to be safe, protect for 3 at risk; which of three to defend when the horde splits.
- **Rewards.** Per bloom as above; Gold (all three at stage 3) adds a Void Splinter. **Failure.** A destroyed bloom yields nothing; no penalty otherwise.
- **Theme.** Cinder-blooms (fire embers), bone-lilies (frost), tar-sprouts (rust). **Engine.** Prop with health (destructible prop primitive), monster target override (`memory` retarget like `driveEventMonster`), dwell harvest.

### 7.4 CHAMPION'S RING (new, Coliseum-flavoured, T4+)
- **Fantasy.** A chained ring rises around you and one champion. Name your terms.
- **Trigger.** Slot A/B, wave 3 to 5. A **ring altar** with three **vows** (stones): choose by dwell.
- **Mechanics.** A chained arena (radius 160, a visible chain wall that blocks monsters from *entering*, players can leave) raises around the party and one **Champion**
  (a rare of the arena roster with two moves: a lane charge and a slam, both telegraphed). Vows: **Bare Hands** (you cannot use flasks inside: reward x1.5), **Iron Pride** (no ranged
  attacks from other monsters: the Champion +40% life), **Crowd's Favour** (arena spikes tile pattern, each 6 s: reward x1.3). Waves continue outside.
- **Decision.** Which constraint to take on for a reward multiplier; leaving the ring forfeits the multiplier only.
- **Rewards.** Rare armour base (Coliseum weights) + Fracture Core chance; Gold (under 35 s) adds a unique-eligible roll at 5%.
- **Failure.** Ring closes after 60 s; the champion joins the horde. **Engine.** Wall-as-area (choirWave-like band), reuse `chargeLine` + slam telegraph, arenaSpikes; flask restriction is a run-local rule (player flag); a *restriction*, not a power-up.

### 7.5 STASIS HOST (new, T6+, Ossuary/Crypt flavoured)
- **Fantasy.** A frozen legion stands in the ice around a time prism. It thaws as you fight.
- **Trigger.** Slot A/B, wave 3 to 5. 24 monster statues (visible silhouettes, family and rarity mix; some rares) around a **Time Prism** (destructible prop with life).
- **Mechanics.** The **thaw bar** fills with each kill you make on the map (+1.5% per kill) and with time (+1%/s). Every 4% thaws the next statue in ring order. Statues
  are **invulnerable while frozen**. The **prism** can be shattered by damage: doing so instantly thaws *all remaining* statues at once, with a 2.0 s shockwave telegraph, and pays double.
  Do nothing and they wake in ordered streams.
- **Decision.** Shatter early for a big, controlled fight and double loot, or let it thaw and take them in streams; the prism life is the price of the choice.
- **Rewards.** Every statue killed drops as if a monster of its rarity plus 60% quantity; prism shatter adds a jewellery/rune roll; Gold = all statues in 45 s.
- **Failure.** Fully thawed at once (bar 100%) = normal fight without prism bonus. **Engine.** Statues as spawned monsters with `frozen` flag (invulnerable, no AI), thaw scheduler.

### 7.6 WAYSIDE ANVIL (new; the crafting hook, T3+, forge flavour)
- **Fantasy.** A roadside anvil offers to forge the reward chest.
- **Trigger.** Slot A/B, wave 2 to 4. An `anvil` prop (existing art) appears with a **charge ring**.
- **Mechanics.** Kills within 260 u of the anvil charge it (20 kills fill it; tune by tier). Monsters still chase players as usual; the anvil is simply the place to *fight around*. On charge, the anvil offers **three boons** on stones; dwell to pick. Boons only alter the **completion chest's equipment**: **Tempered** (+1 max Stability),
  **Keen** (guaranteed implicit tier upgrade on the drop's class), **Attuned** (choose the equipment class), **Recast** (roll the chest equipment twice, keep the better). No combat effect.
- **Decision.** Pick the boon that best serves your crafting project; charge speed is your own clear rate. This directly satisfies the crafting pillar.
- **Rewards.** The boon is the reward; Gold (charged in 45 s) gives two boons.
- **Failure.** Uncharged by the boss: no boon. **Engine.** Zone counter, chest-loot hook parameter (`rollChestLoot` receives `eventBoons`), stone dwell.

### 7.7 BELLWATCH (new, T5+, crypt flavoured)
- **Fantasy.** A great bell tolls over the arena. Four cantors keep it ringing.
- **Trigger.** Slot A/B, wave 3 to 5. A bell prop on a scaffold at arena centre and four **Cantors** (rares with a `linked` mod) around it.
- **Mechanics.** Every 8 s the bell **tolls**: an expanding ring (choirWave machinery, radius from the bell, 3 gaps, chill on touch, telegraphed 1.5 s by a bell-swing animation). Each toll adds a **Dirge**
  stack (+8% speed to all monsters, max 5). Cantors are shielded (`AILMENT_BIT.shielded`) while at least two other cantors live (linked). Killing a cantor removes one Dirge stack and stops one of the four bell cycles.
- **Decision.** Which cantor to cut (they are placed so that two are on the outside of the tolls, two inside the rings' gaps), in what order, given the toll timing.
- **Rewards.** Per cantor a currency roll; Gold (all four before toll 6) = Prefix Rune chance + a jewellery-eligible base. **Failure.** After toll 8 the bell ends; Dirge stays 60 s.
- **Engine.** `choirWave` area + linked shield states; per-monster `linked` memory; stacking monster-speed effect through the herald-aura mechanism.

## 8. Per-theme variant summary (three rosters, six themes)

| Event | Ashen (Forge, Chapel) | Ossuary (Ossuary, Crypt) | Coliseum (Coliseum, Chainworks) |
|---|---|---|---|
| Stalker | Cinder Prowler, fire pool landings | Hollow Wolf, chill, phases through monsters | Alpha Hound, bleed, chain lane |
| Echoing | Cinder Wraiths, fire at origins | Ghost-bones, chill | chained phantom pairs |
| Caravan | ember forge-cart, crucible locks, slag | pallbearer bier, releases a Rimeshade | prize wagon, hook-throwing thralls |
| Fault | lava fissures | rime fissures, monsters slowed | arena spikes |
| Rival | boss from another roster with its own summons | (same) | (same) |
| Relay | forge-mouth braziers | frost lanterns | tar torches |
| Pact | anvil stones | bone plinths | iron gongs |
| Orchard | cinder-blooms | bone-lilies | tar-sprouts |
| Ring | (allowed, ember arena) | (allowed) | native |
| Host | (T6+, ember statues) | native | (allowed) |
| Anvil | native | (allowed) | (allowed) |
| Bellwatch | (allowed) | native | (allowed) |
Glyph and colour per event: Stalker amber eye-slit, Echoing violet broken rings, Caravan gold chevrons, Fault blood-red star,
Rival twin crowns (orange), Relay flame cup (warm white), Pact scales (gold-green), Orchard moss seed, Ring chain-iron, Host ice cyan prism, Anvil ember hammer, Bellwatch bone bell.

## 9. Interaction matrix

| System | Rule |
|---|---|
| **Tree** | Twelve event notables (brief B 5.5) alter one event each; *Twin Omens* second slot; *Sworn to the Veil* 100% events (mandatory); Strange Signs/Omen Reader add up to +12 pp; Echo Dust raises ingredient chance |
| **Map mods** | Danger mods raise Trophy tallies (each active mod +1 to Stalker/Echo intercept tolerance etc.) *and* alter the event (Restless: speed, Teeming: more units, Commanded: more rares, Volcanic: extra eruptions, Fortified: durable locks/blooms). Reward mods multiply event drops through personal luck as with all loot |
| **Scarabs** | Haste changes event *windows* (waves shorter), Invasion pre-spawns waves so events must not spawn into crowds (F4). New **Omen scarabs** (one per event kind) double that event's odds; Twinned Sockets lets two Omens load |
| **Map device** | shows exact odds per event (extends `mapEventOdds`); Bounty commission still guarantees the Stalker; a new tooltip line "Event slots: 1 (2 with Twin Omens)" |
| **Loot** | rewards via `rollEventReward`; event ingredients (Echo Shard, Twin Ink, Void Splinter, Crown Fragment) keep their sources; Kingslayer's Tithe multiplies boss-time events only |
| **Monster families** | each event picks roles from `family` (hunter, fast, bruiser, artillery) and never spawns roles absent from the roster; rosters may add event-specific **variant kits** (a few new brains, reused across themes) |
| **Wave director** | overlay, not pause; Rival Crowns and Ring hold only the next tell (<= 8 s) |
| **Party** | one instance for the whole party; rewards per living player; straggler rule for Stalker; dwell choices resolve by most-occupied stone |

## 10. Rewards summary (grades)

| Grade | Meaning | Typical payout (per living player) |
|---|---|---|
| 0 Failed | ignored or lost | small consolation or none (never a punishment) |
| 1 Bronze | done | today's payout (Rare base / Reforging Ember + Map Dust / Binding Seal + Scrap / Void Splinter / Crown Fragment) |
| 2 Silver | done well | Bronze + a weighted currency from the area table |
| 3 Gold | done perfectly | Silver + an event ingredient or a second Rare base; T5+ adds a small unique-eligible roll |
Gold rates are tuned to about 20 to 30% of attempts for a well-geared player (bots measure it, section 12).

## 11. What a first build looks like: slices for events (feeds the overview)

1. **Foundations (M):** Event Director v2 + primitives (zones, dwell props, kill log, view V2, `rollEventReward`) + porting the six
   old events *behaviour-equivalent* onto it (so nothing regresses), generic HUD card and drawer table.
2. **Stalker + Echoing (M):** the two flagships that need the least new infrastructure. Verify on bots and by playtest.
3. **Caravan + Fault (L):** wagon/hardpoint primitive, `hurts:'all'`, wedge scheduler.
4. **Rival Crowns + Ember Relay (L):** second boss with lite kit, carried object.
5. **Pact, Orchard, Anvil (M):** the "choice" events (mostly props + wave plan modifiers).
6. **Ring, Host, Bellwatch (M to L):** heavier, later tiers.
Each slice ships with sound ids, glyphs and HUD strings, and a hidden dev switch to force an event (extends the sandbox in `src/present/dev/sandbox.ts`).

## 12. Testing

**Bots** (existing balance harness): completion and grade distribution per event per tier (Gold 20 to 30%, Bronze+ >= 80% for a
matched-level bot), death rate delta vs no-event maps (<= +25%), event duration (<= 90 s), no wave stall (max wave hold <= 8 s),
determinism (same seed -> same digest with events on; `src/sim/digest.ts` extended), fairness assertions (F1 to F7 as sim
tests: every hostile event area has `duration >= 1.0 s`; no event spawn within 250 u of a player; no start on a held player),
capacity safety, party-of-4 runs, restart mid-event (cancelled cleanly).
**Playtests** (human): readability (can a new player say what the glyph means), decision clarity ("what should I do?" at 5 s),
feel (is Gold satisfying, is Bronze not insulting), pacing (events overlap with waves without overload), theme variety (do
Ashen and Coliseum feel different), party play. Screenshot review at 1024x600 and 1280x720 for the HUD card and glyphs.
