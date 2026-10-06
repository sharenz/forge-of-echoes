# Atlas tree: every node

Generated from `src/data/progression/map-tree.ts` (the data is the source of truth). `tests/game-progression/atlas-tree-spec.test.ts`
fails when this file differs from the data; regenerate it with `UPDATE_ATLAS_DOC=1 npx vitest run tests/game-progression/atlas-tree-spec.test.ts`.
Type: S small, N notable, K keystone, T tier bonus, Seal theme seal. Net is reward minus carried danger in ledger units (tier bonuses at
Tier 15, everything else at Tier 9). Status "Awaits ..." means the node is fully specified but its engine is not live, so it cannot be allocated yet.

**Cartography**

| Node | Type | Cost | Effect | Net | Status |
|---|---|---|---|---|---|
| **Waypoint** | S | 1 | 8% increased chance to find maps. | 1.0u | Active |
| **Milestone** | S | 1 | 8% increased chance to find maps. | 1.0u | Active |
| **Cairn** | S | 1 | Dropped maps have +2 quality. | 1.0u | Active |
| **Chart Keeper** | N | 1 | 22% increased chance to find maps. The completion chest map has +3 quality. | 4.0u | Active |
| **Lamplighter** | S | 1 | 12% increased chance to find scarabs. | 1.0u | Active |
| **Far Horizon** | N | 1 | Completion chests upgrade the map one tier +10 percentage points more often. Tier 15 stays capped and Compass keeps working. | 4.0u | Active |
| **Ledgerline** | S | 1 | Territory fee -1 Scrap (minimum 0). | 1.0u | Active |
| **Master Surveyor** | N | 1 | A boss kill has a 35% chance to reveal one more neighbour. | 3.9u | Active |
| **Signpost** | S | 1 | The completion chest map has +2.5 quality. | 1.0u | Active |
| **Trailmark** | S | 1 | 50% increased chance to find Hourglass Sand. | 1.0u | Active |
| **Lantern-Bearer** | N | 1 | +1 daily surge charge. Second Wind: every Atlas area holds 4 surge charges a day instead of 3 (the day turns over at 04:00 UTC). | 4.0u | Active |
| **Survey Stake** | S | 1 | Beacons reach 20 chart pixels further. Every beacon covers areas 20 chart pixels further away (the Territory lens draws the rings). | 1.0u | Active |
| **Charter Ink** | S | 1 | The completion chest map has +2.5 quality. | 1.0u | Active |
| **Lamp Oil** | S | 1 | +1 daily surge charge in dead-end and sealed areas. Sigils you slot last 3 more uses. | 1.0u | Active |
| **Fifth Socket** | N | 1 | The Map Device has a fifth scarab socket. Scarab families still allow one scarab each. | 4.0u | Awaits the Map Device update |
| **Lightkeeper** | N | 1 | Every one-slot beacon gains 1 more sigil slot. Shallow through-route areas and dead ends become two-slot beacons, like the deep and sealed ones. | 4.0u | Active |
| **Cartographer's Pen** | S | 1 | A spent surge charge has a 10% chance not to be consumed. Afterglow: rolled from the map seed when you open the map; the surge bonus still applies. | 1.0u | Active |
| **Wagered Charts** | K | 2 | From Tier 4, completion chests always upgrade your map by one tier (Tier 15 stays capped). The chest map arrives as a Rare with 3 danger mods and 0 quality, and is account-bound. Maps dropped by monsters can no longer roll higher than your tier. | 6.5u | Awaits the map crafting update |
| **Twinned Sockets** | K | 2 | You may load two scarabs of the same family; the second works at 50% strength. Monsters have 6% more Life per loaded scarab. Wave duration never drops below 25 seconds. | 5.0u | Awaits the Map Device update |
| **Dead-End Devotee** | K | 2 | 24% more item quantity in dead-end and sealed areas. 30% more boss ingredient chances in dead-end and sealed areas. 25% less item quantity in through-route areas. A boss kill has a 100% chance to reveal one more neighbour. Bosses reveal one neighbour instead of two (a slower Atlas). | 5.5u | Active |

