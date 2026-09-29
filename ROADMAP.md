# Roadmap

Maintained at the owner's request. Ask "what's next" and it is read from here; ideas and decisions
from discussions are added or moved between items. Nothing here is built unless it says **Done**.
Last reprioritised: 2026-09-29.

**Vision (owner):** two progressions. Character progression exists so you can run harder maps; **map
progression is the real game progression.** Hobby project played with friends (no trust/legal/scale concerns).

## TOP PRIORITY: balance overhaul (owner, 2026-09-29; before all P1 work)

Owner's problem: the game is too easy, so there is no fun and no incentive to progress. After ~5 maps a level-13
character had crafted every item the way they wanted. Requirements from the owner:

- **Monster stats must scale with monster level, PoE-style.**
- **Early game is hard on purpose:** a fresh character is NOT guaranteed to clear T1 on the first tries; you die,
  get better gear, level up, then clear it.
- **Progression is steep:** you really have to farm good equipment.
- **Evasion is too strong:** 50% evade only with very focused high-end late-game gear.
- **Reduce drop rates** (crafting materials especially), **add more affix tiers**, **reduce the stats** items give.
- **Decisions:** T1 has a low monster level; no hard "too weak" penalty from the level gap; **target: a normally
  geared character comfortably clears maps up to about their own level + 3**; modded maps and higher tiers need
  properly crafted gear.

**Phase 1: Done — committed on `balance-overhaul` and deployed to production on 2026-09-29.**
Production release: `20260929-182502-e64cfd2` (balance/data commit `e26fc9c`, map-picker fix `e64cfd2`).
- Monster level = `6 x tier - 2` (T1 = 4, T4 = 22, T15 = 88); it is the item level of drops. Monster life x1.09 and
  damage x1.065 per level around reference level 10 (`MONSTER_LEVEL_SCALING`); tier scaling and early-tier easing
  are gone (tier still drives XP and rarity). Evade chance = `rating / (rating + 30 x monster level)`.
- Drops cut: currency 4% to 1.5% per kill, equipment 1.8% to 0.9%, crafting currencies about 3x rarer relative to
  Scrap, lieutenant / boss / chest guarantees roughly halved, rare weight 3 to 1.6. Level-1 spell power 8 to 11 so
  the hard first map does not drag.
- Measured with the balance bot: a fresh character clears T1 in about 10 minutes with 0-2 deaths and 30% or less
  life at the low point; a "normal player" (maps up to level + 3) reaches level 14 after 10 maps and is still pushed
  back; the prod character Eldurin (level 13, strong crafted gear) clears T1-T4, barely T5, fails T6.
- Tests: balance suites rewritten for the new intent (tests/game-progression/balance*.test.ts, playProgression
  helper), loot/maps/stats/spec tests derive numbers from the data; GAME_SPEC §3/§5/§7/§9 updated. All 1774 always-on
  tests and the BALANCE=1 suites pass, including a new regression check for map-level evasion in the runtime and sheet.
- Release verification: a fresh clone installs with `npm ci` and builds; the production browser's party, trade,
  pickup and restart scenarios passed, and the targeted stash/map-theme smoke passed at 1280×720. At 1024×600,
  the Map Device picker needed more minimum height to keep sticky headings from blocking map clicks; fixed and
  verified. The full browser harness still has intermittent random-drop and small-viewport navigation failures.

**Phase 2: Done — pushed on `balance-overhaul` and deployed as `20260929-190322-126a855`.**
- Affixes now have 7–10 tiers, with top tiers requiring item level 78–84 (T14–15 maps) and lower maximum values.
  All lowest-tier ranges and starting-kit values are preserved. Existing equipment migrates once, retaining
  its identity, relative roll, history, stability, scars and crafting protections.
- Resistances lose 0.5 percentage points per monster level above 10, capped at 40: no penalty in T1–T2,
  -3% in T3, -6% in T4, -39% in T15. The tooltip, map device, character sheet and map HUD disclose it.
- Armour already scales against the size of incoming hits; its sheet example now uses the map's monster
  level. Evasion already uses level-scaled monster accuracy, which the sheet now explicitly shows.
- The Patient Spark now requires level 10 and can drop in T2. The other three uniques unlock in T3/T4/T5.
- XP orbs removed at the owner's request: kills grant XP immediately to each living party member in the
  instance, regardless of distance. Fractional XP carries between kills; physical loot pickup is unchanged.
