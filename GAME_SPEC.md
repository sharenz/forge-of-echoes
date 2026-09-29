# Forge of Echoes v2 — Game Spec (vertical slice, Sorceress only)

Concrete, buildable spec for the from-scratch rewrite. `CONCEPTS.md` holds the why; this holds the what.
Numbers are **starting targets** — tune them with the headless balance bot, but keep the shape.

## 0. Locked decisions (formerly "open")

| Question | Decision |
|---|---|
| Waves per map | **6.** Lieutenant (Ashbound Herald) on wave 3, boss (Cinder Matriarch) on wave 6. Killing the boss clears the map; the remaining monsters crumble to ash. |
| Flask belt | **4 slots**, keys `1`–`4`. |
| Fifth damage type | **void** (purple). |
| Damage types | **Mechanical.** Monster and player resistances exist (capped at 75%). Ailments: fire → **ignite** (burning DoT), cold → **chill** (30% slow), lightning → **shock** (+20% damage taken). |
| Characters | **Permanent, server-side.** On death you drop to the ground and can **respawn to your own hideout**. You keep XP and every picked-up item. Re-entering the map costs a portal. There is no XP penalty. |
| Crafting location | Hideout only (the inventory still opens in maps). |
| Pause | None. The game is online: the `Esc` menu blocks local input, but the world keeps running. |
| Rendering | **WebGL2**, own renderer. Low-resolution pixel-art world (about 360 px tall virtual resolution, integer upscale), dynamic coloured lights, emissive + bloom, vignette and grading. All art is **procedurally generated pixel art** (no image files). |
| Audio | **Procedural WebAudio** (synthesised SFX and music), no audio files. |
| UI | DOM + Preact over the canvas, with the 12/14/17/25 type scale enforced. Fonts: Cinzel (titles) and Alegreya Sans (text). |
| Online | **Online-only, server-authoritative** (see §11). No offline or single-player mode: solo play is a party of one on the server. |
| Trading | None yet. |
| Persistence | Server-side SQLite (`node:sqlite`). Accounts with username and password. `localStorage` holds only the session token and client settings. |
| Pickup | **Equipment is picked up by clicking** its label or sprite; the character walks there first if it's out of reach. Currency, flasks and maps are auto-collected by walking over them. Echo motes (XP orbs) are magnetised Vampire-Survivors style. |
| Aiming | Mouse aim. `LMB` holds the basic attack. `T` toggles auto-attack (the basic attack targets the nearest enemy near the cursor). |
| Affixes | Prefix/suffix split. Magic items have ≤1 prefix and ≤1 suffix; rare items have ≤3 of each. |
| Attributes | +3 allocatable points per level, plus small automatic class growth. |

## 1. Controls

| Input | Action |
|---|---|
| `WASD` / arrows | Move |
| Mouse | Aim |
| `LMB` (hold) | Basic attack (loadout slot 0: Ember Lance) |
| `Space` `Q` `E` `R` `F` | Loadout slots 1–5 (held = cast as soon as usable) |
| `1`–`4` | Flasks |
| `I` / `C` / `K` | Inventory / character / skills |
| `Esc` | Close the top panel, or open the menu (pauses in maps) |
| `Alt` (hold) | Affix tiers, roll ranges and comparison with equipped items |
| `Ctrl`/`⌘`+click | Quick-move |
| `RMB` on currency | Arm the currency, then `LMB` an item to apply it (`Esc`/`RMB` cancels) |
| `T` | Toggle auto-attack |
| Click a hideout object | Map device / stash / merchant (walk-up not required) |

## 2. Core loop

1. **Title:** create or select a Sorceress. You start in the hideout with the starting kit.
2. **Hideout:** a small, lit, walkable ritual courtyard with these objects:
   - **Map Device:** the map slot, a summary panel and an "Activate" button that opens the portal.
   - **Stash:** tabs; opens alongside the inventory.
   - **Rook the merchant:** maps, flasks and gambling.
   - **Training dummy:** shows your damage numbers.
   - Braziers, an anvil and banners for atmosphere.