**Foundry**

| Node | Type | Cost | Effect | Net | Status |
|---|---|---|---|---|---|
| **Essence Seeker** | S | 1 | 8% increased essence weight. | 1.0u | Active |
| **Ashwright** | S | 1 | 8% increased ember essence weight. | 1.0u | Active |
| **Rimewright** | S | 1 | 8% increased rime essence weight. | 1.0u | Active |
| **Sound Foundations** | N | 1 | Non-unique armour drops with +1 maximum Stability. | 3.3u | Active |
| **Seal-Mender** | S | 1 | 8% increased Binding Seal weight in ordinary currency drops. | 1.0u | Active |
| **Deep Seams** | N | 1 | 40% more essence weight. 5% more monster life. | 3.0u | Active |
| **Scrapper** | S | 1 | 8% increased Forge Scrap weight in ordinary currency drops. | 1.0u | Active |
| **Steady Anvil** | N | 1 | Non-unique equipment drops with +1 maximum Stability. 10% less equipment drops. | 3.0u | Active |
| **Solvent Sense** | S | 1 | 8% increased Forge Solvent and Tempering Catalyst weight in ordinary currency drops. | 1.0u | Active |
| **Bellows** | S | 1 | 8% increased essence weight. | 1.0u | Active |
| **Ingredient Hunter** | N | 1 | 50% more boss ingredient chances. | 4.2u | Active |
| **Crucible Ash** | S | 1 | 8% increased essence weight. | 1.0u | Active |
| **Flux** | S | 1 | 8% increased Kindling Shard weight in ordinary currency drops. | 1.0u | Active |
| **Tongs** | S | 1 | 8% increased Reforging Ember weight in ordinary currency drops. | 1.0u | Active |
| **Cataloguer's Shelf** | N | 1 | 2% more monster damage. 25% more Tempering Catalyst weight in ordinary currency drops. 15% more Fracture Core weight in ordinary currency drops. | 4.1u | Active |
| **Slag Skimmer** | S | 1 | 8% increased Map Dust weight in ordinary currency drops. | 1.0u | Active |
| **Single-Minded Furnace** | K | 2 | Choose one Essence family at the Map Device: its weight is four times as high (x4 more), fixed for the expedition. All other Essences have 75% less weight; Scrap drops are 30% less. | 6.0u | Awaits the Map Device update |
| **Blank Slate** | K | 2 | Non-unique equipment drops with +2 maximum Stability. 45% more equipment drops. All equipment drops Normal; Item Rarity no longer affects equipment. Item Rarity still improves currency, maps and flasks. No Magic or Rare equipment drops, and completion chest equipment is Normal too. | 6.0u | Active |

**Bounty**

