# Crafty — Game Design Foundation

## High concept

**Crafty is a browser-based action RPG where players fight escalating monster waves, extract valuable item bases and materials, and deliberately craft the gear that defines their build.**

The depth should approach classic loot-heavy ARPGs, but the game should be readable in short sessions and should not require players to sift through hundreds of meaningless drops.

The game's distinctive promise:

> Every run is both a combat challenge and a crafting project.

## Design pillars

### 1. Crafting is the main progression system

Crafting is not an endgame lottery added after item drops. Players start crafting early, learn it gradually, and continually make meaningful decisions about which item projects deserve investment.

### 2. Rare items are actually rare

Normal and magic items remain useful because they can be excellent crafting bases. A rare item dropping should be an event. A great rare item should be memorable.

The game drops fewer equippable items than most ARPGs. Most monsters instead drop stackable crafting materials, map resources, and occasional promising bases.

### 3. Build depth creates understandable consequences

Characters can become highly specialized, but players should understand why a build works. Damage sources, defenses, triggered effects, and conversions need clear tooltips and a useful character sheet.

### 4. Waves create mounting pressure

A map is a sequence of increasingly dense, geographically distributed waves. Risk and reward are determined before entry by the crafted map item; there are no temporary power choices between waves.

### 5. Combat scales from deliberate to spectacular

Early combat teaches enemy behaviors and positioning. Late combat supports large packs and explosive builds without becoming visually unreadable.

## Core loop

1. Choose or craft a map item, then consume it to open its arena.
2. Enter the map, explore its regions, and defeat distributed monster packs.
3. Run over physical drops to collect equipment and crafting materials.
4. Defeat escalating waves without temporary powers; pause with the inventory to adjust persistent equipment.
5. Defeat the map boss or continue into optional overrun waves.
6. Return to the hideout, evaluate loot, craft item projects, allocate persistent progression, and prepare the next map.

This creates two nested rhythms:

- **Short rhythm:** find a pack → fight → collect physical drops → hunt the next pack.
- **Long rhythm:** acquire a base → develop it through several runs → complete a build-defining item.

## Character model

### Level and attributes

Characters progress from **level 1 to the hard cap of level 99**.

Each level-up grants:

- five attribute points allocated directly among Strength, Dexterity, and Intelligence;
- one active-skill point allocated to an unlocked skill;
- access to higher item tiers and later progression systems.

The leveling curve has five intended phases:

- **Levels 1–20 — Foundation:** fast levels, frequent skill unlocks, and introduction to basic crafting.
- **Levels 21–50 — Formation:** the main build takes shape and the character chooses a specialization.
- **Levels 51–75 — Completion:** the campaign ends, maps begin, and all essential build mechanics become available.
- **Levels 76–90 — Mastery:** high-tier maps, advanced crafting, and meaningful build refinement.
- **Levels 91–99 — Prestige:** deliberately slow aspirational progression for dedicated characters.

A functional endgame build should be complete around level 75–80. Levels 91–99 provide flexible attribute and skill points plus prestige, but must not contain exclusive skills, crafting systems, or required item bases. Reaching level 99 should be impressive rather than mandatory.

Experience is awarded when each monster dies, not deferred until map completion. Every monster archetype owns a base reward and wave/tier growth values; magic and rare monster multipliers are shared encounter config. This keeps reward tuning attached to the enemies that produce it and makes the experience bar react to every kill.

Equipment level requirements should generally stop around level 80. Better endgame items come from higher item levels, affix tiers, and crafting—not from requiring the character to reach 99.

Characters can never lose a completed level. If a high-level death penalty is used, it removes only some progress toward the next level and begins no earlier than level 70.

Core attributes:

- **Strength:** physical power, armor requirements, and maximum life.
- **Dexterity:** attack speed, accuracy, evasion, and movement.
- **Intelligence:** spell power, Focus capacity, and ward requirements.

