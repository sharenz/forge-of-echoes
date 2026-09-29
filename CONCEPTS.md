# Forge of Echoes — Core Concepts (v2 rewrite brief)

This document is everything worth keeping from the v1 implementation, distilled
before the codebase was wiped. v1 (React + Phaser + Colyseus + Postgres) is preserved
on the `archive/v1-phaser` branch for reference; nothing from it is meant to be
copied wholesale.

**v2 direction:** built from scratch with no game-engine libraries (own loop, own
renderer on Canvas2D/WebGL2, own input/audio), and a complete graphics overhaul.
The game identity stays the same:

> **Path of Exile itemization and crafting × Vampire Survivors wave combat.**
> Every run is both a combat challenge and a crafting project.
> Crafting and luck in drops are the heart of the game.

---

## 1. Design pillars

1. **Crafting is the main progression system.** It starts in the first hour, not as an endgame lottery. Crafting should make stories: the player remembers how an item was made.
2. **Luck is felt, rare is rare.** Most drops are materials; a rare item is an event, a great rare is memorable. Normal and magic items matter as crafting bases. Loot volume never replaces loot quality — prevent spam instead of building a loot filter.
3. **Waves create mounting pressure.** Dense hordes, escalating waves, and risk/reward fixed *before* entry by the crafted map item. No temporary between-wave power-ups. All power comes from level, skills, gear and crafting.
4. **Understandable build depth.** Every number is explainable in the UI. Never hide odds that can be calculated. Never require a wiki.
5. **From deliberate to spectacular, but always readable.** VFX never hide enemies, drops, or lethal attacks. Don't balance around one-shots.

Guardrails: no mandatory uniques or passives. Every crafting material must be a distinct decision. No permanent meta-progression that trivialises the item hunt.

## 2. Core loop

```
Hideout: evaluate loot → craft gear → craft a map → put it in the map device
   ↓
Map run: hunt distributed packs through escalating waves → pick up physical drops
   ↓
Final wave / boss → reward chest → return → repeat
```

- **Short rhythm:** find a pack → fight → collect → hunt the next pack.
- **Long rhythm:** find a promising base → improve it over several runs → finish a build-defining item.
- **Session length:** one map is about 10–15 minutes.

## 3. The numeric core (keep exactly)

Every stat, for players, monsters and maps, resolves through one function:

```
value = (base + Σflat) × (1 + Σincreased/100) × Π(1 + more_i/100)
```

- Every modifier is `{ stat, mode: flat|increased|more, value, source, label }`, so the character sheet and map device can show a full breakdown for free.
- Attributes resolve first. Per-level and per-attribute rules are then ordinary modifiers (data, not code).
- Scaling definitions come from data: `{ base, perItemLevel?, perTier?, perWave? }`.
- Runtime entities store only a definition ID plus their rolled state. All content is data: bases, affixes, currencies, monsters, packs, skills, maps, loot tables, flasks and progression.
- Damage rolls use a range symmetric around the displayed average (for example 0.8–1.2, midpoint 1.0), so the tooltip average is truthful. Assert this invariant in code.

## 4. Items

**Slots:** main hand, off hand, helmet, chest, gloves, boots, belt, amulet, 2 rings, and a flask belt.

**Rarity:** Normal (implicit only, the best crafting base) · Magic (1–2 affixes, cheap to modify) · Rare (3–6 affixes) · Unique (fixed, rule-changing; answers "what could I build around this?").

**Bases** have an implicit, base stats that scale with item level, attribute requirements, a grid footprint, and ideally a *material* that changes how crafting behaves:
- Ashwood Wand: fire affixes are easier to add.
- Glassbone Wand: extra projectile potential, but fractures more easily.
- Ironroot Wand: defensive affixes are easier to preserve.

**Affixes:**
- v2 should add a **prefix/suffix split**, which v1 lacked; it made crafting shallow.
- Each affix has an exclusive group, tags (fire, life, speed, defense, crit…), a slot allow-list, and tiers.
- Each tier has a required item level, a weight, and a min–max range. Item level unlocks tiers but never guarantees them.
- v1 baseline tier weights, from T6 (worst) to T1 (best): 1000 / 700 / 450 / 250 / 110 / 35. T1 unlocks around ilvl 75–90.
- Items are identified on drop; there are no identify scrolls.
- Rare names should be generated from a real word list. v1 used only 4 names.