| Node | Type | Cost | Effect | Net | Status |
|---|---|---|---|---|---|
| **Marked Prey** | S | 1 | 8% increased chance of magic and rare packs. | 0.8u | Active |
| **Thick Herds** | S | 1 | 3% increased number of monsters. 4% increased item quantity. | 0.7u | Active |
| **Iron Hides** | S | 1 | 3% increased monster life. 3% increased item quantity. | 0.5u | Active |
| **Rare Blood** | N | 1 | 30% more quantity from rare monsters. 15% more chance of rare packs. | 2.5u | Active |
| **Scent Trail** | S | 1 | 8% increased quantity from rare monsters. | 1.0u | Active |
| **Fat Packs** | N | 1 | 40% more chance of magic packs. 6% increased number of monsters. | 2.8u | Active |
| **Stragglers' Cull** | S | 1 | Monsters that left their pack are worth 6% more quantity. | 1.0u | Awaits the monster update |
| **Elder Blood** | N | 1 | 14% increased item rarity. 8% more chance of rare packs. | 2.8u | Active |
| **Hunter's Mark** | S | 1 | 8% increased chance of magic and rare packs. | 0.8u | Active |
| **Blood Trail** | S | 1 | 3% increased item quantity. 1.5% increased monster movement speed. | 0.6u | Active |
| **Warded Hunts** | N | 1 | Rare monsters are twice as likely to roll an elemental-proof mod (tier gating unchanged); each proofed rare grants one extra equipment roll on death. | 3.5u | Awaits the monster update |
| **Skinner** | S | 1 | 8% increased quantity from rare monsters. | 1.0u | Active |
| **Pack Leaders** | S | 1 | 8% increased chance of magic and rare packs. | 0.8u | Active |
| **Bone Pile** | S | 1 | 3% increased item quantity. | 1.0u | Active |
| **Culler's Ledger** | S | 1 | 3% increased item quantity. | 1.0u | Active |
| **Rare or Nothing** | K | 2 | 100% less chance of magic packs. 120% more chance of rare packs. 60% more quantity from rare monsters. Magic packs no longer spawn, so about half of the horde's loot is gone: rare packs must carry it. | 7.0u | Active |
| **Empty Halls** | K | 2 | 50% reduced number of monsters. 80% more item quantity. 60% more monster life. 35% more monster damage. Half the monsters, each tougher, hitting harder and worth far more: total loot barely changes, so this is a style, not a pump. | 6.0u | Active |

**Fortune**

| Node | Type | Cost | Effect | Net | Status |
|---|---|---|---|---|---|
| **Scavenger** | S | 1 | 3% increased item quantity. | 1.0u | Active |
| **Discerning Eye** | S | 1 | 4% increased item rarity. | 1.0u | Active |
| **Gem-Eyed** | S | 1 | 3% increased item quantity. | 1.0u | Active |
| **Crowned Challenge** | N | 1 | 25% more life for final bosses. 50% more unique chance from final bosses. World-unique and exclusive-unique chances are capped at 100%. | 4.2u | Active |
| **Gilder** | S | 1 | 4% increased item rarity. | 1.0u | Active |
| **Kingmaker's Cache** | N | 1 | Completion chest equipment is Rare 30% of the time. Otherwise chest equipment is Magic, as now. | 3.8u | Active |
| **Coin Sense** | S | 1 | 3% increased item quantity. | 1.0u | Active |
| **Gilded Instinct** | N | 1 | 12% increased item rarity. 6% increased item quantity. 5% more monster damage. | 2.7u | Active |
| **Glint** | S | 1 | 4% increased item rarity. | 1.0u | Active |
| **Assay** | S | 1 | The completion chest map has +2.5 quality. | 1.0u | Active |
| **Deep Pockets** | N | 1 | The completion chest holds 1 more currency roll. | 4.0u | Active |
| **Windfall** | S | 1 | 3% increased item quantity. | 1.0u | Active |
| **Tarnished Crown** | S | 1 | 4% increased item rarity. | 1.0u | Active |
| **Guildmark** | S | 1 | 3% increased item quantity. | 1.0u | Active |
| **Lodestone** | N | 1 | 12% increased item quantity. 6% increased monster life. | 3.1u | Active |
| **Kingslayer's Tithe** | K | 2 | 100% more boss loot. 100% more completion chest loot. 100% more unique chance from final bosses. 40% more life for final bosses. 15% less quantity from ordinary monsters. Boss and chest loot are doubled (currency amounts and guaranteed equipment). Loot is still instanced per player. | 7.0u | Active |
| **Early Crown** | K | 2 | 12% more monsters. The final boss arrives on wave 3. The final boss holds the waves only until it is defeated; the waves are 12% larger. | 6.0u | Active |

**Echoes**

