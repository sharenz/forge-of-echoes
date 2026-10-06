# E. Build plan: slices, file ownership, tests, migration

Status: R1 built and deployed 2026-10-06; R2 slices C2 and SK0 built 2026-10-06 (see their status notes); the rest are design. Sizes: **S** = a few days, **M** = 1 to 2 weeks, **L** = 3+ weeks of focused work for one agent. Each slice is deployable on its own and leaves the game consistent.
`power-curve.md` (P), `skills.md` (SK) and `passive-tree.md` (PT) hold the designs these slices implement; `overview.md` has the pillars and the migration summary.

---

## 1. Order: ship value early

| Release | Slices | What the owner feels | Rough size |
|---|---|---|---|
| **R1 "Power"** | C1, P0, P1, P2, P3 | the high tiers become playable (T6 to T15 curve), penetration/exposure/DoT exist, proof rares have answers, rares are real fights, new affixes, bench pen, ten uniques, utility flasks; clear-speed harness fixed | about 4 weeks one agent, 2 to 3 weeks with lanes |
| **R2 "Skills I"** | C2, SK0, SK1, SK2 | 8 loadout slots, rank 10, augment system, 10 new skills (levels 3 to 18), new Skills panel | about 7 weeks, 4 with lanes |
| **R3 "Skills II"** | SK3, SK5 | 10 more skills (levels 20 to 40), 80 flagship augments (behaviour changes) | about 6 weeks, 3 to 4 with lanes |
| **R4 "Skills III"** | SK4, SK6 | the last 12 skills (levels 44 to 62), the remaining 57 augments | about 3 weeks |
| **R5 "Orrery"** | C3, PT0, PT1, PT2, PT3 | the 252-node passive tree, Boss Marks, respec | about 7 weeks, 4 to 5 with lanes |
| **R6 "Balance"** | B1 | harness-driven pass over everything, GAME_SPEC sync, ROADMAP update | about 2 weeks |

Why this order: R1 is independent of any new skill and fixes the owner's top-ranked problem (item 2 of the roadmap) first; the model, the curve and penetration are what every later slice is balanced against.
R2 is the biggest structural change (executor, schema, migration, protocol) so it goes before content. R3 and R4 are content on a stable executor and parallelise by element. The passive tree comes last because it needs the
skill and augment vocabulary to reference (Primary Practice, chains, echoes, exposure) and its balance needs the finished skill roster.

---

## 2. Slices (each with files, dependencies, exit criteria)