Attributes should mostly unlock equipment and support build identity. They should not be universally optimal damage multipliers.

### Damage rolls and types

The character sheet's attack damage is the expected average, not a fixed hit. Every damaging skill config declares a damage type, damage effectiveness, and a symmetric range around that average. A hit rolls once when its projectile or attack is created, then applies defenses to that rolled value. Because the range midpoint is always 1, additive, increased, and more modifiers preserve their exact meaning across both the minimum and maximum hit.

Floating combat text always includes the final damage type, such as `37 (Fire)`. Physical, fire, cold, lightning, and chaos are engine-level damage types so later resistance, conversion, penetration, and ailment systems can consume the same typed damage packet instead of inferring behavior from skill names.

### Combat presentation

Every skill config owns presentation identifiers for character animation, compact VFX, and audio. The runtime resolves those identifiers through reusable animation, particle-pool, and audio systems; combat code never hardcodes a unique asset pipeline for one skill. Player movement switches between directional idle and run clips, while attacks, casts, and dashes lock an authored action clip so locomotion cannot overwrite important frames. Each action config declares a release frame. Damage, projectiles, movement, VFX, and audio occur from that frame event instead of firing when the input is first pressed. Effects should remain small and layered: readable silhouettes, a short cast accent, restrained trails, a compact impact, and a brief audio envelope instead of screen-filling flashes.

Character art uses two complementary fidelity tiers. Class selection uses detailed authored roster art to establish face, armor, weapon, material, and palette identity. The simulated world uses optimized authored pixel sprite sheets built specifically for the slightly elevated three-quarter camera, with one readable silhouette per class and a transparent logical movement anchor. South, north, and side-facing clips are authored independently; west mirrors the east-facing frames. Every frame shares one bottom-center foot anchor, and animation changes frames without changing the combat coordinate. A subtle aura, footstep dust, weapon sweep, projectile trail, impact spark, and skill core combine into the final look; no single layer should carry the entire visual effect or obscure enemies and drops.

Every equipment base, map base, and crafting currency also declares its inventory icon in content config. Backpack, stash, equipment, tooltip, and drag rendering resolve the same asset through one shared item-visual helper; UI components must not infer graphics from names or maintain their own icon lookup tables.

### Defenses

Use a small set of layered defenses:

- life;
- armor against repeated physical hits;
- evasion against attacks;
- ward as a rechargeable buffer;
- fire, cold, lightning, and void resistance;
- block and dodge as specialized investments.

Every character should need at least two defensive layers. Enemy damage must be designed so that a single capped resistance is not the entire defensive puzzle.

### Resource system

All characters use **Focus**, but skills interact with it differently. Weapons or archetypes can change its behavior:

- generate Focus through basic attacks;
- regenerate it over time;
- build it through movement or critical hits;
- reserve part of it for persistent effects.

This keeps the interface consistent while allowing distinct resource engines.

## Skills and builds

### Skill loadout

A character equips:

- one basic or generator skill;
- three active skills;
- one mobility skill;
- one ultimate or high-cooldown skill;
- up to three persistent techniques.

This is enough expression for buildcraft without requiring a browser player to manage twelve combat keys.

### Skill modification

Active skills have 20 ranks. Rank effects are data-driven and resolved once for both combat and UI so displayed values cannot drift from runtime behavior. For the MVP, Ember Nova gains damage effectiveness and one projectile every rank plus one pierce at ranks 5, 10, 15, and 20. Rift Step recovers a charge faster every rank and gains a maximum charge at those same five-rank milestones.

Each active skill has a small branching skill tree. A branch should change behavior, not merely add 5% damage.

Example: **Ember Lance**

- pierces enemies and rewards lining up packs;
- splits on impact and becomes a clearing skill;
- lodges in targets and can be detonated by another skill;
- converts fire damage into void damage and changes scaling tags.

Skills expose explicit tags such as `attack`, `spell`, `projectile`, `fire`, `area`, and `duration`. Items and passives refer to these tags consistently.

