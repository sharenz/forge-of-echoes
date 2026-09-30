# Atlas tree: the encounter interface (for the Event Director)

Stream B (the tree) owns the data and rules; stream C (Event Director v2) owns what happens in the sim. This is the seam.

## What exists now
- **Status: the `events` engine is live** (`ATLAS_LIVE_ENGINES` in `src/data/progression/map-tree.ts`). The lenses of the six encounters
  that exist (Stalker, Echoing, Caravan, Rival Crowns, Fault, Ember Relay), the three event smalls (Echo Dust, Long Fuse, Quick Study), Twin Omens
  and Sworn to the Veil are allocatable. The lenses of the six encounters not built yet (Pact Altar, Orchard, Ring, Host, Anvil, Bellwatch) and
  Voidtouched Atlas (needs the Void Breach event) stay locked: `ATLAS_BUILT_EVENTS` lists the encounters that exist and must equal the keys of
  `ATLAS_EVENT_TO_KIND` (`src/game/progression/map-event-rules.ts`; a test keeps them in step). When a new encounter ships, add it to both.
- Rules flow: allocated nodes -> frozen expedition (`setup.mapTree`) -> `resolveAtlasRules(...).extraRules` -> `mapEventRules(atlas, map)` ->
  `slate` (creation: extra slots, chance, mandatory; used by `rollMapEvent` and `mapEventOdds`) and `sim` (`RunConfig.eventModifiers`, read by the
  Event Director). `tests/game-progression/map-event-rules.test.ts` covers lenses, Twin Omens and Sworn to the Veil end to end through `openMap`/`buildRunConfig`.
- First completions: the sim reports `SimOutcome { t: 'eventComplete', kind, grade }`; `src/server/game.ts` maps the kind with `atlasEventIdOf` and credits
  `creditEventCompletion` to every account present in the map (idempotent, committed with the character). Tier and boss credits still ride the per-run
  receipt (`awardAtlasCredit`). Covered by `tests/server/atlas.test.ts`.
- Not built (text no longer claims them): Twin Omens' Backlash pack on a failed encounter; Sworn to the Veil's withheld chest upgrade and wave-4 sigils.
- Encounter chance smalls (+2 points each, capped at +12 by `ATLAS_CAPS.eventChancePoints`) and Veilwalker (+4% quantity on maps with an encounter)
  flow through `mapEventOdds(map, areaId, nodes)` / `rollMapEvent` (`mapTreeBonuses(nodes).eventChance`), so relative odds and the 65% cap behave as before.

## Ids
`ATLAS_EVENT_KIND_IDS` (`src/contracts/atlas.ts`), the twelve kinds that each grant one Atlas point on their first completion:
`stalker`, `echoing`, `caravan`, `rivalCrowns`, `fault`, `emberRelay`, `pactAltar`, `orchard`, `ring`, `host`, `anvil`, `bellwatch`.
These are independent of the current `MAP_EVENT_KINDS` (six old kinds); map your event ids onto them.

## Points: credit a first completion
```ts
import { creditEventCompletion } from 'src/game/progression/atlas';
// pure, idempotent: returns the same object when the kind is already in atlas.eventsSeen or is not one of the twelve
const next = creditEventCompletion(character.atlas, 'stalker');
```
Call it from the server's per-account run receipt (the same place `discoverAfterBoss` runs, `src/server/game.ts` `awardAtlasCredit`)
for every present party account when an encounter is completed at any grade. The persisted receipt row today carries area, seed and the
cleared tier; an encounter receipt needs its own column or table (the same pattern: `atlas_credit_queue`, a migration in `src/server/db.ts`).
`atlas.eventsSeen` is validated against the twelve ids on every load (`normalizeAtlas`).

## Rules the sim / director reads
`resolveAtlasRules(setup.mapTree, ctx)` (`src/game/progression/atlas-rules.ts`) returns a frozen object per expedition. Every rule an
engine other than the map rules interprets is collected in `extraRules: { node, rule }[]` (only from allocated nodes whose engine is live).
Build `ctx` with `{ tier, baseId, corrupted, areaId, event }` (`treeContextOf(setup)` gives the last two).

```ts
type AtlasRule =
  | { id: 'eventLens'; event: AtlasEventKindId; effect: string; danger: string }   // one per encounter: the event gets better AND harder, both in the text
  | { id: 'eventSlots'; extra: 1; rewardMore: -25; backlash: true }                  // Twin Omens: second independent slot, different kind, different wave window
  | { id: 'eventsAlways'; rewardMore: 30; mandatory: true; timeoutSeconds: 90 }     // Sworn to the Veil: 100% chance, mandatory, soft timeout then fail
  | { id: 'voidBreach'; strength: 50; uncorruptedQuantity: -10 }                     // Voidtouched Atlas: corrupted maps always roll a Void Breach
  | { id: 'eventSmall'; effect: 'ingredientChance' | 'timers' | 'gradeEase'; value: number }; // Echo Dust +10% ingredients, Long Fuse +10% timers, Quick Study 5% easier grades
```
The `effect` and `danger` strings of a lens are the player-facing wording; the numbers inside them (for example "20% less HP") are
the contract for the event's tuning. Keep the two in step: each lens must change exactly the thing its text names, and add exactly
the danger it names. `tests/game-progression/atlas-tree.test.ts` asserts every lens is present once per event kind.
- Caps: encounter chance from the tree is capped at +12 points (the map's overall 65% cap still applies) except Sworn to the Veil (100% by design).
- Twin Omens and Sworn to the Veil exclude each other (`excludes`, checked by the allocation rules).
- Nodes never touch character stats or tier; they change only the encounter's own tuning, slots, timers and reward multipliers.

## Turning on a new encounter
1. Build the encounter in the sim and add its kind to `MAP_EVENT_KINDS` and `ATLAS_EVENT_TO_KIND` (map-event-rules.ts, including its lens effect in `mapEventRules`).
2. Add the atlas id to `ATLAS_BUILT_EVENTS` (map-tree.ts): its lens node becomes allocatable.
3. Update the expected lists in `tests/game-progression/atlas-tree.test.ts` and `map-event-rules.test.ts`, regenerate `docs/atlas-rework/tree-nodes.md`
   (`UPDATE_ATLAS_DOC=1 npx vitest run tests/game-progression/atlas-tree-spec.test.ts`), and add the encounter archetypes (Echo Chaser) to
   `tests/game-progression/atlas-tree-harness.ts`.

Other pending engines follow the same flag: `sim` (Warded Hunts, Stragglers' Cull), `device` (Lantern-Bearer, Fifth Socket, Twinned Sockets,
Single-Minded Furnace: scarab sockets, same-family scarabs, scarab keep chance, essence attunement at the Map Device) and `items`
(Wagered Charts: the account-bound chest map). Their rule shapes are typed in `src/data/progression/atlas-tree/types.ts`.