- Owner playtest: the first boss already feels hard and the balance feels about right. Boss damage is unchanged.
  With immediate XP, the fresh-character bot clears Ashen T1 in 9–10.4 minutes, reaches level 6 and drops to
  35–47% life across three seeds without dying. Level-11 characters fail T5 on all three seeds. Keep watching
  real-player feedback, especially the first Ashen boss's 4.5–5.6-minute bot fight.
- Validation: build/typecheck, 1,776 always-on tests and all 12 on-demand balance checks pass. HUD verified at
  1280×720 and 1024×600. Read-only migration audit of all 5 production characters preserves all 321 item IDs,
  including 148 equipment items / 258 affixes, with crafting metadata intact and no repeated migration.
- Production backup: `/var/lib/forge/backups/pre-phase2-2026-09-29T19-00-57.502Z.db` (integrity check passed).
  Live health reports protocol 3; public JavaScript/CSS match the tested build. Live T1 remains level 4.

## P0: next

1. **Reuse wave-3 bosses to expand the map roster** (owner, 2026-09-29). Remove the wave-3 lieutenant encounter
   from every existing map. Promote those three encounters into final bosses of three new maps, aiming to grow
   the roster from 3 to 6 maps. Reuse the existing boss mechanics; give each new map its own theme, packs and
   implicit. Rebalance wave 3, encounter rewards and map completion time after the split. This is queued work,
   not part of the current phase-2 balance tuning.
2. **UI polish after the font bump.** "Intelligence" label collides with its `+` button in the character panel;
   party row metadata ("Ashen Forge T3 / 6/8 portals") wraps unevenly. Then review the panels not yet checked at
   the new sizes (stash, merchant, crafting bench, map device, trade, menu, tooltips, smaller viewports).
3. **Monster pack modifiers on hover** (owner). When you hover a magic or rare pack, show its modifiers (top
   centre suggested). Spec data: magic packs share one mod (Swift, Stout, Fierce); a rare leader has 2 of
   Juggernaut, Frenzied, Ember-touched, Warded (`GAME_SPEC.md` §8). Needs the mods in the client snapshot and
   a hover hit-test on monsters; uses the shared UI type scale.
4. **Stash quick-move to the special tabs** (owner). With a normal stash tab selected, Ctrl/Cmd-click on a map (or a
   currency) in the inventory should file it straight into the Map Stash / Crafting Stash, instead of into the open
   normal tab, so nothing has to be sorted by hand. `GAME_SPEC.md` §12 already says maps and currency "file
   themselves" on Ctrl-click, but per the owner it doesn't work this way while a normal tab is open. Also check
   Ctrl-click from a normal tab back out, and flasks/equipment (which stay in normal tabs).
5. **Adjustable skill slots** (owner). A loadout row already exists in the skills panel (click skill, click slot,
   right-click clear). Waiting for the owner to say what is missing: key rebinding, slot 0 restricted to basic,
   swapping from the bar in-game, or a bug.

## P1: the spine (build in this order; each step playable and testable)

1. **Account-wide storage.** Stash and atlas progress move from per-character to per-account (owner decision).
   Prerequisite for the atlas. `GAME_SPEC.md` currently says character-specific stash.
