# D. The Sorceress passive tree: "the Orrery"

Status: data, rules, save and server built (PT0, 2026-10-06; the code is the source of truth for numbers: `src/data/progression/passives/`,
and `build-plan.md` PT0 lists every number PT0 moved onto the ledger, e.g. Warded Throne's 10% less damage). Numbers are first pass: the structure, the ledger, the caps and the tests are the decisions. It is built with the method of `docs/atlas-rework/B-atlas-tree.md`
(unit ledger, net-value bands, hard caps, exclusion pairs, archetype bots) but it is a **different tree** with its own data, currency and screen. Read `power-curve.md` section 3 (layers) and `skills.md` (augments) first.

---

## 0. Decisions in one table

| Question | Decision | Why |
|---|---|---|
| Name and look | **The Orrery**: a heptagonal wheel of rune rings, **red and blue** sinew circuit (the colours reserved in B-atlas 3.6), one gold ring for keystones | the Atlas Codex is brass, wax and glass on slate; the two trees must never be confused |
| Size | **252 nodes**: 152 small, 77 notable, 7 mastery, 15 keystone, 1 start | the owner's "about 250" |
| Shape | 7 sectors around a hub: Fire, Lightning, Cold, Bulwark, Vitality, Void, Arcana; 10 bridge notables | element identity plus a defence/utility half, adjacent sectors joined by bridges |
| Points | **70**: 1 per level from 2 to 50 (49), then 1 per 2 levels from 52 to 80 (15), plus **6 Boss Marks** (first kill of each of the 6 final bosses by that character) | levels give steady progress, bosses give a milestone; 70 of 252 nodes (28%) forces choice |
| Costs | small / notable / mastery 1 point; **keystone 2 points** | as the Atlas tree |
| Respec | refund leaf-first; **small 5, notable 15, mastery 10, keystone 40 Scrap**; first 10 refunds per character free; session cap 250 Scrap; one-time free full respec at migration | as the Atlas tree, so players learn one rule |
| Jewels | **none in v1** (a reserved "Echo socket" node kind for later) | jewel sockets are a new item class and a crafting layer; out of scope for a design that already adds affixes |
| Masteries | **7** (one per sector): pick one of three riders | cheap identity without extra nodes |
| Separation from the Atlas tree | separate store path (`character.passives`), id namespace (`pas.*`), hotkey (`O`), panel, art tones and tests (a passive may never write a map rule, an Atlas node may never write a combat stat) | B-atlas 3.6 already pins this |
| Keystones | 15, each a number that goes up and a sentence that gets worse; 3 mutually exclusive mono-element keystones | the owner's "real trade-offs" |

---

## 1. The ledger (the method of B-atlas 4.1, retargeted at character power)

### 1.1 The unit

**1 unit (1u) = +1% damage-equivalent (offence) or +1% effective health (defence) for the reference build** (a good-band character at ML60: `Σincreased` about 400%,
`more` pool ×1.5, main skill rank 10; `power-curve.md` 5.2). The table below is the exchange rate; every node's text is checked against it by a test.

| 1u of OFFENCE is about | 1u of DEFENCE / UTILITY is about |
|---|---|
| +4% increased damage (type- or tag-matched) or +3% generic spell damage | +2% maximum life |
| +1% more damage | +4% armour or +4% evasion rating |
| +0.8% cast speed (the Focus tax is built in) | +2.5 resistance (any one element; 2 points of effective cap buffer) |
| +6% increased crit chance or +4 crit multiplier | +6% flask effect |
| +2.2 penetration points (value measured against the roster's average resistance) | +10 maximum Focus or +8% Focus regeneration |
| +7% area (about +3.5% radius) | −1% damage taken (rare; keystones and notables only) |
| +12% increased projectile / area / DoT damage on a matching skill | +1% movement speed ≈ 0.5u (movement saves seconds, not damage) |

### 1.2 Net value bands

| Class | Gross | Price it carries | Net target | Rules |
|---|---|---|---|---|
| Small | 1u (0.7 to 1.3) | at most 0.3u | **about 1u** | one stat, no behaviour, forms the paths |
| Notable | 5 to 8u | 0 to 2u | **about 5u** | one idea, a sentence a player repeats; half of them touch a skill behaviour or a layer (pen, exposure, conversion) |
| Mastery | 4 to 6u | 0 | **about 5u** | choose one of three, each worth the same |
| Gate (the sector's first notable) | 4 to 5u | 0 | about 4u | everyone passes it, so it is a plain stat pair |
| Bridge | 4 to 6u | 0 | about 5u | pays the price of the extra path in value |
| Keystone | 25 to 45u | 10 to 25u | **net +12 to +20u for the intended build, negative for most others** | must be able to lose you value |

A full 70-point build: about 34 smalls (34u), 24 notables (120u), 3 masteries (15u), 2 keystones (+30u net, 6 points), 1 gate+bridge in passing = **about 200u**. The band model of `power-curve.md` credits the tree with
`+101% increased` (about +20u) `+8% cast speed` (+10u) `+10% crit` (+8u) and the tree's share of the `more` pool (×1.85, +85u) at the endgame band: about 125u offence for 31 offence points (4u per point) and about
60u defence for 25 defence points, consistent with the ledger once the keystones' net is added (the harness checks it, section 8).

### 1.3 Hard caps (enforced in one resolver `resolvePassives()`; "(capped)" shown in the sheet)

| Quantity | Cap from the tree |
|---|---|
| Increased damage (all offence nodes, summed) | +220% |
| `more` damage from the tree | ×2.0 (the global ×3.5 includes augments and uniques) |
| Increased cast speed | +30% (plus Perfect Tempo +35%; global cap +150%) |
| Crit chance increased / crit multiplier | +180% / +80 |
| Penetration | +20 per type (Razor Doctrine +15 to the cap only); global cap 40 |
| Area increased | +40% |
| Extra projectiles | +1 (Volley only) |
| Movement speed | +25% |
| Max life increased | +80% |
| Armour / evasion increased | +100% / +100% |
| Resistances / maximum resistance | +25 each / +11 (Overcap 3 + Warded Throne 8) |
| Focus pool / regen | +120 / +60% |
| Flask effect | +50% |
| `damageTaken` product from the tree | ≥ ×0.75 (global floor ×0.60 with ward) |
| Augment slots | +1 (Primary Practice) |

---

## 2. Structure and layout

### 2.1 The wheel

```
                                  FIRE (Cinder Arc)                      red
                       (K) Pyre Doctrine
                 Arcana  .  o--O--o--o--O--o--(M)                LIGHTNING (Storm Arc)   yellow-white
          (K) Glass Orrery                  \                  /  (K) Stormbound
        (K) Echo Cascade  o                  o  Kindled Will  o
        (K) Gambler's Edge  \                |               /
   ARCANA (Spellwork) gold   o----(GATE)--[ SPARK ]--(GATE)----o  ...Overcharge
                            /       |    (start)    |           \
   Entropy Lens  VOID (Hollow Arc) violet   hub ring (11 smalls, 3 cross notables)   COLD (Rime Arc) cyan
   (K) Hollow Pact (K) Razor Doctrine     Frostfire Gate (Fire-Cold)   (K) Absolute Zero
                            \       |    Rift Spark (Lightning-Void)   |           /
   Blood Rite                 o---(GATE)---  Mind and Blood (Arcana-Vitality)---(GATE)---o   Static Ice
                       VITALITY (Heartwood) green        BULWARK (Plate and Veil) steel
                       (K) Unending Vigil  (K) Wanderer's Stride    (K) Eternal Bastion (K) Phantom Weave (K) Warded Throne
                               Ironblood ------------------------ Frost Plate
   hub-side keystones: (K) Iron Mind (Focus shield)    (K) Perfect Tempo
   o small   O notable   (M) mastery   (K) keystone   (GATE) sector gate notable
```

Clockwise from the top: **Fire, Lightning, Cold, Bulwark, Vitality, Void, Arcana**, each a 28 to 36 node fan from the hub to the rim; adjacent sectors are joined by one **bridge notable** at mid-radius
(Fire-Lightning *Overcharge*, Lightning-Cold *Static Ice*, Cold-Bulwark *Frost Plate*, Bulwark-Vitality *Ironblood*, Vitality-Void *Blood Rite*, Void-Arcana *Entropy Lens*, Arcana-Fire *Kindled Will*),
and three **cross-hub notables** link opposite sectors through the hub ring: *Frostfire Gate* (Fire-Cold, the conversion bridge), *Rift Spark* (Lightning-Void), *Mind and Blood* (Arcana-Vitality).

Rules of the shape (same as B-atlas 3.2):
- A sector is a **spine of about 10 nodes** from its gate to its rim keystone, with two or three side spurs ending in notables. A keystone costs about 10 path points + 2 = 12 of the 70.
- A two-sector build (an element and Arcana, or an element and Vitality) is cheap through a bridge; a three-sector build is a real sacrifice. The hub's **start node (Spark) touches all seven gates**, so there is no forced first branch.
- Cross-hub notables are 2 to 3 steps from the hub, so a conversion or hybrid build pays little to reach its mixed identity.
- Two keystones sit at the hub (Iron Mind, Perfect Tempo), reachable from every sector: they are the "I changed how this class works" nodes and cost the same 2 points.
- Art world: 768 × 768 Codex-style world px (the Atlas Codex is 512 × 512); the three zooms of the Codex (0.5, 1, 2, 3).

### 2.2 Node counts (sum 252)

| Region | Small | Notable | Mastery | Keystone | Total |
|---|---|---|---|---|---|
| Hub (7 gates + 11 inner smalls + 3 cross notables + 2 hub keystones; the start node Spark is counted separately) | 11 | 10 (7 gates + 3 cross) | – | 2 | 23 |
| Bridges (7 adjacent notables) | – | 7 | – | – | 7 |
| Fire | 19 | 8 | 1 | 1 | 29 |
| Lightning | 19 | 8 | 1 | 1 | 29 |
| Cold | 19 | 8 | 1 | 1 | 29 |
| Void | 18 | 9 | 1 | 2 | 30 |
| Arcana | 22 | 9 | 1 | 3 | 35 |
| Vitality | 21 | 9 | 1 | 2 | 33 |
| Bulwark | 23 | 9 | 1 | 3 | 36 |
| **Total** | **152** | **77** | **7** | **15** | **251 + start = 252** |

(The hub total of 23 includes the 2 hub keystones, Perfect Tempo and Iron Mind; 23 + 7 bridges + 221 in the sectors + the start node = 252.)

### 2.3 Small-node families (the filler, paths and 152 of the 252)

Each small is one stat from its sector's family, values on the ledger (1u). The first three of each sector's spine are the *same stat* so a path is a visible rhythm.

| Sector | Small patterns (value per node) |
|---|---|
| Fire | +4% increased fire damage · +3% ignite chance and +3% fire damage · +3% damage over time · +2.5 fire resistance |
| Lightning | +4% increased lightning damage · +3% shock chance and +3% damage · +2% cast speed (every third) · +2.5 lightning resistance |
| Cold | +4% increased cold damage · +3% chill chance and +3% damage · +4% area for cold skills · +2.5 cold resistance |
| Void | +4% increased void or physical damage · +3% damage over time · +1 penetration (void or physical) · +2.5 void resistance |
| Arcana | +3% spell damage · +6% crit chance · +4 crit multiplier · +7% area · +5 intelligence · +10 max Focus |
| Vitality | +2% max life · +5 strength · +0.4 life regeneration per second · +6% flask effect · +1% movement speed · +4% pickup radius |
| Bulwark | +4% armour · +4% evasion · +2.5 resistance to an element · +5 dexterity · +1.5% armour and evasion · +3 life |
| Hub | +5 intelligence · +5 strength · +5 dexterity · +3 all attributes (alternating) |

---

## 3. The nodes (named, with numbers and ledger)

Ledger "u" is gross value of the node's text at the reference build. "Eng" says what the engine needs: **E0** existing stat, **E1** new stat from `power-curve.md`, **E2** a new rule or primitive (`skills.md` 4.2).

### 3.1 Fire (Cinder Arc), red

| Node | Kind | Effect | u | Eng |
|---|---|---|---|---|
| Gate of Embers | gate | +14% increased fire damage; +4% area | 4 | E0 |
| Kindle | notable | +14% fire damage; +10 ignite chance | 5 | E0 |
| Slow Burn | notable | ignite lasts 50% longer (4.5 s); +20% damage over time | 5 | E1 |
| Searing Edge | notable | +6 fire penetration; +6% fire damage | 5 | E1 |
| Pyroclasm | notable | 6% more fire damage while 3 or more Burning enemies are within 120 | 6 | E2 |
| Wildfire | notable | ignited enemies that die ignite 2 enemies within 100 | 6 | E2 |
| Ember Reservoir | notable | on kill with a fire skill, restore 3 Focus | 4 | E0 |
| Scorch Ward | notable | take 12% less fire damage; Burning on you lasts 40% shorter | 4 | E1 |
| Last Ember | notable | when you fall below 30% life, Cinder Ward is cast free (once per 30 s) | 6 | E2 |
| **Cinder Attunement** | mastery | choose: (a) ignite deals +25% damage; (b) +12% fire damage against Burning enemies; (c) fire kills have 15% chance to burst for 1.2e in r50 | 5 | E1/E2 |
| **Pyre Doctrine** | keystone | **all your damage is converted to fire; 30% more fire damage; ignite deals 30% more.** *You cannot deal other types: any fire-proof rare is a wall unless you carry penetration.* Excludes Absolute Zero, Stormbound | +35 gross, −15 | E2 |

### 3.2 Lightning (Storm Arc), yellow-white

| Node | Kind | Effect | u | Eng |
|---|---|---|---|---|
| Gate of Sparks | gate | +14% increased lightning damage; +10 shock chance | 4 | E0 |
| Static Charge | notable | +14% lightning damage; shock effect +4 points (shock +20% → +24% damage taken) | 5 | E1 |
| Conductive Thoughts | notable | all chaining skills chain 1 more time (`extraChains`) | 6 | E1 |
| Live Wire | notable | +6 lightning penetration; +6% lightning damage | 5 | E1 |
| Overload | notable | shocks you cause last 2 s longer (5 s) | 4 | E0 |
| Quickened Pulse | notable | +8% cast speed | 6 | E0 |
| Tempest Reach | notable | +15% projectile speed and +10% area for lightning skills | 4 | E0 |
| Grounding Rod | notable | +15 lightning resistance; lightning hits you take 20% less | 4 | E0 |
| Surge of Static | notable | killing a Shocked enemy restores 4 Focus | 5 | E0 |
| **Storm Attunement** | mastery | (a) shock effect +10 points; (b) lightning skills +1 chain; (c) lightning crit multiplier +30 | 5 | E1 |
| **Stormbound** | keystone | **40% more lightning damage; shock effect +50% (shocked enemies take 30%).** *Focus regeneration −30%.* Excludes Pyre Doctrine, Absolute Zero | +30 gross, −10 | E1 |

### 3.3 Cold (Rime Arc), cyan

| Node | Kind | Effect | u | Eng |
|---|---|---|---|---|
| Gate of Rime | gate | +14% increased cold damage; +10 chill chance | 4 | E0 |
| Hoarfrost | notable | +14% cold damage; +10 chill chance | 5 | E0 |
| Brittle Bones | notable | your cold exposure is 4 points stronger; +15% damage to chilled enemies | 6 | E1 |
| Frostbound | notable | chill slows 10 points more (40%); +8% cold damage | 5 | E0 |
| Glacial Edge | notable | +6 cold penetration; +6% cold damage | 5 | E1 |
| Winter's Patience | notable | +20% duration for cold zones and orbs; +8% area | 4 | E0 |
| Permafrost | notable | enemies chilled by you deal 10% less damage | 5 | E2 |
| Ice Plate | notable | +20% armour; +12 cold resistance | 4 | E0 |
| Shatterpoint | notable | killing a chilled enemy has a 15% chance to emit a cold nova (2e, r70) | 6 | E2 |
| **Rime Attunement** | mastery | (a) chill slows 15 points more; (b) your exposures last 2 s longer; (c) +20% cold damage against chilled | 5 | E1/E2 |
| **Absolute Zero** | keystone | **+25% more damage to chilled enemies; chill slows 40%.** *20% less damage to enemies that are not chilled.* Excludes Pyre Doctrine, Stormbound | +30 gross, −10 | E1 |

### 3.4 Void (Hollow Arc), violet

| Node | Kind | Effect | u | Eng |
|---|---|---|---|---|
| Gate of Entropy | gate | +14% increased void damage; +10% damage over time | 4 | E1 |
| Entropy | notable | +14% void damage; +12% damage over time | 5 | E1 |
| Rotting Touch | notable | Decay lasts 2 s longer; +20% Decay damage | 5 | E1 |
| Hollow Lens | notable | +6 void penetration; +6 physical penetration | 6 | E1 |
| Sundering Mark | notable | exposures you apply are 4 points stronger | 5 | E1 |
| Gravity's Grip | notable | pull effects +40%; +10% area | 4 | E1 |
| Soul Tithe | notable | 3% of void damage dealt is restored as Focus (at most 6 per second) | 5 | E2 |
| Concussion | notable | +14% physical damage; +25% knockback | 5 | E1 |
| Withering Gaze | notable | Withered you apply gains 1 stack (−8 points more; bounded by the 25-point exposure cap) | 6 | E2 |
| Last Whisper | notable | enemies you kill while Decayed explode for 8% of their life as void | 6 | E2 |
| **Hollow Attunement** | mastery | (a) Decay +2 stacks; (b) +10 physical penetration; (c) kills restore 3 Focus | 5 | E1 |
| **Hollow Pact** | keystone | **Decay and all damage over time deal 40% more; Decay stacks +3 times.** *Maximum life −25%.* | +32 gross, −18 | E1 |
| **Razor Doctrine** | keystone | **+15 to the penetration cap (55).** *25% less area; skills cost 15% more Focus.* Exposes how little room a pen build has | +25 gross, −12 | E1 |

### 3.5 Arcana (Spellwork), gold-white

| Node | Kind | Effect | u | Eng |
|---|---|---|---|---|
| Gate of Insight | gate | +12% spell damage; +25 maximum Focus | 4 | E0 |
| Arcane Surge | notable | +16% spell damage | 5 | E0 |
| Honed Edge | notable | +40% increased crit chance; +20 crit multiplier | 6 | E0 |
| Expanse | notable | +14% area; +10% area damage | 5 | E1 |
| Volley | notable | +1 projectile to Projectile skills; 10% less damage (counts to the +6 cap) | 6 | E1 |
| Splitting Thought | notable | +20% projectile damage; +1 pierce | 5 | E1 |
| Practiced Hand | notable | +10% cooldown recovery; +12% area for Area skills | 5 | E0 |
| Deep Pools | notable | +40 maximum Focus; +25% Focus regeneration | 5 | E0 |
| Reservoir of Echoes | notable | echoes (augments, uniques, Echo Sigil) deal +20% damage | 5 | E2 |
| Primary Practice | notable | your first loadout skill gains +1 augment slot; other skills deal 5% less damage | 7 | E2 |
| **Spell Attunement** | mastery | (a) +8% cast speed; (b) +10% area; (c) +20% projectile damage | 5 | E0/E1 |
| **Glass Orrery** | keystone | **35% more spell damage.** *Maximum life −40%.* Excludes Warded Throne, Iron Mind | +35 gross, −20 | E0 |
| **Echo Cascade** | keystone | **every skill echoes once after 0.4 s at 60% damage, for no Focus.** *Focus costs +30%, cooldowns +20%.* | +30 gross, −12 | E2 |
| **Gambler's Edge** | keystone | **+100% increased crit chance; +50 crit multiplier.** *Non-critical hits deal 35% less damage.* | +30 gross, −15 | E0 |

### 3.6 Vitality (Heartwood), green

| Node | Kind | Effect | u | Eng |
|---|---|---|---|---|
| Gate of Marrow | gate | +8% maximum life; +0.6 life regeneration per second | 4 | E0 |
| Hale Body | notable | +10% maximum life; +20 life | 5 | E0 |
| Quick Recovery | notable | +25% flask effect; flasks gain a charge per 30 kills | 5 | E1 |
| Bloodied Resolve | notable | Life flasks also give 15% less damage taken for 2 s | 4 | E2 |
| Second Wind | notable | life on kill doubled; +2 life per kill | 4 | E0 |
| Sprinter | notable | +10% movement speed; +20% pickup radius | 5 | E0 |
| Steady Breath | notable | regenerate 1.2% of maximum life per second | 4 | E0 |
| Hardy | notable | +1% maximum life per 20 strength | 5 | E0 |
| Pulse of Life | notable | every 12 kills restore 6% life | 5 | E2 |
| Rejuvenating Surge | notable | Focus flasks restore 10% life; +20% flask duration | 4 | E1 |
| **Heart Attunement** | mastery | (a) +20% flask effect; (b) +3 life per kill; (c) regeneration +1.5% per second | 5 | E0 |
| **Unending Vigil** | keystone | **regenerate 3% of maximum life per second (6% below 50%).** *You cannot use Life flasks; maximum life −15%.* | +28 gross, −14 | E1 |
| **Wanderer's Stride** | keystone | **+25% movement speed, +30% pickup radius, Phase Stride and Rift Step recover 25% faster.** *Projectile range and area −25%.* | +22 gross, −12 | E1 |

### 3.7 Bulwark (Plate and Veil), steel

| Node | Kind | Effect | u | Eng |
|---|---|---|---|---|
| Gate of Plate | gate | +20% armour and evasion rating; +12 life | 4 | E0 |
| Plated Skin | notable | +20% armour; +4% maximum life | 6 | E0 |
| Fleet Footing | notable | +20% evasion rating; +4% movement speed | 5 | E0 |
| Prismatic Skin | notable | +10 to all resistances | 4 | E0 |
| Overcap | notable | +3 maximum resistance; +8 all resistances | 6 | E1 |
| Brace | notable | armour is 30% more effective against hits above 20% of your life | 6 | E2 |
| Slippery | notable | +6 points to evade chance (cap respected); +10% evasion rating | 6 | E0 |
| Barrier Study | notable | wards and barriers are 25% stronger (Cinder Ward cap 60 → 66%) | 5 | E1 |
| Heavy Plate | notable | the armour formula uses 8 instead of 10 per damage point | 6 | E1 |
| Elemental Veil | notable | +15 void resistance; +10 fire, cold and lightning resistance | 5 | E0 |
| **Plate Attunement** | mastery | (a) +20% armour; (b) +20% evasion; (c) +10 all resistances | 5 | E0 |
| **Eternal Bastion** | keystone | **armour applies to elemental damage at 50% effectiveness; +30% armour.** *Evasion rating is zero.* Excludes Phantom Weave | +28 gross, −12 | E2 |
| **Phantom Weave** | keystone | **evade cap +10 (85%); +40% evasion rating.** *You cannot gain armour.* Excludes Eternal Bastion | +28 gross, −12 | E1 |
| **Warded Throne** | keystone | **maximum resistances +8 (83%); +25 to all resistances.** *20% less damage dealt.* Excludes Glass Orrery | +25 gross, −10 | E1 |

### 3.8 Hub, bridges and cross-hub

| Node | Kind | Effect | u | Eng |
|---|---|---|---|---|
| Spark | start | +10 intelligence, +5 strength, +5 dexterity | 2 | E0 |
| Overcharge | bridge | +10% fire and lightning damage; +5% cast speed | 5 | E0 |
| Static Ice | bridge | shock and chill effect +4 points each | 5 | E1 |
| Frost Plate | bridge | +15% armour; +10 cold resistance | 4 | E0 |
| Ironblood | bridge | +8% maximum life; +10% armour | 5 | E0 |
| Blood Rite | bridge | +6% maximum life; +10% damage over time | 5 | E1 |
| Entropy Lens | bridge | +10% void damage; exposures +3 points | 5 | E1 |
| Kindled Will | bridge | +10% spell damage; +10% fire damage | 5 | E0 |
| **Frostfire Gate** | cross | 15% of fire damage converted to cold (modifiers of both apply); +6% fire and cold damage | 6 | E2 |
| **Rift Spark** | cross | 10% of lightning damage converted to void; +10% lightning damage | 6 | E2 |
| **Mind and Blood** | cross | +40 maximum Focus; +4% maximum life; +2 Focus on kill | 5 | E0 |
| **Iron Mind** | keystone (hub) | **30% of damage taken is drawn from Focus first.** *Focus regeneration −50%; maximum life −10%.* Excludes Glass Orrery | +28 gross, −14 | E2 |
| **Perfect Tempo** | keystone (hub) | **+35% cast speed; +25% cooldown recovery.** *20% less damage.* Excludes Gambler's Edge | +30 gross, −18 | E0 |

Named nodes: 7 gates + 60 sector notables + 7 bridges + 3 cross-hub + 7 masteries + 15 keystones + the start = **100 named nodes** (every notable, mastery and keystone is named above; the 152 smalls are families, section 2.3).

### 3.9 The fifteen keystones, their prices and exclusions

| # | Keystone | Region | The number that goes up | The sentence that gets worse | Hard exclusion |
|---|---|---|---|---|---|
| 1 | Pyre Doctrine | Fire | 30% more fire damage, ignite +30% | all damage is fire (no other answer to fire-proofs) | Absolute Zero, Stormbound |
| 2 | Stormbound | Lightning | 40% more lightning, shock 30% | Focus regeneration −30% | Pyre, Absolute Zero |
| 3 | Absolute Zero | Cold | 25% more to chilled, chill 40% | 20% less damage to the unchilled | Pyre, Stormbound |
| 4 | Hollow Pact | Void | DoT 40% more, Decay stacks +3 | maximum life −25% | – |
| 5 | Razor Doctrine | Void | penetration cap 55 | area −25%, Focus costs +15% | – |
| 6 | Glass Orrery | Arcana | 35% more spell damage | maximum life −40% | Warded Throne, Iron Mind |
| 7 | Echo Cascade | Arcana | every skill echoes at 60% for free | Focus +30%, cooldowns +20% | – |
| 8 | Gambler's Edge | Arcana | crit chance +100%, multiplier +50 | non-crit hits 35% less | Perfect Tempo |
| 9 | Unending Vigil | Vitality | 3% life per second | no Life flasks, life −15% | – |
| 10 | Wanderer's Stride | Vitality | movement +25%, pickup +30% | range and area −25% | – |
| 11 | Eternal Bastion | Bulwark | armour vs elements at 50% | evasion rating zero | Phantom Weave |
| 12 | Phantom Weave | Bulwark | evade cap 85%, evasion +40% | no armour | Eternal Bastion |
| 13 | Warded Throne | Bulwark | max resist +8, all res +25 | damage −20% | Glass Orrery |
| 14 | Iron Mind | Hub | 30% of damage taken drawn from Focus | Focus regen −50%, life −10% | Glass Orrery |
| 15 | Perfect Tempo | Hub | cast speed +35%, cooldown recovery +25% | damage −20% | Gambler's Edge |

Design check: a player at 70 points takes **2 or 3 keystones** (the points for 3 keystones: 6 of 70); the exclusion pairs are real choices (Pyre vs Absolute Zero vs Stormbound is "which element is my whole build").

---

## 4. How points are earned

| Source | Points | Notes |
|---|---|---|
| Levels 2 to 50 | 49 | one each |
| Levels 52 to 80 (every second level) | 15 | slows the last 30 levels, keeps level meaningful |
| Boss Marks | 6 | the first kill of each of the 6 final bosses (Cinder Matriarch, Hollow Warden, Ashbound Herald, Bone Chorister, Chainmaster, Varkus) **by this character**, credited on the boss-defeated outcome like the Atlas first-kill; a restart cannot lose or double it (pure function of `character.bossMarks`) |
| **Total** | **70** | pace: 19 points at level 20, 39 at level 40, 49 at level 50, 64 at level 80, 70 with all marks |

A character at level 17 has 16 points at once at migration. Skill points are separate (`skills.md` 9).

---

## 5. Respec rules

- **Refund** is per node, leaf-first (a node with allocated dependants cannot be refunded, as the Codex rule), in the hideout only. **Mastery choice change**: 10 Scrap. Prices: small 5, notable 15, keystone 40; the first 10 refunds per character are free (training wheels), the session cap is 250 Scrap.
- **One-time free full respec** at migration (`overview.md`): passives, skills, augments and attributes, flagged `respecTokens: 1` on the character.
- **No loadouts in v1** (a later slice, three named passive loadouts, switching costs the refunds of removed nodes as in B-atlas 3.5).
- A passive change never affects a running expedition's frozen setup (the player's passives are read from the character at map start like the rest of the player runtime).
- A respec is atomic with its Scrap payment (the same transaction shape as the Atlas tree respec and the bench).

---

## 6. Interactions with penetration, conversion, defences and augments

| System | Nodes | Interaction |
|---|---|---|
| **Penetration** (cap 40) | Searing Edge, Live Wire, Glacial Edge, Hollow Lens, Razor Doctrine (+15 cap) | the tree can give at most +20 per type; the rest of the 40 must come from gear (3 pen suffixes at T3 are 25) or Prisms; an all-passive pen build reaches 20 and needs gear for the rest |
| **Exposure** | Brittle Bones, Sundering Mark, Withering Gaze, Entropy Lens, Rime Attunement (b) | strengthen exposure from Hex/Searing Brand/Brittle Shards, never beyond the 25-point cap |
| **Conversion** | Frostfire Gate (15% fire → cold), Rift Spark (10% lightning → void), Pyre Doctrine (everything to fire) | converted damage keeps both modifier sets (`power-curve.md` 3.2), so passives from both sectors count |
| **Defence layers** | Bulwark (armour, evasion, resistance, `Heavy Plate`, `Brace`), Vitality (life, flasks, regen), Iron Mind (Focus), wards (Barrier Study) | no single sector provides all layers; Eternal Bastion vs Phantom Weave forces the armour/evasion choice |
| **Augments** | Primary Practice (+1 slot), Reservoir of Echoes, Conductive Thoughts (chains), Volley (projectiles), Splitting Thought (pierce) | many notables amplify augment primitives (`count`, `chain`, `pierce`, `echo`, `expose`) and cost the same points as damage |
| **Focus** | Deep Pools, Ember Reservoir, Surge of Static, Soul Tithe, Mind and Blood, Iron Mind | the passive tree is where the Focus economy of `power-curve.md` 8.1 is tuned |
| **Skills in the roster** | element sectors grant `<type>Damage`, DoT, shock/chill effects; Void gives physical and DoT | every skill has a home sector; Arcana is element-neutral |

---

## 7. Anti-"must-take" rules (the Atlas method, tightened)

1. **No mandatory nodes.** Test: removing any single non-keystone node from the best build of an archetype changes its power index by less than 8% (offence) / 8% (defence).
2. **Every notable has a price or a niche** (gross-net audit in 1.2); every keystone has a price (3.9).
3. **Caps** (1.3) and "(capped)" shown.
4. **Hard exclusions** (3.9) prevent stacking all the mono-element or all the trade-off keystones.
5. **Only one `more` per layer per sector** and tree `more` total ≤ ×2.0.
6. **No node changes map rules**, and no node grants a power-up that exists only between waves (CONCEPTS pillar 3).
7. **Bridges pay for their path**: 4 to 6u, not 2.
8. **Every keystone supports at least one archetype** in the harness (`build-plan.md` 5.2), and no archetype needs more than 3 keystones.
9. **Respec is a cost, not a wall** (5).

---

## 8. Data model (proposal) and tests

```ts
interface PassiveNode {
  id: PassiveNodeId;                      // 'pas.fire.kindle'
  name: string; text: string; flavor?: string;
  kind: 'start' | 'small' | 'notable' | 'mastery' | 'keystone' | 'gate' | 'bridge';
  region: 'hub' | 'fire' | 'lightning' | 'cold' | 'void' | 'arcana' | 'vitality' | 'bulwark';
  pos: { x: number; y: number };          // Orrery world px (768 x 768)
  links: PassiveNodeId[];                 // undirected, checked reciprocal
  cost: 1 | 2;
  mods?: StatModifier[];                  // ordinary labelled modifiers: they join the player model
  rules?: PassiveRule[];                  // structural: { id: 'extraChains', n: 1 } | { id: 'convert', from: 'fire', to: 'cold', pct: 15 } | ...
  choices?: PassiveChoice[];              // masteries: 3 options, each with its own mods
  excludes?: PassiveNodeId[];
  audit: { gross: number; price: number };// units, checked by the ledger test
}
```

Passives resolve into the same `StatModifier` list as items and class rules (the model of `src/game/progression/model.ts`), so every number appears with its source "Orrery: Kindle" in the character sheet breakdown.
The tests below mirror `docs/atlas-rework/B-atlas-tree.md` section 10:

1. **Static audit** (`tests/game-progression/passive-tree.test.ts`): 252 ± 2 nodes (exact count pinned), graph connected and reciprocal, every node reachable from Spark, costs, exclusion symmetry, every node's gross/price inside its band of 1.2, caps satisfied
   by the full-tree resolve, no passive writes a map rule or Atlas stat, every keystone has a nonzero price, point-source function matches 4.
2. **Random-build bots**: 2,000 random connected 70-point allocations (uniform random growth with reachability), evaluated by the band model at ML28, 60, 88. Acceptance: (a) the 5th to 95th percentile spread of the power index is at most 2.2×; (b) a random build reaches at least 35% of the best archetype;
   (c) no non-gate node appears in more than 70% of the top 5% builds; (d) every keystone appears in 3% to 40% of the top 5% builds.
3. **Archetype presets** (the 14 of `build-plan.md` 5.2) with their skills and augments: each within 0.7× to 1.4× of the median preset at its home tier; max/median at most 1.45×.
4. **Marginal node test**: removing the lowest-value small from the best build costs less than 2.5% offence or 3% defence.
5. **Interaction tests**: pen cap totals (tree + gear), conversion shares (Frostfire Gate then Frostfire Spiral sum to 55% fire → cold, not 100%), exclusion pairs enforced server-side, refund cost accounting.

---

## 9. UI: reuse the Codex, keep it separate

**Reuse from `src/ui/codex` and `src/art/codex` (they are generic in all but their data source):**
- `render.ts`: the plain-2D renderer: board raster, plates, threads, integer zooms (0.5, 1, 2, 3), the ember that runs along a thread on allocation, the hammer flash and spark bursts, keystone shockwave, ash crumble on refund, path preview on hover. All text stays DOM on the type scale.
- `model.ts`: the pure graph questions (state `on/ready/locked/gated`, cheapest path, exclusion, refundability, search) become a `TreeModel<N>` that takes a node list; the Atlas Codex binds it to `MAP_TREE` and the Orrery to `PASSIVE_NODES`.
- `Rail.tsx` (the right rail with name, class, effect lines, ledger chip) and `Codex.tsx` (pan, zoom, search, keyboard).
- `art/codex/tones`, `plates`, `glyphs`: new tones (sinew red, rune blue, element accents), a keystone gold ring, a mastery plate with three notches, a gate plate.

**New for the Orrery:**
- A **mastery flyout**: click a mastery plate to choose one of three riders (the rail shows the three with their numbers).
- A **build rail**: your totals against the caps ("Increased damage +142% of +220%", "Penetration fire 12 of 20 from the tree, 28 of 40 in total"), computed by `resolvePassives()` with the same breakdown as the character sheet.
- A **diff hover**: "if you take this: DPS 8,860 → 9,310 (reference skill), life 1,297 → 1,331".
- **Points header**: "Passive points 12 / 49 earned; next: level 38 (one point); Boss Marks 2 / 6".
- Entry: hotkey **`O`** (a button beside the command deck, like the others), panel title "The Orrery". A HUD unspent badge uses the existing unspent-point badges.
- **Never shares** a screen, hotkey, point counter, store path or node-id namespace with the Atlas Codex (the Atlas tree lives in the Map Device's Codex tab; the Orrery is a character panel).

Everything respects `AGENTS.md`: all text on `--font-ui-*` tokens, no one-off sizes; the plates' internal glyphs are canvas art.
