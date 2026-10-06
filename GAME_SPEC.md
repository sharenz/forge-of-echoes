# Forge of Echoes v2 — Game Spec (vertical slice, Sorceress only)

Concrete, buildable spec for the from-scratch rewrite. `CONCEPTS.md` holds the why; this holds the what.
Numbers are **starting targets** — tune them with the headless balance bot, but keep the shape.

## 0. Locked decisions (formerly "open")

| Question | Decision |
|---|---|
| Waves per map | **6.** No wave-3 lieutenant; one final boss on wave 6 from the map type’s roster (§14). The former lieutenants now lead Cinder Chapel, Choral Crypt and Chainworks. Killing the boss clears the map; the remaining monsters crumble to ash and every player debuff is lifted. |
| Flask belt | **4 slots**, keys `1`–`4`. |
| Fifth damage type | **void** (purple). |
| Damage types | **Mechanical.** Monster and player resistances exist (capped at 75%). Ailments: fire → **ignite** (burning DoT), cold → **chill** (30% slow), lightning → **shock** (+20% damage taken). |
| Characters | **Permanent, server-side.** On death you drop to the ground and can **respawn to your own hideout**. You keep XP and every picked-up item. Re-entering the map costs a portal. There is no XP penalty. |
| Crafting location | Hideout only (the inventory still opens in maps). |
| Pause | None. The game is online: the `Esc` menu blocks local input, but the world keeps running. |
| Rendering | **WebGL2**, own renderer. Low-resolution pixel-art world (about 360 px tall virtual resolution, integer upscale), dynamic coloured lights, emissive + bloom, vignette and grading. All art is **procedurally generated pixel art** (no image files). |
| Audio | **Procedural WebAudio** (synthesised SFX and music), no audio files. |
| UI | DOM + Preact over the canvas, with the 14/16/19/28 type scale enforced. Fonts: Cinzel (titles) and Alegreya Sans (text). |
| Online | **Online-only, server-authoritative** (see §11). No offline or single-player mode: solo play is a party of one on the server. |
| Trading | Direct, atomic player-to-player trades (§12). No market yet (§15 is planned). |
| Persistence | Server-side SQLite (`node:sqlite`). Accounts with username and password. `localStorage` holds only the session token and client settings. |
| Pickup | **Equipment is picked up by clicking** its label or sprite; the character walks there first if it's out of reach. Currency, flasks and maps are auto-collected by walking over them. XP is awarded immediately on monster death; there are no XP orbs to collect. |
| Aiming | Mouse aim. Six freely assignable skill slots: `LMB`, `RMB`, `Q`, `E`, `R`, `F`. `T` toggles auto-attack (Ember Lance targets the nearest enemy near the cursor from its assigned slot). |
| Affixes | Prefix/suffix split. Magic items have ≤1 prefix and ≤1 suffix; rare items have ≤3 of each. |
| Attributes | +3 allocatable points per level, plus small automatic class growth. |

## 1. Controls