3. **Enter the portal → map run:**
   - A 3 s "Tell" preview announces each wave's families, then the wave spawns.
   - Waves last 60 s or until cleared. They can stack.
   - The lieutenant arrives on wave 3 and the boss on wave 6. Killing the boss clears the map.
   - On clear: all motes vacuum to you, a chest spawns, and a return portal opens.
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
| Evasion rating | `20 + 3·(L−1) + 2·dex`. Evade chance = `rating / (rating + 250)`, capped at 75% |
| Armour | 0 base. Physical hit reduction = `armor / (armor + 10·damage)` |
| Resistances | 0 base. Capped at 75%. Map mods can add a negative player-resistance penalty |
| Move speed | 110 units/s base (+% from gear) |
| Pickup radius | 90 units base (+% from gear). Drops and echo motes inside it fly to you |
| Spell power | Every skill hit starts from `base = 8 + 1.6·(L−1)` plus `addedSpellDamage`, times the skill's effectiveness (the original target of 5 at L1 left a new character unable to one- or two-shot Tier 1 monsters) |
| Int bonus | +1% increased spell damage per 5 int |
| Dex bonus | +1% increased evasion per 5 dex |
| Str bonus | +1% increased max life per 10 str |
| Crit | 150% base crit multiplier; each skill has a base crit chance |
| XP to next level | `floor(90·L^1.75)` (L1 → 90, L10 → 5.0k, L30 → 34k). Level cap 60 in this slice. +3 attribute points and +1 skill point per level |
| Flasks | Recover over 3 s, never instantly. Life Flask `40 + 8·L` life, Focus Flask `30 + 4·L` focus, both × flask effect. 5 charges per belt slot; pickups refill a matching belt slot first |

**Starting kit:**
- **Equipment:** an equipped magic ilvl 1 Ashwood Wand with a T8 "Blazing" affix (8–12% increased fire damage: the best tier item level 1 can roll) and a normal Ashen Robe.
- **Backpack currency:** 10 Scrap, 4 Kindling, 2 Ember Essence, 1 Reforge, 1 Solvent, 1 Seal, 3 Map Dust, 2 Threat Glyph.
- **Maps:** 2× Tier 1 Ashen Forge and 1× Tier 1 Rimed Ossuary.
- **Belt:** 2 Life Flask slots (3 charges each) and 1 Focus Flask slot (3 charges).
- **Skills:** Ember Lance at rank 1 in loadout slot 0, plus **1 unspent skill point**.

## 4. Skills (rules own the numbers; the sim owns the behaviour)

A rank costs 1 skill point, and each level grants 1 point. Max rank is 20. Numbers below are rank 1 → rank 20 (linear unless noted). Effectiveness multiplies spell power. A new character starts with Ember Lance at rank 1 and one banked point; a skill must be ranked to go on the bar.

| Skill | Tree | Cost / cast / cooldown | Behaviour & numbers |
|---|---|---|---|
| **Ember Lance** | basic (row 0) | 0 / 0.42 s / – | Fast fire bolt toward the cursor. Effectiveness 1.0 → 2.3, speed 420, range 320, pierce 0 (+1 at ranks 6/12/18), crit 6%, ignite 10%. Leaves an ember trail. |
| **Ember Nova** | destruction row 1 | 12 / 0.55 s / 3.0 s | Ring of 12 → 24 flame projectiles (+1 per rank beyond the first 4 ranks, capped at 24 from rank 16) bursting outward. Effectiveness 1.0 → 1.8 (so each flame of a rank-1 Nova hits as hard as a Lance bolt), speed 260, range 170, pierce 1 (+1 per 5 ranks: 5 at rank 20), crit 5%, ignite 15%. |
| **Flame Wave** | destruction row 2 (Nova 3) | 16 / 0.5 s / 4.0 s | Fan of 5 → 9 slow, wide flame waves (spread 0.9 rad) that pierce everything. Effectiveness 1.1 → 2.4, speed 180, range 170, radius 14, crit 5%, ignite 25%. |
| **Rime Shards** | destruction row 2 (Nova 3) | 8 / 0.34 s / – | Fan of 3 → 7 ice shards (+1 at ranks 5, 9, 13, 17), spread 0.35 rad. Effectiveness 0.55 → 1.2, speed 360, range 260, pierce 2, chill 30%, crit 8%. |
| **Arc Chain** | destruction row 3 (Rime 5) | 14 / 0.38 s / 1.0 s | Lightning strikes the enemy nearest the cursor (within 240) and chains 3 → 8 times (jump range 90). Effectiveness 0.9 → 2.0, shock 25%, crit 10%. |
| **Rift Step** | mobility row 1 | 8 / instant / 3.5 s per charge | Blink toward the cursor, distance 90 → 120. 2 charges (+1 at ranks 10 and 20). 0.2 s invulnerable. Afterimages. |
| **Cinder Ward** | survival row 1 | 20 / 0.3 s / 14 → 9 s | For 4 → 7 s: 35% → 55% less damage taken (capped at 60%), and embers burn adjacent monsters (radius 40) for 0.25× effectiveness per 0.5 s, crit 5%. |