**Grid inventory (PoE-style):**
- The backpack is 12×5 and each stash tab is 12×8. The stash has up to 8 named tabs.
- Footprints: weapon 2×4, chest and offhand 2×3, helmet/gloves/boots 2×2, belt 2×1, and 1×1 for jewellery, currency, maps and flasks.
- Currencies stack to 40. Flasks stack to 20 in the backpack and 5 per belt slot.

## 5. Crafting — "the Workbench" (the heart of the game; least realised in v1)

**Interaction (it worked well):**
- Right-click a currency to arm it; the cursor changes and a help strip appears.
- Every item in the grid is marked valid or invalid, and an invalid hover explains why.
- Left-click an item to apply the currency. Esc, or right-clicking again, cancels.
- A craft that would do nothing is rejected without consuming the currency.
- Tooltips show exact odds whenever they can be known.

**Five action families.** v2 must build all five.

| Family | Material (design) | Verb |
|---|---|---|
| Shape | **Scrap** — rerolls values / basic craft · **Essence** (one per tag: fire, cold, life, speed…) — adds an affix from that family | add / reroll |
| Refine | **Catalyst** — upgrades one affix's tier | improve |
| Remove | **Solvent** — removes an affix by a visible targeting rule, not purely at random | remove |
| Preserve | **Seal** — protects one affix during the next operation | protect |
| Transform | **Fracture Core** — makes one affix permanent, with a scar risk | lock in |

**Stability (a per-item crafting budget):**
- Simple crafts are cheap; deterministic, powerful crafts cost more.
- At low Stability, advanced crafts can add a permanent **scar**, a drawback or tradeoff.
- At 0 Stability the item is **finished**, never destroyed. v1 gave every item 8/8.

**Controlled uncertainty:** alternate deterministic setup steps with risky payoffs. Example project: Ashwood Wand → Essence (fire) → Seal the good roll → Scrap the rest → Catalyst the tier → Fracture it.

**Crafting Codex (later):** recipes and targeting rules are discovered through bosses, salvaging and challenges. Knowledge unlocks options, not raw power.

**Every material must have a drop source.** In v1, four of them existed only in the starting kit.

## 6. Luck and drops (a core concept)

**Four independent axes**, each resolved with the same modifier math and shown as a breakdown in the map device:
- **Item Quantity:** how many drops. It never changes rarity.
- **Item Rarity:** the rarity weighting *after* a drop has been chosen. It never adds drops.
- **Monster Amount.**
- **Monster Rarity.**

**Sources of luck:** map tier, wave number, map mods, map quality, and monster rarity (magic and rare monsters get large "more" multipliers). Later, gear affixes such as "increased item rarity" can be added, if they don't crowd out build affixes.

**v1 drop baseline (a starting point to tune):**
- One uniform roll per kill, bucketed into categories. Each category's chance is `base × quantity/100`, with a cap per category. If the combined total goes above 92%, all categories are scaled down proportionally.

  | Category | Base chance | Cap |
  |---|---|---|
  | Equipment | 0.55% | 42% |
  | Map | 0.35% | 30% |
  | Material | 1.6% | 72% |
  | Flask | 1.1% | 26% |

- Equipment rarity weights, with `m = rarity/100`: normal 50, magic 48.75·m, rare 1.25·m². That makes rare 1.25% of item drops at base and about 3.3% at double rarity.
- Monster rarity multipliers: magic gets 35% more quantity and 100% more rarity; rare gets 200% more quantity and 300% more rarity.
- Waves add +2% quantity and +3% rarity each. Tiers add +4% rarity each.

**Loot hierarchy:**
- Common monsters mostly drop materials and shards.
- Elites (magic and rare monsters) have a good chance at a relevant base.
- Wave bosses and lieutenants drop magic, rare and unique items plus special components and maps.

**Make luck *feel* good (v2 focus):**
- Every drop is a physical object with a label, coloured by rarity (white, blue, yellow, and orange for unique).
- Drop beams and sounds scale with rarity, and rare drops get a distinct anticipation moment.
- Equipment auto-places in the backpack when walked over; materials go to a pickup ledger.
- Items roll when they spawn in the world, so they are deterministic given the seed.

## 7. Maps as craftable items

A map is an item that is consumed when opened. It has a base (theme + implicit), a tier (1–20), a rarity, affixes, quality and corruption. Map rarity mirrors equipment rarity.

