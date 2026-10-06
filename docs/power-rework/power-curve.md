# B. Power curve: the damage model, penetration, item budget, monster curve and clear speed

Status: design brief (no code written). Every number below is either read from the code constants or computed from
them with the arithmetic shown. Numbers marked **first pass** are balancer inputs: the knobs in section 12 move them, the
shapes do not change. Read `overview.md` first for the pillars and the slice order.

Sources read for this brief: `src/data/progression/{classes,skills,maps,types}.ts`, `src/game/progression/{stats,skills,model}.ts`,
`src/sim/{combat,skills,projectiles,constants,archetypes,spawn}.ts`, `src/sim/rosters/*`, `src/data/items/{affixes,bases,bench,uniques,flasks}.ts`,
`tests/sim/{fixtures,balance-curve}.test.ts`, `tests/game-progression/atlas-tree-harness.ts`, GAME_SPEC sections 3 to 8, 13, 14,
ROADMAP "balance overhaul" phases 1 to 3.

---

## 1. Diagnosis: what exists and what is wrong

### 1.1 The damage pipeline today (exact)

```
hit      = (spellPower(L) + Σ addedSpellDamage) × effectiveness(rank) × (1 + Σincreased/100) × Π(1 + more/100)
spellPower(L) = 11 + 1.6 × (L − 1)                     (classes.ts SORCERESS.spellPower)
increased sources = spellDamage + <type>Damage (+ elementalDamage for fire/cold/lightning)   (skills.ts damageStatsFor)
roll     = × U(0.8, 1.2)                               (combat.ts ROLL_MIN/MAX, symmetric)
crit     = × critMultiplier (default 150% + flat) with chance (skill base + flat) × (1 + Σ%)
resist   = × (1 − min(MONSTER_RESIST_CAP 0.9, monster res[type]))     (combat.ts damageMonster)
taken    = × shock 1.2 × Exposed (map event) × Warded 0.6 ; then × (1 − hitReduction) for hits (Brute 40%)
ignite   = 0.8 × the RESISTED hit over 3 s (strongest burn wins)
```

Facts that matter for this brief:

- **No gear stat is a "more" multiplier.** `grep 'more'` over `src/data` finds none: all gear is `flat` or `increased`, so gear
  scales additively. The single multiplicative layer is skill effectiveness (rank 1 to 20: Lance 1.0 to 2.3).
- There is **no penetration, no exposure, no conversion, no damage over time stat, no tag-based increased (projectile, area)**.
- Proof rares (`ELITE_PROOF_RESIST = 0.9`, `archetypes.ts`) have 90% resistance to one element, rolled from tier 2 (ramp 2 to 8,
  weight 0.6 each). The code comment says "a build with no answer grinds, one with another element **or penetration** shreds it":
  penetration was promised and never built.
- Ignite is computed from the already-resisted hit, so a fire-proof rare also nullifies ignite: DoT is not an answer either.
- Player: 3 attribute points and 1 skill point per level, `LEVEL_CAP = 60`, six loadout slots, seven skills, ranks to 20.
- Monster level = `min(90, 6 × tier − 2)`; the tier ceiling is 15 (monster level 88) while the level cap is 60. Past level 63 the
  character-vs-monster gap (`LEVEL_GAP`: grace 3, +5% per level, cap +100%) bites every capped character: at T15 it is a
  permanent +100% damage tax (88 − 60 − 3 = 25 levels over the cap of 20).

### 1.2 What a level-17 character deals and takes today

Level-17 crafted character (Eldurin-class; roadmap diagnosis): spell power `11 + 1.6 × 16 = 36.6`; assume gear +10 added spell
damage, +90% increased, Lance rank 10 (effectiveness `1 + 1.3 × 9/19 = 1.62`), cast speed +20%, crit factor 1.05.

```
hit  = (36.6 + 10) × 1.62 × (1 + 0.90) × 1.05 = 150           (average; range 120 to 180)
rate = 1 / (0.42 / 1.2) = 2.86 casts/s
DPS  = 150 × 2.86 = 430 single target (Focus-free)
```

| Target (T5, monster level 28; life ×8.87, damage ×5.87, gap +40% for a level-17) | Value | Result |
|---|---|---|
| Ashling life | 22 × 8.87 = 195 | 1.3 Lance hits |
| Ashling bite | 6 × 5.87 × 1.4 = 49 raw | about 13% of a 380-life character before armour |
| Brute slam | 22 × 5.87 × 1.4 = 181 | about 48% |
| Matriarch slam (1.8×) | 26 × 1.8 × 5.87 × 1.4 = 385 | about 100%: a one-shot |
| Matriarch life (wave 6, ×1.4) | 4,800 × 1.4 × 8.87 = 59,600 | 59,600 / (430 × 0.3 uptime) = 462 s |

That matches the owner's play report in ROADMAP (bite 15%, Brute 55%, slam about 90%). At the intended on-level tier (T3, monster
level 16) the same numbers are bite 2.8%, Brute 9%, boss slam 18%: comfortable, as designed.

### 1.3 Six findings

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| F1 | The monster curve past level 28 was never calibrated. Life ×1.11 per level and damage ×1.11 per level compound to **life ×3,093 and damage ×3,075 at monster level 88** (T15) | `monsterLifeScale/DamageScale` evaluated: ML40 26.5/20.5, ML60 176/165, ML82 1,660/1,644, ML88 3,093/3,075 | A T15 Ashling bite is 6 × 3,075 × 1.25 = 23,000 raw. No defence layer in the game can answer it: T11 to T15 are unreachable and the "endgame fantasy" has no home |
| F2 | Gear is additive only; the one multiplier is rank | no `more` on any affix | Band spread is small: a fully crafted character does about 24× the DPS of a randomly geared one at the same level, not the 100× a PoE player expects |
| F3 | No penetration, no exposure, no conversion, no DoT scaling | stat list in `contracts/items.ts` | Proof rares are a literal 10× wall with a single answer (swap element), and every build is "fire damage, more fire damage" |
| F4 | Rares are trivial for good builds | rare = 3× life of a 22-life Ashling: at ML60 a rare dies in 0.3 s for a mid build | Nothing to be "walled" by except proof, and proof only multiplies a trivial number |
| F5 | Level cap 60 below the tier ceiling's level range | cap 60 vs ML 88; gap tax +100% | Capped players are punished for not out-levelling a cap |
| F6 | Atlas "clear speed" nodes cannot make a map faster | harness `speed = baseline.units / (6 × 40 s)` is a constant per area/tier (`atlas-tree-harness.ts measure`); more monsters or more life lowers measured speed, and `clearSeconds` only models the wave timer | Every archetype looks slower than the empty tree because the kill speed is a fixed number. Decision in section 9: speed is a character stat |

---

## 2. Design targets (the owner's taste as numbers)

| Intent | Number |
|---|---|
| Wide power range | At the same monster level the best crafted build does **about 25× the single-target DPS** and **about 130× the pack throughput** (25 × 8 targets / 1.5 targets) of a random-geared build; a fresh level-1 character does about 1/40 of a level-17 crafted one |
| New character on T1 is balanced but not AFK | A fresh character (life 80, 38 DPS) takes **5 to 7 minutes** to kill the T1 boss, lives at 30 to 50% life at the low point, dies 0 to 2 times (unchanged from the measured balance bot) |
| On-level maps are comfortable with normal gear | Fair gear: map level = character level + 2 or less clears in 9 to 13 minutes |
| Good build + good gear "rushes" | Good band: **4 to 5.5 minutes** per map at its home tier, trash dies in one cast, rares in 2 to 6 s, boss 25 to 125 s |
| Endgame build "f*s the monsters up" | Endgame band: **about 3 to 3.5 minutes** (the floor: walking, tells, loot), trash 0.03 to 0.07 s, rares 0.5 to 1.7 s, boss 12 to 26 s |
| Higher tiers: weak builds die; one-shots are legitimate | Fair gear at ML60: a boss slam is 85% of its life, at ML88 134% (one-shot). Good: 43% / 65%. Endgame: 24% / 38% |
| Rares and magic can wall a build | A proof rare with no answer takes 10× longer: the good band needs 38 s for a normal proof rare at ML60 and 115 s for a Juggernaut proof. With one answer it is 9.6 s and 29 s (30 penetration) or 3.8 s and 11.5 s (the other element) |
| No guarantee you can kill everything | Penetration is capped at 40 points; a rare can be doubly proof from T12; a build that has no answer cannot finish it |
| Defence layers all matter | Life, armour, evasion, resistances, ward/barrier, flasks and Focus each remove a different slice of damage (section 8); no single layer beats the 90th-percentile hit at high tiers |