### Character passive tree

Use a medium-sized shared constellation rather than an enormous web at first.

- The center contains universal life, Focus, and attributes.
- Outer regions represent martial, agile, and occult themes.
- **Keystones** create rules-changing tradeoffs.
- **Junctions** let a player bridge distant themes at a meaningful cost.
- Small nodes establish a path; notable nodes define mechanics.

Target for the first complete version: approximately 250 nodes, 45–55 notables, and 12–15 keystones. A level 99 character earns 98 passive points, while a typical established endgame character has around 75–85 points. The tree must contain enough competing routes that level 99 still cannot acquire every desirable cluster.

### Specializations

At a midgame milestone, choose one of two or three specializations. These should define engines, not lock skill categories.

Examples:

- **Forgebound:** overheats weapons for damage, then vents heat defensively.
- **Rift Hunter:** marks priority enemies and tears open short-lived damaging rifts.
- **Gravewright:** collects remnants from slain enemies to empower constructs and curses.

## Item system

### Equipment slots

- main hand;
- off hand;
- helmet;
- chest;
- gloves;
- boots;
- amulet;
- two rings;
- belt.

Keep the number of slots familiar. Depth should come from affixes and interactions, not inventory bureaucracy. Inventory items expose complete stats in hover/focus tooltips and equip by dragging them directly into a matching paper-doll slot. The persistent character sheet shows the actual derived combat values, including evade.

The equipped belt also owns four consumable flask slots bound to keys 1–4. A flask stack holds at most 5 uses in a belt slot and 20 in the backpack or stash. Flasks are physical, stackable items: they can be bought, dropped, moved between containers, and consumed one use at a time. The initial weak Health and Mana flasks recover their configured amount over time rather than instantly, matching the deliberate potion rhythm of classic ARPG combat.

### Rarities

#### Normal

A clean item base with an implicit property. Normal items matter because they are the safest and most flexible starting point for ambitious crafts.

#### Magic

One or two affixes. Magic items are inexpensive to modify and can roll slightly stronger focused affixes than rares. This gives them a legitimate role in specialized builds.

#### Rare

Three to six affixes. Rare items have the highest general potential, but naturally dropped rares are uncommon. A rare with several synergistic affixes should be exceptionally valuable.

#### Unique

Fixed, rule-changing items with some variable values. Uniques enable unusual builds but should rarely be best-in-slot for every slot. A unique should answer “what can I build around this?”

### Bases and item identity

Each base has:

- an implicit property;
- attribute requirements;
- compatible affix families;
- a material type that affects crafting behavior;
- an item level controlling affix tiers.

Example weapon bases:

- **Ashwood Wand:** increased fire ailment duration; fire affixes are easier to add.
- **Glassbone Wand:** extra projectile potential; fractures more easily during forceful crafts.
- **Ironroot Wand:** defensive implicit; physical and ward affixes are easier to preserve.

The base therefore influences both the finished item and the process used to make it.

### Affix structure

Affixes have clear tags such as `life`, `fire`, `critical`, `speed`, `minion`, or `defense`. Crafting actions operate on tags so players can reason about their odds.

Design rules:

- Each affix must have a purpose for at least one real build.
- Avoid affixes whose only function is to make every item worse.
- Powerful affixes may carry opportunity costs or belong to exclusive groups.
- Top tiers should be rare, but lower tiers must remain useful while leveling.
- The crafting UI must always show possible outcomes and exact odds when knowable.

### Numerical engine contract

All character, item, passive, skill, buff, and monster effects use the same typed modifier model. No feature may introduce its own hidden percentage arithmetic.

For any stat, resolution is always:

`(base + sum(flat)) × (1 + sum(increased) / 100) × product(1 + each more / 100)`

