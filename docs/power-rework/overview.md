# A. Power rework: overview

Status: release R1 "Power" (C1, P0 to P3) built and deployed 2026-10-06; R2 to R6 are design briefs. Five documents:

| File | What it holds |
|---|---|
| `overview.md` (this) | pillars, how the parts fit, the target power model, order, risks, test plan, what changes for existing characters |
| `power-curve.md` | the full damage model, **player penetration**, exposure, proof rares, item budget and monster curve by tier with computed numbers, clear-speed model, flasks, crafting, uniques, caps, knobs |
| `skills.md` | the 32-skill Sorceress roster, the **augment** skill-tree mechanic, 13 flagship skills × 6 to 7 augments, the other 19 × 3, points economy, UI flow |
| `passive-tree.md` | **the Orrery**: 252 nodes, 100 named nodes, 15 keystones, ledger, caps, point sources, respec, UI reuse |
| `build-plan.md` | slices S/M/L, file ownership per lane, dependencies, harness and acceptance criteria, migration and protocol |

The owner picked roadmap item 2 (offence versus gear power curve, penetration, clear speed) and item 5 (character depth) as the most important and wants them designed **together**. They are one design: the power curve has nothing to
feed unless characters have layers to invest in, and the new skills, augments and passives are meaningless unless there is a curve for them to live in.

---

## 1. What exists today (the facts, so decisions can be checked)

| Question | Answer (from the code) |
|---|---|
| How many skills? | **Seven**: Ember Lance (basic), Ember Nova, Flame Wave, Rime Shards, Arc Chain, Rift Step, Cinder Ward (`data/progression/skills.ts`, `SKILL_IDS`) |
| Ranks | 1 to **20** (`MAX_SKILL_RANK`), 1 point each; prerequisite chains by rank (Nova 3 → Wave/Shards; Shards 5 → Arc) |
| Loadout | **6 slots** (LMB RMB Q E R F), any learned skill in any slot, once each |
| Level cap | **60** (`LEVEL_CAP`), XP `floor(90 × L^1.75)` |
| Points | 3 attribute points and 1 skill point per level; no respec of any kind exists |
| Resources | Focus (`40 + 2(L−1) + int`, regen `3 + 2%`), per-skill cooldowns and charges, flasks (Life, Focus: 5 charges, refilled in the hideout) |
| Damage | `(spellPower + added) × effectiveness × (1 + Σincreased) × Πmore`, spell power `11 + 1.6(L−1)`, roll 0.8 to 1.2, crit, **monster resistance cap 90%**, no penetration, ignite from the resisted hit |
| Gear | 39 affixes, 7 to 10 tiers, T1 only at item level 78 to 84 (T15 maps); **no "more" multiplier on any affix**; no penetration, void or physical damage affix |
| Defence | life, armour `A/(A+10d)` (physical only), evasion `r/(r+30·ML)` cap 75%, resistances cap 75% with a map penalty up to −40 pp, Cinder Ward, flasks |
| Monsters | level `6t−2`; life/damage ×1.09 then ×1.11 per level (+0.25 flat life) beyond ML16: **life ×3,093 and damage ×3,075 at ML88**; rares ×3 life of a 22-life Ashling; proof rares 90% resist to one element |
| A level-17 character | about 430 DPS; on-level (T3) a bite is 2.8% of her life; at T5 the Matriarch slam is about 100% (`power-curve.md` 1.2) |

---

## 2. Pillars of the rework