**Map crafting uses its own currencies, so maps don't compete with gear:**
- **Map Dust:** reroll or change rarity.
- **Threat Glyph:** adds a danger mod.
- **Reward Ink:** adds a reward mod.
- **Cartographer's Seal:** preserves a mod.
- **Void Needle:** corrupts the map. Possible outcomes: a powerful corrupted mod, a tier upgrade, ±1 map tier, a hidden boss wave, turning into a unique map, and so on. A corrupted map is then locked.

**Map mods always pair danger with reward.** v1 set:

| Mod | Danger | Reward |
|---|---|---|
| Teeming | +30% monsters | +22% quantity |
| Commanded | more magic/rare packs | +26% rarity |
| Restless | faster monsters | +18% quantity |
| Volcanic | more damage | +24% quantity |
| Vampiric | more life | +23% quantity |
| Twin Crowned | 25% more monster life | +42% rarity |
| Exhausting | −30% Focus regen | +25% quantity |

**Map bases whose implicits change the rules (designed; text-only in v1):**
- Ashen Forge: fire and construct enemies, more fire Essences.
- Drowned Archive: narrow lanes, more jewellery bases.
- Grave Orchard: corpses awaken, more minion and void affixes.
- Iron Coliseum: small arena and aggressive spawns, armour bases drop with extra Stability.

**Tier scaling:** each tier adds about +8% monster life, +7% monster damage, +7% monster rarity and +4% item rarity. Monster level (which is also item level) = `clamp(tier×5, 10, 99)`.

**Map economy:**
- A free tier-1 map is always available from the merchant, so the player can never be map-locked.
- Maps drop at or below the current tier.
- The completion chest guarantees a map one tier higher.

## 8. Run structure (Vampire Survivors side)

- **Large scrolling battlefield.** Packs are spread geographically (golden-angle spiral placement worked well), so hunting the next pack is part of the fun.
- **Waves:** v1 had 6 waves; the design called for 9, with lieutenants on waves 3 and 6 and a boss on wave 9.
  - The next wave starts when the field is clear **or** after a timer, so waves can stack and pressure builds.
  - v1 wave size was `28 + 16×wave` monsters.
- **Wave phases:** Tell (preview incoming families and dangerous mods) → Fight → Collection. Stragglers become aggressive, so there's no long cleanup.
- **Final rage:** at the end, every remaining monster hunts the player. v1 had no real boss; v2 needs one.
- **Reward chest** on completion: guaranteed equipment (at least magic), materials, and a higher-tier map.
- **Designed but not built:**
  - Extraction checkpoints that bank loot.
  - An optional endless "overrun" mode with rising density and rewards.
  - Dying loses only unbanked rewards, never gear or XP.

## 9. Monsters

**Roles:** swarmer, bruiser, artillery, support, hunter (punishes kiting), summoner, disruptor. A family combines 3–4 roles under one theme.

**v1 roster:**
- Ashling: basic melee swarmer.
- Ember Skitter: tiny, fast and fragile.
- Cinder Spitter: ranged artillery.
- Rift Stalker: leaps at the player.
- Ironhide Brute: slow, armoured tank.

**Packs:**
- 4–7 members made from 1–3 weighted archetypes. Type weights change with wave and tier, so harder types appear later.
- Pack rarity is rolled once per pack:
  - **Magic pack:** every member is magic and they share one mod (Quickened, Stout, Armored, Deadly).
  - **Rare pack:** a single leader with 2 strong mods (Juggernaut, Executioner, Phantom, Colossal); the rest stay normal.
- XP multipliers: normal ×1, magic ×1.8, rare ×5.

**v2 goals:**
- Elite mods should be *behavioural* rather than invisible multipliers: a ward link, splitting once, a rotating safe zone, empowered near corpses.
- Escalation should come from wave composition, not just stats.
- Every role needs a clear silhouette and readable telegraphs.

## 10. Character and skills

**Levels 1–99:**
- Each level grants +5 attribute points (Str, Dex, Int) and +1 skill point.
- XP to next level = `max(80, floor(65·L^1.58))`.
- A build should be complete around level 75–80. Levels 91–99 are prestige.

**Attributes:**
- Str: life, armour.
- Dex: attack speed, evasion, movement.
- Int: Focus, cast speed.
- They mainly gate gear and shape identity; they are not universal damage multipliers.

**Resource:** one universal resource, **Focus**.

**Defences:** life, armour (`dmg × 100/(100+armor)`), evasion (capped), ward, and resistances. Resistances only mean something once damage types are mechanical; in v1 the damage types were cosmetic.