### C1: Contract steward, release 1 (S)  (first in R1, alone)
`src/contracts` is frozen: contract changes go in small dedicated slices merged **before** the parallel lanes start, so no lane waits on or conflicts over a contract file.
- `src/contracts/items.ts`: `STAT_IDS` + `firePen coldPen lightningPen voidPen physicalPen elementalPen projectileDamage areaDamage damageOverTime maxResistance extraChains flaskChargeOnKill`; `AffixTag` + `penetration`.
- `src/contracts/sim.ts`: `PlayerCombatStats` gains `pen: Record<DamageType, number>`, `maxResist`; `ELITE_BIT` gains `voidProof`, `physicalProof` (append-only); `MonsterScaling` unchanged.
- `src/contracts/content.ts`: new `FlaskId`s (quickstep, aegis, quicksilverMind), `CurrencyId` umbralEssence, `UniqueId`s (10 new).
- Protocol: `PROTOCOL_VERSION` 25 → **26** (the shared rules change: new stats, curve, affix text; the repo's practice is that old clients reload on a rules change). C2 bumps to 27, C3 to 28.
- Exit: typecheck; no behaviour change.

### P0: Data re-curve (S)
Owner lane **balance-data**. Files: `src/data/progression/classes.ts` (`LEVEL_CAP` 80), `src/data/progression/maps.ts` (`MONSTER_LEVEL_SCALING` segments, `monsterLifeScale`, `monsterDamageScale`), `src/sim/constants.ts` (mirror),
`src/sim/archetypes.ts` and `src/sim/spawn.ts` (`RARE_LIFE_FLOOR`, void/physical proof weights, double proof), `src/data/progression/bestiary` if rare mods are documented there, `GAME_SPEC.md` sections 3, 7, 8.
Tests updated: `tests/sim/balance-curve.test.ts` (ML34 and ML40 expectations), `tests/game-progression/maps.test.ts` (curve table = `power-curve.md` 6.1), `stats.test.ts`, `spec-sync.test.ts`, `balance-*.test.ts` with `BALANCE=1`.
Exit: curve table 6.1 pinned as a data test; ML4 to ML28 numbers bit-for-bit unchanged; fresh-character playthrough unchanged (0 to 2 deaths, 9 to 10.4 minutes).

### P1: Damage pipeline v2 (M)
Owner lane **combat-core** (the only lane allowed to touch `sim/combat.ts`, `sim/stores.ts`, `sim/debuffs.ts`, `game/progression/{model,stats}.ts` during R1). Depends on C1.
- `src/data/progression/combat.ts` (new): `PEN_CAP`, `EXPOSURE`, `DOT_RESIST_FACTOR`, `MORE_CAP`, caps table of `power-curve.md` 11.
- `src/sim/combat.ts`: `damageMonster` order of 3.1 (cap → pen → exposure → taken), DoT factor in `applyAilment`/`tickIgnite`, source player's `pen` read from `w.playerById[source].stats`; conversion shares plumbed through `ProjectileSpec` (two types);
  `src/sim/stores.ts`: monster exposure columns (`expose[5]`, `exposeTime`) and projectile `convTo/convShare`; `src/sim/debuffs.ts`: **player** resist rule `min(75 + maxResist, uncapped − penalty)` (buffer rule), Withered on the uncapped value.
- `src/game/progression/{model,stats,skills}.ts`: new stats in `damageStatsFor` (tag stats), `PlayerCombatStats.pen/maxResist`, the `more` cap, caps (cast speed, crit, area, projectiles, chains), sheet lines and breakdowns, skill tooltip lines "Penetrates N%".
- `src/sim/digest.ts`, `tests/sim/determinism.test.ts`: new fields enter the digest.
Exit criteria: the proof-rare matrix of `power-curve.md` 4.3 and the layer order are unit tests of `damageMonster`; pen cap, floor at 0, exposure floor −25, bosses half exposure, DoT factor, overcap buffer all have a test.

### P2: Affix, crafting, uniques and flasks pass (M)
Owner lane **items**. Depends on C1; parallel with P1 (touches no combat file).
- `src/data/items/affixes.ts`: the ten new affixes (`power-curve.md` 10.1), ladders; `src/data/items/stat-text.ts` labels; `src/data/items/bench.ts` recipes (`recipe('firePen')`...), `src/data/items/currencies.ts` (Umbral Essence and the essence tag mapping), `src/data/items/uniques.ts` (10 uniques; flags that need later slices are **data-complete but gated**: the flag text appears only once its behaviour exists, as the Atlas "Awaits" nodes did),
  `src/data/items/flasks.ts` + `src/game/progression/flasks.ts` (utility flasks, kill charges), `src/game/items/*` (drop pools: uniques into the world/boss pools; essences into drop tables) and `src/game/progression/loot.ts` (Umbral Essence source: Void Breach, T8+ void bosses).
- Art: flask and unique icons (`src/art/icons`), essence icon.
- Tests: `tests/game-items/*` (affix tables, bench resolves every recipe, tag coverage), drop-weight tests, `spec-sync`.
Exit: `AFFIX_VERSION` unchanged (no existing affix changed); an old save loads; the bench offers T4 pen on a ilvl 40+ wand.

### P3: Character harness and the Atlas harness fix (M)
Owner lane **harness** (tests only; no src files except test helpers). Depends on P1 (formulas) for the numbers it asserts; can start in parallel against the analytic model of `power-curve.md`.
- `tests/game-progression/character-model.ts`: the analytic band model (`build(ml, band)`) of power-curve section 5 as code, **used as the specification** the real rules are compared with.
- `tests/game-progression/character-harness.ts`: builds `CharacterSave`s for an archetype/band/ML through the real rules (gear generated with the real affix tables at ilvl = ML, tiers by band, passives/augments by preset), then `rules.playerRuntime`.
- `tests/sim/character-bands.test.ts`: sim playthrough with the bot of `tests/sim/bot.ts` (extended with a per-archetype cast script) for boss TTK, pack kill time, hit sizes, deaths.
- Atlas harness: `tests/game-progression/atlas-tree-harness.ts` takes `speed` from the band model instead of the empty-tree calibration; acceptance (d) of B-atlas 10.3 replaced by `power-curve.md` 9.2.
Exit: the three band tables of `power-curve.md` 5.2 reproduced within ±15% by the rules path and ±30% by the sim; the Atlas archetypes now show clear-time deltas (not all slower than baseline).

### C2: Contract steward, release 2 (S)
`SkillId` list grows to 32 (append-only), `LOADOUT_SLOTS` 6 → 8, `LOADOUT_KEYS` + `Space`, `Z`; `CharacterSave` gains `augments`, `loadoutPresets`, `respecTokens`, `respecFreeUsed`; `PlayerFlag` + new flags; `PROJECTILE_KINDS` and `SimEvent` appended for new skills;
net commands (`pickAugment`, `refundAugment`, `setPreset`, `respec`); **`PROTOCOL_VERSION` 26 → 27**. Frozen-contract change recorded in `ARCHITECTURE`/ROADMAP.

**Status: built 2026-10-06.** 32 `SKILL_IDS` (appended); `LOADOUT_SLOTS` 8 with `Space`, `Z` (`LOADOUT_PRESETS` 3, `LoadoutPreset`);
`CharacterSave.skillRanks` became `Partial` and gained the optional `augments`, `loadoutPresets`, `respecTokens`, `respecFreeUsed` and
`legacySkillRanks` (the rollback copy and the migrated marker); `SkillRuntimeDef.augments?: AugmentRuntime[]` (`echo`, `fan`, `invulnerable`,
`AUGMENT_PRIMITIVES`); `SkillInfo` gained `element`, `unlockLevel`, `available`, `augments: AugmentInfo[]`; `SkillSheet.augmentLines`;
`GameRulesApi` gained `skillPointsTotal`, `canPickAugment`, `pickAugment`, `respecPrice` (`RespecPrice`), `refundAugment`, `respec`, `setPreset`;
commands `pickAugment`, `refundAugment` and `respec` (both with `expectedScrap`), `setPreset` (`save`/`load`/`rename`). **Protocol 27 → 28**
(B1 had already taken 27). No `PlayerFlag`, `PROJECTILE_KINDS` or `SimEvent` was needed yet: the seven shipped skills and their live augments
reuse the existing flags, kinds and events; SK2 appends what the new skills need.

### SK0: Skill schema, executor, migration (L)
Owner lane **skills-core** (sole owner of `sim/skills*`, `data/progression/skills*`, `game/progression/skills.ts`, `game/progression/character.ts`, `game/progression/save.ts`, `src/server/{commands,game,characters}.ts` for skill commands). Depends on C2, P1.
- `src/data/progression/skills.ts` becomes `skills/` (`index.ts`, `fire.ts`, `cold.ts`, `lightning.ts`, `void.ts`, `utility.ts`) and `augments/` (same split) with the schema of `skills.md` 4.2: `SkillDef` gets `unlockLevel`, `emitter`, `augments: AugmentDef[]`; `MAX_SKILL_RANK` 10.
- `src/game/progression/skills.ts`: `skillPointsTotal`, `canRankUp`, `pickAugment/refundAugment`, slot/tier/exclusion rules, `resolveSkill` with augments, Focus sustain, tooltips; `character.ts`: 2 skill points per level.
- `src/sim/skills/` (new directory): `executor.ts` (emitters and the primitive pipeline), one file per primitive group (`projectile-mods.ts`, `ground.ts`, `buffs.ts`, `exposure.ts`), the existing seven skills **re-expressed as data** (no behaviour change; regression tests pin them).
- `src/game/progression/save.ts` + `migrate-skills.ts`: `SAVE_VERSION` bump; `newRank = ceil(oldRank / 2)`; unspent recomputed; loadout padded to 8; `respecTokens = 1`; unique flags mapped to item-granted augment effects.
- Server: commands for augments/respec/presets; atomic Scrap payment for refunds.
Exit: all old skills behave as before at the migrated ranks (bot clear times within 5%); migration property test (`newUnspent ≥ oldUnspent`, no skill unlearned); 8 slots in the sim and the net layer.

**Status: built 2026-10-06** (one lane, after C2). Done: `data/progression/skills/` (index + fire, cold, lightning, void (with physical),
utility) holds all 32 skills (`unlockLevel`, `element`, `emitter`, `available`; the 25 unshipped ones carry their first-pass numbers and
cannot be learned) and `data/progression/augments/` the full augment tables of the seven shipped skills (44 augments; 17 are live, the rest
are `planned` on a primitive that ships in SK5); `MAX_SKILL_RANK` 10, 2 skill points per level, unlock by level, no prerequisites;
`game/progression/skills.ts` resolves augments (set/add/scale on base numbers, `more` into the more pool, count, pierce, chain, shape, echo,
invulnerable, flags) and has the slot/tier/exclusion rules, points, respec pricing (free below 20, first 15 points free, 4 Scrap per point),
`refundAugment`/`respec` (Scrap paid in the same character value), presets and tooltips; `src/sim/skills/` replaces `sim/skills.ts`:
`executor.ts` (emitter dispatch, the echo primitive), `emitters.ts` (projectile fan, burst, chain, dash), `projectile-mods.ts`, `buffs.ts`,
`ground.ts`, `behaviours/<element>.ts` (the seven skills as data). The determinism goldens are **bit-identical** (no re-pin): for the same
runtime defs the executor spawns, damages and emits in exactly the old order, so the old skills' bot clear times are unchanged (0%, not just
within 5%). Server commands for augments, refunds, respec and presets (refunds and respec in a hideout; preset loads in a hideout); the HUD and
the old Skills panel show 8 slots (`Space` shows as `Spc`, `Z`), the panel lists only playable skills.