1. **Power comes from layers you invest in, and the layers are visible.** Base, added, increased, **more**, speed, crit, targets, **conversion**, **penetration**, **exposure**: each has a source you can name on the sheet. The only multiplicative layer a build can grow is `more`, and it is bounded (×3.5).
2. **The range is wide on purpose.** At the same monster level a best-crafted build does about 25× the single-target DPS and 100× the pack throughput of a randomly geared one (`power-curve.md` 5, 2). A new character on Tier 1 is fair but not AFK; at higher tiers weak builds die and one-shots are legitimate.
3. **Walls exist and have answers.** A fire-proof rare takes 10× longer; a build with penetration, exposure, conversion, DoT or another element beats it. No guarantee that every build can kill everything, but every build has a path to a second answer.
4. **Builds have identity.** Skills change behaviour through augments (pierce, split, lodge-and-detonate, fork, convert, echo, delay, exposure), not through a bigger number; passives add keystones that rewrite a rule and pay for it.
5. **Defence is five layers, none enough alone.** Life, armour, evasion, resistance and ward/barrier/flasks/Focus each remove a different slice of damage (`power-curve.md` 8).
6. **Speed is the character's, not the Atlas's.** Clear time = DPS, targets per cast, movement, range, cooldowns. The Atlas tree changes tempo, density and reward, not how fast you kill (decision in section 4).
7. **Crafting stays the heart.** Everything new is an affix, a bench recipe, an essence, a flask or a unique; there are no support gems, no jewel sockets and no new item class. Penetration, DoT, projectile and area are **suffixes** that compete with cast speed and crit for the same slots.
8. **Readable and server-authoritative.** Every number is explainable (breakdowns with sources "Orrery: Kindle", "Penetration: Sundering"), everything is deterministic, and the sim executes data, not bespoke code per skill.
9. **Separate from the Atlas.** The Orrery (character passives) has its own points, hotkey, panel, id namespace and tests; an Atlas node never changes a combat stat and a passive never changes a map rule.

---

## 3. How the three parts fit

```
              POWER CURVE (item 2)                    SKILLS (item 5a)                    PASSIVES (item 5b)
   gear affixes, monster curve, pen/exposure   32 skills + augments (behaviours)    252-node Orrery, 15 keystones
        |                                            |                                       |
        |  new stats: pen, DoT, projectile/area,     |  augment primitives: pierce, split,   |  notables amplify primitives
        |  maxResistance, extraChains                |  lodge, fork, convert, echo, expose   |  and the layers (pen, conversion,
        v                                            v                                       v   exposure, caps)
              ONE DAMAGE MODEL (power-curve.md 3):  base → added → conversion → increased → more → crit → speed → targets
                                  → monster resist → penetration → exposure → taken multipliers
                                                     |
                      bands: fair / good / endgame × monster levels 4 to 88  →  TTK, hit size vs life, clear time
                                                     |
                              harness (build-plan.md 4): 14 archetypes, 14 acceptance criteria, random-build bots
```

- The **curve** says what a band can do (DPS, EHP, time to kill); the **skills** and **passives** are the *ways* to spend a band's power; the **harness** measures the product.
- A skill augment (`Searing Brand`) and a passive (`Sundering Mark`) and an affix (`of Sundering`) and a skill (`Entropy Hex`) are four sources of the same two layers (penetration, exposure) with one cap each: that is the "interaction surface".
- Where the model leaves room for taste: which keystones, which augments, which skills, how big the `more` pool is: all are table-driven so the owner can retune without code.

---

## 4. The target power model (the key decisions, with reasons)

| # | Decision | Reason |
|---|---|---|
| D1 | **Level cap 60 → 80** | the tier ceiling's monster level is 88; at cap 60 every capped character pays a permanent +100% level-gap tax at T15. At 80 the gap is +25% only at T15, and the passive tree and skill points have 20 more levels to draw on |
| D2 | **Monster curve v3**: unchanged to ML28; life ×1.061 / ×1.0545 / ×1.0384 and damage ×1.040 / ×1.028 / ×1.019 per level beyond (ML40/60/88: life 18.1 / 52.2 / 149.8, damage 9.4 / 16.3 / 27.7) | the current ×1.11 compounding gives life ×3,093 and damage ×3,075 at ML88: a T15 Ashling bite of 23,000. No defence can exist at that scale, so T6 to T15 were unplayable by construction |
| D3 | **Rare life floor** 22 → 150 (T1 to T6 ramp) | rares are the small fights; today a rare is 3× a 22-life monster |
| D4 | **Penetration**: percentage points of monster resistance ignored per type, **cap 40**, applied after the 90% monster cap, **never below 0** | an answer to the 90% wall, not a damage layer; proof 0.90 with 40 pen is 0.50: 5× the damage |
| D5 | **Exposure**: timed (4 s), non-stacking per type, floor −25%, half on bosses | the only mechanic that can go below zero; it is a skill, not a gear stat |
| D6 | **DoT uses half the monster's resistance** | ignite and decay are an answer to proof rares (5.5× instead of 10×) |
| D7 | **Conversion keeps both modifier sets** | fire gear and cold passives both count: a hybrid is a real build, not a respec trap |
| D8 | **`more` pool ×3.5 cap**, from passives/augments/uniques only | gear stays additive; the multiplicative layer is bounded and visible |
| D9 | **Map resistance penalty applies to the uncapped value** | over-capped resistance becomes a buffer; today it is worthless at depth |
| D10 | **Skill ranks 1 to 10, 2 skill points per level, 32 skills, augments, 8 slots, no support gems** | a build is 6 skills × 17 points; support gems would be a second item system competing with crafting |
| D11 | **Passive tree: 252 nodes, 70 points, 15 keystones, no jewels** | 28% allocated forces choice; the unit ledger and caps copy the Atlas tree method |
| D12 | **Clear speed is the character's** | the Atlas harness calibrates a *fixed* kill speed on the empty tree, so no archetype could be faster; Haste and Overrun Doctrine are tempo nodes, not speed |