- `flat` modifiers add a raw number before scaling.
- all `increased` modifiers are additive with one another and form one multiplier.
- every `more` modifier is a separate multiplier; it is reserved for scarcer, build-defining effects.
- attributes resolve first; configured per-level and per-attribute rules then materialize as ordinary sourced modifiers for derived stats.
- attack speed starts from the equipped weapon base's attacks per second (or the configured unarmed base), then uses the same increased and more multipliers as every other stat.
- item base stats scale from the item's immutable base definition and item level.
- every affix tier defines its required item level, selection weight, numeric range, stat, and modifier mode.
- item level only unlocks the affix tiers that may roll; it does not guarantee the highest available tier.
- rerolling numeric values keeps the affix definition and tier fixed and rolls only inside that tier's original range.
- modifier records retain a stable source identifier and a player-facing label so the character sheet can explain every result now.
- map affixes, map-tier scaling, wave growth, and monster bases use typed arena modifiers and the same resolver; the renderer receives only fully resolved wave values.
- map effect and reward descriptions are generated from their executable modifier and reward records rather than maintained as parallel handwritten claims.

Game content is data, not simulation logic. Definitions are separated by domain under `app/game/config`: classes, stat contribution rules, item bases, affixes, monsters, skills, flasks, merchants, maps, and progression. Runtime entities reference stable definition IDs and store only their rolled state. Calculation, generation, crafting, persistence, and rendering consume those definitions through dedicated engine modules.

### Loot philosophy

Do not solve loot spam with an increasingly complicated filter. Prevent the spam.

- Common monsters mostly drop materials and currency shards.
- Equipment is rolled when it appears in the world, not when collected. Its ground label names the equipment type (such as Gloves or Belt), while rarity is communicated consistently by color: white normal, blue magic, yellow rare.
- Elite monsters have a good chance to drop a relevant base.
- Wave bosses can drop magic items, rare items, uniques, and special crafting components.
- Crafted map modifiers let the player target base types, affix tags, unique families, or crafting materials before entry.
- Drops remain physical world objects until the character runs over them; collected equipment appears immediately at the front of the in-map backpack, while collected crafting materials appear in its pickup ledger.
- Item drops are identified immediately; discovery comes from evaluation, not an identify-scroll tax.
- Maps and every crafting currency are physical inventory items rather than abstract counters.
- Currency items automatically combine into stacks. Each currency definition owns its maximum stack size; the MVP default is 40.

## Crafting system: the Workbench

### The item-project model

The player should often remember an item’s history: “I found this sword base in a burning map, isolated the attack-speed affix, then risked a fracture to add the final modifier.”

Crafting actions fall into five understandable families:

1. **Shape** — add or reroll an affix.
2. **Refine** — improve the tier or value of an existing affix.
3. **Remove** — remove an affix, usually with conditions.
4. **Preserve** — protect an affix or tag from the next operation.
5. **Transform** — perform a powerful structural change with a lasting risk.

### Core materials

Keep the initial material vocabulary compact:

- **Scrap:** common; rerolls numeric values or performs basic crafts.
- **Essence:** tag-specific; influences which affix family is added.
- **Seal:** protects one affix for the next operation.
- **Solvent:** removes an affix using a visible targeting rule.
- **Catalyst:** upgrades an affix tier or unlocks a special operation.
- **Fracture Core:** makes one affix permanent but can scar the item.

Materials should have verbs in their names/tooltips, not merely rarity colors.

### Stability and scars

Every item has **Stability**, a crafting durability resource.

- Simple crafts cost little or no Stability.
- Deterministic, high-power crafts cost more.
- At low Stability, advanced crafts can add a **scar**.
- Scars are permanent properties that can be drawbacks, altered requirements, or unusual tradeoffs.
- An item at zero Stability is not destroyed; it is simply finished and can no longer undergo structural crafts.

This limits perfect-item crafting without deleting a beloved item. It also lets every attempt make progress while preserving tension.

### Controlled uncertainty

Crafting should alternate between deterministic setup and risky payoff.

