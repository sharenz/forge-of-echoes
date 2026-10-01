# B. Atlas tree ("the Codex"): structure, nodes, keystones, balance

Status: design draft. All numbers are first-pass and exist to be calibrated by the plan in section 10.
"Eng" columns say what each node needs from the engine: **E0** = existing `MapStat`/resolver, data only;
**E1** = new stat or weight table, small rules change; **E2** = new mechanic/hook.

## 0. Pitch

The current tree (`src/data/progression/map-tree.ts`) is fifteen numbers in five three-step chains, capped at ten points,
so every player ends up with roughly the same three chains and nothing about it changes *how a map plays*.

The new tree is a **wheel of about 148 nodes in six branches** where roughly half of the notables and every keystone
change the **shape** of a run (when the boss arrives, which packs exist, how many events, where loot concentrates, which
currency you farm), not the size of a number. Points are earned from the ladder the player already walks (areas, tiers,
events, bosses), respec has a real but bearable price, and every reward is priced against the existing map-mod
price list, so the tree cannot quietly out-scale map crafting.

## 1. What exists today, and why it fails

| Problem | Evidence |
|---|---|
| Too few decisions | 15 nodes, 5 linear chains, budget cap 10 points (`MAP_TREE_POINT_CAP`), so two complete chains and nothing else. There is no fork inside a chain |
| Numbers too big per point, and unpaired | Trailblazer +20% map drops for 1 point is 2.5 "units" (ledger in 4.1) vs the 1u a first node should be worth; Apex Hunt +40% packs +15% rarity for -5% dmg is about 6u; Deep Seams +50% *more* essence weight is worth more than any map mod |
| Almost pure percentages | 12 of 15 nodes are `increased` stats on quantity/rarity/packs/drops. Only Far Horizon, Sound Foundations, Crowned Challenge and the event nodes touch a rule, and each is a single number |
| No synergy surface | nodes do not name a mod, scarab, area type, theme, event or loot category; they cannot interact, so there is nothing to theorycraft |
| Points come from area first-clears only | `min(10, completedAreas)`: earned fast and capped, so the tree is "done" at 10 of 25 areas |
| Respec is a flat 5 Scrap leaf refund | the price ignores what you remove |
| Presentation | text boxes (see brief A) |

## 2. What we keep / what we throw away

**Keep**
- Account-wide storage of allocations, shared by alts (`atlas.nodes`, `src/contracts/atlas.ts`).
- **Frozen into the expedition at activation** for the whole party; guests' trees do not stack; restarts cannot change it
  (GAME_SPEC section 7 "Map tree v0"). This is the right anti-abuse model; extend it, do not replace it.
- Tree effects compile into the same `MapModifier` list as map mods and appear in the map readout and personal luck
  breakdown with source "Atlas: <node>" (`src/game/progression/maps.ts:269`). Honest breakdowns are a core pillar.
- "No node changes character stats." Keep as a hard test.
- Changes only in your own hideout; refunds cost Scrap, atomically with the currency payment.
- The `MapEffectDef` shape (`stat, mode, value, fixed`) and `mapTreeBonuses()` idea of a small aggregate object for the
  effects that are not plain stats (event chance, chest upgrade, boss unique/life).
- Ideas worth salvaging as nodes: Far Horizon, Sound Foundations, Crowned Challenge, Deep Seams, Beyond the Veil
  (retuned; mapping table in 9.1).

**Throw away**
- The five three-node chains, `MAP_TREE_BRANCHES`, `MAP_TREE_NODE_IDS` (15 ids), `MAP_TREE_POINT_CAP = 10`,
  `MAP_TREE_REFUND_COST = 5` flat, the "requires previous node" text-only chain model and its UI.
- Every current numeric value (all of them are re-derived from the ledger).
- The idea that points depend only on distinct area clears.

## 3. Structure

### 3.1 The wheel
About **148 nodes**, one origin (the Cinder Crossing brazier), six branches, one outer belt.

| Branch | Job | Colour (brief A) | Small | Notable | Keystone |
|---|---|---|---|---|---|
| **Cartography** | maps, chests, scarabs, fees, Atlas discovery | bone + mana blue | 11 | 5 | 3 |
| **Foundry** | essences, ingredients, Stability, currency weights | ember | 11 | 5 | 2 |
| **Bounty** | monster rarity, packs, rare mods | rust + olive | 11 | 4 | 2 |
| **Fortune** | quantity, rarity, boss and chest loot | gold | 10 | 5 | 2 |
| **Echoes** | events (12 event lenses) | void glow | 8 | 12 | 2 |
| **Peril** | danger multipliers, corruption, tempo | blood + hot white | 10 | 3 | 3 |
| Hub ring | five **tier-bonus** notables (4.4) | brass | 0 | 5 | 0 |
| Outer belt | six **theme seals** (4.5) | theme colours | 6 smalls | 6 | 0 |
| Roots | origin + six branch roots | | 7 | | |
| **Total** | | | about 84 | about 50 | 14 |

Counts include a few bridge nodes between adjacent branches; target is 148 +/- 6, and a data test pins the exact number
once authored.

### 3.2 Shape (ASCII, art layout for the 512x512 Codex world)