2. **Atlas vertical slice** (owner's main idea, see "Atlas design"). 12 hand-authored areas, depth 0-4, tier
   ceiling 1-9, fog with 2 reveals per boss kill, area type label visible once revealed, one dead end (Ember
   Vault), one sealed rare area (Sealed Reliquary), atlas panel in the Map Device, per-account save, party
   discovery credit. Replaces the "chest guarantees tier+1" rule (proposal: same tier, 25% chance of +1).
   Must prove: players choose different routes on purpose; the dead end is a choice not a trap; the sealed door
   creates a goal; a fresh alt benefits without feeling cheated.
3. **Map events, first two.** The Hunted and Echo Rift, rolled at map creation (~25% base, one per map, hidden
   until they happen), map mods and area type raise the odds of specific events. Must feel good, not annoying.
4. **Ingredients, first batch.** Verbs, not stronger currency (Prefix Rune / Suffix Rune to start), tied to areas
   so the best ingredient for a craft is not in the area you farm. Tradeable.
5. **Item bases at ilvl 42+** (tier 8+ under the new monster-level formula), in parallel with 4, so the tier gate yields gear worth wanting.
6. **Economy sinks.** Scrap repairs stability at the bench (decided, simple version) with a cost that escalates
   with the item's crafting history (designer: flat cost breaks scars); hard currencies as the value store
   (Reforging Ember / Tempering Catalyst / Fracture Core); Scrap sinks (territory/bounty fees, map rerolls).
   Watch the Scrap balance for a week before the Exchange.
7. **Rest of the content:** remaining events (Blackout, Vaultbreakers, Second Crown, Wound), remaining ingredients
   (Scar Balm, Anneal, Graft, Transmute, Compass; event-only Echo Shard, Twin Ink, Void Splinter, Crown Fragment),
   remaining dead ends and rare barrier areas, keystone bosses with their own unique pools (needs many more
   uniques; only 4 exist).
8. **Map tree v0** (15 nodes, map-only effects). Biggest scope trap: only once events and ingredients are proven.

## P2: character depth

- **More Sorceress skills and a deeper skill tree** (owner). Today: 8 skills, roughly one row with a few
  prerequisites. `CONCEPTS.md` wants branches that change behaviour (pierce, split, lodge-and-detonate, convert
  damage type) and lists Cinder Comet, Echo Bloom, Phase Step which may not exist yet.
- **Passive tree** (about 250 nodes, notables, keystones). Decide together with the skill tree. Open: points and
  whether they share a pool with skill points; respec cost; behaviour vs stats. Keep it clearly separate from the
  map tree.

## P3: after the spine

- **Echo Exchange (auction house),** specified in `GAME_SPEC.md` §15. After the sinks (P1.6). Decided: simulated
  liquidity with **fake players** that look real (no "house" label). Keep: a small cast of stable names, same
  listing rules and fees as real players, shrinking as real listings grow, priced in hard currencies, and tests
  that trading with fakes never yields a free profit.
- **Leagues** (owner: yes, later): resets the economy and reshuffles the atlas with a new seed. Softens the locked
  "permanent characters, no leagues" decision in `GAME_SPEC.md` §0 / `CONCEPTS.md`; update those docs then.
- More map bases: Drowned Archive, Grave Orchard, a Storm family with the Shocked debuff (real fix for area
  sameness, since only 3 monster families exist).
- After tier 15: decide later, once reaching it feels good.

## P4: new class

- **Barbarian** (owner). A second class, melee-flavoured next to the caster Sorceress. Comes after the passive tree
  so it can ship with its own skills and tree section. Open (to discuss when it's time): skill list and identity,
  weapons/armour/bases (needs melee bases and stats such as strength scaling), resource (Focus vs a rage-style
  meter), and how the map/wave combat suits melee (positioning, hordes). Needs its own art and animations.

## Ideas (unrefined)

- Font-size setting (UI-size multiplier on the type tokens, e.g. 100 / 115 / 130%).
- Survey consumable (reveals one adjacent area's type; a Scrap sink).
- Live-ops basics: telemetry, DB backups, admin tool (check what exists first).
- Client bundle code-splitting (chunks over 500 kB); `vite.config.ts` uses `__dirname` (native config loader warning).
- Stabilise the browser harness: avoid relying on a random equipment drop within a short timeout, and avoid
  walking back through a hideout portal during the 1024×600 map-theme smoke.

## Atlas design (decided 2026-09-29)

Owner's vision: the account has a world map of unexplored territory under fog, starting at one area. Playing a map
at an area reveals neighbours; areas have specialisations (event odds, drops, bases); dead ends exist; rare
areas appear at random with a guaranteed event, behind a barrier. Owner delegated the details to Claude ("you
decide"), informed by an ARPG-designer agent review. Owner can overrule any of these.

- **Fixed hand-authored atlas for launch**, same for every account; a league seed reshuffles it later.
- **Account-wide** progress; deeper into the fog = higher tier ceiling (`min(15, 1 + 2 x depth)`, caps the map-item
  tier usable there); 2-3 neighbours per area, tier-10+ areas reachable two ways.
- **Fog:** a boss kill reveals 2 of the area's unrevealed neighbours (fixed order at first, seeded random later).
  Every party member gets discovery credit; reveals are per account.
- **Map item vs area:** the item carries tier, quality, mods, corruption; the area carries theme, biases, event
  table, implicit. Any map item works at any revealed area up to its tier ceiling.
- **Reward kinds, not bigger numbers:** Ashen = essences and fire bases, Ossuary = jewellery bases, Coliseum =
  armour and Fracture Cores; the best ingredient for a craft sits in a different area than the one you farm.
- **No depletion.** Farming a good area is fine.
- **Dead ends** are the best place for one specific thing, same tier as their entry, never a trap: Ember Vault
  (a key ingredient only drops here), Hollow Ossuary (2x jewellery, +30% quantity), Pit of Echoes (guaranteed 7th
  Echo wave, harder boss, costs a Bounty map), Shrine Field (no boss, event odds x3).
- **Rare barrier areas:** about 1 in 8 clears reveals one as a sealed door showing the key it needs. Keys drop mainly
  in specific area types (route knowledge) plus a small chance anywhere at higher tiers; tradeable, never expire.
  Sketches: Sealed Reliquary (boss twin, unique + Crown Fragment), Gilded Vault (3 Vaultbreaker carriers, 3x
  currency), Black Pit (Blackout + Wound, Twin Ink), Hunting Ground (3 Hunted rares, 3 chosen-class rare bases),
  Rift Nexus (chain of 3 Echo Rifts, event-only ingredients). Parallel rewards; they never unlock tiers.
- **Content reality:** 12 areas of about 6 types, built from 3 rosters x arena size/layout x event table x drop
  table x mod pool.
- **Other decisions:** no carry bonus for the map owner; keystone bosses drop their own uniques; events are not
  shown before entry; stash is account-wide.
- **Top failure modes to watch:** the community solves one best route; areas feel alike on shared rosters; players
  confused about what the item vs the area decides.

## Pre-overhaul balance findings (2026-09-29, from Eldurin, level 13, and a bot replay)

- **Monster level is only a label:** it sets the item level of drops (and unique eligibility) and does nothing to
  monster stats. T4 = "monster level 30" therefore does not mean monsters two times your level; it is just
  `min(90, 6 + 6 x tier)`. What scales monsters is the tier: life x1.16 and damage x1.10 per tier above 1, plus
  early-tier easing (T4: -10% life), plus +8% life / +4% damage per wave.
- **Character:** level 13, all-rare gear, 308 life, 27% fire / 30% cold resist, about **52% chance to evade** (rating
  about 270; the formula is `rating / (rating + 250)`, cap 75%), 4 skills at low ranks (Lance 1, Nova 3, Flame Wave 6,
  Rime Shards 3), **15 unspent attribute points and 1 unspent skill point.** So the character is not even at
  full power, and it still finds T4 easy.
- **Bot replay of that exact character on Ashen Forge:** clears T1-T11 with no deaths; lowest life 60-98% (T4: 92%);
  boss fight grows 53 s (T1) to 116 s (T4) to 375 s (T11); it only fails at T13 (and cleared T15 in another run, so
  single runs are noisy). The design intent was "Tiers 2 and 3 must still push back", which is not true for this
  gear level.
- **Likely causes:** (1) evasion: about 50% of all hits avoided by a level-13 caster is very strong (the constant
  250 is low); (2) early-tier easing plus a slow +16% life / +10% damage per tier compounds too weakly against a
  character that outgrows it with rare drops and crafting; (3) 15 crafted rares by level 13 means gear
  outpaces the ladder. Needs confirming: whether evasion applies to boss and projectile hits.
- **Options to discuss:** raise the evasion constant or cap it lower early; steeper per-tier damage; tie some
  monster stats to monster level vs player level (a real level gap would then matter); remove or shorten the
  early-tier easing; or accept a gentle start and make the atlas depth (tier gating) carry the difficulty.

## Done

- 2026-09-29: Completed phase 2 of the balance overhaul and immediate XP on kill. Map HUD includes implicit
  modifiers and the map-level resistance penalty. Protocol 3 refreshes clients with old shared rules.
- 2026-09-29: Added the authoritative monster level to the top-right map HUD and compact readout. T1 remains
  level 4 (owner confirmed). Raised client compatibility to protocol 2 so pre-balance tabs reload on reconnect
  instead of keeping old tooltip rules. Build, all 1,774 always-on tests and wide/compact visual checks pass.
- 2026-09-29: UI type scale raised to 14 / 16 / 19 / 28 px and deployed to prod.
- 2026-09-29: Committed the font change, roadmap, balance phase 1 and all 21 `src/data/` files; anchored the
  runtime-data ignore rule to `/data/`. A fresh clone now installs and builds successfully.
- 2026-09-29: Deployed balance phase 1 and the short-window Map Device picker fix as
  `20260929-182502-e64cfd2`. Production database backed up and integrity checked before activation;
  server and public health checks passed. Phase 2 remains open for real-player feedback.