Example project:

1. Find a high-level Ashwood Wand base.
2. Use a fire Essence to guarantee a fire-tagged affix from a visible pool.
3. Refine the resulting burning-damage affix from tier 4 to tier 3.
4. Add a random affix, then use a Solvent that targets the lowest-tier affix.
5. Seal burning damage and reroll the remaining affixes.
6. Use a Fracture Core to permanently lock cast speed, accepting a chance of a scar.
7. Spend the remaining Stability attempting a final top-tier fire affix.

The best outcomes remain rare because they require a strong base, appropriate materials, good intermediate results, and careful Stability management—not because every click is an opaque slot machine.

### Crafting knowledge

New recipes and targeting rules are discovered through play. Once discovered, they remain visible in a codex. Discovery can come from:

- defeating themed bosses;
- salvaging an item with a new affix;
- completing a crafting challenge;
- bringing a special forge component home from a map.

Knowledge unlocks options, not raw power, so veteran players gain breadth without making the early game irrelevant.

## Wave maps

### Maps are items

Every endgame map exists as a physical, craftable item in the player's inventory. A map item is consumed when its arena is opened.

The hideout map device has exactly one map slot. A player moves one map from the backpack into that slot, crafts the slotted item if desired, then presses **Open Map**. Opening consumes only that slotted map and creates the portal. Closing the device or removing the map returns it unchanged to the backpack.

A hideout map merchant guarantees access to the endgame loop. The basic tier-1 map is always free, preventing a player from becoming map-locked. Higher-tier merchant maps cost Scrap from the player's real currency stacks; offers, tiers, bases, and prices are data-driven merchant config.

The map item defines:

- arena and environmental theme;
- map tier and monster level;
- native monster families;
- boss or boss pool;
- base number of waves;
- an implicit map property;
- explicit affixes added through crafting;
- quality and optional corruption state.

Maps use the same rarity language as equipment:

- **Normal map:** only its base implicit; safe and predictable, with modest rewards.
- **Magic map:** one or two modifiers; focused danger with a useful reward increase.
- **Rare map:** three to six modifiers; substantially more dangerous and rewarding.
- **Unique map:** a fixed encounter with special wave rules, bosses, or crafting rewards.

This turns preparing a run into a real item decision. A player can run a safe map, improve it with a few controlled modifiers, or invest heavily in a dangerous rare map aimed at a particular crafting goal.

### Map bases

A map base should be more than a background image. Its implicit changes the run's rules or reward tendencies.

Examples:

- **Ashen Crucible:** fire and construct enemies; fire Essences are more common.
- **Drowned Archive:** narrow lanes and rising hazards; jewelry bases gain bonus drop weight.
- **Grave Orchard:** corpses periodically awaken; minion and void affixes are easier to find.
- **Iron Coliseum:** smaller arena and aggressive spawns; armor bases drop with additional Stability.

Map tier controls monster level, affix tier access, possible bosses, and the item level of dropped bases. Higher tiers should also introduce new encounter combinations rather than only scaling health and damage.

### Crafting maps

Map crafting follows the same readable philosophy as equipment crafting, but uses a small set of dedicated cartography materials so players do not have to choose between improving their character and accessing content.

- **Map Dust:** changes rarity or rerolls map affixes.
- **Threat Glyph:** adds a modifier from a visible danger family such as density, elites, hazards, or bosses.
- **Reward Ink:** influences a reward family such as weapons, armor, Essences, catalysts, or uniques.
- **Cartographer's Seal:** preserves one desirable map modifier during the next reroll.
- **Void Needle:** corrupts a map, creating a powerful irreversible outcome.

Normal and magic maps are inexpensive to manipulate. Rare maps require more investment and become harder to control as additional affixes are added.

Unlike equipment, maps do not use Stability. They are consumable projects, so their cost, danger, and eventual consumption provide the limiting pressure.

### Map affixes

