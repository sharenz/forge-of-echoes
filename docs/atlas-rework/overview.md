# Atlas, Atlas tree and map events: overview

Three briefs: `A-atlas-visuals.md`, `B-atlas-tree.md`, `C-map-events.md`. Design only; nothing built or committed.

## 1. Diagnosis in one paragraph
The first implementation got the *data* right (25 areas, reciprocal routes, ceilings, sealed sites, account discovery,
frozen expeditions, a shared modifier resolver) and everything the player touches wrong: the Atlas is a form of text plates
on a scroller (`src/ui/panels/Atlas.tsx`), the tree is 15 percent-boosts in 5 chains (`src/data/progression/map-tree.ts`), and
the six events are one spawn function (`spawnPulse` in `src/sim/map-events.ts`) wearing six labels. The rework keeps the
data and the rules plumbing and replaces the experience on top of them.

## 2. Shared design pillars
1. **Light is progress.** The Atlas is a charred chart your kills light up; the tree is a brass instrument you wire up;
   events leave marks on the ground. Everything the player has done is visible in the world.
2. **Every choice has a price and a face.** Reward is always paired with a visible danger, priced on one table (the map-mod
   exchange rate, brief B 4.1). Tree nodes, map mods, scarabs and event pacts are all denominated in the same "units".
3. **Verbs over percentages.** More than half of the notables and all 14 keystones change how a run *plays* (boss on wave 3,
   no magic packs, a second event, carrying a flame), not how big a number is.
4. **Events are questions.** Each has a decision the player can get wrong visibly, pays Bronze/Silver/Gold from an on-screen
   measure, and never punishes with progress loss.
5. **Earned, not skipped.** Tiers stay the spine: the tree never touches tier or monster level, points come from the ladder
   (areas, tiers, events, bosses), 10+ tier-1 maps before tier 2 remains fine, tier-bonus nodes scale *with* the ladder.
6. **Readable first.** Telegraph before damage (>= 1.0 s), event VFX under the telegraph layer, no power-ups (CONCEPTS
   section 1), one-shots legitimate, elemental-proof rares as walls are a feature (Warded Hunts, Rare or Nothing).
7. **From the game's own materials.** Atlas ground is baked from the in-game floor tiles, props and monster sprites; events
   reuse the sim's area/telegraph system and brains; tree effects reuse the modifier resolver. New art is limited to plates,
   emblems, glyphs and a few props.
8. **Server-authoritative and deterministic** by construction: hidden seeded plans, dwell-based choices, ids and fixed order,
   digest coverage.

## 3. How the three parts fit together

```
            ATLAS (A)                    CODEX / TREE (B)                     EVENTS (C)
   where you go and what it looks like   how your expeditions are shaped       what happens on the way
   25 areas, 6 regions, 6 themes  --->   ~148 nodes, 14 keystones      --->    12 events, grades, 3 roster skins
        |                                    |                                     |
        | tier ceilings, area types,         | 12 event lenses, Twin Omens,        | plans drawn at map creation from
        | theme, boss, key doors             | Sworn to the Veil, theme seals,     | area type, mods, scarabs, tree
        v                                    v                                     v
                      MAP DEVICE DOCK: map + 4/5 scarabs + readout  (one place, always visible)
                                             |
                                      EXPEDITION (frozen: map, mods, scarabs, tree rules, event plans)
                                             |
                                    sim: waves + Event Director v2 + rules  ->  loot hooks (rollEventReward, chest)
```
- The **Atlas** decides *where* (theme, roster, drop specialties, event bias); the **tree** decides *how the map plays*
  (rules frozen into the expedition); **events** decide *what asks you a question* (slate drawn from area + mods + scarabs
  + tree).
- Shared vocabulary: units (danger vs reward), grades (Bronze/Silver/Gold), glyphs (event ring glyphs appear as chips in
  the Atlas rail and as lenses in the Codex), region and branch colours (one palette).
- Shared engine seams: `MapEffectDef`/resolver (tree and mods), `WaveConfig`/`planWave` (keystones and pacts), area effects
  and brains (events), `RunHooks` (event and chest rewards), `AtlasProgress` (points, discovery, tiers cleared).

## 4. Recommended build order (shippable slices)