| Node | Type | Cost | Effect | Net | Status |
|---|---|---|---|---|---|
| **Strange Signs** | S | 1 | +2 percentage points to random encounter chance. | 1.3u | Active |
| **Omen Reader** | S | 1 | +2 percentage points to random encounter chance. | 1.3u | Active |
| **Echo Dust** | S | 1 | 10% increased chance of event ingredients. | 1.0u | Awaits its encounter |
| **Long Fuse** | S | 1 | Event timers last 10% longer. | 1.0u | Awaits its encounter |
| **Quick Study** | S | 1 | Bronze, Silver and Gold thresholds are 5% easier. | 1.0u | Awaits its encounter |
| **Veilwalker** | S | 1 | 4% increased item quantity on maps with an encounter. | 1.3u | Active |
| **Faint Signal** | S | 1 | +2 percentage points to random encounter chance. | 1.3u | Active |
| **Whisper** | S | 1 | +2 percentage points to random encounter chance. | 1.3u | Active |
| **Hunter's Patience** | N (lens) | 1 | Every whiffed pounce counts double for the Trophy grade. Price: the Stalker has 10% more Life. | 3.0u | Awaits its encounter |
| **Resonant Rift** | N (lens) | 1 | The rift tolerates two more echoes reaching it. Price: echoes have 10% more Life. | 3.0u | Awaits its encounter |
| **Quick Fingers** | N (lens) | 1 | Locks have 20% less HP. Price: the Caravan is 10% faster. | 3.0u | Awaits its encounter |
| **Crown Rivalry** | N (lens) | 1 | The rival boss's exclusive unique roll has 50% higher chance. Price: the rival has 15% more Life. | 3.0u | Awaits its encounter |
| **Fault-Walker** | N (lens) | 1 | Eruptions deal 50% more damage to monsters. Price: one fewer pulse of warning preview. | 3.0u | Awaits its encounter |
| **Keeper of the Flame** | N (lens) | 1 | The Ember's wick lasts 30% longer. Price: one extra Wickbearer. | 3.0u | Awaits its encounter |
| **Pact Broker** | N (lens) | 1 | One additional pact is offered (four). Price: the extra pact is always a hard one. | 3.0u | Awaits its encounter |
| **Green Thumb** | N (lens) | 1 | Blooms ripen 25% faster. Price: monsters target blooms 20% more. | 3.0u | Awaits its encounter |
| **Ringmaster** | N (lens) | 1 | Grade thresholds are 15% easier. Price: the champion has 20% more Life. | 3.0u | Awaits its encounter |
| **Thaw Warden** | N (lens) | 1 | The host thaws 20% slower. Price: it contains 15% more monsters. | 3.0u | Awaits its encounter |
| **Anvil Blessing** | N (lens) | 1 | The anvil offers one more boon. Price: charging needs 20% more kills. | 3.0u | Awaits its encounter |
| **Bellringer** | N (lens) | 1 | Tolls come 15% slower, so Dirge stacks build more slowly. Price: cantors have 15% more Life. | 3.0u | Awaits its encounter |
| **Twin Omens** | K | 2 | Maps roll a second, independent encounter of a different kind in a different wave window. Encounter rewards are 25% smaller. | 6.0u | Awaits its encounter |
| **Sworn to the Veil** | K | 2 | Every map has an encounter (100%) and its rewards are 30% higher. Every encounter becomes mandatory: the map cannot be completed until it resolves. A running encounter fails after a 90 second soft timeout, so it never locks a run. | 6.0u | Awaits its encounter |

**Peril**