Every map affix pairs meaningful danger with reward. Avoid modifiers that are functionally free for most builds or that merely add hidden enemy damage.

Examples:

| Map modifier | Encounter effect | Reward effect |
| --- | --- | --- |
| **Teeming** | Waves contain 30% more monsters | Increased material yield and base-item drops |
| **Commanded** | Increased monster rarity produces more magic and rare packs | Increased item rarity |
| **Restless** | Monsters have increased movement speed | Increased item quantity |
| **Volcanic** | Monsters deal increased damage | Increased item quantity |
| **Vampiric** | Monsters have increased maximum Life | Increased item quantity |
| **Twin Crowned** | Monsters have substantially more maximum Life | Substantially increased item rarity |
| **Unstable Forge** | Between-wave crafting can add a scar | Items found here have increased starting Stability |
| **Exhausting** | Focus recovery is reduced | Increased skill and resource-related rewards |

Affixes belong to exclusive groups so contradictory or redundant combinations cannot roll together. Higher affix tiers increase both danger and reward.

Some modifiers can be build-bricking, but they must be uncommon, clearly marked, and worth a substantial reward. The UI should warn when a map modifier directly conflicts with the current character—for example, a character dependent on Focus regeneration opening an Exhausting map.

### Map quality

Map quality represents how thoroughly its location has been charted. Quality increases the map's base reward yield and slightly improves the chance of finding additional map items.

### The four map axes

Every map exposes four independent, resolved numbers:

- **Item quantity** changes how often equipment and material drops are created. It never changes an item's rarity by itself.
- **Item rarity** changes the normal/magic/rare weighting after an equipment drop has already been selected. It never creates an additional drop.
- **Monster amount** changes the number of monsters assigned to waves and packs.
- **Monster rarity** changes the probability that a pack is normal, magic, or rare.

All four start from configured bases and accept flat, increased, and more modifiers from map affixes, map tier, map quality, waves, pack rarity, and future league mechanics. The map device shows the map-level contribution; wave-specific increases are applied after entry and are retained in the arena breakdown.

Quality should be cheap to add to normal maps and progressively more expensive on magic or rare maps. This gives players a reason to prepare a promising map base before adding rarity and affixes.

### Corrupted maps

A Void Needle applies one irreversible result:

- add a powerful corrupted modifier;
- replace one affix with a higher-tier affix;
- increase or reduce the map by one tier;
- reveal a hidden boss wave;
- convert the map into an unidentified rare map with a large reward bonus;
- transform it into a related unique map.

Corruption should create exciting stories, not routinely erase the item. A corrupted map cannot be crafted further.

### Map acquisition and progression

- Lieutenants and bosses are the main source of new map items.
- A completed map tends to drop maps of its tier, with a chance for the next tier.
- Completing new map bases and bosses unlocks permanent Forge Route progress.
- Crafted map modifiers can target map drops or particular map families.
- Failed or abandoned maps are consumed, maintaining pressure on the map economy.

Players should maintain a small collection of maps worth evaluating and crafting, not hundreds of indistinguishable copies. A dedicated map case can organize them by base, tier, rarity, and crafting potential.

### Map structure

A standard map contains:

- 9 normal waves;
- a lieutenant on waves 3 and 6;
- a boss on wave 9;
- optional overrun waves after the boss.

A normal run should take roughly 10–15 minutes. Early campaign arenas can use five or six waves.

### Wave phases

Each wave has three phases:

1. **Tell:** a brief preview shows enemy families and dangerous modifiers.
2. **Fight:** enemies arrive through spawn points, portals, burrows, or environmental events.
3. **Collection:** recover physical drops, then continue toward the next distributed pack.

Avoid long cleanup periods. Stragglers should become visible and aggressively approach the player.

### No temporary run power

Maps never grant temporary combat upgrades or bargain powers. Character power comes only from level, allocated skills, and persistent inventory. Players may pause a map to equip collected or carried items, while the crafted map item defines the run's danger and reward profile before the portal opens.