---

## 3. The complete damage model

### 3.1 Layers in order

`NEW` = does not exist today. "Where" names the rules/sim owner.

| # | Layer | Formula contribution | Status | Where |
|---|---|---|---|---|
| 1 | **Spell power** | `11 + 1.6 (L−1)` | exists | `classes.ts` |
| 2 | **Added flat** | Σ `addedSpellDamage` (gear, tree) | exists | `model.ts` |
| 3 | **Effectiveness** | skill `e(rank)`, rank 1 to **10** (was 20) | changed | `skills.ts` |
| 4 | **Augment effectiveness** | per-skill augment modifiers (damage lines of augments) | NEW | `augments.ts` |
| 5 | **Conversion** | the hit is split into shares per damage type | NEW | `damage-shares` |
| 6 | **Increased (additive pool)** | per type `t`: `spellDamage + elementalDamage(if elemental) + <t>Damage + Σ<source>Damage(converted shares) + tagged(projectile/area/dot as applicable)` | extended | `damageStatsFor` |
| 7 | **More (multiplicative pool)** | Π(1 + more_i), from passives, augments, uniques only, capped at **×3.5** total | NEW sources | `model.ts` |
| 8 | **Roll** | × U(0.8, 1.2) | exists | `combat.ts` |
| 9 | **Crit** | chance `(base + flat) × (1 + Σ%)`, cap 100%; multiplier `150 + flat`, cap 500% | cap NEW | `skills.ts` |
| 10 | **Speed** | cast time `/ castSpeed` (increased cap +150%); cooldown `/ recovery` (cap +100%); projectile speed; Focus sustain | caps NEW | `skills.ts` |
| 11 | **Targets** | projectile count (extra ≤ +6), pierce (≤ 8), chains (≤ 12 total), fork/split children, area radius `√(1+area%)` (area increased cap +100%) | caps NEW | `skills.ts` |
| 12 | **Monster resistance** | `r1 = min(0.90, monsterRes[t])` | exists | `combat.ts` |
| 13 | **Penetration** | `r2 = r1 − min(pen, max(0, r1))`, pen ≤ 40 | **NEW** | `combat.ts` |
| 14 | **Exposure** | `r3 = max(−0.25, r2 − exposure)`; timed, non-stacking, half on bosses | **NEW** | `combat.ts`, `debuffs` |
| 15 | **Taken multipliers** | shock ×1.2, Exposed (event), Warded ×0.6 | exists | `combat.ts takenMult` |
| 16 | **Hit reduction** | Brute 40% (hits only; not DoT) | exists | `combat.ts` |
| 17 | **Ailments / DoT** | ignite (80% over 3 s), **decay** (void, NEW), DoT increased `damageOverTime` (NEW); DoT uses **half** the monster's effective resistance | changed | `combat.ts applyAilment` |

Full per-hit formula (what `damageMonster` computes after the change), for a hit whose share in type `t` is `s_t` (Σ s_t = 1):

```
base_hit  = (SP + added) × e × augment
dmg_t     = base_hit × s_t × (1 + inc_t/100) × more × roll × crit
taken_t   = dmg_t × (1 − r3_t) × shock × warded × exposedEvent × (1 − hitReduction)
```

### 3.2 Conversion (decision: whole shares, tags stay)

- A skill's hit is stored as shares per type (default 100% its own type). Augments, uniques and passives convert **a percentage
  of a type into another**, applied in a fixed order (physical, then fire, cold, lightning, void) so a chain converts only once
  per step and never loops.
- **Converted damage keeps the modifiers of the type it came from and gains those of the type it became.** Example: 50% of fire
  converted to cold. Cold share's increased pool = spell + elemental + cold% + **fire%**; fire share uses spell + elemental + fire%.
  Fire gear remains useful, cold passives start to matter: this is what makes Frostfire a real build instead of a respec trap.
- The ailment follows the final type of each share (50/50 fire/cold: separate rolls for ignite and chill).
- Resistance and penetration are per final type. Conversion therefore *spreads* a hit across two resistance rows: against a fire-proof
  rare, 50% fire/50% cold takes `0.5 × 0.10 + 0.5 × 1.0 = 0.55` of normal instead of 0.10.
- No "gain as extra" in v1. Extra-as would make the layer order unreadable on the tooltip; conversion alone is enough.

### 3.3 New tag-based increased stats (NEW)

`projectileDamage`, `areaDamage`, `damageOverTime` (all `increased`), joining the existing type stats. A skill's tags (already on
`SkillDef.tags`: Projectile, Area, Chaining, Duration...) select which apply. They give the passive tree and gear a way to
reward a *skill shape* (projectile builds, area builds, DoT builds) independent of element, which is the missing second axis of
build identity.

---

## 4. Penetration, exposure and how proof rares are beaten

### 4.1 Player penetration: exact spec

| Item | Spec |
|---|---|
| Stats (new `StatId`) | `firePen`, `coldPen`, `lightningPen`, `voidPen`, `physicalPen`, `elementalPen` |
| Unit | percentage points (pp) of monster resistance ignored. 1 pp = 0.01 of the resistance fraction |
| Total per type | `pen_t = min(PEN_CAP, <t>Pen + (t is fire/cold/lightning ? elementalPen : 0))`, `PEN_CAP = 40` pp, all sources summed |
| Resolution | `r1 = min(0.90, monsterRes)` first (the existing monster cap is applied **before** penetration), then `r2 = r1 − min(pen, max(0, r1))` |
| Floor | **Penetration never creates vulnerability**: it cannot take a resistance below 0. A monster with −15% cold takes +15% regardless of pen. Only exposure (4.2) can go negative |
| Versus the 90% cap | A proof rare (0.90) with 40 pen is 0.50: damage taken `1 − 0.5 = 0.5` against `0.1` without: **5× the damage**. The cap is not changed (it stays the wall), pen is the answer |
| Versus the player's own cap | The player's resistance cap is 75%. There is no monster penetration. The **map resistance penalty** (`PLAYER_RESISTANCE_SCALING`: −0.5 pp per monster level above 10, max −40 pp) is the mirror of penetration: it is subtracted from the player's resistance. **Decision:** it is subtracted from the *uncapped* total and then the result is capped at 75 (`effective = min(cap, uncapped − penalty)`), so over-capping resistance is a real buffer against the map penalty and against Withered. Today the stat is capped first (`stats.ts` line 107) and the penalty subtracted after, which makes an overcapped ring worthless at depth |
| Ailments | DoT uses `(1 − 0.5 × r3)` (new constant `DOT_RESIST_FACTOR = 0.5`) instead of the full resisted hit: ignite and decay against a fire-proof rare take `0.55` of normal, not `0.10` |
| Display | Skill tooltip: "Penetrates 20% Fire resistance (30 of 40 maximum)". Character sheet section "Penetration" with a breakdown per source, same breakdown tooling as every other stat. Monster hover shows "Fire resistance 90% (50% after your penetration)" |

### 4.2 Exposure (NEW monster debuff)

- A timed, per-type debuff on a monster: `exposure_t = X pp`, duration 4 s, **does not stack, the strongest applies**, refreshes.
- Applied by skills/augments (Entropy Hex, Searing Brand, Brittle Shards, Void Exposure: `skills.md`), never by gear.
- `r3 = max(−0.25, r2 − exposure)`: the only mechanic that can push resistance below zero, floor −25 pp.
- **Bosses and lieutenants take half** the exposure (and no pen is reduced). Rationale: bosses already have 15 to 35% resistance, so
  pen is the better tool against them, and exposure is the better tool against rares, which is where proof lives.
- Typical values: skills 12 to 15 pp; the Hex 15 pp to all four types (25 at its augment); stack of different types is independent.

### 4.3 How a proof rare is meant to be beaten (computed)

Damage taken as a fraction of a clean hit (`1 − r3`), for a fire-proof rare (r1 = 0.90) hit by a fire build:

| Answer | r3 | Taken | vs no answer | Cost to the build |
|---|---|---|---|---|
| None | 0.90 | 0.10 | 1.0× | nothing: a 10× longer fight |
| Penetration 15 (typical gear) | 0.75 | 0.25 | 2.5× | two suffix slots |
| Penetration 30 | 0.60 | 0.40 | 4.0× | three suffix slots + a passive |
| Penetration 40 (cap) | 0.50 | 0.50 | 5.0× | most of a pen-focused build |
| Pen 30 + Hex exposure 15 | 0.45 | 0.55 | 5.5× | a skill slot (Hex) |
| Pen 40 + exposure 25 (both maxed) | 0.25 | 0.75 | 7.5× | specialist |
| 50% conversion to cold (Frostfire) | fire 0.90 / cold 0.00 | 0.55 | 5.5× | augment + conversion unique/passive |
| Alternate element skill (cold) | 0.00 | 1.00 | 10× | a second skill on the bar, its own ranks |
| Ignite / decay DoT only | DoT factor | 0.55 | 5.5× on the DoT share | DoT build |
| Physical or void skill | 0.00 (proofs are per element) | 1.00 | 10× | a different damage type |

Time to kill a fire-proof rare (normal rare leader, wave 3, 80% uptime, rare life from section 6.3): computed from the band DPS
of section 5.

| Band | Rare life | No answer | Pen 15 | Pen 30 | Pen 40 + exposure 25 | Juggernaut + proof, no answer | Juggernaut + proof, pen 30 |
|---|---|---|---|---|---|---|---|
| Fair ML28 | 3,839 | 74 s | 30 s | 18.5 s | 10 s | 222 s | 55 s |
| Good ML28 | 3,839 | 20 s | 8 s | 5 s | 2.7 s | 60 s | 15 s |
| Good ML60 | 27,234 | 38 s | 15 s | 9.5 s | 5 s | 115 s | 28 s |
| Endgame ML60 | 27,234 | 11 s | 4.6 s | 2.8 s | 1.5 s | 34 s | 8.5 s |

Arithmetic (Good ML60): rare life 27,234 / (8,860 DPS × 0.8 uptime) = 3.84 s clean; ×10 for proof (taken 0.10) = 38 s; pen 30 (taken 0.40)
= 9.6 s; Juggernaut triples the life (115 s / 28.8 s). A fair build at ML60 needs 62 s for an *unproofed* Juggernaut rare (`27,234 × 3 / (1,645 × 0.8)`) and
620 s for a proofed one: the wall is built by **life, DPS and resistance together**, not by resistance alone.

New proof tiers (so void and physical builds also meet walls and "one answer" is not enough forever), all in `archetypes.ts rareModWeights`:

| Mod | Resist | First tier | Ramp | Weight |
|---|---|---|---|---|
| fire/cold/lightning proof | 0.90 | T2 (existing) | T2 to T8 | 0.6 each (existing) |
| **void proof** (NEW) | 0.90 void | T8 | T8 to T12 | 0.5 |
| **physical proof** (NEW) | 0.90 physical (armour-like hide) | T10 | T10 to T14 | 0.4 |
| **double proof** (NEW) | two different types at 0.90 | T12 | 20% of rares with a proof | – |
| Never | all four | – | – | a rare is never proof against every type |

---

## 5. Item power budget per tier

### 5.1 What an item level unlocks

Item level = monster level. Affix tiers unlock by item-level gates (`TIER_LADDERS`) and weights fall steeply, so the best tier
available at a monster level is rarely what drops. Best available tier and range (computed from the ladders in `affixes.ts`):

| Affix (T1 = best) | ML4 | ML10 | ML16 | ML22 | ML28 | ML40 | ML60 | ML88 |
|---|---|---|---|---|---|---|---|---|
| Arcane % spell | T10 8-12 | T9 13-15 | T8 16-19 | T7 20-23 | T6 24-29 | T5 30-35 | T3 42-48 | T1 56-62 |
| Blazing etc. % element | T10 8-12 | T9 13-14 | T8 15-18 | T7 19-22 | T6 23-27 | T5 28-32 | T3 38-43 | T1 51-56 |
| Sorcerous added spell | T10 1-2 | T9 3 | T8 4 | T7 5-6 | T6 7-8 | T5 9-11 | T3 14-16 | T1 19-21 |
| of Haste % cast | T9 3-5 | T8 6 | T7 7 | T7 7 | T6 8-9 | T5 10-11 | T3 14-15 | T1 19-20 |
| of Omens % crit | T10 10-14 | T9 15-16 | T8 17-20 | T7 21-24 | T6 25-28 | T5 29-33 | T3 40-45 | T1 52-57 |
| of Ruin crit multiplier | T8 8-12 | T7 13-14 | T7 13-14 | T6 15-16 | T6 15-16 | T5 17-19 | T3 23-25 | T1 30-33 |
| Hale flat life | T10 6-10 | T9 11-13 | T8 14-17 | T7 18-21 | T6 22-27 | T5 28-33 | T3 40-46 | T1 54-60 |
| Resistance (one element) | T10 6-10 | T9 11 | T8 12-13 | T7 14-16 | T6 17-19 | T5 20-22 | T3 26-29 | T1 33-36 |
| Plated/Lithe flat armour/evasion | T10 6-12 | T9 13-19 | T8 20-29 | T7 30-41 | T6 42-55 | T5 56-70 | T3 87-103 | T1 122-140 |
| Ironclad/Elusive % | T9 10-16 | T8 17-19 | T7 20-24 | T7 20-24 | T6 25-30 | T5 31-36 | T3 45-51 | T1 60-68 |

Consequence: **T1 affixes exist only on items of level 84 or more, which means T15 maps (monster level 88) only.** A full
best-in-slot character is a T15 product. The new penetration affixes (section 10.1) follow the same ladders.

### 5.2 Three bands (definitions)

All bands share the same character level `L = clamp(ML − 2, 3, 80)` so the table isolates **gear, build and passives**, not level.
(ML4 and ML10 rows for good/endgame are design ceilings, not reachable states: an L3 character cannot own that gear.)

| | Fair | Good | Endgame |
|---|---|---|---|
| Gear tiers | Expected value of a random roll at that item level (weights from the ladder) | Best available tier minus one | Best available tier |
| Damage affixes | 2 added, 1 spell%, 1 element%, 1 cast, 1 crit | 4 added, 2 spell%, 3 element%, 2 cast, 2 crit, 1 mult | 5 added, 3 spell%, 4 element%, 1 prismatic, 3 cast, 3 crit, 2 mult |
| Life/defence affixes | 3 life, 2 res, 1 armour flat | 6 life, 5 res, 3 flat + 2 % | 8 life, 7 res, 4 flat + 4 % |
| Skill rank (main) | 2 / 5 / 8 / 10 by ML 4 / 10 / 16 / 22+ | same | same |
| Passive points | `L − 1` to L50, then +1 per 2 levels (+3 boss marks from ML40, +3 from ML60) = see `passive-tree.md`; allocation efficiency 0.6 | 0.9 | 1.0 |
| `more` pool (tree + augments + uniques) | ×1.0 | ×1.5 | ×2.4 (cap ×3.5) |
| Targets per cast (area, projectiles, chain) | 1.5 | 4 | 8 |
| Boss uptime (kiting, dodging) | 30% | 50% | 65% |
| Move speed | +10% | +25% | +40% |
| Damage-taken multiplier from tree/ward uptime | 1.0 | 0.82 | 0.65 |

Reading the sheet (`SP` spell power, `added` all flat, `Σinc` all additive increased including int/5 and tree, `crit×` expected
crit factor `1 + chance × (mult − 1)`):

**Fair**

| ML | L | SP | added | Σinc% | more | cast× | crit× | e | hit | casts/s | DPS | life | armour | evade% | eff. res |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 | 3 | 14.2 | 4.2 | 29 | 1.0 | 1.04 | 1.03 | 1.14 | 28 | 2.48 | 70 | 144 | 153 | 56 | 12 |
| 10 | 8 | 22.2 | 6.0 | 40 | 1.0 | 1.05 | 1.03 | 1.58 | 64 | 2.50 | 161 | 201 | 172 | 38 | 13 |
| 16 | 14 | 31.8 | 7.3 | 52 | 1.0 | 1.06 | 1.04 | 2.01 | 123 | 2.52 | 311 | 272 | 191 | 31 | 11 |
| 22 | 20 | 41.4 | 8.7 | 63 | 1.0 | 1.06 | 1.04 | 2.30 | 195 | 2.52 | 491 | 344 | 211 | 27 | 8 |
| 28 | 26 | 51.0 | 10.0 | 75 | 1.0 | 1.07 | 1.04 | 2.30 | 254 | 2.54 | 645 | 420 | 231 | 25 | 6 |
| 40 | 38 | 70.2 | 11.7 | 98 | 1.0 | 1.07 | 1.04 | 2.30 | 386 | 2.56 | 988 | 578 | 271 | 23 | 0 |
| 60 | 58 | 102.2 | 14.2 | 129 | 1.0 | 1.08 | 1.04 | 2.30 | 637 | 2.58 | 1,645 | 859 | 337 | 21 | −9 |
| 88 | 80 | 137.4 | 16.2 | 151 | 1.0 | 1.09 | 1.04 | 2.30 | 922 | 2.59 | 2,390 | 1,175 | 417 | 19 | −23 |

