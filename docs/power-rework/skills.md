# C. Skills: the roster, the augment system, the economy

Status: design brief (no code written). Numbers are first pass; the shapes (rank 1 to 10, augment tiers, point costs, Focus budgets) are decisions.
Read `power-curve.md` for the damage model these skills plug into (layers 3 to 17) and `overview.md` for the slice order.

---

## 0. Decisions in one table

| Question | Decision | Why |
|---|---|---|
| How many skills | **32** (23 attack skills, 9 utility/movement/defence/buff), 5 by level 3, one more roughly every 2 levels to level 36, the last at 62 | the owner asked for 28 to 36; unlock by level gives a visible curve instead of a prerequisite maze |
| Ranks | Keep ranks, **max rank 20 → 10**. Effectiveness endpoints unchanged (Lance 1.0 → 2.3). Each rank costs 1 skill point | with 32 skills and an augment layer, 20 ranks × N skills is a point sink that crowds out choices and makes every new skill weak next to a rank-20 old one |
| Skill points | **2 per level from level 2** (`1 + 2(L−1)`: L10 19, L20 39, L40 79, L60 119, L80 159) | a build is about 6 skills × 10 ranks plus 20 augment points; 1 per level cannot pay for choice |
| Unlocking | by **character level**, learning costs 1 point (= rank 1); no prerequisite chains | the old "Nova rank 3 unlocks Flame Wave" chain is replaced; already-learned skills stay learned |
| Skill tree mechanic | **Augments**: each skill owns a small branching modifier tree of 6 to 7 nodes in three tiers; points create behaviour changes (pierce, split, fork, chain, lodge-and-detonate, convert, echo, delay, shape change, exposure) | the owner's "behaviour-changing skill branches" |
| Support gems / linking | **No.** Augments are the support layer | support gems are a second item system (drops, sockets, colours, crafting) that would compete with the gear crafting that is the heart of the game (CONCEPTS pillar 1) and double the UI |
| Loadout | **8 slots** (adds `Space`, `Z`), three named presets in the hideout | 32 skills across attack, mobility, defence, buff and utility do not fit in 6 |
| Augment cap per skill | `floor(rank / 2)`, at most 5 (6 with the unique Bellwether) | rank buys breadth of choice |
| Respec | augments and ranks refund leaf-first for Scrap; free below level 20; one-time free full respec at migration | see section 9 |
| Where power lives | augments are **sidegrades with tradeoffs**; flat damage comes from rank and gear. Augment "more" lines count against the global `more` cap of ×3.5 | no augment is a mandatory +damage |

---

## 1. What exists today (read from the code)

Seven skills in `src/data/progression/skills.ts` (`SKILL_IDS` in `contracts/content.ts`): Ember Lance (basic, 0 Focus), Ember Nova, Flame Wave, Rime Shards, Arc Chain, Rift Step, Cinder Ward.
`MAX_SKILL_RANK = 20`; rank values are `lerp`, `steps` or `every/after` curves; prerequisites by rank (`emberNova` rank 3 gates Flame Wave and Rime Shards, Rime rank 5 gates Arc Chain);
one skill point per level; `LOADOUT_SLOTS = 6` (LMB RMB Q E R F); uniques add `flagsFrom` behaviours (Patient Spark pierce-all, Everburn always ignite, Echo of the Matriarch nova echo, Sunken Sun fan, Last Rite circle, Choir of Glass pierce-all,
Second Verse echo, Winterstride chill landing, Stillwinter cold ward, Vigil of Ash focus ward, Broken Link cleanse, Iron Refrain revisit, Unbowed Crown renewal). The sim executes each skill by a `switch` on its id
(`sim/skills.ts releaseSkill`), with bespoke code per skill (`fireFan`, `novaBurst`, `arcChain`, `riftStep`, `cinderWard`).
Every one of those unique effects becomes an **augment effect granted by item** in the new system (section 5.4), so no unique changes behaviour for existing owners.

Damage: `(spellPower + added) × effectiveness × (1 + Σincreased) × Πmore`, spell power `11 + 1.6 (L−1)`, effectiveness by rank, Focus costs 8 to 20, Focus regen `3 + 2%` of max.

---

## 2. Scaling rules

| Rule | Spec |
|---|---|
| Base | spell power `11 + 1.6 (L−1)`; flat `addedSpellDamage` from gear applies **per hit** before effectiveness (so low-effectiveness many-hit skills get proportionally the same flat benefit as high-effectiveness ones: fair) |
| Effectiveness | `e(rank)` = lerp from `e₁` at rank 1 to `e₁₀` at rank 10; typical +7% to +14% of `e₁` per rank (Lance 1.0 → 2.3). Augments may add `more` lines (counted in the `more` cap) |
| Level scaling | skills have no level requirement for rank; they scale through spell power only. Gear tiers scale by item level (`power-curve.md` section 5) |
| Weapon / base | wands and sceptres give added spell damage (`1 + 0.06 ilvl` Ashwood to `4 + 0.14 ilvl` Stormglass) and an implicit; there is no weapon base damage. Unchanged |
| Tags | Spell always; Projectile, Area, Chaining, Duration, Movement, Buff, Attack-shape tags select the new tag stats (`projectileDamage`, `areaDamage`, `damageOverTime`) |
| Focus | cost per cast fixed (6 to 40); per-skill sustain = `min(1, regen × interval / cost)`; see budget below |
| Cooldowns | per skill (and per charge); `cooldownRecovery` divides them; cap +100% |

**Skill power budget (first-pass rule for authoring numbers).** Single-target DPS index = `e₁₀ × hits-on-one-target / max(cast time, cooldown per charge)` divided by Lance's `2.3 / 0.42 = 5.48`.

| Class | Index vs Lance | Focus per second when spammed | Examples |
|---|---|---|---|
| Basic | 1.0 | 0 | Ember Lance |
| Spam | 1.2 to 2.2 | 15 to 27 (sustained 30 to 70% by band) | Umbral Bolt 2.2, Kinetic Lance 1.4, Rime Shards 1.3, Static Lash 0.85 |
| Area / cooldown | 0.2 to 0.5 per target × targets | 3 to 8 | Nova 0.22, Flame Wave 0.22, Arc Chain 0.37 × 9 links, Mortar 0.44 |
| Burst | 1.0 to 1.3 averaged over the cooldown | 2 to 4 | Immolation Sigil, Meteor Rain, Event Horizon |
| Utility | 0 (non-damaging or low) | – | Rift Step, wards, buffs |