### Escalation

Later waves should not only add health and damage. They add pressure through composition:

- shielding enemies protect artillery units;
- burrowers disrupt safe positions;
- summoners create escalating pack density;
- hunters punish continuous movement;
- siege monsters reshape portions of the arena;
- elites combine a small number of readable modifiers.

Large late-game packs are part of the fantasy, but dangerous units need strong silhouettes, sounds, and ground indicators.

### Extraction and failure

Checkpoints appear after waves 3, 6, and 9.

- Extracting banks all loot and map progress.
- Dying loses unbanked bonus rewards, but never equipped items or character experience.
- Special hardcore map modifiers can increase the loss, but only when explicitly chosen.

This creates tension without making experimentation feel punishing.

### Overrun

After defeating the boss, the player can extract or enter overrun.

- Waves become endless or continue to a clear cap.
- Density and combined modifiers increase rapidly.
- Rewards become more specialized rather than only numerically larger.
- Every few waves offers another extraction point.
- Leaderboards can measure highest overrun, but core progression should not require leaderboard play.

## Monster and encounter design

### Enemy roles

Build enemy families from readable combat roles:

- **swarmers:** numerous, fragile, create the hack-and-slash fantasy;
- **bruisers:** slow threats that control space;
- **artillery:** force movement;
- **supports:** shield, heal, or empower others;
- **hunters:** pursue and interrupt passive kiting;
- **summoners:** increase density if ignored;
- **disruptors:** interfere with Focus, cooldowns, or defenses.

Each family should combine three or four roles with a recognizable theme. Encounter difficulty comes from compositions, not random on-death effects everywhere.

### Elites

Packs roll their rarity once. A magic pack promotes every member and gives all members the same rolled magic modifier. A rare pack promotes exactly one leader, gives that leader multiple stronger rare modifiers, and leaves its companions normal. Higher map tiers, later waves, and explicit monster-rarity map modifiers increase both magic- and rare-pack probability.

Pack composition is rolled independently from pack rarity. Each pack selects one to three weighted monster archetypes from those eligible for its tier and wave, so mixed packs are common without requiring every role to appear every time. Archetype stats—Life, speed, damage, armor, and evade—are configured per monster and pass through the canonical resolver together with map, wave, and pack modifiers.

Elite modifiers must be visible and mechanically legible. Prefer modifiers that change behavior:

- periodically links nearby enemies into a shared ward;
- splits into smaller monsters once;
- creates a rotating safe zone;
- gains power while near corpses;
- hunts the player after nearby allies die.

Avoid invisible damage multipliers and excessive death explosions.

## Progression structure

### Campaign

A short campaign introduces systems one at a time:

- Act 1: combat, normal/magic items, basic shaping.
- Act 2: resistances, rare items, preserving and removing affixes.
- Act 3: specializations, advanced map crafting, Stability.
- Act 4: bosses, transformation crafts, endgame map forge.

The campaign should be replayable but brisk. Its purpose is onboarding and worldbuilding, not delaying the main system.

### Endgame atlas: the Forge Routes

Instead of a giant geographical atlas, players progress through branching forge routes. A route specializes the next sequence of maps:

- **Ember Route:** fire enemies, fire affixes, weapon bases.
- **Grave Route:** minions, void materials, jewelry.
- **Iron Route:** armored enemies, defense affixes, armor bases.
- **Storm Route:** speed, projectiles, critical materials.

Completing routes unlocks permanent choices in a small endgame tree. Players can target the kind of crafting project they are currently pursuing.

## Economy and trading

The safest initial design is **no unrestricted player trading**. A crafting-first game is easy to undermine if buying finished items is far more efficient than making them.

Possible later compromise:

- trade normal bases and common materials freely;
- bind an item after advanced crafting;
- allow limited asynchronous exchange through contracts;
- keep the best boss components account-bound.