**Good**

| ML | L | SP | added | Σinc% | more | cast× | crit× | e | hit | casts/s | DPS | life | armour | evade% | eff. res |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 | 3 | 14.2 | 13.6 | 78 | 1.5 | 1.08 | 1.12 | 1.14 | 95 | 2.58 | 245 | 182 | 216 | 64 | 26 |
| 10 | 8 | 22.2 | 13.6 | 88 | 1.5 | 1.09 | 1.12 | 1.58 | 179 | 2.59 | 463 | 240 | 236 | 45 | 26 |
| 16 | 14 | 31.8 | 19.6 | 119 | 1.5 | 1.13 | 1.13 | 2.01 | 382 | 2.70 | 1,033 | 342 | 306 | 41 | 28 |
| 22 | 20 | 41.4 | 23.6 | 147 | 1.5 | 1.14 | 1.14 | 2.30 | 631 | 2.72 | 1,714 | 449 | 366 | 39 | 28 |
| 28 | 26 | 51.0 | 29.6 | 179 | 1.5 | 1.17 | 1.15 | 2.30 | 890 | 2.78 | 2,475 | 566 | 463 | 39 | 29 |
| 40 | 38 | 70.2 | 37.6 | 231 | 1.5 | 1.22 | 1.16 | 2.30 | 1,430 | 2.89 | 4,137 | 812 | 623 | 39 | 28 |
| 60 | 58 | 102.2 | 59.6 | 324 | 1.5 | 1.32 | 1.19 | 2.30 | 2,827 | 3.13 | 8,860 | 1,297 | 1,015 | 41 | 28 |
| 88 | 80 | 137.4 | 82.7 | 415 | 1.5 | 1.42 | 1.24 | 2.30 | 4,827 | 3.38 | 16,305 | 1,854 | 1,571 | 43 | 26 |

**Endgame**

| ML | L | SP | added | Σinc% | more | cast× | crit× | e | hit | casts/s | DPS | life | armour | evade% | eff. res |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 | 3 | 14.2 | 15.1 | 106 | 2.4 | 1.12 | 1.20 | 1.14 | 200 | 2.67 | 533 | 199 | 275 | 70 | 46 |
| 10 | 8 | 22.2 | 22.6 | 146 | 2.4 | 1.19 | 1.23 | 1.58 | 513 | 2.83 | 1,454 | 296 | 386 | 57 | 53 |
| 16 | 14 | 31.8 | 27.6 | 181 | 2.4 | 1.23 | 1.24 | 2.01 | 1,003 | 2.92 | 2,932 | 410 | 517 | 54 | 53 |
| 22 | 20 | 41.4 | 35.1 | 224 | 2.4 | 1.24 | 1.27 | 2.30 | 1,739 | 2.94 | 5,115 | 540 | 636 | 52 | 56 |
| 28 | 26 | 51.0 | 45.1 | 270 | 2.4 | 1.29 | 1.29 | 2.30 | 2,527 | 3.07 | 7,754 | 690 | 858 | 53 | 60 |
| 40 | 38 | 70.2 | 57.6 | 342 | 2.4 | 1.37 | 1.32 | 2.30 | 4,119 | 3.26 | 13,426 | 1,000 | 1,186 | 53 | 61 |
| 60 | 58 | 102.2 | 84.6 | 469 | 2.4 | 1.51 | 1.41 | 2.30 | 8,271 | 3.61 | 29,826 | 1,606 | 2,040 | 57 | 66 |
| 88 | 80 | 137.4 | 112.7 | 599 | 2.4 | 1.68 | 1.52 | 2.30 | 14,659 | 4.00 | 58,619 | 2,296 | 3,269 | 60 | 69 |

(Armour and evasion columns show the two defence archetypes: a build wears armour **or** evasion on a slot; evade% is the evasion build
at the same ML: `rating / (rating + 30 × ML)`, cap 75%. Effective resistance is `min(75, uncapped − map penalty)` with the buffer rule of 4.1.
"DPS" is single-target, Focus-free (Lance-class basic attack), before pen/exposure, so it is the baseline other skills are scaled
against; section 7 uses it for clearing.)

**Arithmetic, one cell per band (verify against the table):**

```
Good, ML60 (L58):  (102.2 SP + 59.6 added) = 161.8
                   × 2.30 effectiveness            = 372.1
                   × (1 + 3.24 increased)          = 1,578
                   × 1.5 more                      = 2,367
                   × 1.19 crit factor              = 2,816   (table 2,827: unrounded crit)
                   casts/s = 1.32 / 0.42 = 3.13   → DPS = 8,860
```

Itemised increased for that cell (324%): spell% 2 × 38.5 (T4, one tier below the best available, ilvl 60) = 77; element% 3 × 35.0 = 105;
intelligence 167 / 5 = 33; tree 26.6 offence points × 3.8% × 0.9 efficiency = 91; weapon implicit 18. Itemised added (59.6): weapon base
`3 + 0.11 × 60 = 9.6` plus 4 × 12.5 (T4 added spell damage 12-13).

**Where the spread comes from at ML60** (ratios of the table rows; every factor is multiplicative):

| Step | Added | Increased | `more` | Crit | Speed | Single-target | Targets | Pack throughput |
|---|---|---|---|---|---|---|---|---|
| Fair → Good | 1.39× | 1.85× | 1.5× | 1.14× | 1.22× | **5.4×** | 4 / 1.5 = 2.7× | 14× |
| Good → Endgame | 1.16× | 1.34× | 1.6× | 1.18× | 1.14× | **3.4×** | 8 / 4 = 2× | 6.7× |
| Fair → Endgame | 1.6× | 2.5× | 2.4× | 1.35× | 1.40× | **18×** | 5.3× | 96× |

At ML88 the fair → endgame single-target ratio is 24.5× and the pack ratio about 130×: the "wide power range" target. The two biggest single
levers are the additive pool (`Σinc` 129% → 469%) and the new `more` pool (×1 → ×2.4): a build with answers is mostly a build that has *invested in more layers*,
not one that rolled bigger numbers on the same layer.

### 5.3 The three metrics a balancer checks per band and ML

| Metric | Fair | Good | Endgame |
|---|---|---|---|
| DPS ratio to fair, same ML | 1.0× | 2.9× to 6.8× | 7.6× to 24.5× |
| Life ratio to fair | 1.0× | 1.19× to 1.58× | 1.38× to 1.95× |
| Armour ratio to fair | 1.0× | 1.4× to 3.8× | 1.8× to 7.8× |
| Fraction of the T15 affix ladder reached | 33% | 70% | 100% |

---

## 6. The monster curve v3 (what to change)

### 6.1 Constants (data, `MONSTER_LEVEL_SCALING` in `maps.ts`, mirrored by `sim/constants`)

Unchanged up to level 28 (calibrated by the existing balance tests): life ×1.09/level to 16, then ×1.11 + 0.25 flat per level; damage ×1.09
then ×1.11. **New segments past level 28** (compounding from the level-28 value, life 8.87, damage 5.87):

| Segment | Life per level | Damage per level | Why |
|---|---|---|---|
| 28 to 40 | ×1.061 | ×1.040 | Player DPS grows 4.4%/level and EHP 3.2%/level across this range; life ×1.061 keeps a "good" boss fight from 50 s to 60 s, damage ×1.040 keeps a good build's boss slam at 34% to 39% of life |
| 40 to 60 | ×1.0545 | ×1.028 | Good-band DPS growth 3.9%/level; boss 60 s to 79 s |
| 60 and up | ×1.0384 | ×1.019 | Good-band DPS growth 2.2%/level at the top of the ladders; boss 79 s to 124 s at T15 |

