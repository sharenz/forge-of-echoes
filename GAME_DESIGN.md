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

A map is a sequence of increasingly dense waves. Between waves, the player makes reward and difficulty choices. Staying longer improves rewards but puts the run at risk.

### 5. Combat scales from deliberate to spectacular

Early combat teaches enemy behaviors and positioning. Late combat supports large packs and explosive builds without becoming visually unreadable.

## Core loop

1. Choose or craft a map item, then consume it to open its arena.
2. Enter the arena and defeat a wave.
3. Pick one of several **wave bargains**: add danger in exchange for targeted rewards.
4. Every few waves, use a temporary forge, change equipment, or extract safely.
5. Defeat the map boss or continue into optional overrun waves.
6. Return to town, salvage loot, craft item projects, allocate progression, and prepare the next map.

This creates two nested rhythms:

- **Short rhythm:** fight → choose a bargain → fight.
- **Long rhythm:** acquire a base → develop it through several runs → complete a build-defining item.

## Character model

### Level and attributes

Characters progress from **level 1 to the hard cap of level 99**.

Each level-up grants:

- one passive point, for 98 points earned from levels;
- attribute points at milestone levels;
- access to higher item tiers and skill ranks;
- occasional specialization points.

The leveling curve has five intended phases:

- **Levels 1–20 — Foundation:** fast levels, frequent skill unlocks, and introduction to basic crafting.
- **Levels 21–50 — Formation:** the main build takes shape and the character chooses a specialization.
- **Levels 51–75 — Completion:** the campaign ends, maps begin, and all essential build mechanics become available.
- **Levels 76–90 — Mastery:** high-tier maps, advanced crafting, and meaningful build refinement.
- **Levels 91–99 — Prestige:** deliberately slow aspirational progression for dedicated characters.

A functional endgame build should be complete around level 75–80. Levels 91–99 provide passive points and prestige, but must not contain exclusive skills, crafting systems, or required item bases. Reaching level 99 should be impressive rather than mandatory.

Equipment level requirements should generally stop around level 80. Better endgame items come from higher item levels, affix tiers, and crafting—not from requiring the character to reach 99.

Characters can never lose a completed level. If a high-level death penalty is used, it removes only some progress toward the next level and begins no earlier than level 70.

Core attributes:

- **Might:** physical power, armor requirements, a small amount of life.
- **Finesse:** attack speed, accuracy, evasion requirements.
- **Insight:** spell power, resource capacity, ward requirements.

Attributes should mostly unlock equipment and support build identity. They should not be universally optimal damage multipliers.

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

Keep the number of slots familiar. Depth should come from affixes and interactions, not inventory bureaucracy.

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

### Loot philosophy

Do not solve loot spam with an increasingly complicated filter. Prevent the spam.

- Common monsters mostly drop materials and currency shards.
- Elite monsters have a good chance to drop a relevant base.
- Wave bosses can drop magic items, rare items, uniques, and special crafting components.
- Reward bargains let the player target base types, affix tags, unique families, or crafting materials.
- Item drops are identified immediately; discovery comes from evaluation, not an identify-scroll tax.

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
| **Commanded** | Each wave contains an additional elite | Increased Catalyst and rare-item chance |
| **Restless** | Waves begin sooner and overlap if cleared slowly | Increased quantity and overrun rewards |
| **Volcanic** | Periodic eruptions deny parts of the arena | More fire Essences and fire-tagged bases |
| **Vampiric** | Enemies recover life near wounded allies | Increased life-tagged crafting materials |
| **Twin Crowned** | The final wave contains two linked bosses | Boss rewards are duplicated |
| **Unstable Forge** | Between-wave crafting can add a scar | Items found here have increased starting Stability |
| **Exhausting** | Focus recovery is reduced | Increased skill and resource-related rewards |

Affixes belong to exclusive groups so contradictory or redundant combinations cannot roll together. Higher affix tiers increase both danger and reward.

Some modifiers can be build-bricking, but they must be uncommon, clearly marked, and worth a substantial reward. The UI should warn when a map modifier directly conflicts with the current character—for example, a character dependent on Focus regeneration opening an Exhausting map.

### Map quality

Map quality represents how thoroughly its location has been charted. Quality increases the map's base reward yield and slightly improves the chance of finding additional map items.

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
- Reward bargains can target map drops or particular map families.
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
3. **Decision:** collect rewards, choose a bargain, and optionally extract at a checkpoint.

Avoid long cleanup periods. Stragglers should become visible and aggressively approach the player.

### Wave bargains

After most waves, choose one of three bargains. Each combines a danger with a reward direction.

Examples:

- Enemies gain 25% movement speed; the next lieutenant drops weapon bases.
- Two additional elite packs spawn; fire Essences are tripled.
- Healing is reduced until the boss; the map boss drops an extra unique fragment.
- Monsters leave burning ground; all item bases gain bonus starting Stability.

Bargains stack through the run, producing an emergent map identity. Choices should display their cumulative effect alongside the persistent modifiers crafted onto the map item.

The two systems serve different purposes:

- **Map crafting** is advance planning: the player chooses the baseline risk and reward direction before entering.
- **Wave bargains** are adaptation: the player reacts to the build's performance and decides how much further to push.

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
- Act 3: specializations, map bargains, Stability.
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
- Pause solo play between waves, but never during combat.

## First playable vertical slice

The first slice should prove combat, waves, loot, and crafting together.

### Content

- one arena with environmental variation;
- one character archetype;
- three active skills, one mobility skill, and one persistent technique;
- 20–30 passive nodes with two keystones;
- four enemy types, two elite modifiers, one lieutenant, one boss;
- six waves plus optional overrun;
- four equipment slots: weapon, chest, ring, boots;
- 10 item bases;
- normal, magic, and rare items;
- 20–25 affixes;
- Scrap, Essence, Seal, and Solvent crafting materials;
- normal, magic, and rare map items with 10–12 map affixes;
- Map Dust, Threat Glyph, and Reward Ink crafting materials;
- Stability, one scar type, and the five crafting action families in simplified form.

### Questions the slice must answer

- Is killing a dense wave satisfying before deep progression exists?
- Does choosing the next bargain create anticipation?
- Can players understand why one item is better than another?
- Does crafting produce a story rather than a sequence of random rerolls?
- Are players excited to find a normal base?
- Does a six-wave run create a satisfying risk curve?

Do not build the full passive tree, campaign, trade system, or dozens of uniques before these answers are positive.

## Example build and unique

### Build: Splinterburn

The player fires Ember Lance through packs, leaving burning splinters in pierced enemies. Rift Step detonates splinters along the movement path. The build wants projectile count, piercing, burning duration, and a way to recover Focus while moving.

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