### The numbers that matter most

| Number | Value |
|---|---|
| Single-target DPS, fair → good → endgame (ML28 / ML60 / ML88) | 645 → 2,475 → 7,754 / 1,645 → 8,860 → 29,826 / 2,390 → 16,305 → 58,619 |
| Boss kill time, good / endgame | 50 / 12 s at ML28; 79 / 18 s at ML60; 124 / 26 s at ML88 |
| Rare kill time, good / endgame (ML60) | 3.8 / 1.1 s; a proof rare with no answer ×10 |
| Boss slam as % of life (fair / good / endgame, ML60) | 85% / 43% / 24% |
| "Rush": map time for good / endgame, ML60 | 4.5 / 3.1 min (model floor); fair on its home tier 9 to 13 min |
| Level gap at T15 | +25% (was +100% for a capped character) |
| Penetration cap / exposure floor | 40 pp / −25% |
| Skill points at L40 / L80 | 79 / 159 |
| Passive points at L50 / L80 / with Boss Marks | 49 / 64 / 70 |

All computed from the code constants in `power-curve.md`, with the formulas shown.

---

## 5. Build order (summary; full detail in `build-plan.md`)

| Release | Slices | Size | Ships |
|---|---|---|---|
| R1 Power | C1 contracts · P0 data re-curve · P1 damage pipeline v2 · P2 affixes/uniques/flasks · P3 harness | S, S, M, M, M | curve v3, level cap 80, penetration/exposure/DoT, rare floor, new proofs, 10 affixes, 10 uniques, utility flasks, clear-speed harness |
| R2 Skills I | C2 · SK0 executor/schema/migration · SK1 Skills panel v2 · SK2 batch 1 (10 skills) | S, L, M, L | 8 slots, rank 10, augments, 10 skills (levels 5 to 18) |
| R3 Skills II | SK3 batch 2 · SK5 flagship augments | L, L | 10 skills (levels 20 to 40), 80 behaviour augments |
| R4 Skills III | SK4 batch 3 · SK6 other augments | M, M | the last 5 + remaining 57 augments |
| R5 Orrery | C3 · PT0 data/rules · PT1 Codex generalisation · PT2 UI · PT3 boss marks/respec | S, L, M, L, S | the 252-node tree |
| R6 Balance | B1 | M | harness-driven pass, GAME_SPEC and ROADMAP sync |

**File ownership** is one lane per file per release (table in `build-plan.md` 3). The contract steward is the only lane that edits `src/contracts` (three tiny slices at the start of R1, R2, R5). `combat-core` alone touches `sim/combat.ts`, `sim/stores.ts`,
`sim/debuffs.ts` and `model.ts`/`stats.ts` in R1; `skills-core` alone touches `sim/skills/*` and `game/progression/skills.ts`; skills content is split per element file so up to five agents work in parallel; the Orrery shares only the generalised Codex renderer.
About 28 dev-weeks sequential; 14 to 16 with three parallel lanes.

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The executor rewrite breaks the seven shipped skills | regressions in the thing players use | re-express them as data first; bot clear times within 5% |
| Balance does not converge | endless tuning | the analytic model (`character-model.ts`) is the spec; tuning is constants only; hard caps (`more`, pen, cast speed, area) as backstops |
| Sim cost of augments (children, detonations, zones) | tick budget, capacity | per-primitive caps (children ≤ 8, triggers ≤ 8 per tick, lodge ≤ 8), cosmetic children on the low-priority event channel, A14 perf criterion |
| Determinism (new random draws) | desync, flaky tests | dedicated rng forks, digest coverage, two-run test |
| Contract freeze | blocked lanes | steward slices merged first |
| UI size (two heavy panels) | schedule | Orrery reuses the Codex renderer; Skills reuses drag helpers |
| Owner's taste differs on a decision (cap 80, 8 slots, no support gems) | rework | each is isolated: cap is one constant, slots one constant, supports can be added later as an extra augment layer |
| Migration of the production character | trust | read-only production audit before release, free respec token, `legacySkillRanks` kept one release |