Sizes: S = a few days, M = about 1 to 2 weeks, L = 3+ weeks of focused work. Each slice is deployable on its own and
leaves the game consistent.

| # | Slice | Size | Delivers | Main risks | Depends on |
|---|---|---|---|---|---|
| 0 | **Table prototype** (throwaway page): baked ground, fog, 25 plates, roads at 2x; screenshots at 1024x600 and 1280x720 | S | owner signs off the *look* before any UI work | art quality of emblems and plates; if it looks weak, iterate here, cheaply | none |
| 1 | **Cartography Table v1** (A): canvas chart, nodes, states, roads, fog, detail rail with real boss/family sprites, bottom dock (map, scarabs, readout), zoom/pan, tooltips, sounds; existing `data-area` selectors kept; no gameplay change | M-L | fixes the owner's complaint #1 for the map; instantly visible | first-open bake hitch; 1024x600 layout; test selector churn | 0 |
| 2 | **Codex data + points + migration** (B, E0/E1 nodes only): new node graph (~110 nodes with plain stats and weights), point sources (areas, tiers cleared, events seen, bosses seen), respec costs, one-time free respec, caps and ledger audit test, archetype bot harness | M-L | the deep tree exists in data and rules; balanced by measurement | ledger calibration; save migration; scope creep of E2 nodes | 1 helpful, not required |
| 3 | **Codex UI** (A section 8): wheel screen, path preview, allocation feedback, rail, search, sounds | M | tree is a place, not a list | 150 nodes at 1024x600; glyph quality | 2 |
| 4 | **Event Director v2 + port the six** (C 4, 11.1): multi-instance runtime, primitives, view V2, `rollEventReward`, generic HUD/drawers, old events behaviour-equivalent | L | the foundation; no visible regression | protocol bump, restart semantics, digest drift | none (parallel with 1 to 3) |
| 5 | **Stalker + Echoing** (C 6.1, 6.2) with grades, sounds, glyphs, theme variants | M | first "wow" events; proves grades and kill log | balance of grades; readability of echoes | 4 |
| 6 | **Keystones, batch A** (B): Blank Slate, Single-Minded Furnace (attunement in the dock), Kingslayer's Tithe, Early Crown, Empty Halls, Thrill of the Hex, Overrun Doctrine + 3 new scarab families | M | structural nodes that need only config/rules | wave-director edge cases (boss on wave 3 with stacks), scarab/wave floor | 2, 3 |
| 7 | **Caravan + Fault** (C 6.3, 6.4) | L | the two most mechanically new events | wagon pathing, `hurts:'all'` balance | 4 |
| 8 | **Rival Crowns + Ember Relay** (C 6.5, 7.1) | L | boss-time and carry mechanics | second boss budget/fairness; carried-object edge cases (death, disconnect) | 4, 5 |
| 9 | **Choice events** (Pact, Orchard, Anvil) + keystones batch B (Twin Omens, Sworn to the Veil, Voidtouched Atlas, Wagered Charts, Dead-End Devotee, Twinned Sockets, Rare or Nothing) | M-L | events that touch crafting; multi-slot | chest-hook complexity; Void Breach event to define | 4, 6 |
| 10 | **Ring, Host, Bellwatch** (C 7.4 to 7.7) | M-L | late-tier variety | encounter budget; Host performance (24 statues) | 4 to 9 |
| 11 | **Polish**: discovery cinematic, reveal sound polish, loadouts for the Codex, telemetry counts | S-M | feel | reduced-motion, save flags | 1, 3 |

Why this order: slice 0/1 answer the owner's loudest complaint with the least gameplay risk; slice 4 runs in parallel because
it is pure engine; slices 2 and 5 deliver the first *felt* depth (points and the first flagship events) so the owner can play
before all 14 keystones exist. Nothing needs the future passive tree or the Barbarian.

Rough total: about 4 to 6 months for one focused developer-equivalent; 1 to 5 can be shipped in about 8 to 10 weeks.

## 5. What to test with bots vs playtests