```
                           CARTOGRAPHY
                 (K) Wagered Charts   (K) Dead-End Devotee
                      \   o--o--O--o--o   /
                       o        |        o        FORTUNE
          FOUNDRY  o--o          T-Rising Stakes    o--o--O--(K)Kingslayer's Tithe
    (K)Single-Minded  \        /   |    \         /          (K)Early Crown
        Furnace  o--O--o--o--o    (ORIGIN)  o--o--o
     (K)Blank Slate     \    T--Deepening   T--Higher Ground   /   ECHOES
                         o   |    Wealth        |     o    o--O(event lens x12)--(K)Twin Omens
      BOUNTY    o--o--O--o---T                     T---o--O--o          (K)Sworn to the Veil
   (K)Rare or Nothing  \      T--Long Shadow  T--Ladder's Reward   /
   (K)Empty Halls       o--o          |          o--o    PERIL
                           \         |         /   (K)Thrill of the Hex
                            o--O--o--o--o--O--o    (K)Overrun Doctrine   (K)Voidtouched Atlas
   outer belt:  [Ashen] . [Chapel] . [Ossuary] . [Crypt] . [Coliseum] . [Chainworks]   (theme seals, each
   reachable from the two neighbouring branches)
   o small   O notable   (K) keystone   T tier-bonus (inner ring)   [theme seal]
```
Rules of the shape:
- Every branch is a **spine of about 9 nodes** from its root to its outer keystone with two side spurs, so a keystone
  costs roughly **9 path points + 2** (keystone cost 2) = about 11 of the 60 points: you get 2 to 3 keystones in a
  finished build, never all 14.
- Adjacent branches are joined by **bridge clusters** (3 to 4 nodes) so a two-branch build is cheap and a three-branch
  build is a real sacrifice. Theme seals on the outer belt hang between two branches: two ways in.
- The inner ring of tier-bonus notables is reachable from the origin in 1 to 2 steps: everyone gets the "tier scales the
  tree" effect early, and it makes deeper play matter automatically.

### 3.3 Costs and rules
- Small / notable: 1 point. **Keystone: 2 points.** Tier-bonus: 1.
- Connected allocation only (start at origin), as in PoE; a reachable node lights up.
- **Exclusion pairs (hard, 4 pairs):** Wagered Charts x Dead-End Devotee; Empty Halls x Overrun Doctrine; Kingslayer's
  Tithe x Blank Slate; Twin Omens x Sworn to the Veil. Excluded nodes are chained in the UI with the reason.
- Everything is account-wide, frozen at activation, and displayed in the device readout.

### 3.4 How points are earned (target 60, all first-time, account-wide)
| Source | Points | Notes |
|---|---|---|
| First credited clear of each Atlas area | 25 | exactly today's rule (kept), one per area including dead ends and sealed sites |
| First clear at each map tier 2..15 (any area) | 14 | **the ladder is the progression**: tier 2 arrives only after the 10+ tier-1 maps the owner wants |
| First completion of each of the 12 event kinds (any grade) | 12 | rewards trying encounters (part C) |
| First kill of each of the 6 final bosses | 6 | |
| Atlas milestones: 50%, 75%, 100% of areas charted | 3 | |
| **Total** | **60** | |
Pace target: 10 points within the first 6 to 8 hours (areas + tier 2/3 + first events), 30 by the time a character is
in its 50s, the last 15 are late-game. Points are checked server-side from the same `atlas.completed` / clears data plus
three new sets (`tiersCleared`, `eventsSeen`, `bossesSeen`), and the award is a pure function of that data so a restart or
failed save cannot lose or double it (same receipt pattern as discovery credit, GAME_SPEC section 7).

### 3.5 Respec
- Refund is per node, leaf-first (a node with allocated dependants cannot be refunded), only in your own hideout.
- **Cost by class:** small 5 Scrap, notable 15, keystone 40, tier-bonus 15. The first 6 refunds an account ever makes are
  free ("training wheels"). The cost of one respec *session* is capped at 120 Scrap (you can never be charged more to
  rebuild fully than a weekend of play). Scrap sink is intentional; ROADMAP asks to watch the Scrap balance.
- **Loadouts (later slice):** three named loadouts; switching costs the sum of the refunds of the nodes removed, points
  re-spent are free. Gives the "I run Rare Hunt for Hunting Ground, Speed for Kiln" ergonomics without free swapping.
- A tree change never affects an open expedition (already true).

### 3.6 Relationship to the future character passive tree (kept clearly separate)
| | Atlas tree (Codex) | Character passive tree (P2) |
|---|---|---|
| Currency | Atlas points (this brief) | passive points (level) |
| Scope | account-wide | per character |
| Affects | the **map rules** of expeditions you open | the character's combat stats |
| Data | `atlasTree` module, `atlas.*` rule ids | `passives` module, player stat ids |
| Test | a node may never write a `PlayerCombatStats` field | a passive may never write a map rule |
| Look | brass, wax and glass on slate (brief A, 8) | reserved: sinew/rune circuit, red and blue |
| Respec | Scrap by node class | separate design |
The two trees never share a screen, hotkey, point counter or node id namespace.

## 4. Node taxonomy and the value ledger

### 4.1 The ledger: how power is measured
The existing map mods already price risk against reward (`DANGER_MODS`, `src/data/progression/maps.ts:254`). We reuse
their exchange rate as the tree's **unit**:

| 1 unit (u) of REWARD is about | 1 unit of DANGER (cost) is about |
|---|---|
| +3% inc item quantity | +6.5% inc monster life |
| +4% inc item rarity | +2.5% more monster life |
| +10% inc magic/rare pack chance | +3.5% inc monster damage (or +2.2% more) |
| +8% inc ordinary map drop chance | +5% inc monster count |
| +8% inc essence weight (or +12% more, i.e. cheaper as "more" is costlier: use inc) | +4% inc monster speed |
| +12% inc scarab drop chance | -4.4 points player resistance |
| +6% more boss/exclusive-unique chance | -8% player focus regen |
| +1.5 pp event chance | |
Derivation: Teeming 35% count for 20% quantity (6.7u : 5%/u), Fortified 40% life for 18% qty (6u: 6.7%/u), Ferocious 25%
damage for 22% qty (7.3u: 3.4%/u), Twin-Crowned 25% more life for 40% rarity (10u: 2.5%/u), Hexed -20 res for 18% rarity
(4.5u : 4.4/u). The tree is priced on the same table, so a tree node and a map mod are directly comparable and the map
device's "danger vs reward" bar can include the tree.

**Net value targets (NVT)**, per node, reward minus danger it carries:
| Class | Gross reward | Danger it carries | Net | Notes |
|---|---|---|---|---|
| Small | 1.0u | 0 to 0.5u | **about 1u** | one boring number, cheap, forms the path |
| Notable | 4 to 6u | 1 to 2.5u | **about 3.5u** | identity: one clear idea, often a behaviour |
| Keystone | 10 to 16u (or a structural shift) | 4 to 8u (or a real restriction) | **about 6u** for its *intended* build, negative for others | must be able to lose you value |
| Tier-bonus | grows with map tier: about 1u at T3 to 4.5u at T15 | matching danger where relevant | scales | makes the tree track the ladder |
| Theme seal | 4u only on that theme | 1u | about 3u there, 0 elsewhere | lets a narrow build farm one area family |
A full 60-point build: about 34 smalls (34u) + 16 notables (56u) + 2 keystones (12u) + 3 tier/theme (10u) is about **110u**.
For scale, a 4-mod rare map with its rewards is about 24u, so a completed tree is worth roughly four such maps' reward
**and** must be paid for in danger it carries; and its reward and clear-time gains are clamped by the caps in section 6.

### 4.2 Small nodes: "one plain number, cheap, sometimes with a scar"
Examples in the branch tables. Rule: at most one stat, at most one paired drawback of at most 0.5u, no rule changes.