---

## 7. Bot and balance test plan (summary)

Detail in `build-plan.md` 4. In one paragraph: extend the Atlas archetype harness to **characters**: 14 build archetypes (Pyre Lancer, Novamancer, Meteor Doctrine, Frostfire Converter, Glacial Warden, Storm Conductor, Static Barrage, Void Ruin, Kinetic Shatterer, Evasion Blinker, Armour Wall,
Focus Battery, Hexer Penetrator, Glass Cannon) plus two baselines (naked, random), evaluated at three gear bands (fair, good, endgame) and eight monster levels (4 to 88) by an analytic model (thousands of builds) and the real sim bot (a few hundred runs),
against 14 acceptance criteria: boss and rare TTK per band, rush times, no dominant archetype (max/median ≤ 1.45), identity (each archetype best at something), weak builds die (naked build dies ≥ 90% at ML60/88), proof rares are walls with answers
(5× slower without an answer, ≤ 2.5× with one), penetration is not a damage layer (appears in ≤ 20% of top builds on clean maps), no must-take node, no trap build, every skill used, speed lives in the character, defence layers matter, performance.

---

## 8. What changes for existing characters

| Item | What happens | Loss |
|---|---|---|
| Level, XP, items, currencies, stash, Atlas | unchanged (cap 80 only raises the ceiling) | none |
| **Skill ranks** | `newRank = ceil(oldRank / 2)`; refunded points back as unspent | effectiveness at the migrated rank −0% to −5% (e.g. old rank 6 e 1.34 → new rank 3 e 1.29), more than repaid by the refund |
| **Skill points** | recomputed as `1 + 2(L−1) − Σ new ranks`; the old 1-per-level is retroactively doubled | **gain** (level 17 with 16 points spent: 24 unspent) |
| **Loadout** | 6 → 8 slots, existing assignments keep positions, new slots empty | none |
| **Uniques with skill flags** | same flag ids; their behaviours now work as free (slotless) augment effects | none |
| **Attributes** | allocated points stay; a **one-time free full respec** (skills, augments, attributes, passives) is granted; afterwards an Scrap service (2 per point, first 30 free) | none |
| **Passive points** | `L − 1` up to level 50 (e.g. level 17: 16 points available on first opening the Orrery) + Boss Marks credited from the account's first-kill set | **gain** |
| **Respec policy (ongoing)** | skills/augments 4 Scrap per point (T3 augment 8), free below level 20, session cap 120; passives small 5 / notable 15 / mastery 10 / keystone 40, first 10 free, session cap 250 | a real but bearable Scrap sink; B-atlas rule "a cost, not a wall" |
| **Open expeditions** | frozen `RunSetup` keeps its numbers; the character joins with the new rules resolved at join | none |
| **Equipment** | unchanged (only new affixes added; `AFFIX_VERSION` stays 2) | none |
| **T6+ difficulty** | high tiers get a playable curve; nothing existing is harder at ML ≤ 28 | none at T1 to T5 |

The production character (level 17, strong crafted gear) keeps its items and power and ends the migration with a free respec and more points than it had.

---

## 9. Decisions on the open questions the owner raised

- **Spend the new power on layers, not on bigger numbers**: yes: `more` capped ×3.5, tree `more` ×2.0 (decision D8).
- **Support-style linking**: no; augments are the support layer (`skills.md` 0).
- **How skills scale**: spell power and gear flat per hit × effectiveness (rank 1 to 10); no weapon base damage; tags (projectile, area, DoT) select new increased stats.
- **Where passive points come from**: levels (49 + 15) and 6 Boss Marks (first kill of each final boss by that character): 70.
- **Jewel sockets**: none in v1.
- **Which damage types**: five (physical, fire, cold, lightning, void) all get a skill, a damage affix and a penetration affix; Physical and Void get proof tiers from T8 and T10.
- **One-time free respec**: yes at migration, covering skills, augments, attributes and passives.
