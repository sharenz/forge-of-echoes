# Roadmap

Maintained at the owner's request. Ask "what's next" and it is read from here; ideas and decisions
from discussions are added or moved between items. Nothing here is built unless it says **Done**.
Last reprioritised: 2026-10-01. Updated 2026-10-06 (R1 "Power" shipped).

## Next up, in order (reprioritised 2026-10-01 after the first outside player review)

1. **Onboarding follow-through and first-10-minutes verification.** The guide shipped (tracker, markers, cheat-sheet, Help, hints,
   gentle first map). Watch real new players (the first reviewer needed 2 minutes to find the drag), then fix what they still trip on.
   Done 2026-10-06: Rook's prices under every tile with empty states (F-17), the short map tooltip with the long form after 600 ms or
   Alt plus "Surge n/3 today" and a Re-chart hint (F-28), the hideout camera keeps the anvil clear at 1024x600, the area modal scroll fade.
   Still open: the return portal can land behind the inventory at 1024x600 (`returnPortalSpot` in `src/sim/props.ts`), e2e for
   keyboard-only, reduced motion, parties and veterans.
2. **Power rework, release R1 "Power": Done, deployed 2026-10-06.** Next releases of the same design (`docs/power-rework/build-plan.md`):
   R2 "Skills I": **C2 and SK0 built 2026-10-06** (32 skill ids, 8 loadout slots with `Space`/`Z`, ranks 1 to 10 with 2 points per level
   and unlocks by level, the augment system with 17 live augments on the seven shipped skills, respec for Scrap, three loadout presets, the
   data-driven skill executor in `src/sim/skills/` with bit-identical determinism goldens, protocol 28, save version 3: the owner's full
   skill-point refund). Still to do in R2: SK1 Skills panel v2 (augment picking UI, presets, respec dialog), SK2 ten new skills. Then
   R3/R4 (remaining skills and augments), R5 "Orrery" passive tree, R6 balance pass.