| Input | Action |
|---|---|
| `WASD` / arrows | Move |
| Mouse | Aim |
| `LMB` `RMB` `Q` `E` `R` `F` `Space` `Z` | Eight loadout slots, any learned skill in any slot (held = cast as soon as usable) |
| `1`–`4` | Flasks |
| `I` / `C` / `K` / `P` / `M` | Inventory / character / skills / party / Atlas (own hideout); buttons beside the command deck show the keys |
| `H` / `F1` / `?` | Help (controls, how a run works, glossary, tutorial reset or skip) |
| `Esc` | Close the top panel, or open the menu (pauses in maps) |
| `Alt` (hold) | Affix tiers, roll ranges and comparison with equipped items |
| `Ctrl`/`⌘`+click | Quick-move (a Crafting Stash slot gives a stack; with a Crafting Stash tab open, gear or a map from the backpack or your body loads the work slot, and the work slot's item returns to the backpack) |
| `Shift`+`Ctrl`/`⌘`+click | Take exactly 1 from a Crafting Stash slot; gear or a map in the stash goes onto the Crafting Bench |
| `RMB` on currency | Arm the currency, then `LMB` an item to apply it (`Esc`/`RMB` cancels) |
| `T` | Toggle auto-attack |
| Click a hideout object | Map device / stash / merchant (walk-up not required) |

## 2. Core loop

1. **Title:** create or select a Sorceress. You start in the hideout with the starting kit.
2. **Hideout:** a small, lit, walkable ritual courtyard with these objects:
   - **Map Device (the physical object in the hideout; its panel holds the Atlas):** an Atlas chart (canvas ground, roads and plates, one button per area) that sits beside the inventory, which opens together with the table (at 1280x720 and 1024x600 the chart takes the left part of the screen), and a Codex tab. The chart window is only for choosing: it keeps the tabs, the lenses, the pin tray, the tier ruler, the key chips, the zoom controls and a slim status line (the open expedition with its portals left and "Enter the portal", the surge countdown and "Refill all"); it has **no map slot, scarab sockets, price or Activate button**. **Clicking an area opens that area's modal** (the inspector's content merged in: hero band with the boss and the monster family, the facts, what it pays, what can happen there, entry, your maps of the area and its pin toggle). In the centre of the modal sit the **map slot** (large) with the **four scarab sockets** around it, a **passage slot** only for sealed areas (their key) and the Pit of Echoes (lit when a Bounty map is loaded), the map's own readout (name, tier, quality, mods) with **Re-chart** and **Take out**, the surge pips with the Hold toggle and countdown, and a live readout (item quantity and rarity, monsters, danger mods, encounter odds, scarab effects, "Next drops", a "Full readout" for the rest). The footer holds the price and **Open area**, with the reason it is disabled always written out (no map, wrong area, tier above the ceiling, key missing, not enough Scrap...). Items are dragged in **from the inventory** (Ctrl/Cmd-click quick-loads; a Ctrl-click with no modal open opens the map's own area and loads it); the items that fit this area carry a quiet highlight in the inventory. A map is bound to one area: the slot of another area refuses it ("This map opens Furnace Yard") with a one-click "Go to Furnace Yard" that switches the modal and keeps the map in the slot. An area with no map shows "No map for this area" with where to find one (the charted areas whose expeditions drop it, Rook, the Crafting Bench). "Repeat last setup" refills the sockets (and the key) of the last run in this area with what is still in the inventory. Esc closes the modal first and the window second, Enter (or E) opens the area when it is ready, Tab stays inside the dialog. A successful Open area closes the modal; the Atlas stays open, the node flares and the status line offers the portal. A map is bound to one area, so there is no course to set. The chart has two **lenses** (Stock: a count badge per area of the maps you hold, tinted by tier band; Sources: the loaded map's drop table as arrows with shares; Territory: a ring per beacon at its chart radius, a glyph per sigil slot, and the areas the inspected beacon covers lit, with a caption per area of the sigils reaching it). A cleared area's modal also holds its **beacon** (see §7 Beacons and sigils) and a **pin tray** (see §7 Pins).
   - **Stash:** tabs; opens alongside the inventory.
   - **Rook the merchant:** a luck-driven wares board (4 maps and 8 items, new every 6 hours and at every level-up), a staples shelf, gambling and selling.
   - **Crafting Bench:** an anvil workbench with a coal forge (§12).
   - **Training dummy:** shows your damage numbers.
   - Braziers and banners for atmosphere.
3. **Enter the portal → map run:**
   - A 3 s "Tell" preview announces each wave's families, then the wave spawns.
   - Waves last 60 s or until cleared. They can stack.
   - Wave 3 is a normal combat wave; the only named boss arrives on wave 6. Killing the boss clears the map.
   - On clear: a chest spawns and a return portal opens. Kill XP has already been awarded.
4. **Return:** a run summary appears (kills, XP, items found, best drop). Then craft, equip, allocate points and repeat.

## 3. Character: Sorceress

| Stat | Formula (L = level, attributes after allocation) |
|---|---|
| Name | 3–16 characters: letters A–Z, digits, spaces, `'`, `-`, `_`; starts with a letter; unique server-wide |
| Attributes | start **str 10 / dex 14 / int 30**; automatic growth per level **+0.3 / +0.5 / +1.2**; +3 allocatable per level |
| Max life | `70 + 8·(L−1) + 1·str` (L1 ≈ 80) |
| Max focus | `40 + 2·(L−1) + 1·int` (L1 ≈ 70) |
| Focus regen | `3 /s + 2% of max focus /s` |
| Life regen | 0 base |
| Evasion rating | `20 + 3·(L−1) + 2·dex`. Evade chance = `rating / (rating + 30 × monster level)`, capped at 75%; the hideout sheet uses monster level 10 |
| Armour | 0 base. Physical hit reduction = `armor / (armor + 10·damage)` |
| Resistances | 0 base. Capped at 75%. Map mods can add a negative player-resistance penalty |
| Move speed | 110 units/s base (+% from gear) |
| Pickup radius | 90 units base (+% from gear). Auto-pickup drops inside it fly to you; XP does not use pickup radius |
| Spell power | Every skill hit starts from `base = 11 + 1.6·(L−1)` plus `addedSpellDamage`, times the skill's effectiveness (the original target of 5 at L1 left a new character unable to make progress on the hard Tier 1) |
| Int bonus | +1% increased spell damage per 5 int |
| Dex bonus | +1% increased evasion per 5 dex |
| Str bonus | +1% increased max life per 10 str |
| Crit | 150% base crit multiplier; each skill has a base crit chance |
| XP to next level | `floor(90·L^1.75)` (L1 → 90, L10 → 5.0k, L30 → 34k). Level cap 80 (the tier ceiling's monster level is 88, so a capped character meets a +25% level gap at Tier 15 instead of +100%). +3 attribute points and +2 skill points per level (`1 + 2·(L−1)` skill points in total) |
| Flasks | Recover over 3 s, never instantly. Life Flask `40 + 8·L` life, Focus Flask `30 + 4·L` focus, both × flask effect. 5 charges per belt slot; pickups refill a matching belt slot first. **Utility flasks** recover nothing: Quickstep +30% move speed and breaks Roots (4 s), Aegis +15 to all resistances (6 s, still capped by the maximum), Quicksilver Mind 15% max Focus at once and +25% Focus regeneration (5 s). **Kill charge:** each assigned belt slot gains one charge per 40 kills of the run (belt affix "of Reserves" shortens it, never below 10) |

**Starting kit:**
- **Equipment:** an equipped magic ilvl 1 Ashwood Wand with a T10 "Blazing" affix (8–12% increased fire damage: the best tier item level 1 can roll) and a normal Ashen Robe.
- **Backpack currency:** 10 Scrap, 4 Kindling, 2 Ember Essence, 1 Reforge, 1 Solvent, 1 Seal, 3 Map Dust, 2 Threat Glyph.
- **Maps:** 2× Tier 1 Ashen Forge and 1× Tier 1 Rimed Ossuary.
- **Belt:** 2 Life Flask slots (3 charges each) and 1 Focus Flask slot (3 charges).
- **Skills:** Ember Lance at rank 1 in loadout slot 0, plus **1 unspent skill point**.

## 4. Skills (rules own the numbers; the sim owns the behaviour)

Design: `docs/power-rework/skills.md` (32 skills, augments, points economy). A rank costs 1 skill point, and each level grants 2 points
(`1 + 2·(L−1)` in total). Max rank is 10. Numbers below are rank 1 → rank 10 (linear unless noted). Effectiveness multiplies spell power.
Skills **unlock by character level** (learning one costs a point and gives rank 1); there are no prerequisite chains, and a skill learned
before its unlock level stays learned. A new character starts with Ember Lance at rank 1 (innate, free) and one banked point; a skill must
be ranked to go on the bar. The roster has 32 skill ids; the seven below are playable, the other 25 are in the data with their unlock level
(Phase Stride 5, Glacial Nova 7, Spark 8, Cinder Mortar 9 ... Event Horizon 62) and cannot be learned until their behaviour ships.

**Loadout:** eight slots labelled `LMB`, `RMB`, `Q`, `E`, `R`, `F`, `Space`, `Z` (the HUD keycap shows `Spc`). Any learned skill,
including Ember Lance, can occupy any slot; each skill appears at most once. Drag a learned skill from the tree or either slot row
onto a slot, or click a skill and then a slot in the skills panel. Moving an assigned skill swaps occupied slots.
Right-click a slot in the skills panel to clear it. Saves from six slots pad the two new slots with empty ones. Auto-attack follows
Ember Lance wherever assigned, and is idle while it is unassigned. Ember Lance remains the basic attack for cast priority and movement
regardless of its slot. **Presets:** three named loadouts per character; saving and renaming work anywhere, loading one only in a hideout.

| Skill | Unlock | Cost / cast / cooldown | Behaviour & numbers |
|---|---|---|---|
| **Ember Lance** | 1 (innate) | 0 / 0.42 s / – | Fast fire bolt toward the cursor. Effectiveness 1.0 → 2.3, speed 420, range 320, pierce 0 (pierce comes from the Piercing Flame augment), crit 6%, ignite 10%. Leaves an ember trail. |
| **Ember Nova** | 1 | 12 / 0.55 s / 3.0 s | Ring of 12 → 20 flame projectiles (+1 per rank from rank 3) bursting outward. Effectiveness 1.0 → 1.8 (so each flame of a rank-1 Nova hits as hard as a Lance bolt), speed 260, range 170, pierce 1 (+1 at ranks 5 and 10), crit 5%, ignite 15%. |
| **Flame Wave** | 12 | 16 / 0.5 s / 4.0 s | Fan of 5 → 9 slow, wide flame waves (spread 0.9 rad) that pierce everything. Effectiveness 1.1 → 2.4, speed 180, range 170, radius 14, crit 5%, ignite 25%. |
| **Rime Shards** | 3 | 8 / 0.34 s / – | Fan of 3 → 7 ice shards (+1 at ranks 3, 5, 7, 9), spread 0.35 rad. Effectiveness 0.55 → 1.2, speed 360, range 260, pierce 2, chill 30%, crit 8%. |
| **Arc Chain** | 6 | 14 / 0.38 s / 1.0 s | Lightning strikes the enemy nearest the cursor (within 240) and chains 3 → 8 times (jump range 90). Effectiveness 0.9 → 2.0, shock 25%, crit 10%. |
| **Rift Step** | 1 | 8 / instant / 3.5 s per charge | Blink toward the cursor, distance 90 → 120. 2 charges (+1 at ranks 5 and 10). 0.2 s invulnerable. Afterimages. |
| **Cinder Ward** | 2 | 20 / 0.3 s / 14 → 9 s | For 4 → 7 s: 35% → 55% less damage taken (capped at 60%), and embers burn adjacent monsters (radius 40) for 0.25× effectiveness per 0.5 s, crit 5%. |

**Augments** (`skills.md` 4): each skill has a small tree of augments in three tiers. Tier 1 needs skill rank 2, tier 2 rank 5, tier 3
rank 8; T1 and T2 cost 1 skill point, T3 costs 2. A skill has `floor(rank / 2)` augment slots (at most 5). Some augments exclude each other
(both directions). Augment damage lines ("8% less damage", "60% more damage") join the global `more` pool. A unique that grants an augment's
behaviour (Echo of the Matriarch, The Second Verse, The Last Rite, Winterstride, Stillwinter, Vigil of Ash, The Unbowed Crown) needs no slot,
and when the same effect is also picked the better value applies (no stacking). Playable now (17): Ember Lance Piercing Flame (pierce 2),
Twin Strand (2 bolts 12° apart, 25% less each), Rapid Spark (18% shorter cast, 8% less); Ember Nova Wider Ring (+30% range, +4 flames, 8%
less), Echoing Ring (repeats after 0.4 s at 70%), Ember Fan (120° cone, 60% more, +30% range); Flame Wave Wide Front (+2 waves, 40% wider,
20% less), Ring of Waves (double waves in a full circle, 30% less); Rime Shards Hoarfrost Spread (+2 shards, 50% wider, 15% less), Glacial
Echo (repeats at 60%); Arc Chain Long Reach (+50% jump, +2 chains, 10% less); Rift Step Longer Stride (+30% distance, 0.3 s invulnerable,
+2 Focus), Chilling Landing; Cinder Ward Banked Embers (r80), Frozen Hearth (cold, always chills), Vigil (Focus, no damage), Resolute Flame.
The other augments of the tables are listed and wait for their primitive (lodge, split, fork, convert, expose, trail, ...).

**Respec** (a hideout service): refunding an augment or a whole skill (Ember Lance keeps rank 1) costs 4 Scrap per point (a T3 augment, 2
points, costs 8); it is free below level 20, and the first 15 refunded points of a character are free. Scrap is taken from the backpack,
stash and Crafting Stash in the same save as the refund. A free respec token, when a character has one, resets every skill, augment and
attribute point at once.

**The skill rework migration** (save version 3, owner decision 2026-10-06): every existing character gets all its skill points back: every
skill returns to unlearned except Ember Lance (rank 1, innate, on `LMB`), the unspent points become the full `1 + 2·(L−1)`, augments and the
rest of the loadout start empty, and the old ranks are kept in `legacySkillRanks` for one release. Items, unique flags, attributes and
everything else are untouched.

Skill damage per hit = `(spellPower + addedSpellDamage) × effectiveness × (1 + Σincreased%) × Πmore`. Increased sources are spellDamage, the element's damage and elementalDamage (fire, cold, lightning). Each hit rolls ×0.8–1.2 (midpoint 1), then crit, then the target's resistance.

Player modifiers on skills (resolved by the rules into the sim's numbers, so tooltips and combat agree):
- Cast time = base / cast speed; cooldown = base / cooldown recovery (per charge for Rift Step).
- Crit chance = (skill base + flat) × (1 + increased%); crit multiplier = 150% + flat.
- Ailment chance = the skill's base + flat ignite / chill / shock chance, by damage type.
- Extra projectiles and pierce add to projectile skills (Lance, Nova, Flame Wave, Rime Shards). A single-bolt skill fans its extra bolts 0.12 rad apart (at most 0.6 rad).
- Area of effect multiplies Nova range and Flame Wave / Cinder Ward radius by `sqrt(1 + area%)`; skill duration scales Cinder Ward.

**Flow zones (conveyor belts).** Ground can carry whoever stands on it. Iron March (five W-E belts) and the Last Kiln (the conveyor annulus) are the first
users; the format (`flows` in a layout, D-territory.md 10.5a) is generic, so currents or lava rivers can reuse it. The rules:
- A belt adds its drift (48 u/s at full strength) to the body's own movement every tick, after slows: with the belt a player moves at about 158 u/s
  (+44%), against it at about 62 u/s (-44%), standing still she is carried at 48 u/s. She is never stopped, rooted and frozen bodies are carried too,
  dashes, leaps and knockbacks add on top, solid props still stop the sum (a belt pushing her into a crate rail slides her along it), and the edge of a belt
  fades in over 8 u so crossing it never jerks. Projectiles, events and anchors are unaffected.
- Monsters on a belt are carried the same way: ordinary walkers fully, heavy bodies and bosses by half, ghosts and fixtures not at all, and never more than
  60% of the monster's own speed (so a slow walker can always gain ground against a belt). A sleeping pack far from every player does not drift.
- **Directions are per run.** Each belt's starting direction is drawn from the run's flow seed (Iron March always has at least one belt each way; the
  Kiln runs clockwise or counter-clockwise). It is the one deliberately seed-dependent part of an otherwise fixed layout. Belts also **reverse on a timer**
  (every 28 to 48 s in Iron March, 30 to 50 s in the Kiln, staggered between belts): a 2 s telegraph in which the belt slows to a standstill (chevrons slow,
  flicker, amber rails, a low metal clank), then it accelerates the other way over 1 s. Velocity never jumps.
- Wide road decals in Chainworks areas (aprons, the Gilded Vault's gold road) are static deck plating and never show chevrons: only a flow zone draws
  moving ones, so art, direction and mechanic cannot disagree.

**Cover (props and shots).** Every solid prop has a cover height (`src/data/propCover.ts`): **tall** props stop straight-flying projectiles, **low** props are
flown over (they still block walking), and props with radius 0 (walk-through decor, portals) never block anything. Tall: pillar, standing stone, ruin wall,
vat, hoist, gate, obelisk, statue, sarcophagus, rib arch, ice column, map device. Low: brazier, rubble, bones, crystal, banner, crate, chain post, altar,
bellows, choir stall, weapon rack, anvil, stash, merchant, chest. A layout can override the default per landmark, cluster or wall (a crate rail or a
parapet is low, a crate stack or a full wall is tall); the presenter draws an overridden prop taller or lower than its art. The rules:
- A straight shot, player's or monster's, stops at the first tall prop its path touches (a spark and dust puff, a dull knock); a piercing shot stops there
  too (pierce counts bodies, never walls); a body in front of the wall is still hit first.
- **Lobs fly over everything** (Cinder Spitter and Tar Slinger globs). **Ember Nova** rings burst over cover (a point-blank ring, not an aimed shot).
  Ground telegraphs and areas (slams, pools, wards, fire trails) are never blocked. **Arc Chain** needs a clear line: it strikes the nearest enemy it can
  see and each jump needs a clear line to the next target. Ember Lance, Flame Wave and Rime Shards are blocked.
- A shot that starts inside a prop's footprint (a shooter pressed against a wall) leaves it instead of vanishing, and a muzzle that falls inside a tall
  prop fires from the shooter's centre, so aiming into an adjacent wall hits the wall.
- Monsters never spend a volley on a wall: archers, weavers, crossbowmen and thralls wait with a wall between them and their target and close in
  (the nav flow field takes them round it) until the line is clear. Aim lines stop where the wall would stop the bolt, and a locked heading that
  runs into a wall before the target is not drawn or fired. Boss patterns (Herald fan, Warden shards, Matriarch spiral, Chainmaster hook) are not held
  back by cover, but their shots are stopped by tall props like any other. Leaps (Stalker pounce, hound and thrall leaps) go over props.

## 5. Items

**Bases** (`src/contracts/content.ts` ids). The item level of drops = monster level. Every base has one or two implicits. Base properties scale gently with item level: `floor(base + perLevel·ilvl)`, and the item's own flat / % lines of that stat fold into the property.

| Base | Class / size | Level | Implicit | Base property | Stability | Material note |
|---|---|---|---|---|---|---|
| Ashwood Wand | wand 1×3 | 1 | 12–16% increased fire damage | 1 + 0.06·ilvl added spell damage | 8 | Fire affixes ×2 weight |
| Glassbone Wand | wand 1×3 | 8 | 8–12% increased projectile speed, +2–4 added spell damage | 1 + 0.06·ilvl added spell damage | 6 | Brittle: scar risk starts at 3 stability instead of 2 |
| Ironroot Wand | wand 1×3 | 14 | +3–5 added spell damage | 1 + 0.06·ilvl added spell damage | 10 | Tough: +2 stability |
| Ember Sceptre | sceptre 2×3 | 20 | 18–24% increased spell damage | 2 + 0.09·ilvl added spell damage | 8 | – |
| Cinder Orb | focus 2×2 | 10 | 4–6% crit chance (flat to base) | – | 8 | Critical affixes ×2 weight |
| Runed Tome | focus 2×2 | 5 | 6–10% increased cast speed | – | 8 | – |
| Ritual Circlet | helmet 2×2 | 1 | +10–16 max focus | 8 + 0.4·ilvl evasion | 8 | – |
| Iron Visor | helmet 2×2 | 6 | +20–30 armour | 10 + 0.5·ilvl armour | 9 | Defence affixes ×2 weight |
| Ashen Robe | chest 2×3 | 1 | +30–45 evasion, +8–12 max focus | 12 + 0.8·ilvl evasion | 8 | – |
| Riveted Coat | chest 2×3 | 12 | +45–60 armour | 18 + 1·ilvl armour | 9 | – |
| Silk Wraps | gloves 2×2 | 1 | 4–7% increased cast speed | 6 + 0.35·ilvl evasion | 8 | – |
| Grasping Gauntlets | gloves 2×2 | 8 | +15–22 armour | 8 + 0.4·ilvl armour | 9 | – |
| Pathfinder Boots | boots 2×2 | 1 | 6–10% increased move speed | 4 + 0.25·ilvl armour and evasion | 8 | – |
| Ashen Sandals | boots 2×2 | 6 | +20–30 evasion | 8 + 0.4·ilvl evasion | 8 | – |
| Chain Belt | belt 2×1 | 1 | +18–26 max life | – | 8 | – |
| Runed Sash | belt 2×1 | 10 | 10–15% increased flask effect | – | 8 | – |
| Cinder Pendant | amulet 1×1 | 1 | +12–18 max focus | – | 7 | – |
| Bone Talisman | amulet 1×1 | 12 | +8–12 to all attributes | – | 7 | – |
| Ember Ring | ring 1×1 | 1 | +15–20% fire resistance | – | 7 | – |
| Rime Band | ring 1×1 | 1 | +15–20% cold resistance | – | 7 | – |
| Storm Loop | ring 1×1 | 1 | +15–20% lightning resistance | – | 7 | – |
| Void Signet | ring 1×1 | 16 | +10–14% void resistance | – | 7 | – |

**Advanced bases:** first drop in Tier 8 (item level 46; Tier 7 is 40). Rook also offers them when gambling at
or above their level requirement. All ten use the existing class footprints and affix pools; existing bases
keep their stats and material identities. Area class preferences also apply to these bases.

| Base | Class | Level | Implicit | Base property | Stability | Material note |
|---|---|---|---|---|---|---|
| Emberheart Wand | wand | 42 | 18–24% increased fire damage | 3 + 0.11·ilvl added spell damage | 9 | Fire affixes ×2 |
| Stormglass Sceptre | sceptre | 46 | 24–30% increased spell damage | 4 + 0.14·ilvl added spell damage | 8 | Lightning affixes ×2 |
| Echoing Focus | focus | 42 | 10–14% increased cast speed, +20–28 max focus | – | 9 | Speed affixes ×2 |
| Bastion Helm | helmet | 42 | +25–35 max life | 30 + 0.85·ilvl armour | 10 | Defence affixes ×2 |
| Duskweave Robe | chest | 46 | +45–60 evasion, +25–35 max focus | 35 + 1.3·ilvl evasion | 9 | Void affixes ×2 |
| Forgemaster Gloves | gloves | 42 | 7–10% increased cast speed | 20 + 0.65·ilvl armour | 10 | Longer crafting budget |
| Wayfarer Greaves | boots | 42 | 10–14% increased move speed | 14 + 0.45·ilvl armour and evasion | 9 | Speed affixes ×2 |
| Ironweave Girdle | belt | 46 | +30–42 max life | – | 10 | Life affixes ×2 |
| Prismatic Amulet | amulet | 42 | +12–16 to all attributes | – | 8 | Resistance affixes ×2 |
| Dusksteel Ring | ring | 46 | +18–24% void resistance, +18–24 max focus | – | 8 | Void affixes ×2 |

**Rarity:** normal 0 affixes; magic 1–2 (≤1 prefix, ≤1 suffix; 1 or 2 at 50/50); rare 3–6 (≤3 prefixes, ≤3 suffixes; 3: 25% · 4: 40% · 5: 25% · 6: 10%); unique fixed.

**Rare names** come from two word lists (for example "Ember" + "Bite", "Grave" + "Coil"), with 40 words each.

**Affixes:** 52 (17 prefixes, 35 suffixes), each with 7–10 tiers (T1 best), except "of Splintering" (1 tier). Item level unlocks tiers; weights fall steeply, so the top tiers (ilvl 78–84) stay rare even on high-level items:

| Tiers | Item level per tier (worst → best) | Weight per tier (worst → best) |
|---|---|---|
| 7 | 1 / 12 / 26 / 40 / 54 / 66 / 78 | 1000 / 800 / 600 / 400 / 220 / 90 / 25 |
| 8 | 1 / 10 / 20 / 32 / 44 / 56 / 68 / 80 | 1000 / 800 / 600 / 400 / 250 / 120 / 50 / 15 |
| 9 | 1 / 8 / 16 / 24 / 34 / 46 / 58 / 70 / 82 | 1000 / 850 / 700 / 550 / 400 / 250 / 120 / 50 / 15 |
| 10 | 1 / 6 / 12 / 20 / 28 / 38 / 48 / 60 / 72 / 84 | 1000 / 850 / 700 / 550 / 400 / 280 / 180 / 100 / 40 / 10 |

| Kind | Affixes |
|---|---|
| Prefixes | flat max life (T1 54–60) · flat max focus · added spell damage (wand/sceptre/focus/amulet/ring; T1 19–21) · % spell damage (weapon/focus/amulet; T1 56–62%) · % fire / cold / lightning damage (weapon/focus/amulet/ring; T1 51–56%) · % elemental damage (ring/amulet) · % void damage ("Entropic", weapon/focus/amulet/ring; 10 tiers, T1 51–56%) · % physical damage ("Concussive", weapon/focus/amulet; 10 tiers) · flat armour / flat evasion (armour pieces with that property) · % armour / % evasion (armour pieces with that property) · % item rarity (helm/gloves/boots/amulet/ring, 5–25% — *luck*) · life on kill (weapon/gloves/belt/ring) · focus on kill (weapon/focus/gloves/belt/amulet) |
| Suffixes | % cast speed (weapon/gloves/amulet/ring) · % crit chance (weapon/focus/helm/amulet) · crit multiplier (weapon/amulet) · fire / cold / lightning resistance (armour, belt & jewellery; T1 33–36%) · void resistance (T1 22–24%) · all resistances (amulet/ring) · % move speed (boots) · % focus regen (helm/focus/amulet/ring) · life regen (chest/belt/ring) · str / dex (armour, belt & jewellery) · int (also weapons and foci) · % projectile speed (weapon) · % area (focus/amulet) · % cooldown recovery (helm/amulet) · % pickup radius (belt/boots) · % item quantity (belt/amulet, 3–14% — *luck*) · % flask effect (belt) · ignite / chill / shock chance (weapon/gloves) · **+1 projectile** ("of Splintering", wand only, T1 only, ilvl 70+, weight 15) · **penetration** (power rework; value = percentage points taken off the target's resistance, tag `penetration`, 7 tiers, T1 at ilvl 78): fire / cold / lightning / void / physical "of … Sundering" (wand/sceptre/focus/amulet; 2–3 up to 14–15, T4 8–9 at ilvl 40, one exclusive group per type) and "of Prisms" (elemental, focus/amulet/ring; 1–2 up to 8) · % damage over time ("of Lingering", weapon/focus/gloves; 8 tiers, 10–14% up to 54–63%) · % projectile damage ("of Volleys", wand/gloves; 8 tiers, 8–12% up to 36–41%) · % area damage ("of Eruptions", focus/amulet/gloves; same ladder) · +1 to 3 maximum resistances ("of Warding", amulet/ring; 7 tiers, 1/1/1/2/2/3/3 points, never above the 85 hard ceiling; not on the bench) · flask charge on kill ("of Reserves", belt; 7 tiers, a charge 1, 2, 4, 6, 8, 11 or 15 kills sooner than the base 40) |

Luck affixes (item quantity / rarity) are personal: they raise only their wearer's drops (§9, §11).

**Saved equipment:** phase-2 affix revision 2 is stored per item. Older rolls migrate once to the best new tier unlocked by the old tier’s item-level gate (also bounded by the item’s level), preserving their relative roll within the range. Names, history, scars, stability, seals, fractures and bench-crafted marks survive. Lowest-tier values and the starting kit remain unchanged.

**World-pool uniques (12: four classic, eight power-rework)** (any equipment drop at weight `0.2·m^1.5` of about 94, the boss's own 8%×m roll, and the gamble at 0.5%×m; m = rarity / 100 — the looter's personal rarity for drops, gear rarity for the gamble). Only uniques you could wear can appear: a drop picks among those whose level requirement ≤ its item level (Tier 1, item level 4: none; Tier 2, item level 10: The Patient Spark; Tier 3, item level 16: + Cinderwalkers; Tier 4: + Echo of the Matriarch; Tier 5: + Ruinheart Band; the eight of the power rework follow from their own level requirement, listed below), otherwise it becomes a rare; the gamble offers a unique only when one of the class is ≤ your level. They keep their base's implicit and properties. Only Crown Fragments can reroll their numeric modifiers; ordinary and bench crafts cannot change them:

| Unique | Base | Effects | Flavour |
|---|---|---|---|
| **The Patient Spark** (level 10) | Ashwood Wand | +(30–45)% fire damage · 15% reduced cast speed · Ember Lance pierces all targets (`lancePierceAll`) | "It waits for the whole line." |
| **Cinderwalkers** (level 16) | Ashen Sandals | +(15–20)% move speed · +(20–30)% fire resistance · burning trail (`fireTrail`) | "Where she walked, the ash remembered." |
| **Echo of the Matriarch** (level 20) | Cinder Pendant | +(15–25) max focus · Ember Nova repeats once after 0.4 s (`novaEcho`) · 8% reduced max life | "Her last command still rings in the embers." |
| **Ruinheart Band** (level 24) | Void Signet | +1 projectile · +(20–30)% void resistance · 12% increased damage taken | "Power pours from the wound, not the hand." |

**Power-rework uniques (10)** (docs/power-rework/power-curve.md 10.4: build enablers, none gives a `more` above 25%, none grants penetration above 16, none is mandatory). Eight are world-pool uniques (same rules as above); **Stormcaller's Lattice** joins Varkus's boss-exclusive pool and **Hollow Crown** the Hollow Warden's (their pools grow to three; each is eligible from its own level requirement). Their behaviour flag is **data-complete but gated**: it is not granted and its text is not shown until the slice that builds the behaviour ships (the `awaits` field in `src/data/items/uniques.ts`); the stat lines below are live now.

| Unique | Base | Effects | Flavour |
|---|---|---|---|
| **Frostfire Spiral** (level 30) | Glassbone Wand | +(25–35)% fire damage · +(25–35)% cold damage · 15% reduced cast speed · 40% of fire damage converted to cold (awaits the damage pipeline) | "The flame learned the cold, and kept the grudge." |
| **Stormcaller's Lattice** (level 46) | Stormglass Sceptre | +(40–50)% lightning damage · penetrate (12–16)% lightning resistance · 10% reduced max life · skills chain 1 additional time (awaits) | "Every strike finds the next willing thing." |
| **Penitent's Prism** (level 44) | Prismatic Amulet | +(20–30)% elemental damage · penetrate (10–14)% elemental resistances · skills cost 15% more Focus (awaits) | "It splits every prayer into three, and charges for each." |
| **Hollow Crown** (level 52) | Duskweave Robe | +(35–45)% void damage · −10% to all resistances · Decay stacks up to 8 times (awaits) | "Whatever wore it was emptied first, and gladly." |
| **Weeping Hearth** (level 22) | Ember Sceptre | +(60–90)% damage over time · −20% chance to ignite · ignite lasts 6 s and burns 40% less per second (awaits) | "The fire does not die. It only takes longer to leave." |
| **Gravewind Boots** (level 40) | Wayfarer Greaves | +(10–14)% move speed · +(15–25)% cooldown recovery · Phase Stride lasts twice as long (awaits) | "The dead walk fast when nothing holds them back." |
| **Anchorite's Seal** (level 48) | Dusksteel Ring | +(30–40) max focus · 8% reduced max life · 30% of damage taken drains Focus first (awaits) | "Faith is a held breath. Hers was never let go." |
| **Bellwether** (level 38) | Bone Talisman | +(8–12) to all attributes · the skill in loadout slot 1 has 2 additional augment slots (awaits) | "One bell, rung true, is a whole choir." |
| **Needlepoint** (level 36) | Cinder Orb | +(3–4)% crit chance · +(25–35)% crit multiplier · hits that are not critical strikes deal 10% less damage · critical strikes penetrate 15% of resistances (both awaiting) | "A single, patient point, and the whole armour opens." |
| **Twice-Struck Bell** (level 34) | Runed Tome | +(20–30) max focus · +(10–15)% cooldown recovery · lodged detonations trigger a second time at 50% (awaits) | "The second note is the one that breaks the glass." |


**Keystone uniques (14):** boss-exclusive rewards, separate from the world uniques above. Each matching final boss in the named Atlas areas has a `12% × personal item rarity / 100` chance (capped at 100%) to drop one eligible item from its pool (two items; three for Varkus and the Hollow Warden after the power rework), equally weighted. Item quantity and the elite rarity multiplier do not affect this extra roll. The first item requires level 46 (Tier 8 / item level 46), the second level 58 (Tier 10 / item level 58). Below the pool's eligibility there is no extra drop. Ordinary equipment, chests, the ordinary boss unique roll and gambling never select these fourteen. Each twin boss in an eligible area can roll independently. The Atlas, Map Device and item tooltip disclose sources and level gates.

| Boss | Atlas sources | T8+ unique | T10+ unique |
|---|---|---|---|
| Cinder Matriarch | Crown Foundry (up to T9), Heart of the Forge | Everburn | The Sunken Sun |
| Hollow Warden | Winter Throne (up to T9), Echo Bastion | Winterstride | Stillwinter |
| Ashbound Herald | Ember Citadel | Vigil of Ash | The Last Rite |
| Bone Chorister | Frozen Passage | Choir of Glass | The Second Verse |
| The Chainmaster | The Last Kiln | The Broken Link | Iron Refrain |
| Varkus | Eternal Arena | The Unbowed Crown | Victor's Debt |

They retain their advanced base properties and implicits. Crown Fragments reroll numeric values while preserving identity, behaviour and sources.

| Unique | Base | Effects | Flavour |
|---|---|---|---|
| **Everburn** (level 46) | Emberheart Wand | +(35–50)% fire damage · 10% reduced cast speed · Ember Lance always ignites | "A promise the flame refuses to forget." |
| **The Sunken Sun** (level 58) | Echoing Focus | +(30–45)% spell damage · +(20–30) max focus · 20% reduced area · Ember Nova fires in a 150° forward fan | "All its light falls in one direction." |
| **Winterstride** (level 46) | Wayfarer Greaves | +(8–12)% move speed · +(25–35)% cold resistance · −15% fire resistance · Rift Step chills enemies within 100 units of its landing for 2 seconds | "Every arrival is the first day of winter." |
| **Stillwinter** (level 58) | Duskweave Robe | +(25–40) max life · +(35–50)% cold damage · −20% fire resistance · Cinder Ward deals Cold damage and always chills | "The cold does not end. It keeps watch." |
| **Vigil of Ash** (level 46) | Forgemaster Gloves | +(30–45) max focus · +(15–25)% focus regen · 15% reduced spell damage · Cinder Ward deals no damage and restores 2 Focus per nearby enemy per pulse, capped at 6 | "The faithful feed the fire with their doubt." |
| **The Last Rite** (level 58) | Stormglass Sceptre | +(45–60)% fire damage · +(10–15)% cast speed · 10% reduced max life · Flame Wave fires in a full circle | "No one stands outside the final circle." |
| **Choir of Glass** (level 46) | Prismatic Amulet | +(35–50)% cold damage · +(8–12)% cast speed · 8% reduced max life · Rime Shards pierce all targets | "One note passes through every throat." |
| **The Second Verse** (level 58) | Echoing Focus | +(30–45)% cold damage · +(20–30) max focus · 15% reduced cast speed · Rime Shards repeat once after 0.4 seconds at no additional Focus cost | "The answer comes from an empty choir." |
| **The Broken Link** (level 46) | Ironweave Girdle | +(25–40) max life · +(12–18)% cooldown recovery · 20% reduced focus regen · Rift Step removes all harmful effects | "Freedom begins with one missing link." |
| **Iron Refrain** (level 58) | Bastion Helm | +(35–50)% lightning damage · +(8–12)% cast speed · 8% reduced max life · Arc Chain may revisit earlier targets, never the same target on consecutive hits | "Every chain returns to its master." |
| **The Unbowed Crown** (level 46) | Bastion Helm | +(30–45) max life · +(2–4) life regen · 8% reduced move speed · taking a Physical hit restores 0.5 seconds to an active Cinder Ward, capped at its original duration | "The crowd falls silent. The champion does not." |
| **Stormcaller's Lattice** and **Hollow Crown** | see Power-rework uniques above | extra entries of Varkus's and the Hollow Warden's pools (levels 46 and 52) | |
| **Victor's Debt** (level 58) | Dusksteel Ring | +(25–35)% spell damage · +(10–14)% all resistances · 10% increased damage taken · hits deal 25% more damage within 80 units, 25% less beyond 200 units | "Victory is paid for at arm’s length." |

Echoes use the caster's current position and aim, preserve the cast's skill values, cost no extra Focus and never repeat recursively; death cancels pending echoes. The Nova fan can combine with Echo of the Matriarch, and the Rime echo with unlimited pierce. Ward snapshots its Cold/Focus/renewal behaviour at cast time; Focus mode suppresses damage and ailments even with Stillwinter. Renewal needs an actual positive Physical hit (not evaded, blocked by invulnerability or damage over time) and never revives an expired Ward. Victor's Debt uses distance at hit time; damage over time is unaffected.

## 6. Crafting (the heart)

**Stability:**
- Every non-unique item has `maxStability` from its base; it starts full.
- Each operation costs stability.
- **Scar risk:** if the remaining stability after paying is ≤ 2 (≤ 3 on Glassbone), there's a 35% chance to gain a scar. Scars persist until removed with Scar Balm; items can have at most 2, never the same one twice:

  | Scar | Drawback |
  |---|---|
  | Frail | 5–10% reduced maximum life |
  | Hollow | 5–10% reduced maximum focus |
  | Smouldering | −6 to −12% fire resistance |
  | Rimebitten | −6 to −12% cold resistance |
  | Sluggish | 4–8% reduced cast speed |
  | Leaden | 3–6% reduced move speed |
  | Dim | 6–12% reduced spell damage |
  | Exposed | 3–6% increased damage taken |
  | Brittle | 15–25% reduced armour (armour bases only) |
  | Frayed | 15–25% reduced evasion (evasion bases only) |
- **At 0 stability** the item is **Finished**: ordinary crafting stops, and it is never destroyed. Scrap repair at the bench restores Stability so crafting can continue.
- A craft that would do nothing is rejected without consuming anything.

| Currency | Family | Cost | Effect |
|---|---|---|---|
| Kindling Shard | shape | 1 | Normal → magic with 1–2 random affixes. |
| Forge Scrap | shape | 1 | Rerolls the values of all unsealed, unfractured affixes within their tiers. Also the merchant money. |
| Reforging Ember | shape | 2 | Rerolls all unsealed, unfractured affixes into a new **rare** (3–6 total). |
| Essence (Ember / Rime / Storm / Vital / Swift / Umbral) | shape | 2 | Adds one affix with that tag. Ember = fire, Rime = cold, Storm = lightning, Vital = life/defence/resistance, Swift = speed (cast/move/projectile), Umbral = void and physical. Fire, cold, lightning, void and physical essences include the matching penetration affix ("of … Sundering") and damage affix. Umbral Essence is not in the ordinary currency table: it comes from Void Breach seals (Silver 30%, Gold always, times the Voidtouched strength) and Tier 8+ final bosses (30% × personal rarity). Normal → magic; magic with 2 → rare. Fails if no room. |
| Tempering Catalyst | refine | 3 | **Choose an affix:** upgrade it one tier (if item level allows) and reroll its value in the new tier. |
| Forge Solvent | remove | 1 | Removes the **lowest-tier** unsealed, unfractured affix (ties random). With 0 affixes left, the item becomes normal. |
| Binding Seal | preserve | 0 | **Choose an affix:** it is sealed for the next operation, then the seal breaks. One seal at a time. |
| Fracture Core | transform | 3 | **Choose an affix:** it becomes permanently fractured, immune to everything. One fracture per item. |
| Prefix Rune | shape | 3 | Reforges all unsealed, unfractured prefixes, keeping their count and every suffix. Keeps rarity and name. |
| Suffix Rune | shape | 3 | Reforges all unsealed, unfractured suffixes, keeping their count and every prefix. Keeps rarity and name. |
| Scar Balm | remove | 0 | Removes the oldest scar, even on Finished equipment. Preserves affixes, seals and Stability. |
| Anneal | refine | 0 | Permanently loses 1 maximum Stability, then restores current Stability to that maximum. Requires at least two missing Stability. Keeps scars, seals and lifetime costs. |
| Graft | transform | 3 | Choose an unprotected affix: replace its family with a different eligible family of the same prefix/suffix type and exact tier. Keeps all other affixes, rarity and name. |
| Transmute | transform | 3 | Change to a random different compatible base of the same class. Rerolls implicit values; preserves affixes, scars, name, item level, UID and Stability budget. Must be unequipped; equip requirements and base properties can change. |
| Echo Shard | refine | 2 | Roll each unprotected affix value twice within its tier and take the higher new roll. A new roll can still be worse than the previous value. |
| Crown Fragment | refine | 0 | Reroll a Unique's numeric modifiers within their defined ranges. Keeps implicit values, identity and special behaviour. No Stability or scars. |


Currencies stack to 40 (Fracture Core, Void Needle, Reliquary Key and both Runes and all nine advanced ingredients to 20). Map currencies cost no stability.

**Rune sources:** the Glass Sepulchre boss has a 25% chance to drop one Prefix Rune on Tier 3+ maps;
the Ember Vault boss has a 25% chance to drop one Suffix Rune on Tier 3 maps (the area's ceiling).
These are extra independent rolls per living player, unaffected by quantity/rarity. Runes do not appear in
ordinary currency rolls, chests or merchant offers. Both are tradeable and have Crafting Stash slots.
Runes use normal scar rules and break seals after the operation. A rune with no eligible target affix is
rejected without spending the rune, Stability or RNG. Previews show preserved affixes and exact family/tier odds.

**Advanced ingredient sources** (extra rolls per living player, independent of quantity/rarity):

| Ingredient | Source |
|---|---|
| Scar Balm | Glass Sepulchre boss, T3+, 15% |
| Anneal | Crown Foundry boss, T5+, 20% |
| Graft | Winter Throne boss, T5+, 20% |
| Transmute | Ember Vault boss, T3, 15% |
| Compass | Champion's Approach boss, T5+, 20% |
| Echo Shard | The Echoing: Bronze T3+ 50%, Silver 1, Gold 2 |
| Twin Ink | Each defeated Vaultbreaker carrier, T3+, 20% |
| Void Splinter | Wound completion, T3+, guaranteed |
| Crown Fragment | Rival Crowns completion, T5+: Bronze 1, Silver 2 |

All are tradeable, have Crafting Stash slots and stay out of ordinary currency rolls. Graft, Transmute and
Echo Shard use the ordinary scar rule and break seals after protection applies. Transmute's scar risk uses
the original material; any new scar must fit the resulting base. Scar Balm and Anneal preserve
seals. Lifetime crafting/repair counters survive every transformation and reload. Graft previews exact family
odds at the chosen tier, Transmute lists equip-compatible candidates, and Echo Shard shows the probability
of beating each current value. Invalid and redundant crafts consume nothing.

Tooltips and the craft preview show exact odds, for example "Adds one of 5 fire affixes: Blazing 34%, Smouldering 28%, …", filtered by item class, free prefix/suffix room and item level.

Every craft appends a line to `item.history`, so the item carries its own story.

**Scrap services at the bench** (equipment or maps; costs shown before applying):

| Service | Scrap cost | Effect |
|---|---|---|
| Repair 1 Stability | `8 + 3 × lifetime crafts + 6 × previous repairs²` | Restores exactly one point, even on Finished equipment. Keeps all affixes, seals, fractures and scars. Cannot exceed maximum Stability; uniques cannot be repaired. |
| Reroll a chosen map danger mod | `3 + map tier` | Replaces just that danger/reward pair with a different eligible mod. Keeps every other mod, rarity, tier, quality and Bounty commission. Exact family odds and magnitude range are shown. |
| Commission Bounty | `8 + 2 × map tier` | Attaches a Bounty commission to the map item. Guarantees The Stalker in wave 2 instead of the random event roll; its trophy guarantees at least a Rare per living player. The map remains tradeable. |

Map services reject corrupted maps, duplicate commissions and invalid targets without payment. Services spend
backpack Scrap first, then the Crafting Stash, respecting trade locks. Repair prices use durable per-item craft
and repair counters, independent of the capped display history; legacy gear uses surviving craft lines and spent
Stability as a lower bound. Every equipment currency operation and bench addition/clear increases the craft
counter; each repaired point increases the repair counter. Neither can be reset by crafting, trading or reloads.
The server rejects a stale quoted service price, so a concurrent change cannot silently charge a higher amount.
Hard currencies (Reforging Ember, Tempering Catalyst and Fracture Core) retain their scarce drop sources.


**Map currencies:**
- **Map Dust:** normal → magic (1 or 2 danger mods, 50/50), or rerolls the danger mods of a magic map (1–2) or a rare map (3–4, 50/50). Both reward mods are kept when Twin Ink has added a second.
- **Threat Glyph:** adds one danger+reward mod; the map becomes rare at 3+ danger mods (max 4).
- **Reward Ink:** adds one reward-only mod (max 1 per map; it doesn't count toward rarity).
- **Compass:** marks a map below T15 so its guaranteed chest map is one tier higher (100%, rather than 25%). The optional extra map roll is unchanged.
- **Twin Ink:** adds a second distinct reward-only mod to a map that already has one. Once per map; the flag and both rewards survive saving and Map Dust. Ordinary Reward Ink still adds at most one.
- **Void Splinter:** removes corruption and every corruption-marked, corrupted-kind or Echo mod; quality becomes 0. Preserves tier, ordinary mods, Bounty, Compass and Twin Ink. Crafting becomes available again.
- **Void Needle:** corrupts the map; further crafting requires a Void Splinter. Outcomes (the +1 tier outcome is left out at Tier 15):

  | Chance | Outcome |
  |---|---|
  | 30% | A corrupted mod (strong danger + strong reward) |
  | 20% | +1 tier |
  | 20% | Becomes rare with 4 mods |
  | 15% | +1 wave: a 7th "Echo" wave with double loot |
  | 15% | Nothing except corruption |

## 7. Maps

**Map items are bound to one Atlas area (brief D, slice T0).** `MapItem.areaId` names the area the map opens (a "Furnace Yard map");
`baseId` is always that area's theme (`findAtlasArea(areaId).baseId`), so the theme and implicit below come from the area. Tier, quality, mods,
corruption, Bounty and Compass charting stay on the item. Activating a map runs exactly that area; there is no area argument
(`openMap(ch, { lootClass?, passage? })`). The tooltip leads with `Area: Furnace Yard (Forge)  Accepts up to Tier 5` and says "Unexplored
territory" for an area the viewer has not charted; a map of an undiscovered area cannot be opened (the fog is never skipped) and a map above its area's ceiling
cannot be opened. Maps are named by place (`Furnace Yard map`; magic: first mod + place; rare: the generated name, the place as subtitle).
A Void Needle tier-up at the area's ceiling moves the map to a deeper area of its theme, so a raised tier never strands it.

**Passages (sealed areas and the Pit).** Sealed areas and the Pit of Echoes are never a map's own address. The area modal's **passage slot** (only in the modal of a sealed area or the Pit) is a real drop target (the key stays in the inventory until activation; the slot only records the choice, and refuses with a reason: not this area's key, not a key at all; a missing map, a tier above the ceiling or a map that cannot reach the area show in the footer). A key held in the inventory offers its sealed area
when the map's tier fits that area's ceiling: any map works, the key is spent with it, the map's own area is bypassed and the run records
`RunSetup.passage = { kind: 'key' }` (the bound map stays in `sourceMap` for refunds). A Bounty map bound to Iron March (the Pit's only neighbour) offers
"Open the Pit of Echoes" (`passage: { kind: 'bounty' }`). The wire command is `activateMapDevice { lootClass?, passageKey?, pit?, useSurge? }`; a stale
client's `areaId` is accepted only when it equals the map's bound area.

**Legacy maps (save version 2).** A map saved without an area is bound once at load (`bindLegacyMaps`, in the character loader and in `openMap` as a guard), in
every place a map can live (backpack, stash tabs, Map Stash, Crafting Stash work slot, the map device; open runs rebuild their `sourceMap` the same way). Choice inside a candidate set is
`hash(uid) % n` over the set sorted by depth then id: deterministic, idempotent, no rng. Order: (1) a discovered same-theme area accepting the tier; (2) else any discovered area
accepting it (smallest ceiling first; the map moves theme and says so in its tooltip); (3) else the shallowest area that accepts the tier, which is charted
(the map is the chart fragment). Nobody loses a map. The starting kit is three Tier 1 Cinder Crossing maps; Rook's wares board always carries one plain map (see **Rook's wares** under §9).
Drops are routed by the chart (see **Map drops** below). A run frozen before routing existed (no `routing` in its persisted setup) keeps the old behaviour: the theme is rolled (same rng) and the area follows
from it (a discovered area of that theme accepting its tier, else any discovered area that accepts it, else the shallowest fit beside the chart).

**Map bases** (each has its own theme and palette):

| Base | Theme / palette | Arena radius | Implicit (implemented) |
|---|---|---|---|
| Ashen Forge | Lava-cracked basalt, ember light | 900 | Ember Essences 3× as likely; monsters +10% to all resistances |
| Rimed Ossuary | Frosted bone-tiles, cold blue light, ice crystals | 900 | Rime Essences 3× as likely; +20% monster life; +15% item rarity |
| Iron Coliseum | Rusted iron plates, sand, torchlight | 650 | +25% monster count; armour bases +2 stability |

**Tier and monster level:** tiers 1–15. Monster level = `min(90, 6·tier − 2)` (Tier 1 = 4, Tier 4 = 22, Tier 15 = 88), and it is the item level of every drop. **Monster stats scale with monster level, not tier** (Path of Exile style): life ×1.09 and damage ×1.09 per level above the reference level 10 (the level at which the sim's base monster table applies unchanged) up to monster level 16, then life ×1.11 and damage ×1.11 per level beyond it with life also gaining a flat +0.25 (of base) per level past 16, **unchanged up to monster level 28**; from monster level 28 the curve bends (curve v3): life ×1.061 per level to monster level 40, ×1.0545 to 60 and ×1.0384 beyond, damage ×1.04, ×1.028 and ×1.019 (life ×18.1 and damage ×9.4 at monster level 40, ×52.2 and ×16.3 at 60, ×149.8 and ×27.7 at 88); below the reference level monsters shrink gently (life ×1.09, damage ×1.065 per level), shown as "more" or "less" from "Monster level N" in the readout. **Level gap:** a monster more than 3 levels above the character it hits deals +5% damage per further level, up to +100% (nothing when the character is at or above monster level; damage over time is not scaled twice); shown in the map tooltip. Tier still drives experience (Tier 1 gives ×0.5, then ×1.28 per tier above 1: T2 ×1.28, T3 ×1.64, T4 ×2.10, T5 ×2.68) and +5% item rarity per tier (additive). Tier 1 experience is deliberately halved so a new character needs about ten Tier 1 maps to reach level 10, where Tier 2 is on-level; a fresh character is expected at level 4 after the first Tier 1 clear, 6 after three, 9 after eight.

**Defences scale with monster level too.** Evade chance = `rating / (rating + 30 × monster level)` (at most 75%): the same evasion rating avoids fewer hits from higher-level monsters, so roughly half of all hits can only be avoided with focused high-end gear. Monster accuracy is the `30 × monster level` term. Armour retains its hit-size formula (`armor / (armor + 10 × damage)`): higher-level hits already reduce its effectiveness, so there is no second armour penalty. The sheet's example physical hit scales from 20 at monster level 10 with the same damage curve.

Maps above monster level 10 impose `min(40, 0.5 × (monster level − 10))` percentage points of resistance penalty: T1/T2 none, T3 −3%, T4 −6%, T15 −39% (the current tier ceiling); capped at −40% for monster levels 90+. This combines with map mods and is shown in the map tooltip, Map Device, map HUD and character sheet. Hideouts use reference level 10, with no map penalty.

**Balance intent (owner, 2026-09-29):**
- There is no early-tier easing. A brand-new character with the starting kit is expected to die on Tier 1 (monster level 4) a few times, level up on the way and come back through the portals.
- A normally geared character comfortably clears maps whose monster level is up to about their own level + 3. Modded maps and higher tiers need properly crafted gear and a balanced build.
- Progression is steep: drops are scarce (§9), and item level is monster level, so better affix tiers need higher tiers.

**Quality** (0–20): +1% item quantity and +1% map drop chance per point. Dropped maps have quality 25% of the time (1–10); chest maps always have 4–12.

**Map luck is map-side:** tier, quality, implicit and mods give the map's own item quantity / rarity (`RunSetup.itemQuantity / itemRarity`, 100 = base), shown as "Map Item Quantity / Rarity" on map tooltips and in the map device readout. Each player's gear luck is added only to their own drops (§9); the device headlines that personal total ("Your item quantity"), and the in-map character sheet leads its Luck section with "Item Quantity / Rarity in this Map".

The map device readout ends with **Party Scaling** (applied by the sim, §11): per extra living player +50% monster life, +25% monsters per wave, +10% magic and rare pack chance (a party of 4: 2.5x, 1.75x, 1.3x).

**Mods** (danger paired with reward). The numbers below are nominal: a mod rolls 100–110% of them, +3% per tier above 1 (fixed effects such as −40% focus regen don't scale). Pick weights: 100, except Volcanic, Exhausting, Hexed and Splitting 80, Twin-Crowned 60.

| Mod | Danger | Reward |
|---|---|---|
| Teeming | +35% monster count | +20% quantity |
| Commanded | +60% magic/rare pack chance | +25% rarity |
| Restless | +20% monster speed | +15% quantity |
| Volcanic | Eruption hazards | +20% quantity |
| Fortified | +40% monster life | +18% quantity |
| Ferocious | +25% monster damage | +22% quantity |
| Twin-Crowned | 25% more monster life | +40% rarity |
| Exhausting | −40% focus regen | +20% quantity |
| Hexed | −20% player resistances | +18% rarity |
| Splitting | +1 monster projectile | +15% quantity |

Corrupted mods (Void Needle, "Corrupted mod" outcome):

| Mod | Danger | Reward |
|---|---|---|
| Seething Horde | +60% monster count | +35% quantity |
| Matriarch's Wrath | +40% monster damage | +50% rarity |
| Bloodbound | 40% more monster life | +25% quantity, +25% rarity |
| Unravelling | −30% player resistances | +55% rarity |
| Crowned Host | +100% magic/rare pack chance | +20% quantity, +30% rarity |

Reward-only mods (Reward Ink):
- **Gilded:** +30% rarity
- **Bountiful:** +25% quantity
- **Cartographer's:** maps 3× as likely
- **Essence-laden:** essences 3× as likely

**Expanded map roster.** All six bases drop and Rook's wares board offers maps of the areas you have discovered. A map is bound to an area and takes its theme from it: Ember Vault uses Cinder Chapel, Glass Sepulchre uses Choral Crypt, and Iron March uses Chainworks. Other routes retain their original themes and bosses. The Atlas shows the theme and boss before activation.

| New map | Wave family | Final boss | Implicit / arena |
|---|---|---|---|
| Cinder Chapel | Ashlings, Cinder Spitters, Rift Stalkers | Ashbound Herald | +25% magic/rare pack chance; essences twice as likely; radius 800 |
| Choral Crypt | Bone Thralls, Rimeshades, Frost Weavers, Glacial Wisps | Bone Chorister | +10% monster speed; +25% item rarity; radius 850 |
| Chainworks | Pit Hounds, Chain Thralls, Iron Crossbowmen, Tar Slingers | The Chainmaster | +15% monster count; +10% item quantity; radius 700 |

The new maps have separate floor tiles, decals, lighting, landmark layouts and map emblems. They reuse existing monster art and attack telegraphs. Area-specific arena scales and targeted drop weights still apply.

**Pins (brief D 5.1, slice P1).** An account keeps up to **3 pins** (more through a `pinSlots` tree node, at most 5): `AtlasProgress.pins`, validated on load (known, charted, not sealed, not the Pit, unique, clamped to the slot count; a respec that removes a slot node drops the last pins). Pinning is free, instant and allowed any time (`pinArea { areaId, pinned }`, predicted by the client, refused by the server for a fogged area, a passage area or a full tray). A pinned area's maps drop `x3` more often (`max(base, 0.5) x 3`, x4 with Chart Keeper) at any distance, frozen into each expedition at activation like the rest of the table. UI: a pin tray in the chart's corner (chip = emblem, name, tier ceiling; click focuses the area, x unpins; open slots dashed), a pin toggle on the selected node and in the rail, a brass pin and halo on pinned nodes in every lens, and a pin mark in the Sources table and the dock's "Next drops".

**Re-chart (brief D 5.2, bench Scrap service).** Moves a map to a chart neighbour of its area that is charted, not sealed, not the Pit and accepts the map's tier. Everything else travels (tier, quality, mods, rarity, Bounty, Charted, Twin Ink); the theme follows the new area; `rechart` counts the hops (tooltip "Re-charted x2"). Price `ceil(1 + tier / 2)` Forge Scrap (T1 2, T5 4, T9 6, T15 9), 1.5x after one hop, 2x after two (Ledgerline takes 1 off, minimum 1). Corrupted maps are refused. A map in an undiscovered area may be re-charted to a charted neighbour (the rescue path for traded-in maps). It is the bench service `bench:rechart:<areaId>` of `benchCraft` (one per legal neighbour; quoted `expectedScrap`, atomic with the move, refused for a map in an open trade offer) and opens from a popover (name, theme, ceiling, what you hold there, price) on the dock's home chip and at the bench.

**Recycle (brief D 5.3, bench).** Three maps of one tier (not corrupted, no Bounty, not Charted; from the backpack, stash, Map Stash or work slot, never the device) become ONE Normal map of an area you choose: the area of one of the three or a chart neighbour of one, charted and accepting the tier. Quality `min(20, floor(mean) + 2)`, no mods, no re-chart count; price the tier in Forge Scrap (Ledgerline -1, minimum 1). The three maps are dragged into the bench's three recycle slots (they stay in the inventory until Recycle is pressed); `benchRecycle { uids, areaId, expectedScrap? }` is atomic (Scrap, the three maps and the new one in one step; no room in the backpack refuses the whole thing). It never raises the tier.

**Map drops (chart-driven, brief D section 4):** every dropped map is bound to an Atlas area chosen from a table frozen into the expedition at activation (`RunSetup.routing`, persisted and restored with the run;
all numbers in `src/data/progression/routing.ts`, rules in `src/game/progression/map-routing.ts`). The total number of maps per run does not change, only which area they address.
- **The table** is centred on the map's own area (a passage run keeps the map's area, not the sealed destination). Weights: the run's own area 1.0; each charted neighbour 1.5 (a dead-end neighbour 1.0); a charted
  area exactly two hops away 0.15 ("wander"); the **pending** reveals of this run's boss 1.5; a pinned area (slice P1) `max(base, 0.5) x 3` at any distance (x4 with Chart Keeper); the five area-bias scarab families (below) multiply
  after pins. Sealed areas and the Pit of Echoes never appear (passages only). Undiscovered areas never appear, except as pending.
- **Tier:** the offset is rolled as before (same tier 60%, one lower 25%, one higher 15%, within 1–15), then the area is picked by weight and the tier is clamped to that area's ceiling (a T7 run at Shattered Forge can
  drop a Furnace Yard map, which arrives as Tier 5). An **upward** roll only considers areas whose ceiling accepts the higher tier (none: it becomes a level roll), so deep areas absorb high tiers.
- **Fog:** a boss kill reveals up to two neighbours (`discoverAfterBoss`); those same areas, in the same order, are *pending* and can be named only by boss-kill and completion-chest drops, never by ordinary kills or
  the lieutenant. The Surveyor's fractional extra reveal and the rare door are decided after the run and are not pending. If the boss does not die nothing pending drops.
- **Per looter:** loot is instanced, so each player's drops are filtered by their own chart (a map must be openable by whoever receives it); pins and scarabs are the opener's, frozen for the party.
- The completion chest guarantees one map: normally 75% a normal pick at the current tier, 25% an **upgrade** (Far Horizon raises it to 40%; Compass guarantees it below the cap; Tier 15 cannot upgrade). An upgrade is one tier higher
  in the **advance target**: the nearest area (walking the charted areas and the pending ones, the run's own area at distance 0; ties: a pinned area, then the lower id) whose ceiling accepts the next tier. With no such area the map is not
  upgraded and gains +3 quality instead. The optional second chest map (50%) and the boss's map drops are ordinary routing rolls. A Caravan "cartographer's tube" reward is an upward roll (no pending areas).
- A map drop uses exactly one rng draw to pick its addressee (replacing the old theme draw), so the loot stream stays aligned with the pre-routing build. Rarity mirrors equipment (normal 70 · magic 22·m · rare 1.6·m^1.3).
- **Readout:** `routingReadout(setup.routing, tier, discovered?)` returns the exact shares (own, neighbours, wander, pins; ordinary, boss/chest and upward columns) and the advance target, from the same functions the sim uses.
- **Measured (harness, first pass kept):** about 7.5 maps per run (the same with and without routing), 12–22% of them for the run's own area once the chart fills in (35–45% early, when little is charted), 55–80% for neighbours,
  5–15% further along; a bot that always runs its best available map reaches the first Tier 15 run in a mean of 22.0 runs against 20.5 before routing (+7%), and every simulated player did.
- Rook's wares board always carries one Normal quality-0 map of an open area at your current tier (Tier 1 of the starting area costs 1 Scrap), so nobody can be map-locked; deeper and better maps are luck or earned at their boss.
- **Atlas territory fee:** paid once by the map owner on activation, from inventory/stash Scrap. T1–T3 free;
  T4–T6 cost 1; T7–T9 cost 2; T10–T12 cost 3; T13–T15 cost 4. The device shows the fee before activation.
  Portal entry and restored runs do not charge it again. If a server failure makes the run unrestorable,
  its recorded fee, source map (including Bounty) and any entrance key are returned in one transaction.
  Legacy runs have no fee to refund. Ordinary deaths, abandonment and voluntary map replacement do not refund fees.

**Daily surge (slice G1; `src/game/progression/surge.ts`, constants in `src/data/progression/territory.ts`).** Every Atlas area holds **3 surge charges per account per forge day**. The forge day turns over at **04:00 UTC**
(`forgeDay(now) = floor((now - 4 h) / 24 h)`: server clock only, no time zones, no DST; the client shows a countdown, "Surges refresh in 3 h 12 m", from `welcome.serverTime` and `pong`). The ledger is `atlas.surge = { day, spent: { area: n } }` on the account's Atlas,
so every character of an account shares it and alt-hopping gains nothing; it resets lazily (a stored day before today counts as empty, a clock that steps back never grants charges), so a restart across the reset changes nothing.
- **Spending:** Activate sends `useSurge` (the Hold toggle in the area modal, on by default; off keeps the charge). The opener spends one charge of the area actually run (a key passage spends the sealed area, the Bounty passage the Pit) in the same save as the map; the expedition freezes
  `RunSetup.surge = { areaId, quantityMore: 30, rarityMore: 15, day }`, persisted and restored with the run (a restart, even across the reset, keeps the bonus it was opened with). **Guests of a party get the bonus and never spend a charge of their own.**
  With no charge left the run is simply the normal run (bit for bit; the modal says "No surge left" with the countdown): there is no hard cap anywhere.
- **Bonus:** **+30% item quantity and +15% item rarity**, "more" multipliers on the map-side luck (the luck breakdown lists "30% more Surge"; the HUD number is the number the loot rules use). **Quantity applies to every category except maps**, so the clock never changes map volume (the harness
  asserts it). Boss and chest guarantees, encounter rewards and the Hunting Ground class roll do not see the surge.
- **Refunds:** only an unrestorable server-side run returns the charge, in the same transaction as the map, key, Scrap and scarabs (and only on the same forge day). Deaths, abandons, disconnects and restarts with a restorable run refund nothing.
- **Hourglass Sand** (stack 20, tradeable) refills one area to full: open the area on the Atlas table and choose "Refill surge" in its modal (the Sand is taken from the inventory or stash); refused, spending nothing, when the area is full. Sources: a final boss on a Tier 3+ map 5% x personal rarity (doubled in sealed areas),
  the completion chest 3%, a Gold-grade encounter 10% (about 9% a run in total), all on their own rng stream so no other drop moves. **Grand Hourglass** (stack 5) refills every area ("Refill all" in the Atlas status line): Tier 9+ final bosses 0.5% x personal rarity.
  The command is `refillSurge` (protocol 22); the server holds the clock and the ledger.
- **Tree (as data):** Lantern-Bearer is now **Second Wind** (+1 charge on every area), Lamp Oil +1 charge on dead-end and sealed areas (and +3 sigil uses, see Beacons), Cartographer's Pen **Afterglow** (10% a spent charge is not consumed, rolled from the map seed; the bonus still applies), Trailmark +50% Hourglass Sand chance.
- **Tide sigils** (Beacons below) are the only beacon effect on the surge: Faint multiplies the bonus by 1.25, Bright and Blazing give every covered area +1 daily charge, Blazing also rolls its own 25% chance (beside Afterglow's, independently) that the spent charge is kept.
- **Indicators:** three brass pips under every chart node, in the area modal (header and Hold row), the pin chips, the Re-chart popover and the Map Stash's area rows (`SurgePips.tsx`), hollow and dim when spent; a map's tooltip says today's charges of its area.
- **Banner (slice F1):** a surged opening says it with the portal: "Surge: +30% item quantity, +15% item rarity. 2 of 3 charges left in Furnace Yard today." (or "Afterglow kept the charge"), first among the activation notices, with the `surgeSpend` swell; an Hourglass refill plays `surgeRefill` with the server's message.
- **Measured** (`tests/game-progression/surge-economy.test.ts`, `BALANCE=1`): a boosted run is worth +8 to +14% (mean +10%) more than a normal one in the bot's Scrap valuation, because only ordinary kill drops are boosted; a player who rotates the chart boosts nearly all of about 20 daily runs (about +10% income), a focus farmer
  three of them (about +1.5%). Sand-adjusted value is about 3 to 4% of a run for a player who spends every Sand. The levers if income needs trimming are `SURGE_BONUS` (+25% / +12%) and `SURGE_CHARGES` (2).

**Beacons and sigils (slice B1; rules `src/game/progression/territory.ts`, constants `src/data/progression/territory.ts`, UI `src/ui/atlas/BeaconPanel.tsx` and the Territory lens).** Every area the account has **completed is a beacon**, automatically.
- **Slots:** depth 0 to 4 through-route areas 1, depth 5+ 2, sealed areas 2, dead ends 1; the notable **Lightkeeper** (Cartography outer ring, beside Fifth Socket) gives every one-slot beacon a second slot (it cannot be refunded while a second slot holds a sigil).
- **Reach** in chart pixels between node centres (the 640 x 360 chart, `ATLAS_POS`): depth up to 3 120, depth 4 to 6 140, depth 7+ 160, sealed areas 100, dead ends +30; **Survey Stake** adds 20 to every beacon. An area is covered when its centre lies within the reach; the beacon's own area is always covered.
- **Sigils** (36 currency ids: 12 kinds x Faint/Bright/Blazing, stack 20, tradeable) are slotted on the Atlas table in a hideout, **dragged from the inventory into a beacon slot of the area's modal** (Ctrl/Cmd-click fills the first empty slot; stashed sigils move to the inventory first). A slotted sigil has 12 uses (Blazing 10; **Lamp Oil** +3). Every map opened in a covered area spends one use of every covering sigil **whose effect applied** to that run; at 0 the slot empties (the opener's activation message says so). Taking a sigil out returns it only if it was never used; a used one is consumed (the modal asks first, also when another sigil is dropped onto it).
- **Kinds** (I / II / III): **Omen** +4 / +6 / +9 percentage points encounter chance (after the area odds and the tree, outside the tree's cap, never past the 65% encounter cap); **Hoard** +9 / +14 / +20% increased item quantity in dead-end and sealed areas; **Fortune** +8 / +12 / +18% increased item rarity; **Ingredient** 20 / 35 / 50% more boss ingredient chances; **Survey** +25 / +40 / +60% chance for the boss kill to reveal one more neighbour (added to Master Surveyor's fraction); **Tide** (see Daily surge); and six **theme sigils** (Ashen, Chapel, Crypt, Ossuary, Chainworks, Coliseum) that on their theme's maps give 25 / 45 / 70% more weight to the theme's signature currency (Ember Essence, Binding Seal, Solvent, Rime Essence, Forge Scrap, Fracture Core) and +1 weight to each item class the area favours.
- **Stacking:** several sigils of one kind covering a run: the strongest works at 100%, every other at 50%; different kinds add. Each appears in the readout as `Territory: <sigil> (<beacon>)`.
- **Frozen:** the opener's applied sigils are frozen into `RunSetup.territory` (sigil, beacon, slot, share), persisted and restored with the run; guests share the effects and spend nothing. An unrestorable server-side run returns the uses it spent with its map, key, Scrap, scarabs and surge charge.
- **Sources:** a final boss on a Tier 3+ map drops a sigil 10% x personal rarity (doubled in sealed areas, own rng stream): 60% one of the six generic kinds, 40% the boss theme's; Tier 3 to 7 Faint, Tier 8 to 11 Faint or Bright (100 : 30), Tier 12+ Faint, Bright or Blazing (100 : 30 : 8). **Rook** sells Faint sigils: the six generic kinds for 14 Scrap and the theme sigil of every theme you have cleared an area of for 18 (Maps shelf).
- **Commands** (protocol 27): `slotSigil { areaId, slot, uid }` and `unslotSigil { areaId, slot }`, hideout only, atomic (the sigil and the account's `atlas.beacons` change in one save).

**Scarabs (four optional Map Device sockets beside the map).** Each socket takes one scarab, split from its
backpack or shared Crafting Stash stack (maximum stack 20). Move the scarab from the Crafting Stash into the inventory first, then drag it from the inventory into a socket of the
Atlas table (which opens beside the inventory; Ctrl/Cmd-click fills the first free socket); remove before activation to recover it. Successful activation consumes the map and all loaded scarabs once.
Failed activation consumes nothing. The expedition records its scarabs for party play and restarts; guests'
scarabs do not stack. An unrestorable server-side expedition refunds its scarabs with its map, key and fee.

| Scarab tier | Name prefix | Minimum monster level | Relative drop weight | Haste | Invasion |
|---|---|---|---|---|---|
| 1 | Weathered | 4 | 100 | 15% less wave duration | Start at wave 2 |
| 2 | Etched | 22 | 30 | 25% less wave duration | Start at wave 3 |
| 3 | Gilded | 46 | 8 | 35% less wave duration | Start at wave 4 |
| 4 | Exalted | 70 | 2 | 50% less wave duration | Start at wave 5 |

Only one scarab of each type is allowed per map, regardless of tier: seven types today (Haste, Invasion and the five area-bias families below).
The four sockets take one of each type. An Exalted Haste Scarab makes 60-second waves last 30 seconds. The normal 3-second tell,
attack timing and monster budgets are retained. An Invasion Scarab starts on the
specified wave with **all** monsters from waves 1 through that wave already spawned, including their streaming
budgets, with each original wave's stats, rarity and rewards. It skips no monsters or loot. Normal waves continue
afterward; the final boss and any Echo wave remain. Encounters due in earlier waves can still trigger.

Scarabs have an independent 0.05% base roll per eligible monster kill, scaled by personal item quantity and
magic/rare quantity multipliers, capped at 100%. No guaranteed boss/chest scarab; summoned monsters and the dummy
cannot drop them. Every family shares the listed tier weights; the five area-bias families together take **40%** of scarab rolls (an equal split among them), Haste and Invasion the other 60%. Eligibility uses monster level; every unlocked
lower tier remains in the pool at high levels. Item rarity does not improve scarab tier. Ordinary maps retain
their 60-second baseline and start on wave 1. Exact combined timing and starting wave appear before activation.

**Area-bias scarabs (slice S1; five families of four tiers, same names, levels and weights as above; `src/data/scarabs.ts`, rules in `src/game/progression/scarab-routing.ts`).** They bend only the frozen drop-routing table of the expedition (which Atlas area its dropped maps are bound to), never how many maps drop, and never the waves. A scarab multiplies the candidates it names; pins multiply independently and the scarab comes after them (Homing IV with the own area pinned is x18).

| Family | Effect on the table | Tier I / II / III / IV |
|---|---|---|
| Homing | the run's own area x | 2 / 3 / 4 / 6 |
| Wayfarer | every charted neighbour that is not a dead end x | 1.5 / 2 / 2.5 / 3 |
| Deepward | the share of dropped maps that are one tier higher (15% normally) becomes, and the completion chest upgrade gains | 20 / 28 / 36 / 45% and +5 / +8 / +11 / +15 points |
| Quarry | every dead-end area in the table (a neighbour or two hops away) x | 2 / 3 / 4 / 6 |
| Hearthbound | every charted area of the map's theme at any distance (a base of at least 0.5) x | 1.5 / 2 / 3 / 4 |

Homing never turns a map into an own-area-only machine: the own area's share of the table is capped at 70% unless the player pinned it (a dead end with one neighbour would reach 77% with Homing IV by the multiplier alone; charts with real neighbours stay at 53 to 67%). The Device readout lists each loaded scarab ("Scarab: Etched Homing Scarab: own area x3").

**Atlas tree, "the Codex" (account-wide).** Open it from the Map Device. It is a wheel of 146 nodes around one origin (the Cinder Crossing brazier): six branches (Cartography, Foundry, Bounty, Fortune, Echoes, Peril), eighteen bridge nodes, five tier-bonus nodes in the inner ring and six theme seals on the outer belt. Every node changes map rules only: no node touches character stats, map tier or monster level, and none grants a temporary power-up. The full node list with every number is in `docs/atlas-rework/tree-nodes.md` (generated from `src/data/progression/map-tree.ts`; `tests/game-progression/spec-sync.test.ts` keeps it in step).

| Class | Count | Cost | Refund (Scrap) | Job |
|---|---|---|---|---|
| Small | 85 (incl. 18 bridge and 6 belt nodes) | 1 | 5 | one plain number, at most one small scar; forms the paths |
| Notable | 22 branch notables plus 12 encounter lenses | 1 | 15 | one idea, often a behaviour |
| Tier bonus | 5 | 1 | 15 | effect scales with the tier of the opened map |
| Theme seal | 6 | 1 | 15 | effects only on maps of one base (theme) |
| Keystone | 14 | 2 | 40 | a rule that changes how a run plays, with a real downside |

Allocation needs a path: a node must touch the origin or an allocated node, and a node can be refunded only while the rest stays connected to the origin (refund the outer nodes first). Four hard exclusion pairs: Wagered Charts and Dead-End Devotee, Empty Halls and Overrun Doctrine, Kingslayer's Tithe and Blank Slate, Twin Omens and Sworn to the Veil. A finished 60-point build ends with two or three keystones. The encounter engine is live: the six lenses of the encounters that exist (Stalker, Echoing, Caravan, Rival Crowns, Fault, Ember Relay), the three encounter smalls, Twin Omens and Sworn to the Veil are allocatable, and their rules reach the Event Director through the frozen expedition (`map-event-rules.ts`). A node whose engine is not live yet (the six lenses of encounters not built yet, Voidtouched Atlas, the sim nodes Warded Hunts and Stragglers' Cull, the Map Device nodes Lantern-Bearer, Fifth Socket, Twinned Sockets and Single-Minded Furnace, and the item node Wagered Charts) is fully specified but cannot be allocated: it shows "Awaits ..." instead of a price.

**Atlas points (60, all first-time, account-wide).** 25 for the first credited clear of each Atlas area, 14 for the first clear of each map tier 2 to 15 (any area), 12 for the first completion of each of the twelve encounter kinds, 6 for the first kill of each of the six final bosses (Cinder Matriarch, Hollow Warden, Varkus, Ashbound Herald, Bone Chorister, Chainmaster) and 3 for charting 50%, 75% and 100% of the areas (13, 19 and 25). Points are a pure function of the account's Atlas progress (`atlas.completed`, `tiersCleared`, `eventsSeen`, `bossesSeen`), credited through the same per-run receipt as discovery (the receipt remembers the cleared tier), so a restart or failed save can neither lose nor double one. Repeated clears earn nothing. Points are independent of attributes and skills.

**Respec.** Only in your own hideout. A refund pays by class (small 5, notable, tier bonus and theme seal 15, keystone 40 Forge Scrap) from backpack, normal stash or Crafting Stash, excluding trade offers; the currency payment and the account allocation commit atomically. The first 6 refunds an account ever makes are free. One respec session never costs more than 120 Scrap (the counter resets when a map is opened). The old 15-node tree was replaced: an account saved with it has its allocation refunded free, once, and keeps every point earned (the Codex notice); the tree edition is stored as `atlas.treeVersion`, and `SAVE_VERSION` is unchanged.

The opener's selected nodes are copied into the expedition at activation and resolved into one frozen rules object per map (`resolveAtlasRules`). They affect the whole party's map rules, with each player still adding their own gear luck. Guest trees do not stack. Respec, switching characters or a restart cannot change an existing expedition's selections; a run frozen before the redraw keeps its old numbers through legacy ids. Map Device readouts and personal luck breakdowns list every tree source as "Atlas: <node>". The map item itself remains unchanged and tradeable maps carry no account bonuses.

**Value ledger and caps.** One unit (u) of reward is about +3% item quantity, +4% item rarity, +10% magic/rare pack chance, +8% map or essence weight, +12% scarab chance, +1.5 percentage points of encounter chance or 6% boss unique chance; one unit of danger is about +6.5% monster life (2.5% as "more"), +3.5% monster damage (2.2% more), +5% monster count, +4% speed or -4.4 player resistance. A small node nets about 1u, a notable about 3.5u, a keystone about 6u for its intended build, a tier bonus 1u at Tier 3 to 4.5u at Tier 15. The tree alone is capped at: +45% increased item quantity, +60% rarity, +100% pack chance, +80% map drop chance, +60% increased essence weight (and one "more" essence source), +12 percentage points encounter chance, +13 percentage points chest upgrade chance (10 base plus 3 from Ladder's Reward), x1.6 total "more" monster life; wave duration never drops below 25 seconds whatever Haste, Twinned Sockets and Overrun Doctrine add. Tooltips mark a capped source "(capped)". Only one "more" per reward category per branch.

**Keystones.**

| Keystone | Branch | Upside | Downside | Excludes | Status |
|---|---|---|---|---|---|
| **Wagered Charts** | Cartography | From Tier 4 completion chests always upgrade your map one tier | the chest map is a Rare with 3 danger mods, 0 quality and is account-bound; dropped maps cannot roll above your tier | Dead-End Devotee | awaits map crafting |
| **Twinned Sockets** | Cartography | two scarabs of one family (the second at 50%) | monsters 6% more Life per loaded scarab | none | awaits Map Device |
| **Dead-End Devotee** | Cartography | dead-end and sealed areas: 24% more quantity, 30% more boss ingredient chances | through-route areas 25% less quantity; bosses reveal one neighbour, not two | Wagered Charts | active |
| **Single-Minded Furnace** | Foundry | one Essence family x4 (attuned at the device) | other Essences 75% less, Scrap 30% less | none | awaits Map Device |
| **Blank Slate** | Foundry | all equipment drops Normal with +2 maximum Stability and 45% more equipment drops | Item Rarity no longer affects equipment; no Magic or Rare equipment (chest too) | Kingslayer's Tithe | active |
| **Rare or Nothing** | Bounty | no magic packs, rare pack chance 2.2 times as high, rare monsters drop 60% more quantity | about half the horde's loot is gone; more rare walls | none | active |
| **Empty Halls** | Bounty | 50% fewer monsters, each 80% more quantity | monsters 60% more Life and 35% more damage | Overrun Doctrine | active |
| **Kingslayer's Tithe** | Fortune | boss and chest loot doubled, boss unique chances doubled | final bosses 40% more Life; ordinary monsters drop 15% less | Blank Slate | active |
| **Early Crown** | Fortune | the final boss arrives on wave 3 | the map has 12% more monsters | none | active |
| **Twin Omens** | Echoes | a second encounter slot | encounter rewards 25% smaller (the Backlash pack on failure is not built yet) | Sworn to the Veil | active |
| **Sworn to the Veil** | Echoes | every map has an encounter, rewards 30% higher | encounters become mandatory (90 s soft timeout) | Twin Omens | active |
| **Thrill of the Hex** | Peril | danger mods 40% stronger on both sides, 12% more quantity and rarity | more ways to die (the fifth danger mod awaits the crafting bench) | none | active |
| **Overrun Doctrine** | Peril | waves 30% shorter, 30% increased quantity | monsters 6% faster; waves overlap more | Empty Halls | active |
| **Voidtouched Atlas** | Peril | corrupted mods 50% stronger on both sides; corrupted maps roll a Void Breach | uncorrupted maps 10% less quantity | none | awaits encounters |

Other numbers are pinned by data: Far Horizon (+10 percentage points chest upgrade, 25% to 35%), Crowned Challenge (final bosses 25% more Life, world/exclusive unique chances 50% more, capped at 100% after personal rarity: it multiplies the boss's own 8% and exclusive 12% rolls, not ordinary equipment, guaranteed Reliquary uniques or chest/gamble rewards), Sound Foundations (+1 maximum Stability on armour), Deep Seams (40% more Essence weight, monsters 5% more Life), Kingmaker's Cache (each completion chest equipment is Rare 30% of the time), Deep Pockets (one more chest currency roll), Master Surveyor (35% chance of one more revealed neighbour), Ledgerline (territory fee 1 Scrap lower, never below 0). Essence and currency bonuses reweight ordinary currency tables, never add drops or change special ingredient and key sources. Encounter bonuses add to the total after the area's normal odds and cap (at most +12 percentage points from the tree), preserving relative event weights; Bounty and fixed chains are unchanged. Tier bonus nodes multiply their per-tier value by the opened map's tier.

**Atlas (account-wide).** The Map Device opens a map at the area it is bound to (or a passage destination). The item supplies
tier, quality, mods and corruption; the area supplies the theme, arena and implicit, plus weights for
specific currencies and equipment classes. The original item is preserved for a server-fault refund.
The Atlas shows area names/types/rewards only after discovery. It starts at Cinder Crossing; each final boss
reveals two unexplored neighbours in a fixed order. Repeating an area can reveal any remaining neighbours.
Every party member present at the kill receives credit (including a dead player); the owner receives no
extra credit from the hideout. Two characters on one account earn one discovery. A receipt stored with the
open run prevents a restart or repeated boss outcome from awarding the same account again. Pending awards
also have a durable queue: closing/replacing a map or restarting during a failed account save cannot lose
earned discovery. Applying progress and deleting its pending receipt are one transaction.

| Depth | Areas | Highest map tier |
|---|---|---|
| 0 | Cinder Crossing | 1 |
| 1 | Ember Road, Bone Approach | 3 |
| 2 | Furnace Yard, Glass Sepulchre, Iron March | 5 |
| 2, side route | Ember Vault (dead end from Ember Road) | 3 |
| 3 | Shattered Forge, Champion's Approach | 7 |
| 4 | Crown Foundry, Winter Throne (two approaches each) | 9 |
| 5 | Ember Citadel, Frozen Passage | 11 |
| 6 | The Last Kiln, Echo Bastion | 13 |
| 7 | Heart of the Forge, Eternal Arena | 15 |
| 3, rare destination | Sealed Reliquary | 7 |

**Atlas feedback (slice F1, brief A 5.4 and 5.5, brief D 7.6).** The table speaks with its own procedural sounds (`src/audio/sfx.ts`,
ids appended to `SFX_IDS`): `atlasOpen` (a slate scrape and a low bell when the Map Device opens; it replaces the generic panel sound),
`atlasHover` (a soft tick on a known plate), `atlasSelect` (a stone chime a fifth apart), `atlasZoom` (a paper slide), `atlasPin` /
`atlasUnpin`, and during the discovery cinematic `atlasRoute` (the ember crackling down the road) and `atlasReveal` (a rising three-note
bell ladder whose last note lands on the forged plate). A key passage that opens turns `atlasSeal`. **Banners** are the game's toasts:
the server's "Atlas revealed: ..." after a boss (now with `atlasReveal` the moment the account's chart grows), a pin ("Pinned Ember Road:
its maps drop x3 as often (1 of 3 pins).", unpinning is silent besides its tick) and the surge line of the activation message.
**Motion:** the Atlas "Motion" switch (system / calm / full, per viewer, shared by the chart, the Codex, the guide and the command deck)
is the game's reduced-motion setting. On "system" it calms when the OS asks for reduced motion **or the game's Screen shake slider is at
0**; calm stops parallax, embers, plume sway, pulses, the burst on activation, the table's and modal's entrances and the slots' pulsing
invitations (the discovery cinematic becomes a 0.2 s cross-fade that still rings `atlasReveal` once). An explicit "full" is honoured.
**Telemetry:** the server counts Atlas use in memory (`src/server/territory-counts.ts`: areas revealed, pins set and removed, surge charges
spent or kept by Afterglow, Hourglass Sand and Grand Hourglass used, sigils slotted and taken out) and adds the non-zero counts since
the last line as `atlas` to its periodic `status` log, then resets them. No identities, nothing stored, nothing sent anywhere else.

The 25-area graph has reciprocal ordinary routes; each Tier 10+ main destination remains reachable after
any one other non-start area is removed. The map scrolls in both directions and centres the inspected area.
A map bound to an area accepts any tier up to that area's ceiling (low-tier maps of deep areas included); the Pit of
Echoes is reached only through a Bounty passage. Forged areas
favour caster bases; crypts favour jewellery; arenas favour armour and Fracture Cores. These change weights
within the loot tables. Hollow Ossuary separately grants 30% more item quantity, including personal gear;
Gilded Vault triples ordinary currency chances and boss/chest/carrier currency guarantees. Other categories
and special ingredients are not tripled. The Atlas displays the exact weight multipliers and the
theme's implicit. Ember Vault specialises in Ember Essences, Binding Seals and Reliquary Keys.

An ordinary area's boss (or Shrine Field completion) has a 1-in-8 chance to reveal the next undiscovered
sealed destination in a fixed order. None unlock a tier route. Each expedition consumes its named key
from the backpack, normal stash or Crafting Stash, atomically with the map. Keys are tradeable, stack to 20
and do not expire. Boss Reliquary Key drop
chances are 25% in Ember Vault at any tier; at Tier 3+, 8% in crypts and 2% elsewhere. The Reliquary does not
drop keys. Each new key below has a separate 0.5% chance from other ordinary Atlas bosses at Tier 8+.
Specialty chances replace that global chance. Sealed bosses do not drop entrance keys.

| Side destination | Entry / ceiling | Encounter and reward |
|---|---|---|
| Hollow Ossuary | Glass Sepulchre dead end / T5 | 2× ring and amulet weights; 30% more item quantity |
| Pit of Echoes | Iron March dead end; Bounty map / T5 | Bounty hunter, boss with 50% more life and 25% more damage, guaranteed seventh Echo wave with double kill quantity |
| Shrine Field | Heart of the Forge dead end / T15 | No final boss; clear the normal waves for Atlas credit and the chest. Ordinary encounter odds ×3, capped at 100%; no Rival Crowns roll. An item's Echo wave is retained |
| Sealed Reliquary | Reliquary Key / T7 | Rival Crowns; the last boss gives one extra Unique (Rare at T1) and one Crown Fragment at every tier |
| Gilded Vault | Gilded Key / T9 | One Laden Caravan with a double escort; triple ordinary currency; the Coffer lock has a 20% Twin Ink chance at every tier |
| Black Pit | Black Key / T11 | Ember Relay followed by The Fault; The Fault always pays Twin Ink and a Void Splinter at every tier |
| Hunting Ground | Hunting Key / T11 | Three successive Stalkers; each guarantees (Bronze or better) a Rare base of the owner's chosen equipment class for every living player |
| Rift Nexus | Rift Key / T13 | Three successive Echoings; each gives one event ingredient (Echo Shard / Twin Ink / Void Splinter, equal odds), plus its ordinary rewards |

Gilded Keys drop from vault bosses at T3+ (12%); Black Keys from forge bosses at T3+ (8%); Hunting Keys from
arena bosses at T3+ (8%); Rift Keys from crypt bosses at T5+ (6%). Every new key has separate art, a Crafting
Stash slot and a source tooltip. Hunting Ground's class selector offers only classes with eligible bases at
the map's item level. The choice is fixed at creation for the whole party and survives restart.

Guaranteed area encounters form a fixed sequence. Required events remain available after the boss
and both map completion and Atlas credit wait until the sequence resolves; an escaped wagon counts as resolved (only locks
already broken have paid). Bounty still guarantees a hunter: it precedes the area's sequence when no hunter is
already included. Sequences, key receipts and the original source item survive restart; no event plan is
sent in the client setup. Existing open maps keep their original event plan.

The rules retain legacy map setups across a restart. A run that cannot be restored refunds its original
map and entrance key together; discovery and its per-run receipt are also one transaction.

**Map events (Event Director v2).** At creation a map privately draws a slate of 0 to 2 encounters (3 with Twin Omens):
a 45% base chance for at least one, then a 30% chance of a second, concurrent one of a different kind in a different
wave (a third is 15%). Bounty maps guarantee The Stalker; sealed areas use the fixed sequences above instead, and their
encounters are required. The base 45% is divided equally among the eligible encounters; combined odds cap at 65%
while preserving proportions. The server omits the plan from the client's setup; the Map Device shows exact odds, not
the roll. Ids are stable (`hunted`, `echoRift`, `blackout`, `vaultbreakers`, `secondCrown`, `wound`, then the wave-2 events
`pactAltar`, `orchard`, `ring`, `host`, `anvil`, `bellwatch` and `voidBreach`: new ids are only ever appended); the
player-facing names are below. Every event has three roster skins (Ashen: Forge and Chapel; Ossuary: Ossuary and Crypt; Coliseum:
Coliseum and Chainworks).

| Id | Name | From | Window (wave) | Play | Grade measure |
|---|---|---|---|---|---|
| hunted | The Stalker | T1 | 2 to 4 | a shimmering rare circles the party and pounces on the straggler | whiffs (0 Bronze, 1-2 Silver, 3+ Gold) |
| echoRift | The Echoing | T2 | 2 to 4 | the kill log returns as Echoes walking home to an anchor | echoes intercepted (50 / 75 / 100%) |
| vaultbreakers | Laden Caravan | T3 | 2 to 4 | a wagon crosses the arena; break its three locks | locks broken (1 / 2 / 3) |
| wound | The Fault | T3 | 3 to 5 | four wedges erupt; lure monsters into the marked one | seal time (Ashen and Coliseum <= 45 s / <= 27 s, Ossuary <= 50 s / <= 30 s) |
| blackout | Ember Relay | T3 | 2 to 4 | carry an Ember to three dark braziers | braziers lit, Embers lost and the pace (Gold: three lit, none lost, <= 56 s) |
| secondCrown | Rival Crowns | T5 | boss wave | a rival boss of another roster joins the boss fight | fight time from the rival's arrival (<= 100 s / <= 52 s; x1.3 Ossuary, x1.5 Coliseum) |
| pactAltar | Pact Altar | T4 | 2 to 4 | choose a pact for the next wave, twice | pacts kept (1 / 2 / 2 with no death and at most one wave run past its tell) |
| orchard | Ashseed Orchard | T2 | 2 to 4 | grow and harvest three blooms while the horde gnaws them | harvested stages (3 / 6 / 9) |
| ring | Champion's Ring | T4 | 3 to 5 | name a vow, then duel a Champion behind chains | kill time (<= 52 s / <= 38 s) |
| host | Stasis Host | T6 | 3 to 5 | a frozen legion thaws; shatter the prism or let it wake in streams | time to the last statue (<= 90 s / <= 31 s; x1.15 Ossuary, x1.35 Coliseum) |
| anvil | Wayside Anvil | T3 | 2 to 4 | fight around an anvil, then forge a boon for the completion chest | charge time (<= 90 s / <= 54 s) |
| bellwatch | Bellwatch | T5 | 3 to 5 | silence four cantors before the bell tolls the arena to a frenzy | cantors cut down before toll 4 (2 / 3 / 4) |
| voidBreach | Void Breach | T6, or forced | 3 to 4 | the arena shrinks under a void tide; seal the breach | seal time (<= 86 s / <= 61.5 s; x0.93 Ossuary, x0.85 Coliseum) |

**Where events happen (anchors).** In a hand-crafted area the Event Director places each event on one of the layout's
declared anchors of its kind (the Stalker on a perch with cover between it and the landing, the Echoing on an echo anchor,
the Caravan along the area's road, the Fault on its fault line with the first crack along it, the Ember Relay on the
area's three relay braziers, Pact Altar, Orchard plots, Champion's Ring, Stasis Host, Wayside Anvil and Bellwatch on
their own anchors, Rival Crowns on a second boss stage when the area has one). Which anchor is picked with the run seed,
so the same area always uses the same handful of sites. An anchor must keep the event's usual distance from every player
and fit its footprint inside the arena (one up to 100 units over the rim slides inward); when none qualifies, or an
anchor's tier window excludes the map, the event falls back to the old radial placement. The Void Breach stays central.

Area bonuses are kept and extended: forge adds +5 Stalker and +5 Ember Relay (+3 Fault, +4 Wayside Anvil), arena +10 Stalker and
+5 Rival Crowns (+5 Champion's Ring), crypt +10 The Echoing and +5 Fault (+3 Stasis Host, +5 Bellwatch), vault +5 The Echoing and
+10 Laden Caravan (+5 Pact Altar), frontier +6 Ashseed Orchard; Commanded adds +8 Stalker, Restless +5 Stalker,
Teeming +5 The Echoing and Echoing +10 The Echoing. Events **overlay** the waves: nothing pauses the wave clock, the
stream or the wave tell (only a boss-time event may hold the next wave *tell*, never a spawn, for at most 8 s). At most
three events are live at once, and no two begin their onset within 8 s of each other.

**Grades.** Every event pays Bronze, Silver or Gold from a measurable on-screen quantity (thresholds are shown on the
HUD card); failing loses upside, never progress. Bronze is the classic payout of the encounter. Rewards go to every
living player through `RunHooks.rollEventReward(ctx, playerIds, rng)` (grade 0..3, choice, tally, position); the rules
answer with `rollEventReward(setup, ctx, rng, looter)`. Kill-attached rewards no longer exist. The tree may shift a grade
(`gradeShift`), add ingredient chance, or scale rewards (Twin Omens: x0.75, Sworn to the Veil: x1.3).

| Event | Bronze | Silver | Gold |
|---|---|---|---|
| The Stalker | one Rare base (chosen class in the Hunting Ground) | + one currency from the map's table | two Rare bases, 25% Compass, T5+ 5% unique-eligible roll |
| The Echoing | Reforging Ember + Map Dust (+50% Echo Shard on T3+) | + one Echo Shard | + another Echo Shard and one Rare base; an erupted rift pays Bronze only if its Warden dies |
| Laden Caravan | (each lock pays at once) Coffer: three currency rolls, 20% Twin Ink on T3+; Reliquary: one equipment roll (magic or better); Cartographer's Tube: one map a tier higher | 2 locks | 3 locks: + 50% Twin Ink and a Compass |
| The Fault | one Void Splinter (T3+; Black Pit also Twin Ink) | + Solvent or Catalyst | + a second Void Splinter and one Rare base |
| Ember Relay | one Binding Seal and 4-6 Scrap | + 10% Suffix Rune | + 15% Fracture Core |
| Rival Crowns | one Crown Fragment (T5+ or the Sealed Reliquary) | + a second Fragment | + one unique-eligible equipment roll |
| Pact Altar | Scrap x3-5 (and 5 Scrap at once for declining with Ember Tax) | + one currency from the map's table | + one Binding Seal |
| Ashseed Orchard | (each harvest pays at the bloom: stage 1 Scrap; stage 2 a currency of its kind; stage 3 two of it, often a rune or core) plus 1-2 Scrap | + one currency from the map's table | + one Void Splinter |
| Champion's Ring | one Rare armour base; the vow adds an extra roll (Bare Hands 50%, Iron Pride and Crowd's Favour 30%) and a currency; 10% Fracture Core | + a currency roll, Fracture Core 20% | + 5% unique-eligible roll |
| Stasis Host | (every statue drops its own loot with +60% quantity) 3-5 Scrap and a currency roll; a shattered prism adds a Rare ring or amulet base and a 35% Prefix or Suffix Rune | + Solvent or Catalyst (and a second currency if shattered) | + a Rare base and 25% Void Splinter |
| Wayside Anvil | Scrap 3-5 and one boon on the completion chest | + a weighted currency roll | + a second boon and another currency roll (charged within 54 s) |
| Bellwatch | (each Cantor pays a currency roll the moment it falls) two Cantors | three Cantors (or all four late): + 35% Prefix Rune | all four before toll 4: + 60% Prefix Rune and a Rare amulet or ring |
| Void Breach | one Void Splinter and 3-5 Scrap | + 40% Twin Ink and one currency | + a second Void Splinter, one Rare base and 15% Fracture Core (seal <= 61.5 s from the opening); ignored or unfinished: 25% Void Splinter |

- **The Stalker:** a three-second omen (amber eye at the rim, at least 320 units from every player), then a rare of the
  roster's hunter role (Cinder Prowler / Hollow Wolf / Alpha Hound), Swift and Fierce, shimmering but always targetable. It
  orbits the party at 260 to 340 units and every 9 s (7 s with 2 Hunt stacks) marks the **straggler** (the living player
  furthest from the others, ties by id) with a shadow disc (radius 34, 1.2 s) that tracks until 0.4 s remain, then locks;
  the Stalker leaps 0.25 s and deals damage only on landing. A prop in the flight line takes the leap. It never pounces on a
  held (rooted, frozen or dragged) player and never has two discs out. A landing on a player is a **hit**: a Hunt stack
  (+12% damage and speed, up to 3), 10% healing and the roster's rider (fire pool 3 s / chill / bleed). A landing on empty ground is a
  **whiff**: 4 s Exposed (+40% damage taken), 2.5 s winded; into a pillar it is stunned 3 s. At 3 stacks it frenzies
  (pounces every 4 s). Each whiff counts toward the trophy (Hunter's Patience doubles them, each danger mod adds 1). Its life is 16
  times a rare's of the same kind: a matched build needs 20 to 40 s for the hunt, long enough for three pounces. Left alive for 120 s or into the boss
  wave it turns rogue (pounces every 5 s, pays nothing).
- **The Echoing:** an optional violet anchor (at least 250 units from every player and 200 from the rim); walking within 70
  units wakes it after a three-second warning. The sim keeps a log of the last 24 notable kills (a pack's last member, every
  magic or rare); the rift replays up to 12 of them, oldest first, every 1.6 s, as Echoes at the death spots (a 1 s
  ground mark first; Ashen also lights a fire pool), 2.5 times a normal monster's life, the rare's mods, no loot. Echoes walk
  home at 80 u/s and fight any player within 110 units. Each that arrives adds Resonance; 6 erupt the rift (5 s, radius 150 nova)
  and a Rift Warden rare (3x life) appears. Ossuary echoes pass through monsters; Coliseum echoes come in chained pairs (killing one
  slows the other). A log shorter than 6 is padded with ordinary family members. **Guard or roam:** an echo cut off on the way
  counts whole toward the trophy, one caught at the door (within 150 units of the anchor) counts 80%; Bronze, Silver and Gold
  are 50, 75 and 95% of the log. A hum at the anchor rises with every Resonance.
- **The Fault:** an optional crack (at least 300 units from every player); walking within 70 units opens a field of
  radius 240 in four numbered wedges. Four pulses (every 8 s, sooner once cleared) of 6 Swift magic guardians appear on the cracks
  between wedges (a 1 s shimmer first); the fourth adds the Fault-born rare. 2 s after each pulse a wedge (the most
  occupied, with the next two always shown) telegraphs 1.8 s and erupts: players take a hit, monsters 30% of their life
  (15% rares, no bosses); cinders (Ashen), rime (Ossuary) or spikes with a bleed (Coliseum) remain. It never starts while a player is held. Guardians
  are never shield-bearers. Seal time Gold <= 27 s (Ossuary 30 s), Silver <= 45 s (Ossuary 50 s). Past 75 s the field overflows (an
  extra eruption and 4 monsters every 10 s; Bronze at best).
- **Ember Relay:** three cold braziers at least 300 units apart; a rare Wickbearer drops the Ember, which a player
  carries to a dark brazier and lights by standing there 2 s. The wick burns 30 s (each hit taken costs 2 s); a lost Ember
  brings a new Wickbearer, three lost end the event. The carrier moves 12% slower (on the wire, so the client predicts it). The
  dark hunts the flame: monsters near the carrier that stand outside lit ground run faster. The floor dims; actors and telegraphs
  stay lit; each brazier has a thin beacon of light above it. Gold needs all three lit, no Ember lost and the last one lit within
  56 s of the onset (the card shows the pace); the same clean run that is slower, or one lost Ember, is Silver.
- **Laden Caravan:** a gold-chevron road, a wagon at 22 u/s under 8 escorts (16 in the Gilded Vault), invulnerable except through
  three locks, and a telegraphed trample lane 250 units ahead (light damage, at least 1.5 s warning) that also knocks whoever it
  catches 60 units sideways out of the lane. **Shield line:** each lock is guarded by an escort group (left column guards the
  Coffer or Crucible, right column the Reliquary, the rear guard the Tube); a lock is invulnerable (shield ring) while more than one
  of its group lives, so cutting down the escorts on its side opens it (a chime and "Shield down"). Lock life is measured in
  bruisers (18, whatever the roster's bruiser is; a Chapel or Chainworks map uses a hunter as the unit). **Wheels:** two
  destructible wheel hardpoints ride the rear axle (4 bruisers of life each); every wheel broken slows the wagon 30% (two: 49%
  speed), which lengthens the window at the price of damage not spent on locks; a wheel pays nothing and does not count toward the
  grade. Reinforcements (4) drop from the rim at 45% of the route and join the group of the nearest lock. The wagon leaves at the
  far rim and takes unbroken locks with it. Ashen: a broken crucible spills a fire pool (harmless for its first second);
  Ossuary: breaking the Reliquary lock releases a magic Rimeshade on the spot (after a 1 s shimmer).
- **Rival Crowns:** the map's boss arrives as today; 20 s later a 3 s shimmer at the far rim (at least 350 units from every
  player) announces the rival: the boss of another roster with 60% life and 80% damage, its phase-1 kit only. Whoever falls
  first, the survivor heals 20% and is empowered (glow, +30% damage and speed). Killing the first boss during the wait cannot skip
  the rival, and only the last death grants Atlas credit. **Feud:** while both bosses live, every 0.5 s each minion of one
  roster within 70 units of a minion of the other trades 60% of its damage with its nearest foe (uncredited: no loot or XP; never
  the boss bodies). **Telegraph budget:** at most two large (radius above 60) boss telegraphs at once; while two are up the
  rival's next cast waits (at most 3 s per cast), the first boss's never does; the rival's timers start 1.5 s behind. **Exclusive
  uniques:** each boss rolls the 12% exclusive unique of its own theme (Crown Rivalry x1.5) on top of its ordinary loot. Both
  bosses enrage after 240 s of the rival's fight (+2% damage every 10 s). The rival has its own health bar under the first; the
  empowered survivor's crown flares. Gold is 52 s or less, Silver 100 s or less (x1.3 when the map is Ossuary, x1.5 Coliseum: a fair bot
  fights the pair in about 40 to 140 s; Gold about one run in three).
- **Pact Altar:** from T4, waves 2 to 4. An altar at least 250 units from every player with a stone for each bargain: two distinct
  bold pacts drawn from the event stream and always **Ember Tax** (decline: 5 Scrap at once, no pact); the Pact Broker lens adds a
  fourth, always-hard stone. Standing on a stone for 1 s chooses it; the most-occupied stone wins when several are ready. The pact
  chosen during wave n shapes wave n+1 through the wave-plan seam (chosen before the wave n+1 tell, or the round expires); a second
  round opens when n+1 starts and shapes n+2 (never the boss wave), and is 35% stronger when round one was bold. Pacts: **Swarm**
  (+70% monsters, +60% item quantity), **Blood Moon** (every pack magic or better, +15% monsters, +25% life, +70% quantity),
  **Ironhide** (+120% monster life, +50% rarity), **Ambush** (the packs arrive together on a ring round the party already hunting,
  stragglers cut by 60%, +25% monsters, +20% life, +40% quantity), **Cinder Curse** (all resistances -20 points for the wave, +20%
  monsters and life, +35% rarity). Bonuses apply to the kills of that wave's monsters (every
  living player's own luck). Grade = bold pacts whose wave ended: 1 Bronze, 2 Silver, both with no player death and at most one pact wave still running when the next is announced Gold;
  two declines fail quietly. Stones are anvils (Ashen), bone plinths (Ossuary) or iron gongs (Coliseum).
- **Ashseed Orchard:** from T2, waves 2 to 4. Three bloom fixtures 250 to 450 units apart (Essence, Seal and Metal bloom: cinder-blooms,
  bone-lilies, tar-sprouts) burst out at least 250 units from every player and ripen to stage 1, 2 and 3 at 15, 35 and 60 s (Green
  Thumb ripens faster). Standing within 32 units of a bloom of stage 1 or more for 1.5 s harvests it and pays at once by kind and stage
  (stage 1 Scrap, stage 2 one currency of its kind, stage 3 two plus a rune or core chance). A bloom is a hittable, inert body with about
  four bruisers' life; any monster within 220 units of a bloom and more than 140 units from every player turns on the weakest bloom
  and gnaws it (a share of its own damage each second); a destroyed bloom pays nothing. Grade = the sum of harvested stages: 3 Bronze,
  6 Silver, 9 (all three at stage 3) Gold, which adds a Void Splinter. Unharvested blooms wither at 90 s and with the boss wave.
- **Champion's Ring (T4+, waves 3 to 5):** an optional altar (at least 300 units from every player) with three vow stones; standing
  on one for 1 s takes the vow (the most-occupied stone wins in a party). After a 3 s warning a chain wall of radius 160 rises and keeps
  every other monster OUT (they are pushed back to the wall; players walk through it freely) while one Champion (a rare, Fierce
  bruiser of the roster that does not block shots, about 28 average family members of life) fights inside, confined to the ring. It
  alternates a **lane charge** (a 230-unit chargeLine, telegraphed at least 1.8 s, the roster's rider: burn, chill or bleed) and a
  **slam** (radius 55, 1.5 s) every 4.5 s and never starts either on a held player. Vows: **Bare Hands** (no flasks inside the ring;
  reward x1.5), **Iron Pride** (monster projectiles are removed at the wall; the Champion has 40% more life; x1.3), **Crowd's Favour**
  (arena spikes every 6 s, 1.3 s telegraph; x1.3). Standing outside the ring for 3 s forfeits the multiplier only. Waves go on outside.
  Grade by kill time from the chains standing (shown on the card): Gold <= 38 s, Silver <= 52 s, else Bronze; at 60 s the ring
  closes, the Champion joins the horde and nothing pays. Ashen maps get ember-red chains, Ossuary frost, Coliseum iron over blood sand.
- **Stasis Host (T6+, waves 3 to 5):** a Time Prism (a destructible fixture with ten times a bruiser's life) inside two rings
  of 24 frozen statues (a melee crowd of the roster: about 4 rares, some magic), at least 250 units from every player. Statues are
  invulnerable and inert until thawed. The thaw bar rises 1% per second and 1.5% per credited kill on the map; every 1/24 of it wakes
  the next statue (inner ring first). **Shattering the prism** starts a 2 s shockwave telegraph (radius 210, hurts players) after
  which every remaining statue wakes at once, and the payout is doubled (a Rare jewellery base, a rune chance). Every statue drops as a
  monster of its rarity with +60% item quantity. Grade by the time to the last statue: Gold <= 31 s (x1.15 Ossuary, x1.35 Coliseum; in practice only with the prism),
  Silver <= 90 s, else Bronze; at the boss wave the rest are released into the horde (Bronze if 75% had fallen, else nothing; the prism
  and any frozen statue are removed). Ashen statues are ember-warmed, Ossuary native ice, Coliseum marble.
- **Wayside Anvil:** (T3+, waves 2 to 4) a cold anvil stands 200 or more units from every player, 0.1 to 0.5 of the arena radius
  from the centre; after a three-second warning it counts every credited kill within 260 units of it (normal 1, magic 2, rare or
  stronger 3; 28 needed, 34 with Anvil Blessing). The card shows the charge and the Gold timer (54 s; thresholds stretch with
  Long Fuse and Quick Study). When charged, three boon stones ring the anvil (four with Anvil Blessing), drawn from Tempered (+1
  maximum Stability), Keen (implicits rolled at their best), Attuned (a named item class; the stone shows which) and Recast (roll
  twice, keep the better). Standing on a stone for one second chooses it; in a party the most-occupied stone wins, ties to the longest
  dwell. Boons change only the ordinary (non-unique) equipment of the completion chest and persist after the event ends; they reach
  the chest through `RunHooks.rollChestLoot(ids, rng, boons)` and `rules.rollChestLoot(setup, rng, looter, boons)`. Charged within
  54 s is Gold and offers a second round (Silver up to 90 s, else Bronze, one boon). An uncharged anvil goes cold at the boss wave:
  nothing is forged. Nothing about it is hostile. Skins: forge anvil (ember glow), frost-rimed (Ossuary), rust-stained (Coliseum).
- **Bellwatch:** (T5+, waves 3 to 5) a bell on a scaffold stands near the arena centre (at least 340 units from every player where the
  arena allows) with four Cantors (rares, Fierce, about 20 times a rare's life at the tuned default: Bellringer adds 15%): two on the outer ring
  (230 units from the bell) and two inner ones (90 units). The two outer Cantors can always be hurt; the two inner ones are linked and
  shielded (immune, shield ring, a line of light to the bell) while an outer Cantor lives. Cantors hold their posts and sing until a
  player comes within 130 units. The bell tolls 6 s after the onset, then every 8 s (Bellringer x1.15; each fallen Cantor slows the cadence
  25%): it swings for 1.5 s (a harmless warning circle at the bell) and then sends an expanding three-gap ring (radius 18 to 430 over
  4.2 s, hits each player once outside a gap: burning in Ashen, chill in Ossuary, bleed in Coliseum). Each toll adds a Dirge stack (+8%
  speed to every monster, up to 5; 8 tolls in all); every fallen Cantor removes one. After toll 8 the Dirge holds 60 s and the event
  ends; surviving Cantors rejoin the horde unshielded. Grade: all four before toll 4 Gold, three (or four later) Silver, two Bronze,
  fewer nothing. Each Cantor pays a currency roll as it falls; Silver adds a 35% Prefix Rune, Gold a 60% Prefix Rune and a Rare amulet or
  ring. (The numbers were calibrated so that a matched fair bot reaches Gold on roughly a quarter of seeds.)
- **Void Breach:** the arena shrinks. Built for the Voidtouched Atlas keystone (id `voidBreach`, never part of the ordinary draw: its public odds are zero; a corrupted map with the keystone always rolls it as its first encounter, at any tier, in wave 3 or 4; `MAP_EVENT_UNPOOLED`, slate `forced`). A violet tear opens near the arena's heart: walk within 70 units of it, or it opens by itself 20 s after it appears (it is never ignorable, but it never blocks the map and closes at the boss wave unless required). After the 3 s warning a **Void Heart** (a destructible fixture, about 14 times a bruiser's life) stands in it and the **tide** begins: a band from the safe radius out past the arena rim telegraphs for 2.2 s (radius above 60: at least 1.8 s), then hurts everything inside it once (a player a hit of void, riders burning / chilled / bleeding by roster; a monster 25% of its life, rares half, never a boss), and the same band is re-fired as a fresh telegraph every 6 s so the shrunk field stays shrunk. The safe radius starts at min(arena radius minus 40, 480) and drops every 14 s to 72%, 50% and 34% of it; a bright dashed ring on the ground shows the current edge and a dim one the next. One **Voidcaller** (a rare of the roster's artillery, Fierce, proof to the roster's element) appears per step for steps 1 to 3, a second after a ground mark and at least 250 units from the players where the shrinking field allows. The Heart is **warded** (invulnerable, shielded) until all three Voidcallers are dead; with the ward down it fires a 1.8 s void nova (radius 70) at the player nearest it, never on a held one and never two at once. Breaking the Heart seals the breach. The seal time from the opening is the trophy: Gold 61.5 s (x0.93 Ossuary, x0.85 Coliseum: a smaller arena seals sooner), Silver 86 s, Bronze after (the earliest possible seal is about 45 s; a matched fair bot seals in 52 to 64 s and earns Gold on about one run in five). Not sealed after 130 s it **overflows**: the tide re-fires every 4.5 s, every 12 s a surge of four magic monsters (and a fresh Voidcaller while fewer than three live) arrives, and Bronze is the best it can pay. Voidtouched Atlas adds its strength (percent, 50) to the tide's damage and to the extra-roll chances of the reward. Sounds: the tide step, the surge and the heart's crack or ward drop; glyph a violet tear.

**Calibration (bot sweeps, tier 5).** `tests/sim-events/sweep.ts` plays each event on each roster family with the fair bot (and a
policy per event that opens sites, stands on stones or picks Embers up; the Caravan and Rival Crowns use the plain bot). Gold on a matched
bot lands on roughly a quarter of seeds for every event (mean over the three families, 20 seeds each: Stalker 27%, Echoing 22%, Fault
22%, Relay 17%, Caravan 37% (nearly half of the plain bot's runs break no lock), Rival Crowns 25%, Pact Altar 38%, Orchard 30%,
Champion's Ring 28%, Stasis Host 20%, Wayside Anvil 25%, Bellwatch 13%, Void Breach 20%). Deaths while an event runs stay at or below
2% of runs except Void Breach (8%) and Rival Crowns (13%, the hardest encounter); the same map with no event loses 0 to 3% of runs, and
later boss deaths after an event are flask attrition (the sweep's bot never refills). Time thresholds do not yet scale with party
size (four fair builds earn Gold more often); a party of four plays every event without a softlock or error.

**Fairness budget (tested).** F1 a hostile event area waits at least 1.0 s (1.8 s above radius 60) before it hurts; F2 no
new hostile start on a held player; F3 anything solid is a real prop; F4 event monsters spawn at least 250 units from every
living player (Stalker 320, Rival 350; Echoes and Fault guardians appear on a ground mark instead); F5 nothing spawns
partially when the store is full (it waits); F6 a party wipe freezes every event timer; F7 grade thresholds are on the HUD.

**Presentation.** Each event has a ground glyph (Stalker amber eye, Echoing broken violet rings, Fault blood-red star,
Relay flame cups, Caravan gold chevrons, Rival twin crowns, Pact Altar scales over three stones, Orchard seed and leaves, Ring
chain circle, Host cyan prism, Anvil hammer and anvil, Bellwatch bell, Void Breach violet tear), a HUD card (name, projected grade, objective bars, timers and
one hint line from a keyed text table; the shared UI type scale), an omen banner, an off-screen pointer, its sounds (omen
sting, onset hit, a pentatonic step ladder, whiff / hit / lock, returns, seal, erupt, Bronze / Silver / Gold chords, a
never-harsh failure, and the Stalker's heartbeat that quickens as the pounce nears, and the Echoing's choir hum at its anchor, a held chord that rises a little with every Resonance), music at its top layer while an event is
active, and a small residue mark on the ground for the rest of the map. Completed encounter text remains for five seconds,
including after the final boss. Restarts preserve hidden creation plans, cancel a running event cleanly and leave event-free
legacy maps event-free.

## 8. Waves & monsters (the sim owns these numbers)

**Wave budget:** `baseMonsters 40 + 18·(wave−1)` × countMultiplier, over 60 s.
- 60% of the budget is placed at wave start as **packs** (4–8 monsters) around the arena, at least 250 units from the player. Hunting them is the "PoE" part.
- 40% **streams** from just off-screen toward the player over the wave. This is the "VS" pressure.
- A wave ends when its monsters are dead **or** at 60 s. Waves can stack.

**Per-wave growth** (sim-side): +8% monster life and +4% damage per wave.

**Pack rarity:**
- Magic chance: 10% × magicPackChance multiplier. The whole pack is magic and shares one mod: Swift (+30% speed), Stout (+70% life) or Fierce (+40% damage). Blue outline.
- Rare chance: 3% × multiplier. A single rare leader gets 2 mods from Juggernaut (+200% life), Frenzied (+50% speed), Ember-touched (fire burst on death, telegraphed) and Warded (40% less damage while allies are near); from deeper tiers the pool also holds strikes (Stormcalled, Rending) and **proofs**: Fire, Cold and Lightning proof (from Tier 2, weight 0.6 each, full at Tier 8), **Void-proof** (from Tier 8, weight 0.5, full at Tier 12) and **Physical-proof** (from Tier 10, weight 0.4, full at Tier 14), each 90% resistance to one damage type. From Tier 12 a fifth of rares with a proof swap another mod for a second proof of a different type (never more than two; the mod count per tier is unchanged). Gold outline and its name floats above it. The rest of the pack is normal.
- Hovering a magic or rare monster shows its name, rarity, life and modifier explanations at the top centre.
  The card clears over UI or empty space and when the monster dies.

**Rarity strength:** every magic monster has ×1.5 life and ×1.2 damage; a rare leader has ×3 life and ×1.5
damage. These multiply the monster's level, wave and rolled modifiers (a Stout magic monster has ×2.55 life,
a Juggernaut rare ×9 life relative to its normal counterpart). **Life floor:** a rare leader's base life is `max(kind life, floor) × 3` and a magic monster's `max(kind life, 0.4 × floor) × 1.5`, where the floor rises from 22 at Tier 2's start toward 150 at Tier 6 and beyond (22 at Tier 1, where it does not apply, 48 at Tier 2, 73, 99, 124 at Tier 5, 150 from Tier 6). Named lieutenants, final bosses and training
dummies use their own tuning and do not receive these rarity multipliers.

**Loot** (rolled per player, §9): a magic monster gets ×1.5 quantity and ×2 rarity; a rare gets ×4 quantity and ×3 rarity; the lieutenant and the boss roll their ordinary loot like rares, on top of their guaranteed drops. Summoned minions drop nothing. **XP:** magic ×2, rare ×6.

| Monster | Role | Radius | Life | Speed | Damage | XP | From wave | Behaviour |
|---|---|---|---|---|---|---|---|---|
| Ashling | swarmer | 6 | 22 | 50 | 6 | 3 | 1 | Walks at the player; short lunge-bite. |
| Ember Skitter | fast | 5 | 12 | 95 | 4 | 2 | 1 | Zig-zags in bursts. |
| Cinder Spitter | artillery | 7 | 18 | 40 | 8 | 5 | 2 | Keeps 140–220 away; spits every 2.4 s (projectile speed 150, visible arc). |
| Rift Stalker | hunter | 8 | 40 | 60 | 14 | 8 | 3 | Every 4 s: a 0.6 s landing telegraph (radius 26), then a leap. |
| Ironhide Brute | bruiser | 12 | 120 | 34 | 22 | 14 | 4 | 0.9 s windup slam telegraph (radius 42). 40% physical reduction. |
| **Ashbound Herald** | Cinder Chapel boss | 14 | 3600 | 50 | 24 | 1000 | – | **Aura** (radius 110): allies +30% speed and damage. Keeps 90–140 from the player. Every 6 s summons 6 ashlings. Every 3 s fires 5 void orbs in a spread (they wither). |
| **Cinder Matriarch** | boss, wave 6 | 24 | 4800 | 42 | 26 | 1000 | – | 3 phases at 100/66/33% life. **Orb spiral** (all phases, 0.5× damage per orb). **Slam** (telegraph radius 70, 1.8×). **Meteor rain** (phase 2+: 6–10 telegraphs, 1.2×, then fire pools). **Charge** (phase 3: telegraphed line). Phase 2+ summons skitters. Phase changes are marked by a roar and a short flash. |

This is the Ashen Forge roster; the Rimed Ossuary and Iron Coliseum rosters are in §14. All life and damage values are then multiplied by `MonsterScaling`.

**Map split (implemented).** Wave 3 retains its ordinary pack budget without a named encounter. Original final-boss tuning is unchanged; the promoted commanders have 3600 life and 24 damage. The removed encounter’s guaranteed loot moves to the completion chest. Fresh-character, ladder and isolated-boss probes measure clear time and pressure after this change.

**Contact damage:**
- Each monster type has an attack cooldown.
- Player hit immunity after a melee hit is 0.25 s **per attacker** (a technical debounce against double-hits, not a balance rule).
- There is no cap on damage per hit or per window: one-shots are legitimate when a character's defences are too low for the tier. Tier 1 stays forgiving through level scaling, not caps. The 0.25 s per-attacker immunity is only a technical debounce.

**Performance target:** 800 live monsters + 600 projectiles at 60 Hz sim + 60 fps render, on a laptop.

## 9. Loot & luck

**Loot is instanced** (§11): every kill and the completion chest roll separately for each living player in the map, and each player sees and picks up only their own drops. A player who dies and re-enters through a portal rolls again from their next kill on.

**Personal luck:** a player's item quantity / rarity in a map = the map-side luck (tier, quality, implicit, mods: §7) + that player's gear (`rules.lootLuck`). Example: a map at +26% quantity and a player with a +10% quantity amulet → 136% for that player's drops; a party member without luck gear rolls at 126%.

**Per kill and player**, Q% and R% = personal luck × the monster's rarity multiplier (§8), with quantity doubled in the Echo wave. Each category is rolled independently: `chance = base × Q/100` (maps also × map drop chance: quality, Cartographer's). A chance above 100% drops `floor(chance)` items plus one more with the remainder. An expedition's **daily surge** (§7) multiplies Q by 1.3 and R by 1.15 for these ordinary rolls (Q is divided back out of the Map category, so map volume never changes); guarantees below use the personal luck without it.

| Category | Base chance | Contents |
|---|---|---|
| Currency | 1.5% | Scrap 40 · Kindling 12 · Map Dust 6 · Solvent 2.5 · Reforge 1.5 · Threat Glyph 1.5 · each Essence 0.8 (×5) · Seal 1.2 · Reward Ink 0.6 · Catalyst 0.5 · Void Needle 0.2 · Fracture Core 0.08. Scrap drops in stacks of 1 (75%), 2 (20%) or 3 (5%). Map implicits and Essence-laden multiply essence weights |
| Equipment | 0.9% | Uniform over the bases whose level requirement ≤ item level; item level = monster level. A unique roll picks among the uniques wearable at that item level (§5), else it becomes a rare |
| Flask | 1% | Life 60 · Focus 40 · Quickstep 12 · Aegis 10 · Quicksilver Mind 10 |
| Map | 0.5% | See section 7 |

**Equipment rarity** (m = R/100):
- normal weight 70
- magic 22·m
- rare 1.6·m^1.3
- unique 0.2·m^1.5

**Guaranteed drops** (for every player present, on top of the ordinary roll; m = that player's personal rarity / 100):
- **Boss:** 2 equipment (1 guaranteed rare, 1 ≥ magic), 3 currency, and an 8%×m chance of a unique.
- **Completion chest:** 2 equipment (both ≥ magic; the last ≥ rare 30% of the time), 4–5 currency, 1 flask, and **1 progression map** (75% current tier, 25% tier+1; quality 4–12, capped at Tier 15). A 50% roll adds a second map using normal map-drop tier/quality rules. These additions transfer the removed wave-3 lieutenant’s guarantees to successful completion.
- **Hourglasses** (§7 Daily surge): a separate 3% chest roll for Hourglass Sand, a 5% x personal rarity final-boss roll (Tier 3+, doubled in sealed areas) and a 0.5% x personal rarity Grand Hourglass roll (Tier 9+); none of them uses the surge.

**Making luck *felt* (presentation):**
- Drop beams by tone:

  | Tone | Beam |
  |---|---|
  | normal | none |
  | magic | short blue |
  | rare | tall gold, pulsing |
  | unique | tall orange, with a flash, a 0.15 s slow-mo, a bass hit and a screen flash |
  | currency | gold sparkle; high-tier currency gets a beam |
  | map | silver beam |

- Rising chimes by rarity.
- Items pop out of corpses with an arc (`DropView.z`).
- Labels use the pixel font on dark plates coloured by tone.
- A rare monster glows gold and shows its name. When it dies, loot fountains out.

**Gambling at Rook:** 6 Scrap buys a random item of a chosen class at the player's level, with magic 25%, rare 6% and unique 0.5% (×m from gear rarity; unique only for classes with a unique whose level requirement ≤ the player's level — a wand from level 10, a ring from 24; offered only for classes with a base at the player's level).

**The vendor layout (Rook and Mira):** a merchant opens beside the inventory, like a Path of Exile vendor, and every
item moves by drag and drop. Rook's window is **an inventory like the player's**: one plain item grid (the same grid, item icons, footprints, rarity frames and hover card as the
backpack and stash, 12 wide, never shorter than the stash) with plain text tabs **Gear**, **Maps**, **Supplies**, **Gamble** and **Sell**; the tab of an item is decided by its item class alone
(`vendorTabOf`: equipment is Gear, maps and scarabs are Maps, flasks, Kindling, Map Dust and every other currency are Supplies). There are no special tiles, price chips, badges or shelf headers.
Dragging an item (or a gamble row, on the Gamble tab) onto the backpack buys it: the cell under the pointer is the slot (the ghost and the grid preview go green
when the footprint is free there or the purchase tops up a stack of the same kind, red otherwise) and a gamble reserves room for
the largest base of its class. The preview states why a drop is refused ("No room there. Drop it on free cells.", "Your
backpack has no room for this.", "Can't afford: needs 6 Forge Scrap (you have 2).") and a refused drop buys nothing. Ctrl/⌘-click or right-click on an item buys with first-fit placement; the Buy/Gamble
button remains on gamble rows only. The drop cell travels in `buyOffer` /
`buyWare` / `buyDebugOffer` as an optional `at: {x, y}`; the server honours it only when the whole footprint is free there and otherwise
places first-fit, so a stale or hostile cell never fails or changes a purchase. Everything else about buying (price, affordability,
atomic payment and placement, the hideout and activation checks) is unchanged and decided by the server.

**Rook's wares (the Gear, Maps and Supplies tabs, owner brief: "just an inventory with some maps and some items to buy; random, usually crap, sometimes really cool").**
Nothing is chosen: no tier, quality, area, search, filter or chip. Each character sees its **own board** of **4 maps and 8 items** plus a fixed **Staples**
shelf (Life and Focus flasks 1 Scrap, Quickstep, Aegis and Quicksilver Mind flasks 3 Scrap, Kindling 3, Map Dust 3: bought by `buyOffer` as before, so luck can never strand anyone). The board is built by the
server (`rules.waresBoard`) and sent with the `merchantWares` command; the client never rolls it. It is a pure function of the character id and the **stock epoch**
`(rotation, character level, rerolls)`, so every look at the same epoch shows the same wares and a restart changes nothing.

- **Refresh rules.** `rotation = floor((serverNow - 04:00 UTC) / 6 h)` (the same forge clock as the daily surge, `forgeRotation` in `surge.ts`): wares rotate at 04:00, 10:00, 16:00 and 22:00 UTC.
  Every **level-up** of the character starts a new epoch too (new level, new wares). **"Ask for new wares"** costs Scrap that doubles with every use inside one rotation
  (3, 6, 12, 24, 48, then 48) and returns to 3 with the next rotation; it bumps the reroll count (the salt) and refreshes the board. A level-up keeps the count. The sold slots clear with every new epoch.
- **Persistence.** `CharacterSave.wares = { rotation, level, rerolls, sold[], tier, areas[] }` (optional, normalised on load, no `SAVE_VERSION` change): the epoch, the sold slot indices
  and the inputs snapshotted when the epoch began (highest tier completed, the discovered bindable areas), so discovering an area or finishing a tier mid-rotation cannot move the stock.
  The first look at a new epoch saves its state. A purchase pays the Scrap, places the item and marks the slot sold in **one character value**, written to the database at once.
- **Buying.** Ware ids are `ware:<rotation>.<level>.<rerolls>:<slot>`. `buyWare` re-derives the board and refuses a stale epoch ("Rook has new wares. Take another look."), a sold slot,
  a malformed id, missing Scrap or room, changing nothing. `rerollWares { epoch, cost }` carries what the player saw and refuses a stale price the same way. Visitors in someone's hideout
  see and buy from their **own** board and pay with their own currency. Scrap in an open trade offer is never spent.
- **Slots.** Slots 0-3 are maps, 4-11 items. Slot 0 is **always a Normal quality-0 map** of an open area at the character's current tier (Tier 1 of the starting area costs 1 Scrap), so nobody is
  map-locked. Slot 4 is **Rook's pick**: doubled odds of the lucky tiers.
- **Luck model** (data: `WARES` in `src/data/progression/merchant.ts`). Every other slot rolls a luck tier: **junk 70%, okay 22%, good 6.9%, jackpot 1.1%** (Rook's pick: 62 / 22 / 13.8 / 2.2). One board in about eight
  carries a jackpot (12.4%). Maps are bound to a discovered, bindable area; tier is the highest completed tier + 1 plus an offset by luck (junk -2..0, okay -1..0, good 0..+1, jackpot +1..+3; 8% of maps +1..2 more),
  never above the area's ceiling; quality is 0 for most junk and runs up to 20 (jackpot 14-20); rarity is Normal for most junk, with Magic and Rare maps (and their danger mods) rising with luck.
  Items come from a weighted table per tier (equipment bases from the loot generator at the character level -4..0 for junk, up to +3..+8 for a jackpot; scarabs; currency; wearable uniques from "good" up, 40% of jackpots).
- **Prices.** Gear: the appraisal (`sellQuote`) x4, uniques x3 more. Maps: `(1 + 3 (tier-1)) x (1 + quality/20) x rarity (1 / 1.8 / 3)`, rounded up. Scarabs 8 / 20 / 50 / 120 by tier; currency by a per-unit table. Every price is a whole number of Scrap, at least 1.
- **UI.** The stock sits on the vendor grid as real items at their natural sizes. A pure packing function (`packVendor`, `src/ui/lib/merchant.ts`) places each tab's items first-fit in a fixed order (the staples, then the board by slot),
  so the layout is stable for the whole epoch; a sold item leaves an empty gap and the others never move. The **price** is the last line of the hover card ("Price: 12 Scrap", red when you cannot pay) and a tiny quiet number over the item on hover only.
  A lucky find has no extra chrome: the first time a new epoch's board is on screen with a good or jackpot ware, a soft chime and a brief glint over those items play once (`prefers-reduced-motion` removes the motion).
  The footer is one line, "New wares in 2 h 14 m", and a small "Ask for new wares (N Scrap)" button; the Scrap balance shows beside the title like every currency.
- **Sell tab.** The same window as a drop target: drag equipment from the inventory into it (Ctrl/⌘-click works too), hover an item for Rook's appraisal breakdown and "Rook pays: N Scrap", read the total under the grid and press **Accept** (then confirm).
  Drag an item out, or Ctrl-click it, to keep it. Equipped and trade-locked gear is refused with a reason; the payout is one atomic server command.
- The old `map:<area>:<tier>:<grade>` rows (Maps tab with area chips, tier and quality toggles) are gone from the wire (`buyOffer` refuses them); the pure `rookMapOffers` rules remain only as a fixture for tests and simulations.

**Merchant stock:**
- Wares: 4 maps and 8 items per character, random and luck-driven (see Rook's wares), shelved on the Gear, Maps and Supplies tabs by item class
- Staples: Life and Focus flasks (1 Scrap), Quickstep, Aegis and Quicksilver Mind flasks (3 Scrap), Kindling (3 Scrap), Map Dust (3 Scrap)
- Gamble per class

**Selling equipment to Rook:** the Sell tab is an offer window beside the inventory. Drag unequipped equipment out of
the backpack into the window (Ctrl/⌘-click on a backpack item also offers it, and opens Sell from the other tabs); worn
gear is refused with "Unequip the item and put it in your backpack first." and never moves. Each offered item shows its appraised
Scrap payout and, opened, Rook's appraisal breakdown (base, item level, each affix tier); the newest item opens by itself.
Drag an item back out of the window (onto the inventory or anywhere else) or press its × to keep it. The footer shows the
running total; confirmation states that the items will be permanently removed. Offering only selects: items stay in the
backpack (marked "sell") until you confirm. Clear, Cancel, closing Rook or changing zones do not sell anything.

**Appraisal:** calculate in hundredths of Scrap and round the final item total up to whole Scrap:

- Base: `50 + base.levelRequirement`.
- Item level: `itemLevel`.
- Each ordinary affix: `round(35 + 65 × (worstTier − tier) / (worstTier − 1))`; T1 is best, and the
  worst tier is specific to that affix's 7–10-tier ladder. A one-tier ladder uses the best-tier value (100).
- Unique modifiers: 70 each; unique effects/flags: 50 each. Their fixed modifiers do not pretend to be T1 affixes.
- Payout: `max(1, ceil(total / 100))`. No separate flat rarity bonus. For example, an ilvl88 Dusksteel Ring
  with six T1 affixes is worth 8 Scrap; the same base/level with six bottom-tier affixes is worth 4.

Rook buys equipment only: maps (including his own), flasks and currencies cannot be sold. Gear in
equipment slots, stash, another character's inventory or an open trade offer is refused. Sales work in any
hideout and pay only the seller. The server recalculates every appraisal and rejects stale totals, missing
items, duplicate UIDs, batches over 60 and any sale outside a hideout. No partial sale is allowed. Item removal
and payout commit in one database transaction; failed saves leave both unchanged. Scrap fills the shared
Crafting Stash first (up to 5,000), then backpack stacks; overflow respects trade locks and stack limits.
Replaying a sale of already-removed items cannot pay again. Gamble prices remain unchanged: even the upper
bound on expected resale at maximum item level and item rarity stays below the 6-Scrap gamble cost.

**Testing merchant — Mira the Provisioner:** a separate NPC south of Rook, disabled by default. Server operators
enable her per character with `debug_merch <account> <character> enable`; `disable` and `status` use the same
arguments. The CLI verifies ownership and persists activation separately from character saves. Changes appear
in live hideouts within one second without a restart. Every visitor to an enabled hideout can buy free stock
for their own character; enabling a host does not enable visitors or the host's other characters.

Mira's panel uses the same vendor layout: category, quantity, item level / map tier and rarity selectors, a search box and a stock
list beside the inventory. Dragging a row onto the backpack takes `quantity` of it with the first stack on the dropped cell and the
rest first-fit; the preview refuses the drop when the whole purchase cannot fit. The Buy button is the click extra.

Stock includes every scarab tier, currency/key/ingredient, map base, equipment base, unique and flask. Quantity
is 1–100; maps support T1–T15 and normal/magic/rare, bases support item levels 1–99 and normal/magic/rare,
and uniques support item levels 1–99. Equipment/map previews are examples; purchases roll fresh values on the
server. Existing item and Atlas requirements apply. Items go to the buyer's backpack, with flasks refilling
the belt first, respecting stack limits and trade locks. Delivery is saved atomically: insufficient space or
a failed save grants nothing. Every purchase checks the current hideout owner's activation, so disabling
blocks stale panels immediately. Clients cannot change activation.

## 10. Look & feel (art direction)

**World:**
- Dark fantasy of embers and ruined ritual spaces. It's mostly dark: ambient around 0.18–0.25, and light comes from the player's wand, projectiles, braziers, lava cracks, crystals and drops.
- Tiles are 16×16. Floor variation comes from several variants plus sparse detail decals: cracks, runes, bones, moss, and lava veins that glow (emissive).
- The arena edge is a ring of ruined wall and pillars; beyond it an abyss with drifting embers.

**Palette** (the art owns the exact values; the UI mirrors them as CSS tokens):

| Group | Colours |
|---|---|
| Neutrals | ink `#0d0b0e`, coal `#1a1619`, char `#2a2326`, iron `#3b3438`, stone `#5a5057`, stone-light `#7d7278`, bone `#cbbfa8`, parchment `#e8dcc0` |
| Earth | moss `#4b5a3a`, olive `#6e7447`, rust `#7a3b24`, blood `#7a1e22`, burgundy `#5a1a2a`, ochre `#b8862f`, gold `#e0b04a` |
| Emissive | ember `#e8662a`, flame `#ff9a3c`, hot `#ffe7a8` |
| Elements | frost `#7fc6e8`, ice `#d4f1ff`, mana `#4a7bd6`, storm `#b9a6ff`, lightning `#efe9ff`, void `#7b3fa0`, void glow `#c07bff` |
| Rarity | normal `#d8d2c4`, magic `#7aa2ff`, rare `#f2d15c`, unique `#e8772e`, currency `#c9b58a`, map `#d0d0dc` |

**Sorceress:**
- About 18×26 px. Burgundy and charcoal hooded robes, bone-white hair strands and a pale face.
- A wand held in her right hand, with a hot-ember emissive tip.
- 4-direction set (south/north/east, west mirrored), animated:

  | Animation | Frames |
  |---|---|
  | idle | 4, breathing and robe sway |
  | run | 6 |
  | cast | 5, with a release frame |
  | dash | 3 |
  | hit | 2 |
  | death | 6 |

**Monsters:**
- Silhouettes are readable by role.
- Glowing emissive eyes and ember cracks.
- Rarity is a runtime outline or tint, never baked into the sprite.

**Game feel:**
- Hit flash, 2–4 px knockback, damage numbers (crits bigger with a burst), screen shake scaled by settings, and a 40–80 ms hit-stop only on big events (boss phase, unique drop).
- Corpses fade to ash; burning monsters glow and smoke.
- Projectile trails; bloom on every fire effect; light pooled around the player.

**UI:**
- Blackened metal and dark leather panels with thin bronze/bone borders and ember accents. Everything is built with CSS gradients, borders and shadows; no image files except the pixel icons.
- Cinzel titles; Alegreya Sans text.
- The type scale is strictly 14/16/19/28 px (caption, secondary, body, title; see `AGENTS.md`).
- Item icons are generated pixel art, upscaled with `image-rendering: pixelated`.
- **Life and Focus globes** are liquid, painted per pixel on a small canvas (about 3 CSS px per art pixel) under a glass shell with curved specular, rim shade and a light that bleeds onto the frame. The liquid has a depth ramp (bright surface, dark bottom), a second swell behind the front surface and rising bubbles; Life adds embers, Focus arcane motes. The surface sloshes on a damped spring kicked by every change (hits harder than heals). A hit leaves a pale **damage trail** that waits about 0.4 s and then drains; a heal or regeneration lights a **flash** with a rising light band (the Focus refill shimmer). Below 30% Life the globe desaturates toward the edge and gives a slow double heartbeat that quickens as Life falls; **empty Focus** flickers with sputtering sparks and dims its numbers. Burning, bleeding, chilled, frozen (Life) and withered, shocked, chilled, frozen (Focus) tint the liquid. The globe pauses while the tab is hidden; with **Motion: calm** (the shared Atlas toggle, which follows `prefers-reduced-motion` on auto) the surface is flat, there are no bubbles, embers or flicker, and it only redraws while the value is still changing. The numbers use the type scale and keep a dark outline. Math: `src/ui/lib/globe-fx.ts` (pure, tested); painter: `src/ui/lib/globe-render.ts`.
- **Points to spend.** While the character has unspent attribute points, skill points or (in a hideout) free Atlas tree points, a pulsing badge per kind straddles the top of the command deck beside the level gem (attribute: gold arrow, hotkey C; skill: violet star, K; Atlas: frost diamond), with a small "+" on the gem. The tooltip reads "N attribute points to spend (C)"; a click opens the panel (like the hotkey); a badge disappears at zero. A level-up (or a new Atlas point) pops the badge with a few sparks, but loading a character or reconnecting does not. Calm motion shows static badges. Counts come straight from the character save, so they are right after a level-up, after spending, after a reconnect and on a character load. Logic: `src/ui/lib/points.ts`.
- Dev sandbox previews: `dev/ui.html?hud=lowlife,empty,full,play,nopoints,points,atlaspoints` (`&levelup=1`, `&debuffs=burning,withered`, `&motion=calm`).

## 11. Online: server, hideouts, parties, portals

**Topology.** One Node server (`src/server`) owns everything:
- accounts, sessions and characters, stored in SQLite;
- the rules (`src/game`) and the simulation (`src/sim`).

The browser client (`src/client`) is a thin terminal. It logs in over HTTP, then plays over one WebSocket. It sends held-state input and commands. It receives:
- binary world snapshots at 30 Hz, AOI-culled;
- cosmetic events;
- its own `CharacterSave` whenever that changes.

The client also runs the shared rules locally, for **display only**: tooltips, craft previews, the character sheet and merchant offers.

**Instances:**
- **Hideout (one per character).** Created on demand and disposed 60 s after it empties. Anyone in the owner's party may visit.
  - The map device works only for the owner.
  - **Rook (the merchant) trades with everyone** in any hideout; you pay with your own currency.
  - The stash always opens the *viewer's account* stash. Every character on that account shares normal tabs,
    the Map Stash and both Crafting Stash views; backpacks, equipment, flasks and map devices remain per character.
  - Crafting works in any hideout.
- **Map.** Created when the owner activates their map device. The map is consumed, and **8 portals** open next to the device in the owner's hideout.
  - Entering consumes one portal. It doesn't matter who enters (owner or party member), and re-entry after death or leaving also costs one.
  - **Portals are clicked** (or walked into). Clicking works from anywhere in the hideout. A map's return portal is clicked the same way.
  - **Leaving a map** (dying and respawning, "leave map", the return portal, the map closing) puts you in **the map owner's hideout**, next to its portals. If you are no longer allowed to visit it (you left the party) or it is full, you go to your own hideout instead.
  - At 0 portals nobody can enter any more; players inside can stay.
  - The instance ends when it's cleared and empty, or empty for 10 minutes, or at 0 portals and empty.
  - The owner can't open a new map while their previous map instance still has players inside. Activating a new map closes an old, empty instance.
- **Up to 4 players per instance.** Only party members, or the owner alone, can enter.

**Party:**
- Up to 4 members. The leader invites by character name; the invitee accepts or declines. Members can leave; the leader can kick or promote. If the leader leaves, leadership passes to the next member.
- The party panel lists every member with:
  - where they are (hideout / map name and tier);
  - their open map and its portals left;
  - "Visit hideout" (and "Go home").
- Chat has Global and Party channels. Global reaches every online character; Party stays within the party.
  Right-click a sender's name or message to invite them to the party. Existing leader and party-size limits apply.
- The left HUD shows a portrait for each party member, including members in other areas and offline members.
  Right-click a portrait for Join hideout and Trade. Offline members' actions are disabled; leaving a map explains
  the portal cost (or that no return is possible when the portals are exhausted).

**Loot is instanced.** Every kill rolls loot separately for each player in the instance, using the map's luck plus that player's own gear luck (`rules.lootLuck`). Each player sees and picks up only their own drops; there's no loot stealing. The completion chest gives every player present their own chest loot.

**XP is shared.** Each monster death immediately grants its full XP to every living player in the instance, regardless of distance or who killed it. There are no XP orbs; fractional XP carries between kills. Dead players and players in another instance receive none.

**Party scaling (inside the sim):**
- Monster life: ×(1 + 0.5·(n−1)).
- Wave budget: ×(1 + 0.25·(n−1)).
- Magic and rare pack chance: +10% per extra player.

**Death:**
- A dead player lies on the ground and can press "Return to hideout" (`respawn`). This goes to the map owner's hideout, next to the portals.
- Allies keep playing.
- The map doesn't fail while anyone is alive inside or portals remain.

**Networking** (see `src/contracts/net.ts`):
- The server sim ticks at 60 Hz. Snapshots go to each client every 2 ticks (30 Hz): binary, AOI-culled (about 1040×680 around the player), and they include only the recipient's own drops.
- The client keeps an **interpolation buffer** (about 70–100 ms, adaptive to jitter) for remote entities.
- The **local player is predicted**:
  - the client runs 60 Hz input ticks with sequence numbers;
  - the server applies one queued input per tick per player and acks the last applied seq;
  - the client replays unacked inputs from the authoritative position, using the shared `movePlayer`;
  - small errors blend out smoothly, and large ones snap.
- Casting stays authoritative. With the render delay at 100 ms, on LAN or a nearby server it feels immediate.

**Security & robustness:**
- Passwords: scrypt with a per-user salt. Session tokens: 32 random bytes, stored hashed, valid for 30 days.
- Login is rate-limited.
- Every client message is validated (shape plus the rules); invalid ones are rejected with a toast.
- The client never sends outcomes.
- One socket per character: a newer login kicks the older socket with code 4003.
- A protocol version handshake; on a mismatch the client reloads.
- Every async handler is wrapped: no unhandled rejections, and one bad room never crashes the process.
- Saves are debounced (1 s) and flushed on leave and shutdown. A stash change saves the account stash and
  every dirty character on that account in one transaction; another online alt receives the new state immediately.
  Character deletion never deletes the account stash.
- Graceful SIGTERM: kick everyone with code 4004 and flush saves.

**Restart safety** (deploys must not cost players their session):
- **Parties persist** in SQLite and are restored on startup.
- **Open maps persist** as their setup and remaining portals. After a restart, each open map that isn't cleared is recreated as a fresh run of the same map, keeping the same portals.
  - Players who were inside go straight back into it without paying a portal.
  - The fight restarts from wave 1, and ground items are lost.
- Players who were visiting a party member's hideout go back to that hideout.
- **Drain on SIGTERM:** the server announces "Server update in 20 seconds — your party and open maps are kept", keeps running for `DRAIN_SECONDS`, saves, then closes sockets with code 4004. Clients show "Server updating — reconnecting…" and come back on their own.

**Dev:** `npm run dev` starts the server (`tsx watch`, port 8787) and Vite (5173, which proxies `/api` and `/ws`). The dev database is `data/dev.db`, and tests use `:memory:`.

## 12. Quality-of-life

**Stash search.** A search box on the stash panel highlights matching items and dims the rest. `Ctrl/⌘+F` focuses it while the stash is open, and `Esc` clears it.
- **Scope:** it covers every tab. Each tab shows its match count.
- **What it matches:** item names, base types, classes, affix and implicit texts, affix names, tags, currency and map names, and rarity words (`rare`, `unique`, `magic`, `normal`).
- **Syntax:**
  - Space-separated terms must *all* match.
  - `"quoted phrases"` match as a whole.
  - `a|b` matches either term.
  - `!term` excludes items that match the term.

**Click to pick up equipment.**
- Clicking a drop's label or sprite picks it up. Out of reach (`PICKUP_REACH` = 72), the character walks there automatically first; WASD cancels the walk.
- A click on a label takes priority over the basic attack.
- Hovering a drop highlights its label.
- Currency, flasks and maps stay auto-pickup.

**Drop items on the floor.**
- Dragging an item out of any panel onto the world drops it at your feet (command `dropItem`). Stash items can be dropped only in a hideout.
- A dropped item is **public** (`DropSpec.owner = 0`): everyone in the area sees it and anyone can pick it up by clicking. Public drops are never auto-collected, not even by the player who dropped them.
- Their labels get a neutral "ground" marker so they read differently from your own loot.
- They vanish after **10 minutes**, or when the area closes. A toast warns about this on the first drop. A server update gives them back to whoever dropped them (backpack, else stash).
- Both characters are saved immediately on a public drop and on its pickup.

**Crafting Bench** (the anvil in every hideout; opens the bench panel). This is deterministic "scaffolding": choose exactly which affix to add, for a fixed price.
- **Placing an item:** drag it onto the bench slot. This is a UI selection only; the item stays where it is.
- **Recipes:**
  - The panel lists every recipe for the item's class: its affix text with the range, prefix/suffix, cost, and availability with the reason when unavailable.
  - A recipe adds one affix at a fixed, modest tier. It never grants the best tiers: the bench tier is the lowest tier the item level allows, capped at T4.
  - The price is mostly Forge Scrap, plus an essence of the matching tag for tagged affixes. It scales with the granted tier.
  - It costs 1 Stability, with no scar risk. Normal → magic.
- **Limits:** at most **one bench-crafted affix per item**. It's marked "crafted" in tooltips and can be removed for free ("Clear crafted affix").
- **Currency palette:** the panel also shows every currency you carry, with counts. Clicking one applies it to the bench item, exactly like right-click → left-click. It shows the odds preview, the Stability bar and the item's crafting history.
- **Where:** usable in any hideout.

**Trading** (trade window; atomic).
- **Opening a trade:** request by character name, from the party panel ("Trade" on a member) or the chat command `/trade <name>`. The target must be online, anywhere on the server. They get an accept/decline popup, and both players see the trade window.
- **Offers:** drag items from your backpack into your offer (max 12). Both offers are visible with full tooltips.
- **Accepting:**
  - Any change to either offer clears both accepts and blocks accepting for 2 s. This stops last-second swaps.
  - When both accept, the server checks both backpacks have room, then swaps everything in one step and saves both characters immediately.
  - If there isn't room, it explains why and nothing moves.
- **Closing:** either side can cancel. A trade also cancels on disconnect.
- Items in an open trade stay in your backpack, but they are locked (not movable) until the trade closes.

**Special stash tabs** (every account has all three, in addition to the normal tabs; they don't count towards `MAX_STASH_TABS`). They are part of the stash: usable in any hideout (your own account's stash), nowhere else. They appear as three icon tabs after the normal tabs. With any stash tab open, Ctrl/Cmd-clicking a backpack map or currency files it into the appropriate special tab (with a Crafting Stash tab open a map or gear loads the work slot instead). Equipment and flasks use the selected normal tab; Ctrl/Cmd-click from a normal tab still withdraws to the backpack.

**Legacy account migration.** The first character's normal tabs are retained, along with every other character's
nonempty tabs. Special-stash counts/maps merge; anything over their normal limits becomes physical stacks/maps
in normal or additional Recovered tabs. Accounts retain any extra tabs needed by this migration; new accounts
still have at most eight normal tabs. Items receive distinct character namespaces once, preserving their rolls,
crafting history, protections and stability. The database stores shared holdings only once, in `account_storage`.

**Map Stash.** Holds up to 400 maps.
- Maps are shown grouped by tier (T1–T15). Each tier shows its count and expands into a list sectioned by **Atlas area** (chart region order, then depth), each section headed by the area's emblem, name and map count (a slot is reserved for its surge pips).
- Each map is shown with its icon, rarity colour, mod count and a corrupted marker, plus a full tooltip.
- **Depositing:** drag or Ctrl-click a map from the backpack or a stash tab. It files itself automatically. With the Map Stash tab open, Ctrl-clicking the map in the map device files it too.
- **Withdrawing:** drag to the backpack, a stash tab or the map device, or Ctrl-click (to the backpack; into the map device while its panel is open). The map device panel also lists the Map Stash as a picker, so a map can be loaded without opening the stash. A map already in the device goes back into the Map Stash.
- Map currencies can be used on maps while they sit in the Map Stash.

**Crafting Stash — Equipment.** One fixed, labelled slot per equipment currency: Kindling, Scrap, Reforge, the 6 Essences, Prefix Rune, Suffix Rune, Catalyst, Solvent, Seal and Fracture Core. Empty slots stay visible, ghosted.
- Each slot holds up to 5,000 of its currency.
- **Depositing:** dropping or Ctrl-clicking any currency stack files it into its slot, wherever you drop it (either Crafting Stash tab accepts every currency). What doesn't fit in a full slot stays where it was. A **"Deposit all"** button moves every currency stack in the backpack (stacks in an open trade offer stay).
- **Withdrawing** never pushes another item out: dropped on an occupied cell, it tops up a matching stack there or lands anywhere free in that grid.

  | Action | Takes |
  |---|---|
  | Drag / Ctrl-click | A full stack (up to the backpack stack size of 40, 20 for Fracture Core), or as much as the backpack can still hold |
  | Shift+Ctrl-click | Exactly 1 |

- **Crafting straight from the stash:** right-click a slot to arm that currency, then left-click an item in the backpack, the stash or equipment. Each use draws from the slot. This works wherever the stash works (any hideout). With an item in the **work slot** (below), a plain click on a slot crafts on it.
- **Paying:** the Crafting Bench takes its price from the backpack first, then from the Crafting Stash; Rook from the backpack, then the normal stash tabs, then the Crafting Stash. Items the server hands back (a public drop returned after a server update, a refunded map) go to the backpack, then the Crafting Stash (currency) or the Map Stash (maps), then the normal tabs.
- A slot can't be dropped on the floor or discarded as a whole ("Take currency out of the Crafting Stash first.").

**Crafting Stash — Maps.** The same, for map currencies: Map Dust, Threat Glyph, Reward Ink and Void Needle, plus the Compass, Twin Ink, Void Splinter, the scarabs and the Atlas keys.

**Crafting Stash work slot.** Both Crafting Stash tabs show, beside their currency slots (compact 3-wide tiles), one **work slot**: the place a piece of gear or a map sits while you craft on it, like the work slot on a PoE currency tab. The stash opens with the inventory, so the item is **dragged from the inventory** into the slot (gear you wear, stash items and the Map Stash also work, by dragging onto the slot or anywhere on a Crafting Stash tab or its tab button; Ctrl/⌘-click from the backpack or your body while a Crafting Stash tab is open is an extra). Only one item fits; an item dropped on an occupied slot swaps with it and the occupant goes back where the new one came from (into the body slot it was worn in, a free backpack spot, the Map Stash) or the move is refused with the reason and nothing changes.
- **Reading it:** the item is shown in place: name, base, item level, live Stability (pips and number, "Finished" at 0), every implicit, affix (tier and value), scar and sealed / fractured / crafted marker, and the item's own crafting history (the newest line under the name and the earlier ones below the modifiers). The full tooltip is on hover. Hovering a currency tile shows the rules' craft preview for the slot item (odds, what is preserved) or why it cannot be used.
- **Crafting:** **one click** on a currency slot applies one of that currency to the work slot's item, drawn from that slot; no arming, no dragging, the item never leaves. Seal, Catalyst and Fracture Core open their affix choice beside the item. Fracture Core, Anneal, Transmute and Void Needle (irreversible) ask for a confirmation first; everything else applies at once, and a craft that would do nothing is refused without spending anything. Right-click still arms a currency for any other item (Shift keeps it armed), exactly as before. Crafting works in any hideout, like the stash.
- **Feedback:** the modifiers the craft added or changed stay lit (a "new" mark and a glow; a breaking seal is not a change) until the next craft or another item takes the slot, the item flashes, the craft's sound and toast play as for any craft, and a "Last" line names what it did (and how many modifiers it removed). The lit marks also show what changed while the tab was closed.
- **Buttons:** **Equip** wears the item (the piece it replaces takes its place in the work slot; refused with the reason when the level or slot does not fit), **Return** sends it to the backpack (refused when the backpack is full), **Bench** opens the Crafting Bench on it for recipes and Stability repair.
- **Keyboard:** Tab reaches the slot's controls (a mouse press never leaves keyboard focus behind, so game keys stay game keys). On a currency tile: arrows / Home / End move, Enter or Space crafts, Shift+Enter arms the currency; on the socket, Delete or Backspace returns the item; on Equip / Return / Bench, Enter or Space. Only the keys a control uses are taken from the game.
- **Persistence:** the item lives in the account's shared storage (`account_storage`, with the stash and the Atlas), in exactly one place: the same slot for every character of the account, kept across tab switches, sessions, disconnects and server restarts. Every move into, out of or crafted in the slot is written at once, in the same transaction as the character row it came from or goes to, so an interrupted save can only leave the item where it was. A move that touches the slot needs the hideout like every stash move ("The stash can only be used in a hideout."); items in an open trade offer cannot be loaded (they stay locked), and the slot's item cannot be offered in a trade or sold to Rook (return it to the backpack first).

**Model.**
- `CharacterSave.stash`, `currencyStash` (counts) and `mapStash` (maps) project the account's shared holdings into the rules and client state. SQLite stores the authoritative copy in `account_storage`, with empty shared fields on character rows. Legacy characters use the existing item repair rules before their stashes merge. Loading an account stash rejects lost items or changed currency counts instead of silently clamping or dropping them.
- A currency slot is addressed by the synthetic uid `cstash:<currencyId>`, like `belt:<i>`.
- New item locations: `currencyStash`, `mapStash`, `craftSlot` (the work slot: `CharacterSave.craftSlot`, account storage, one gear or map item that keeps its own uid, so every rule reaches it through `findItem`). An account storage row without the field reads as an empty slot (no save or storage version bump); protocol 19 adds the location to `moveItem`.
- `moveItem` gains an optional `count`, for splits and single withdrawals (it also splits normal stacks and limits flask charges loaded into the belt).
- `quickMove`'s stash context accepts `'currency' | 'mapCurrency' | 'maps'`; with a Crafting Stash tab open it loads gear and maps into the work slot (from the backpack or the body), the work slot's item always returns to the backpack.
- Stash search covers the special tabs too.

## 12b. First-run guide (onboarding)

Design and evidence: `docs/onboarding-ux.md`. Everything the guide says lives in `src/data/guide/strings.ts`; the step machine (`src/ui/guide/steps.ts`), hint rules (`hints.ts`) and cheat-sheet logic (`cheatsheet.ts`) are pure and tested.

- **State is account-level.** `CharacterSave.guide?: GuideState` (`src/contracts/guide.ts`) rides in the shared account storage like `atlas`: `{ v: 1, mode: 'active' | 'skipped' | 'done', skippedBy?, done: GuideStepId[], hints: GuideHintId[], used?: GuideProp[], t?, startedAt?, finishedAt?, replays?, warmed? }`. It is optional and normalised on load (`normalizeGuide`: unknown ids dropped, de-duplicated, bad types ignored); no `SAVE_VERSION` bump. A character whose account has none gets it decided **once** when it first loads (`decideGuide`, persisted at once): **veteran** (any character at level 5 or higher, any `stats.mapsCompleted`, `atlas.clears > 0` or a completed area) = `skipped` by `veteran` with every hint marked seen; everyone else `active`. Creating a second character on an active account that already holds a veteran flips it to skipped. Protocol 25: the `guide` command `{ op: 'done' | 'hint' | 'used', id } | { op: 'skip' | 'replay' | 'finish' }` (validated against the id whitelists, idempotent, rate-limited with the other commands, answered with the usual `character` push; the client applies the same pure rule at once). `foe show <account>` prints the funnel.
- **The tracker.** Eleven steps in three chapters, derived (never a stored cursor) from observable state; evidence of a later step completes the earlier ones of the walk (`device`, `area`, `map`, `open`, `enter`, `fight`, `boss`, `chest`, `home`), then `points` and `equip` complete independently, then the closing *What next* card (`finish`). A fall keeps the tracker on `fight` ("You fell and nothing is lost. Click the portal to try again (N left)"), a spent map asks for another, and a friend's open portal shows one "Follow {name}" line. Parties: every player has their own state; joining a map completes steps 1 to 5 by evidence; nothing posts to chat or blocks.
- **World guidance.** A ring and chevron (DOM overlay driven by `UiStore.world`, the client's per-frame prop projection) mark the target; an edge arrow with the name points at one off screen; unused hideout objects carry name plates (and the reward chest and return portal on a cleared map). The hideout camera leans 52 units north (`PresentInput.cameraBias`) so the Map Device is fully visible at 1280x720 and 1024x600. The return portal opens where the smallest screen shows it: within 110 to 190 units of the player who killed the boss, clear of the boss's fall, the chest and the loot, and inside a view box sized for 1024x600 (`RETURN_PORTAL_VIEW`: left of the open inventory, which docks right and hides everything past about +37 units, and above the command deck); a spot outside the box pays for every unit it lies out, so only walls or the arena edge push it out. The portal card on a cleared map reads "Return portal open", not 0/8.
- **Controls cheat-sheet** on a map entry while `fight` is unlearned (cast, move, flasks, Rift Step, panels); chips dim when used (`UiStore.signals`), it fades 3 s after cast and move, or after 40 s.
- **Warm-up (first map of an account).** On the first `activateMapDevice` of an active guide whose account has no completed map, `RunSetup.warmup` is set and `guide.warmed` recorded: the director (`sim/waves.ts`) holds the opening until a living player moves or casts, or `GUIDE_WARMUP_SECONDS` (15) pass; nothing else about the run changes (not kept across a server restart).
- **Flasks refill for free** on entering a hideout (login included, silently; coming home from a map says "Your flasks are refilled.").
- **Hints.** Seventeen first-time coach cards (`GUIDE_HINT_IDS`), each once per account, one at a time by priority, 25 s apart, never over a modal, the death overlay or the summary, nothing in the first 4 s of a map; the card takes the pointer only on its buttons, pauses while those are hovered or focused, and "Hide tips" (also Esc menu, Help) turns them off for this browser (`Settings.hints`).
- **Help** (`H`, `F1`, `?`, the button right of the deck, the Esc menu): Controls (scrolls under a fixed header), How a run works, a searchable Glossary, Tutorial (progress, **Reset tutorial**, skip, hide, tips). Names: **Map Device** is the object (and its panel), **Atlas** the chart tab; "Cartography Table" and "Ember Chart" are retired.
- **Other fixes:** panel buttons (I C K | P M ?), the death/fell copy by portals left, the summary's next actions and scroll shadow, affix tiers read "Tier N (1 is best)", flask and globe tooltips, event cards open with a one-sentence goal, the padlock only for missing prerequisites, an Atlas that shows only the chart, slot and button before the first clear, the Codex says so while no point was earned, a Bench that opens on Craft with Recycle as a second tab, an inventory Sort (`sortBackpack`), a suggested character name, "Create account" first for a first-time browser, one level-up text, only the nearest three rares keep a name plate.
- **Follow-through (2026-10-06).** Rook's wares print the Forge Scrap price under every tile (red when unaffordable) with a one-line explainer and a per-tab empty state with the restock countdown. Map tooltips open short (tier, area, waves, boss, map luck, the area's effects, up to four mod lines and "+N more", unexplored/corrupted warnings, "Surge n/3 today") and show the full card after 600 ms of hover or while Alt is held; the full card points at Re-chart. Short windows (under 680 px tall) lean the hideout camera west as well as north so the Crafting Bench clears the Life globe at 1024x600.

## 13. Player debuffs

Monsters and bosses apply debuffs to players. Each debuff has a clear visual on the player, an icon with a timer in the HUD, and counterplay.

| Debuff | Effect | Sources (implemented) | Counterplay |
|---|---|---|---|
| **Chilled** (cold) | −30% move and cast speed, 2 s. Refreshes; doesn't stack | Rimeshade touches, Glacial Wisp bursts, Ossuary Golem frost slams, the Choir Wave, the Hollow Warden's novas, spikes and blizzards | Cold resistance shortens it |
| **Frozen** (cold) | Can't move, cast or attack (a cast in progress holds; flasks still work), 0.8 s, then **3 s immunity** to freeze: a freeze during the immunity is only a chill. Only from **telegraphed** attacks | The Hollow Warden's Ice Prison, a Glacial Wisp bursting at point blank | Dodge the telegraph (walk out of the prison, step away from the wisp); Cold resistance shortens it |
| **Rooted** | Can't move on your own, can still cast, 1.4 s. Roots don't chain: while rooted and for **3 s** after a root ends, new roots are ignored (a chain hook still drags) | Frost Weaver web shots, chain hooks (Chain Thralls, the Chainmaster), tar pools | **Rift Step breaks it** |
| **Burning** (fire) | Fire damage over 3 s (40% of the triggering hit). Re-applying refreshes the duration and keeps the strongest | Cinder Spitter lobs, the Matriarch's orbs, fire pools, Volcanic eruptions | The Life flask removes it; Fire resistance shortens it |
| **Bleeding** (physical) | 20% of the hit over 4 s; **×2 while moving**; stacks up to 3 | Pit Hound bites, crossbow bolts, the Chainmaster's whirling chains, Varkus's charge and whirlwind | The Life flask removes it |
| **Shocked** (lightning) | +20% damage taken, 2 s | (future storm family) | Lightning resistance shortens it |
| **Withered** (void) | −12% to all non-physical resistances per stack, 4 s (one shared timer); stacks up to 3 | Rift Stalker leaps, the Herald's void orbs | The Focus flask removes it |

**Duration rules:**
- Durations of the elemental debuffs (chilled and frozen: cold, burning: fire, shocked: lightning) are reduced by the matching resistance: `×(1 − res/2)`. Withered, rooted and bleeding are not.
- Cinder Ward makes every debuff run out twice as fast while it's active (its durations are halved).
- Damage over time (burning, bleeding) was already mitigated by the hit that caused it: armour, resistances, evasion, the ward's reduction and invulnerability don't reduce it, and it can kill.
- Dead players lose all debuffs, and every debuff is lifted when the boss falls (the map is cleared). A dropped connection keeps the character in place, debuffs and all, for the reconnect grace (20 s); a reconnect never cleanses.
- Melee hits never freeze or root, and nothing applies a debuff to a player who is invulnerable (mid Rift Step).

**Chain hooks** drag the victim toward the thrower over 0.25 s (40 units for a Chain Thrall; the Chainmaster reels in from farther), at most 140 units, stopping at the first prop in the way. Client prediction replays the drag, so it doesn't rubber-band.

**Readability:** a debuff never comes from an invisible source. Every root and freeze comes from a projectile you can see or a telegraph you can read. Each debuff has an overlay on the player (frost rime, an ice block, bone / web / chain / tar bindings, flames, blood drips, sparks, a void haze), an icon with a timer and stack count above the HUD's skill bar (hover for its effect and counterplay), a sound when it lands and a cleanse flash when it's removed. The map device readout lists each map type's **Afflictions**: which debuffs its monsters inflict, from what, and the counter.

## 14. Bestiary: a family and final boss per map type

Each of six map bases has its own theme, wave family and final boss. Wave 3 has no lieutenant. The sim picks the roster from `RunConfig.theme`. The three former lieutenants retain their attack patterns, gain 3600 base life / 24 damage / 1000 XP, and grant full final-boss rewards when defeated on wave 6.

### Ashen Forge (fire): existing roster

The roster (Ashling, Ember Skitter, Cinder Spitter, Rift Stalker, Ironhide Brute, **Cinder Matriarch**) now applies these debuffs:
- Burning from Cinder Spitter lobs, Matriarch orbs, fire pools and Volcanic eruptions.
- Withered from Rift Stalker leaps. The Herald’s void orbs now appear in Cinder Chapel.

### Rimed Ossuary (cold, bone)

| Monster | Role | Behaviour |
|---|---|---|
| **Bone Thrall** | swarmer | Clattering skeleton; a short lunge; its bones stay as a corpse. |
| **Rimeshade** | hunter | A drifting ghost. Moves through other monsters and ignores crowding. Its touch chills. Semi-transparent. |
| **Frost Weaver** | artillery | A spindly bone spider. Keeps its distance and fires a slow **web shot** that roots on hit. Visible, and it can be dodged. |
| **Glacial Wisp** | fast | A floating ice shard that rushes you, pulses for 0.7 s (telegraph ring), then bursts: chills everyone in the radius, and freezes them if they're within point blank at the burst. |
| **Ossuary Golem** | bruiser | Big bone-and-ice construct. Telegraphed frost slam that chills. |
| **Bone Chorister** (Choral Crypt boss) | – | Robed singer that keeps 100–165 away. Its aura (radius 110) makes allies +25% faster. Every 9 s it raises Bone Thralls from up to 4 nearby corpses (topped up from the ground to at least 2), never while 160+ monsters are alive. Every 4 s a **Choir Wave**: 2 expanding frost rings with 3 gaps each that you walk through (chill on touch). |
| **The Hollow Warden** (boss) | – | Crowned rime-lich with a frozen lantern. See below. |

The Hollow Warden's attacks:
- **Frost Nova rings** (all phases): telegraphed (she channels 1.2 s), chill at the burst. Her lantern swing chills anyone in reach.
- **Glacial Spikes** (phase 2+): lines of ice spikes erupting in sequence toward players. Chill, and heavy damage.
- **Ice Prison** (phase 2+): a shrinking ring around a player. If they are still inside when it closes they are **Frozen**; walking out breaks it.
- **Summons** Rimeshades: 2 / 2 / 3 every 14 / 13 / 12 s by phase.
- **Phase 3 — Blizzard:** 3 slowly drifting frost storm zones that chill anyone inside.

### Iron Coliseum (physical, bleed, arena)

| Monster | Role | Behaviour |
|---|---|---|
| **Pit Hound** | fast | Lean arena hound. Bites cause **Bleeding**. |
| **Chain Thrall** | hunter | Chained prisoner. Throws a **hook** (a visible line projectile) that **roots** you and pulls you 40 units toward it. |
| **Iron Crossbowman** | artillery | Aims (a 0.6 s laser-line telegraph), then fires a fast bolt that causes Bleeding. |
| **Shieldbearer** | bruiser | Tower shield. **Blocks player projectiles from the front** (a 120° arc), so you have to flank it. Shield bash knockback. |
| **Tar Slinger** | support | Lobs tar that leaves a **tar pool**: slows 50% while you stand in it, and roots on first contact. |
| **The Chainmaster** (Chainworks boss) | – | Whirls chains (a telegraphed spinning ring), hooks the farthest player and pulls them in, and summons Chain Thralls. |
| **Varkus, the Iron Champion** (boss) | – | Gladiator with a greatsword and a shield. See below. |

Varkus's attacks:
- **Charge** (a telegraphed lane that stays drawn for the whole dash; he dashes exactly its length and stops at a pillar; knockback plus Bleeding).
- **Whirlwind** (phase 2+): moves while spinning and trails bleed.
- **Execution Mark:** marks a player (the mark follows them for 2 s, then locks), then after 3 s makes a heavy leap strike at the marked spot. No charge or whirlwind starts while a mark is pending.
- **Crowd's Favour** (phase 3): the arena floor raises spike tiles in a pattern with telegraphs.
- **Summons** Pit Hounds.
- Only the charge and the whirlwind bleed; his sword, the mark and the spikes deal plain physical damage. Nothing of his starts on a rooted or frozen player, so a root never takes a dodge away.

### Scaling and loot

The new monsters use the same scaling, packs, magic and rare mods, XP and loot rules as the existing ones. Base numbers as implemented (before `MonsterScaling`; the Rimed Ossuary's +20% monster life comes on top, which is why its boss starts lower):

| Rimed Ossuary | Life | Speed | Damage | XP | Iron Coliseum | Life | Speed | Damage | XP |
|---|---|---|---|---|---|---|---|---|---|
| Bone Thrall | 21 | 48 | 6 | 3 | Pit Hound | 18 | 64 | 4 | 3 |
| Rimeshade | 32 | 56 | 12 | 7 | Chain Thrall | 36 | 52 | 9 | 7 |
| Frost Weaver | 18 | 40 | 7 | 5 | Iron Crossbowman | 20 | 40 | 6 | 5 |
| Glacial Wisp | 12 | 82 | 8 | 3 | Shieldbearer | 100 | 32 | 18 | 14 |
| Ossuary Golem | 114 | 32 | 22 | 14 | Tar Slinger | 24 | 38 | 7 | 6 |
| **Bone Chorister** | 3600 | 36 | 24 | 1000 | **The Chainmaster** | 3600 | 40 | 24 | 1000 |
| **The Hollow Warden** | 4000 | 60 | 26 | 1000 | **Varkus, the Iron Champion** | 4800 | 46 | 26 | 1000 |

The three promoted commanders use 3600 life / 24 damage; the original Matriarch and Varkus retain 4800 / 26, and the Warden 4000 / 26 before her map’s +20% life. The original three bosses retain their phase scripts; the commanders reuse their continuous cast, summon and aura cycles.

### Later

More map bases, each with its own roster, will follow the same pattern: Drowned Archive, Grave Orchard and a Storm family with the Shocked debuff.

## 15. Auction house: the Echo Exchange

**Status: planned — not built yet.** Nothing below exists in the game today.

A server-wide market where players list items for a price and other players buy them.

**Access.** Every hideout has an **Exchange Board**, a ledger desk with a notice board. Clicking it opens the **Exchange** panel. It can be used in any hideout.

**Selling (listing).**
- **Placing an item:** drag an item (or a currency or flask stack) from your backpack, a stash tab or the Crafting Stash into the "Sell" slot.
  - Stacks can be listed partially: choose the amount.
  - Items in an open trade or on the crafting bench can't be listed.
- **Setting the price:** one currency type (any currency) and an amount between 1 and 5,000.
  - The panel shows the lowest listed prices of similar items (same base or currency) as a hint.
- **Limits:** up to **20 active listings** per character. A listing lasts **48 hours**. Listing is free.
- **Escrow:** a listed item leaves your character and is held by the server.
- **Cancelling** returns the item to your backpack, or to your Collection if there's no room.
- **Expiry:** expired listings return to your **Collection**.

**Buying.**
- **Browsing:**
  - **Search:** the same query syntax as the stash search.
  - **Filters:** item kind (equipment, map, currency, flask), item class, rarity, minimum item level, map tier, and maximum price in a chosen currency.
  - **Sorting:** price, newest, item level.
  - Results are paged (50 per page). Each shows the item card with a full tooltip, Alt-compare against your equipment, the seller's name, the price and the time left.
- **Paying:** pay from your backpack and then your Crafting Stash. The item goes into your backpack; if there's no room, the purchase fails with "Make room first."
- **Rules:** you can't buy your own listings. If two players buy the same listing, the first wins and the second gets "Already sold."
- **Proceeds:** the seller's currency goes into their **Collection**. If they're online they get a toast and a chat line ("Your Blazing Ashwood Wand sold for 12 Forge Scrap"). "Collect all" moves the currency into the Crafting Stash and returned items into the backpack.

**Server authority and safety.**
- Every listing, buy, cancel and collect runs in a single SQLite transaction. Items are re-minted with fresh uids on the buyer's side. Both characters are saved in the same transaction.
- Rate limits apply to searches and to actions.
- Listings survive restarts.
- Tests must prove item and currency conservation across concurrent buys, cancels, expiries and restarts.

**Crafting balance note.** Buying finished items can undercut crafting (see `CONCEPTS.md`). Bench-crafted affixes and fractured affixes stay allowed on listed items. If the market floods the game with top items, the first lever is a small listing fee in Scrap, so it acts as a currency sink.