A spam skill is worth casting only while Focus lasts; Lance fills the gaps. At the good band ML28 (regen 10.4/s, pool 209) Umbral Bolt (24 Focus/s) is sustained 43% of the time
(`10.4 / 24`), average DPS ≈ `0.43 × 2.2 + 0.57 × 1.0 = 1.5×` Lance: a real but not absurd gain, and cast speed makes it *worse* (Focus is the soft cap on speed builds).

---

## 3. The roster (32)

Columns: Unlock (character level) · Focus · Cast time (s) · Cooldown (s) · Effectiveness rank 1 → 10 · Crit% · Ailment% · Sim size (S new data only, M new primitive, L new subsystem).

| # | Skill | Element / role | Unlock | Focus | Cast | CD | e₁ → e₁₀ | Crit | Ailment | Shape and key numbers | Tags | Sim |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Ember Lance** | Fire, basic | 1 | 0 | 0.42 | – | 1.0 → 2.3 | 6 | ignite 10 | one bolt, speed 420, range 320 | Spell Projectile Fire | S (exists) |
| 2 | **Ember Nova** | Fire, area | 1 | 12 | 0.55 | 3 | 1.0 → 1.8 | 5 | ignite 15 | ring of 12 → 20 flames, range 170, pierce 1 (+1 at ranks 5, 10), speed 260 | Spell Projectile Area Fire | S |
| 3 | **Rift Step** | Void, movement | 1 | 8 | 0 | 3.5 / charge | – | – | – | blink 90 → 120, 0.2 s invulnerable, 2 charges (+1 at ranks 5 and 10), breaks roots | Movement Void | S |
| 4 | **Cinder Ward** | Fire, defence | 2 | 20 | 0.3 | 14 → 9 | 0.25 (embers) | 5 | – | 4 → 7 s, 35 → 55% less damage (cap 60%), embers burn r40 every 0.5 s | Spell Buff Duration Fire | S |
| 5 | **Rime Shards** | Cold, spam | 3 | 8 | 0.34 | – | 0.55 → 1.2 | 8 | chill 30 | 3 → 7 shards, spread 0.35, pierce 2, speed 360, range 260 | Spell Projectile Cold | S |
| 6 | **Phase Stride** | Movement buff | 5 | 6 | 0 | 9 → 6 | – | – | – | 3 → 4 s: +35% move speed, no crowd slow (`CROWD_SLOW`), pass through allies | Movement Buff | M |
| 7 | **Arc Chain** | Lightning, chain | 6 | 14 | 0.38 | 1 | 0.9 → 2.0 | 10 | shock 25 | strikes nearest enemy to cursor (range 240), chains 3 → 8, jump 90, needs line of sight | Spell Chaining Lightning | S |
| 8 | **Glacial Nova** | Cold, burst | 7 | 14 | 0.5 | 3 (SK2; was 4) | 1.5 → 3.3 (SK2; was 1.3 → 2.8) | 6 | chill 100 | instant circle around you r90 → 120 (not a projectile: passes cover and shields), freezes nothing, chills | Spell Area Cold | M |
| 9 | **Spark** | Lightning, spam | 8 | 7 | 0.3 | – | 0.6 → 1.4 | 7 | shock 20 | 4 → 7 sparks, speed 150, bounce off walls twice, each spark rehits an enemy at most every 0.4 s | Spell Projectile Lightning | M |
| 10 | **Cinder Mortar** | Fire, lob | 9 | 10 | 0.6 | 1.5 | 1.7 → 3.6 | 5 | ignite 25 | lobbed shell (flight 0.9 s, flies over cover and shields), blast r36 → 48, leaves burning ground 3 s (0.35e per 0.5 s) | Spell Area Fire Duration | M (lob exists) |
| 11 | **Arcane Reprieve** | Utility | 10 | 0 | 0.5 | 22 → 15 | – | – | – | restores 30% of max Focus over 3 s, removes chill and Withered | Spell Utility | S |
| 12 | **Umbral Bolt** | Void, spam | 11 | 12 | 0.5 | – | 2.6 → 6.0 | 6 | decay | slow heavy bolt (speed 200, range 300, pierce 1); applies **Decay** (void damage over time, 40% of the hit over 4 s, stacks to 5, uses half the target's resistance) | Spell Projectile Void | M (decay) |
| 13 | **Flame Wave** | Fire, area | 12 | 16 | 0.5 | 4 | 1.1 → 2.4 | 5 | ignite 25 | 5 → 9 waves, spread 0.9, pierce all, speed 180, radius 14 | Spell Projectile Area Fire | S |
| 14 | **Kinetic Lance** | Physical, spam | 13 | 6 | 0.38 | – | 1.3 → 3.0 | 6 | – | fast bolt (speed 520, range 360), pierce 3, knockback ×2; **physical damage** | Spell Projectile Physical | S |
| 15 | **Frost Orb** | Cold, area | 14 | 18 (SK2; was 16) | 0.5 | 6 | 0.5 → 1.1 per shard | 5 | chill 30 | orb (speed 90) lives 3 s, fires a shard at the nearest enemy within 140 every 0.25 s (12 shards) | Spell Projectile Duration Cold | M |
| 16 | **Storm Call** | Lightning, ground | 16 | 15 | 0.45 | 3 | 1.4 → 3.0 per strike | 8 | shock 30 | 3 → 7 strikes in r70 around the cursor after a 0.7 s telegraph, strike radius 28 (ground damage: ignores shields and flyers) | Spell Area Lightning | M (areas exist) |
| 17 | **Glacial Spikes** | Cold, line | 18 | 12 | 0.4 | 2 (SK2; was 2.5) | 1.1 → 2.4 per spike | 6 | chill 35 | 8 spikes erupting in sequence along 200 units toward the cursor, pierce all | Spell Area Cold | M |
| 18 | **Gravity Well** | Void, control | 20 | 18 | 0.45 | 8 | 0.3 (dot) | – | – | ground vortex at the cursor r70 → 90 for 3 s: pulls enemies (60 u/s), slows 40%, void ticks every 0.5 s | Spell Area Duration Void | M (pull) |
| 19 | **Rime Bulwark** | Cold, defence | 22 | 22 | 0.4 | 16 → 11 | – | – | – | barrier absorbing 25 → 45% of max life for 6 s; attackers are chilled | Spell Buff Duration Cold | M (barrier) |
| 20 | **Immolation Sigil** | Fire, burst | 24 | 18 | 0.5 | 6 | 3.0 → 6.5 | 8 | ignite 40 | sigil at the cursor, erupts after 0.8 s: fire pillar r50 | Spell Area Fire | S (areas) |
| 21 | **Static Aegis** | Lightning, defence | 26 | 18 | 0.4 | 14 → 10 | 0.6 (retaliation) | – | shock | 5 → 7 s: 25% less damage; attackers within 70 take lightning and are shocked when they hit you | Spell Buff Duration Lightning | M |
| 22 | **Voltaic Pulse** | Lightning, nova | 28 | 15 | 0.4 | 2 | 1.5 → 3.2 | 7 | shock 100 | expanding ring to r150, hits each enemy once; shocks | Spell Area Lightning | M |
| 23 | **Entropy Hex** | Void, exposure | 30 | 14 | 0.4 | 5 | – | – | – | r80 at the cursor for 6 s: **exposes −15 pp to fire, cold, lightning, void**; enemies deal 10% less damage; bosses take half exposure | Spell Area Duration Void Curse | M (exposure) |
| 24 | **Concussive Blast** | Physical, cone | 32 | 18 | 0.45 | 3 | 2.5 → 5.5 | 7 | – | 100° cone, reach 150, knockback ×3; physical | Spell Area Physical | S |
| 25 | **Static Lash** | Lightning, spam | 34 | 4 | 0.15 | – | 0.3 → 0.7 | 9 | shock 15 | beam to the nearest enemy within 200, every 0.15 s while held; needs line of sight | Spell Chaining Lightning | M |
| 26 | **Echo Sigil** | Utility buff | 36 | 20 | 0.3 | 14 | – | – | – | your next 3 skill casts echo once after 0.4 s at 70% damage, no Focus | Spell Buff | S (echo exists) |
| 27 | **Wither Field** | Void, zone | 40 | 22 | 0.5 | 10 | 0.5 (dot) | – | decay | r80 zone for 6 s: decay ticks, **Withered** stacks −8 pp all resistances (3 stacks = −24, the exposure cap) | Spell Area Duration Void | M |
| 28 | **Meteor Rain** | Fire, burst | 44 | 26 | 0.6 | 12 | 2.0 → 4.2 per meteor | 6 | ignite 30 | 6 → 12 telegraphed meteors over 2.5 s in r120 at the cursor, radius 34 each | Spell Area Fire | S (the boss meteor rain exists) |
| 29 | **Storm Step** | Lightning, movement | 48 | 10 | 0 | 4 / charge | 1.5 → 3.0 | 7 | shock | blink 140; lightning strikes at origin and landing (r60); 2 charges | Movement Lightning Area | S |
| 30 | **Tempest Surge** | Lightning, buff | 52 | 25 | 0.3 | 18 → 14 | 0.6 per pulse | – | shock | 6 s: +25% cast speed, nearby enemies (r100) pulse with lightning every 0.5 s | Spell Buff Duration Lightning | S |
| 31 | **Blizzard** | Cold, zone | 56 | 22 | 0.5 | 10 | 0.7 → 1.5 per tick | 5 | chill | r90 zone for 6 s, ticks every 0.5 s, chilled enemies take +15% cold damage | Spell Area Duration Cold | S |
| 32 | **Event Horizon** | Void, ultimate | 62 | 40 | 0.8 | 24 → 18 | 8 → 16 | 10 | – | pulls everything within r200 toward a point over 2.5 s then detonates r120 | Spell Area Void | M |

Breakdown: fire 6 (Lance, Nova, Mortar, Wave, Sigil, Meteor Rain) + Cinder Ward; cold 5 (Shards, Glacial Nova, Frost Orb, Spikes, Blizzard) + Bulwark; lightning 5 attacks (Arc Chain, Spark, Storm Call, Voltaic Pulse,
Static Lash) + Aegis + Storm Step + Tempest Surge; void 5 (Umbral Bolt, Gravity Well, Hex, Wither Field, Event Horizon) + Rift Step; physical 2 (Kinetic Lance, Concussive Blast); utility 3 (Phase Stride,
Arcane Reprieve, Echo Sigil).

**Unlock curve** (what a player sees): L1 3 skills (Lance, Nova, Rift Step) · L2 Ward · L3 Shards · L5 Stride · L6 Arc · L7 Glacial Nova · L8 Spark · L9 Mortar · L10 Reprieve · L11 Umbral · L12 Wave · L13 Kinetic · L14 Orb · L16 Storm Call ·
L18 Spikes · L20 Gravity Well · L22 Bulwark · L24 Sigil · L26 Aegis · L28 Pulse · L30 Hex · L32 Blast · L34 Lash · L36 Echo Sigil · L40 Wither · L44 Meteors · L48 Storm Step · L52 Surge · L56 Blizzard · L62 Event Horizon. With 2 points per level a
character at level 10 has 19 points and 11 skills available: learn 4, rank a main to 6, take 2 augments, rank two supports to 3.

**Existing-skill changes:** Ember Nova's flames 12 → 24 (rank curve) become 12 → 20; Flame Wave and Rime Shards lose their Nova prerequisite; Ember Lance's old rank-based pierce (+1 at ranks 6, 12, 18) moves to augments; the old Rift Step charge steps move from ranks 10 and 20 to 5 and 10.

---

## 4. The augment system

### 4.1 Rules

- Every skill has **6 to 7 augments** (flagship) or **3** (the rest), laid out in three tiers on a small graph: tier 1 at the root, tier 2 below, tier 3 at the bottom, each node connected to the root of its branch.
  A node can be taken when its **rank requirement** is met (T1 rank 2, T2 rank 5, T3 rank 8) and a free slot exists. There is no path requirement beyond the tier gate: any T1, T2 or T3 augment can be taken independently
  (it is a list with tiers, not a maze) to keep the UI one screen.
- **Slots**: `floor(rank / 2)`, maximum 5 (6 with Bellwether). T1 and T2 cost 1 point, T3 costs 2 (and one slot).
- **Exclusion groups**: some pairs/groups cannot be taken together (marked `Excl`). The UI shows them linked with a lock and the reason, as the Codex does for exclusions.
- **Item overrides**: a unique that grants an old behaviour (Patient Spark pierce-all, Echo of the Matriarch echo) acts as the augment's *stronger* version: it does not need a slot, and if the same effect is also picked, the better value applies (no stacking).
- **Tradeoffs**: most augments are sidegrades (a number goes down when a behaviour goes up). The balancer's rule: net single-target DPS of an augmented skill at the good band stays within **0.8× to 1.25×** of the plain skill unless it
  gives a different job (area-to-line, exposure), in which case it must lose at least 15% somewhere else.
- **More cap**: damage lines expressed as "x% more" count in the global `more` cap (×3.5). Most augment damage is expressed as *per-hit multipliers* (children at 40%, detonations at 240%): these are new hits, not `more`.

### 4.2 Behaviour grammar (the primitives the sim implements once)

| Primitive | Meaning | Example |
|---|---|---|
| `pierce(n)` / `pierceAll` | passes through n enemies | Piercing Flame |
| `count(+n, −x%)` | more projectiles/strikes, each weaker | Twin Strand, Hoarfrost Spread |
| `split(children, %, trigger)` | on terminal impact or kill, spawn children | Cinder Fragments, Splintering |
| `fork(n, links)` | the chain branches | Forking Arc |
| `chain(+n)` | extra jumps | Long Reach |
| `lodge(t, %, r)` | sticks in the target; detonates on timer or death | Lodge Ember, Soulbind Lodge |
| `delay(t, bonus)` | detonation after a delay | Delayed Fuse |
| `convert(from → to, %)` | damage conversion (power-curve 3.2) | Frostfire Core |
| `echo(n, delay, %)` | repeats | Echoing Ring |
| `shape(line / cone / ring / fan / waves)` | geometry change | Triple Ring, Ember Fan |
| `trail(areaKind, ...)` | leaves ground effects | Burning Wake, Napalm |
| `bounce(n)` / `return` | rebounds off walls/props; boomerang | Ricochet, Tide Returns |
| `expose(type, pp, t)` | applies resistance exposure | Searing Brand, Brittle Shards |
| `mark(t, effect)` | the target takes more / is linked | Conductive Mark, Shared Pain |
| `ailment(+chance, +effect)` | ailment tuning | Overheat |
| `onKill(effect)` | corpse effects | Shatter Rounds |
| `stat(...)` | cost, cooldown, cast time, radius, duration, `more` | Rapid Spark |

One generic **skill executor** applies these to a base emitter (`projectile`, `burst`, `strike`, `zone`, `chain`, `dash`, `buff`), replacing the `switch` of `releaseSkill`. Each primitive is S to M and shared by many augments (about 45 of 137
augments need only `stat`/`count`/`pierce`, which already exist in `resolveSkill`). That is the feasibility argument: **17 primitives implement 137 augments**.

### 4.3 Statuses (the synergy vocabulary)

Augments across skills refer to shared statuses so builds combine across the bar: **Burning** (ignite), **Chilled**, **Shocked** (+20% damage taken), **Decayed** (void DoT stacks), **Exposed(type)**, **Lodged**, **Marked**, **Hexed**,
**Withered** (monster version, −8 pp all per stack, counted as one exposure source), **Barrier**.

---

## 5. Flagship skills (13): full augment tables

Notation: tier T1 (rank 2), T2 (rank 5), T3 (rank 8, costs 2 points). `Excl` names the mutually exclusive set. "Synergy" is what the augment sets up.

### 5.1 Ember Lance (basic fire; the augment playground)

Identity: the always-available hit; whichever augments you choose become your **basic attack personality** (piercer, shotgun, bomber, converter).

| # | Augment | Tier | Effect | Excl | Synergy |
|---|---|---|---|---|---|
| 1 | Piercing Flame | T1 | pierces 2 enemies | Lodge Ember | lines of packs; Searing Brand on every pierced target |
| 2 | Twin Strand | T1 | 2 bolts 12° apart, each 75% damage | Rapid Spark | shotgun at close range; two bolts lodge twice |
| 3 | Rapid Spark | T1 | cast time −18%, 8% less damage | Twin Strand | cast speed builds; more Focus-free casts |
| 4 | Lodge Ember | T2 | bolt lodges in the first enemy hit; **detonates after 1.2 s or on its death** for 240% of the hit as fire, r46; at most 8 lodged | Piercing Flame | Twice-Struck Bell; Echo Sigil |
| 5 | Cinder Fragments | T2 | on kill, 3 fragments (55% damage, seek the nearest enemy within 140) | – | pack chains; Shatter-type builds |
| 6 | Frostfire Core | T3 | converts 50% of fire to cold; hits always chill (cold and fire gear both count) | Searing Brand | Frostfire Spiral; Rime passives |
| 7 | Searing Brand | T3 | hits expose **fire −15 pp** 4 s (−7.5 on bosses), +25 ignite chance, 12% less damage | Frostfire Core | the proof-rare answer on the free skill |

### 5.2 Ember Nova (fire, area)

Identity: panic button and crowd shaper; its augments move it between "ring", "cone", "pulses".

| # | Augment | Tier | Effect | Excl | Synergy |
|---|---|---|---|---|---|
| 1 | Wider Ring | T1 | range +30%, +4 flames, 8% less damage | Ember Fan | Area gear; Heartfire |
| 2 | Spiral Arms | T1 | two rotating arms over 0.5 s, 130% flames, each 15% less damage | Ember Fan | kills fleeing packs |
| 3 | Echoing Ring | T2 | repeats after 0.4 s at 70% damage, no Focus (the unique grants 100%) | – | Echo Sigil makes it three |
| 4 | Kiln Ring | T2 | flames leave burning ground r16 for 2 s at their end | – | DoT builds (`Lingering`) |
| 5 | Ember Fan | T2 | concentrates into a 120° cone toward the cursor: +60% damage, range +30% | Wider Ring, Spiral Arms | boss damage |
| 6 | Triple Ring | T3 | three concentric waves (r60, 115, 170, 0.15 s apart), 8 flames each, pierce 0, cooldown +1 s | – | area/projectile gear |
| 7 | Heartfire | T3 | if it hits 6 or more enemies refund 40% Focus and 1 s of cooldown; cost +25% | – | pack clearing sustain |

### 5.3 Flame Wave (fire, area)

Identity: a slow wall of fire; augments decide whether it is a **wall**, a **boomerang** or a **ring**.

| # | Augment | Tier | Effect | Excl | Synergy |
|---|---|---|---|---|---|
| 1 | Burning Wake | T1 | waves leave a fire trail r14 for 2 s (0.35e per 0.5 s) | – | DoT |
| 2 | Wide Front | T1 | +2 waves, spread ×1.4, each 20% less damage | Ring of Waves | packs |
| 3 | Tide Returns | T2 | at max range the waves return, hitting again at 60% | – | Searing Brand/Brittle exposure |
| 4 | Ring of Waves | T2 | full circle, double the waves, each 30% less damage (the Last Rite grants this free) | Wide Front | surround |
| 5 | Overheat | T3 | hits always ignite; ignite deals 50% more; cooldown +1 s | – | Weeping Hearth |
| 6 | Slow Tide | T3 | wave speed −40%, radius +60%, damage +35%, each wave rehits every enemy every 0.3 s (up to 3 times) | – | area builds; bosses |

### 5.4 Cinder Mortar (fire, lob)

Identity: the **over-the-wall bomb**. Flies over cover and Shieldbearers; the shield-and-wall answer.

| # | Augment | Tier | Effect | Excl | Synergy |
|---|---|---|---|---|---|
| 1 | Cluster Shell | T1 | splits into 3 bomblets landing within 40 units, each 45% damage | – | shielded packs |
| 2 | Napalm | T1 | burning ground radius +50%, lasts 5 s, ticks +0.1e | – | DoT |
| 3 | Delayed Fuse | T2 | shell lies 1.2 s then explodes: +60% damage, +20% radius | Skip Shot | lodge-style burst |
| 4 | Skip Shot | T2 | bounces twice (70% damage each) 60 units apart toward the cursor | Delayed Fuse | lines |
| 5 | Magma Core | T3 | leaves a molten pool r40 for 4 s: slows 30%, **exposes fire −10 pp** | – | the pool is the answer to proof/warded |
| 6 | Rain of Shells | T3 | 3 shells at random points within r70 of the cursor, 25% less damage each, cooldown +1.5 s | – | spread damage |

### 5.5 Rime Shards (cold, spam)

Identity: the **shotgun** that becomes a lodge-and-detonate or an inverted fire skill.

| # | Augment | Tier | Effect | Excl | Synergy |
|---|---|---|---|---|---|
| 1 | Brittle Shards | T1 | hits expose **cold −12 pp** 4 s | – | proof rares; Blizzard |
| 2 | Hoarfrost Spread | T1 | +2 shards, spread ×1.5, each 15% less damage | – | close-range |
| 3 | Splintering | T2 | at terminal impact (range end, wall) a shard bursts into 3 children (40%, range 90) | Lodged Ice | corridors |
| 4 | Lodged Ice | T2 | shards stick in the first enemy; **3 lodged (or 1 s) detonate** for 150% each in r40 | Splintering | Twice-Struck Bell |
| 5 | Inverted Heat | T3 | 60% of cold converted to fire, hits ignite instead of chilling | – | fire gear on a cold skill |
| 6 | Glacial Echo | T3 | echo after 0.4 s at 60%, no Focus (the Second Verse unique grants this free) | – | Focus-hungry spam made cheaper |

### 5.6 Frost Orb (cold, area)

Identity: a **turret you place**; augments make it a bodyguard, a mine or a storm.

| # | Augment | Tier | Effect | Excl | Synergy |
|---|---|---|---|---|---|
| 1 | Heavy Chill | T1 | slow 30 → 40%, chill chance 100% | – | kiting |
| 2 | Orbit | T1 | orbits you at r60 for 5 s (a rotating guard) | Frozen Heart | Rime Bulwark |
| 3 | Twin Orbs | T2 | two orbs, 35% less shard damage each | – | area |
| 4 | Shatter | T2 | when it expires it bursts for 4e in r70 | Frozen Heart | boss burst |
| 5 | Frozen Heart | T3 | hovers at the cursor 7 s, fires twice as fast, 20% less damage | Orbit, Shatter | zone control |
| 6 | Static Frost | T3 | 40% cold converted to lightning, shards chain once, shock instead of chill | – | Storm passives |

### 5.7 Arc Chain (lightning, chain)

Identity: the **chain** skill; augments choose between **fork** (spread), **ramp** (single focus) and **return** (burst).

| # | Augment | Tier | Effect | Excl | Synergy |
|---|---|---|---|---|---|
| 1 | Forking Arc | T1 | at the last link the bolt forks into 2 branches of 3 links at 50% damage | Long Reach | dense packs |
| 2 | Long Reach | T1 | jump range +50%, +2 chains, 10% less damage | Forking Arc | sparse packs |
| 3 | Conductive Mark | T2 | the first target is marked 3 s: takes +15% damage and +30 shock chance | – | Shock passives; boss opening |
| 4 | Overcharge | T2 | each jump deals +12% more than the last, starting 20% less | Forking Arc | long chains |
| 5 | Storm Return | T3 | the final link returns to the first target for a second hit at 80% | – | boss damage |
| 6 | Static Discharge | T3 | enemies killed while Shocked explode for 150% of the hit lightning damage in r60 | – | Shock builds; clears lines |

### 5.8 Storm Call (lightning, ground)

Identity: **delayed ground strikes**, unblockable and unaffected by cover.

| # | Augment | Tier | Effect | Excl | Synergy |
|---|---|---|---|---|---|
| 1 | Wide Skies | T1 | strike radius +40%, 10% less damage | – | area |
| 2 | Storm Cell | T1 | +3 strikes, cast time +0.2 s | – | pack clearing |
| 3 | Tethered Strikes | T2 | strikes land along a line from you to the cursor instead of random | Thunder Mark | corridors, line packs |
| 4 | Thunder Mark | T2 | each strike leaves a static field 3 s (0.4e per 0.5 s, shocks) | Tethered Strikes | zones |
| 5 | Eye of the Storm | T3 | 1 s after the last strike, a final strike for 3e radius 60 at the cursor | – | **boss burst** |
| 6 | Conduction | T3 | each strike chains to 1 nearby enemy at 60%, 20% less damage | – | pack scatter |

### 5.9 Umbral Bolt (void, spam)

Identity: the **heavy slow bolt** and the first non-elemental answer; it makes decay (DoT) the main damage.

| # | Augment | Tier | Effect | Excl | Synergy |
|---|---|---|---|---|---|
| 1 | Withering Touch | T1 | Decay is 50% stronger | – | `Lingering` |
| 2 | Hollow Shell | T1 | pierces all enemies, hits after the first 25% less | Soulbind Lodge | lines |
| 3 | Gravity Seed | T2 | stops at its range or the first wall and collapses: pulls enemies within r60 then bursts for 100% | Hollow Shell | control |
| 4 | Entropic Split | T2 | on hit splits into 2 bolts at ±25° at 60% each | Soulbind Lodge | spread |
| 5 | Void Exposure | T3 | hits expose **void −20 pp and all elements −8 pp** 4 s; 15% less damage | – | team/pairs: any skill benefits from the exposure |
| 6 | Soulbind Lodge | T3 | the bolt lodges 2 s; **detonates on timer or death for 300% in r70** | Hollow Shell, Entropic Split | Twice-Struck Bell; Wither stacks |

### 5.10 Kinetic Lance (physical, spam)

Identity: the **physical answer**: knockback, corpse explosions and the cheap spam that cannot be fire-proofed.

| # | Augment | Tier | Effect | Excl | Synergy |
|---|---|---|---|---|---|
| 1 | Ricochet | T1 | rebounds off walls and props up to twice, 80% damage | – | arenas with props |
| 2 | Heavy Impact | T1 | knockback ×3; an enemy pushed into a prop or wall takes 40% of the hit | – | Concussive Blast |
| 3 | Shatter Rounds | T2 | kills explode for 12% of the dead enemy's maximum life as physical in r40 (no chain beyond 3 deep) | – | high-life packs |
| 4 | Armour Piercing | T2 | ignores the Brute's 40% hit reduction; +10 physical penetration | – | armoured elites |
| 5 | Void Convert | T3 | 50% of physical converted to void, hits apply Decay | – | Umbral passives |
| 6 | Pinning | T3 | hits slow movement 25% for 2 s and make the target take 10% more damage (Staggered) | – | marked bursts |

### 5.11 Rift Step (movement, void)

Identity: your **answer to roots and bursts**; augments turn it into an offensive or defensive step.

| # | Augment | Tier | Effect | Excl | Synergy |
|---|---|---|---|---|---|
| 1 | Afterimage | T1 | leaves an afterimage for 1.5 s that explodes for 1.2e void r50 when it ends | – | kiting |
| 2 | Longer Stride | T1 | distance +30%, invulnerability 0.2 → 0.3 s, +2 Focus | – | dodging slams |
| 3 | Chilling Landing | T2 | chills enemies within 100 of the landing (the Winterstride unique grants this) | – | Frost builds |
| 4 | Rift Echo | T2 | a third use within 4 s costs no Focus; +1 charge | – | mobility builds |
| 5 | Static Arrival | T3 | lightning nova at landing (2e, r80), shocks; cooldown +0.5 s | – | Storm builds |
| 6 | Phase Weave | T3 | after landing: +25% move speed for 2 s, ignore crowd slow, remove chill and root | – | the "rush" kit |

### 5.12 Cinder Ward (fire, defence)

Identity: **damage reduction you can reshape**: damaging, cold, Focus-giving, or thornier.

| # | Augment | Tier | Effect | Excl | Synergy |
|---|---|---|---|---|---|
| 1 | Banked Embers | T1 | ember pulses reach r80 (area scales) | – | melee-ish builds |
| 2 | Frozen Hearth | T1 | the ward deals cold damage and chills (the Stillwinter unique) | Vigil | cold builds |
| 3 | Vigil | T1 | deals no damage; restores 2 Focus per nearby enemy per pulse (max 6) (the Vigil of Ash unique) | Frozen Hearth, Pyre Burst | Focus builds |
| 4 | Resolute Flame | T2 | a physical hit restores 0.5 s of duration (the Unbowed Crown unique) | – | armour builds |
| 5 | Pyre Burst | T3 | when the ward ends or is broken it bursts for 5e fire r90 | Vigil | pack burst |
| 6 | Hardened Ember | T3 | damage reduction cap +10 points (60 → 70%), cooldown +3 s | – | defensive keystone builds |

### 5.13 Entropy Hex (void, exposure)

Identity: **the answer skill**. It does no damage and makes every other skill hit harder against what you cannot kill.

| # | Augment | Tier | Effect | Excl | Synergy |
|---|---|---|---|---|---|
| 1 | Linger | T1 | duration 6 → 9 s | – | boss fights |
| 2 | Wide Hex | T1 | radius ×1.5 | – | packs |
| 3 | Wither Spread | T2 | when a Hexed enemy dies the Hex jumps to the nearest enemy within 120 for its remaining duration | – | rare packs |
| 4 | Shared Pain | T2 | Hexed enemies share 20% of damage taken with other Hexed enemies within 90 | – | pack AoE |
| 5 | Absolute Exposure | T3 | exposure −15 → −25 pp (bosses −12.5); cooldown +3 s | Bleak Mark | proof rares |
| 6 | Bleak Mark | T3 | Hexed enemies deal 25% less damage and move 20% slower | Absolute Exposure | survival |

---

## 6. The other 19 skills: 3 augments each

(All are T1/T2/T3 in that order, costs 1/1/2, rank requirements 2/5/8.)

| Skill | T1 | T2 | T3 |
|---|---|---|---|
| Glacial Nova | **Wide Chill**: radius +40%, 10% less damage | **Freezing Core**: enemies within 40 take +60% | **Shatter**: chilled enemies killed explode for 10% of their life as cold r40 |
| Spark | **More Sparks**: +3 sparks, 20% less each | **Ricochet Storm**: +2 bounces | **Charged**: sparks always shock, 15% less damage |
| Phase Stride | **Long Stride**: +2 s | **Slipstream**: +15% evasion while active | **Cleansing Stride**: casting removes chill and root |
| Arcane Reprieve | **Deep Well**: restore 45%, cooldown +8 s | **Second Wind**: also heals 15% life over 3 s | **Charged Reprieve**: the next 3 casts cost 25% less |
| Glacial Spikes | **Twin Lines**: two lines ±15°, 30% less each | **Frost Comb**: spikes leave chilling ground 3 s | **Shattering Rows**: spikes explode at the end (2e r40) |
| Gravity Well | **Heavy Well**: +40% duration, pull 20% weaker | **Crushing**: enemies inside take +20% damage | **Singularity**: collapses at the end for 3e void r90 |
| Rime Bulwark | **Thick Ice**: barrier +30% | **Brittle Retort**: when it breaks, a nova (2e, chills) | **Resolute**: regenerates 3% per second while standing still |
| Immolation Sigil | **Twin Sigils**: two sigils within 80, 35% less each | **Lingering Pillar**: the pillar lasts 3 s, ticking 0.5e | **Brand Sigil**: the pillar exposes fire −15 pp |
| Static Aegis | **Thorned Storm**: retaliation +60% | **Grounded**: +15% lightning resistance while active | **Conduction Field**: adjacent enemies take shock hits every 0.5 s |
| Voltaic Pulse | **Wide Pulse**: radius +40% | **Twice Struck**: second ring after 0.3 s at 60% | **Overload**: shocks last +2 s and are +10 points stronger |
| Concussive Blast | **Widened Arc**: 160°, 20% less damage | **Crushing Force**: knockback ×2, wall impact +50% damage | **Shatter**: kills explode physical 10% life |
| Static Lash | **Arc Lash**: also hits a second target at 60% | **Rapid Lash**: cast −20%, 10% less damage | **Tethered Chain**: chains 1 more at 50% |
| Echo Sigil | **Triple Echo**: 4 casts, echoes 10% weaker | **Quick Echo**: delay 0.4 → 0.25 s | **Costless**: echoed skills refund 25% Focus |
| Wither Field | **Hollow Ground**: radius +40% | **Rotting Fields**: ticks +40% | **Lingering Wither**: Withered persists 3 s after leaving |
| Meteor Rain | **Heavy Rain**: 30% fewer meteors, +80% damage | **Wide Skies**: radius +30% | **Burning Ground**: each meteor leaves fire 3 s |
| Storm Step | **Third Strike**: a third strike at the midpoint of the blink | **Forking Step**: lightning forks from the landing to 2 nearby enemies | **Static Cloud**: leaves a shocking cloud 2 s at the origin |
| Tempest Surge | **Long Storm**: +3 s | **Overcharged Tempo**: +35% cast speed, pulses weaker | **Lightning Skin**: +20 lightning resistance, shocked enemies take +10% |
| Blizzard | **Brittle Cold**: chilled enemies take +20% cold | **Wide Storm**: radius +40% | **Frozen Ground**: enemies in the zone slowed 50% |
| Event Horizon | **Heavy Collapse**: stronger pull, +30% detonation | **Echo Collapse**: second detonation at 50% after 0.6 s | **Void Feast**: kills during the pull refund 3 Focus each |

Totals: flagship 13 skills with 6 to 7 augments (80) + 19 skills × 3 (57) = **137 augments**.

---

## 7. Interactions with monsters, events and the Atlas

| Problem | Skill answers | Why |
|---|---|---|
| **Fire/cold/lightning-proof rares** (90%) | Entropy Hex, Searing Brand, Brittle Shards, Void Exposure, Absolute Exposure (exposure); pen from gear/tree; conversion (Frostfire, Inverted Heat, Void Convert); another element/physical/void skill; Decay and ignite (half resistance) | `power-curve.md` 4.3 |
| **Void-proof / physical-proof (T8+/T10+)** | the other three elements, conversion | new proofs make void/physical builds meet walls too |
| **Shieldbearers (frontal 120° shield blocks projectiles)** | lobs (Cinder Mortar), ground strikes (Storm Call, Immolation Sigil, Meteor Rain), bursts (Glacial Nova, Voltaic Pulse, Event Horizon), chains (Arc Chain, Static Lash: direct hits), Cluster Shell | projectiles are the only thing blocked |
| **Ghosts (Rimeshades ignore crowding)** | ground and area skills (Storm Call, Blizzard, Wither Field), chains; ghosts walk through packs so single lines miss | ghost flag exists (`MFLAG.ghost`) |
| **Flyers / fast (Glacial Wisp, Pit Hound, Skitters)** | area bursts, Spark, Frost Orb turret, Static Lash (auto-aim), Gravity Well | fast bodies defeat aimed single bolts |
| **Warded rares (40% less damage while allies are within 90)** | AoE that kills allies first (Nova, Pulse, Meteor Rain), Hex shared pain; chains that hit allies; Rift Step out of the ward | |
| **Rooters (Frost Weaver webs, Chain Thralls, tar)** | Rift Step (breaks roots), Phase Weave, Cleansing Stride, Rift Echo | existing rule |
| **Burst telegraphs (boss slams, Fault wedges, Void Breach tide)** | invulnerable blink (Rift Step 0.2 s, Longer Stride 0.3 s), Rime Bulwark barrier, Cinder Ward, Phase Stride | |
| **Events: Stalker (a hunted rare)** | burst: Immolation Sigil, Eye of the Storm, Soulbind Lodge on a single target | single-target kill time inside the grade threshold |
| **Events: Echoing/Rival Crowns (timed kills)** | AoE and speed; Echo Sigil doubling a Nova | fight-time thresholds |
| **Events: Caravan/Vaultbreakers (fleeing targets)** | Rift Step/Phase Stride to catch, Gravity Well to pull, Spark/Static Lash to hit what runs | |
| **Bosses** | Hex + exposure, lodge detonations, Eye of the Storm, Event Horizon | boss TTK is the main differentiator of builds (`power-curve.md` 9.3) |

---

## 8. Sim feasibility and presentation (per skill)

The `sim` today executes seven bespoke skills with a world of `projectiles`, `areas` (ground effects with `hurts: 'monsters'`, tick intervals, first ticks, telegraph/lock), `pendingNovas` (echo queue), `ward` state, `cinder/fire trail`. New work:

| New primitive/system | Size | Where | Notes |
|---|---|---|---|
| Generic executor with behaviour list | L | `sim/skills.ts` split into `sim/skills/*` | replaces the `switch`; deterministic, uses `w.combatRng` only |
| Projectile flags (lodge, split, bounce, return, homing, orbit) | M | `ProjectileStore` extra `Uint8/Float32` columns, `projectiles.ts` | append-only, digest updated |
| Delayed strikes / zones | S | reuse `areas.ts` (`eruptionWarning`, `hurts: 'monsters'`, `tickInterval`) | Storm Call, Sigil, Meteor Rain, Blizzard, Wither Field, Gravity Well |
| Pull (Gravity Well, Event Horizon) | M | add inward `kb` vector per tick in `ai.ts` | bosses/heavy take half |
| Barrier (Rime Bulwark) | M | `PlayerState.barrier`, applied in `hitPlayer` after armour/resist | cap 45% of max life |
| Exposure and Decay on monsters | M | `MonsterStore` columns: `expose[5]`, `exposeTime`, `decayStacks`, `decayTime`; tick like `tickIgnite` | applied in `damageMonster` (`power-curve.md` 3.1) |
| Conversion shares | M | `ProjectileSpec.shares[]` | stored per projectile (≤ 2 types) |
| Penetration | S | read `w.playerById[source].stats.pen[dtype]` in `damageMonster` | player already looked up for `closeQuarters` |
| Echo generalisation | S | `pendingNovas` → `pendingEchoes` carrying a def | existing |
| Buffs (Phase Stride, Tempest, Echo Sigil) | S | like `ward` (time, mods) | `CAST_MOVE_FACTOR` exemption |
| New projectile kinds / events | S | `PROJECTILE_KINDS` and `SimEvent` additions at the end (wire indices stay stable) | **frozen contracts: needs a contract-change slice** |

**Presenter (the existing pixel-art pipeline, `src/present`, `src/art`):** each skill needs (a) one projectile or area sprite set in its element palette (fire ember orange/red, cold cyan/white, lightning yellow/white, void violet, physical grey-gold),
(b) a cast animation reuse (the wand cast), (c) a ground decal or ring for zones, (d) a status icon for new statuses (Exposed, Decayed, Lodged, Barrier, Hexed), (e) 1 to 3 procedural WebAudio cues (the audio is synthesised, no files): a cast cue by element, an impact cue, a status-applied cue.
Effort summary: 12 skills reuse existing sprites with a tint (S), 14 need one new sprite/decal (M), 6 need new geometry (cone, line of spikes, beam, orb, sphere, vortex) (L): Frost Orb, Glacial Spikes, Static Lash, Gravity Well, Event Horizon, Concussive Blast.
Per-skill VFX notes are in `build-plan.md`, slice SK3 and SK4 (data tables owned by the art/presenter owner).

Server rules: all numbers resolve in `game/progression/skills.ts resolveSkill` and ship in `SkillRuntimeDef` (so tooltips and sim cannot drift, the existing rule). `SkillRuntimeDef` gains `augments: AugmentRuntime[]` and the executor reads only that.

---

## 9. Points economy, respec and migration

| Item | Rule |
|---|---|
| Skill points | `1 + 2 (L − 1)`; L80 = 159. Spend: learn 1, each rank 1, augment T1/T2 1, T3 2 |
| Typical spending | main skill: 10 + 7 (5 augments: 1+1+1+2+2) = 17; second 17; third 14; four utilities 5 each = 20; remaining on experiments: **a level-40 build costs about 70 of its 79 points** (so a build exists and one respec is possible) |
| Respec | refund leaf-first (augments before ranks; highest rank last); cost **4 Scrap per point (T3 augment 8)**; free for characters below level 20; session cap 120 Scrap; first 15 refunded points per character free |
| Free one-time full respec | ~~at migration~~ not granted for the skill migration (it refunds every point, owner decision 2026-10-06); the `respecTokens` mechanism (skills + augments + attributes, no Scrap) stays for later grants |
| Attribute respec (NEW) | 2 Scrap per point, 30 free, session cap 100 |
| Loadout presets | 3 per character, free to change in the hideout; mid-map changes are not allowed |
| What is refunded on migration | **Owner decision 2026-10-06 (supersedes the rank mapping below): everything.** Every skill goes back to unlearned except Ember Lance (innate rank 1, on `LMB`); unspent = `1 + 2(L−1)`; no augments; the loadout is reset; no respec token is needed. The superseded rule was `newRank = ceil(oldRank / 2)`, unspent `1 + 2(L−1) − Σ newRank` |

Worked migration (superseded by the full refund above; kept for the record): a level-17 character with old ranks Lance 6, Nova 4, Rime 3, Arc 2, Rift Step 1 (16 points spent) gets new ranks 3, 2, 2, 1, 1 = 9 spent out of `1 + 2 × 16 = 33`: **24 unspent points** plus a free full respec.
Effectiveness at the migrated rank: Lance old rank 6 `1 + 1.3 × 5/19 = 1.34` → new rank 3 `1 + 1.3 × 2/9 = 1.29` (−4%); old rank 12 1.75 → new 6 1.72 (−2%); old 20 2.30 → new 10 2.30 (0%). The worst case is −5% at old rank 4, and 24 free points
(a rank-10 main skill and three augments) more than pay for it. Migration never loses power overall.

---

## 10. UI flow

Keep the Skills panel (`K`, `src/ui/panels/Skills.tsx`) as the hub; AGENTS.md typography rule: only `--font-ui-*` tokens.

1. **Left rail: Skill book.** Skills grouped by element (Fire, Cold, Lightning, Void, Physical, Utility) with a search box. Learned skills show their rank pips; locked ones show "Level 28". A skill card is draggable.
2. **Centre: the selected skill.** Name, tags, the numbers that matter at this rank with a **"if you rank up" delta** (damage, Focus, cooldown), and below it the **augment graph**: three rows (T1, T2, T3), nodes as plates in the Codex style
   (hover = full text with the tooltip numbers recomputed for your character: "+240% on detonation (about 3,100 against a trash pack at your gear)"). Slots shown as "3 of 4 augments", excluded nodes chained with the reason.
3. **Bottom: the loadout bar**, 8 slots (LMB, RMB, Q, E, R, F, Space, Z) and 3 preset tabs. Drag a skill card to a slot (existing drag helpers `beginSkillDrag`, `allowSkillDrop`, `droppedSkill`),
   or click a skill then a slot (existing flow), right-click a slot to clear, Ctrl/Cmd-click a card = first free slot. Moving an assigned skill swaps.
4. **Points**: "12 skill points". A rank is bought with `+`; an augment by clicking its plate; costs on hover. A refund shows its Scrap price before confirming (as the Codex refunds do).
5. **HUD**: the skill bar shows 8 slots; the augment effects show as small pips on the slot icon (lodged count, charges, barrier).
6. **Tooltips** (`SkillTooltip.tsx`) list the active augments after the base lines, and the unique-granted ones with their item name.

Hotkeys: unchanged `K` for the panel; slots `LMB RMB Q E R F Space Z`; `T` auto-attack toggle (Ember Lance in its slot) unchanged. The `LOADOUT_SLOTS` constant moves 6 → 8; saved loadouts pad with `null` (existing assignments keep positions).

---

## 11. Test notes

- Data tests: every skill has an id, element, unlock level, 3 to 7 augments, costs/tiers consistent, exclusion symmetry, all augment primitives known to the executor; `spec-sync` between this table and the data module.
- Rules tests: `resolveSkill` for every skill at ranks 1/5/10 with and without each augment (numbers match the tooltip); focus sustain; `skillPointsTotal`, migration function (property test: new unspent ≥ old unspent).
- Sim tests: each primitive has an isolated test (lodge detonates on death, split spawns children, pull, barrier absorbs, exposure order, conversion shares, echo never recurses); determinism and digest tests extended; party tests (augments per player).
- Balance: the per-skill power budget of section 2 checked by a table test (`Focus/s`, `DPS index`), then the archetype harness (`build-plan.md` section 5).