| ML | tier | life ×, current | life ×, v3 | damage ×, current | damage ×, v3 | Ashling life | Ashling bite | Brute slam | Matriarch life (w6) | Matriarch slam |
|---|---|---|---|---|---|---|---|---|---|---|
| 4 | 1.0 | 0.6 | 0.6 | 0.7 | 0.7 | 13 | 4.1 | 15 | 4,007 | 32 |
| 10 | 2.0 | 1.0 | 1.0 | 1.0 | 1.0 | 22 | 6.0 | 22 | 6,720 | 47 |
| 16 | 3.0 | 1.7 | 1.7 | 1.7 | 1.7 | 37 | 10.1 | 37 | 11,270 | 78 |
| 22 | 4.0 | 4.6 | 4.6 | 3.1 | 3.1 | 102 | 18.8 | 69 | 31,160 | 147 |
| 28 | 5.0 | 8.9 | 8.9 | 5.9 | 5.9 | 195 | 35.2 | 129 | 59,588 | 275 |
| 40 | 7.0 | 26.5 | **18.1** | 20.5 | **9.4** | 397 | 56.4 | 207 | 121,305 | 440 |
| 60 | 10.3 | 176.5 | **52.2** | 165.5 | **16.3** | 1,148 | 98.0 | 359 | 350,598 | 764 |
| 88 | 15.0 | 3,092.8 | **149.8** | 3,074.8 | **27.7** | 3,297 | 165.9 | 608 | 1,006,979 | 1,294 |

(Ashling life = 22 × life ×; bite = 6 × damage ×; Brute slam = 22 × damage ×; Matriarch life = 4,800 × 1.4 wave-6 growth × life ×;
slam = 26 × 1.8 × damage ×. All before wave growth on trash, level gap, rarity.)

This keeps T1 to T5 bit-for-bit (so `balance-curve.test.ts` cases at ML16, 22, 28 stay valid) and rewrites only the part nobody could
play. The tests at ML34 and ML40 change (section 12 of `build-plan.md` lists them).

### 6.2 Level cap and the gap (decision)