| Node | Type | Cost | Effect | Net | Status |
|---|---|---|---|---|---|
| **Hard Air** | S | 1 | 3% increased monster life. 4% increased item quantity. | 0.9u | Active |
| **Stinging Dust** | S | 1 | 1.7% increased monster damage. 5% increased item rarity. | 0.8u | Active |
| **Restless Air** | S | 1 | 2% increased monster movement speed. 4% increased item quantity. | 0.8u | Active |
| **Hex Sculptor** | N | 1 | 12% increased strength of danger mods on your maps (both sides). 8% increased item rarity. | 4.0u | Active |
| **Thin Veil** | S | 1 | Players have -4% to all resistances. 6% increased item rarity. | 0.6u | Active |
| **Riptide** | N | 1 | 4% increased monster movement speed. 6% increased number of monsters. 15% increased item quantity. The whole map runs faster and denser (the wave-4-to-6 version awaits the sim). | 2.8u | Active |
| **Cold Hearth** | S | 1 | 4% reduced focus regeneration for players. 4% increased item quantity. | 0.8u | Active |
| **Void Tithe** | N | 1 | 12% increased strength of corrupted mods (both sides). 6% increased item quantity on corrupted maps. | 4.4u | Active |
| **Grit Storm** | S | 1 | 3% increased number of monsters. 4% increased item quantity. | 0.7u | Active |
| **Sour Wind** | S | 1 | Monsters have +2.5% to all resistances. 5% increased item rarity. | 0.8u | Active |
| **Heavy Footfall** | S | 1 | 3% increased monster life. 4% increased item quantity. | 0.9u | Active |
| **Ember Rain** | S | 1 | 1.7% increased monster damage. 4% increased item quantity. | 0.8u | Active |
| **Choking Ash** | S | 1 | 2% increased monster movement speed. 5% increased item rarity. | 0.8u | Active |
| **Thrill of the Hex** | K | 2 | 40% increased strength of danger mods on your maps (both sides). 12% increased item quantity. 12% increased item rarity. Danger mods on your map are 40% stronger on both sides: more ways to die, more to earn. (The fifth danger mod awaits the crafting bench.) | 6.0u | Active |
| **Voidtouched Atlas** | K | 2 | 50% increased strength of corrupted mods (both sides). 10% reduced item quantity on uncorrupted maps. The Void Needle outcome "Only corruption" becomes "Corrupted mod". Corrupted maps always roll a Void Breach event. | 7.0u | Awaits its encounter |
| **Overrun Doctrine** | K | 2 | 30% less wave duration. 30% increased item quantity. 6% increased monster movement speed. Waves stack on you 30% sooner; the wave duration never drops below 25 seconds, whatever Haste or scarabs add. | 4.5u | Active |

**Tier bonuses (inner ring)**

| Node | Type | Cost | Effect | Net | Status |
|---|---|---|---|---|---|
| **Rising Stakes** | T | 1 | 0.6% increased item quantity per map tier. | 3.0u | Active |
| **Deepening Wealth** | T | 1 | 1% increased item rarity per map tier. | 3.8u | Active |
| **Higher Ground** | T | 1 | 0.8% increased item quantity per map tier. 0.5% more monster life per map tier. | 1.0u | Active |
| **Long Shadow** | T | 1 | 1.6% increased chance of magic and rare packs per map tier. 0.3% more monster movement speed per map tier. | 1.1u | Active |
| **Ladder's Reward** | T | 1 | The completion chest map has +0.34 quality per map tier. Completion chests upgrade the map one tier +0.2 percentage points more often per map tier. | 3.2u | Active |

**Bridges**