### 4.3 Notables: "one idea"
Each notable is one sentence a player can repeat to a friend ("rares are twice as likely to be proof against something,
and pay for it"). Half are behavioural (E2).

### 4.4 Tier-bonus notables (inner ring, five)
Effects scale by the **tier of the opened map**, so the tree stays relevant at every depth and cannot be maxed out by
farming easy maps.
| Node | Effect (per map tier) | At T5 / T15 | Danger it carries | Eng |
|---|---|---|---|---|
| Rising Stakes | +0.6% inc item quantity | +3% / +9% | none (pure reward, capped by 6.1) | E1 |
| Deepening Wealth | +1.0% inc item rarity | +5% / +15% | | E1 |
| Higher Ground | +0.8% inc quantity, +0.5% more monster life | +4% & +2.5% / +12% & +7.5% | life | E1 |
| Long Shadow | +0.6% inc pack chance per tier; monsters +0.3% more speed | 3% / 9% | speed | E1 |
| Ladder's Reward | +1 chest map quality per 3 tiers; +0.2 pp to Far Horizon-style upgrade per tier (max +3 pp) | | | E1 |

### 4.5 Theme seals (outer belt; six themes, two ways in each)
Each seal is one notable plus one small, active only on maps of that base (`MapBaseId`), and supports one narrow farming
identity. They also give the six themes (three monster rosters) *reasons to be chosen*, which addresses "areas feel alike"
from ROADMAP.

| Seal | Theme | Effect | Carries |
|---|---|---|---|
| **Emberwright's Due** | Ashen Forge | Ember Essence weight +35% more; fire-affix bases weight x1.3 | monsters +5 resistance (E0 `monsterResist`, about 1u) |
| **Herald's Litany** | Cinder Chapel | Binding Seal and Suffix Rune sources +50%; magic packs shield each other | magic packs gain a shield-link mod (E2, about 1u) |
| **Rimewright's Due** | Rimed Ossuary | Rime Essence +35% more; jewellery weight x1.3 | monsters chill on hit (E2, uses existing chill rider) |
| **Choirmaster's Ear** | Choral Crypt | Solvent and Prefix Rune sources +50%; Choir waves telegraph +0.4 s longer | monsters +6% speed (E0) |
| **Gladiator's Purse** | Iron Coliseum | armour base weight x1.4, Fracture Core x1.5 | +8% monster count (E0) |
| **Chainbreaker** | Chainworks | Compass and Scrap yield +40%; Tar/hook debuffs -20% duration on you | +4% more damage (E0) |
Numbers are quoted from the area tables (`classWeights`, `currencyWeights` in `src/data/progression/atlas.ts`) so a seal
multiplies what areas already emphasise, instead of fighting them.

### 4.6 Event-focused notables (Echoes branch, twelve "lenses")
One per event of brief C; each makes the event better and harder in one clear way. Listed in 5.5.

## 5. Named nodes (first pass, 70+)

Type: S small, N notable, K keystone. **Text is player-facing wording** (short). "Eng" as defined at the top.

### 5.1 Cartography (maps, chests, scarabs, Atlas)
| Node | Type | Effect | Eng |
|---|---|---|---|
| Waypoint | S | 8% inc ordinary map drop chance | E0 `mapDropChance` |
| Milestone | S | 8% inc ordinary map drop chance | E0 |
| Cairn | S | dropped maps have +2 quality | E1 |
| Lamplighter | S | 12% inc scarab drop chance | E1 (scarab roll multiplier) |
| Ledgerline | S | Territory fee -1 Scrap (min 0) | E1 (`territoryEntryFee`) |
| Chart Keeper | N | 25% inc map drop chance; chest maps have +4 quality | E0/E1 |
| **Far Horizon** | N | completion chest upgrades the map one tier +10 pp more often (25% to 35%); Compass and T15 cap keep working | E0 (`chestUpgradeChance`) |
| **Master Surveyor** | N | a boss kill has a 35% chance to reveal a third neighbour | E2 (`ATLAS_REVEALS_PER_BOSS`) |
| **Lantern-Bearer** | N | each loaded scarab has a 20% chance not to be consumed when you activate (rolled from the map seed) | E2 |
| **Fifth Socket** | N | one more scarab socket (5) | E2 (`validScarabs` limit, dock UI) |
| **Wagered Charts** | K | see 5.7 | E2 |
| **Dead-End Devotee** | K | see 5.7 | E2 |
| **Twinned Sockets** | K | see 5.7 | E2 |

### 5.2 Foundry (crafting inputs)
| Node | Type | Effect | Eng |
|---|---|---|---|
| Essence Seeker | S | 10% inc Essence weight in ordinary currency drops (never adds drops) | E0 `essenceDropChance` |
| Ashwright / Rimewright | S | 12% inc Ember / Rime Essence weight | E0 |
| Seal-Mender | S | 15% inc Binding Seal weight | E1 |
| Scrapper | S | Scrap stacks +10% larger | E1 |
| Solvent Sense | S | Solvent and Catalyst weight +12% | E1 |
| **Sound Foundations** | N | non-unique armour drops with +1 max Stability | E0 `armourStability` |
| **Deep Seams** | N | 40% more Essence weight; monsters +8% more Life | E0 |
| **Ingredient Hunter** | N | boss ingredient chances (Runes, Scar Balm, Anneal, Graft...) x1.5 | E1 (`ingredientDrops.chance`) |
| **Steady Anvil** | N | all non-unique equipment drops with +1 max Stability; 10% fewer equipment drops | E1 |
| **Cataloguer's Shelf** | N | Refine-family currencies (Catalysts) +30% weight; Fracture Cores +20% weight; monsters +2% more damage | E1 |
| **Single-Minded Furnace** | K | see 5.7 | E2 |
| **Blank Slate** | K | see 5.7 | E2 |

### 5.3 Bounty (monster rarity)
| Node | Type | Effect | Eng |
|---|---|---|---|
| Marked Prey | S | 8% inc magic and rare pack chance | E0 `packRarity` |
| Thick Herds | S | 4% inc monster count, 2% inc quantity | E0 |
| Scent Trail | S | rare monsters drop 8% more quantity | E1 |
| Iron Hides | S | monsters 6% inc life, 3% inc quantity | E0 |
| Stragglers' Cull | S | monsters that left their pack are worth +6% quantity (stream monsters) | E2 |
| **Rare Blood** | N | rare monsters have 12% more Life and drop 30% more quantity | E1 |
| **Warded Hunts** | N | rare monsters are twice as likely to roll an elemental-proof mod (tier gating unchanged); each proofed rare grants one extra equipment roll on death | E2 (`rollRareMods`, `rollKillLoot` hook) |
| **Fat Packs** | N | magic packs have 2 more members and +6% monster count | E2 |
| **Elder Blood** | N | rare packs' leader has one more mod on T5+, and 20% more XP | E2 |
| **Rare or Nothing** | K | see 5.7 | E2 |
| **Empty Halls** | K | see 5.7 | E2 |

### 5.4 Fortune (quantity, rarity, boss and chest loot)
| Node | Type | Effect | Eng |
|---|---|---|---|
| Scavenger | S | 3% inc item quantity | E0 |
| Discerning Eye | S | 5% inc item rarity | E0 |
| Gem-Eyed | S | 3% inc item quantity | E0 |
| Gilder | S | 5% inc item rarity | E0 |
| **Crowned Challenge** | N | final bosses have 25% more Life; their world-unique and exclusive-unique chances are 50% higher (cap 100%) | E0 (`bossLifeMore`, `bossUniqueMore`) |
| **Kingmaker's Cache** | N | completion-chest equipment is Rare 30% of the time (else Magic, as now) | E2 (`rollChestLoot`) |
| **Deep Pockets** | N | the chest holds one more currency roll | E2 |
| **Gilded Instinct** | N | 10% inc rarity, 5% inc quantity; monsters deal 5% more damage | E0 |
| **Kingslayer's Tithe** | K | see 5.7 | E2 |
| **Early Crown** | K | see 5.7 | E2 |

### 5.5 Echoes (events): the twelve lenses (each is a notable) and smalls
Smalls: **Strange Signs** (+2 pp event chance), **Omen Reader** (+2 pp), **Echo Dust** (+10% inc event-ingredient chance),
**Long Fuse** (+10% event timers), **Quick Study** (grade thresholds 5% easier), **Veilwalker** (+3% qty on maps that
have an event). Event notables (exact mechanics in part C):

| Lens | Event | Effect | Danger it carries |
|---|---|---|---|
| Hunter's Patience | The Stalker | every whiffed pounce counts double for the Trophy grade | the Stalker has +10% Life |
| Resonant Rift | The Echoing | the rift tolerates 2 more echoes reaching it | echoes have +10% more Life |
| Quick Fingers | Laden Caravan | locks have 20% less HP | the Caravan is 10% faster |
| Crown Rivalry | Rival Crowns | the rival boss's exclusive unique roll has +50% chance | rival has +15% Life |
| Fault-Walker | The Fault | eruptions deal 50% more damage to monsters | one fewer pulse of warning preview |
| Keeper of the Flame | Ember Relay | the Ember's wick lasts 30% longer | one extra Wickbearer |
| Pact Broker | Pact Altar | one additional pact is offered (four) | the extra pact is always a hard one |
| Green Thumb | Ashseed Orchard | blooms ripen 25% faster | monsters target blooms 20% more |
| Ringmaster | Champion's Ring | grade thresholds 15% easier | the champion has +20% Life |
| Thaw Warden | Stasis Host | the host thaws 20% slower | it contains 15% more monsters |
| Anvil Blessing | Wayside Anvil | the anvil offers one more boon | charging needs 20% more kills |
| Bellringer | Bellwatch | tolls come 15% slower, so Dirge stacks build more slowly | cantors have +15% Life |
Keystones **Twin Omens** and **Sworn to the Veil** see 5.7.

### 5.6 Peril (danger multipliers and tempo)
| Node | Type | Effect | Eng |
|---|---|---|---|
| Hard Air | S | monsters 6% inc life, 3% inc quantity | E0 |
| Stinging Dust | S | monsters 3.5% inc damage, 4% inc rarity | E0 |
| Restless Air | S | monsters 4% inc speed, 3% inc quantity | E0 |
| Thin Veil | S | players -4 resistance, 4% inc rarity | E0 `playerResist` |
| Cold Hearth | S | -8% Focus regen, 3% inc quantity | E0 |
| **Hex Sculptor** | N | danger mods on your maps are 12% stronger (values on both sides) | E1 |
| **Riptide** | N | waves 4 to 6: monsters 8% inc speed and 12% inc quantity | E2 |
| **Void Tithe** | N | corrupted mods are 15% stronger on both sides; corrupted maps drop 1 more Void-family currency | E1 |
| **Thrill of the Hex** | K | see 5.7 | E2 |
| **Overrun Doctrine** | K | see 5.7 | E2 |
| **Voidtouched Atlas** | K | see 5.7 | E2 |

### 5.7 The 14 keystones (trade-offs are the point)

| # | Keystone (branch) | Upside | Downside | Excludes | Builds that want it | Abuse guard |
|---|---|---|---|---|---|---|
| 1 | **Wagered Charts** (Cartography) | Completion chests **always** upgrade your map by one tier (T15 cap). Ladder becomes reliable | the chest map arrives as a **Rare with 3 danger mods and 0 quality, account-bound**; monster-dropped maps can no longer roll higher than your tier | Dead-End Devotee | ladder climbers, map crafters (free raw material) | account-bound (no trade farm); active only from T4 |
| 2 | **Dead-End Devotee** (Cartography) | dead-end and sealed areas: +40% more quantity; their specialty chances (ingredients, currency multipliers, event guarantees) +50% | through-route areas: -25% quantity; bosses reveal 1 neighbour instead of 2 (slower atlas) | Wagered Charts | key/Vault farmers, Ember Vault and Gilded Vault specialists | sealed sites still need their key; specialty cap x4 |
| 3 | **Twinned Sockets** (Cartography/Peril) | may load **two scarabs of the same family** (second at 50% strength) | monsters +6% more Life per loaded scarab | none | speed builds, Invasion stackers | wave duration floor 25 s; combined Invasion start wave max 5 |
| 4 | **Single-Minded Furnace** (Foundry) | choose one Essence family at the device: that family's weight **x4 (more)** | all other Essences weight x0.25; Scrap drops -30% | none | an essence sniper running Ashen Forge for Ember | attunement chosen at activation, frozen in the expedition (same as `lootClass`) |
| 5 | **Blank Slate** (Foundry) | all equipment drops **Normal** with **+2 max Stability**; +60% more equipment drop chance | Item Rarity no longer affects equipment (still affects currency, maps, flasks); no Magic/Rare drops | Kingslayer's Tithe | crafters who want clean bases (CONCEPTS pillar: normal bases matter) | rarity from other sources cannot re-enter; chest equipment also Normal |
| 6 | **Rare or Nothing** (Bounty) | magic packs no longer spawn; rare pack chance x3; rare leaders +1 mod (elemental-proof allowed by tier); rares drop 100% more items, XP x1.5 | ~45% of the horde's loot/XP flow disappears; more elemental-proof walls | none | strong single-target builds, "proof mod checkers" | tier gating of proof mods kept; rare life multiplier unchanged |
| 7 | **Empty Halls** (Bounty) | monster count -50%; each kill +130% more quantity | monsters +60% more Life, +25% more damage; waves stream slower | Overrun Doctrine | bursty single-target, precise builds | quantity multiplier is per-kill and capped so total loot is about +15%: it is a *style*, not a pump |
| 8 | **Kingslayer's Tithe** (Fortune) | boss and chest loot x2 (currency amounts, +1 guaranteed equipment, unique chances x2); the final boss has +50% Life, +15% damage | ordinary monsters drop 30% less | Blank Slate | boss-runner builds, shortest path to the chest | boss loot is still per-player instanced; chest rare rule unchanged |
| 9 | **Early Crown** (Fortune) | the final boss arrives on **wave 3**; chest quality +1 tier of guaranteed magic-or-better | waves 4 to 6 then follow with +35% monsters; you skip the wave 4-5 XP curve first | none | fast clearers who trust their burst | `WaveConfig.bossWave` already supports this; the boss holds waves only until defeated |
| 10 | **Twin Omens** (Echoes) | maps roll a **second event slot** (independent, different kind, different wave window) | event rewards are 25% smaller; failing either spawns a rare "Backlash" pack | Sworn to the Veil | event chasers | needs Event Director v2 (C); still capped at 65% combined by `MAP_EVENT_MAX_CHANCE` before Sworn |
| 11 | **Sworn to the Veil** (Echoes) | every map has an event (100%); event rewards +30% | optional events become **mandatory**: an unfinished event when the boss dies withholds the chest map upgrade; optional sigils auto-open at wave 4 | Twin Omens | players who love events | forced events cannot hard-lock a run: 90 s soft timeout, then fail |
| 12 | **Thrill of the Hex** (Peril) | danger mods on the map are **40% stronger on both sides**; you may apply a **5th** danger mod | more danger mods available means more ways to die; 5th mod raises crafting cost | none | modded-map lovers, PoE-style "juiced maps" | `MAX_DANGER_MODS` 4 to 5 only with this node; reward caps in 6.1 applies |
| 13 | **Overrun Doctrine** (Peril) | wave duration -30% (stacks multiplicatively with Haste); +30% inc quantity | monsters +10% speed in waves 4 to 6; waves overlap more | Empty Halls | speed clearers, Haste scarab stackers | wave duration floor 25 s |
| 14 | **Voidtouched Atlas** (Peril) | corrupted maps: mods +50% on both sides; Void Needle "Only corruption" outcome becomes "Corrupted mod"; corrupted maps always roll a **Void Breach** event | uncorrupted maps get -10% inc quantity | none | corruption gamblers | Void Breach event defined in part C; corrupted maps stay locked as today |

Design intent check: every keystone has a *number that goes up* and a *sentence that gets worse*. The three "structure"
keystones (Early Crown, Overrun Doctrine, Empty Halls) change the rhythm of the wave director, not the loot table.

## 6. Anti-degeneracy and balance rules

### 6.1 Caps (hard, enforced in one place: `resolveAtlasRules()`)
| Quantity | Cap from the tree |
|---|---|
| Increased item quantity | +45% |
| Increased item rarity | +60% |
| Increased magic/rare pack chance | +100% |
| Increased map drop chance | +80% |
| Essence weight (increased) | +60%, plus at most one "more" source (Deep Seams *or* Single-Minded) |
| Event chance | +12 pp (then the existing 65% overall cap) |
| Chest upgrade chance | +10 pp base (35%), +3 pp from Ladder's Reward |
| Wave duration | never below 25 s, whatever combination of Haste, Twinned Sockets, Overrun |
| More monster life from the tree | at most x1.6 |
Caps show in the tooltip as "(capped)" so nobody wonders where the number went. Diminishing returns are used only for
"per X" stacking, never as a general soft-cap.

### 6.2 Rules
1. **Every notable and keystone that raises reward carries its price** (section 4.1 ledger); the audit test computes
   gross and danger units per node from its effects and fails outside the NVT band.
2. **No mandatory nodes, no "must-have" cluster.** Test: for each of the 12 archetypes (6.4) the sim value/hour is within
   1.15x to 2.4x of the empty-tree baseline, and no archetype exceeds 1.35x the median of the others.
3. **Only one "more" per reward category per branch** (avoids multiplicative stacking of unrelated notables).
4. **Tier is never touched.** No node raises tier, monster level, or grants tier-locked drops early. Tier-bonus nodes
   scale *rewards* by tier only. (Keeps "going up a tier is real progress".)
5. **No node touches character stats or combat rules for the player**, and no node grants a temporary power-up
   (CONCEPTS section 1: no between-wave power).
6. **Event chance stays capped** (`MAP_EVENT_MAX_CHANCE` 65%) except Sworn to the Veil, which is 100% by design and
   pays for it with mandatory play.
7. **Keys and maps remain scarce.** Nothing gives keys, and Wagered Charts maps are account-bound.
8. **Party rule kept**: only the opener's tree counts; guests do not stack. A guest-in-party cannot bring a "safe" tree to
   a leader's dangerous map either way.
9. **Frozen expedition**: all resolved numbers (including caps) are recorded in the expedition so a balance patch cannot
   alter running maps.
10. **Respec is a cost, not a wall**: the caps in 3.5.

### 6.3 Interactions (why the tree has a surface to theorycraft)
| System | Hooks | Example synergy | Example anti-synergy |
|---|---|---|---|
| **Map mods** | Teeming/Seething Horde x Thick Herds, Empty Halls (cancels count); Commanded x Marked Prey, Rare Blood; Volcanic x Hex Sculptor; Fortified/Twin-Crowned x Crowned Challenge | a Commanded Rare map + Rare Blood + Warded Hunts is a wall-and-loot map | Teeming + Empty Halls wastes half of each |
| **Scarabs** | Haste/Invasion + Twinned Sockets, Overrun, Lantern-Bearer, Fifth Socket, Lamplighter; new families (6.5) | double Haste + Overrun hits the 25 s floor: deliberately capped | Invasion + Early Crown makes wave 3 a wall |
| **Map device** | attunement (Single-Minded), lootClass (Hunting Ground), Bounty commissions, fee (Ledgerline), sockets | Furnace attuned to Ember in Emberwright area | |
| **Monster families / themes** | six theme seals, three rosters | Ossuary seal + chill riders: cold-proof rares? (they exist) | Chill seal on a cold-proof-heavy roster |
| **Encounters** | twelve lenses, Twin Omens, Sworn | Stalker Trophy gold + Hunter's Patience for rare bases | Sworn + Haste: mandatory events under a short clock |
| **Loot** | Kingslayer's Tithe/Kingmaker's Cache/Deep Pockets, Blank Slate, ingredient nodes | boss-run into chest with Tithe + Cache | Blank Slate contradicts Kingmaker's Cache rares |
| **Atlas topology** | Master Surveyor, Dead-End Devotee, Ledgerline | route-planning identity | |

### 6.4 Twelve archetypes the tree must support (also the bot presets, section 10)
1. **Rare Hunter**: Bounty spine, Rare Blood, Warded Hunts, Rare or Nothing, Kingmaker's Cache.
2. **Speed Runner**: Overrun Doctrine, Twinned Sockets, Haste scarabs, Riptide, Waypoint chain.
3. **Essence Sniper**: Foundry spine, Single-Minded Furnace, theme seal, Deep Seams, Essence Laden mod.
4. **Blank-Slate Crafter**: Blank Slate, Steady Anvil, Sound Foundations, Cataloguer's Shelf.
5. **Boss Butcher**: Kingslayer's Tithe, Crowned Challenge, Early Crown, Crown Rivalry.
6. **Echo Chaser**: Twin Omens, six event lenses, Echo Dust.
7. **Juiced Modder**: Thrill of the Hex, Hex Sculptor, Stinging Dust chain.
8. **Ladder Climber**: Wagered Charts, Far Horizon, Ladder's Reward, Chart Keeper.
9. **Vault Farmer**: Dead-End Devotee, Ingredient Hunter, Ledgerline, Gilded Vault key loop.
10. **Corrupter**: Voidtouched Atlas, Void Tithe, corruption crafting.
11. **Balanced Generalist**: three notables from each of three branches, no keystone.
12. **Empty Halls Duelist**: Empty Halls, Rare Blood, Kingmaker's Cache.

### 6.5 Scarab families the tree assumes (part of the plan, not this tree)
Today there are two families (`Haste`, `Invasion`, `src/data/scarabs.ts`), so five sockets and Twinned Sockets have too
little to play with. Proposed additions using the same four-tier ladder (Weathered/Etched/Gilded/Exalted) and one-per-family
rule: **Ambush** (fewer streams, +30% inc pack chance), **Omen** (one scarab per event kind: shifts that event's odds x2),
**Gilded** (chest +1 currency roll; monsters +8% life), **Cartographer's** (+3 quality on the chest map; tier is never touched). Four families make 4 sockets plausible and 5 a real upgrade.

## 7. Data model (proposal)

```ts
interface AtlasNode {
  id: AtlasNodeId;                 // string union, replaces MAP_TREE_NODE_IDS
  name: string; text: string; flavor?: string;
  kind: 'root'|'small'|'notable'|'keystone'|'tier'|'theme'|'event';
  branch: 'cartography'|'foundry'|'bounty'|'fortune'|'echoes'|'peril'|'belt';
  pos: { x: number; y: number };   // Codex world art px (512x512)
  links: AtlasNodeId[];            // undirected graph, checked reciprocal by test
  cost: 1 | 2;
  effects?: MapEffectDef[];        // existing resolver; new MapStat ids are added (e.g. 'scarabDropChance')
  perTier?: MapEffectDef[];        // tier-bonus nodes: value x tier
  rules?: AtlasRule[];             // structural: { id:'bossWave', wave:3 } | { id:'noMagicPacks' } | { id:'scarabSameFamily', factor:0.5 } ...
  requires?: { base?: MapBaseId };
  excludes?: AtlasNodeId[];
  audit: { reward: number; danger: number };   // units, checked against effects by the ledger test
}
```
`resolveAtlasRules(nodes, map)` returns one frozen `AtlasRules` object recorded in the run setup next to today's
`mapTreeBonuses` output; sim and rules read it (boss wave, pack composition, second event slot, wave duration floor,
attunement, equipment rarity override...). Existing derived outputs (`eventChance`, `chestUpgradeChance`, `bossUniqueMultiplier`,
`bossLifeMultiplier`) become fields of it.

## 8. UX notes (details in brief A section 8)
- Points counter always visible: "free / earned", plus "next point: <source>" so earning feels legible.
- Hover shows path cost and (for keystones) the excluded nodes; search box highlights matching node text.
- Rail shows: name, class, effect lines with the ledger colour (green reward, red danger), **net units** as a small chip
  ("+3.5u"), caps note, "Synergies with" chips (mods, scarabs, themes) built from `tags`.
- Ledger totals in the device readout: `Atlas tree: +18% quantity, +12% rarity, +9% life (12 nodes)`.

## 9. Migration and rebalance

### 9.1 Old 15 nodes mapped
| Old node (value) | Verdict | New home |
|---|---|---|
| Trailblazer +20% map drop | far too strong for a first node | Waypoint 8% (x2 as Waypoint, Milestone) |
| Chart Keeper +30% | keep as a notable | Chart Keeper 25%, plus quality |
| Far Horizon +15 pp chest upgrade | keep, weaker | +10 pp; Ladder's Reward adds up to +3 pp |
| Essence Seeker +25% | too strong | Essence Seeker 10% |
| Sound Foundations +1 armour Stab | keep | notable, unchanged |
| Deep Seams +50% more Ess. / +10% life | too strong | +40% more / +8% life |
| Marked Prey +20% packs | too strong | 8% |
| Crowded Grounds +10% count +5% qty | fine as a small pair | Thick Herds |
| Apex Hunt +40% packs +15% rarity -5% dmg | net about 6u | split: Gilded Instinct + Rare Blood |
| Scavenger +5% | ok | 3% |
| Discerning Eye +15% rarity | too strong | 5% |
| Crowned Challenge | keep | notable, values unchanged |
| Strange Signs / Echo Compass +5 pp each | too strong per point | +2 pp small nodes |
| Beyond the Veil +10 pp, +5% qty, +10% life | too strong | folded into Sworn/Twin Omens tradeoffs and the event smalls |
Old tree total was about 50u for 15 points (3.3u per point, some nodes 2.5 to 6u); the target average is 1.8u per point.

### 9.2 Save migration
`atlas.nodes` currently holds ids from a fixed 15-id union (`normalizeMapTree`, `src/game/progression/map-tree.ts`,
called from `normalizeAtlas`). Migration: unknown ids are dropped, points are recomputed (`completed.length` plus the new
sources from now on), and the **allocation is refunded free of Scrap once** ("The Codex was redrawn. Your points are
back."). Nobody loses points (old cap 10 vs new 25 from areas alone). Open expeditions keep their frozen old selections
(existing rule; legacy ids must remain resolvable for those runs, so keep a tiny legacy table).

## 10. Plan to rebalance (measure, do not guess)

1. **Instrument**: extend the existing ladder harness (`tests/game-progression/balance-ladder.test.ts`,
   `balance.test.ts`, bot in the balance playthroughs) to report per run: kills/min, drops/min by category, Scrap-equivalent
   value per minute (Rook appraisal table, GAME_SPEC section 9), clear time, deaths per 100 maps, event completion, boss-time.
2. **Static audit test** (`tests/game-progression/atlas-tree.test.ts`, new): node count 148 +/- 6; graph connected and
   reciprocal; every node reachable from origin; costs; exclusion symmetry; per-node ledger units inside their NVT band;
   caps satisfied by the full-tree resolve; no node writes a `PlayerCombatStats` field; keystones each have a nonzero
   downside; theme seals require a base.
3. **Archetype sim**: 12 presets (6.4) x tiers 3, 7, 11, 15 x 3 bots (existing skill profiles) x N seeds. Accept if
   (a) value/hour 1.15x to 2.4x baseline, (b) max/median archetype <= 1.35, (c) deaths per 100 maps <= 1.6x baseline,
   (d) no archetype's *clear time* is below 0.55x baseline (protects the pacing pillar), (e) no single node appears in
   more than 70% of the top-scoring builds (detects "must-take").
4. **Numeric tuning knobs**: only the unit table (4.1) and the four caps (6.1) are tuned globally; node values follow the
   table by formula so a retune is one number, not 148.
5. **Playtest gates** (human): 30-minute session per archetype by the owner; question set: did the path feel like
   choosing, did a keystone change how I play, did I regret it, did I understand the number in the readout.
6. **Ongoing**: after live, add anonymous per-node allocation counts (ROADMAP lists telemetry as an idea) and retune what is
   over 70% or under 5% picked.

## 11. Engine and data work list (for the slice plan in the overview)
- E0 nodes (about 45%): data only via existing `MapEffectDef` stats and `mapTreeBonuses` extension.
- E1 (about 30%): new `MapStat` ids (`scarabDropChance`, `rareQuantity`, `bossIngredientChance`, `equipmentStability`,
  `dangerModStrength`, `tierScaled*`) and weight tables in the loot rules (`src/game/progression/loot.ts`).
- E2 (about 25%): new run rules read by the sim/loot rules: boss wave override (`WaveConfig.bossWave`: exists), wave
  duration floor, pack composition rule (no magic, +members), equipment rarity override, second event slot (needs
  Event Director v2), extra neighbour reveal, scarab consumption roll, socket count and same-family rule, attunement
  selection and its device UI, chest upgrade/rarity rules.
- New tests listed in 10.2; data pinned in GAME_SPEC section 7 (`tests/game-progression/spec-sync.test.ts` exists to keep
  spec and data in sync; update the spec table when data lands).

## 12. First ten points (what a new account experiences)
Points 1 to 4 (Cinder Crossing clear, Ember Road, Bone Approach, first tier-2 clear): the player walks Origin to the
Cartography or Fortune ring and takes Waypoint, Scavenger, Discerning Eye, Rising Stakes: small, honest, felt.
Points 5 to 10 (first events, more areas): the first *notable* appears (Chart Keeper or Rare Blood) and the first fork
is real: bridge toward Bounty or toward Foundry. No keystone before about point 20, which is the design intent:
identity arrives with investment.