**Action timing:**
- Attack speed comes from the weapon's APS; cast time = base / cast speed.
- The effect fires on the animation's *release frame*.
- Cooldown modifiers never change animation speed.

**Skills (v1 tree, Sorceress-flavoured):**
- 5-slot bar: left-click (basic) plus Space, Q, E, R, F.
- Characters start skill-less with one banked point. Each skill has 20 ranks and prerequisites.
- **Ember Lance** (basic): fire projectile, no Focus cost.
- **Destruction:**
  - Ember Nova: a projectile ring that gains projectiles and pierce with rank.
  - Rime Shards: a cold fan.
  - Flame Wave: a wide fan.
  - Cinder Comet: a heavy single projectile.
- **Survival:**
  - Cinder Ward: damage reduction for a duration.
  - Echo Bloom: heal over time.
- **Mobility:**
  - Rift Step: a blink with charges that recover one at a time.
  - Phase Step: a longer blink.
- **Design rule:** skill branches should change *behaviour* (pierce, split on impact, lodge-and-detonate, convert damage type), not add +5%.
- **Later:** a passive tree (about 250 nodes, notables and keystones) and specialisations that define engines (overheat/vent, mark/rift, remnants/constructs).

**Flasks:**
- Health and mana flasks recover over time, not instantly.
- The belt has 5 slots on keys 1–5. Pickups refill matching belt slots first.

## 11. UI/UX concepts to keep

- **Type scale:** 12 / 14 / 17 / 25 px (caption, secondary, body, title), and actually enforce it this time. v1 had about 355 one-off font sizes.
- **Hotkeys:**
  - `I` inventory, `C` character, `K` skills, `M` map device, `Esc` menu or close.
  - `Alt` shows affix tiers and roll ranges, and opens side-by-side comparison cards with stat deltas.
  - `Ctrl`/`⌘`-click quick-moves an item between containers.
- **Tooltips** are different for gear, currency, maps and flasks. They show tier labels (T1…), roll ranges, and Stability `x/max`.
- **Inventory interactions:** drag with the grab-cell offset, and a green/red placement preview. Dragging an item out onto the world drops it. Fresh drops get a "new" badge.
- **Map device:** one slot, a readout of danger, quantity and rarity with a breakdown, then "Open".
- **HUD:** life and Focus globes, flask belt, skill bar with cooldown fill and charge counters, XP bar, and a wave or rage meter. The character sheet rows expand into stat breakdowns.
- **Art-directed UI:** blackened metal, bone, dark leather and ember channels. It should feel constructed, not like generic HTML panels.

## 12. Engine architecture for v2 (no libraries)

**Structure:**
- Keep the simulation and presentation separate, but in one client to start.
- Single-player first, but behind an `intent → simulation → snapshot/events` boundary, so a server can be added later without a rewrite.

**Simulation:**
- **Fixed-step simulation** with an accumulator, clamped catch-up (for example at most 4 steps), and render interpolation between previous and current state.
- **Deterministic:**
  - One seeded RNG per run. Keep separate streams for combat and content/loot.
  - No `Math.random` or `Date.now` in game rules; v1 leaked both.
  - An FNV-style state digest supports regression tests.
- **Data-oriented entity stores:**
  - Struct-of-arrays typed arrays with free-lists.
  - IDs of the form `(generation<<16)|slot`, so stale handles are caught.
  - A uniform spatial grid of about 96–128 px cells.
  - Swept segment-vs-circle projectile hits, so fast projectiles can't tunnel.
  - A per-projectile hit list for pierce.
  - An overkill guard.
  - Proven fast: 2,000 monsters plus 1,000 projectiles in under 1 ms per tick.
- **Pack-level AI:**
  - One think per pack, staggered across ticks, with movement every tick.
  - Monsters outside an activation radius sleep.
  - Per-victim contact-damage caps. Without them, 8 monsters landing on the same tick deleted a player.
- **Two event channels:** droppable cosmetic events (hits, damage numbers) and a *never-dropped* outcome queue (kills, drops, XP). The kill goes to the hit that crossed zero.
- **Timers:** all game timers run on the simulation clock, never the wall clock.