Skill damage per hit = `(spellPower + addedSpellDamage) × effectiveness × (1 + Σincreased%) × Πmore`. Increased sources are spellDamage, the element's damage and elementalDamage (fire, cold, lightning). Each hit rolls ×0.8–1.2 (midpoint 1), then crit, then the target's resistance.

Player modifiers on skills (resolved by the rules into the sim's numbers, so tooltips and combat agree):
- Cast time = base / cast speed; cooldown = base / cooldown recovery (per charge for Rift Step).
- Crit chance = (skill base + flat) × (1 + increased%); crit multiplier = 150% + flat.
- Ailment chance = the skill's base + flat ignite / chill / shock chance, by damage type.
- Extra projectiles and pierce add to projectile skills (Lance, Nova, Flame Wave, Rime Shards). A single-bolt skill fans its extra bolts 0.12 rad apart (at most 0.6 rad).
- Area of effect multiplies Nova range and Flame Wave / Cinder Ward radius by `sqrt(1 + area%)`; skill duration scales Cinder Ward.

## 5. Items

**Bases** (`src/contracts/content.ts` ids). The item level of drops = monster level. Every base has one implicit (Glassbone Wand and Ashen Robe have two). Base properties scale gently with item level: `floor(base + perLevel·ilvl)`, and the item's own flat / % lines of that stat fold into the property.

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

**Rarity:** normal 0 affixes; magic 1–2 (≤1 prefix, ≤1 suffix; 1 or 2 at 50/50); rare 3–6 (≤3 prefixes, ≤3 suffixes; 3: 25% · 4: 40% · 5: 25% · 6: 10%); unique fixed.

**Rare names** come from two word lists (for example "Ember" + "Bite", "Grave" + "Coil"), with 40 words each.

**Affixes:** 39 (15 prefixes, 24 suffixes), each with 5–8 tiers (T1 best), except "of Splintering" (1 tier). Item level unlocks tiers; weights fall steeply, so the top tiers (ilvl 68–75) stay rare even on high-level items:

| Tiers | Item level per tier (worst → best) | Weight per tier (worst → best) |
|---|---|---|
| 5 | 1 / 14 / 32 / 50 / 68 | 1000 / 700 / 400 / 150 / 40 |
| 6 | 1 / 10 / 24 / 40 / 56 / 70 | 1000 / 750 / 500 / 280 / 110 / 30 |
| 7 | 1 / 8 / 18 / 30 / 44 / 58 / 72 | 1000 / 800 / 600 / 400 / 220 / 90 / 25 |
| 8 | 1 / 6 / 14 / 24 / 36 / 48 / 62 / 75 | 1000 / 800 / 600 / 400 / 250 / 120 / 50 / 15 |

| Kind | Affixes |
|---|---|
| Prefixes | flat max life (T1 63–76) · flat max focus · added spell damage (wand/sceptre/focus/amulet/ring; T1 22–27) · % spell damage (weapon/focus/amulet; T1 65–78%) · % fire / cold / lightning damage (weapon/focus/amulet/ring; T1 59–70%) · % elemental damage (ring/amulet) · flat armour / flat evasion (armour pieces with that property) · % armour / % evasion (armour pieces with that property) · % item rarity (helm/gloves/boots/amulet/ring, 5–32% — *luck*) · life on kill (weapon/gloves/belt/ring) · focus on kill (weapon/focus/gloves/belt/amulet) |
| Suffixes | % cast speed (weapon/gloves/amulet/ring) · % crit chance (weapon/focus/helm/amulet) · crit multiplier (weapon/amulet) · fire / cold / lightning resistance (armour, belt & jewellery; T1 41–45%) · void resistance (T1 26–30%) · all resistances (amulet/ring) · % move speed (boots) · % focus regen (helm/focus/amulet/ring) · life regen (chest/belt/ring) · str / dex (armour, belt & jewellery) · int (also weapons and foci) · % projectile speed (weapon) · % area (focus/amulet) · % cooldown recovery (helm/amulet) · % pickup radius (belt/boots) · % item quantity (belt/amulet, 3–18% — *luck*) · % flask effect (belt) · ignite / chill / shock chance (weapon/gloves) · **+1 projectile** ("of Splintering", wand only, T1 only, ilvl 70+, weight 15) |

Luck affixes (item quantity / rarity) are personal: they raise only their wearer's drops (§9, §11).

**Uniques** (any equipment drop at weight `0.2·m^1.5` of about 100, the boss's own 8%×m roll, and the gamble at 0.5%×m; m = rarity / 100 — the looter's personal rarity for drops, gear rarity for the gamble). Only uniques you could wear can appear: a drop picks among those whose level requirement ≤ its item level (Tier 1, item level 12: only The Patient Spark; Tier 2: + Cinderwalkers; Tier 3+: all four), otherwise it becomes a rare; the gamble offers a unique only when one of the class is ≤ your level. They keep their base's implicit and properties and cannot be crafted:

| Unique | Base | Effects | Flavour |
|---|---|---|---|
| **The Patient Spark** (level 12) | Ashwood Wand | +(30–45)% fire damage · 15% reduced cast speed · Ember Lance pierces all targets (`lancePierceAll`) | "It waits for the whole line." |
| **Cinderwalkers** (level 16) | Ashen Sandals | +(15–20)% move speed · +(20–30)% fire resistance · burning trail (`fireTrail`) | "Where she walked, the ash remembered." |
| **Echo of the Matriarch** (level 20) | Cinder Pendant | +(15–25) max focus · Ember Nova repeats once after 0.4 s (`novaEcho`) · 8% reduced max life | "Her last command still rings in the embers." |
| **Ruinheart Band** (level 24) | Void Signet | +1 projectile · +(20–30)% void resistance · 12% increased damage taken | "Power pours from the wound, not the hand." |

## 6. Crafting (the heart)

**Stability:**
- Every non-unique item has `maxStability` from its base; it starts full.
- Each operation costs stability.
- **Scar risk:** if the remaining stability after paying is ≤ 2 (≤ 3 on Glassbone), there's a 35% chance to gain a scar. Scars are a permanent negative line; items can have at most 2, never the same one twice:

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
- **At 0 stability** the item is **Finished**: no more crafting, and it's never destroyed.
- A craft that would do nothing is rejected without consuming anything.

| Currency | Family | Cost | Effect |
|---|---|---|---|
| Kindling Shard | shape | 1 | Normal → magic with 1–2 random affixes. |
| Forge Scrap | shape | 1 | Rerolls the values of all unsealed, unfractured affixes within their tiers. Also the merchant money. |
| Reforging Ember | shape | 2 | Rerolls all unsealed, unfractured affixes into a new **rare** (3–6 total). |
| Essence (Ember / Rime / Storm / Vital / Swift) | shape | 2 | Adds one affix with that tag. Ember = fire, Rime = cold, Storm = lightning, Vital = life/defence/resistance, Swift = speed (cast/move/projectile). Normal → magic; magic with 2 → rare. Fails if no room. |
| Tempering Catalyst | refine | 3 | **Choose an affix:** upgrade it one tier (if item level allows) and reroll its value in the new tier. |
| Forge Solvent | remove | 1 | Removes the **lowest-tier** unsealed, unfractured affix (ties random). With 0 affixes left, the item becomes normal. |
| Binding Seal | preserve | 0 | **Choose an affix:** it is sealed for the next operation, then the seal breaks. One seal at a time. |
| Fracture Core | transform | 3 | **Choose an affix:** it becomes permanently fractured, immune to everything. One fracture per item. |

Currencies stack to 40 (Fracture Core and Void Needle to 20). Map currencies cost no stability.

Tooltips and the craft preview show exact odds, for example "Adds one of 5 fire affixes: Blazing 34%, Smouldering 28%, …", filtered by item class, free prefix/suffix room and item level.

Every craft appends a line to `item.history`, so the item carries its own story.

**Map currencies:**
- **Map Dust:** normal → magic (1 or 2 danger mods, 50/50), or rerolls the danger mods of a magic map (1–2) or a rare map (3–4, 50/50). A reward mod is kept.
- **Threat Glyph:** adds one danger+reward mod; the map becomes rare at 3+ danger mods (max 4).
- **Reward Ink:** adds one reward-only mod (max 1 per map; it doesn't count toward rarity).
- **Void Needle:** corrupts the map; after that it can't be modified. Outcomes (the +1 tier outcome is left out at Tier 15):

  | Chance | Outcome |
  |---|---|
  | 30% | A corrupted mod (strong danger + strong reward) |
  | 20% | +1 tier |
  | 20% | Becomes rare with 4 mods |
  | 15% | +1 wave: a 7th "Echo" wave with double loot |
  | 15% | Nothing except corruption |

## 7. Maps

**Map bases** (each has its own theme and palette):

| Base | Theme / palette | Arena radius | Implicit (implemented) |
|---|---|---|---|
| Ashen Forge | Lava-cracked basalt, ember light | 900 | Ember Essences 3× as likely; monsters +10% to all resistances |
| Rimed Ossuary | Frosted bone-tiles, cold blue light, ice crystals | 900 | Rime Essences 3× as likely; +20% monster life; +15% item rarity |
| Iron Coliseum | Rusted iron plates, sand, torchlight | 650 | +25% monster count; armour bases +2 stability |

**Tier:** 1–15. Monster level = `min(90, 6 + tier·6)` (= the item level of every drop). Tier scaling (compounding per tier above 1, shown as "more" in the readout): monster life ×1.16, damage ×1.10, experience ×1.28 (Tier 5: 2.7×, Tier 15: 31.7×), and +5% item rarity per tier (additive).

**Early-tier easing** on top, so a new character with the starting kit clears Tier 1 and the full scaling arrives at Tier 5. It tapers fast so the first levels and drops don't outrun it: Tiers 2–4 must keep pushing back (guarded by the balance playthroughs, which also check that Tiers 2 and 3 still cost life or flasks):

| Tier | Monster life | Monster damage |
|---|---|---|
| 1 | 65% less | 40% less |
| 2 | 35% less | 15% less |
| 3 | 25% less | 10% less |
| 4 | 10% less | – |

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

**Map drops:**
- The next tier is only guaranteed from the completion chest.
- Random map drops are same tier 60%, one lower 25%, one higher 15% (within 1–15). Their rarity mirrors equipment (normal 70 · magic 27·m · rare 3·m^1.3); all three bases are equally likely.
- The merchant always sells T1 (free) and T2 (4 Scrap).

## 8. Waves & monsters (the sim owns these numbers)

**Wave budget:** `baseMonsters 40 + 18·(wave−1)` × countMultiplier, over 60 s.
- 60% of the budget is placed at wave start as **packs** (4–8 monsters) around the arena, at least 250 units from the player. Hunting them is the "PoE" part.
- 40% **streams** from just off-screen toward the player over the wave. This is the "VS" pressure.
- A wave ends when its monsters are dead **or** at 60 s. Waves can stack.

**Per-wave growth** (sim-side): +8% monster life and +4% damage per wave.

**Pack rarity:**
- Magic chance: 10% × magicPackChance multiplier. The whole pack is magic and shares one mod: Swift (+30% speed), Stout (+70% life) or Fierce (+40% damage). Blue outline.
- Rare chance: 3% × multiplier. A single rare leader gets 2 mods from Juggernaut (+200% life), Frenzied (+50% speed), Ember-touched (fire burst on death, telegraphed) and Warded (40% less damage while allies are near). Gold outline and its name floats above it. The rest of the pack is normal.

**Loot** (rolled per player, §9): a magic monster gets ×1.5 quantity and ×2 rarity; a rare gets ×4 quantity and ×3 rarity; the lieutenant and the boss roll their ordinary loot like rares, on top of their guaranteed drops. Summoned minions drop nothing. **XP:** magic ×2, rare ×6.

| Monster | Role | Radius | Life | Speed | Damage | XP | From wave | Behaviour |
|---|---|---|---|---|---|---|---|---|
| Ashling | swarmer | 6 | 22 | 50 | 6 | 3 | 1 | Walks at the player; short lunge-bite. |
| Ember Skitter | fast | 5 | 12 | 95 | 4 | 2 | 1 | Zig-zags in bursts. |
| Cinder Spitter | artillery | 7 | 18 | 40 | 8 | 5 | 2 | Keeps 140–220 away; spits every 2.4 s (projectile speed 150, visible arc). |
| Rift Stalker | hunter | 8 | 40 | 60 | 14 | 8 | 3 | Every 4 s: a 0.6 s landing telegraph (radius 26), then a leap. |
| Ironhide Brute | bruiser | 12 | 120 | 34 | 22 | 14 | 4 | 0.9 s windup slam telegraph (radius 42). 40% physical reduction. |
| **Ashbound Herald** | lieutenant, wave 3 | 14 | 1200 | 38 | 16 | 150 | – | **Aura** (radius 110): allies +30% speed and damage. Every 6 s summons 6 ashlings. Every 3 s fires 5 orbs in a spread. |
| **Cinder Matriarch** | boss, wave 6 | 24 | 7000 | 42 | 26 | 1000 | – | 3 phases at 100/66/33% life. **Orb spiral** (all phases). **Slam** (telegraph radius 70). **Meteor rain** (phase 2+: 6–10 telegraphs, then fire pools). **Charge** (phase 3: telegraphed line). Phase 2+ summons skitters. Phase changes are marked by a roar and a short flash. |

All life and damage values are then multiplied by `MonsterScaling`.

**Contact damage:**
- Each monster type has an attack cooldown.
- Player hit immunity after a melee hit is 0.25 s **per attacker**.
- Total melee damage is capped at 35% of max life per 0.5 s window, so hordes are dangerous but never cause an unreadable one-frame death.

**Performance target:** 800 live monsters + 600 projectiles at 60 Hz sim + 60 fps render, on a laptop.

## 9. Loot & luck

**Loot is instanced** (§11): every kill and the completion chest roll separately for each living player in the map, and each player sees and picks up only their own drops. A player who dies and re-enters through a portal rolls again from their next kill on.

**Personal luck:** a player's item quantity / rarity in a map = the map-side luck (tier, quality, implicit, mods: §7) + that player's gear (`rules.lootLuck`). Example: a map at +26% quantity and a player with a +10% quantity amulet → 136% for that player's drops; a party member without luck gear rolls at 126%.

**Per kill and player**, Q% and R% = personal luck × the monster's rarity multiplier (§8), with quantity doubled in the Echo wave. Each category is rolled independently: `chance = base × Q/100` (maps also × map drop chance: quality, Cartographer's). A chance above 100% drops `floor(chance)` items plus one more with the remainder.

| Category | Base chance | Contents |
|---|---|---|
| Currency | 4% | Scrap 40 · Kindling 22 · Map Dust 12 · Solvent 5 · Reforge 4 · Threat Glyph 3 · each Essence 2.4 (×5) · Seal 2.5 · Reward Ink 1.4 · Catalyst 1.6 · Void Needle 0.6 · Fracture Core 0.25. Scrap drops in stacks of 1 (70%), 2 (22%) or 3 (8%). Map implicits and Essence-laden multiply essence weights |
| Equipment | 1.8% | Uniform over the bases whose level requirement ≤ item level; item level = monster level. A unique roll picks among the uniques wearable at that item level (§5), else it becomes a rare |
| Flask | 1.2% | Life 60 · Focus 40 |
| Map | 0.6% | See section 7 |

**Equipment rarity** (m = R/100):
- normal weight 70
- magic 27·m
- rare 3·m^1.3
- unique 0.2·m^1.5

**Guaranteed drops** (for every player present, on top of the ordinary roll; m = that player's personal rarity / 100):
- **Lieutenant:** 2 equipment (≥ magic, the second ≥ rare 30% of the time), 4 currency, map 50%.
- **Boss:** 3 equipment (1 guaranteed rare, 2 ≥ magic), 6 currency, and an 8%×m chance of a unique.
- **Completion chest:** 2 equipment (≥ magic), 3–6 currency, 1 flask, and **1 map of tier+1 (guaranteed**, quality 4–12, capped at Tier 15).

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

**Gambling at Rook:** 6 Scrap buys a random item of a chosen class at the player's level, with magic 25%, rare 6% and unique 0.5% (×m from gear rarity; unique only for classes with a unique whose level requirement ≤ the player's level — a wand from level 12, a ring from 24; offered only for classes with a base at the player's level).

**Merchant stock:**
- T1 map (free) and T2 map (4 Scrap)
- Life and Focus flasks (1 Scrap)
- Kindling (3 Scrap)
- Map Dust (3 Scrap)
- Gamble per class

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
- The type scale is strictly 12/14/17/25 px.
- Item icons are generated pixel art, upscaled with `image-rendering: pixelated`.

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
  - The stash always opens the *viewer's own* stash.
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
- There is party chat.

**Loot is instanced.** Every kill rolls loot separately for each player in the instance, using the map's luck plus that player's own gear luck (`rules.lootLuck`). Each player sees and picks up only their own drops; there's no loot stealing. The completion chest gives every player present their own chest loot.

**XP is shared.** Each echo mote grants its XP to every player in the instance, whoever collects it.

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
- Saves are debounced per character (1 s) and flushed on leave and shutdown.
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

**Special stash tabs** (every character has all three, in addition to the normal tabs; they don't count towards `MAX_STASH_TABS`).

**Map Stash.** Holds up to 400 maps.
- Maps are shown grouped by tier (T1–T15). Each tier shows its count and expands into a list sectioned by map base.
- Each map is shown with its icon, rarity colour, mod count and a corrupted marker, plus a full tooltip.
- **Depositing:** drag or Ctrl-click a map from the backpack. It files itself automatically.
- **Withdrawing:** drag to the backpack or the map device, or Ctrl-click (to the backpack; to the map device while its panel is open).

**Crafting Stash — Equipment.** One fixed, labelled slot per equipment currency: Kindling, Scrap, Reforge, the 5 Essences, Catalyst, Solvent, Seal and Fracture Core.
- Each slot holds up to 5,000 of its currency.
- **Depositing:** dropping or Ctrl-clicking any currency stack of that kind files it into its slot, wherever you drop it. A "Deposit all" button moves every currency in the backpack.
- **Withdrawing:**

  | Action | Takes |
  |---|---|
  | Drag / Ctrl-click | A full stack (up to the backpack stack size of 40) |
  | Shift+Ctrl-click | Exactly 1 |

- **Crafting straight from the stash:** right-click a slot to arm that currency, then left-click an item in the backpack, the stash or equipment. Each use draws from the slot. This works wherever the stash works (any hideout).

**Crafting Stash — Maps.** The same, for map currencies: Map Dust, Threat Glyph, Reward Ink and Void Needle.

**Model.**
- `CharacterSave.currencyStash` (count per currency) and `CharacterSave.mapStash` (list of maps). Old saves normalise to empty.
- A currency slot is addressed by the synthetic uid `cstash:<currencyId>`, like `belt:<i>`.
- New item locations: `currencyStash`, `mapStash`.
- `moveItem` gains an optional `count`, for splits and single withdrawals.
- `quickMove`'s stash context accepts `'currency' | 'maps'`.
- Stash search covers the special tabs too.

## 13. Player debuffs

Monsters and bosses apply debuffs to players. Each debuff has a clear visual on the player, an icon with a timer in the HUD, and counterplay.

| Debuff | Effect | Typical sources | Counterplay |
|---|---|---|---|
| **Chilled** (cold) | −30% move and cast speed, 2 s. Refreshes; doesn't stack | Rimed Ossuary monsters, frost projectiles | Cold resistance shortens it |
| **Frozen** (cold) | Can't move or act, 0.8 s, then **3 s immunity** to freeze. Only from **telegraphed** attacks | Hollow Warden's Ice Prison, Glacial Wisp detonation at point blank | Dodge the telegraph |
| **Rooted** | Can't move, but can still cast, 1.4 s | Frost Weaver webs, Chain Thrall grapple, Chainmaster hook, tar pools | **Rift Step breaks it** |
| **Burning** (fire) | Fire damage over 3 s (40% of the triggering hit). Re-applying refreshes the duration and keeps the strongest | Ashen Forge fire hits, fire pools, eruptions | The Life flask removes it |
| **Bleeding** (physical) | 20% of the hit over 4 s; **×2 while moving**; stacks up to 3 | Pit Hounds, Crossbow bolts, Varkus | The Life flask removes it |
| **Shocked** (lightning) | +20% damage taken, 2 s | (future storm family) | Lightning resistance shortens it |
| **Withered** (void) | −12% to all resistances per stack, 4 s; stacks up to 3 | Rift Stalkers, void orbs of the Herald | The Focus flask removes it |

**Duration rules:**
- Elemental durations are reduced by the matching resistance: `×(1 − res/2)`.
- Cinder Ward halves every debuff duration while it's active.
- Dead players lose all debuffs.

**Readability:** a debuff never comes from an invisible source. Every root and freeze comes from a projectile you can see or a telegraph you can read.

## 14. Bestiary: a family, lieutenant and boss per map type

Each map base has its own theme, monster family, lieutenant (wave 3) and boss (final wave). The sim picks the roster from `RunConfig.theme`.

### Ashen Forge (fire): existing roster

The roster (Ashling, Ember Skitter, Cinder Spitter, Rift Stalker, Ironhide Brute, **Ashbound Herald**, **Cinder Matriarch**) now applies these debuffs:
- Burning from Cinder Spitter lobs, Matriarch orbs and fire pools.
- Withered from Rift Stalker leaps.

### Rimed Ossuary (cold, bone)

| Monster | Role | Behaviour |
|---|---|---|
| **Bone Thrall** | swarmer | Clattering skeleton; a short lunge; its bones stay as a corpse. |
| **Rimeshade** | hunter | A drifting ghost. Moves through other monsters and ignores crowding. Its touch chills. Semi-transparent. |
| **Frost Weaver** | artillery | A spindly bone spider. Keeps its distance and fires a slow **web shot** that roots on hit. Visible, and it can be dodged. |
| **Glacial Wisp** | fast | A floating ice shard that rushes you, pulses for 0.7 s (telegraph ring), then bursts: chills everyone in the radius, and freezes them if they're within point blank at the burst. |
| **Ossuary Golem** | bruiser | Big bone-and-ice construct. Telegraphed frost slam that chills. |
| **Bone Chorister** (lieutenant) | – | Robed singer. Its aura makes allies +25% faster. Every 7 s it raises Bone Thralls from nearby corpses (or from the ground). Every 4 s a **Choir Wave**: 2 expanding frost rings you walk through at the gaps (chill on touch). |
| **The Hollow Warden** (boss) | – | Crowned rime-lich with a frozen lantern. See below. |

The Hollow Warden's attacks:
- **Frost Nova rings** (all phases): telegraphed.
- **Glacial Spikes** (phase 2+): lines of ice spikes erupting in sequence toward players. Chill, and heavy damage.
- **Ice Prison** (phase 2+): a shrinking ring around a player. If they are still inside when it closes they are **Frozen**; walking out breaks it.
- **Summons** Rimeshades.
- **Phase 3 — Blizzard:** 3 slowly drifting frost storm zones that chill anyone inside.

### Iron Coliseum (physical, bleed, arena)

| Monster | Role | Behaviour |
|---|---|---|
| **Pit Hound** | fast | Lean arena hound. Bites cause **Bleeding**. |
| **Chain Thrall** | hunter | Chained prisoner. Throws a **hook** (a visible line projectile) that **roots** you and pulls you 40 units toward it. |
| **Iron Crossbowman** | artillery | Aims (a 0.6 s laser-line telegraph), then fires a fast bolt that causes Bleeding. |
| **Shieldbearer** | bruiser | Tower shield. **Blocks player projectiles from the front** (a 120° arc), so you have to flank it. Shield bash knockback. |
| **Tar Slinger** | support | Lobs tar that leaves a **tar pool**: slows 50% while you stand in it, and roots on first contact. |
| **The Chainmaster** (lieutenant) | – | Whirls chains (a telegraphed spinning ring), hooks the farthest player and pulls them in, and summons Chain Thralls. |
| **Varkus, the Iron Champion** (boss) | – | Gladiator with a greatsword and a shield. See below. |

Varkus's attacks:
- **Charge** (a telegraphed line; knockback plus Bleeding).
- **Whirlwind** (phase 2+): moves while spinning and trails bleed.
- **Execution Mark:** marks a player, then after 3 s makes a heavy leap strike at the marked spot.
- **Crowd's Favour** (phase 3): the arena floor raises spike tiles in a pattern with telegraphs.
- **Summons** Pit Hounds.

### Scaling and loot

The new monsters use the same scaling, packs, magic and rare mods, XP and loot rules as the existing ones.

| Kind | Life | Damage | XP |
|---|---|---|---|
| Swarmers | ≈ Ashling | ≈ Ashling | ≈ Ashling |
| Bruisers | ≈ Ironhide Brute | ≈ Ironhide Brute | ≈ Ironhide Brute |
| Lieutenants | ≈ Herald | ≈ Herald | ≈ Herald |
| Bosses | ≈ Matriarch (× tier easing) | ≈ Matriarch | ≈ Matriarch |

### Later

More map bases, each with its own roster, will follow the same pattern: Drowned Archive, Grave Orchard and a Storm family with the Shocked debuff.