**Migration (owner decision 2026-10-06, overrides the `ceil(oldRank / 2)` mapping of section 5 and skills.md 9):** save version 3 refunds
every skill point: every skill goes back to unlearned except Ember Lance (innate rank 1, free, on `LMB`), unspent = `1 + 2 (L − 1)`, no
augments, loadout reset, `respecTokens` 0 (nothing to compensate), old ranks kept in `legacySkillRanks`. Property test: unspent equals the new
total (so never less than before), only the basic attack learned, no augments; unique flags stay valid.

Deferred from SK0: the respec session cap (120 Scrap per session needs server session state), attribute respec for Scrap, the Bellwether
(`slotOneAugments`) extra slots and Hardened Ember's raised ward cap (both need the sim/combat ward cap and the items lane's `awaits` gate),
Overheat's ignite effect and Rift Echo's free third blink (planned primitives), the Focus-sustain and power-budget table tests for new skills
(SK2), and the augment UI (SK1).

### SK1: Skills panel v2 and HUD (M)
Owner lane **ui-skills**. Depends on C2; can start against mocked data before SK0 ends.
Files: `src/ui/panels/{Skills,SkillTooltip}.tsx`, `src/ui/lib/{skilltree,loadout}.ts`, `src/ui/hud/*` (8 slots, augment pips), `src/client` input for `Space` and `Z`, `src/ui/panels/Character.tsx` (points, respec entry), CSS using only `--font-ui-*` tokens.
Features: skill book rail, augment graph with before/after deltas, loadout bar with 8 slots and 3 presets, drag/click assignment (existing helpers), refund confirmation with Scrap price, locked skills with level, Alt comparison.
Tests: component tests, keyboard-only flow, 1024×600 and 1280×720 browser scenarios (the guide's existing e2e style).

### SK2: Roster batch 1 (L)  (R2)
Owner lane **skills-fire-cold-light** (data + sim behaviour + presenter) per element file. Depends on SK0.
Skills: Phase Stride, Glacial Nova, Spark, Cinder Mortar, Arcane Reprieve, Umbral Bolt (+ Decay in `sim/debuffs`), Kinetic Lance, Frost Orb, Storm Call, Glacial Spikes (unlock levels 5 to 18).
Files per element (so parallel agents do not collide): `src/data/progression/skills/<element>.ts`, `src/sim/skills/behaviours/<element>.ts`, `src/present/skills/<element>.ts`, `src/art/skills/<element>.ts` (sprites/decals), `src/audio` cue tables `skills-<element>.ts`.
Exit: each skill's isolated sim test, its tooltip numbers equal the sim's, a presenter smoke test, power-budget table test.

### SK3: Roster batch 2 (L)  (R3)
Gravity Well, Rime Bulwark, Immolation Sigil, Static Aegis, Voltaic Pulse, **Entropy Hex** (exposure applier), Concussive Blast, Static Lash, Echo Sigil, Wither Field (levels 20 to 40). Same lanes as SK2. New sim systems: pull, barrier, Withered-on-monsters.

### SK4: Roster batch 3 (M)  (R4)
Meteor Rain, Storm Step, Tempest Surge, Blizzard, Event Horizon (levels 44 to 62).

### SK5: Flagship augments (L)  (R3)
Owner lane **augments**. The 13 flagship skills' 80 augments (data) plus every primitive they need (`lodge`, `split`, `fork`, `convert`, `expose`, `bounce`/`return`, `mark`, `shape`, `trail`, `onKill`); unique flags mapped.
Files: `src/data/progression/augments/*.ts`, `src/sim/skills/primitives/*.ts`, `src/present/skills/augments.ts` (status icons, lodge/mark visuals), tests per primitive. Depends on SK0; runs in parallel with SK3 (different files).

### SK6: Remaining augments (M)  (R4)
The 19 other skills' 57 augments, polish of tooltips and the augment UI; `Bellwether` and `Twice-Struck Bell` uniques go live (they depend on slots and lodge).

### C3: Contract steward, release 5 (S)
`CharacterSave` gains `passives`, `masteries`, `bossMarks`; `PassiveNodeId`; commands `allocatePassive`, `refundPassive`, `chooseMastery`; **protocol 27 → 28**; `StatModifier` source label "Orrery".

### PT0: Passive data, rules, save, server (L)
Owner lane **passives-core**. Depends on C3, SK5 (vocabulary), P1.
Files: `src/data/progression/passives/` (`nodes.ts` generated from a table, `layout.ts` the 768×768 coordinates, `index.ts`), `src/game/progression/passives.ts` (`resolvePassives`, allocation/refund validation, caps, exclusion, points-earned function), `model.ts` hook (a one-line include of passive modifiers; coordinate with combat-core after R1),
`src/game/progression/character.ts` (boss mark credit on `bossDefeated`), `src/server/*` commands.
Tests: static audit, ledger audit, random-build bots (`passive-tree.md` 8), migration.

### PT1: Generalise the Codex model and renderer (M)
Owner lane **codex-ui**. Depends on nothing (can start in R3). Files: `src/ui/codex/{model,render,Rail,Codex}.ts(x)` → `TreeModel<N>` and a `createTreeView` factory; `src/art/codex/*` tones; **the Atlas Codex must be unchanged** (screenshot tests of the Atlas at both sizes, the existing atlas e2e). Exit: Atlas and a test graph render through the same code.

### PT2: The Orrery UI (L)
Owner lane **codex-ui**. Depends on PT0, PT1. Files: `src/ui/panels/Orrery.tsx`, `src/ui/orrery/*` (mastery flyout, build rail, diff hover, points header), `src/art/orrery/*` (tones, plates, glyphs), HUD hotkey `O`, unspent badge.

### PT3: Boss Marks, respec services, polish (S)
Boss mark HUD feedback, respec price breakdown in the hideout, free-respec token flow, Scrap services.

### B1: Balance and spec sync (M)  (R6)
Owner lane **balance**. All `BALANCE=1` harness runs; knob tuning of `power-curve.md` 12; GAME_SPEC §3, §4, §5, §7, §8 rewritten; ROADMAP updated (items 2 and 5 done, new open items); `docs/power-rework` kept as the history.

---

## 3. File ownership table (conflict avoidance)

Rule: **one owner lane per file per release; shared files (contracts, GAME_SPEC.md, ROADMAP.md, `model.ts`, `combat.ts`, `skills.ts` resolver) are touched only by their steward slice or by the lane that owns them in that release.** Lanes may be agents running in parallel worktrees.

| Lane | Owns (R1) | Owns (R2 to R4) | Owns (R5) |
|---|---|---|---|
| contract-steward | `src/contracts/*`, `PROTOCOL_VERSION`, `src/net/{protocol,messages}.ts` | same (C2) | same (C3) |
| balance-data | `data/progression/{classes,maps}.ts`, `sim/{constants,archetypes,spawn}.ts`, GAME_SPEC §3/7/8 | tuning only | tuning only |
| combat-core | `sim/{combat,stores,debuffs,digest}.ts`, `game/progression/{model,stats}.ts`, `data/progression/combat.ts` | review only (executor calls `damageMonster`) | `model.ts` passive hook |
| items | `data/items/*`, `game/items/*`, `game/progression/{flasks,loot}.ts`, item art | uniques gated flags | – |
| harness | `tests/game-progression/{character-*,atlas-tree-harness}.ts`, `tests/sim/character-bands*.ts` | archetype presets | passive random-bot tests |
| skills-core | – | `sim/skills/{executor,*}.ts`, `data/progression/skills/index.ts`, `game/progression/{skills,character,save,migrate-skills}.ts`, server skill commands | – |
| skills-<element> (fire, cold, lightning, void/physical, utility) | – | per-element data/behaviour/presenter/art/audio files (section 2 SK2) | – |
| augments | – | `data/progression/augments/*`, `sim/skills/primitives/*` | – |
| ui-skills | – | `ui/panels/{Skills,SkillTooltip,Character}.tsx`, `ui/lib/{skilltree,loadout}`, `ui/hud/*`, client input | – |
| passives-core | – | – | `data/progression/passives/*`, `game/progression/passives.ts`, passive server commands |
| codex-ui | – | PT1 may start in R3 | `ui/codex/*`, `ui/orrery/*`, `art/codex/*`, `art/orrery/*`, `ui/panels/Orrery.tsx` |
| balance | – | – | B1: tuning constants only |

Dependency graph: `C1 → {P0, P1, P2} → P3`; `P1 → C2 → SK0 → {SK1, SK2, SK3, SK4, SK5}`; `SK5 → SK6`; `SK5 + P1 → PT0`; `C3 → PT0 → PT2`; `PT1 → PT2`; `all → B1`.
Parallel plan with three agents: A (R1: P0 → P1), B (R1: P2, then PT1 as filler), C (R1: P3); R2: A on SK0, B on SK1 + SK2, C on harness presets; R3: A SK5, B SK3, C SK2 leftovers; R4: A SK6, B SK4; R5: A PT0, B PT2 (with PT1).

---

## 4. Test strategy

### 4.1 Layers

| Layer | Runs | Content |
|---|---|---|
| Unit | always | `damageMonster` order (pen, exposure, floors, DoT factor), conversion shares, caps, augment slot/tier/exclusion rules, skill-point and migration functions, passive allocation/refund/exclusion/caps, point-earning function |
| Data/spec | always | tables pinned (monster curve, affix ladders, skill roster fields, augment counts, 252-node census); `spec-sync` between GAME_SPEC/these briefs and data |
| Rules | always | `resolveSkill` for every skill × rank × augment equals the sim runtime numbers; tooltips; sheet breakdowns with "Orrery:" and "Penetration" sources |
| Sim | always | every primitive isolated; determinism digests with augments/exposure/barrier; party with different augments per player; perf budget (800 monsters, 8 skills) |
| Harness | `BALANCE=1` | the archetype bands below (minutes) |
| Browser | scenario suite | skills panel and Orrery at 1024×600 and 1280×720, keyboard-only, drag/drop, respec |

### 4.2 The archetype harness (extends `atlas-tree-harness.ts` to characters)

A preset = `{ id, skills[8] with ranks, augments, passives (list of node ids), gear template (affix picks by slot), flags }`. The harness builds a real `CharacterSave` (gear rolled from the real affix tables at ilvl = ML, tier by band: fair expected, good best−1, endgame best),
spends points through the real rules, then evaluates **at the bands and levels of `power-curve.md` 5.2** (ML 4, 10, 16, 22, 28, 40, 60, 88). Two evaluators:
an analytic one (`character-model.ts`, thousands of builds per second, used for the random-build and must-take tests) and the sim bot (a few hundred runs, used to pin the acceptance numbers and to cross-check the analytic one at three points per archetype within ±30%).

**The 14 archetypes (plus two baselines):**

| # | Archetype | Core | Passives (sectors, keystones) | Notes |
|---|---|---|---|---|
| 1 | Pyre Lancer | Ember Lance (Searing Brand, Cinder Fragments), Flame Wave | Fire + Arcana crit; Pyre Doctrine | crit/ignite basic attack |
| 2 | Novamancer | Ember Nova (Echoing Ring, Triple Ring), Echo Sigil | Fire + Arcana area; Echo Cascade | pack clearing |
| 3 | Meteor Doctrine | Immolation Sigil, Meteor Rain, Cinder Mortar | Fire + Arcana cooldown; Perfect Tempo | burst on cooldowns |
| 4 | Frostfire Converter | Lance (Frostfire Core), Rime Shards, Frost Orb | Fire + Cold via Frostfire Gate; Frostfire Spiral | conversion identity |
| 5 | Glacial Warden | Blizzard, Glacial Nova, Rime Bulwark | Cold + Bulwark; Absolute Zero | control/defence |
| 6 | Storm Conductor | Arc Chain (Forking Arc), Static Lash | Lightning + Arcana; Stormcaller's Lattice | chains |
| 7 | Static Barrage | Spark, Storm Call, Voltaic Pulse | Lightning + Arcana (projectile/area); Perfect Tempo | cast speed |
| 8 | Void Ruin | Umbral Bolt (Soulbind Lodge), Wither Field, Entropy Hex | Void + Vitality; Hollow Pact; Hollow Crown | DoT/exposure |
| 9 | Kinetic Shatterer | Kinetic Lance (Shatter Rounds), Concussive Blast | Void (physical) + Bulwark; Eternal Bastion | physical |
| 10 | Evasion Blinker | Rift Step, Storm Step, Phase Stride, Spark | Vitality + Bulwark; Phantom Weave, Wanderer's Stride | mobility/rush |
| 11 | Armour Wall | Cinder Ward, Mortar, Nova | Bulwark + Vitality; Eternal Bastion, Unending Vigil | tank |
| 12 | Focus Battery | Umbral Bolt, Rime Shards, Arcane Reprieve | Arcana; Iron Mind; Anchorite's Seal | Focus economy |
| 13 | Hexer Penetrator | Entropy Hex + any element, pen gear | Void + element; Razor Doctrine | answers proof rares |
| 14 | Glass Cannon | Lance (crit), Storm Call | Arcana; Glass Orrery, Gambler's Edge | high DPS, low EHP: the control for "weak builds die" |
| B1 | Naked baseline | rank-5 Lance, no augments, no passives, fair gear | – | the zero |
| B2 | Random allocation | random skills/augments/passives (2,000 builds) | – | the "no trap" test |

### 4.3 Acceptance criteria

| # | Criterion | Number |
|---|---|---|
| A1 | **Band spread** | for each archetype with matching gear: boss TTK at ML60 within `power-curve.md` 7.1 targets: fair 400 to 900 s, good 50 to 125 s, endgame 10 to 30 s (±30%) |
| A2 | **Rush** | endgame-band archetypes on an unjuiced ML60 map: 3.0 to 4.0 min including the bot's real dodging; good-band 4.0 to 6.0; fair 9 to 14 on the home tier |
| A3 | **No dominant archetype** | max/median of the 14 archetypes' clear time (good and endgame bands) ≤ 1.45; min/median ≥ 0.70 |
| A4 | **Identity** | each archetype's strongest metric is different (best pack clear, best boss, best survival, best speed, best vs proof) in at least 8 of the 14; no archetype is worst on all |
| A5 | **Weak builds die** | the naked baseline at ML60 and ML88 dies in ≥ 90% of 8 seeds before the boss; fair gear + a full passive tree at ML88 dies in ≥ 70% |
| A6 | **One-shots legitimate** | the glass cannon's death rate ≥ 2× the median and ≥ 1.3× the median DPS; boss slam % within ±25% of `power-curve.md` 7.2 |
| A7 | **Proof rares are walls with answers** | on a forced fire-proof rare at ML60: an archetype with **no** fire answer (Pyre Doctrine without pen) needs ≥ 5× the clean-rare time; archetypes with an answer (pen ≥ 20, exposure, conversion, alternate element, DoT) ≤ 2.5×; at least 5 of 14 have a native answer to each of fire, cold, lightning proof; void and physical proof have ≥ 4 answers each |
| A8 | **Penetration is not a damage layer** | on clean maps (no proof, resist ≤ 15%) pen ≥ 20 appears in ≤ 20% of the top-5% builds; on proof-heavy maps ≥ 40% |
| A9 | **No must-take node** | removing any non-keystone node from the best build of an archetype: power index change < 8%; no non-gate node in > 70% of the top-5% random builds; every keystone in 3% to 40% |
| A10 | **No trap** | the random allocation baseline's median is ≥ 35% of the best archetype and ≤ 1.0×; its 5th to 95th percentile spread ≤ 2.2× |
| A11 | **Each skill is used** | every one of the 32 skills appears in at least one archetype or one top-quartile random build; no skill appears in > 35% of top builds (utility excluded) |
| A12 | **Clear speed lives in the character** | the Atlas archetypes now show a clear-time delta ≥ 8% faster only for timer-bound (fair) characters; kill-bound (good/endgame) ≥ 0.92× baseline (`power-curve.md` 9.2); value/hour gains stay inside the existing 1.15× to 2.4× |
| A13 | **Defence layers matter** | removing one layer from the endgame defensive archetypes (armour or evasion, resists, ward, flasks, life) raises deaths by ≥ 1.5× on ML60 and ≥ 2× on ML88; no single layer removal makes ML88 survivable for a fair build |
| A14 | **Performance** | the sim tick budget (`perf.test`) +15% at most with 8 augmented skills at 800 monsters; deterministic digests identical across two runs; capacity (2,048 projectiles) never exceeded by an on-kill chain (trigger cap 8/tick/player) |

### 4.4 Cadence

Always-on: unit, data, rules, sim primitive and determinism tests (add about 400 tests; budget +45 s on the suite). `BALANCE=1` (on demand and before each release): archetype harness; analytic part under 2 minutes, sim part about 25 minutes
(14 archetypes × 3 bands × 4 seeds × ~20 s of sim per run with the existing 20-minute cap). Browser scenarios run in the release gate like the existing ones.

---

## 5. Migration, saves and protocol

| Change | Mechanism | Affects |
|---|---|---|
| Level cap 60 → 80 | constant only; XP formula unchanged | nobody above 60 exists |
| Skill ranks 20 → 10 | **Owner decision 2026-10-06: full refund** (replaces `newRank = ceil(oldRank / 2)`): every skill unlearned except Ember Lance rank 1, `unspentSkillPoints = 1 + 2 (L−1)`, loadout reset, old ranks in `legacySkillRanks` | every character, once, in the save migration 2 → 3 (`migrate-skills.ts`), idempotent |
| Skill points 1 → 2 per level | included in the recompute (retroactive grant) | everyone gains points |
| Loadout 6 → 8 | pad `null`; existing assignments keep positions; old `Space` slot is already RMB | all |
| Unique flags (`lancePierceAll`...) | same flag ids; the executor maps them to the augment effects they imply (no augment slot used) | owners of the 16 flag uniques |
| Free one-time respec | dropped for the skill migration (owner decision 2026-10-06: every skill point is refunded anyway, `respecTokens` 0); the field and the token respec (skills, augments, attributes) exist for later grants, e.g. the passive tree migration | all |
| Attribute respec (new) | Scrap service | all |
| Passive points | derived from level and `bossMarks` (pure function); a level-17 character has 16 on first open | all |
| Boss Marks | `bossMarks` set on the `bossDefeated` outcome of a final boss. A character's earlier kills are not recorded per character, so at migration **each existing character is credited the distinct final bosses in the account's Atlas first-kill set** (`atlas.bossesSeen`, the Atlas point source) once; new characters start at 0 | existing characters |
| Affixes | only new ones are added; no existing tier changes → no equipment migration; `AFFIX_VERSION` stays 2 | equipment |
| Monster curve | data; open expeditions keep their frozen `RunSetup` (the multiplier numbers are resolved at activation), so an in-flight map is unaffected | runs |
| Protocol | 25 → 26 (R1), 27 → 28 (SK; B1 took 27), then one more for PT; each bump refreshes clients with old rules, the existing practice | clients |
| Client prediction | `net/prediction.ts` predicts projectile motion of the primary emitter only; augment children are server-authoritative events (a short pop-in at worst) | feel |

Rollback: each release's migration is additive (no field is deleted; old `skillRanks` are kept in `legacySkillRanks` for one release so a revert can restore them), plus the production DB backup the deploy pipeline already takes before activation.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Sim performance: augment children multiply projectile and event counts (capacity 2,048, event cap 2,048 per tick) | per-primitive caps (children ≤ 8 per cast, on-kill triggers ≤ 8 per tick per player, lodge ≤ 8), `low` events for cosmetic children, perf test A14 |
| Determinism: new RNG consumers (children direction, ground strikes) | dedicated `combatRng` forks per feature, digest coverage, two-run determinism test |
| The executor rewrite regresses the seven existing skills | re-express them as data first (SK0 exit criterion), regression bot clear times within 5% |
| Balance does not converge (3 layers × 14 archetypes) | the analytic model is the spec; tuning is constants-only; `more` cap and pen cap are hard backstops |
| Contract freeze blocks lanes | three steward slices at the start of releases; lanes never edit contracts |
| UI scope: two heavy panels | SK1 and PT2 reuse the Codex renderer and the skill drag helpers; the Orrery is generic code plus data |
| Migration surprises for the one prod character with strong gear | read-only audit of production characters before release (as phase 2 did), idempotence tests, free respec token |
| Content volume (32 skills, 137 augments, 100 passive nodes, art) | batches by element, tint reuse, table-driven data, presenter files per element so agents do not collide |
| The new monster curve changes T6 to T15 for existing saves | none exists beyond T5 in practice; tests at ML34 and ML40 are rewritten with the new curve |
| Owner taste drift | R1 alone is a playable deliverable; playtest gates after R1, R3 and R5 (30-minute session per archetype) |

---

## 7. Test list that changes

| Test | Change |
|---|---|
| `tests/sim/balance-curve.test.ts` | cases at ML28 unchanged; ML34/ML40 expectations rewritten from `power-curve.md` 7 (fair at 34 fails; strong at 40 coin-flip → clears with the new curve) |
| `tests/game-progression/maps.test.ts` | curve table 6.1, level gap unchanged |
| `tests/sim/fixtures.ts` | `makeSkill` replaced for new characters by the harness builder (kept for sim unit tests) |
| `tests/game-progression/{balance,balance-ladder,balance-themes}.test.ts` | `playProgression` policy gets the 2-points-per-level and augment spending; `BALANCE=1` thresholds re-pinned |
| `tests/game-progression/atlas-tree-balance.test.ts` | acceptance (d) replaced; harness speed from bands |
| `tests/game-progression/{character,skills,stats}.test.ts` | rank 10, 2 points/level, unlock levels, no prerequisites, migration |
| `tests/sim/{skills,combat,debuffs}.test.ts` | new primitives, pen/exposure order |
| `spec-sync.test.ts` | GAME_SPEC §3, §4 tables regenerated from data |