**Presentation:**
- **Renderer:** WebGL2 sprite batcher with texture atlases (JSON frame data), or Canvas2D to start. Include Y-sorting, blob shadows, additive particle blending, and a camera lerp.
- **No god object.** Separate modules for input, simulation, renderer, VFX, audio, camera and UI. v1's 2,500-line Phaser scene is the anti-pattern.
- **Input:** a key-state map plus an edge queue consumed at tick start, so presses are never missed between frames. Held skill keys fire on the first frame the skill becomes available.
- **UI:** DOM overlays for menus, inventory and tooltips. Per-tick data goes through a small store or signal, never React re-renders at simulation rate.
- **Game feel to reimplement:**
  - Pooled damage numbers, coloured by type: rise 30 px and scale to 1.18 over about 620 ms with cubic-out easing, with a cap per batch.
  - Pooled particles.
  - Direction hysteresis to stop sprite flicker on diagonals.
  - Locomotion playback rate scaled to movement speed.
  - Rarity-tinted drop beams.
  - A corpse cap.
- **Audio (raw WebAudio):**
  - A decoded-buffer cache, and a queue for sounds played before the context unlocks.
  - Voice groups with max-voice caps, and slice playback (several SFX from one file).
  - Positional monster cues with distance attenuation, stereo pan, per-group cooldowns and random variants.
- **Persistence (single-player):** a versioned save schema with normalisation for old saves. Profile operations are pure functions `(profile) → profile | null`.

**If multiplayer returns later:**
- Server authority, with the client sending only intents.
- Binary snapshots culled to each client's area of interest, with interpolation based on server ticks. Projectiles are sent as spawn + seed and simulated on the client.
- Client movement prediction with sequence acks and exponential correction blending.
- Reconnect tests from day one.
- Wrap every async handler: an unhandled rejection crashed the whole process in v1.
- Don't simulate on replicated state objects. v1 ran at 157 ms per tick because of this.

## 13. Art direction (for the overhaul)

**Keep — the identity:**
- Dark fantasy about embers and ruined ritual spaces: standing stones, carved spirals, iron bindings, weathered masonry.
- **Palette:**
  - Base colours: charcoal, blackened iron, dark brown, grey stone, desaturated moss and olive, rust, ochre, burgundy, and a little purple.
  - Ember orange and hot white only for small emissive focal points that mark power, interaction, danger and reward.
  - Cool blue is reserved for mana and contrast.
- **Motif:** an ember-spiral sigil that ties together portals, the map device and magic.
- **Readability:** each monster role is distinguishable by silhouette, gait and size. Rarity is a runtime treatment (tint, outline, aura), never baked into the art.
- **VFX layering:** aura, dust, sweep, trail, impact and core, with no layer dominating and no screen-filling flashes.
- **Camera and sprites:** a fixed elevated three-quarter camera. Sprites face south, north and east, with west mirrored. Every frame uses a constant bottom-centre foot anchor.

**Abandon:**
- **The AI image/video → chroma-key → sprite-sheet pipeline.** It suffered identity drift, chroma spill, unstable anatomy and inconsistent frame sizes (128, 181 and 256 px); v1's own art guide called every player sheet "not a quality target".
- **Single stretched background paintings used as the world.** v2 needs a tile- or chunk-based ground with props and decals, lit by one coherent ambient light plus local ember lights.
- **Pick one consistent pixel scale and art method** and hold every asset to it, then approve assets at gameplay size over the real background.

## 14. Decisions (locked for v2)

All previously open questions are decided in `GAME_SPEC.md` §0 (6 waves + lieutenant + boss, 4 flask slots, void, mechanical damage types with resistances and ailments, permanent characters, WebGL2 procedural pixel art with dynamic lighting, online-only and server-authoritative: own hideout per player, parties of up to 4 who can visit each other's hideouts, 8 portals per map with one consumed per entry, instanced loot, shared XP — see `GAME_SPEC.md` §11).

## 15. First milestone (vertical slice)

**Content:**
- 1 arena and 1 class.
- The basic attack, 2–3 actives, and 1 mobility skill.
- 5 monster types, 2 elite mods and 1 boss.
- 6 waves.
- About 11 item bases with prefix/suffix affixes (20–25 affixes).
- Scrap, Essence, Seal, Solvent and Catalyst, with Stability and one scar type.
- 7–10 map mods with Dust, Glyph and Ink.
- Grid inventory, stash, tooltips with Alt compare, and the map device.

**It must answer:**
1. Is killing a dense wave satisfying before deep progression exists?
2. Does hunting the next pack create anticipation?
3. Does a rare drop feel like an *event*?
4. Can players tell why one item beats another?
5. Does crafting produce a story?
6. Are players excited by a good normal base?