This is a product decision with major balance consequences and should be settled before building a full economy.

## Browser-specific design constraints

- Support mouse movement and WASD from the start; do not make either an afterthought.
- Keep the main combat inputs to six active buttons plus healing.
- Design for 60 FPS with pooled enemies, simplified collision, and strict effect budgets.
- Simulate many enemies cheaply; reserve complex decision-making for elites.
- Make the simulation authoritative enough that refreshing cannot duplicate rewards.
- Persist at wave boundaries and after crafting actions.
- Tooltips must work without requiring hover, so touch and trackpad users can inspect everything.
- Keep transitions between waves brief and continuous; inventory equipment changes pause the map, while crafting and skill allocation remain hideout activities.

## First playable vertical slice

The first slice should prove combat, waves, loot, and crafting together.

### Content

- one arena with environmental variation;
- one character archetype;
- three active skills, one mobility skill, and one persistent technique;
- 20–30 passive nodes with two keystones;
- four enemy types, two elite modifiers, one lieutenant, one boss;
- six waves plus optional overrun;
- ten equipment positions: helmet, main hand, off hand, amulet, two rings, chest, gloves, boots, and belt;
- 11 item bases;
- normal, magic, and rare items;
- 20–25 affixes;
- Scrap, Essence, Seal, and Solvent crafting materials;
- normal, magic, and rare map items with 10–12 map affixes;
- Map Dust, Threat Glyph, and Reward Ink crafting materials;
- Stability, one scar type, and the five crafting action families in simplified form.

### Questions the slice must answer

- Is killing a dense wave satisfying before deep progression exists?
- Does hunting the next distributed pack create anticipation?
- Can players understand why one item is better than another?
- Does crafting produce a story rather than a sequence of random rerolls?
- Are players excited to find a normal base?
- Does a six-wave run create a satisfying risk curve?

Do not build the full passive tree, campaign, trade system, or dozens of uniques before these answers are positive.

## Example build and unique

### Build: Splinterburn

The player fires Ember Lance through packs, leaving burning splinters in pierced enemies. Rift Step holds three charges that recover one at a time and detonates splinters along the movement path. The combat bar always communicates charges, the next recharge, cooldowns, and Focus costs. The build wants projectile count, piercing, burning duration, and a way to recover Focus while moving.

Meaningful tension:

- more projectiles improve coverage but reduce damage per projectile;
- piercing improves setup but delays detonation;
- longer burns scale damage but slow the build's burst cycle;
- defensive investment competes with pathing toward projectile and fire regions.

### Unique: The Patient Spark

**Ashwood Wand**

- Ember Lance no longer deals hit damage.
- Embedded splinters gain damage each second they remain in an enemy.
- Detonating five or more splinters restores Focus and grants ward.
- Variable downside: reduced detonation area.

This unique changes timing, crafting priorities, and skill usage rather than merely providing large stats.

## Guardrails

- Never make loot volume a substitute for item quality.
- Never hide crafting odds that the game can calculate.
- Never require an external wiki to understand an affix interaction.
- Never balance all difficulty around one-shot deaths.
- Never let visual effects obscure priority enemies or lethal attacks.
- Never make a universally mandatory unique or passive node.
- Never ship a crafting material that lacks a distinct decision.
- Never add permanent progression that trivializes the item hunt.

## Decisions to make next

The next design pass should settle these in order:

1. **Combat control:** click-to-move, WASD, or full support for both.
2. **Camera and art direction:** 2D, 2.5D, or lightweight 3D is a major technical constraint.
3. **Persistence:** run-based roguelite characters versus permanent ARPG characters.
4. **Death model:** soft loss, limited lives per map, or hardcore opt-in.
5. **Trade:** solo-first, restricted trade, or open economy.
6. **Crafting randomness:** exact acceptable balance between guarantees and risk.
7. **Multiplayer:** solo-only initially or architecture ready for co-op.