- `LEVEL_CAP` 60 → **80**. XP formula unchanged (`floor(90 × L^1.75)`); cumulative XP: L40 0.80M, L60 2.48M, L80 5.51M. At T12 (53.6k XP per map by
  the spec's tier multiplier 1.28^(t−1)) a level-60 character needs about 57 maps for the last 20 levels: a long tail, not a wall.
- `LEVEL_GAP` unchanged (grace 3, +5% per level, cap +100%). At the cap 80 the gap is 0 up to ML83 (T14), +25% at T15 (ML88). The tax
  now says "T15 is the hardest tier" instead of "being at the cap hurts".
- Spell power continues to 1.6 per level: L80 = 137.4. Level-based growth is deliberately modest next to gear (SP ×2.5 from L26 to L80
  against gear `Σinc` ×6): **levels give access, gear gives power**.

### 6.3 Elite strength (NEW, closes F4)

A rare leader with 3× the life of a 22-life Ashling is a speed bump. Rares must be the small fights of the map.

| Knob | Today | v3 |
|---|---|---|
| Rare leader base life | kind's own life (22 for an Ashling) × 3 | `max(kind life, RARE_LIFE_FLOOR(tier)) × 3`, `RARE_LIFE_FLOOR = lerp(22, 150, clamp((tier−1)/5, 0, 1))`: 22 at T1 (unchanged), 124 at T5, 150 from T6 |
| Magic life | ×1.5 | ×1.5, floor 0.4 × the rare floor (60 at T6+) |
| Rare damage | ×1.5 | ×1.5 (unchanged; the hit sizes of 5.2 already include rares only where stated) |

Resulting rare leader life (wave 3 ×1.16) and kill times (80% uptime):

| ML | rare floor | rare life | Fair | Good | Endgame |
|---|---|---|---|---|---|
| 4 | 22 | 46 | 0.8 s | 0.3 s | 0.1 s |
| 10 | 48 | 166 | 1.3 s | 0.5 s | 0.2 s |
| 16 | 73 | 427 | 1.7 s | 0.6 s | 0.2 s |
| 22 | 99 | 1,594 | 4.1 s | 1.2 s | 0.4 s |
| 28 | 124 | 3,839 | 7.4 s | 2.0 s | 0.6 s |
| 40 | 150 | 9,423 | 11.9 s | 2.9 s | 0.9 s |
| 60 | 150 | 27,234 | 20.7 s | 3.8 s | 1.1 s |
| 88 | 150 | 78,221 | 40.9 s | 6.0 s | 1.7 s |

This is the **target time-to-kill for rares**: good 2 to 6 s, endgame 0.5 to 1.7 s, fair 7 to 41 s (the "weak builds cannot keep up" gradient).

---

## 7. Targets and results: time to kill and incoming hits

### 7.1 Time to kill (computed, v3 curve)

Trash single target = `22 × life× × 1.16 (wave-3 growth) / DPS`; pack of six uses `DPS × 0.8 uptime × min(targets, 6) × 0.85 overlap`;
boss = `4,800 × 1.4 × life× / (DPS × uptime)` with uptime 30/50/65%.

| ML | Trash life | Trash fair | good | endgame | Pack(6) life | Pack fair | good | endgame | Boss life (w6) | Boss fair | good | endgame |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 | 15 | 0.22 s | 0.08 s | 0.03 s | 91 | 1.28 s | 0.17 s | 0.05 s | 4,007 | 192 s | 40 s | 14 s |
| 10 | 26 | 0.16 s | 0.06 s | 0.02 s | 153 | 0.93 s | 0.14 s | 0.03 s | 6,720 | 139 s | 33 s | 8 s |
| 16 | 43 | 0.14 s | 0.05 s | 0.02 s | 257 | 0.81 s | 0.10 s | 0.02 s | 11,270 | 121 s | 24 s | 6 s |
| 22 | 118 | 0.24 s | 0.07 s | 0.02 s | 710 | 1.42 s | 0.16 s | 0.04 s | 31,160 | 212 s | 39 s | 10 s |
| 28 | 226 | 0.35 s | 0.10 s | 0.03 s | 1,358 | 2.07 s | 0.21 s | 0.04 s | 59,588 | 308 s | 50 s | 12 s |
| 40 | 461 | 0.47 s | 0.11 s | 0.03 s | 2,764 | 2.74 s | 0.25 s | 0.05 s | 121,305 | 409 s | 60 s | 14 s |
| 60 | 1,331 | 0.81 s | 0.15 s | 0.04 s | 7,989 | 4.76 s | 0.33 s | 0.07 s | 350,598 | 710 s | 79 s | 18 s |
| 88 | 3,824 | 1.60 s | 0.23 s | 0.07 s | 22,945 | 9.41 s | 0.52 s | 0.10 s | 1,006,979 | 1,405 s | 124 s | 26 s |

Targets the balancer holds each band to (columns in the table above must stay inside):

| | Trash (single) | Pack of 6 | Rare | Boss |
|---|---|---|---|---|
| Fair | 0.15 to 1.6 s | 1 to 10 s | 1 to 40 s | 120 to 450 s on home tiers (ML ≤ 40); beyond that "cannot finish" is correct |
| Good | 0.05 to 0.25 s | 0.1 to 0.5 s | 0.3 to 6 s | 25 to 125 s |
| Endgame | 0.02 to 0.07 s | 0.02 to 0.1 s | 0.1 to 1.7 s | 6 to 26 s |

The fresh level-1 character (SP 11, Ashwood wand with Blazing: `(11 + 1.06) × 1.0 × 1.30 = 15.7` per hit × 2.38 casts/s = 37 DPS) takes
`4,007 / (37 × 0.3) = 361 s` for the T1 boss: the measured 4.5 to 5.6 minutes (with levelling on the way) the owner accepted.

### 7.2 Incoming damage: hit sizes versus life

Post-mitigation hits of wave-3 monsters at the band's home level, gap included; armour build (`d × (1 − A/(A + 10d))`), damage-taken
multiplier of the band (1.0 / 0.82 / 0.65), elemental hits use effective resistance. "Boss slam" is the Matriarch's 1.8× telegraphed slam
(`26 × 1.8 = 46.8` base).

| ML | Band | Life | Bite abs | Bite % | Brute slam % | Boss slam abs | Boss slam % | Spitter orb % |
|---|---|---|---|---|---|---|---|---|
| 16 | fair | 272 | 3.5 | 1.3 | 9 | 63 | 23 | 4.4 |
| 16 | good | 342 | 2.0 | 0.6 | 5 | 46 | 14 | 2.3 |
| 16 | endgame | 410 | 1.1 | 0.3 | 2 | 31 | 7 | 1.0 |
| 28 | fair | 420 | 21.2 | 5.1 | 26 | 253 | 60 | 10.5 |
| 28 | good | 566 | 12.5 | 2.2 | 14 | 193 | 34 | 4.8 |
| 28 | endgame | 690 | 6.7 | 1.0 | 7 | 136 | 20 | 1.8 |
| 40 | fair | 578 | 38.1 | 6.6 | 32 | 414 | 72 | 13.0 |
| 40 | good | 812 | 22.0 | 2.7 | 16 | 316 | 39 | 5.5 |
| 40 | endgame | 1,000 | 11.8 | 1.2 | 9 | 225 | 23 | 1.9 |
| 60 | fair | 859 | 72.9 | 8.5 | 38 | 732 | 85 | 16.6 |
| 60 | good | 1,297 | 39.4 | 3.0 | 18 | 553 | 43 | 5.9 |
| 60 | endgame | 1,606 | 20.7 | 1.3 | 9 | 392 | 24 | 1.8 |
| 88 | fair | 1,175 | 172.7 | 14.7 | 61 | 1,577 | 134 | 28.9 |
| 88 | good | 1,854 | 96.8 | 5.2 | 28 | 1,209 | 65 | 9.1 |
| 88 | endgame | 2,296 | 52.3 | 2.3 | 15 | 875 | 38 | 2.5 |

Targets: trash bite 5 to 9% (fair), 2 to 3% (good), 1 to 2% (endgame) per hit (an actual swarm lands 3 to 10 bites per second, so these are
the "chip" numbers); heavy hits (Brute slam, boss slam, rare strike 1.6×) 25 to 85% fair, 14 to 43% good, 7 to 24% endgame at ML ≤ 60.
At ML88 **good is pushed to 65% (two slams)**: T15 is endgame content by design, a good build can still do it with perfect dodging. A fair
build at ML88 is one-shot: "one-shots are legitimate".

Note the old curve at ML60 gave a good-band boss slam of 589% and trash bite 69%: unplayable. The v3 curve is what lets T6 to T15 exist.

---

## 8. Defences: how each layer matters

Layer by layer, what it removes and where it fails (the reason no single layer is enough):

| Layer | Rule (exists unless NEW) | Strong against | Fails against | Budget at ML60 (good / endgame) |
|---|---|---|---|---|
| **Life** | 70 + 8(L−1) + str + gear; +1% per 10 str | everything, linearly | big hits (one-shot) | 1,297 / 1,606 |
| **Armour** | physical hit × `A / (A + 10 × hit)` | many small physical hits (bites): 1,015 armour vs a 39 hit = 72% reduction | slams: vs a 553 raw hit the same armour is 15% | 1,015 / 2,040 |
| **Evasion** | `rating / (rating + 30 × ML)`, cap 75%; melee and projectile only | bites, projectiles | slams, areas (cannot be evaded), and degrades by 30 per monster level | 41% / 57% evade |
| **Resistance** | cap 75%, `min(75, uncapped − map penalty)` (NEW buffer rule), shortens elemental debuffs | Spitter orbs, Ember bursts, ignite | physical and void have no penalty-free answer: void resist is rarer, physical has none | effective 28 / 66 |
| **Ward / barrier** | Cinder Ward 35 to 55% less, cap 60%, 4 to 7 s; NEW Rime Bulwark absorb barrier | the 1-in-10 s emergency | uptime (cooldown 9 to 14 s, Focus 20) | 18% (good) / 35% (endgame) average reduction at 40% / 50% uptime |
| **Flasks** | Life flask `(40 + 8L) × effect` over 3 s, 5 charges per slot, refilled in the hideout | chip damage, bleeding/burning (also cleansed) | a hit bigger than life; running out of charges | 504 per flask at L58: 39% of a good life bar |
| **Focus** (NEW tie-in) | 30% of damage can be drawn from Focus by the Iron Mind keystone and Anchorite's Seal | burst on a high-Focus character | exhausts the attack resource | 376 / 409 Focus |
| **Level gap** | +5% per level above grace 3 | – | being under-levelled | 0 inside home band |

Rules that keep layers honest:

1. **Life is the only layer that is not a percentage.** All others are bounded or fall with hit size, so the best defence of a high-tier build is
   a mix: (armour or evasion) for chip, resist for elements, life/ward/barrier for the big hit, flasks for sustain.
2. **Armour is not an all-purpose answer**: at ML88 a Brute slam raw is 608 × 1.25 = 760; endgame armour 3,269 reduces it by 3,269 / (3,269 + 7,600) = 30%.
   At ML28 a bite of 35 against 858 armour is reduced 71%. Armour is "good against many small hits", evasion "good against single big hits it can dodge".
3. **Evasion tops out at about 60% at ML88** with full evasion gear (the owner's "50% only with very focused high-end gear"): 3,896 rating / (3,896 + 30 × 88).
4. **Resistance is the cheapest layer to over-cap and the only one the map penalty attacks directly.** At ML88 the penalty is −39: an endgame build needs about
   108 uncapped to reach an effective 69, which is why the new `maxResistance` notable (+3 to +10 cap) and the overcap buffer matter.
5. **Mixed defences are rewarded by the damage mix of the roster**: Ashen Forge is physical-heavy (Ashling, Brute) with fire (Spitter, Matriarch); Rimed Ossuary cold;
   Iron Coliseum physical and bleed. A pure-evasion build loses to the Brute slam; a pure-armour build loses to Spitter orbs. This is by roster design, not by a flat rule.

### 8.1 Focus (the resource that must matter)

`maxFocus = 40 + 2(L−1) + int + gear`; `regen = (3 + 2% max) × (1 + focusRegen%)`. Computed per band:

| ML | Fair max / regen | Good max / regen | Endgame max / regen |
|---|---|---|---|
| 4 | 85 / 5.2 per s | 91 / 7.0 | 97 / 9.4 |
| 28 | 187 / 7.4 | 209 / 10.4 | 231 / 14.5 |
| 60 | 325 / 10.4 | 376 / 15.2 | 409 / 21.2 |
| 88 | 419 / 12.5 | 493 / 18.6 | 534 / 26.0 |

A 12-Focus skill cast at 3 casts/s needs 36 Focus per second; the good band sustains `15.2 / 36 = 42%` of that at ML60. That is intended: Lance (free)
fills between Focus casts, and cast speed has a real price. Rules: **skill Focus costs are fixed per cast** (they do not scale with level; they are cheaper
in proportion as the pool grows); Focus-on-kill and Focus flasks are the sustain affixes; a cast-speed build must pay for it in regen or run out. See `skills.md`
for per-skill costs (6 to 40) and the DPS-per-Focus budget.

---

## 9. Clear speed: the model and the Atlas finding

### 9.1 Why every archetype was slower than the empty tree

`atlas-tree-harness.ts measure()` calibrates one number, `speed = baseline.units / (6 × REFERENCE_KILL_SECONDS 40)`, on the empty tree and then
holds it for every archetype. `clearSeconds()` models waves that end on clearing or at the timer. Consequences:

1. Anything that adds monsters or life (density, Fortified, rare packs) raises `units` at constant `speed`: slower. Correct arithmetic for a harness with a fixed kill rate.
2. Anything that shortens the wave timer (Haste scarabs, Overrun Doctrine -30% wave duration) can only help when the player is **timer-bound** (kills slower than the timer). The
   reference speed makes the baseline kill-bound exactly at 40 s per wave of 60, so a shorter timer (45 s) is the same speed with a smaller buffer; the harness's own backlog model then
   punishes it.
3. The harness has no concept of the player getting stronger, so no tree node *can* beat the baseline. The finding is a **harness artefact, not a tuning error in Haste/Overrun**.

### 9.2 Decision: where speed lives

**Clear speed is character power. The Atlas tree changes tempo and density; it does not change how fast you kill.**

- Character: DPS, targets per cast (area, projectiles, chain, pierce), movement speed, cast/cooldown speed, projectile speed, Rift Step/Phase Stride, aggro reach
  (range), flask/Focus sustain. All in `skills.md` and `passive-tree.md`.
- Atlas: wave timer (Haste, Overrun) and density/rarity (count, packs) change **how much there is per minute and how much it pays**; they are not speed. A timer-bound character
  (fair band) *does* finish sooner under Haste; a kill-bound one does not. That is correct.
- Harness: replace the fixed `speed` by the character model: `speed(band, ML) = DPS_band × uptime × targets / (reference life unit)`, so the same node set is evaluated
  at fair, good and endgame. Replace acceptance (d) "no archetype's clear time below 0.55× baseline" (meaningless) with:
  (d1) a speed/density archetype must raise **value per hour** at the good band by 1.15× to 1.6× baseline; (d2) it may raise **clear time** by at most 8% for the good band
  and may lower it by at most 25% for the fair band; (d3) no node moves the kill-bound clear time below 0.92× baseline. Haste and Overrun Doctrine then read as
  "tempo" nodes: more kills per minute, more danger per minute.

### 9.3 The clear-time model (seconds per map)

```
T_map = 1.8 × Σ_w P_w × hop_w / v          walking (route inefficiency 1.8)
      + Σ_w P_w × (kill_w + 0.4)           pack kills + 0.4 s aggro/aim per pack
      + 18                                  six 3-second tells
      + boss TTK (section 7.1)
      + 45                                  loot clicks, chest, portal
P_w = packs in wave w = [4, 6, 8, 9, 11, 13]   (60% of 40 + 18(w−1) monsters in packs of about 6)
hop_w = max(60, 0.7124 × sqrt(A / P_w) − 250)   (A = π × 900², travelling-salesman spacing minus 250 engage reach)
v = 110 × (1 + move speed)    kill_w = packLife / (DPS × 0.8 × min(targets, 6) × 0.85)
```

| ML | Fair | Good | Endgame |
|---|---|---|---|
| 4 | 7.6 min | 3.7 min | 3.0 min |
| 10 | 6.3 min | 3.6 min | 2.9 min |
| 16 | 5.9 min | 3.4 min | 2.8 min |
| 22 | 8.0 min | 3.7 min | 2.9 min |
| 28 | 10.3 min | 3.9 min | 3.0 min |
| 40 | 12.7 min | 4.1 min | 3.0 min |
| 60 | 19.7 min | 4.5 min | 3.1 min |
| 88 | 36.0 min | 5.5 min | 3.3 min |

Decomposition (seconds): fair ML28 618 = walk 101 + kills 146 + tells 18 + boss 308 + loot 45; good ML28 235 = 89 + 33 + 18 + 50 + 45; endgame ML28 178 = 79 + 23 + 18 + 12 + 45;
good ML60 272 = 89 + 41 + 18 + 79 + 45; endgame ML60 185 = 79 + 24 + 18 + 18 + 45.

What "rush" means: **3 to 3.5 minutes for the endgame band on an unjuiced map, 4 to 5.5 for a good build, 9 to 13 for a fair build on its home tier.** (The model is a floor; the sim bot
adds dodging and measured value must be within +30%; the harness reports both.)

**Past the "good" band, DPS stops speeding the map**: kills are 13% of an endgame map. The levers that still pay are movement (+40% move speed saves about 10 s of 185), range/aggro reach
(a 320-unit Lance engages at 280, a 450-unit Frost Orb zone engages earlier), and **density**: a juiced map (monster count ×2 from Teeming/Seething plus Atlas density) is
+22% time for good and +13% for endgame (5.3 and 3.5 minutes at ML60), which is the "endgame players run denser maps" loop. Pack-size scaling is therefore a map decision, not a character stat.

Levers ranked by seconds saved on a good-band map (ML60, 272 s): boss TTK −79 s to −18 s (build quality); walking −10 to −20 s (move speed, Phase Stride); kills −10 s (AoE); loot −20 s
(pickup radius and the existing auto-pickup); tells −0 (fixed). This is why **boss kill speed is the main differentiator** between good and endgame, and why augments that
concentrate damage (lodge-and-detonate, Hex exposure) pay off against bosses.

---

## 10. Items, crafting and uniques

### 10.1 New affixes (all follow the existing 7 to 10 tier ladders; classes and slots listed)

| Affix | Kind | Stat | Tiers (T1 first) | Ladder | Item classes | Notes |
|---|---|---|---|---|---|---|
| of Sundering (fire) | suffix | `firePen` | 14-15, 12-13, 10-11, 8-9, 6-7, 4-5, 2-3 | 7 (ilvl 78 for T1) | wand, sceptre, focus, amulet | Tag `penetration` (new `AffixTag`). Group `pen:fire` |
| of Sundering (cold / lightning / void) | suffix | `coldPen`, `lightningPen`, `voidPen` | same | 7 | same | |
| of Prisms | suffix | `elementalPen` | 7-8, 6-7, 5-6, 4-5, 3-4, 2-3, 1-2 | 7 | focus, amulet, ring | half value, three elements |
| Entropic | prefix | `voidDamage` increased | same as element ladder 8-12 … 51-56 | 10 | wand, sceptre, focus, amulet, ring | missing today although `voidDamage` exists |
| Concussive | prefix | `physicalDamage` increased | same | 10 | wand, sceptre, focus, amulet | |
| Lingering | suffix | `damageOverTime` increased | 10-14, 15-18, 19-23, 24-29, 30-36, 37-44, 45-53, 54-63 | 8 | wand, sceptre, focus, gloves | |
| of Volleys | suffix | `projectileDamage` increased | 8-12 … 36-41 | 8 | wand, gloves | |
| of Eruptions | suffix | `areaDamage` increased | 8-12 … 36-41 | 8 | focus, amulet, gloves | |
| of Warding (max resist) | suffix | `maxResistance` flat | 1, 1, 2, 2, 3, 3 (pp to the cap) | 7, T1 ilvl 78 | amulet, ring | cap stays ≤ 85 |
| of Reserves | suffix | `flaskChargeOnKill` | 1 charge per 40 kills (base) improved to per 38, 36, 34, 32, 29, 25 kills | 7 | belt | see 10.3 |

The exact `StatId` additions: `firePen coldPen lightningPen voidPen physicalPen elementalPen projectileDamage areaDamage damageOverTime maxResistance extraChains flaskChargeOnKill`.
Existing saves are untouched (these are new affixes; no existing affix changes), so `AFFIX_VERSION` stays 2.

**Value check (penetration must be an answer, not a better "increased"):** at ML60 good (Σinc 324%), +8 pen against a res-10% trash monster is `0.98 / 0.90 = +8.9%` damage;
a 30% spell-damage prefix at the same tier band is `4.54 / 4.24 = +7.1%`. Against a res-0 monster pen gives 0%; against a res-40% Rimeshade it gives `0.68 / 0.60 = +13.3%`; against a
proof rare `0.18 / 0.10 = +80%`. Pen is a slight edge on average and a decisive one exactly where the game "walls" you: this is the intent.

### 10.2 Crafting implications

- **The bench answers walls**: `BENCH_BEST_TIER = 4` means the bench can add any one affix at ilvl ≤ T4. With 7-tier pen ladders T4 is 8 to 9 pp (ilvl 40+) for 7 to 12 Scrap plus the matching essence. A
  character always has a cheap, deterministic, single-item pen answer; the 40-pp cap needs real crafting (T1 to T3 rolls) or the tree.
- **Essences**: Ember/Rime/Storm Essence add the matching *damage or penetration* affix (random of the two) on top of the current mapping; add **Umbral Essence** (void + physical + their
  pen), dropped by the Void Breach event and T8+ void-themed bosses.
- **Catalyst/Fracture** target pen like any other affix. A fractured T2 pen is a build-defining item, the PoE-style crafting story CONCEPTS asks for.
- **Prefix/suffix competition is the point**: penetration, crit, cast speed, ailment chance, area, DoT and projectile damage are all suffixes. A weapon has 3 suffix slots, so choosing pen means
  giving up cast speed or crit: that is the offence/answer trade.
- **Scars** (existing list) stay unchanged in v1. Reserved for later: `Dull` (−4 to −8 penetration).

### 10.3 Flasks (NEW utility kinds; existing two unchanged)

| Flask | Effect | Duration | Charges |
|---|---|---|---|
| Life, Focus (existing) | `(40 + 8L)` life / `(30 + 4L)` Focus over 3 s, removes Burning/Bleeding / Withered | 3 s | 5 per slot |
| **Quickstep** (NEW) | +30% move speed, break roots | 4 s | 5 |
| **Aegis** (NEW) | +15 pp all resistances (buffers the map penalty), cap respected | 6 s | 5 |
| **Quicksilver Mind** (NEW) | +25% Focus regen and instant 15% Focus | 5 s | 5 |
| **Charge rule** (NEW) | each belt slot gains 1 charge per 40 kills (belt affix of Reserves: per 25) | – | – |

Why: today charges only come from drops and the hideout refill (`refillBelt`), so a long map runs dry; the kill-charge makes flask sustain part of a clearing rhythm (the owner's "flasks matter")
without adding an infinite heal: at 5 charges per 40 kills a build killing 500 monsters per map gains about 12 charges per slot, each life flask recovering 39% of a good life bar.

### 10.4 New uniques that enable builds (ten; first-pass numbers, names are free)

Level requirements keep them inside the existing unique ladder (`UNIQUES`, the world pool and boss-exclusive pools):

| Unique | Base | Lvl | Mods | Behaviour flag | Enables |
|---|---|---|---|---|---|
| Frostfire Spiral | Glassbone Wand | 30 | +(25-35)% fire and +(25-35)% cold damage; 15% reduced cast speed | 40% of fire converted to cold | the conversion build without the passive |
| Stormcaller's Lattice | Stormglass Sceptre | 46 | +(40-50)% lightning damage; +(12-16) lightning pen; 10% reduced max life | all skills chain +1 (`extraChains`) | chain/penetration lightning |
| Penitent's Prism | Prismatic Amulet | 44 | +(20-30)% elemental damage; +(10-14) elemental pen | skills cost 15% more Focus | elemental generalist vs proof |
| Hollow Crown | Duskweave Robe | 52 | +(35-45)% void damage; 10% reduced all resistances | Decay stacks 8 times (not 5) | the void DoT build |
| Weeping Hearth | Ember Sceptre | 22 | +(60-90)% damage over time; ignite chance −20% | ignite lasts 6 s, burns 40% less per second (same total) | ignite spreading |
| Gravewind Boots | Wayfarer Greaves | 40 | +(10-14)% move speed; +(15-25)% cooldown recovery | Phase Stride lasts twice as long | the "rush" build |
| Anchorite's Seal | Dusksteel Ring | 48 | +(30-40) max Focus; 8% reduced max life | 30% of damage taken drains Focus first | the Focus-shield build |
| Bellwether | Bone Talisman | 38 | +(8-12) all attributes | the skill in loadout slot 1 gains +2 augment slots | the single-skill build |
| Needlepoint | Cinder Orb | 36 | +(3-4) crit chance; +(25-35)% crit multiplier; 10% less damage on non-crits | crits penetrate 15% resistance | the crit/pen build |
| Twice-Struck Bell | Runed Tome | 34 | +(20-30) max Focus; +(10-15)% cooldown recovery | lodged detonations trigger twice (second at 50%) | lodge-and-detonate |

Rules: none gives a `more` above 25%; none is mandatory; none grants penetration above 16 (so the cap needs the tree or crafted gear). Boss-exclusive unique pools grow by two (Stormcaller's Lattice, Hollow Crown) so
the existing "12% × rarity" bonus roll can drop them.

---

## 11. Anti-degeneracy rules (all enforced in one resolver, with "(capped)" in tooltips)

| Rule | Cap | Reason |
|---|---|---|
| Penetration per type | 40 pp | pen is an answer, not a damage layer |
| Pen never below 0 resistance | – | no runaway against negative-res monsters |
| Exposure | 25 pp max, floor −25%, non-stacking, 4 s, half on bosses | one source at a time; bosses keep their resist |
| `more` from passives + augments + uniques | ×3.5 | gear stays additive; the multiplicative layer is bounded |
| Increased cast speed | +150% | Focus is the soft cap; the hard cap protects the sim (tick budget) |
| Cooldown recovery | +100% | cooldown skills cannot be cast-spammed |
| Crit chance / multiplier | 100% / 500% | |
| Area increased | +100% (radius ×1.41) | readability and sim cost |
| Extra projectiles / pierce / chains | +6 / 8 / 12 total | fan readability, sim cost |
| Resistance cap (player) | 75, +10 from `maxResistance` | |
| `damageTaken` product from passives/ward | ≥ ×0.60 (at most −40% total) | prevents invulnerability stacks |
| Conversion | shares never exceed 100%; applied once per type in a fixed order | no loops |
| Skills per loadout | 8 slots, each skill once | existing rule |
| Echo | repeats never repeat; echoes cost no Focus; max one echo layer per cast | existing rule, extended |
| On-kill effects | at most 8 triggers per tick per player | sim budget |

Degenerate strategies checked by the harness (see `build-plan.md`): single-target "boss only" builds that cannot clear trash (low targets × high crit), pure-pen builds (no damage), 4×-chain nova
screen-wipes (area cap), infinite Focus loops (Focus on kill capped at 8 per kill and not triggered by DoT), invulnerability stacks (damage taken floor), kiting-only builds (loot radius, the stream's pressure floor).

---

## 12. The knobs (data constants the balancer moves)

| Knob | File | Today | v3 start | Moves |
|---|---|---|---|---|
| `LEVEL_CAP` | `data/progression/classes.ts` | 60 | 80 | endgame access; passive points |
| `MONSTER_LEVEL_SCALING.segments` (life, damage from 28) | `data/progression/maps.ts` + `sim/constants.ts` | steep ×1.11 forever | 1.061/1.0545/1.0384 and 1.040/1.028/1.019 | the whole high-tier difficulty |
| `RARE_LIFE_FLOOR`, magic floor | `sim/archetypes.ts`, spawn | none | 22→150 | rare TTK |
| `ELITE_PROOF_RESIST`, proof weights, void/physical proof, double proof | `sim/archetypes.ts` | 0.9, 0.6 weight | + new mods | wall frequency |
| `MONSTER_RESIST_CAP` | `sim/constants.ts` | 0.9 | 0.9 | proof strength |
| `PEN_CAP` | new, `data/progression/combat.ts` | – | 40 | answer strength |
| `EXPOSURE` {max 25, floor −25, duration 4, bossFactor 0.5} | new | – | as listed | rare TTK with one skill |
| `DOT_RESIST_FACTOR` | new | 1 (hit resist) | 0.5 | DoT builds vs proof |
| `MORE_CAP` | new | – | 3.5 | multiplicative power |
| `SPELL_POWER` {base 11, perLevel 1.6} | `classes.ts` | same | same | level share of power |
| `MAX_SKILL_RANK`, effectiveness endpoints | `skills.ts` | 20, 1.0→2.3 | 10, same endpoints | main-skill power |
| Affix ladders (added, spell %, element %, crit, cast) | `data/items/affixes.ts` | see 5.1 | same | gear share; the new pen/DoT ladders |
| `LEVEL_GAP` | `maps.ts`, `sim/constants.ts` | 3, 5%, 100% | same | under-level penalty |
| `PLAYER_RESISTANCE_SCALING` | `maps.ts` | 0.5/level, cap 40 | same + buffer rule | resist demand at depth |
| `evasionPerMonsterLevel`, `evasionCap`, armour constant 10 | `classes.ts`, `combat.ts` | 30, 0.75, 10 | same | evasion/armour curves |
| `WARD` reduction cap, `ward` ranks | `constants.ts`, `skills.ts` | 0.6 | 0.6 | defence layer |
| Focus: `focusRegen`, per-skill costs | `classes.ts`, `skills.ts` | 3 + 2% | same, costs per `skills.md` | cast-speed ceiling |
| Flask recover, charges, kill-charge | `data/items/flasks.ts` | 40+8L | + utility kinds | sustain |
| `WAVES`, `PRESSURE_*`, `STREAM_*` | `data/progression/maps.ts`, `sim/constants.ts` | existing | unchanged | map length floor |
| Band parameters (section 5.2) | `tests/.../character-bands.ts` | – | table | what "fair/good/endgame" means |

Verification numbers to pin (always-on tests, `build-plan.md` section 5): the ML28 fair/good/endgame boss kill times 308/50/12 s ±30%, the ML60 good/endgame 79/18 s ±30%, the slam percentages in 7.2 ±25%, the monster
curve table 6.1 exactly (data test), the proof-rare matrix 4.3 exactly (unit test of `damageMonster` order), the resist floor/pen cap (unit tests).