| | Bots (automated, deterministic, on every change) | Human playtests (owner, small group) |
|---|---|---|
| Atlas (A) | graph/coordinate tests (no overlap, all edges drawn, reachable at every zoom), typography test, existing `atlas` browser scenarios at both sizes, bake time budget, screenshot diffs for states | first-impression legibility (can you tell state/tier/theme without reading), cinematic feel, dock flow clarity |
| Tree (B) | node-graph invariants, ledger audit (units per node inside band), caps, exclusion symmetry, 12 archetype presets x tiers 3/7/11/15: value/hour, deaths per 100 maps, clear time, "must-take" detection, save migration, frozen-expedition tests | did the path feel like choosing, keystone regret, understandability of readout numbers, 30-minute session per archetype |
| Events (C) | completion rate and grade distribution per event/tier, death-rate delta, event duration and wave-stall bound, determinism digest with events on, fairness assertions F1 to F7, capacity, party-of-4, restart mid-event, sim tests for kill log/echo/lure/lock/pact resolution | readability of glyphs and telegraphs, "what should I do?" at 5 s, Gold feel, pacing with waves, variety per theme, party play |

## 6. Open questions for the owner (max 10, most important first)

1. **Art gate.** Approve the "Ember Chart" direction (charred vellum that your kills light up, plates on a tier
   material ladder, boss and monster sprites in the inspector) via a static prototype *before* building interactions?
   **Default: yes, slice 0 first; if the emblems look weak, we iterate there.**
2. **Tree shape and scale.** One wheel of about 148 nodes in six branches, 60 attainable points, keystones cost 2 and you
   end with 2 to 3 of 14, four hard exclusion pairs. **Default: yes.** (Alternative: a smaller ~90-node tree; I advise against, it
   returns to "shallow".)
3. **Point sources.** 25 area first-clears + 14 tier first-clears + 12 first event completions + 6 first boss kills + 3
   Atlas milestones = 60, replacing the 10-point cap. **Default: yes; existing accounts get a one-time free respec.**
4. **Respec cost.** Scrap by node class (small 5, notable 15, keystone 40), first 6 refunds free, 120 Scrap cap per session,
   loadouts later. **Default: as stated;** ROADMAP asks to watch the Scrap balance, this is a mild sink.
5. **Event frequency and pacing.** Raise the base chance of at least one event from 25% to 45% (still capped 65%), events overlay
   the waves instead of pausing them, at most 2 per map (3 with Twin Omens). **Default: yes, with a per-slot cap.** Events
   remain hidden before entry; the Map Device keeps exact odds.
6. **Grades everywhere.** Every event pays Bronze/Silver/Gold from a visible measure (time, whiffs, echoes, locks), and
   Gold is 20 to 30% for a matched player. **Default: yes.** This changes today's flat payouts; Bronze equals the current payout.
7. **Scarab families.** Add three or four more scarab families (Ambush, Omen per event, Gilded, Cartographer's) so 4 to 5
   sockets and the tree's scarab nodes have something to do. **Default: yes, slice 6; Omen scarabs (one per event) after events exist.**
8. **Rival Crowns replaces "the same boss twice".** The second boss is another theme's boss with a lite kit and its own
   unique pool; the Sealed Reliquary keeps a Twin Crown variant. **Default: yes.** (Risk: fairness budget of two bosses.)
9. **Crafting-adjacent events and keystones.** Wayside Anvil (chest boons), Blank Slate (only Normal equipment) and Single-Minded
   Furnace (attuned essences) push farming toward specific crafting projects. **Default: keep; they serve the core pillar.**
   Confirm you are happy with a keystone that removes Magic/Rare equipment drops entirely (opt-in, crafters only).
10. **Atlas as its own screen.** Replace the Map Device panel with a full-screen Cartography Table (chart + inspector rail +
    always-visible device dock, tree as a second tab, hotkey `M`), and rename the tree "Codex" in the UI. **Default: yes; the
    panel id and stash drop targets stay.**

Also worth a glance (not blocking): the seen-set for "new area" cinematics lives in the browser first (per-viewer), not
the account; a "Reduce motion" setting is needed anyway.

## 7. Files
- `/private/tmp/claude-501/-Users-romanreithmayer-projects-crafty/6cdc744a-b9b9-449a-ba97-019f481f0594/scratchpad/design/overview.md`
- `.../A-atlas-visuals.md`
- `.../B-atlas-tree.md`
- `.../C-map-events.md`