3. **Finish wave 3: polish (F1).** E1 anchor-aware events, B1 beacons and sigils, "Surge n/3 today" and the Re-chart tooltip entry
   are done (2026-10-06). Left over from B1: the other section 9 re-roles (Milestone/Signpost pin slots, Charter Ink, Chart Keeper x4,
   Far Horizon, Master Surveyor, Wagered Charts, theme seals' routing weight) and sigil crafting.
4. **Make the art keep its promises.** Lava cracks, ice lakes, hazard stripes and sand rings look like mechanics but are cosmetic. Add the
   mechanics (flow zones are built: candidates are frost currents in Frozen Passage and Winter Throne, a slag channel, a lava rill, a
   rotating sand ring, a tram road), plus flanker monsters so standing still is not a strategy and the level gap in the monster hover.
5. **P2 character depth: more Sorceress skills and a deeper skill tree, then the passive tree** (about 250 nodes). Designed together
   with the balance work in 2 so the new power has a curve to live in.

Also pending: gated tree nodes (Voidtouched Atlas, Warded Hunts, Stragglers' Cull, Lantern-Bearer's siblings, Wagered Charts), Twin Omens'
Backlash, dead drawer code and the Ctrl+Shift stash-to-bench shortcut, footsteps, Echo Exchange, leagues, more map bases, Barbarian.

**Shipped 2026-10-06 (power rework R1 "Power", `docs/power-rework/`):** level cap 80 and the T6 to T15 monster curve, damage pipeline v2
(player penetration capped and floored at 0, exposure down to -25%, DoT resist factor, `more` cap, overcap resistance as a buffer), void-
and physical-proof rares from T8/T10 and double proofs from T12, the rare/magic life floor for map packs (event elites keep their own
tuning), ten new affixes with bench penetration recipes, ten uniques (flags without behaviour yet are gated), Umbral Essence, utility
flasks (Quickstep, Aegis, Quicksilver Mind) with kill charges, and the character harness (band model, rules path, sim bands) with the
Atlas harness on band speed. Protocol 26.

**Shipped 2026-10-01 (commits `9321c7d`, `64819c3`):** conveyor flow zones (random directions, telegraphed reversals), projectile cover
(tall blocks, low passes, lobs fly over), animated Life/Focus globes and unspent-point badges, the Atlas area modal (click an area, map slot
in the centre with scarab sockets around it, Open area), Rook as a plain vendor grid with a luck-driven board (6-hour rotation and
level-up refresh, paid reroll), the onboarding guide and first-run UX fixes, the delivery rule (commit, push and deploy when finished).
Protocol 25.

## Top of the list: Atlas, Codex and map events rework (owner verdict 2026-09-30; waves 1 and 2 shipped)

Design briefs: `docs/atlas-rework/` (overview, A visuals, B tree, C events, `tree-events-interface.md`, generated `tree-nodes.md`).

**Waves 1 and 2: Done, deployed 2026-09-30 (commit `86f4228`).** Ember Chart Atlas, Codex tree wheel UI, 145-node tree with the 60-point
economy and migration, Event Director v2 with all 13 events (Stalker, Echoing, Caravan, Fault, Relay, Rival Crowns, Pact Altar,
Orchard, Ring, Host, Anvil, Bellwatch, Void Breach), the `foe` admin CLI, and the balance pass 2 (melee cap removed, steeper monster
curve plus level gap, armour bases, faster predicted projectiles, leaps and markers, proof rares, tier 1 XP halved).

**Wave 3: Done in part, deployed 2026-10-01 (spec `docs/atlas-rework/D-territory.md`).** Shipped: maps bound to one Atlas area with a
deterministic legacy-map migration (T0), chart-driven drop routing (R1), the Stock and Sources lenses, a drag-in passage slot, pins,
Re-chart, Recycle and Rook's Maps tab (U1, P1), five area-bias scarab families and the daily surge with Hourglass Sand (S1, G1), the
layout engine plus hand-crafted layouts for all 25 areas (L0 to L3), and monster wall navigation. Check 8 of the layout validator
guarantees no player trap. Protocol 22.
**B1 beacons and sigils: Done 2026-10-06** (25 beacons, 36 sigils in 12 kinds x 3 strengths, beacon slots in the area modal by drag from
the inventory, the Territory lens, Rook sells Faint sigils, T3+ bosses drop them, Survey Stake / Lamp Oil re-roles and the Lightkeeper
notable; protocol 27). **E1 anchor-aware events: Done 2026-10-06** (events in the 25 hand-crafted areas stand on the layout's declared anchors on their own
seeded stream, with the old site picking as fallback; layout validator check 10; a few anchors moved inward after a bot sweep). Watch Host in
Heart of the Forge and Hollow Ossuary (96 to 90 clears of 100 in the sweep). **Wave 3 still to build:** F1 polish (discovery,
pin and surge sounds and banners, reduced motion, telemetry).
**Watch in playtest:** deaths with layouts live (a balance probe needed its damage lowered from 1.8x to 1.5x), maps per run (about 7.5),
surge income (about +10% for a rotating player; Hourglass Sand slightly above 3%, lever `HOURGLASS_SAND.bossChance` 5% to 4%).

**Done, deployed 2026-09-30: inventory-first UI rule and its first applications.** Game-wide
rule in `AGENTS.md`: item-using panels open with the inventory and items go into slots by drag and drop. Applied to the Atlas (map
and scarab slots, Stash drawer removed), the Crafting Stash work slot (server-side, atomic, PoE-style in-place crafting) and the
merchants (Rook buy/sell/gamble and Mira: offer window, drag stock onto the backpack to buy at a chosen cell). Protocol 19.
Follow-ups from the audit: Ctrl+Shift-click from a stash tab onto the bench still bypasses the inventory; the Crafting Stash right-click
craft shortcut is a deliberate exception; delete dead drawer code (`MapStashView mode="device"`, `mapPicker` drop handling, `.fe-device__stash*`
CSS); at 1024x600 the stash footer ("Deposit all") needs a scroll.

**Still gated (fully specified, "Awaits ..." in the Codex):** Voidtouched Atlas (the Void Breach event exists; the server still has to pass
the map into the event rules); `sim` nodes Warded Hunts and Stragglers' Cull; `device` nodes Lantern-Bearer, Fifth Socket, Twinned Sockets and
Single-Minded Furnace (scarab sockets and essence attunement at the Map Device); `items` node Wagered Charts (account-bound chest map).
Twin Omens' Backlash pack on a failed encounter and Sworn to the Veil's "withhold the chest upgrade" price are not built (their text
now says only what exists).

**Open balance items (from the wave 1 bot harness and the owner's play):**
- Done 2026-10-06 (R1): player penetration and the offence/gear power curve.
- Endgame map pacing: an endgame build clears in 3.8 to 4.1 minutes at every depth (sim bot, no loot) against the design's 3 to 3.5;
  the floor is the six 60 s waves and the paced stream, not damage. Decide in R6 whether maps should shorten for strong builds
  (`tests/sim/character-bands.test.ts` holds the endgame band to +40% of the model until then).
- Flanker monsters: waves are frontal; add flankers so standing still is not a strategy.
- Level gap in the monster hover: show the monster/player level gap and its damage/hit-chance effect.
- Speed-clear tree tuning: every archetype currently clears slower than an empty tree, so no build "speeds up" a map. Retune
  the clear-speed nodes (Haste, Overrun Doctrine, density) or the harness baseline before more nodes ship.
- Rival Crowns Gold rate: too rare or too easy at Gold (verify against the 20 to 30% target for a matched player) and tune the
  fight-time thresholds.

**Owner delivery: Done (2026-09-30).** The whole QoL block (P0.1–4) and map-progression block (P1.1–9)
are implemented, verified and deployed. This includes account storage, the 25-area Atlas, all six encounters,
crafting ingredients, advanced bases, economy sinks, six map themes, twelve boss-exclusive uniques and the map tree.

**Owner's highest-priority request: Done (2026-09-30).** Equipment selling to Rook is deployed.

**Next priority:** P2 — more Sorceress skills and a deeper skill tree, then the passive tree.
Priorities follow current usability problems, then progression dependencies.

**Latest release: Done — `20260930-100836-a1eea20` (2026-09-30).** Rook's Sell tab supports clicking,
Ctrl/⌘-clicking and dragging backpack equipment into a selection. Appraisals use item level, base,
affix count and each affix's tier, with a breakdown for every price and a batch confirmation. Rarity alone
has no fixed price. Stronger rares pay more; the full formula and examples are in `GAME_SPEC.md` §9.
Only equipment can be sold. Equipped and trade-locked items are protected, and visitors sell their own gear.
Item removal and payment commit together, including rollback on database failure and protection against
repeat payment. Scrap fills the account Crafting Stash, then the backpack. Gambling costs stay unchanged;
the upper bound on expected resale remains below its purchase price, even with maximum item rarity.

Build/typecheck and all 1,973 always-on tests pass (12 on-demand checks skipped). Two-player Chromium
flows pass at 1024×600 and 1280×720, including appraisals, dragging/Ctrl-click, cancellation, exact payouts,
guest ownership, confirmation layout and restart persistence. Live protocol 18 and exact public JS/CSS
matches are verified. Fresh host-local production-copy audits before and after preserve all 475 physical
items across 4 accounts, 7 characters and 14 normal tabs, with unique IDs, no duplicate storage,
idempotent reload and healthy integrity. Post-drain backup:
`/var/lib/forge/backups/pre-release-20260930-100836-a1eea20.db`.

**Previous release: Done — `20260930-085326-1dfa4a0` (2026-09-30).** Testing merchant requested by the owner.
Mira the Provisioner supplies free scarabs (every tier), currencies/keys/ingredients, maps, equipment bases,
uniques and flasks. Category/search, quantity, map tier, item level and applicable rarity are selectable.
Every visitor to an enabled hideout can buy for their own inventory. The server CLI
`debug_merch <account> <character> enable|disable|status` validates ownership and manages persistent,
character-specific activation. Changes update live without a restart; disabling immediately blocks stale
panels. Purchases respect trade locks and are saved atomically. No character is enabled by default.
See `README.md` for local and production commands.

Build/typecheck and deployment rollback checks pass. The full balance-enabled run plus the final 17-check
rerun cover 1,976 passing checks. The command-list expectation now includes testing purchases;
audio/performance checks pass in isolation without changing their limits (1.321 ms average simulation tick).
Real CLI and two-player Chromium flows pass at 1024×600 and 1280×720, including live enable/disable,
stock options, guest ownership and restart persistence. Live protocol 17 and exact public JS/CSS matches
are verified. Fresh host-local production-copy audits before and after preserve all 475 physical items across
4 accounts, 7 characters and 14 normal tabs, with unique IDs, no duplicate storage, idempotent reload and
healthy integrity. The installed production CLI reports Eldurin disabled. Post-drain backup:
`/var/lib/forge/backups/pre-release-20260930-085326-1dfa4a0.db`.

**Previous release: Done — `20260930-082808-62ba497` (2026-09-30).** Scarabs: the Map Device has one
map slot and four scarab sockets. Only one scarab of each type is allowed, regardless of tier. The first two
types are Haste (15/25/35/50% less wave duration) and Invasion (start at wave 2/3/4/5 with every monster from
all earlier waves already spawned). Four tiers unlock at monster levels 4/22/46/70, with declining weights;
high-level monsters can still drop every lower tier. Scarabs use a separate rare drop roll, shared stash and
normal trading. Activation consumes them once; sockets and expedition effects survive restarts. Default maps
retain 60-second waves. See `GAME_SPEC.md` for exact rates, effects and recovery rules.

Build/typecheck passes. The full balance-enabled suite plus the final six-test comparison rerun verify
1,970 checks. Scarab rolls and toss animations use independent randomness; they preserve ordinary loot rolls,
drop placement and the world-generation stream. Cross-theme balance calibration prepares reference characters
without optional scarabs so a bonus pickup cannot reroute their gear progression; measured fights and the
separate progression suite retain the complete loot pool, with all balance limits unchanged. Chromium at
1024×600 and 1280×720 verifies all eight scarabs, dragging, Ctrl-click, duplicate rejection, consumption and
restart persistence. Compact Atlas entry/key regression checks also pass. Live protocol 16 and exact public
JS/CSS matches are verified. Fresh host-local production-copy audits before and after preserve all 460 physical
items across 4 accounts, 7 characters and 14 normal stash tabs, with unique IDs, no duplicate storage,
idempotent reload and healthy integrity. Post-drain backup:
`/var/lib/forge/backups/pre-release-20260930-082808-62ba497.db`.

**Previous release: Done — `20260930-013807-f32d033` (2026-09-30).** The account map tree has fifteen nodes in
five paths and up to ten points from distinct Atlas completions. Leaf refunds cost 5 Scrap; expedition choices
are frozen when opened and survive party play and restarts. Build/typecheck and all 1,957 balance-enabled tests
pass, followed by 18 focused checks after final copy/layout changes. Tree allocation, refund, budget and restart
flows pass in Chromium at 1024×600 and 1280×720; final compact layout, QoL regressions at both sizes and all
compact Atlas entry/key flows also pass. Live protocol 15 and exact public JS/CSS matches are verified.
Fresh host-local production-copy audits before and after preserve all 457 physical items across 4 accounts,
7 characters and 14 normal stash tabs, with unique IDs, no duplicate storage, idempotent reload and healthy
integrity. Post-drain backup: `/var/lib/forge/backups/pre-release-20260930-013807-f32d033.db`.

**Delivery completion audit:** every P0/P1 requirement is mapped to shipped behavior and validation below.
The final full suite covers current rules, simulation, server transactions and save/restart behavior.
Browser checks use `scripts/e2e.mjs --prod --only <scenario> --size <viewport>` at 1024×600 and 1280×720;
the release records retain which scenarios were repeated after later changes.

| Scope | Shipped behavior | Verification |
|---|---|---|
| P0.1–4 | Readable layouts, automatic special-stash filing, elite hover, global/party chat and avatar menus | Typography, stash, hover and social tests; layout inspection and `qol` browser scenario |
| P1.1 | Shared account storage with atomic transfers and legacy migration | Account-storage server tests, `account` browser/restart scenario and production-copy audits |
| P1.2 | Account Atlas, discovery/party credit, destination selection and key entry | Atlas rules/server tests and `atlas` browser scenario |
| P1.3–5 | Hunted/Echo Rift, Prefix/Suffix Runes and ten advanced bases | Event, rune, loot and crafting-progression tests; `events` and `crafting` browser scenarios |
| P1.6 | Stability repair, selective map rerolls, Bounty commissions and territory fees | Economy/advanced-map-crafting tests and `economy` browser/restart scenario |
| P1.7 | Six maps, one final boss each, wave-3 rewards moved to completion | Expanded-map and full balance-ladder tests; `maps` browser boss/chest clears |
| P1.8 | Nine ingredients, four remaining encounters, 25 areas and twelve exclusive uniques | Advanced-crafting, Atlas-content and keystone-unique tests; `ingredients`, `events`, `atlas` and `uniques` browser scenarios, including special-area clears |
| P1.9 | Fifteen map nodes, ten-point cap, paid refunds and frozen expedition choices | Map-tree rules/server tests and `tree` browser/restart scenario |

**Previous release: Done — `20260930-011433-2f6f480` (2026-09-30).** Twelve boss-exclusive uniques bring the
catalogue to sixteen. Six pools across eight Atlas areas unlock at T8/T10, each with a separate 12% roll
scaled by personal item rarity. All twelve have distinctive art and skill behaviour; sources, eligibility and
actual odds are shown in the Atlas, Map Device and item tooltips. Build/typecheck passes. The full balance-enabled
run plus focused corrections/combination checks cover 1,947 passing checks. Chromium at 1024×600 and 1280×720
verifies every item, equip/unequip, pool labels, odds and restart persistence; final source corrections pass at 1024×600.
Live protocol 14 and exact public JS/CSS matches are verified. Fresh production-copy audits before and after
preserve all 457 items on 7 characters across 4 accounts, with unique IDs, no duplicate storage, idempotent
reload and healthy integrity. Post-drain backup: `/var/lib/forge/backups/pre-release-20260930-011433-2f6f480.db`.
P1.8 is complete; P1.9 remains open.

**Previous release: Done — `20260930-004633-78ba155` (2026-09-30).** The Atlas now has 25 areas, with two
approaches through T11/T13/T15, all remaining dead ends and sealed destinations, four new tradeable keys,
fixed encounter chains and chosen-class Hunting Ground rewards. Pending Atlas awards survive closed maps
and restarts, and sealed areas require their full objective before granting completion credit.
Build/typecheck and 1,936 checks covered across the full balance-enabled suite and focused reruns pass.
Full Chromium clears cover Black Pit, Hunting Ground, Rift Nexus, Pit of Echoes and Shrine Field. Entry,
key/fee payments and graph layout pass at 1024×600 and 1280×720; route lines avoid unrelated area cards.
Live protocol 13 and exact public JS/CSS matches are verified. Production-copy audits before/after preserve
all 457 physical items across 4 accounts / 7 characters, with unique IDs, no duplicate storage, idempotent
reload and healthy integrity. Post-drain backup: `/var/lib/forge/backups/pre-release-20260930-004633-78ba155.db`.
Boss-specific unique pools and P1.9 remain open.

**Previous release: Done — `20260930-000009-9d1f0e0` (2026-09-30).** Nine ingredients with targeted sources:
Scar Balm, Anneal, Graft, Transmute, Compass, Echo Shard, Twin Ink, Void Splinter and Crown Fragment.
Blackout, Vaultbreakers, the Wound and Second Crown add beacons, fleeing carriers, optional eruptions and
independent twin bosses. Exact crafting previews, stash access, preserved item history and save/reload rules
are included. Build/typecheck passes. The full rules/simulation/balance run passed 1,912 checks; a pickup-test
timing condition was corrected and all 133 server checks passed on rerun. A final Transmute scar-compatibility
regression and the affected crafting suite pass (41 checks; 1,914 total checks covered across the suite/reruns).
All nine crafting flows and all four encounters pass in Chromium at 1024×600 and 1280×720, including rewards
and crafting persistence across restart. Live protocol 12 and exact public JS/CSS matches are verified.
Production-copy audits before/after preserve all 457 physical items across 4 accounts / 7 characters, with
unique IDs, no duplicate storage, idempotent reload and healthy integrity. Post-drain backup:
`/var/lib/forge/backups/pre-release-20260930-000009-9d1f0e0.db`.
This completes the ingredients/events portion of P1.8; the remaining areas, unique pools and P1.9 stay open.

**Previous release: Done — `20260929-230651-931a5af` (2026-09-30).** Six map types (P1.7): Cinder Chapel,
Choral Crypt and Chainworks promote the Herald, Chorister and Chainmaster into final bosses. Wave 3 now has
ordinary packs on every map; its guaranteed rewards move to the completion chest. Original final-boss tuning
is unchanged. New floor art, layouts, implicits, pack compositions, map icons and Atlas encounter labels are included.
Build/typecheck, all rules/simulation/balance checks and all 133 server tests pass. Complete boss/chest flows
pass in Chromium at 1024×600 and 1280×720; a compact Atlas card overlap was fixed and verified at both sizes.
Live protocol 11 and exact public JS/CSS matches are verified. Production-copy audits before and after preserve
all 457 physical items across 4 accounts / 7 characters, with unique IDs, idempotent reload and healthy integrity.
Post-drain backup: `/var/lib/forge/backups/pre-release-20260929-230651-931a5af.db`.
P1.8–9 remain in the active delivery.

**Previous release: Done — `20260929-222322-301c1b2` (2026-09-30).** Scrap economy services (P1.6):
repair one Stability with escalating lifetime prices, selectively replace one map danger/reward pair, and
commission a guaranteed Hunted encounter. T1–T3 territory entry stays free; deeper tiers charge 1–4 Scrap
once, refunded with an unrestorable expedition. Prices, odds and effects are shown before payment;
trade locks, stale quotes, save reloads and restart refunds are covered. Build/typecheck and all 1,863
always-on tests pass. Browser crafting, payments and restart checks pass at 1024×600 and 1280×720.
Live protocol 10 and exact public JS/CSS matches are verified. Production-copy audits before and after
preserve all 457 physical items across 4 accounts / 7 characters; unique IDs, no duplicate storage,
idempotent reload and database integrity pass. Post-drain backup:
`/var/lib/forge/backups/pre-release-20260929-222322-301c1b2.db`. P1.7–9 remain in the active delivery.

**Previous release: Done — `20260929-215849-789fe30` (2026-09-29).** Prefix/Suffix Runes and ten advanced bases
(P1.4–5). Runes preserve the other affix side and have separate Atlas boss sources; every equipment class
gets a level-42+ project, first eligible in Tier 8 drops. Exact previews, new artwork, stash slots and source
labels are included. Build/typecheck and all 1,853 always-on tests pass; final art/stash checks and real-browser
crafting, preservation, currency access and server-restart checks pass at 1024×600 and 1280×720. Live protocol 9,
exact public JS/CSS matches and production database integrity are verified. Post-drain backup:
`/var/lib/forge/backups/pre-release-20260929-215849-789fe30.db`. P1.6–9 remain in the active delivery.

**Previous release: Done — `20260929-213628-49369b3` (2026-09-29).** The Hunted and Echo Rift (P1.3): hidden
creation rolls, area/mod odds, warnings, world markers, progress and per-player rewards. Build/typecheck and
all 1,838 always-on tests pass; both encounters pass in Chromium at 1024×600 and 1280×720. Live protocol 8 and
public JS/CSS exactly match the tested build; production database integrity is healthy. Post-drain backup:
`/var/lib/forge/backups/pre-release-20260929-213628-49369b3.db`. Existing open maps remain event-free.

**Previous release: Done — `20260929-211123-98a6a84` (2026-09-29).** Twelve-area account Atlas, party discovery,
area-specific drops, Reliquary keys and same-tier/+1 completion maps (P1.2). Build/typecheck, a full 1,824-test
run and 29 final transaction checks pass; browser entry/key flows pass at 1024×600 and 1280×720. Live protocol 7
and public JS/CSS match the tested build. Host-local production-copy audits before and after preserve all
457 items on 7 characters across 4 accounts, with unique IDs, no duplicate storage and idempotent reload.
Post-drain backup: `/var/lib/forge/backups/pre-release-20260929-211123-98a6a84.db`.

**Previous release: Done — `20260929-203731-0923fa7` (2026-09-29).** Shared account stash, atomic transfers and legacy
stash migration (P1.1). Build/typecheck, 1,809 always-on tests and two-client browser/restart tests at both
1280×720 and 1024×600 pass. Protocol 6 and public JS/CSS match the tested build. Production-copy audits before
and after deployment preserve all holdings (4 accounts, 7 characters, 457 physical items), with unique item IDs,
no duplicate shared holdings and idempotent reload. Deployment rollback now restores code and database together;
healthy activation, failed health and backup refusal tested with disposable databases. Post-drain backup:
`/var/lib/forge/backups/pre-release-20260929-203731-0923fa7.db` (integrity check passed).

**Previous release: Done — `20260929-200443-00f0f86` (2026-09-29).** Global/party chat, chat party invitations,
party portraits with hideout/trade menus, automatic map/currency quick-move, elite hover modifiers and the
character/party layout fixes (P0 below). Live protocol 5 and the public JS/CSS match the tested build.
Production backup: `/var/lib/forge/backups/pre-qol-2026-09-29T20-03-30.120Z.db` (integrity check passed).

**Previous release: Done — `20260929-193742-2bcfd46` (2026-09-29).** Six slots labelled LMB, RMB, Q, E, R, F; any learned
skill in any slot, including Ember Lance; drag to move/swap from the skills panel or HUD. RMB replaces Space.
Auto-attack follows Ember Lance. Rare leaders gain ×3 life / ×1.5 damage, magic mobs ×1.5 life / ×1.2 damage,
before their existing modifiers. Named boss tuning stays as approved in the owner's playtest.
- Build/typecheck and 1,793 always-on tests pass, as do the full balance sweep's 18 checks (including 12
  on-demand checks). Drag/swap, clearing LMB, moving Ember Lance to F, and overlapping mouse buttons verified
  in Chromium; layouts checked at 1280×720 and 1024×600. Protocol 4 refreshes old clients.
- Fresh Ashen T1 clears in 9.2–11.5 minutes with 1–4 deaths across the three balance seeds. All normal T1–T3
  reference maps clear; on-level normal maps cost at most two deaths. One **magic** Coliseum T2 in the
  progression route costs five deaths before clearing: keep watching crafted-map difficulty in playtests.
  Progression checks now distinguish crafted drops from normal maps; stronger elites widen the permitted
  cross-theme lowest-life margin spread from 20 to 25 percentage points.
- Live health is healthy on protocol 4, the served JavaScript/CSS match the tested build, and the deployed
  bindings and elite multipliers were checked directly. Production backup:
  `/var/lib/forge/backups/pre-skill-slots-2026-09-29T19-32-46.599Z.db` (integrity check passed).

**Vision (owner):** two progressions. Character progression exists so you can run harder maps; **map
progression is the real game progression.** Hobby project played with friends (no trust/legal/scale concerns).

## Completed: balance overhaul (2026-09-29)

Owner's problem: the game is too easy, so there is no fun and no incentive to progress. After ~5 maps a level-13
character had crafted every item the way they wanted. Requirements from the owner:

- **Monster stats must scale with monster level, PoE-style.**
- **Early game is hard on purpose:** a fresh character is NOT guaranteed to clear T1 on the first tries; you die,
  get better gear, level up, then clear it.
- **Progression is steep:** you really have to farm good equipment.
- **Evasion is too strong:** 50% evade only with very focused high-end late-game gear.
- **Reduce drop rates** (crafting materials especially), **add more affix tiers**, **reduce the stats** items give.
- **Decisions:** T1 has a low monster level; no hard "too weak" penalty from the level gap; **target: a normally
  geared character comfortably clears maps up to about their own level + 3**; modded maps and higher tiers need
  properly crafted gear.

**Phase 1: Done — committed on `balance-overhaul` and deployed to production on 2026-09-29.**
Production release: `20260929-182502-e64cfd2` (balance/data commit `e26fc9c`, map-picker fix `e64cfd2`).
- Monster level = `6 x tier - 2` (T1 = 4, T4 = 22, T15 = 88); it is the item level of drops. Monster life x1.09 and
  damage x1.065 per level around reference level 10 (`MONSTER_LEVEL_SCALING`); tier scaling and early-tier easing
  are gone (tier still drives XP and rarity). Evade chance = `rating / (rating + 30 x monster level)`.
- Drops cut: currency 4% to 1.5% per kill, equipment 1.8% to 0.9%, crafting currencies about 3x rarer relative to
  Scrap, lieutenant / boss / chest guarantees roughly halved, rare weight 3 to 1.6. Level-1 spell power 8 to 11 so
  the hard first map does not drag.
- Measured with the balance bot: a fresh character clears T1 in about 10 minutes with 0-2 deaths and 30% or less
  life at the low point; a "normal player" (maps up to level + 3) reaches level 14 after 10 maps and is still pushed
  back; the prod character Eldurin (level 13, strong crafted gear) clears T1-T4, barely T5, fails T6.
- Tests: balance suites rewritten for the new intent (tests/game-progression/balance*.test.ts, playProgression
  helper), loot/maps/stats/spec tests derive numbers from the data; GAME_SPEC §3/§5/§7/§9 updated. All 1774 always-on
  tests and the BALANCE=1 suites pass, including a new regression check for map-level evasion in the runtime and sheet.
- Release verification: a fresh clone installs with `npm ci` and builds; the production browser's party, trade,
  pickup and restart scenarios passed, and the targeted stash/map-theme smoke passed at 1280×720. At 1024×600,
  the Map Device picker needed more minimum height to keep sticky headings from blocking map clicks; fixed and
  verified. The full browser harness still has intermittent random-drop and small-viewport navigation failures.

**Phase 2: Done — pushed on `balance-overhaul` and deployed as `20260929-190322-126a855`.**
- Affixes now have 7–10 tiers, with top tiers requiring item level 78–84 (T14–15 maps) and lower maximum values.
  All lowest-tier ranges and starting-kit values are preserved. Existing equipment migrates once, retaining
  its identity, relative roll, history, stability, scars and crafting protections.
- Resistances lose 0.5 percentage points per monster level above 10, capped at 40: no penalty in T1–T2,
  -3% in T3, -6% in T4, -39% in T15. The tooltip, map device, character sheet and map HUD disclose it.
- Armour already scales against the size of incoming hits; its sheet example now uses the map's monster
  level. Evasion already uses level-scaled monster accuracy, which the sheet now explicitly shows.
- The Patient Spark now requires level 10 and can drop in T2. The other three uniques unlock in T3/T4/T5.
- XP orbs removed at the owner's request: kills grant XP immediately to each living party member in the
  instance, regardless of distance. Fractional XP carries between kills; physical loot pickup is unchanged.
- Owner playtest: the first boss already feels hard and the balance feels about right. Boss damage is unchanged.
  With immediate XP, the fresh-character bot clears Ashen T1 in 9–10.4 minutes, reaches level 6 and drops to
  35–47% life across three seeds without dying. Level-11 characters fail T5 on all three seeds. Keep watching
  real-player feedback, especially the first Ashen boss's 4.5–5.6-minute bot fight.
- Validation: build/typecheck, 1,776 always-on tests and all 12 on-demand balance checks pass. HUD verified at
  1280×720 and 1024×600. Read-only migration audit of all 5 production characters preserves all 321 item IDs,
  including 148 equipment items / 258 affixes, with crafting metadata intact and no repeated migration.
- Production backup: `/var/lib/forge/backups/pre-phase2-2026-09-29T19-00-57.502Z.db` (integrity check passed).

**Phase 3: pacing (T1 experience halved, not deployed).** Owner decision: going up a tier must feel like progress, and
about ten Tier 1 maps should be needed to reach level ~10, where Tier 2 (monster level 10) is on-level.
`TIER_SCALING.tierOneExperience = 0.5`; tiers 2+ keep 1.28^(tier-1) (T2 1.28, T3 1.64, T4 2.10, T5 2.68). Measured with
the balance bot (3 seeds, character level after N Tier 1 maps): after 1/3/5/8/10 maps level 4/6/7/9/10 (was 5/8/10/11/12).
A fresh character still reaches level 4 (9 attribute + 3 skill points to spend) from the first clear, with 0-1 deaths.
At level 7 (after 4 maps) T2 is clearable but costly (lowest life ~50%); at level 9-10 T2 is comfortable (lowest life
50-70%, no deaths). Ladder test note: the on-level Tier 3 reference now allows four deaths and a 0.35 margin spread.

**Phase 3 (in progress, not deployed): steeper monster curve and character-vs-monster level gap.**
- Diagnosis on the owner's level-17 sorceress Eldurin at T5 (monster level 28): trash died to one Ember Lance,
  an Ashling bite was 5.7% of her life, a Brute slam 21%, a Matriarch slam 34%, and nothing compared her level
  with the map's. The curve was too flat above the reference level.
- Curve (`MONSTER_LEVEL_SCALING`, `monsterLifeScale/monsterDamageScale` in `src/data/progression/maps.ts`): below
  level 10 unchanged (life 1.09, damage 1.065 per level, so T1 is untouched); level 10-16 life and damage x1.09 per
  level; beyond level 16 life and damage x1.11 per level plus a flat +0.25 (of base) life per level. Level 28 is now
  life x8.9 / damage x5.9 (was x4.7 / x3.1); level 16 (T3) only x1.68 / x1.68 so on-level play is unchanged.
- Level gap (`LEVEL_GAP` in the data file, mirrored by `LEVEL_GAP_*` and `levelGapMult` in the sim, applied per
  player in `hitPlayer`): once the monster level exceeds the character's by more than 3, monsters deal +5% damage
  per further level, capped at +100%; nothing at or above monster level, and damage over time is not scaled again.
  Grace 3 matches "comfortable up to level + 3". Eldurin at level 28 gets +40%. Shown in the map tooltip.
- Result for Eldurin at T5 wave 1: trash bite 15% of her life (~7 hits with 29% evasion), Brute slam 55%, rare
  Brute slam 83%, Matriarch slam ~90%; Ashling 2.6 Ember Lance hits (was 1.3), rare Ashling 7.4 (was 4).
- Bot intent pinned in `tests/sim/balance-curve.test.ts` (always on): fair gear at map level 16 mostly clears,
  strong gear rushes level 22, level-22 fair gear fails level 28 and 34, strong gear at 28 is a coin flip and dies
  at 40, and a level-14 character with the same gear does worse than a level-28 one at map level 28.
  Live health reports protocol 3; public JavaScript/CSS match the tested build. Live T1 remains level 4.

## P0: usability and combat readability — Done (2026-09-29)

**Done — deployed as `20260929-200443-00f0f86`.** Build/typecheck and all 1,801 always-on tests pass
(12 on-demand balance checks skipped; this release changes no combat tuning). The production-build browser
scenario verifies two clients' global and party chat, right-click invitation/acceptance, avatar hideout travel
and avatar trade with no client errors at both 1024×600 and 1280×720. Character/party layout and elite hover
cards checked at both sizes. Protocol 5 refreshes old clients. The map-progression block was completed in subsequent releases below.

1. **Fix known UI layout problems after the font bump.** "Intelligence" collides with its `+` button in the
   character panel; party row metadata ("Ashen Forge T3 / 6/8 portals") wraps unevenly. Verify these fixes at
   normal and small viewports, then check the remaining panels for clipping or blocked controls. Keep this
   pass limited to concrete layout defects so it does not delay progression work.
2. **Stash quick-move to the special tabs** (owner). With a normal stash tab selected, Ctrl/Cmd-click on a map (or a
   currency) in the inventory should file it straight into the Map Stash / Crafting Stash, instead of into the open
   normal tab, so nothing has to be sorted by hand. `GAME_SPEC.md` §12 already says maps and currency "file
   themselves" on Ctrl-click, but per the owner it doesn't work this way while a normal tab is open. Also check
   Ctrl-click from a normal tab back out, and flasks/equipment (which stay in normal tabs).
3. **Monster pack modifiers on hover** (owner). When you hover a magic or rare pack, show its modifiers (top
   centre suggested). Spec data: magic packs share one mod (Swift, Stout, Fierce); a rare leader has 2 of
   Juggernaut, Frenzied, Ember-touched, Warded (`GAME_SPEC.md` §8). Needs the mods in the client snapshot and
   a hover hit-test on monsters; uses the shared UI type scale.
4. **Global chat and party avatars** (owner, 2026-09-29). Add a global chat channel. Right-click a player's
   name/message in chat to invite them to the party. Show one party avatar per player along the left side of
   the screen; right-click an avatar for **Join hideout** and **Trade**, using the existing party/trade actions.
   Keep chat and avatar context menus readable and usable at both normal and small viewports.

## P1: the spine — Done (2026-09-30)

Prioritise persistent map progression and reasons to craft. The Atlas can start with the current three map
bases; expanding the map roster is not a prerequisite. Continue collecting balance feedback during this work;
reopen tuning for a specific problem rather than starting another general balance pass.

1. **Account-wide storage — Done, deployed as `20260929-203731-0923fa7`.** Normal tabs, Map Stash and Crafting
   Stash share one account record. Legacy characters merge without losing overflow; extra tabs are retained.
   Other online alts see changes immediately; transfers save both sides atomically. Build and 1,809 always-on
   tests, two-client browser/restart checks at 1024×600 and 1280×720, and production-copy migration audits pass
   (4 accounts, 7 characters, 457 items; counts/rolls preserved, unique IDs, idempotent reload). Deployments now
   back up the database after draining; isolated checks verify healthy activation, database/code rollback and
   refusing an existing backup. Atlas uses account persistence in P1.2.
2. **Atlas vertical slice — Done, deployed as `20260929-211123-98a6a84`.** (owner's main idea, see "Atlas design"). 12 hand-authored areas, depth 0-4, tier
   ceiling 1-9, fog with 2 reveals per boss kill, area type label visible once revealed, one dead end (Ember
   Vault), one sealed rare area (Sealed Reliquary), atlas panel in the Map Device, per-account save, party
   discovery credit. Replaces the "chest guarantees tier+1" rule (proposal: same tier, 25% chance of +1).
   Must prove: players choose different routes on purpose; the dead end is a choice not a trap; the sealed door
   creates a goal; a fresh alt benefits without feeling cheated.
   **Verified and live:** routes, account discovery, party credit, restart receipts/retries, area selection,
   theme/loot preferences, key-gated Reliquary and the 75% same-tier / 25% +1 chest rule are implemented.
   Build and all 1,824 tests in the full run pass (12 optional balance checks skipped), followed by 29 account/
   Atlas/restart checks after adding one final cross-account transaction regression. Browser entry/key flow
   and layout pass at 1024×600 and 1280×720. A fresh production-copy audit preserves all 457 items on 7 characters.
   Protocol 7, exact public bundle matches and a post-deployment production-copy audit also pass.
3. **Map events, first two — Done, deployed as `20260929-213628-49369b3`.** The Hunted and Echo Rift roll at map
   creation (25% base, at most one per map), hidden until wave 2 or 4. Area types and selected map mods favour
   specific events; Map Device displays exact odds. Hunted brings a rare pursuer and guarantees a Rare item;
   an optional Echo Rift releases three magic packs and rewards Reforging Ember + Map Dust. Both have warning
   cues, HUD progress, world markers and per-player rewards. Event grace is capped at 20 seconds so normal
   map progression cannot stall. Legacy runs remain event-free. See GAME_SPEC §7 for mechanics.
   Build/typecheck and all 1,838 always-on tests pass (12 optional balance checks skipped). Both encounters,
   hidden discovery, rewards and restart fixtures pass in Chromium at 1024×600 and 1280×720; final HUD
   contrast/layout inspected at both sizes. Live protocol 8, exact public bundle matches and production
   database integrity pass. The remaining progression work is tracked below.
4. **Ingredients, first batch — Done, deployed as `20260929-215849-789fe30`.** Prefix Rune reforges prefixes;
   Suffix Rune reforges suffixes. Both preserve affix count, rarity, name, the opposite side and protected affixes,
   cost 3 Stability, use normal scar rules and break seals after the craft. Exact family/tier previews; tradeable,
   stack to 20, Crafting Stash slots. The Glass Sepulchre boss drops Prefix Rune on T3+; Ember Vault drops Suffix
   Rune on T3: each 25%, one extra per living player, outside ordinary currency rolls. Sources appear on the Atlas
   and rune tooltips. Preservation, odds, rejection, spending, save/trade locks and real browser/restart checks pass.
5. **Item bases at ilvl 42+ — Done, deployed as `20260929-215849-789fe30`.** Ten new bases cover all ten equipment
   classes, with level requirements 42 or 46, stronger implicits/properties, distinct material preferences and new
   artwork. Tier 7 (ilvl 40) cannot drop them; Tier 8 (ilvl 46) can. Existing bases retain their stats; area class
   preferences apply to the new bases. Rook's gamble also respects each base's level gate. Generation, actual
   chest rewards, save reloads, icon footprints and both browser viewport checks pass. See GAME_SPEC §5.
6. **Economy sinks — Done, deployed as `20260929-222322-301c1b2`.** Bench repair restores one Stability for
   `8 + 3 × lifetime crafts + 6 × previous repairs²` Scrap, preserving scars, affixes and protections. Counters
   survive capped history, trading and reloads. Selective map danger rerolls cost `3 + tier`; Bounty commissions
   cost `8 + 2 × tier` and guarantee The Hunted. Territory fees are free at T1–T3, then 1–4 Scrap, paid once by
   the owner and refunded atomically with server-unrestorable maps/keys. Exact prices/odds, stale-price refusal,
   trade locks and browser/restart checks pass. Hard crafting currencies retain their scarce drop sources.
   Watch the Scrap balance for a week before the Exchange.
7. **Reuse wave-3 bosses to expand the map roster — Done, deployed as `20260929-230651-931a5af`.**
   Six maps with one final boss each: Cinder Chapel / Ashbound Herald, Choral Crypt / Bone Chorister and
   Chainworks / The Chainmaster join the original three. All wave-3 lieutenant encounters are removed;
   their guaranteed equipment, currencies and map chance move to the completion chest. Each new map has
   its own art, layout, family selection and implicit. Ember Vault, Glass Sepulchre and Iron March use the
   new encounters, and the Atlas names each destination's boss. Original final bosses retain their tuning.
   The full Tier 1–3 balance ladder, fresh-character and party checks pass; average fresh T1 clears span
   6.1–7.9 minutes across the six maps. A bot pursuit bug around pillars was fixed without changing combat rules.
   All three new maps complete through their bosses and chests in both browser sizes; live assets and
   before/after inventory audits are verified.
8. **Rest of the content — Done:** remaining events (Blackout, Vaultbreakers, Second Crown, Wound), remaining ingredients
   (Scar Balm, Anneal, Graft, Transmute, Compass; event-only Echo Shard, Twin Ink, Void Splinter, Crown Fragment),
   remaining dead ends and rare barrier areas, keystone bosses with their own unique pools.
   **Ingredients/events: Done, deployed as `20260930-000009-9d1f0e0`.** All nine ingredient operations and
   targeted sources are live, along with Blackout, Vaultbreakers, Second Crown and the Wound. Independent
   twin-boss state, timed carrier rewards/escape, crafting preservation, exact previews, stash access and
   save/reload behavior are verified, including browser playthroughs at both sizes.
   **Atlas expansion: Done, deployed as `20260930-004633-78ba155`.** 25 areas with two approaches through T11/T13/T15, all
   remaining dead ends and sealed destinations, four new keys, fixed encounter chains, chosen-class hunter
   rewards and durable pending Atlas credit. Build/typecheck and 1,936 checks covered across the full suite
   and focused reruns pass. Full browser clears cover Black Pit, Hunting Ground, Rift Nexus, Pit of Echoes
   and Shrine Field; entry and graph layout are checked at both screen sizes.
   **Boss uniques: Done, deployed as `20260930-011433-2f6f480`.** Twelve new uniques cover all ten equipment classes,
   two per boss, eligible at T8/T10. Six exclusive pools across eight Atlas areas roll separately at 12%
   times personal item rarity. New skill behaviour, individual art, source/odds labels and Crown rerolls
   are covered. The original four remain in ordinary loot/gambling. Full rules/simulation/balance testing
   plus focused reruns cover 1,947 checks; browser equip, source and restart flows pass at both screen sizes.
   Final build/typecheck and production-copy audits before/after pass (457 items, 4 accounts, 7 characters;
   conservation, unique IDs, no duplicate storage, idempotent reload and integrity). Live protocol 14 and
   public assets match the tested build.
9. **Map tree v0 — Done, deployed as `20260930-013807-f32d033`.** Fifteen map-only nodes across Cartography, Crafting, Hunting,
   Fortune and Encounters. First distinct Atlas completions award up to ten points; each node costs one and
   leaf refunds cost 5 Scrap atomically. Allocations are shared by alts and frozen into the opener's expedition,
   including for party members and restarts. Bonuses, prerequisites, costs and tradeoffs are shown in the
   tree and map readout. Build/typecheck and all 1,957 balance-enabled checks pass, with 18 focused checks
   after final copy/layout changes. Browser allocation/refund, budget, snapshot and restart flows pass at
   1024×600 and 1280×720; the final compact tree has all fifteen nodes visible even with the budget message.
   QoL regressions pass at both sizes; all Atlas entry/key flows pass at 1024×600. Production-copy checks before and after deployment
   preserve all 457 physical items across 4 accounts / 7 characters, with unique IDs, no duplicate storage,
   idempotent reload and healthy integrity. Live protocol 15 and exact public JS/CSS matches are verified.

## P2: character depth

- **More Sorceress skills and a deeper skill tree** (owner). Today: 8 skills, roughly one row with a few
  prerequisites. `CONCEPTS.md` wants branches that change behaviour (pierce, split, lodge-and-detonate, convert
  damage type) and lists Cinder Comet, Echo Bloom, Phase Step which may not exist yet.
- **Passive tree** (about 250 nodes, notables, keystones). Decide together with the skill tree. Open: points and
  whether they share a pool with skill points; respec cost; behaviour vs stats. Keep it clearly separate from the
  map tree.

## P3: after the spine

- **Character walking / footstep sounds** (owner, 2026-09-30). Audible footsteps when your character walks
  in the hideout and maps, timed to movement and stopping when the character stands still.
- **Echo Exchange (auction house),** specified in `GAME_SPEC.md` §15. After the sinks (P1.6). Decided: simulated
  liquidity with **fake players** that look real (no "house" label). Keep: a small cast of stable names, same
  listing rules and fees as real players, shrinking as real listings grow, priced in hard currencies, and tests
  that trading with fakes never yields a free profit.
- **Leagues** (owner: yes, later): resets the economy and reshuffles the atlas with a new seed. Softens the locked
  "permanent characters, no leagues" decision in `GAME_SPEC.md` §0 / `CONCEPTS.md`; update those docs then.
- More map bases: Drowned Archive, Grave Orchard, a Storm family with the Shocked debuff (real fix for area
  sameness, since only 3 monster families exist).
- After tier 15: decide later, once reaching it feels good.

## P4: new class

- **Barbarian** (owner). A second class, melee-flavoured next to the caster Sorceress. Comes after the passive tree
  so it can ship with its own skills and tree section. Open (to discuss when it's time): skill list and identity,
  weapons/armour/bases (needs melee bases and stats such as strength scaling), resource (Focus vs a rage-style
  meter), and how the map/wave combat suits melee (positioning, hordes). Needs its own art and animations.

## Ideas (unrefined)

- Font-size setting (UI-size multiplier on the type tokens, e.g. 100 / 115 / 130%).
- Survey consumable (reveals one adjacent area's type; a Scrap sink).
- Live-ops basics: telemetry, DB backups, admin tool (check what exists first).
- Client bundle code-splitting (chunks over 500 kB); `vite.config.ts` uses `__dirname` (native config loader warning).
- Stabilise the browser harness: avoid relying on a random equipment drop within a short timeout, and avoid
  walking back through a hideout portal during the 1024×600 map-theme smoke.

## Atlas design (decided 2026-09-29)

Owner's vision: the account has a world map of unexplored territory under fog, starting at one area. Playing a map
at an area reveals neighbours; areas have specialisations (event odds, drops, bases); dead ends exist; rare
areas appear at random with a guaranteed event, behind a barrier. Owner delegated the details to Claude ("you
decide"), informed by an ARPG-designer agent review. Owner can overrule any of these.

- **Fixed hand-authored atlas for launch**, same for every account; a league seed reshuffles it later.
- **Account-wide** progress; deeper into the fog = higher tier ceiling (`min(15, 1 + 2 x depth)`, caps the map-item
  tier usable there); 2-3 neighbours per area, tier-10+ areas reachable two ways.
- **Fog:** a boss kill reveals 2 of the area's unrevealed neighbours (fixed order at first, seeded random later).
  Every party member gets discovery credit; reveals are per account.
- **Map item vs area:** the item carries tier, quality, mods, corruption; the area carries theme, biases, event
  table, implicit. Any map item works at any revealed area up to its tier ceiling.
- **Reward kinds, not bigger numbers:** Ashen = essences and fire bases, Ossuary = jewellery bases, Coliseum =
  armour and Fracture Cores; the best ingredient for a craft sits in a different area than the one you farm.
- **No depletion.** Farming a good area is fine.
- **Dead ends** are the best place for one specific thing, same tier as their entry, never a trap: Ember Vault
  (a key ingredient only drops here), Hollow Ossuary (2x jewellery, +30% quantity), Pit of Echoes (guaranteed 7th
  Echo wave, harder boss, costs a Bounty map), Shrine Field (no boss, event odds x3).
- **Rare barrier areas:** about 1 in 8 clears reveals one as a sealed door showing the key it needs. Keys drop mainly
  in specific area types (route knowledge) plus a small chance anywhere at higher tiers; tradeable, never expire.
  Sketches: Sealed Reliquary (boss twin, unique + Crown Fragment), Gilded Vault (3 Vaultbreaker carriers, 3x
  currency), Black Pit (Blackout + Wound, Twin Ink), Hunting Ground (3 Hunted rares, 3 chosen-class rare bases),
  Rift Nexus (chain of 3 Echo Rifts, event-only ingredients). Parallel rewards; they never unlock tiers.
- **Content reality:** 25 areas of 6 types, built from 6 map themes sharing 3 monster families, with
  distinct arena layouts, implicits, event tables and drop preferences.
- **Other decisions:** no carry bonus for the map owner; keystone bosses drop their own uniques; events are not
  shown before entry; stash is account-wide.
- **Top failure modes to watch:** the community solves one best route; areas feel alike on shared rosters; players
  confused about what the item vs the area decides.

## Pre-overhaul balance findings (2026-09-29, from Eldurin, level 13, and a bot replay)

- **Monster level is only a label:** it sets the item level of drops (and unique eligibility) and does nothing to
  monster stats. T4 = "monster level 30" therefore does not mean monsters two times your level; it is just
  `min(90, 6 + 6 x tier)`. What scales monsters is the tier: life x1.16 and damage x1.10 per tier above 1, plus
  early-tier easing (T4: -10% life), plus +8% life / +4% damage per wave.
- **Character:** level 13, all-rare gear, 308 life, 27% fire / 30% cold resist, about **52% chance to evade** (rating
  about 270; the formula is `rating / (rating + 250)`, cap 75%), 4 skills at low ranks (Lance 1, Nova 3, Flame Wave 6,
  Rime Shards 3), **15 unspent attribute points and 1 unspent skill point.** So the character is not even at
  full power, and it still finds T4 easy.
- **Bot replay of that exact character on Ashen Forge:** clears T1-T11 with no deaths; lowest life 60-98% (T4: 92%);
  boss fight grows 53 s (T1) to 116 s (T4) to 375 s (T11); it only fails at T13 (and cleared T15 in another run, so
  single runs are noisy). The design intent was "Tiers 2 and 3 must still push back", which is not true for this
  gear level.
- **Likely causes:** (1) evasion: about 50% of all hits avoided by a level-13 caster is very strong (the constant
  250 is low); (2) early-tier easing plus a slow +16% life / +10% damage per tier compounds too weakly against a
  character that outgrows it with rare drops and crafting; (3) 15 crafted rares by level 13 means gear
  outpaces the ladder. Needs confirming: whether evasion applies to boss and projectile hits.
- **Options to discuss:** raise the evasion constant or cap it lower early; steeper per-tier damage; tie some
  monster stats to monster level vs player level (a real level gap would then matter); remove or shorten the
  early-tier easing; or accept a gentle start and make the atlas depth (tier gating) carry the difficulty.

## Done

- 2026-09-29: Six freely assignable skill slots with RMB, drag-and-drop swaps, and stronger rare/magic mobs
  deployed as `20260929-193742-2bcfd46`. Global chat, chat party invites and party-avatar menus queued in P0.4.
- 2026-09-29: Completed phase 2 of the balance overhaul and immediate XP on kill. Map HUD includes implicit
  modifiers and the map-level resistance penalty. Protocol 3 refreshes clients with old shared rules.
- 2026-09-29: Added the authoritative monster level to the top-right map HUD and compact readout. T1 remains
  level 4 (owner confirmed). Raised client compatibility to protocol 2 so pre-balance tabs reload on reconnect
  instead of keeping old tooltip rules. Build, all 1,774 always-on tests and wide/compact visual checks pass.
- 2026-09-29: UI type scale raised to 14 / 16 / 19 / 28 px and deployed to prod.
- 2026-09-29: Committed the font change, roadmap, balance phase 1 and all 21 `src/data/` files; anchored the
  runtime-data ignore rule to `/data/`. A fresh clone now installs and builds successfully.
- 2026-09-29: Deployed balance phase 1 and the short-window Map Device picker fix as
  `20260929-182502-e64cfd2`. Production database backed up and integrity checked before activation;
  server and public health checks passed. Phase 2 remains open for real-player feedback.
