# D. Territory: area-bound maps, chart-driven drops, surge, beacons and hand-crafted areas

**Status: slices T0 (bound maps + migration), R1 (chart-driven drop routing), U1 (chart and dock UI, since reworked into the area modal, see "Area modal as built"), P1 (pins, Re-chart, Recycle, Rook maps), S1 (area-bias scarabs), G1 (daily surge), B1 (beacons and sigils, see "B1 as built") and E1 (anchor-aware events, see "E1 as built" in 10.5a) are built; everything else here is still design.**

**B1 as built (beacons and sigils).** Where it differs from or fills in sections 6, 9, 11 and 12:
- Files: `src/data/progression/territory.ts` (every beacon and sigil number, the `SIGILS` registry, `sigilEffectText`), `src/data/progression/atlas-chart.ts` (`ATLAS_POS` moved out of `art/atlas/geometry.ts`, which re-exports it, so the rules can measure chart distance), `src/game/progression/territory.ts` (pure rules), `src/ui/atlas/BeaconPanel.tsx` (the beacon section of the area modal), the Territory lens in `lens.ts` / `lens-draw.ts` / `Atlas.tsx`. Tests `tests/game-progression/territory.test.ts`, `tests/server/territory.test.ts`, `tests/net/territory-messages.test.ts`, `tests/atlas/{area-modal,lens}.test.ts`.
- **Protocol 27:** 36 sigil currency ids appended (`SIGIL_IDS`, `<kind>Sigil<1..3>`), `slotSigil { areaId, slot, uid }` and `unslotSigil { areaId, slot }` (hideout only, one save for the backpack and the account Atlas). `atlas.beacons` slots are `{ sigilId, uses, max }` (`max` = the uses it was slotted with, so "never used" is exact); no `SAVE_VERSION` change (additive, normalised: completed areas only, slot counts, uses clamped).
- **No SigilPicker** (AGENTS.md inventory first): a beacon slot is a panel-owned drop target (`data-slot="beacon:<i>"`) in the area modal of a cleared area; sigils are dragged out of the inventory, Ctrl/Cmd-click fills the first empty slot, the inventory highlight lights sigils while the open area has a free slot. Stashed sigils move to the inventory first.
- **Uses:** a sigil spends a use only when its effect applied to the run (`sigilApplies`: Omen needs a random encounter roll, Hoard a dead-end or sealed area, Ingredient boss ingredients at the tier, Survey a non-sealed area, Tide a spent charge, theme sigils their theme). Taking a sigil out returns it only when `uses === max`; otherwise (and when another sigil is dropped onto it) the modal confirms that it is consumed. A burnt-out slot is named in the activation message.
- **Frozen:** `RunSetup.territory: { sigilId, fromAreaId, slot, share }[]`; the effects are recomputed from the data on restore (like the tree). `TreeContext.territory` carries them into `mapModifiers` (Fortune, Hoard, Ingredient as `Territory: <sigil> (<beacon>)` sources), `currencyWeightsFor` and the loot class weights (theme sigils), the event slate (`territoryChance`, Omen, capped at `MAP_EVENT_MAX_CHANCE` and outside the tree's cap) and `atlasCreditFor` (`revealBonus`, Survey). Server-loss refunds give the uses back per slot (`refundTerritoryUses`).
- **Tide:** Faint multiplies the surge bonus (37.5% / 18.75% at full strength), Bright and Blazing add `TIDE.charges` to `surgeMaxCharges` of every covered area (the strongest counts once), Blazing rolls its own keep chance on the second stream of `surgeKept` (Afterglow keeps stream 0). Two Faint Tides: the second at half strength (x1.125).
- **Tree:** Survey Stake `beaconRadius +20` (was scarab chance), Lamp Oil gains `sigilUses +3`, new notable **Lightkeeper** (`beaconSlots +1`, ring 7 lane 2.8 beside Fifth Socket; it cannot be refunded while a second slot holds a sigil). Not done here (left to the tree pass): Milestone/Signpost pin slots, Charter Ink, Chart Keeper's x4, Far Horizon, Master Surveyor's chest rule, Wagered Charts, the theme seals' routing weight.
- **Drops and Rook:** final bosses from Tier 3 on their own rng stream (`0x5349474c`), so no other drop moves; Rook's staples gain the Faint sigils (`sigil-<id>` offers, Maps shelf of the vendor grid). No sigil crafting.
 As built, where T0 differs from or
fills in the text below:
- `MapItem` also carries load-only `unbound?: true` (a legacy map wearing a provisional binding until the account's Atlas is known) and
  `migrated?: 'theme' | 'fog'` (the one-time tooltip note); `rechart?` is typed for P1. `bindLegacyMaps`, `bindLegacyChoice`,
  `areaForTheme` live in `src/game/progression/map-binding.ts`. `SAVE_VERSION` is 2; `PROTOCOL_VERSION` is 20.
- `openMap(ch, { lootClass?, passage?, useSurge?, now? })`; `RunSetup.passage` is set, `routing`/`surge`/`territory`/`layoutV` are typed and unused.
  `restoreRunSetup` does not carry the unused fields through: R1/G1/B1 must copy theirs there.
- Passage UI: chips in the dock (a key held in the *inventory*, or "Open the Pit of Echoes"), not yet the drag-in passage slot of section 3. U1 replaced them with the drag-in passage slot, and the Atlas UX rework moved that slot into the modal of the sealed area / the Pit ("Area modal as built").
- Drops still roll the theme exactly as before (same rng draws); the area is derived from it without rng: discovered same-theme area accepting the tier,
  else any discovered area accepting it, else the shallowest fit next to the chart. R1 replaced this with the routing table (kept only for runs frozen without one).
- Rook sells a theme's T1/T2 rows only when a discovered same-theme area accepts the tier (bound by a hash of the offer id); P1 reworks the stock. **Superseded:** Rook now sells maps only through his luck-driven wares board (GAME_SPEC §9, "Rook's wares"); the Maps tab and its offer rows below are gone.
- Void Needle's tier-up keeps its odds; at the area's ceiling the map moves to a deeper area of its theme.
- Tree nodes assuming "any map anywhere" that need a re-role (not rebalanced in T0): Milestone, Trailmark, Cartographer's Pen, Signpost, Charter Ink,
  Survey Stake, Lamp Oil, Chart Keeper, Far Horizon, Master Surveyor, Lantern-Bearer, Wagered Charts and the six theme seals (all as listed in section 9).

**R1 as built (drop routing).** Where R1 differs from or fills in section 4:
- Files: `src/data/progression/routing.ts` (every constant), `src/game/progression/map-routing.ts` (pure rules), `makeMap` in `loot.ts`
  (the only drop entry point; signature is now `makeMap(ctx, rng, m, quality, { offset?, area?, pending? })`), `openMap` and `restoreRunSetup`
  in `runs.ts`, tests `tests/game-progression/routing.test.ts`, harness `routing-harness.ts` and `routing-balance.test.ts` (BALANCE=1).
- `RunSetup.routing` is filled by `openMap` (`buildRouting`) and restored by `restoreRunSetup` (`normalizeRouting`: junk dropped; absent = a run frozen
  before routing keeps the old theme roll). `MapRouting.candidates[]` gained optional `kind` (`own | neighbour | deadEnd | wander | pending | pinned`)
  and `pinned`; `from` is the map's bound area (a passage run keeps it). `routing.advance` is computed for the map's own tier.
- Exactly ONE rng draw picks the addressee (the draw that used to pick the theme), also for a chest upgrade (the target is forced, the draw is burned), so the
  stream after a chest or a boss is identical with and without routing (tested). A table with nothing eligible for the looter falls back to the T0 theme roll.
- Loot is per looter: the frozen table is filtered by the looter's own chart (a pending area is allowed on boss/chest drops, as is the run's own area).
  The chest advance target is walked over the looter's chart plus the pending areas.
- Event rewards: the Caravan "cartographer's tube" map is an upward roll without pending areas. The lieutenant's map is an ordinary roll (no pending).
- Pending areas are `discoverAfterBoss(atlas, area, false, { revealRoll: 1 }).revealed` minus the run area and non-addresses (the Pit takes a reveal slot but is
  never a candidate); candidates list normal areas in `ATLAS_AREAS` order, then pending ones in reveal order.
- **Hook points.** `RoutingBias` (typed, default neutral) is the one place P1 and S1 plug in: `routingBiasFor(atlas, scarabs)` returns it (P1 reads
  `atlas.pins` there and sets `pins`/`pinMultiplier`; S1 sets `weightMultiplier(area, kind)`, `tierOffsets` and `chestUpgradeBonus`). `buildRouting` applies
  pins first (`max(base, 0.5) x multiplier`, any distance, discovered only), then `weightMultiplier`.
- **Readout.** `routingReadout(routing, tier, discovered?)` returns rows (`areaId`, `name`, `kind`, `pinned`, `weight`, `ceiling`, `share`, `bossShare`,
  `upwardShare`, `pending`), `groups` (own / neighbours / wander / pinned), `advance(+Name)` and ready-made `lines`; U1 renders it, nothing is pushed into `setup.summary`.
- **Measured** (60 seeds per cell, real loot rules; full table with `BALANCE=1 npx vitest run tests/game-progression/routing-balance.test.ts`): about 7.5 maps per run
  (about 37 an hour at the spec's 5 runs/hour; identical with and without routing, I1; the harness model is a little richer than the spec's 6 per run), own area 12 to 22% late and 35 to 45% while the chart is thin, neighbours 55 to 80%,
  wander 5 to 15%; "ladder bot" (always run the best map held) first Tier 15 run: mean 22.0 runs vs 20.5 pre-routing (+7%), 300 of 300 seeds arrive, longest stretch without
  a better map in hand 10 runs. The first-pass constants stay: the sweep (pending 1.5 to 3, wander 0.15 to 0.3, own 0.5 to 1.0, neighbour 1.5 to 2.0) moves the ladder by under 1%.
  Dead ends at their ceiling (Hollow Ossuary T5, Ember Vault T3) drop almost no deeper map themselves (0.2 per run); the path out is their neighbour (4.9 maps per run), tested as
  "from every area a deeper area is at most 3 drops away".

**S1 + G1 as built (area-bias scarabs and the daily surge).** Where they differ from or fill in sections 5.6 and 7:
- Files: `src/data/scarabs.ts` (7 families x 4 tiers, `AREA_SCARAB_SHARE`, `AREA_SCARAB_OWN_CAP`), `src/game/progression/scarab-routing.ts` (the `RoutingBias` the loaded scarabs make, `composeRoutingBias`, readout lines), `src/game/progression/surge.ts` (clock, ledger,
  spend, refund, refill), `src/data/progression/territory.ts` (every surge number; beacons append their own), `src/ui/atlas/{SurgePips.tsx,surge-view.ts}` and `src/ui/styles/surge.css`, tests `tests/game-progression/{area-scarabs,surge,surge-economy}.test.ts`,
  `tests/server/surge.test.ts`, `tests/net/surge-messages.test.ts`, e2e `npm run e2e -- --only surge`. `PROTOCOL_VERSION` is 22 (`refillSurge`).
- **Hook additions** (`RoutingBias`, still data-driven): `reach(area)` lets a scarab bring a charted area into the table at any distance with a base weight (Hearthbound, floor 0.5) and `finalize(candidates)` is the last word on the finished weights (Homing's own-area cap).
  `routingBiasFor(atlas, scarabs, { from })` takes the map's bound area for the theme. Quarry multiplies every dead-end candidate (a neighbour or two hops away); Wayfarer every `neighbour` (never a dead end); Deepward renormalises the tier ladder so its upward share is exactly 20/28/36/45%.
- **Homing cap:** the own area's share is limited to 70% unless pinned: with only the multiplier a dead end with one neighbour reaches 77% (Homing IV); charts with real neighbours stay at 53 to 67%. Tested on every area at the late and the frontier chart.
- Scarab sources: drops only (40% of scarab rolls, equal split among the five families). Rook does not sell scarabs and nothing crafts them.
- `OpenMapOptions.useSurge` is spent by `spendSurge` inside `openMap` (the character returned carries the updated Atlas); no `now` means no surge. `RunSetup.surge` gained `kept?: true` (Afterglow: bonus applies, nothing was spent, nothing is refunded) and is carried by `restoreRunSetup`.
  `GameServer.now` is the clock (already injected); the server refunds through `refundMapItem` (same transaction as the map, key, Scrap and scarabs) and only on the same forge day.
- **Loot:** `lootLuck` includes the surge (HUD = sim); `lootLuckWithoutSurge` feeds guarantees, the chest and event rewards; `chancesFrom` divides the surge quantity out of the Map category. Hourglass rolls use forked rng streams (salts in `loot.ts`), so no other drop moves.
- **Sand use** is the area modal's "Refill surge" button (the chart node is the target pick) and the chart status line's "Refill all" for the Grand Hourglass (they were the rail's and the dock's before the Atlas UX rework): both send `refillSurge` (hideout only). No drag onto the canvas: the inventory-first rule is kept, the item stays in the inventory until used.
- **Tree:** Lantern-Bearer (Second Wind, 4.0u, now `live`), Lamp Oil (+1 charge on dead-end and sealed areas, 1.0u; its sigil-uses half waits for B1), Cartographer's Pen (Afterglow, 1.0u), Trailmark (+50% Sand chance, 1.0u); new stats `surgeCharges`, `surgeKeep`, `sandChance` (priced in `UNIT_RATES`).
  Not touched: Milestone/Signpost (pins), Survey Stake, Charter Ink, Chart Keeper, Far Horizon, Master Surveyor, Wagered Charts, the seals. The Boss Butcher bot's filler gained `bridge` so the acceptance band stays met with three cartography smalls re-roled.
- **Measured** (BALANCE=1 `surge-economy`): a boosted run is +8 to +14% (mean +10%) because only ordinary kills are boosted (the spec's +18 to +24% expected more); Sand about 9.5% of runs and 3 to 4% of a run in value for a player who spends it. See GAME_SPEC §7 "Daily surge".

**U1 and P1 as built.** Where they differ from or fill in sections 3, 5 and 11:
- Files: `src/ui/atlas/{lens,lens-draw,passage,PassageSlot,PinTray,RechartPopover,SourcesPanel}.ts(x)` (new), `Dock.tsx`, `Rail.tsx`, `model.ts`, `render.ts` (one call into `drawLensLayer`), `src/ui/panels/{Atlas,MapDevice,CraftingBench,Merchant,MerchantMaps,MapRecycle,StashSpecial}.tsx`, rules in `game/progression/{map-services,merchant,atlas}.ts` and `game/items/bench.ts`, data in `data/items/bench.ts` (RECHART, RECYCLE) and `data/progression/{merchant,routing}.ts` (ROOK_MAP_*, pin slots).
- **Protocol 21:** `pinArea { areaId, pinned }`, `benchRecycle { uids[3], areaId, expectedScrap? }`; Re-chart is the existing `benchCraft` with recipe `bench:rechart:<areaId>` (one bench service per legal neighbour, quoted `expectedScrap`); Rook's maps are `buyOffer` with `map:<areaId>:<tier>:<grade>` (generated, not in `merchantOffers`; the UI reads `rules.rookMapAreas` / `rules.rookMapOffers`).
- **Passage slot:** a real drop target but not an item location: `Local.slots` + `data-drop="slot" data-slot="passage"`. The key stays in the inventory; the slot records the choice (the key is spent with the map at activation). The same registry serves the bench's recycle slots (`recycle:0..2`). No new `ItemLocation`, no server state.
- **Pins:** `pinSlotCount(nodes)` is 3 plus the sum of `pinSlots` tree effects (the stat itself ships with the tree re-roles; until then it is 3), at most 5; Chart Keeper's x4 is `pinMultiplierFor`. `routingBiasFor` composes `pinBias(atlas)` with S1's scarab bias. A respec that removes a slot node trims `pins` in `setMapTreeNode`.
- **Rook maps (superseded by the wares board; the Maps tab, area chips and grades no longer exist, one plain Normal quality-0 map of an open area is always in stock):** the starting area is always on sale (T1 Plain free) so nobody is map-locked; every other area needs `atlas.completed`; dead ends, sealed areas and the Pit are never sold.
- **Re-chart** may be run on a map in the work slot, on the bench or in the device (the dock button), from one popover; **Recycle** takes inputs from the backpack, stash tabs, Map Stash or work slot (never the device) and files the result in the backpack (no room: nothing happens).
- **Lenses:** `Stock` (badge per node, tinted by the Map Stash's tier bands) and `Sources` (arrows plus share labels and a table, all from `routingReadout`); `Territory` exists in `LENSES` with `available: false` (a hidden stub for B1). The Map Stash groups by area (chart region order, then depth).
- Not built: the item tooltip's own Re-chart entry (the dock chip and the bench cover it), an `area:` search operator (the stash search already matches the area name in the tooltip text).

**Area modal as built (Atlas UX rework, supersedes the dock and the rail of sections 3 and 11).** The owner found the global dock (map slot, scarab sockets, price readout, Activate) confusing, so the interaction moved into the area. Where it differs from the text above:
- **Flow:** the chart window keeps only global things (tabs, lenses, pin tray, tier ruler, key chips, zoom, a slim status line with the open expedition, "Enter the portal", the surge countdown and "Refill all"); the map slot, scarab sockets and Activate are gone from it. **Clicking an area opens its modal** (`AreaModal.tsx`): hero band (boss and family sprites on the theme floor, status, tier ceiling, surge pips, pin toggle) and the facts; the **map slot** (large, centre) ringed by the four scarab sockets, the **passage slot only for sealed areas and the Pit**, the map's readout with Re-chart and Take out, the surge Hold row, a live readout (quantity, rarity, monsters, danger, encounters, scarab effects, Next drops, a Full readout) and the rail's old sections (fights, what it pays, what can happen, entry, your maps); footer with the price, the **Open area** button and the reason it is disabled **always in words** (`openAreaBlock`: no map, wrong area, tier above the ceiling, key missing, the rules' own preview error such as a missing fee).
- **Inventory first:** the modal opens beside the inventory (the existing side-by-side layout). Items are dragged in; Ctrl/Cmd-click quick-loads (a quick load with no modal open opens the map's own area, then loads it; scarabs need a modal). `Local.fits` (a signal of backpack uids) draws a quiet green ring on the items that fit the open modal (`fittingUids`: this area's maps and the maps a passage can carry there, scarabs with a free socket and no socketed family, a sealed area's key). It is a highlight, not a picker; no stash drawer or list was added.
- **Bound maps:** `mapFit(map, area)` decides what a slot takes: the map's own area; any map up to a sealed area's ceiling through its key; a Bounty map bound beside the Pit through the Pit. A refusal reads "This map opens <home>." (a drag-over shows it in red under the cursor) and the slot's new `SlotHandler.onRefused` hook raises the modal's red notice with **Go to <home>**, which moves the map into the device and switches the modal, so the map stays in the slot of its own area. A map already in the device that belongs to another area (quick load, an older session) gets the same notice with Take it out.
- **Passages:** the passage slot is a real drop target (`data-slot="passage"`) only in a sealed area's modal and takes only THAT area's key; the Pit's slot is a lit indicator (a Bounty map of Iron March opens it; there is no click to take the Pit any more because the Pit has its own modal).
- **No map:** "No map for this area" with `whereToFind`: the charted areas whose expeditions drop it (the Sources data read backwards, same `buildRouting` + `routingReadout` the server rolls with), Rook's stall, the Map Stash count (move maps to the inventory first), and the Crafting Bench (Re-chart from a neighbour, Recycle), each a link that opens the panel or switches the modal.
- **Repeat last setup:** `localStorage` `foe.atlas.setup.v1` keeps, per area, the scarab ids and the key of the last Open area; the button appears only when `setupPlan` finds some of it still in the backpack and fills only those sockets.
- **Activation:** Open area is the existing `activateMapDevice` command (no protocol change; `PROTOCOL_VERSION` is untouched). The modal closes when the portal appears (the activation watcher's pulse); `setOpeningArea` tells the watcher which area to flare. The Atlas **stays open** after a successful open (the client no longer closes the panel on `activateMapDevice`): the node flares, and the status line offers "Enter the portal". An open portal of another expedition is explained in the footer and still confirmed by the "Open a new area" dialog.
- **Keyboard and focus:** `role="dialog" aria-modal="true"` labelled by the area name, focus lands on the dialog, Tab cycles inside it, Esc closes the modal first (a re-chart popover or a dialog on top takes it before), Enter or E opens the area when ready, focus returns to the area's node when the chart was driven by keyboard. The chart is `inert` behind the modal.
- **Layout:** the modal fills the table body and sits beside the inventory at 1280x720 (two columns: device left, readout and area info right) and 1024x600 (one column, smaller ring, no sprite stage, a one-line readout under the map card, the footer pinned). `e2e --only modal` asserts that the modal and its footer fit beside the inventory.
- Files: `src/ui/atlas/{AreaModal,AreaInfo,ReadoutDetail,PassageSlot}.tsx`, `area-modal.ts` (pure rules), `readout.ts` (the preview, the Sources table), `SurgePips.tsx` (`SurgeBar` on the chart, `SurgeHold` in the modal), `src/ui/panels/{MapDevice,Atlas}.tsx`, `src/ui/styles/atlas.css`; `Dock.tsx` and `Rail.tsx` were deleted. Tests `tests/atlas/area-modal.test.ts`, e2e `--only modal` plus the atlas, scarabs, territory, surge, tree, events, uniques, economy, maps and core flows, all driven through the modal.

Design only below this line. Sits beside `A-atlas-visuals.md` (the chart), `B-atlas-tree.md` (the Codex) and
`C-map-events.md` (Event Director v2). Owner decisions 1 to 6 are final and are implemented as written; this brief makes them
buildable. Section 13 is the slice order with file ownership.

## 0. One-page summary

1. **A map item is bound to one Atlas area.** `MapItem.areaId` is new; `baseId` (theme) is always `area.baseId`. Tier, quality,
   mods, corruption, bounty, charting and scarabs stay on the item. Activating a map runs exactly that area. The Device stops
   asking "which area?" and starts showing "where does this map live?".
2. **Drops follow the chart.** Every map drop picks an area from a frozen per-expedition table: the cleared area itself
   (lower weight), its discovered neighbours (higher), a thin "wander" tail, your pins (x3) and scarab biases. Total map
   volume per run does not change; only the addressee does. Upward tier rolls and the completion-chest upgrade go to deeper
   areas (the tier ceiling does the work).
3. **Targeting tools:** 3 pins (x3 weight), Re-chart (Scrap bench service, neighbour, same tier, keeps everything), Recycle
   (3 maps of a tier -> 1 map of a neighbouring area), Rook sells T1-T2 maps of cleared areas by tier and quality, five
   area-bias scarab families.
4. **Beacons:** every cleared area becomes a beacon with 1 to 2 slots; a slotted **Sigil** (12 kinds, 3 strengths, 12 uses)
   gives a regional modifier to every area within a chart radius.
5. **Surge:** 3 charges per area per day per account, reset 04:00 UTC by the server clock; a run spends one at activation
   for +30% quantity and +15% rarity. Out of charges the area is fully playable at the normal rate. **Hourglass Sand**
   (refill one area) and **Grand Hourglass** (all areas) are rare drops. Nodes show charge pips.
6. **Areas are hand-crafted.** Each of the 25 areas gets one fixed layout (landmarks, walls, cover, spawn lanes, boss stage,
   event anchors, optional fixed start). Per run the seed varies only packs, events (which anchor), rare spawns and loot.
   Chart placement stays hand-authored (`ATLAS_POS`), reseedable per league later.

Design invariants (tests enforce them, section 12):
- **I1** Map supply per run is unchanged by routing (only the area label moves). Surge quantity is NOT applied to the map
  category, so the daily clock never changes map volume.
- **I2** Nobody loses a map in migration; nobody skips fog (a map of an undiscovered area cannot be opened).
- **I3** Every number shown in the UI is computed by the same function the sim uses.
- **I4** The ladder is preserved: tiers still cost clears; the tree never touches tier or monster level.
- **I5** Everything an expedition needs (table, surge, sigils, pins, scarab bias) is frozen into `RunSetup` at activation
  and persisted with it; a restart or party join cannot change it.

## 1. Audit: what the code does today

**Map items.** `MapItem` (`src/contracts/items.ts`) has `baseId` (one of six themes), tier 1 to 15, rarity, mods, quality,
corrupted, `bounty`, `charted`, `twinInked`. It has no area. Drops pick `baseId` uniformly (`pickMapBase` in
`src/game/progression/loot.ts`), tier by `MAP_DROP_TIER_OFFSETS` (same 60, lower 25, higher 15), rarity by
`MAP_RARITY_WEIGHTS`, quality 25% of the time 1 to 10. The completion chest guarantees one map (75% same tier, 25% +1,
Compass forces +1, Far Horizon +10 pp) plus 50% for a second random map. Map category base chance is 0.5% per kill times
quantity (`CATEGORY_CHANCE.map`), then x map drop chance from tree/quality.

**Activation.** `openMap(ch, areaId?, lootClass?)` (`src/game/progression/runs.ts`) takes the area from the UI, checks
`atlasAccessError` (discovered, tier <= ceiling), `requiresBounty`, `chosenClass`, consumes the sealed-area key and the
territory fee (`territoryEntryFee`), snapshots the map, draws the seed from the character rng, resets `respecSpent`. The effective
map keeps tier/quality/mods but takes the area's theme. `RunSetup.atlasAreaId` records the area; `sourceMap` keeps the
original for refunds. `restoreRunSetup` rebuilds from the persisted setup. `server/game.ts activateMapDevice(areaId, lootClass)`
is the only entry.

**Atlas.** `ATLAS_AREAS` (25) with depth, neighbours, ceilings (`1 + 2 * depth` capped 15, exceptions for side areas),
sealed/deadEnd flags, `arenaScale`, weights, encounters. Account projection `AtlasProgress` (discovered, completed, nodes,
points). `discoverAfterBoss` reveals `ATLAS_REVEALS_PER_BOSS = 2` undiscovered non-sealed neighbours in fixed order (+ Master
Surveyor fractional extra, +1/8 rare door). Keys: `ATLAS_KEYS`.

**Arenas and props (the question "is the scatter deterministic per area?").** `layoutMap(w)` in `src/sim/props.ts`:
- Arena is a circle, `arenaRadius = MAP_BASES[baseId].arenaRadius * (area.arenaScale ?? 1)` (`buildRunConfig`). Base radii:
  Ashen Forge 900, Rimed Ossuary 900, Cinder Chapel 800, Choral Crypt 850, Chainworks 700, Iron Coliseum 650. Players spawn at
  (0,0) with a 140 u clear disc; view is 680 x 400 u.
- **Theme set pieces:** Cinder Chapel, Choral Crypt, Chainworks and Iron Coliseum place *fixed* formula pieces (two pillar
  aisles; a 10-stone ring at 0.55 R; two hauling rows; a 12-pillar ring at 0.6 R): deterministic, identical for every area of
  that theme, scaled only by R. Ashen Forge (stone circles) and Rimed Ossuary (crystal clusters) place pieces with
  `worldRng`, so they differ per seed.
- **Scatter:** `pi R^2 / 16000` props (about 160 at R 900) from a weighted decor table, positions from `worldRng`. So **no: the
  prop scatter is per seed, and identity per area is only theme + radius.** Six Ashen Forge areas are the same place
  at five sizes with different random stones.
- **Packs:** `placePacks` (`src/sim/waves.ts`) walks a golden-angle spiral with a random rotation, filters by distance to
  players, shuffles. The boss arrives at `pointAway` (the side away from the party). Nothing in the layout is authored: no
  lanes, no stage, no anchor for events (events use radial random rules, C 6.x).
- Everything draws from the same `worldRng` stream, so any change to layout consumption shifts pack placement; golden digests
  must be regenerated once (section 13, slice L1).

Consequence: Atlas areas currently differ by numbers, not by place. Decision 6 is a content project, not a tweak; section 10.

## 2. Data model and contracts

### 2.1 Map item
```ts
// src/contracts/items.ts
export interface MapItem {
  ...existing;
  /** The Atlas area this map opens. Always present after migration; baseId === findAtlasArea(areaId).baseId. */
  areaId: AtlasAreaId;
  /** How many times Re-chart has moved it (raises the next Re-chart price; tooltip shows "Re-charted x2"). */
  rechart?: number;
}
```
- `normalizeMap(raw, uid)` accepts a missing `areaId` (legacy) and returns it unbound (`areaId` undefined during load only; the
  type stays `AtlasAreaId` via a `LegacyMapItem` input type). `bindLegacyMaps` (2.6) fixes it in the same load pass. A map whose
  `areaId` is unknown is treated as legacy. After binding, `baseId` is forced to `area.baseId`.
- `createMapItem(areaId, tier, uid)` replaces `createMapItem(baseId, ...)`; `rollMapWithRarity(rng, areaId, tier, ...)`.
  `mapTitle` becomes `"<Area name> map"`; the map icon stays `iconIdForMap(baseId)` with a small area-ring and tier plate (A).
  `describeMap` leads with `Area: Furnace Yard (Forge)  Accepts up to Tier 5`, `Territory fee`, `Surge 2/3 today` (live, from the
  viewer's atlas when available), then the existing lines.
- Item stacking/tooltips, trade offers, stash tabs, `mapStash` and the Crafting Bench keep working: they only read the item.
  Sorting in the map stash: by region order then tier desc (new `mapSortKey`).

### 2.2 Activation and RunSetup
```ts
// src/contracts/game.ts
export interface RunSetup {
  ...existing;
  /** The area actually run: map.areaId, or the passage destination (key / bounty). */
  atlasAreaId?: AtlasAreaId;
  /** Set when a passage redirected the map (sealed key, Pit of Echoes). sourceMap.areaId is the bound area. */
  passage?: { kind: 'key'; currencyId: CurrencyId } | { kind: 'bounty' };
  /** Frozen drop routing for every map this expedition drops (2.4). Persisted; absent on legacy runs (old random behaviour). */
  routing?: MapRouting;
  /** The surge charge spent, or absent. quantityMore/rarityMore are the numbers used (tree/sigils can change them). */
  surge?: { areaId: AtlasAreaId; quantityMore: number; rarityMore: number; day: number };
  /** Sigil effects applied (opener's beacons in range), for the readout and the use ledger. */
  territory?: { sigilId: SigilId; fromAreaId: AtlasAreaId; effects: MapEffectDef[] }[];
  /** Layout edition run; tests and the client pick the same layout file from atlasAreaId. */
  layoutV?: number;
}
export interface MapRouting {
  from: AtlasAreaId;
  /** Candidate areas with final weights (pins, scarabs, tree already multiplied in). Tier ceilings are data, looked up live. */
  candidates: { areaId: AtlasAreaId; weight: number; pending?: true }[];
  /** Chest "advance target": nearest discovered area accepting tier+1, preferring pinned ones; absent if none. */
  advance?: AtlasAreaId;
  /** Upward tier roll weights after Deepward scarabs: offsets and weights. */
  tierOffsets: { offset: number; weight: number }[];
  chestUpgradeBonus: number; // pp from Deepward scarab
}
```
- `openMap(ch, opts: { lootClass?, passage?, useSurge?: boolean, now: number })`: **no `areaId` argument.** Steps: map present and
  bound; `atlasAccessError(progress, map.areaId, map.tier)` (discovered and tier <= ceiling); passage resolution (2.5); Bounty
  check for Pit of Echoes via passage; `chosenClass`; key + fee as today (fee uses the *run* area); surge (section 7);
  territory effects (section 8); routing table (section 4); seed; return updated character **and updated account atlas**
  (surge ledger, sigil uses, respec reset, all in the existing single save transaction).
- The fee stays tier-priced (`territoryEntryFee`). `entranceScrap`, `entranceKey`, restart refunds stay. The server-loss refund
  also restores the surge charge and sigil uses (the ledger entries are carried in `RunSetup.surge/territory`, so the
  refund is exact; ordinary deaths and abandons refund nothing, as today).
- `activateMapDevice(s, opts)`; wire message gets `{ lootClass?, passageKey?: CurrencyId, pit?: true, useSurge?: boolean }`; protocol
  bump (`PROTOCOL_VERSION` +1). The old `areaId` field is ignored for one protocol version by the server when present and
  equal to the bound area (mismatch -> error), so a stale client gets a clear message instead of a crash.

### 2.3 Account state (`AtlasProgress`, all optional, all normalised like today)
```ts
pins?: AtlasAreaId[];                                   // <= pinSlots(nodes), default 3; discovered non-sealed only
surge?: { day: number; spent: Partial<Record<AtlasAreaId, number>> };   // day = forge-day index (7.1)
beacons?: Partial<Record<AtlasAreaId, ({ sigilId: SigilId; uses: number } | null)[]>>;  // slots; key = cleared area
rechartSeen?: true;                                     // first-use tooltip flag
```
`normalizeAtlas` clamps: pins to known, discovered, unsealed, unique, at most the slot count (drops the tail when a respec
removes a slot node); `surge.spent` to `[0, maxCharges]`; `beacons` only for completed areas, slot count <= slots(area).
`SAVE_VERSION` +1 only for the map-binding migration (2.6); the account fields are additive.

### 2.4 Content registries (data files, no code in UI)
- `src/data/progression/routing.ts` (new): all weights/constants of section 4 and the Rook price table of 5.4.
- `src/data/progression/territory.ts` (new): `BEACON_RULES`, `SIGILS` (12 kinds x 3 strengths), radius and slot rules, use counts,
  surge constants (`SURGE_CHARGES = 3`, `SURGE_RESET_UTC_HOUR = 4`, `SURGE_BONUS = { quantityMore: 30, rarityMore: 15 }`,
  Sand/Grand Hourglass rates).
- `src/data/scarabs.ts`: `family` becomes a string union (`'haste' | 'invasion' | 'homing' | 'wayfarer' | 'deepward' | 'quarry' |
  'hearthbound'` and B's families); `SCARAB_IDS` generated per family x 4 tiers. One registry, owned by the scarab slice.
- New currency ids in `src/contracts/content.ts` (generated const arrays like `SCARAB_IDS`): `hourglassSand`, `grandHourglass`,
  and `SIGIL_IDS` (36). Stack sizes: Sand 20, Grand 5, Sigil 20. All tradeable, all have a drop source (8, 9, 10).

### 2.5 Passages (how sealed areas and the Pit keep working)
Areas reached by a key or a commission are not map addresses. A **passage** redirects the loaded map to a destination at
activation, consuming the key with the map in one transaction (today's behaviour, now explicit):
- **Key passage:** a loaded key (`ATLAS_KEYS`) offers its sealed area when `map.tier <= ceiling(sealed area)`. Any map works; the map's
  own area is bypassed (shown crossed out, with its name in the readout so the player knows what they spend). Surge charges
  and beacon ranges use the destination.
- **Bounty passage:** a map with a Bounty commission bound to **Iron March** offers "Open the Pit of Echoes" (its only chart
  neighbour); bound elsewhere it does not. Pit of Echoes maps are never dropped (excluded from routing).
- Sealed and Pit destinations stay discovered-gated exactly as today (`discovered` includes them through the rare-door roll).

### 2.6 Save migration (existing map items)
One pass, after the account atlas is known, in `loadSave` (`src/game/progression/save.ts`): `bindLegacyMaps(character, atlas)`
visits every place a map can live (backpack grid, stash tabs, Crafting Stash, `mapStash`, `mapDevice`, trade offers owned by
the character, persisted run `sourceMap`s that lack a bound area). For each unbound map:
1. Candidates = discovered, non-sealed, non-Pit areas with `baseId === map.baseId` and `ceiling >= map.tier`.
2. If none: discovered, non-sealed, non-Pit areas with `ceiling >= map.tier` (any theme), smallest ceiling first, then nearest
   to the start by depth. The item's `baseId` becomes the area's; a one-time `migrated: 'theme'` tooltip line explains it.
3. If still none (only possible for a map above anything the account has discovered): bind to the shallowest area with
   `ceiling >= tier` **and add it to `discovered`** (the map itself is the chart fragment; no deeper skip is possible because the
   map was already that tier).
4. Choice inside a candidate set is `hash(uid) % n` over the set sorted by depth then id, so the load is idempotent and stable
   across restarts. No RNG state is consumed.
Also: starter kit becomes `3 x Cinder Crossing T1` (was 2 Ashen + 1 Ossuary; nobody has a second area at creation). Rook's
legacy T1/T2 stock is replaced (5.4). Bounty and `charted` flags travel with the item. `sourceMap` refunds for old runs
restore the map with its legacy base and get bound on the next load. Acceptance test: for a fixture of 500 random legacy maps over
random discovery sets, zero maps lost, every bound area accepts its tier, deterministic, idempotent, and theme is preserved
whenever the account had any same-theme area in range.

## 3. Map Device and dock: "pick a map, see where it lives"

> **Superseded in part by the Atlas UX rework ("Area modal as built" above):** the dock and the inspector rail no longer exist. Clicking an area opens a modal with the map slot, the scarab sockets, the passage slot (sealed areas and the Pit only), the surge toggle, the readout and Open area. The rest of this section (the map is the course, Re-chart, "where your maps come from", lenses) still holds.

Before (A 6.7): the chart picks a "course", the dock takes a map. After: the **map is the course.**
- Slot a map: the chart eases to its home node, draws the route from the start node along discovered edges (brass thread), pulses
  the node, and the rail opens on that area (boss, family, weights, **Surge pips**, beacons covering it, sources of this area's
  maps). There is no "Set course" button. Clicking another node only *inspects* it (rail), with a "You hold N maps of this area"
  line and a **Pin** button.
- **Dock (left to right):** map slot with home chip `Furnace Yard  T5`; scarab sockets (4, 5 with Fifth Socket); **Passage slot**
  (empty by default; accepts a key; auto-shows "Open the Pit" when legal); **Surge chip** `Surge 2/3` with toggle "Hold" (default
  on; turning it off keeps the charge); readout (map-side quantity/rarity including surge and territory lines, fee, event odds,
  expected drop routing, see below); **Activate**.
- **Re-chart** button on the map chip opens a popover listing legal neighbours (name, theme, ceiling, its own surge pips, the price
  in Scrap, your stock of that area); confirming spends Scrap and moves the map in place (the bench service of 5.2, callable from
  both places through the same rules function).
- **"Where your maps come from"** in the readout (new block under Luck): top 4 areas of the frozen routing with percentages
  ("Next drops: Shattered Forge 23%, Glass Sepulchre 23%, Ember Road 23%, this area 16%"), each clickable to light the node.
  The numbers are the exact weights of 4.2, tier-filtered, so a player can read what pins and scarabs do before activating.
- **(Superseded: the Atlas has no stash drawer any more; AGENTS.md "inventory first" rule. Grouping and filtering belong in the Stash panel's Map Stash tab; the table takes maps dragged from the inventory.)** Stash drawer groups maps by area (region order), header chip per area with pips and a count; filter chips by region; a
  search box (`search.ts` already exists for the stash) understands `area:`, `tier:`, `q>10`. Drag from the drawer still slots.
- **Chart lenses** (A's toolbar; three new toggles): `Stock` (count badge per node of maps you hold, tinted by tier mix),
  `Sources` (inspected node shows outgoing drop arrows with percentages, incoming arrows for what drops it), `Territory` (beacon
  rings, sigil glyphs, surge pips everywhere). Default lens: `Stock`.
- **Empty device:** the chart shows `Stock` so the player can decide which map to load by looking at the chart.
- **Hunting Ground** keeps its class picker; **Pit** keeps "Needs a Bounty map". Sealed nodes show their key chip.
- Typography: only the four tokens. Pips are canvas glyphs, not text.

## 4. Drop routing

### 4.1 What the rules are
Each map drop is rolled in two steps, from the expedition's frozen `routing`:
1. **Tier offset** from `routing.tierOffsets` (default `{-1:25, 0:60, +1:15}`, exactly today's ladder). The chest roll uses its own
   upgrade (4.4).
2. **Area**: candidates with `ceiling >= tier' ` where `tier' = clamp(run tier + offset, 1, 15)`:
   - an **upward** roll (`offset = +1`, or a chest upgrade) considers only candidates whose ceiling accepts `tier'`; if none do, the
     offset becomes 0;
   - a **level or downward** roll considers every candidate and clamps each to its ceiling: `tier'' = min(tier', ceiling)`.
   So a T7 run at Shattered Forge can drop a Furnace Yard map, but it arrives as T5 (its ceiling). Deep areas absorb high tiers;
   shallow areas receive lower ones: "the tier ceiling does the work".
3. Quality, rarity, mods are rolled as today (`makeMap(rng, areaId, tier'', m, quality)`).

### 4.2 Weights (first pass; all in `data/progression/routing.ts`)
| Candidate | Base weight | Notes |
|---|---|---|
| The run's own area (`from`) | 1.0 | "clearing an area drops maps of itself (lower chance)" |
| Discovered neighbour (non-sealed) | 1.5 | graph edges of `from` |
| Discovered **dead-end** neighbour | 1.0 | a detour is rarer than a route |
| Wander: discovered non-sealed area 2 hops away | 0.15 | keeps far pins and theme scarabs meaningful and nothing stranded |
| **Pending** neighbour (the next reveal, see 4.3) | 1.5 | boss and chest drops only |
| Pinned area (discovered, non-sealed) | `max(base, 0.5) x 3` (x4 with Chart Keeper) | works at any distance |
| Sealed areas, Pit of Echoes | excluded | passages only (2.5) |

Modifiers multiply candidate weights, then the table is frozen. Scarabs (section 5.6) and Sigils (Survey) act here; the tree's
pin slots/weight act here. Nothing else changes weights, so the readout is explainable.

**Worked example 1: T5 at Furnace Yard, all neighbours discovered, no pins.** self 1.0; Ember Road, Shattered Forge, Glass
Sepulchre 1.5 each; wander: Cinder Crossing, Ember Vault (dead end, 2 hops), Bone Approach, Hollow Ossuary, Crown Foundry, Winter
Throne 0.15 each: total 1 + 4.5 + 0.9 = 6.4. Shares: self 15.6%, each neighbour 23.4%, each wander 2.3%. The 15% upward roll (T6)
filters to ceiling >= 6: Shattered Forge 1.5, Crown Foundry 0.15, Winter Throne 0.15 -> Shattered Forge 83%. So a typical hour
of Furnace Yard at 30 maps: about 4.7 own, 7.0 each of the three neighbours, 0.7 each wander, and nearly all T6 maps are Shattered
Forge's.

**Worked example 2: same, pin Shattered Forge.** Shattered Forge 1.5 x 3 = 4.5: total 9.4: Shattered Forge 48%, self 10.6%,
the other neighbours 16% each.

**Worked example 3: pin Hollow Ossuary (dead end, 2 hops) plus Homing II scarab.** Hollow Ossuary `max(0.15, 0.5) x 3` = 1.5;
self 1.0 x 3 (Homing II) = 3.0; neighbours 1.5 each; total 3.0 + 4.5 + 1.5 + 0.75 (other wander) = 9.75: self 31%, Hollow Ossuary 15%.

### 4.3 Fog, pending reveals and first clears
A boss kill still burns fog: `discoverAfterBoss` reveals up to two (+ Surveyor) undiscovered non-sealed neighbours in fixed order.
The routing table computed at activation includes those same areas as **pending** candidates (weight 1.5) when they would be
revealed, *available only to boss-kill and chest drops* (both happen after the boss dies; ordinary kills never name a fogged
area). A unit test asserts the pending list equals `discoverAfterBoss`'s reveal order. The fractional Surveyor extra reveal and the rare
door are decided by the receipt roll after the run, so they cannot be pending (their areas start dropping next run). If the boss
is not killed, nothing pending drops. Result: first clear of Cinder Crossing reveals Ember Road and Bone Approach *and* the chest
can already hold a map of one of them, which is the "revealed area starts dropping" beat.

### 4.4 Chest and boss drops
- The chest's guaranteed map: upgrade roll as today (25%; +10 pp Far Horizon; Compass forces; Deepward adds pp). If upgraded, its
  area is the **advance target**: the nearest (BFS over discovered non-sealed edges, tie -> pinned, then lower id) area with
  `ceiling >= tier + 1`; absent -> no upgrade, quality +3 instead (Vault at the ceiling is the only early case; the parent
  gets the upgrade next run). Not upgraded: a normal weighted area pick at the run's tier.
- The optional second chest map (50%) and the boss's map drops are ordinary routing rolls.
- **Wagered Charts** (keystone): its always-upgraded, account-bound Rare chest map binds to the advance target; unchanged otherwise.
- Sealed-area completion still pays its special rewards (ingredients, unique pools, keys, guaranteed crowns). Dead ends keep
  `quantityMore`, weights and ingredient drops. Nothing in this brief changes area loot tables.

### 4.5 Expected maps per hour (first pass; the harness measures, section 12)
Assumption from current constants: a T5 to T9 run has about 650 weighted kills (magic x1.5, rare x4 quantity) at 0.5% x 1.45
(typical map-side and personal quantity) + chest 1.5 = **about 6 maps per run**, about 5 runs per hour = **30 maps/hour** (surge
off). With routing, 100% of the 30 are addressed: own area 15 to 25% (4.5 to 7.5/h), neighbours 45 to 65% (13 to 20/h), wander
3 to 12% (1 to 4/h, more with scarabs). One pin yields about 9 to 14 pinned maps/hour (a full player-visible 3x); two pins on
neighbours 6 to 8 each; three pins dilute to about 6 each. Recycling (5.3) converts surplus: 30/hour supply vs about 5 consumed
means 25 are sold down (3 -> 1) or re-charted.

## 5. Targeting tools

### 5.1 Pins
- **Slots:** 3 base, +1 per `pinSlots` tree node (nodes in 9), hard ceiling none (the tree decides). Pins are account-wide
  (`atlas.pins`), persist across sessions, editable at any time (free, instant, no respec cost) and **frozen at activation**.
- **UX:** a pin glyph button in the rail header and on the map tooltip ("Pin Furnace Yard"); a tray of 3 to N pin chips in the
  chart header (chip = emblem + name + tier ceiling; click to focus, x to unpin); pinned nodes wear a brass pin and a soft
  halo on every lens; the dock readout shows pin influence ("Pinned: Shattered Forge x3").
- **Rules:** pins need a discovered, non-sealed, non-Pit area. A pin on a deeper area than anything you can reach is allowed (it
  just sits at wander weight x3 until you get closer: 0.5 x 3 = 1.5).
- Bots: a pinned neighbour reaches at least 40% of drops; pins never create an area that is undiscovered.

### 5.2 Re-chart (bench service)
Shipped as a **Crafting Bench Scrap service** next to "Reroll a chosen map danger mod" and "Commission Bounty" (and as a dock
shortcut), not as a currency item: it needs a target argument, the bench already has target-taking services with previews, and
it does not spawn a new stackable. It is still "cheap and Scrap-priced" as owner decision 3 asks.
- **Move** a map to a **graph neighbour** of its current area that is discovered, non-sealed, non-Pit and whose ceiling accepts
  the map's tier. Same tier, same quality/mods/rarity/bounty/charted/twin-ink; `baseId` follows the new area. Corrupted maps
  rejected (like every map service). A map currently in an undiscovered area may be re-charted to a discovered neighbour (this
  is the rescue path for traded-in maps, I2).
- **Price:** `ceil(1 + tier / 2) x (1 + 0.5 x rechart)` Scrap: T1 2, T5 4, T9 6, T15 9; a second hop costs 1.5x. Paid from
  backpack/stash/Crafting Stash like other bench prices, atomically with the move. Ledgerline-type nodes reduce it (section 9).
- Preview shows: from -> to, the new theme and implicit, the new ceiling ("accepts up to T9"), the target's surge pips, weights
  (`classWeights`/`currencyWeights`) and the price.

### 5.3 Recycling (bench)
Three maps -> one map of a chosen neighbouring area.
- **Inputs:** 3 non-corrupted maps of the *same tier*, no Bounty, not charted (those flags are paid value); any rarity/quality/areas.
- **Target:** any discovered, non-sealed, non-Pit area accepting the tier that is the area of one input or a graph neighbour
  of at least one input's area.
- **Output:** one Normal map at that tier, quality `min(20, floor(mean input quality) + 2)`, no mods (Map Dust exists to add
  them), `rechart` 0. **Price:** `tier` Scrap (T1 1, T15 15); deliberately a real sink at depth.
- Why the ratio and price: at 30 maps/hour the player buys nothing with surplus; 3 -> 1 turns 18 maps into 6 (plus Scrap about 2 to 6
  per recycle). Scrap sink check (balance test): a player recycling 100% of surplus and re-charting 30% spends under 8% of hourly
  Scrap income at T5 to T9 (tuned by bot, see 12).
- Recycling cannot raise tier (no loop around the ladder) and cannot create a bound-to-sealed map.

### 5.4 Rook (Rook stock, `src/game/progression/merchant.ts`)
**Superseded (owner feedback, wares rework):** Rook's Buy and Maps tabs became one **Wares** tab: 4 maps and 8 items per character, random and mostly junk, refreshed every 6 hours and at every level-up, plus a staples shelf and one guaranteed plain map (`src/game/progression/wares.ts`, GAME_SPEC §9). No area, tier or quality picker exists any more; the grade table below is historical (it survives only in the rules as `rookMapOffers`, used by tests and simulations).
Rook sells **Normal maps T1 to T2 for areas the account has cleared** (`atlas.completed`), excluding dead ends, sealed areas and
the Pit. A stock row is `area x tier x quality grade`:
| Grade | Quality | T1 price | T2 price |
|---|---|---|---|
| Plain | 0 | free | 4 Scrap |
| Fine | 6 | 2 Scrap | 7 Scrap |
| Pristine | 12 | 6 Scrap | 12 Scrap |
T1 is only offered where the ceiling is 1 (Cinder Crossing) or, for cleared deeper areas, at tier 1 (a T1 map of a cleared area
is still a valid map; XP x0.5 makes it worthless to farm). Stock is unlimited, unlimited per day (Scrap is the gate), and Rook
never sells a map of an area the account has not cleared: maps of a place are earned at its boss. UI: the merchant panel
gets a "Maps" tab with an area selector (chips for cleared areas), a tier toggle and a quality toggle, one Buy button; the
generic stock list does not flood with 30 rows. `MERCHANT_STOCK` map rows are removed; they become generated
`mapOffers(ch)`; selling legality unchanged ("Rook only buys equipment").

### 5.5 Loot sinks and Scrap, in one list
Territory fee (existing), Re-chart, Recycle, Rook quality grades, Sigil purchases (Faint, 12 to 20 Scrap), Sand trade. No new
inflation source: Re-chart/Recycle only remove maps; Rook sells only low tiers.

### 5.6 Area-bias scarabs (five families, 4 tiers each)
One scarab per family per map (existing family rule), four sockets (five with Fifth Socket). Tier names keep Weathered, Etched,
Gilded, Exalted; min monster level 4/22/46/70; drop weights 100/30/8/2; share of the scarab roll: the five families together take
40% of scarab rolls (Haste, Invasion and B's families the other 60%), equal split among them. Effects act on routing weights only:
| Family | Effect on the table | Tier I / II / III / IV |
|---|---|---|
| **Homing** | weight of the run's own area x | 2 / 3 / 4 / 6 |
| **Wayfarer** | weight of every discovered non-dead-end neighbour x | 1.5 / 2 / 2.5 / 3 |
| **Deepward** | upward tier-roll weight becomes (from 15) and chest upgrade +pp | 20 / 28 / 36 / 45 and +5 / +8 / +11 / +15 pp |
| **Quarry** | weight of dead-end neighbours and areas within 2 hops of a dead end x | 2 / 3 / 4 / 6 |
| **Hearthbound** | weight of every discovered area with this map's theme, at any distance (minimum base 0.5) x | 1.5 / 2 / 3 / 4 |
Stacking: a scarab multiplies the candidate set it names; pins multiply independently (Homing IV + pinning the own area = x18).
These are the only scarabs that touch routing. Readout line: `Scarab: Homing Scarab II: own area x3`.
Anti-degenerate check: an own-area-only strategy (Homing IV) yields at most about 65% own maps and trades away neighbour variety
and Deepward progress; tested.

## 6. Territory layer: beacons and sigils (PoE2-inspired)

### 6.1 Which areas are beacons
Every area in `atlas.completed` is a beacon, automatically (the clear is the lighting; no extra price). Slots:
- depth 0 to 4, non-sealed, non-dead-end: **1 slot**; depth 5 to 8: **2 slots**; sealed areas: **2 slots**; dead ends: **1 slot**.
- Tree: **Lightkeeper** (new notable, 9) gives every one-slot beacon a second slot. No other slot sources.
- Beacons work in the account atlas, not per character; slotting is done on the chart (Territory lens) in the hideout only.

### 6.2 Radius (chart space)
Radius is measured in chart art pixels between node centres (`ATLAS_POS`, the 640 x 360 chart). Area is covered when its centre
is within the radius of the beacon. Rule:
- depth <= 3: **120 px**; depth 4 to 6: **140 px**; depth >= 7: **160 px**; sealed areas **100 px** (they sit in the crowded
  middle row); dead ends **+30 px** (they are otherwise blind).
- Sample coverage (centres, excluding the beacon itself): Cinder Crossing 2 (Ember Road, Bone Approach); Ember Vault 150 px: 3;
  Furnace Yard 3; Iron March 5; Crown Foundry 5; Last Kiln 7; Heart of the Forge 6; Black Pit (sealed, 100 px): Gilded Vault, Hunting Ground, Echo
  Bastion. A generated test prints every beacon's coverage table and the design reviews it once.
- The chart draws the radius as a soft ring and lights the covered nodes when the beacon is inspected.

### 6.3 Sigils (the slotted item)
Consumable currency, stack 20, tradeable. A slot holds one; each **activation of a map in a covered area** spends one **use** from
every covering slotted sigil whose effect applied (12 uses at strength I/II, 10 at III; Lamp Oil node +3). At 0 the slot
empties with a banner. Removing a sigil returns the item with its remaining uses rounded down into nothing: a half-used sigil
cannot be recovered, it is a consumed resource (swap is an explicit, confirmed action).
Strengths: **Faint (I), Bright (II), Blazing (III)** (a 20/60/100% ladder of the listed values).

**Modifier menu** (applies to maps run in covered areas, including the beacon's own area; ledger units are brief B 4.1):
| Sigil | I | II | III | Notes (ledger about 2.5u / 4u / 6u) |
|---|---|---|---|---|
| **Omen** (event chance) | +4 pp | +6 pp | +9 pp | added after area odds, still capped 65% (Sworn to the Veil ignores); not part of the tree's +12 pp cap |
| **Hoard** (dead-end loot) | +9% | +14% | +20% increased item quantity in dead-end and sealed areas | increased, so it adds to Dead-End Devotee's "more" instead of compounding it |
| **Fortune** | +8% | +12% | +18% increased item rarity | |
| **Ingredient** | +20% | +35% | +50% boss ingredient chances (more) | same resolver path as Ingredient Hunter |
| **Survey** | +25% | +40% | +60% chance for a boss kill to reveal one more neighbour | added to Master Surveyor's chance, same fractional rule |
| **Tide** | surge bonus x1.25 | +1 surge charge per covered area/day | as II, and 25% a spent charge is not consumed | see 7.6 |
| **Theme (6 variants: Ashen, Chapel, Crypt, Ossuary, Chainworks, Coliseum)** | +25% | +45% | +70% more weight of the theme's signature currency and +1 class weight on that theme's maps | numbers mirror the theme seals (Emberwright's Due 35% more ember) |
Theme variants: Ashen = Ember Essence, Chapel = Binding Seal, Crypt = Solvent, Ossuary = Rime Essence, Chainworks = Forge Scrap,
Coliseum = Fracture Core (existing `currencyWeights` hooks).
**Stacking rule:** the same sigil kind from several beacons: the strongest at 100%, each other at 50%, frozen at activation. Different
kinds add. All territory bonuses appear in the readout as `Territory: <sigil> (<beacon>)`.

### 6.4 Sources and price
- Final-boss kill at tier >= 3: **10% x personal rarity** (cap 100%) to drop one sigil; kind uniform among the 6 generic kinds
  (60%) and the boss theme's Theme sigil (40%); strength by map tier: T3 to T7 always I; T8 to T11 I or II at weights 100/30;
  T12+ I, II, III at 100/30/8. Sealed-area bosses roll 2x.
- Rook sells Faint sigils (strength I) of the 6 generic kinds for 14 Scrap, Theme sigils of **cleared** themes for 18.
- Bench: no crafting yet (future: Sigil fusing).

### 6.5 Interaction with the tree and with surge
- **Dead-End Devotee** (quantity 24% more in dead ends/sealed; 25% less through-route; a boss kill always reveals one more
  neighbour): Hoard stacks additively in the increased bucket, and beacon coverage of dead ends is wider (+30 px). A
  Devotee build's beacon plan: Hoard in the Glass Sepulchre or Iron March beacon to cover Hollow Ossuary/Pit.
- **Master Surveyor** and Survey share one fraction; total reveals `2 + floor(f) + (roll < frac)`; the fractional extra never
  drops maps on that run (4.3).
- **Wagered Charts** vs Dead-End Devotee exclusion unchanged; beacon effects work with either.
- **Surge:** Tide is the only beacon effect on surge.
- **Events:** Omen raises the chance of the map's event slot; everything else is orthogonal.

## 7. Daily surge

### 7.1 The clock and the ledger
- **Forge day** starts at **04:00 UTC** (`SURGE_RESET_UTC_HOUR`), chosen because it is 06:00 in central Europe and night in the
  Americas; it is a constant in `data/progression/territory.ts` and shown as a countdown ("Surges refresh in 3 h 12 m") next to the
  chart header, computed from server time delivered in `welcome.serverTime` and refreshed on `pong` (skew-safe).
- `forgeDay(nowMs) = floor((nowMs - 4 h) / 86 400 000)`; no DST, no time zones. The day index lives in `atlas.surge.day`;
  reads and writes compare the stored day with `forgeDay(server now)` and reset `spent` lazily when different (no scheduler).
  The server clock source is the injected `GameServer.now` (already a test seam).
- Charges per area: `3 + tree` (section 9). Remaining = `max - spent[area]`, floored at 0.

### 7.2 Spending
- **At activation, by the opener**, before the portal opens: if `useSurge` and remaining >= 1, `spent[area] += 1` and the run gets
  `RunSetup.surge`. The destination area counts (passage -> sealed area; Pit -> Pit). If remaining is 0 the run is normal and the
  dock says `No surge left today (refreshes in 3 h 12 m)`.
- **Bonus:** `+30% item quantity` and `+15% item rarity`, applied as "more" multipliers on the map-side luck (source line
  "Surge"), so they scale with gear like every map bonus. **Quantity applies to every category except maps** (I1). Not applied
  to boss guarantees (they are guarantees), events, or the Hunting Ground class rolls.
- **Refund:** same path as the territory fee: only an unrestorable server failure returns the charge (carried in `RunSetup.surge`).
  Abandon, death, disconnect and restart-with-restore do not.
- **No hard cap** anywhere: players may run an area any number of times; the fourth run is simply normal.

### 7.3 Account and party rules (anti-abuse)
- **Per account**: two characters on one account share the same `atlas.surge` (the atlas is account-wide), so alt-hopping gains
  nothing. The write is part of the single save transaction of `openMap`, which already serialises per account.
- **Parties:** the **opener's** charge decides, frozen into the expedition; guests get the map-side bonus but never spend or stack
  their own charges (same rule as scarabs and trees: "guests' trees do not stack"). A guest with charges left does not gain
  more. Nothing is taken from a guest.
- **Clock integrity:** server time only; client displays. A test freezes `now` around the reset and exercises two
  simultaneous activations across the boundary. Restoring a run after a server restart reuses its frozen surge.
- **Trade and farming:** Sand and Grand Hourglass are tradeable currency (the trade economy already moves currencies). The bonus is
  deliberately small (+30% quantity, +15% rarity, not maps), so even a Sand market cannot create runaway income: 1 Sand is 3
  extra boosted runs of one area (about 0.9 run-equivalents of extra value).
- **Who is at risk of feeling punished:** nobody; "no charges left" equals today's rates. Diversity is encouraged: a focus
  farmer of one area exhausts 3 charges in about 35 minutes; a player rotating the chart's neighbours (the new default with
  routing) sees about 20 boosted runs/day.

### 7.4 Hourglass Sand and Grand Hourglass
| Item | Use | Sources and rates (first pass) |
|---|---|---|
| **Hourglass Sand** | right-click an area node/pin on the chart: resets `spent[area]` to 0 (refills that area to max) | final-boss kill at T3+: **5%** per boss x personal rarity (cap 100%); completion chest: **3%**; Gold-grade event completion: **10%** per completion; Sealed areas' boss 2x; total about **9% per run**, about 0.45 per hour |
| **Grand Hourglass** | resets every area's surge to full | T9+ final boss only: **0.5%** x personal rarity; about one per 40 hours |
Sand stacks to 20, Grand to 5. Applying to an already-full area is refused without cost. Tree: **Trailmark** (re-roled,
section 9) +50% Sand chance.
Rates are placeholders until the economy bot shows Sand-adjusted value per hour <= +3% (12).

### 7.5 Tree additions to surge
Extra charges: **Second Wind** (+1 charge on every area), **Lamp Oil** (+1 on dead-end and sealed areas). Reset chance: **Afterglow**
(10% chance the charge spent at activation is not consumed, rolled from the map seed like Lantern-Bearer) and Tide III (25%).
Afterglow and Tide III roll once each; the charge survives if either succeeds (independent).

### 7.6 Indicators
Every node on the chart shows **three small brass pips** under the plate (filled = charge left), and pips show in the rail, in the
Device dock (`Surge 2/3`), in the Re-chart popover, on pin chips, on the map tooltip and in Rook's area selector. A node
with no charge keeps its pips hollow and dimmed; nothing else about it changes. In-run HUD shows a small "Surge" source in the
luck breakdown only (no new HUD element).

## 8. Areas, maps and events

- **Events** are drawn at activation from the bound (or passage) area, the map, scarabs and the tree: unchanged, but the map
  tooltip can now show the map's *area type* event bias and exact odds before loading, because the area is known on the item.
  Shrine Field still x3 (cap 100%); sealed encounter presets stay (`encounters`).
- **Anchors (10.3):** the Event Director asks the area's layout for candidate anchors per event kind and picks one with the run
  seed. Same area: same handful of candidate anchor sites, so players learn "the Caravan uses one of Furnace Yard's three roads".
  If a layout lacks an anchor kind the director falls back to today's radial random rules (keeps tests and unfinished layouts
  alive).
- **Gold Sand:** Gold-grade completions can drop Sand (7.4) and count for "an event seen" as before.
- **Bounty:** unchanged (`bounty` on the item); Pit via passage (2.5).
- **Events in territory:** Omen sigils and Sworn to the Veil/Twin Omens remain independent.
- **Stalker geometry:** layouts guarantee cover between every perch and the landing (10.4), which is what makes the
  "whiff on a pillar" decision repeatable instead of luck of the scatter.

## 9. The Atlas tree: what changes node by node

Principle: **no node positions, ids or costs move** (A/B own the wheel). Existing nodes get re-roled or annotated, plus exactly
one new node. Nodes whose engine is "awaiting" stay awaiting. Regenerate `tree-nodes.md` after.
New `MapStat`s: `pinSlots`, `pinWeight`, `surgeCharges`, `surgeKeep`, `sandChance`, `beaconSlots`, `beaconRadius`, `sigilUses`,
`serviceDiscount`.

| Node (branch) | Today | New | Units |
|---|---|---|---|
| Waypoint (S) | +8% maps | unchanged (map category still exists) | 1.0 |
| **Milestone** (S) | +8% maps | **+1 pin slot** | 1.0 |
| **Trailmark** (S) | +8% maps | **+50% Hourglass Sand chance** | 1.0 |
| **Cartographer's Pen** (S) | +8% maps | **Afterglow:** 10% a spent surge charge is not consumed | 1.0 |
| **Survey Stake** (S) | scarab +12% | **beacon radius +20 px** | 1.0 |
| **Lamp Oil** (S) | scarab +12% | **+1 surge charge on dead-end/sealed areas** and sigils last +3 uses | 1.0 |
| **Charter Ink** (S) | chest map quality +2.5 | **Re-chart and Recycle cost 25% less** (min 1) | 1.0 |
| **Signpost** (S) | chest map quality +2.5 | **+1 pin slot** (the second pin node; Milestone and Signpost are separate branches of the Cartography ring) | 1.0 |
| Cairn, Ledgerline, Lamplighter | unchanged | Ledgerline also -1 Scrap on Re-chart/Recycle (min 1) | 1.0 |
| **Chart Keeper** (N) | 22% maps + chest quality +3 | 22% maps, **pins weigh x4 instead of x3** (replaces the quality) | 4.0 |
| **Far Horizon** (N) | +10 pp chest upgrade | same; also the advance target may skip one ceiling step when pinned | 4.0 |
| **Master Surveyor** (N) | +35% extra reveal | same; maps of the newly revealed area can drop from that boss's chest (system rule) | 3.9 |
| **Lantern-Bearer** (N, awaits device) | scarab keep 20% | **Second Wind: +1 surge charge on every area** (4/day) | 4.0 |
| **Lightkeeper** (N, NEW; one node on the Cartography outer ring, Fifth Socket's partner) | - | every one-slot beacon gains a second slot | 4.0 |
| Fifth Socket (N, awaits) | fifth scarab socket | unchanged; now also room for an area-bias scarab | 4.0 |
| **Wagered Charts** (K) | account-bound Rare chest map | binds to the advance target; map category dropped maps stay unbound by the keystone | 5.0 |
| **Dead-End Devotee** (K) | quantity in dead ends, always +1 reveal | unchanged; synergy note with Hoard and Quarry (6.5) | 6.0 |
| Theme seals (6, Seal) | theme essence/monster tweaks | each adds: your routing weight for that theme's areas x1.25 (a passive Hearthbound I) | +0.6 |
| Sound Foundations, Essence nodes, Bounty/Fortune/Echoes/Peril branches | - | unchanged | - |
Pin-slot nodes total: Milestone +1, Signpost +1 -> **5 slots** with both; the ledger audit (B 4.1) must recount Cartography's
branch total when these land. The old "maps" smalls remain because map category chance still exists.

## 10. Hand-crafted areas

### 10.1 Decision
Each of the 25 areas has **one fixed layout file**. Fixed: landmarks, walls, cover, decals, lighting, spawn lanes/zones, boss
stage, fixed start (optional), event anchors, chest/portal bias. Per-run by seed: which packs spawn in which zone, pack mix and
rarity, rare spawns, which anchor an event uses, loot, random debris (cosmetic only, no collision). Arena stays a **circle** with
today's radius so monster budgets/balance and netcode do not change; obstacles make it feel like rooms.

### 10.2 Authoring format (data, reviewed in PRs, rendered in `dev/layouts.html`)
```ts
// src/data/layouts/schema.ts
type P = [number, number];               // x, y in R units (-1..1), origin = arena centre, +y south (screen); |P| <= 0.92
type Polar = { r: number; a: number };   // alternative: r in R units, a = compass bearing in degrees (N = 0, clockwise)
export interface AreaLayout {
  areaId: AtlasAreaId;
  version: number;
  start?: { at: P | Polar; clear?: number };            // default centre, clear 140 u
  landmarks: { id: string; kind: PropKind | LandmarkKind; at: P | Polar; r?: number; variant?: number; tags?: string[] }[];
  clusters: { id: string; pattern: 'ring' | 'arc' | 'line' | 'grid' | 'scatter' | 'spiral'; at: P | Polar; params: Record<string, number>;
              prop: PropKind; variant?: number; count?: number; tags?: string[] }[];
  walls: { id: string; path: (P | Polar)[]; thickness?: number; gaps?: { at: number; width: number }[]; prop?: 'ruinWall' | 'pillar' | 'crate' }[];
  decals: { id: string; kind: 'road' | 'glyph' | 'crack' | 'pool' | 'light'; path?: (P | Polar)[]; at?: P | Polar; r?: number; width?: number }[];
  lanes: { id: string; path: (P | Polar)[]; width: number; weight: number; wave?: [number, number]; favours?: ('melee' | 'ranged' | 'fast')[] }[];
  zones: { id: string; shape: 'disc' | 'sector'; at: P | Polar; r: number; a0?: number; a1?: number; weight: number; wave?: [number, number] }[];
  bossStage: { at: P | Polar; r: number; arrive: 'gate' | 'rim' | 'shimmer'; facing?: number; second?: P | Polar };
  anchors: { id: string; fits: EventAnchorKind; at: P | Polar; r?: number; path?: (P | Polar)[]; tier?: [number, number] }[];
  rareSpots?: { at: P | Polar; r: number; weight: number }[];
  light?: { ambient: number; pools: { at: P | Polar; r: number; colour: string; flicker?: number }[] };
  scatter: { density: number; kinds: PropKind[]; solid: false };        // decoration only
}
type EventAnchorKind = 'perch' | 'echo' | 'road' | 'fault' | 'relay' | 'altar' | 'orchard' | 'ring' | 'host' | 'anvil' | 'bell';
```
Compiled at load to world units using the run's actual `R` (so `arenaScale` still scales the place); props keep absolute radii.
The compiled result is an array of `addProp` calls in a fixed order (`layoutMap` becomes `applyLayout(w, layout)`), so **same area +
any seed = identical props** (digest covered); the scatter flag `solid:false` means decoration never blocks movement or events.
**Walls** are runs of overlapping solid `ruinWall`/`pillar`/`crate` circles at 0.8 x diameter spacing with declared gaps (engine
colliders are circles only; no new collision primitive).

### 10.3 Validation (vitest, runs on every layout, blocks merge)
1. every point inside `0.92 R`; nothing inside the start clear; boss stage and anchors not inside solids;
2. flood fill on a 14 u grid: **all lanes, anchors and the boss stage are reachable** from the start; every corridor is at least
   `2 x PLAYER_RADIUS + 10 = 24 u` wide and every *designed* choke at least 96 u (Stalker pounce 34 u disc needs room);
3. no two landmarks overlap; solid prop density <= 14% of the walkable area; open space: a 400 u disc is free near the boss
   stage (phase attacks) and a 300 u disc around the landing;
4. event anchors obey Event Charter spacing (C 4.3): `perch` >= 320 u from the start, `echo` >= 200 u from the rim and 250 u from
   the start, `relay` triad >= 300 u apart, `fault` line 260 u long >= 300 u from the start, `road` 1.3 to 1.6 R long;
5. **Stalker cover:** for each `perch`, the straight ray to the start crosses >= 1 solid cover prop within 140 to 380 u of the
   start (the "hide behind a pillar" choice exists from every perch);
6. every layout declares >= 4 perches and >= 2 of each anchor kind its theme claims as native, and >= 1 of each other kind
   (fallback rule in 8 covers the rest);
7. determinism: same seed -> same props; different seeds -> same landmarks/clusters/walls, different packs/events.

### 10.4 Tooling (small)
- `dev/layouts.html`: Canvas viewer (like `dev/ui.html`) renders one layout at 1x/2x with props, lanes, zones, anchors,
  reachability heat, the 680x400 view box at the start and boss stage, and a seed slider showing pack placement overlaid; click to
  copy coordinates as `Polar`. Read-only first; dragging and writing back (a `layout-save` dev endpoint) is optional stretch.
- `scripts/layout-lint.mjs` (same checks as 10.3, CLI output for PR review) and `npm run layouts:render` (PNG strip of all 25
  for the PR description).
- The client draws layout decals and lights from `areaId` (added to the world info message), so ground, decals and lighting are
  pure data on both sides.

### 10.5 Runtime changes
- `layoutMap(w)` -> `applyLayout(w, layout)`; layouts in `src/data/layouts/<area>.ts` indexed by `areaId`; `RunConfig.areaId` new.
  Areas without a layout keep the old generator (slice-by-slice rollout; a test asserts 25/25 before the old code is deleted).
- `placePacks`: if the layout has `zones`/`lanes`, packs pick a zone by weight (wave-windowed) then a point in it by the existing
  golden-angle filter limited to that zone; otherwise the old spiral. Seeds still fully decide *which* pack goes where.
- Boss: `bossStage.at` replaces `pointAway` for the final boss and for the second boss (`second`); `arrive` picks the existing
  arrival animation. `RunConfig.start` from `layout.start`.
- Art kit additions are one batch in `PropKind` (contracts, protocol prop table, present props): `vat`, `bellows`, `altar`,
  `sarcophagus`, `choirStall`, `ribArch`, `iceColumn`, `crate`, `chainPost`, `hoist`, `gate`, `weaponRack`, `obelisk`,
  `statue`. Fourteen props, about 2 to 3 per theme, drawn in the existing pixel style with one recolour each; no new game
  mechanics (all solid circles or walk-through decor).

### 10.5a L0 as built (slice L0, shipped)
- Files: `src/data/layouts/{schema,compile,area,index}.ts` (format, compiler, registry `AREA_LAYOUTS`, empty until a pack lands),
  `src/sim/layout.ts` (`applyLayout`, pack zones/lanes/rare spots, `bossStagePoint`, `layoutAnchors`),
  `src/sim/layout-validate.ts` (the seven checks), `scripts/layout-lint.mjs` (`npm run layout:lint [-- --fixtures]`),
  `dev/layouts.html` (viewer), `src/art/props-kit.ts` and `src/present/layout-art.ts` (kit sprites, decals/landmarks/lights),
  fixtures in `src/data/layouts/fixtures/` (not registered).
- Units: positions are R fractions (`[x, y]` or `{ r, a }`); every other length (`r`, `width`, `thickness`, `clear`, gap widths, cluster
  params, zone `r`) is world units (u). Wall gap `at` = 0..1 along the wall path. Compass bearings everywhere.
- Runtime: `RunConfig.areaId` (T0 passes `setup.atlasAreaId` in `buildRunConfig`); `WorldView.areaId` (client: from `zone.setup.atlasAreaId`,
  so no wire change and `SNAPSHOT_VERSION` stays 10); no layout registered for the area (or hideout) = the old generator, untouched
  (goldens unchanged). The fixed props use no RNG; cosmetic debris uses a stream forked from the seed, so packs/events keep their streams.
- Check 3 reads "a 400 u / 300 u disc" as diameters (free radius 200 at the boss stage, 150 at the landing); check 2 runs on a 7 u grid
  with a half-cell tolerance (a 24 u corridor passes); every wall gap must be >= 96 u. All in `LAYOUT_RULES`.
- E1 (Event Director): `layoutAnchors(w, kind, { tier?, fallback? })` returns the layout's declared anchors (world units, tier-filtered);
  `[]` = no layout or none declared = keep the radial rules; `fallback: true` synthesises deterministic Charter-respecting sites for
  point-like kinds. `pickLayoutAnchor(w, kind, rng, filter?)` picks with the caller's seeded rng.

- **E1 as built (slice E1, shipped).** Every event script asks for its anchor kind before its radial rule (`src/sim/events/kit.ts`
  `anchorSite` / `anchorSpot` / `anchorRng`): hunted -> `perch`, echoRift -> `echo`, wound -> `fault` (field centred on the anchor, wedge
  boundaries aligned with its line), pactAltar -> `altar`, orchard -> `orchard` (first plot, then further orchard anchors inside the
  250-450 u spacing window, else the old search round the first), ring -> `ring`, host -> `host`, anvil -> `anvil`, bellwatch -> `bell`,
  blackout -> three `relay` anchors >= RELAY_SPACING apart, vaultbreakers -> a `road` path driven from whichever end is >= 250 u from
  every player (both clear: plan variant bit 2), secondCrown -> `bossStage.second` when declared. voidBreach stays central (no kind).
  - The pick uses its own stream (run seed x event uid x kind), never the director's, so a layout with anchors never shifts the
    other event rolls; `fallback: true` synthesis is not used (an area without a usable anchor keeps the radial rules exactly).
  - An anchor is **blocked** when the seated point is closer to a living player than the event's own clearance (the radial rule's
    `minPlayer`), or its tier window excludes the map. **Seating** (`src/data/progression/events/anchors.ts`): each kind has the radial
    rule's rim margin (`EVENT_ANCHOR_RIM`, e.g. bell 280 u, fault 260 u); an anchor up to `ANCHOR_SEAT` = 100 u over it slides straight
    towards the centre, farther it is blocked. Blocked or absent: `pickSite` exactly as before (goldens of layout-free runs unchanged).
  - `EventInstance.anchors` (server-only) records the anchor ids used; the layout sweep prints them (`anchored`: a / r / -), and
    `LAYOUT_SWEEP_ANCHORS=0` strips every anchor for before/after comparisons.
  - Validator **check 10** (seating): every anchor seats its event (<= 100 u over its rim, the slid point clear of solids and
    reachable), and relay anchors come as a triad (>= 3) or not at all. Shipped anchors moved for it: Ember Road `bell-1` and Pit
    of Echoes `bell-1` (pulled in so the rings fit). Moved after the before/after layout sweep (bot, `LAYOUT_SWEEP_ANCHORS=0` vs
    live): Heart of the Forge `echo-s1/s4` (from the outer sectors into the bellows ring: the interception chase crossed uncleared
    sectors, 10 of 12 runs died against 4 of 12 radial), Hollow Ossuary `altar-1`, `bell-2` and `fault-n` (from the outer ring into
    the open heart: the 130 u spiral corridor cannot hold the wide fields, Fault grades and Pact pacts kept collapsed out there).
  - Sweep (25 areas x 12 events x 2 seeds, live vs stripped): clears 511 vs 514 of 600, grade points 1117 vs 1123, finished
    events 565 vs 567, no hook errors; about 75% of reveals stand on an anchor (the rest are blocked by the party and use the radial
    rule), before the four moves above.
  - Tests: `tests/sim-events/anchors.test.ts` (every shipped area x every point event from the landing, relay triads, caravan roads,
    Rival's second stage, seeded and stream-neutral pick, tier windows, blocked and absent fallbacks, seating), validator check 10 in
    `tests/layouts/validate.test.ts`.

- **Spawn placement and pockets (layouts live in real runs).** `spawnMonster` (`src/sim/spawn.ts`) resolves every spawn (packs, stream groups,
  lieutenant, boss, summons, event spawns) to the nearest point clear of every solid prop (`freeSpawnPoint`: a fixed outward ring search on the
  `propGrid`, no RNG, so streams stay stable; the old generator shares it). Check 8 of `layout-validate.ts` (`findPockets`, `findCornerTraps`):
  no standing ground (exact `PLAYER_RADIUS`) cut off from the landing, and every concave corner can be left with the real `resolvePlayerAt`.
  Walls and corners never trapped a player; the "stuck" bot runs were steering (see `tests/sim/nav.ts`: walk round walls, hysteresis; the sweep's
  event policies walk through it too).

- **Flow zones (conveyor belts; added with the Iron March / Last Kiln mechanic).** `AreaLayout.flows?: LayoutFlow[]` (schema.ts, geometry and schedule in
  `src/data/layouts/flow.ts`) is a real movement mechanic, not decoration. One format for belts, currents and rivers:
  `{ id, shape: 'band' | 'annulus', path/width (band: a polyline, flat ends, flows first -> last point) or at/r0/r1 (annulus: clockwise at sense 1),
  speed (u/s), sense: 1 | -1 | 'random', group?, strength?: { player, monster, heavy, boss, air } (defaults 1, 1, 0.5, 0.5, 0), feather? (8 u),
  reverse?: { mode: 'pingpong' | 'random', every: [min, max] s, telegraph? (2 s), ramp? (1 s) } }`.
  Static = `sense: 1`; random direction = `sense: 'random'` (zones sharing a `group` always include both directions); reversing = `reverse`. The sim adds
  `speed x strength x scale(t)` to every player (`movePlayerDrifted`, same expression as the sim's player update) and monster (`ai.ts integrate`), where
  `scale(t)` runs -1..1 and passes through 0 in every reversal (telegraph: eased deceleration, ramp: eased acceleration), so velocity is continuous.
  The schedule is a pure function of the flow seed and the sim clock: `RunConfig.flowSeed` (server draw per map instance, independent of the run seed which
  clients never see; absent = derived from the seed) -> `ZoneInfo.flowSeed` (PROTOCOL_VERSION 23, optional field, no snapshot change) -> `WorldView.flowSeed`.
  The client builds the same field from `WorldView.areaId` + arena radius + flow seed, so prediction replays belts and reversals exactly; the presenter draws
  the chevrons from it (scrolled by the live velocity, flicker in the telegraph, dust on riders, prefers-reduced-motion = no scroll) and the sound director
  voices a reversal from it. A reversal is not gated on boss roars or event telegraphs (the schedule must be state-independent for prediction).
  Monster navigation: the stall rule measures movement net of belt drift (`navDrift`), `trackStuck` ignores it, and monsters are carried at most 60% of
  their own speed so they always make headway.
  **Validator check 9** (`layout-validate.ts checkFlows`): zones inside 0.92 R and sane (speed <= 66 u/s, reversal gaps >= telegraph + ramp + 4); a random
  group never runs one way (32 sample seeds); the landing clearing and boss stage stand on no flow; and for both directions of every zone and the
  reversal scales 1 / 0.5 / 0.2, a body carried passively for 3 s ends within 3 s (Dijkstra at net speed against the drift) of ground off that belt.
  Candidate areas for later flow zones: Frozen Passage / Winter Throne (frost currents under the ice lakes), Furnace Yard (a slag channel), Shattered
  Forge (a lava rill), Sunken/crypt areas with a sung stream, Eternal Arena (a rotating sand ring), Gilded Vault (a gold-road tram).

### 10.6 Per-theme art kit
| Theme | Floor bed | Signature props (existing + new) | Decals / light |
|---|---|---|---|
| Ashen Forge | lava-cracked basalt | standing stone, brazier, pillar, **vat**, **bellows**, rubble | glowing cracks, cooled slag, orange pools |
| Cinder Chapel | charcoal flagstone | pillar, brazier, banner, **altar**, candle | ember glyph circles, stained light shafts |
| Rimed Ossuary | frost bone tile | crystal, bones, **ribArch**, **iceColumn** | blue pools, frost rims |
| Choral Crypt | violet stone | standing stone, **sarcophagus**, **choirStall**, bones | sung rings, window light |
| Chainworks | rusted grates | pillar, brazier, **crate**, **chainPost**, **hoist** | hazard stripes, conveyor belts (flow zones, a mechanic: 10.5a) |
| Iron Coliseum | sand over iron plates | pillar, brazier, **gate**, **weaponRack**, **obelisk**/**statue** | sand rings, torch pools |

### 10.7 The 25 layouts
Conventions: `R` = arena radius in u (base x `arenaScale`); bearings are compass degrees (N = up, clockwise); `r` is a fraction
of R; "landing" = the start (0,0) unless stated; "cover" = solid props usable against the Stalker's pounce; "anchors" list only
what defines the place (every layout also carries the 10.3 minimums). *Reads as* = the silhouette a player should remember;
*Weak spot* = the honest flaw the design accepts. Each has a one-word handle for communication.

**ASHEN FORGE (R 900 base; six areas, six silhouettes)**

1. **Cinder Crossing (T1, R 900), "Crossing".** The teaching ground. Two paved causeways cross at the brazier-lit landing (4 braziers
   r 0.12), N-S and E-W, marked by a road decal with low rubble lips. Four **ritual circles** (6 stones on a 56 u ring, one
   brazier) sit in the quadrants at r 0.55, bearings 45/135/225/315: the obvious hiding places. Lanes: four arms. Zones: quadrants.
   Boss stage: the North gate (r 0.80, bearing 0): two broken pillars and a stair, `arrive:'gate'`. Anchors: 4 perches between arms,
   echo anchors in two quadrants, relay triad at 0/120/240 on r 0.5. *Reads as:* the cross. *Weak spot:* predictable on purpose;
   quadrant funnelling makes packs easy to read (good at T1).
2. **Ember Road (T3 ceiling, R 855), "Processional".** A long avenue S to N: two colonnade rows of pillars with braziers at r 0.14
   either side forming a 150 u street, side bays W/E (each holds one stone circle) and a sealed stair decal at the NW rim (the
   Vault's door). Landing at the south end. Boss: the north end, a double-pillar gate. Caravan road along the street (native
   `road`, 1.4 R). *Reads as:* the long colonnade. *Weak spot:* linear, packs stack up the street (Stalker has the best pillars here).
3. **Furnace Yard (T5, R 990), "Vats".** Four big **slag vats** (r 40) in a 2 x 2 at (+-0.3, +-0.3) joined by pipe-wall segments that
   leave a cross-shaped passage 120 u wide; a central non-solid **crucible** (glowing decal r 90) at the landing. The four
   quadrants each hold a lane of crates and stones. Anvil anchor native on the crucible rim. Boss: south-east quadrant `rim`.
   *Reads as:* the vats. *Weak spot:* pillar-dense centre; ranged builds kite well, melee packs snag on pipes.
4. **Shattered Forge (T7, R 945), "Broken Halves".** A long rubble wall (ruinWall run) divides the arena NW to SE into two unequal halves
   with **three gates** (90 u): west half = stone circles and open ground (landing), east half = vat rows and the boss stage at
   bearing 100 (`arrive:'gate'`). Two lanes cross the wall. Fault line anchors on both halves. *Reads as:* the wall. *Weak spot:*
   gates become pack chokepoints; good AoE, bad for ranged shooting through walls (solid props block projectiles: designed).
5. **Crown Foundry (T9, R 900), "Crown Hall".** A circular hall: an inner **dais ring** of 8 pillars at r 0.26 (6 gaps) and an outer
   colonnade of 12 alternating pillars/braziers at r 0.62; a pair of great **statues** (new `statue`) flank the throne at
   bearing 0, r 0.82 (boss stage, `arrive:'shimmer'`). Landing at the south portal. Unique pool: Cinder Matriarch. *Reads
   as:* concentric. *Weak spot:* symmetric; the dais ring is a kite track but also a trap for 4-player parties.
6. **Heart of the Forge (T15, R 900), "Heart".** Fixed **start at the rim (r 0.86, bearing 180)**; the great **furnace** (non-solid glow r
   110 plus six bellows stacks r 14 on a 0.22 ring) is the boss stage in the centre; six radial **spoke walls** at 60 degrees
   leave gaps alternating at r 0.35 and r 0.7, forming a spiral route inward. Lanes follow the spiral. Anchors: altars at each spoke
   end. *Reads as:* the wheel. *Weak spot:* the hardest route to read in a crowd (intended top-tier test); a single safe
   kite loop exists around the furnace.

**CINDER CHAPEL (R 800 base)**

7. **Ember Vault (dead end, T3 ceiling, R 640), "Reliquary Stair".** A narrow nave N-S: two pillar aisles at +-0.28 R, four side
   **chapels** (alcoves with an altar and banner) at bearings 70/110/250/290, r 0.55, each a cover pair, and the sealed vault door
   at the north (boss stage r 0.70, `arrive:'gate'`). Tight: lanes are the two aisles. Hoard/Quarry dead end. *Reads as:* the
   hall and its door. *Weak spot:* cramped, so events with big footprints (Fault, Ring) have few anchors; reward (30% more, ingredient
   weights) compensates.
8. **Ember Citadel (T11, R 880), "Ritual City".** Eight small **houses** (L-shaped wall runs) form a ring at r 0.6 around a **central
   plaza** (radius 170) with a brazier circle; four streets N/E/S/W (110 u) cut through the houses; the boss stage is the plaza
   (centre) with `arrive:'rim'`. Landing at the south gate. Anchors in house courtyards; orchard plots in courtyards. *Reads as:* a
   city. *Weak spot:* houses are line-of-sight blockers: the Stalker is hardest to predict here; streets trap careless parties.
9. **Shrine Field (T15, no boss, R 800), "Shrines".** Open ground with nine **shrines** (altar + two candles, solid r 9) on an authored
   lattice (spacing about 130 u, rotated 12 degrees); every shrine is an event anchor (`altar/orchard/relay/perch` mix) so the x3
   event odds always have a stage. No boss stage; `finish` = the central shrine where the chest appears. *Reads as:* a meadow of
   lit stones. *Weak spot:* no real cover except shrines; Stalker gets few pillars (3 of 9 shrines are taller).
10. **Black Pit (sealed, T9 ceiling, R 800), "Bowl".** A central **pit** (dark non-solid disc r 150) ringed by a rubble lip; three
    **relay braziers** fixed at 0/120/240 on r 0.62 (the Blackout triad, >= 300 u apart), the **Wound** crack anchor at the pit
    (field r 240); landing on the rim at bearing 180. The fixed positions *are* the event order. Boss: the pit lip north.
    *Reads as:* the bowl and its three fires. *Weak spot:* nothing random to learn: experts rush, by design.

**RIMED OSSUARY (R 900 base)**

11. **Bone Approach (T3, R 900), "Barrow".** A long barrow W to E: two rows of **rib arches** (new `ribArch`) forming an avenue 160 u wide,
    alcoves of crystal clusters between arches, landing at the west mouth, boss on the east mound (`skull` landmark r 40, `arrive:'rim'`).
    Crystal clusters are the cover. *Reads as:* the ribs. *Weak spot:* a one-direction funnel; safe to run straight (T3).
12. **Winter Throne (T9, R 990), "Throne".** A raised **ice dais** (ring of 8 ice columns at r 0.22, four 100 u stair openings N/E/S/W)
    with a frozen lake decal (r 0.4; cosmetic) and bone arcs at r 0.7. Boss stage on the dais north opening (`arrive:'shimmer'`).
    Host plaza native on the lake (statues around the prism). *Reads as:* the white disc. *Weak spot:* 8 columns means lots of cover
    at the centre, none at the rim.
13. **Sealed Reliquary (sealed, T7, R 810), "Twin Crypt".** A **mirror-symmetric** hall: boss A stage north (r 0.74), boss B stage south (r
    0.74, `second`), side ossuary niches E/W, landing in the middle; two rows of 4 ice columns. Fairness by symmetry for Rival Crowns;
    a solo player fights both crowns from the same crossing. *Reads as:* symmetry. *Weak spot:* predictable; Stalker cover is
    symmetric too (good).
14. **Echo Bastion (T13, R 1035, largest), "Rampart".** A ring **rampart** (wall run at r 0.78 with six gates) around an inner bailey; four
    **corner towers** (pillar clusters) at bearings 45/135/225/315 at r 0.6; an outer track 120 u wide runs behind the wall.
    Boss in the north gatehouse keep (`arrive:'gate'`). Echo anchors in towers. *Reads as:* the ring wall. *Weak spot:* the track
    makes kiting easy and camping in the bailey dangerous (gates funnel).
15. **Hollow Ossuary (dead end, T5 ceiling, R 765), "Spiral".** A **spiral corridor** of bone walls (path width 130 u) leads inward to the
    ossuary heart; packs stream along the spiral (single lane weight 3), the boss sits at the core (`arrive:'rim'` through the spiral mouth).
    Crystals in wall niches. *Reads as:* the snail. *Weak spot:* narrow, so ranged/AoE rewards; few event anchors (quantity bonus
    compensates); a lone melee build clears it fast.

**CHORAL CRYPT (R 850 base)**

16. **Glass Sepulchre (T5, R 723), "Nave".** A long **nave** W-E with rows of 5 **sarcophagi** either side (cover), a cross-transept
    N-S at the centre (lanes cross here), the landing in the west apse, the boss in the east choir (`arrive:'rim'`). Window-light pools
    decorate the aisles. Bell hub in the crossing. *Reads as:* the church plan. *Weak spot:* the crossing is where everything meets.
17. **Frozen Passage (T11, R 893), "Gallery".** Two galleries (north and south pillar arcs) joined by **three bridges** (west, centre, east;
    130 u bands between wall runs) with an open **well** in the centre (r 200, choirWave-friendly). Boss in the north loft
    (`arrive:'shimmer'`). Bell hub in the well. *Reads as:* the well. *Weak spot:* bridges are chokepoints; central well is
    the only big open space.
18. **Rift Nexus (sealed, T9 ceiling, R 850), "Nexus".** Three **rift plinths** fixed at bearings 0/120/240 on r 0.55, each inside a stone ring
    (cover); a hub dais at the centre. The Echo Rift sequence runs the plinths in the clockwise order (waves 2, 3, 4) so players
    can plan. Boss at the hub after the third. *Reads as:* the triangle. *Weak spot:* low randomness; the rift order is the
    lesson.

**CHAINWORKS (R 700 base)**

19. **Iron March (T5, R 700), "Lines".** Five W-E **conveyor lanes** (90 u wide, separated by crate-stack rails with cross-gaps every **As built: the lanes are flow zones (10.5a): 48 u/s, directions drawn per run (at least one lane each way), reversing every 28-48 s.**
    0.35 R); landing at the west dock; boss at the east loading gate (`arrive:'gate'`). Hounds run the lanes. Caravan road = the
    centre lane. Pit of Echoes entrance is a hatch decal at the south-west (decor). *Reads as:* the lanes. *Weak spot:* lane
    lock-in; Stalker hides behind crate rails (excellent cover).
20. **The Last Kiln (T13, R 805), "Kiln".** A huge central **kiln block** (crate ring at r 0.26, hoist landmark, chimney decal) with a **As built: the annulus is one flow zone: 48 u/s, clockwise or counter-clockwise per run, reversing every 30-50 s.**
    150 u conveyor annulus around it; four radial gantries; the boss stands at the kiln door south (`arrive:'shimmer'`).
    Landing on the annulus at west. *Reads as:* the kiln. *Weak spot:* circular kiting dominates; event anchors only on the
    annulus.
21. **Gilded Vault (sealed, T9 ceiling, R 700), "Counting House".** A straight fixed **caravan road** S to N (the Laden Caravan's
    scripted path with a double escort) between two rows of cash cages (crates), two side counting rooms W/E with a chest prop, and
    the vault door at the north where the wagon escapes; boss at the door (`arrive:'gate'`). *Reads as:* the gold road. *Weak
    spot:* one script; intentionally the same each time (triple currency).

**IRON COLISEUM (R 650 base)**

22. **Champion's Approach (T7, R 585), "Gatehouse".** An S-N **avenue** with banked stands (pillar rows) and a mid **portcullis** (two gate
    props with a 110 u gap at the centre) forming a choke; the boss behind the north gate (`arrive:'gate'`). Ring altar native in the
    south half. *Reads as:* the gate. *Weak spot:* the choke is obvious; ranged classes shoot over it, melee fight in it.
23. **Eternal Arena (T15, R 715), "Sands".** The classic ring: an open **sand disc** (r 0.55, free) surrounded by 16 alternating
    pillar/brazier pairs at r 0.7 and four cardinal gates; champion statue pairs at N and S; boss enters at the north gate.
    The Champion's Ring chain circle goes in the centre. *Reads as:* the circle. *Weak spot:* no cover in the sand: Stalker
    pounce must be dodged (the game's hardest open test at T15).
24. **Pit of Echoes (dead end via passage, T5 ceiling, R 650), "Tiers".** Three concentric **ring walls** (r 0.3/0.5/0.7) with staggered
    gaps (a ring maze), hunter spawns at the rim, echo anchor at the core; boss at the core (+50% life, +25% damage; seventh Echo
    wave plays in the same rings). *Reads as:* the target. *Weak spot:* very high cover density: Stalker favours you; the
    seventh wave can trap you inside an inner ring.
25. **Hunting Ground (sealed, T11 ceiling, R 650), "Trophy Field".** Open ground with six **trophy obelisks** (r 12) on an irregular ring
    (r 0.45) and **three hunter perches** fixed at bearings 0/120/240 (the three sequential Stalkers, waves 2, 3, 4) each with a
    cover obelisk on the line to the landing at r 0.35. Learnable cover lanes. Boss after the third hunter at the north perch.
    *Reads as:* the compass of hunters. *Weak spot:* not much else; the event is the layout.

**Good vs weak layouts, rules of thumb used above.** A layout is *good* when it has one memorable silhouette (a wall, a spiral, a
ring, a wheel), one or two hard decisions (which gate, which bridge, which side of the kiln) and a dependable place to hide
from a Stalker and a place to be caught. It is *weak* when it offers no decision (open sand, a single funnel) or no cover (Sands,
Shrines). Each weak one is placed where the loot table or the event ruleset gives it an identity (Sands is T15, Shrine Field is the
event playground, Vault is the ingredient detour). Reward budgets do not change per layout; layouts change *how* you earn them.

### 10.8 Cover height (props vs shots)
Solid props block walking; whether they block **shots** is a second property, the cover height: `tall` (stops straight projectiles of
players and monsters), `low` (shots fly over it) or `none` (radius 0, never solid). One table, `PROP_COVER` in `src/data/propCover.ts`
(contract type `PropCover`, `PropView.cover` travels only when a layout overrode the kind's default). Defaults: tall = pillar, standingStone, ruinWall,
vat, hoist, gate, obelisk, statue, sarcophagus, ribArch, iceColumn, mapDevice; low = brazier, rubble, bones, crystal, banner, crate, chainPost, altar,
bellows, choirStall, weaponRack, anvil, stash, merchant, chest; none = portal, returnPortal.
- **Layout schema**: optional `cover?: 'tall' | 'low' | 'none'` on a landmark, a cluster (every prop of it) and a wall (the whole run); compiled into
  `CompiledProp.cover` and applied by `addProp`. Overrides in the 25 layouts: Iron March crate rails and Last Kiln outer ring + gantry rails are `low`;
  the Last Kiln kiln block, Gilded Vault cages, counting rooms and cash stacks are `tall` crates; the Furnace Yard pipe walls (and the Slag Yard fixture),
  the Winter Throne dais wall and the Frozen Passage bridge parapets are `low`. Everything else keeps its kind's cover (the Shattered Forge divide, the
  Heart of the Forge walls, the Glass Sepulchre nave, the Pit of Echoes tiers, the Echo Bastion rampart and the Hollow Ossuary spiral are tall walls).
- **Shots**: swept segment against tall circles in the `PropGrid` (`src/sim/cover.ts`), no allocation; a prop containing the shot's start is ignored.
  Lobs, nova rings and ground areas are never blocked; Arc Chain needs a clear line (target and each jump); see GAME_SPEC section 4 for the full list.
- **Monsters**: shooters hold fire while a tall prop stands between them and their target and walk the nav flow field until the line is clear; aim lines
  (kit shooters, Iron Crossbowman, Chainmaster hook) are clipped where the wall stops the bolt and a locked heading that hits a wall first is not fired.
  Boss patterns are not held back (their projectiles are blocked like any other). Stalker pounces are leaps and go over props.
- **Presenter**: a blocked shot sparks a small impact (`blocked` event with `cover: true`, the `shieldBlock` sample pitched down); an overridden prop is
  drawn 1.3 x taller (tall) or 0.72 x (low) than its kind's art, with its shadow.
- **Measured** (fair bot, 25 areas x 3 seeds, plain runs): clears 70/75 with cover off, 70/75 with it on and a bot that ignores walls (avg 4.55 -> 4.84 min),
  73/75 with the cover-aware bot of `tests/sim/bot.ts` (4.78 min); every area's boss still falls. Shots wasted into walls before reaching the player's
  position: about 1% of flat hostile shots (`tests/sim-events/layout-cover.test.ts`, `BALANCE=1` for all 25). Old-generator maps (random pillar fields) gain the
  most cover: the Tier 1-3 ladder (`balance-ladder`) shows Tier 1 unchanged and the lowest-life margin up by about 0.1-0.18 at Tiers 2-3 (flask use down
  from about 9 to 5 at Tier 3) with clear times about 3% longer; no number was changed (not "clearly easier"), the ladder's margin-spread bound moved 0.35 -> 0.4.

## 11. UI screens and components to change

| Screen / component (file) | Change |
|---|---|
| `src/ui/panels/MapDevice.tsx` | remove area selection; bound-map flow; passage slot; surge toggle; Activate calls new `activateMapDevice`; preview via new `openMap` signature |
| `src/ui/atlas/Dock.tsx` | (deleted by the Atlas UX rework; its content lives in `AreaModal.tsx`) map chip with home, scarabs, passage slot, surge chip, routing block in the readout, Re-chart button |
| `src/ui/atlas/Rail.tsx` | (deleted by the Atlas UX rework; its content lives in `AreaInfo.tsx` and `AreaModal.tsx`) pin button, surge pips, beacon list, "maps you hold" line, `Sources` mini-table |
| `src/ui/atlas/model.ts` | `NodeModel` gains `pinned`, `charges`, `stock`, `beacon`, `covered`; `ChartContext` gains pins, surge, stock, beacons; drop "tooShallow for slotted tier" (now a property of the bound map, not a selection) |
| `src/ui/atlas/render.ts` | lenses (`Stock`, `Sources`, `Territory`), pips, pins, beacon rings, edge arrows with percentages |
| `src/ui/atlas/StashDrawer.tsx` | group by area, filters, `area:` search |
| `src/ui/panels/Atlas.tsx` | header: pin tray, surge countdown, lens toggles; removes "set course" |
| new `src/ui/atlas/PinTray.tsx`, `SurgePips.tsx`, `BeaconPanel.tsx`, `RechartPopover.tsx`, `SigilPicker.tsx` | components |
| `src/ui/panels/CraftingBench.tsx` (+ `data/items/bench.ts`) | Re-chart and Recycle services with previews |
| `src/ui/panels/Merchant.tsx` | Maps tab (area/tier/quality) |
| Tooltips (`describeMap`, item tooltips) | area line, surge, re-chart count, migrated note |
| `src/ui/hud/TopHud.tsx`, `MonsterHover` | none; luck breakdown shows Surge/Territory sources (existing list) |
| `src/ui/dev/mockStore.ts` | mock surge, pins, beacons |
| Typography | only `--font-ui-*`; pips/glyphs are canvas (tests in `tests/ui/typography.test.ts` stay green) |

## 12. Tests to write (bots and unit)

1. **Routing distribution** (`tests/game-progression/routing.test.ts`): 20 000 draws per (area, tier, discovery, pins, scarabs)
   fixture match the closed-form weights within 4 sigma; never an undiscovered/sealed/Pit area; ceilings respected; pending
   only in boss/chest drops; pending order equals `discoverAfterBoss`.
2. **Ladder pacing** (extend `atlas-tree-harness.ts`): a bot follows "run best available" over a full ladder with routing: median
   runs to first T15 within +-10% of the pre-routing build; no fixture where every reachable area has zero maps accepting
   the next tier ("stranded": assert the expected maps-to-advance is bounded, 4.4).
3. **Map supply invariant:** maps per run by category identical to today within 1%; surge never changes map counts.
4. **Migration:** the fixture of 2.6 (500 legacy maps x random discovery), idempotence, determinism across loads, trade offers and run
   sourceMaps covered; the old save fixtures in `tests/game-progression/save.test.ts` still load.
5. **Activation and refunds** (`runs.test.ts`, server): bound area run; key passage; Pit via Iron March Bounty; fee, key, surge, sigil
   uses and map return atomically on an unrestorable run; ordinary death refunds nothing; stale-client `areaId` mismatch rejected.
6. **Pins:** slots by tree, frozen at activation, editing while in a run does not change it; pin on a fogged area rejected.
7. **Re-chart / Recycle / Rook:** legality matrix (corrupted, bounty, charted, sealed, undiscovered), price table, `rechart`
   escalation, atomic payment, theme follows, ceiling respected, recycle quality formula, Rook stock only cleared areas.
8. **Scarabs:** each family's multiplier in the table; one per family; Homing IV never produces more than 70% own-area maps;
   Deepward raises the upward share to the listed values.
9. **Surge:** forge-day boundary at 04:00 UTC (including leap seconds, month ends, server clock injection); lazy reset; two
   characters share; concurrent activations spend once; out-of-charge run equals a non-surge run bit for bit; Sand refills one area,
   Grand all, refused when full; Afterglow/Tide III independence; party: opener only.
10. **Beacons:** coverage table snapshot for all 25; stacking rule; use decrement only when an effect applied; empty slot
    banner state; slots by depth; Lightkeeper; sigil effects map to the resolver with the right source labels; restart
    restore keeps frozen effects.
11. **Economy** (`economy.test.ts`): Scrap sinks under 8% of hourly income, Sand-adjusted value/hour <= +3%, surge-on vs surge-off
    value/hour within +/-0.3 of the intended +18 to +24% blended (accepted lift, see risks).
12. **Layouts** (per area, 10.3): bounds, reachability, corridor widths, cover, anchor spacing and counts, determinism,
    digest; a golden-image render hash guarded by `UPDATE_LAYOUT_GOLDENS=1`.
13. **Events on anchors:** with layouts, each event's placement comes from an anchor; without, fallback equals old behaviour;
    Stalker pounce interception from every perch is possible (simulated pounce ray crosses cover).
14. **UI model tests** (`tests/atlas/model.test.ts`): new states (pinned, stocked, covered, charge 0..3), lens rendering snapshot,
    Device flow scenarios at 1280x720 and 1024x600 in the existing browser scenarios.
15. **Net:** protocol version bump, message shape, `welcome` includes serverTime and world `areaId`.

## 13. Slice-by-slice build order (sizes, file ownership, dependencies)

S = days, M = 1 to 2 weeks, L = 3+ weeks. "Owns" lists files only that slice edits until it lands; other slices rebase.
All slices deploy independently and leave the game consistent. A (Cartography Table v1), B (Codex) and C (events) proceed in
parallel and are referenced where they touch.

| # | Slice | Size | Delivers | Owns | Depends |
|---|---|---|---|---|---|
| **T0** | **Bound maps + migration** | M | `MapItem.areaId`, `createMapItem(areaId)`, tooltips, `normalizeMap/bindLegacyMaps`, SAVE_VERSION, new `openMap` signature, passage resolution, protocol bump, starter kit, server `activateMapDevice`, minimal UI (Device shows the home area, no picker), drops still random-by-theme (area derived from theme: same behaviour) | `src/contracts/{items,game,atlas}.ts`, `src/game/progression/{maps,runs,save,atlas}.ts`, `src/server/{game,db}.ts`, `src/net/{messages,protocol}.ts`, `src/ui/panels/MapDevice.tsx` (logic only) | none (A slice 1 preferred merged first) |
| **R1** | **Routing** | M | `routing.ts` data + `map-routing.ts`, `RunSetup.routing`, loot changes (`makeMap`, chest, boss), pending reveals, advance target, readout block (data), Rook unchanged, harness | `src/data/progression/routing.ts`, `src/game/progression/{map-routing,loot}.ts`, `src/sim/hooks.ts` (context only), tests | T0 |
| **U1** | **Device + chart UI for bound maps** | M | dock flow (3), rail, lenses `Stock`/`Sources`, Map Stash tab grouped by area (no drawer in the Atlas), chip/pips placeholder | `src/ui/atlas/*`, `src/ui/panels/{Atlas,MapDevice}.tsx` (visuals), `src/ui/styles/atlas.css` | T0, R1; A slice 1 |
| **P1** | **Pins, Rook maps, Re-chart, Recycle** | M | account pins, tray UI, bench services, Rook Maps tab, scarab-free | `src/game/progression/{merchant,stats?}.ts` (merchant only), `src/data/items/bench.ts`, `src/ui/panels/{CraftingBench,Merchant}.tsx`, `src/ui/atlas/PinTray.tsx`, `RechartPopover.tsx` | T0, R1 |
| **S1** | **Area scarabs** | S-M | 5 families x 4 tiers, currencies, routing effects | `src/data/scarabs.ts`, `src/data/items/currencies.ts`, `src/contracts/content.ts` (scarab/currency ids only), `src/game/progression/map-routing.ts` (effects hook) | R1; coordinate with B slice 6 (shared registry) |
| **G1** | **Surge** | M | clock util, `atlas.surge`, activation spend/refund, Sand/Grand, loot hook (non-map quantity), pips everywhere, countdown, tree nodes (charges, Afterglow, Sand) | `src/game/progression/{surge,atlas}.ts` (surge parts), `src/data/progression/territory.ts` (surge), `src/server/game.ts` (clock), `src/ui/atlas/SurgePips.tsx` | T0, R1 |
| **B1** | **Beacons and sigils** | M-L | territory data, slots, radius, sigils (36 ids), effect plumbing into `mapModifiers`, Territory lens, BeaconPanel, Rook sigils, tree node re-roles and Lightkeeper | `src/data/progression/territory.ts` (beacons), `src/game/progression/territory.ts`, `src/ui/atlas/{BeaconPanel,SigilPicker}.tsx`, `map-tree.ts` re-roles (coordinate with B) | G1 (territory file split), S1 optional |
| **L0** | **Layout schema, validator, runtime loader, viewer** | M | `src/data/layouts/schema.ts`, `src/sim/layout.ts` (`applyLayout`, zones, boss stage, start), `RunConfig.areaId`, `PropKind` batch (14 kinds), protocol world `areaId`, lint script, `dev/layouts.html`, fallback to old generator | `src/sim/{props,waves,run,bosses}.ts`, `src/contracts/sim.ts`, `src/present/*` (decals/props), `dev/layouts.html`, `scripts/layout-lint.mjs` | none; conflicts with C slice 4 on `run.ts`: land L0 first or rebase |
| **L1** | **Ashen + Chapel packs (10 areas)** | L | layouts 1 to 10 + art kit 1 | `src/data/layouts/{ashen,chapel}/*`, prop art for `vat`, `bellows`, `altar`, `statue` | L0 |
| **L2** | **Ossuary + Crypt packs (8 areas)** | M-L | layouts 11 to 18 + art kit 2 | `src/data/layouts/{ossuary,crypt}/*`, `ribArch`, `iceColumn`, `sarcophagus`, `choirStall` | L0 (parallel with L1) |
| **L3** | **Chainworks + Coliseum packs (7 areas)** | M-L | layouts 19 to 25 + art kit 3 | `src/data/layouts/{chainworks,coliseum}/*`, `crate`, `chainPost`, `hoist`, `gate`, `weaponRack`, `obelisk` | L0 (parallel) |
| **E1** | **Anchor-aware events** (built, 10.5a) | M | Event Director asks the layout for anchors; fallbacks | `src/sim/events/*` (C owns; this is a small PR in their slice) | L0, C slice 4 |
| **F1** | **Polish** | S-M | discovery/pin/surge sounds and banners (A 5.5 ids), reduced motion, telemetry counts, `GAME_SPEC` rewrite (section 14) | `src/audio/sfx.ts`, `src/contracts/audio.ts` (append ids), docs | all |

**Parallel plan for a team of build agents:** T0 -> (R1 and L0 in parallel) -> (U1, P1, S1, G1 in parallel, with disjoint file
sets above; one agent owns `map-routing.ts`) -> B1 and E1 -> L1/L2/L3 in parallel with everything after L0 -> F1. The only
shared hot files are `loot.ts` (R1 then G1 via one hook function), `map-tree.ts` (B coordinate: Milestone, Signpost, Trailmark,
Cartographer's Pen, Survey Stake, Lamp Oil, Charter Ink, Chart Keeper, Lantern-Bearer, Lightkeeper, theme seals, re-roles go in
one PR after G1 and P1 and B1 land, owned by the tree agent), `runs.ts` (T0 owns; later slices add hooks through exported
helper functions, not inline edits), `contracts/content.ts` (S1 and B1 append separate id arrays), and `ui/atlas/render.ts` (U1
owns; later slices add lens modules in new files).
Rough effort: T0 5 to 7 days, R1 6, U1 8, P1 7, S1 3, G1 7, B1 12, L0 10, each layout pack about 3 weeks (design is written
above; the cost is placement tuning, art props and the lint loop), E1 3. Totals: playable area-bound, chart-routed loop (T0, R1, U1,
P1): about 4 to 5 weeks; all systems: about 8 to 10 weeks; layouts in parallel: about 8 to 12 weeks.

## 14. Spec and docs to update when shipping
`GAME_SPEC.md` section 7 (map items, map drops, Atlas, Map Device), section 9 (Rook), scarab table, Atlas tree notes; `CONCEPTS.md`
section 7 ("a map has a base" -> "a map is bound to an area"); `tree-nodes.md` regenerated; `overview.md` slices table
(add T/R/U/P/S/G/B/L/E rows); `ROADMAP.md` (owner maintains).

## 15. Risks and mitigations
1. **Stranded progress.** A player with only low-ceiling maps and no deeper neighbour map. Mitigation: upward rolls re-filter to deeper
   areas; chest advance target BFS; wander tail; bot "stranded" test; Rook sells T2; pins reach anywhere.
2. **Map volume feels worse.** Per-area maps look like fewer useful maps. Mitigation: invariant I1; recycle; chart `Stock` lens;
   routing weights tuned so 60% of maps are for areas you can use next (neighbours).
3. **Surge becomes the default rate.** With 75 charges/day, most runs are boosted (about 20 boosted of 20 for a rotating player).
   Accept about +18 to +24% blended lift; compensate if the harness shows income above target by trimming the surge to +25%/+12% or
   cutting charges to 2 (data-only change). The "normal rate" is what focus-farmers see.
4. **Sigil complexity.** 36 sigil ids and a regional layer is new vocabulary. Mitigation: only 12 kinds x 3 strengths, one readable
   readout line per source, the Territory lens is optional until a player has two beacons; Rook sells Faint sigils so the first slot
   is easy.
5. **Hand-crafted layouts: content volume and solidity.** 25 layouts, 14 props, validation loop. Mitigation: schema plus lint
   first (L0); one theme pack at a time; fallback to the old generator; layouts preserve radii and budgets so balance is
   unchanged; the viewer shows the 680 x 400 view box so designers feel the screen.
6. **Stalker and event fairness with fixed geometry.** Fixed cover can be exploited (always hide at pillar X). Mitigation:
   the anchor pool is larger than one; the perch is seeded; the pounce counters with straggler logic; exploit-by-design is the
   "learnable layout" the owner asked for, not a bug.
7. **Migration edge cases.** Maps of a theme the account cannot reach; trade offers with unbound maps in flight. Mitigation: 2.6 fallbacks,
   `discovered` add as the last resort, a server-side guard that blocks activation of an unbound map and auto-binds with the
   same function, idempotent and pure.
8. **Protocol and contract churn** (PropKind, `RunSetup`, `areaId` in world info, protocol bump) collides with A, B and C. Mitigation: T0 and
   L0 land early and are small; the ownership table above; contracts changed only by the owning slice.
9. **Digest/golden churn.** Removing `worldRng` layout consumption changes pack placement. Mitigation: one planned golden
   re-baseline in L0 (layout RNG isolated by forking a `layoutRng`; pack stream keeps its old seed so only placement positions, not
   plan composition, differ).
10. **Clock edge cases.** Players near 04:00 UTC, server restarts across reset, time skew. Mitigation: server-only lazy reset, pure
    `forgeDay`, frozen `RunSetup.surge`, injected clock tests; a notice when the countdown crosses while the dock is open.
11. **Undiscovered-area maps from trade.** Mitigation: they cannot be opened (I2) but can be re-charted or recycled; tooltip says
    "Unexplored territory".
12. **Tree shifts pricing.** Re-roling smalls changes the ledger; B's audit test must be rerun and any drift re-tuned
    (pin slot, charge and Sand nodes are priced at 1u to 4u above).