| Node | Type | Cost | Effect | Net | Status |
|---|---|---|---|---|---|
| **Gilded Ledger** | S | 1 | 4% increased chance to find maps. 2.5% increased item rarity. | 1.1u | Active |
| **Rare Maps** | S | 1 | 4% increased chance to find maps. 2% increased item quantity. | 1.2u | Active |
| **Coined Charts** | S | 1 | The completion chest map has +1.5 quality. 2% increased item quantity. | 1.3u | Active |
| **Omen Gold** | S | 1 | 2% increased item quantity. +1 percentage points to random encounter chance. | 1.3u | Active |
| **Fated Spoils** | S | 1 | 3% increased item rarity. +1 percentage points to random encounter chance. | 1.4u | Active |
| **Lucky Signs** | S | 1 | 2% increased item quantity. 2% increased item rarity. | 1.2u | Active |
| **Dread Omen** | S | 1 | +2 percentage points to random encounter chance. 1% increased monster movement speed. | 1.1u | Active |
| **Void Whisper** | S | 1 | +1 percentage points to random encounter chance. 2% increased item quantity. 1.5% increased monster life. | 1.1u | Active |
| **Fading Stars** | S | 1 | +1 percentage points to random encounter chance. 3% increased item rarity. 1% increased monster damage. | 1.1u | Active |
| **Blood Scent** | S | 1 | 8% increased chance of magic and rare packs. 2% increased item quantity. 2% increased number of monsters. | 1.1u | Active |
| **Savage Hunt** | S | 1 | 6% increased quantity from rare monsters. 1.7% increased monster damage. 2% increased item rarity. | 0.8u | Active |
| **Pack Master** | S | 1 | 6% increased chance of magic and rare packs. 2% increased monster life. 2.5% increased item quantity. | 1.1u | Active |
| **Bone Meal** | S | 1 | 4% increased chance of magic and rare packs. 4% increased essence weight. | 0.9u | Active |
| **Slaughterhouse** | S | 1 | 6% increased quantity from rare monsters. 4% increased Forge Scrap weight in ordinary currency drops. | 1.3u | Active |
| **Ore Vein** | S | 1 | 4% increased essence weight. 2% increased item quantity. | 1.2u | Active |
| **Smelter Maps** | S | 1 | 4% increased essence weight. 4% increased chance to find maps. | 1.0u | Active |
| **Crucible Charts** | S | 1 | 4% increased chance to find maps. 4% increased Forge Scrap weight in ordinary currency drops. | 1.0u | Active |
| **Anvil Road** | S | 1 | 6% increased chance to find scarabs. 4% increased essence weight. | 1.0u | Active |

**Theme seals and gatehouses (outer belt)**

| Node | Type | Cost | Effect | Net | Status |
|---|---|---|---|---|---|
| **Ember Drift** | S | 1 | 10% increased ember essence weight on Ashen Forge maps. | 1.3u | Active |
| **Emberwright's Due** | Seal | 1 | 35% more ember essence weight on Ashen Forge maps. Monsters have +5% to all resistances on Ashen Forge maps. | 3.4u | Active |
| **Chapel Dust** | S | 1 | 10% increased Binding Seal weight in ordinary currency drops on Cinder Chapel maps. | 1.3u | Active |
| **Herald's Litany** | Seal | 1 | 10% more boss ingredient chances on Cinder Chapel maps. 4% increased monster damage on Cinder Chapel maps. 30% more Binding Seal weight in ordinary currency drops on Cinder Chapel maps. | 3.4u | Active |
| **Rime Frost** | S | 1 | 10% increased rime essence weight on Rimed Ossuary maps. | 1.3u | Active |
| **Rimewright's Due** | Seal | 1 | 35% more rime essence weight on Rimed Ossuary maps. 3.5% increased monster damage on Rimed Ossuary maps. | 3.4u | Active |
| **Choir Notes** | S | 1 | 10% increased Forge Solvent weight in ordinary currency drops on Choral Crypt maps. | 1.3u | Active |
| **Choirmaster's Ear** | Seal | 1 | 10% more boss ingredient chances on Choral Crypt maps. 4% increased monster movement speed on Choral Crypt maps. 30% more Forge Solvent weight in ordinary currency drops on Choral Crypt maps. | 3.6u | Active |
| **Sand Pit** | S | 1 | 10% increased Fracture Core weight in ordinary currency drops on Iron Coliseum maps. | 1.3u | Active |
| **Gladiator's Purse** | Seal | 1 | 5% more equipment drops on Iron Coliseum maps. 6% increased number of monsters on Iron Coliseum maps. 30% more Fracture Core weight in ordinary currency drops on Iron Coliseum maps. | 3.0u | Active |
| **Chain Link** | S | 1 | 10% increased Forge Scrap weight in ordinary currency drops on Chainworks maps. | 1.3u | Active |
| **Chainbreaker** | Seal | 1 | 8% increased chance to find maps on Chainworks maps. 3% more monster damage on Chainworks maps. 30% more Forge Scrap weight in ordinary currency drops on Chainworks maps. | 3.4u | Active |
