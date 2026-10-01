# A. Atlas map: visual identity and UX brief

Status: design draft for owner review. Nothing here is built. Facts about the current code are cited with paths;
everything else is a proposal.

## 0. One-paragraph pitch

**The Atlas is a chart that your kills light up.** It is a burnt-slate cartographer's table: unexplored ground is
blank charred vellum with faint dead-reckoning dots and soot-fog; when a boss falls, an ember runs down the road to the
neighbouring territory, the fog burns back in a ragged edge, and the new region appears painted in its biome colours.
Six regions, each built from the game's *own* floor tiles, props and monster sprites, so the map looks like the game and
costs almost no new art style risk. Tier is a material ladder on the node plate (iron, bronze, gilt, ember-cracked,
void-etched), theme is the emblem, state is light: dark = unknown, ember pulse = available, steady warm glow = cleared,
violet tear = sealed.

## 1. What exists today (and why it reads as "unfinished")

| Fact | Where |
|---|---|
| The Atlas is a sub-view of the Map Device panel (`showAtlas` state), opened from a button, closed with Back | `src/ui/panels/MapDevice.tsx` (`showAtlas`, `showTree`) |
| 25 nodes are absolutely positioned DOM `<button>`s (146 px wide text plates, `#2a241d` fill, 1 px border) on a `min-width:1900px` div, joined by an SVG of 2 px dashed lines. Undiscovered nodes are literally labelled "Unexplored" | `src/ui/panels/Atlas.tsx`, `src/ui/styles/panels.css` lines 850-896 |
| Node coordinates are a % grid: x = depth column (5..85), y in {3,20,25,50,75,98}; two horizontal lanes | `src/data/progression/atlas.ts` (`x`, `y` fields) |
| No icons, no imagery, no theme cue except the words "Forge / Crypt / Arena"; tier is text ("T7"); state is a border colour | `Atlas.tsx`, `panels.css` |
| Selection detail is four paragraphs of caption text in a 145 px scroll box | `.fe-atlas__detail` |
| The tree is five stacked columns of identical text boxes joined by a 2 px stub | `src/ui/panels/MapTree.tsx`, `.fe-maptree__*` |
| No sound, no animation, no discovery moment. Boss kill silently changes `progress.discovered` | (absent) |
| Map slot / scarab sockets / Activate live in the *other* half of the same panel, so choosing an area and seeing your map are two different screens | `MapDevice.tsx`, `src/ui/items/Containers` |

Diagnosis: it is a *form*, not a *place*. The data model (25 areas, reciprocal routes, ceilings) is good and tested; the
presentation contributes nothing to the fantasy, and hides information that is actually interesting (boss, family,
drop specialties, keys, encounter odds) in prose.

## 2. What we keep / what we throw away

**Keep**
- The whole data model: `AtlasAreaDef`, ids, neighbours, `tierCeiling`, `classWeights`, `currencyWeights`,
  `ingredientDrops`, `uniquePool`, sealed / dead-end flags, fog rules (`src/data/progression/atlas.ts`,
  `src/game/progression/atlas.ts`, GAME_SPEC section 7). Topology and gameplay rules are not part of this brief.
- One DOM `<button data-area="..." aria-pressed>` per node, positioned over the art. The existing browser scenarios
  (`atlas`, entry/key flows at 1024x600) select on these; keeping them means visuals change without rewriting tests, and
  keyboard/screen-reader access stays free.
- All text as DOM on the shared type scale (AGENTS.md: 14/16/19/28 px; `tests/ui/typography.test.ts` enforces it).
- "Area type label only after discovery" and "Unexplored shows nothing" rules (ROADMAP Atlas design section).
- `keystoneRewards`, `mapBaseImplicitText`, `mapBosses` helpers as data sources for the detail rail.
- The Map Stash picker (`MapStashView`) and the scarab socket components (`ScarabSlotView`): re-housed, not rewritten.

**Throw away**
- `.fe-atlas__*` and `.fe-maptree__*` CSS, the SVG `<path>` routes with `preserveAspectRatio="none"`, the 1900 px
  scroller, the hard-coded y transform `10 + n*0.8`, the "Unexplored" plates.
- The lane-grid coordinates (`x`, `y`): replaced by a designed geography (section 4). Topology (`neighbours`) is untouched.
- Text-first detail box, the Back / "Use this area" two-step, the Atlas-as-modal-inside-a-panel structure.
- Nothing in the sim is touched by this brief.

## 3. Art direction: "The Ember Chart"

### 3.1 Pillars
1. **Light is progress.** Dark, cold, blank = unknown. Warm ember light appears exactly where the account has been.
2. **It is the game's own world, seen from above.** Region ground is baked from the in-game theme floors
   (`tile/<theme>/floor|detail|edge`, 16x16 variants from `src/art/tiles.ts`), landmarks are the in-game props
   (`brazier`, `standingStone`, `crystal`, `pillar`, `ruinWall`, `banner`, `anvil`, `rubble`, `bones` in `src/art/props.ts`),
   the boss and monster portraits are the real monster sprites. Nothing new to keep stylistically consistent except the
   node plates and emblems.
3. **Reads at three distances.** Overview (icons and colours only), working zoom (plate + name + tier), inspect (rail with
   boss, family, drops). Never text-only.
4. **Ember and hot white are scarce** (CONCEPTS section 13): only reachable/interactive things glow. A screen where
   everything glows means the palette is wrong.

### 3.2 Palette and materials (all from `src/art/palette.ts`, GAME_SPEC section 10)
| Role | Colours |
|---|---|
| Unknown ground (charred vellum) | ink `#0d0b0e`, coal `#1a1619`, char `#2a2326`, dotted grid in iron `#3b3438` |
| Fog / soot | coal to char at 70% alpha, two scrolling noise layers; burn edge is ember `#e8662a` at 35% then flame |
| Known ground | per-biome tile ramps (table 4.1), lifted 10-15% so the chart reads brighter than the in-game floor (a map is drawn, not lit by a wand) |
| Frames (tier ladder, 5.2) | iron `#3b3438`, bronze/ochre `#b8862f`, gold `#e0b04a`, ember-crack `#e8662a`+char, void-etch `#7b3fa0`+`#c07bff` core |
| Cleared | warm bone `#cbbfa8` inner ring + steady ember dot; NEVER green (green is reserved for "fits / good" in tooltips) |
| Sealed / anomaly | void `#7b3fa0`, void glow `#c07bff`, torn-paper edges in parchment `#e8dcc0` |
| Text | parchment on metal-deep plates; region banners parchment at 55% alpha |

### 3.3 Type
Existing tokens only: Cinzel (`--font-title`) for region banners, area names on the rail, and the tree title;
Alegreya Sans (`--font-text`) for everything else. Sizes strictly `--font-ui-caption/secondary/body/title`
(14/16/19/28). No text is drawn into any canvas: names, banners and tooltips are DOM overlays so they obey the type-scale
rule and stay crisp at every zoom.

### 3.4 Motif
The **ember spiral sigil** (`drawSigil` in `src/art/fx.ts:113`, sprite `fx/sigil`, 8 frames) is the compass rose, the
Cinder Crossing mark, the four corner ornaments and the "you are here" marker. It already ties portals, the map device
and magic together (CONCEPTS section 13); the Atlas becomes its natural home.

## 4. Geography

### 4.1 Regions (one biome per `AtlasAreaType`, one emblem per `baseId` theme)

Two visual channels so that 25 areas on 6 themes do not look the same: **region ground = area type** (where the node
sits on the chart) and **emblem/halo = map theme** (what you will fight). A forge-type area running the Chainworks theme
(The Last Kiln) sits on basalt but wears an iron emblem: the player learns "this forge is a factory".

| Region | Types | Ground (baked from) | Chart features | Areas |
|---|---|---|---|---|
| **The Cinder Reach** (north) | forge | `tile/ashenForge/*` + lava-vein decals | glowing lava rivers between nodes, chimney stacks, `brazier` rows | Ember Road, Furnace Yard, Shattered Forge, Crown Foundry, Ember Citadel, The Last Kiln, Heart of the Forge |
| **The Rimed Deep** (south-centre) | crypt | `tile/rimedOssuary/*`, `tile/choralCrypt/*` | frozen river, bone fields (`bones`), `crystal` clusters, violet glass towers | Bone Approach, Glass Sepulchre, Winter Throne, Frozen Passage, Echo Bastion |
| **The Iron Marches** (south) | arena | `tile/ironColiseum/*`, `tile/chainworks/*` | rusted plate roads, sand pits, tar pools, `banner` poles, ring-shaped arenas | Iron March, Champion's Approach, Eternal Arena |
| **The Verge** (far west / far east) | frontier | `tile/cinderChapel/*` scorched stone + `standingStone` | standing-stone rows, the big sigil compass | Cinder Crossing, Shrine Field |
| **The Margins** | vault / dead end | none: drawn *on the chart border* as pinned annotations (cropped vignettes, ink-and-wash) | each dead end is a small pinned "insert" with a dashed leader to its entrance, so a dead end reads as a side note, never as a road | Ember Vault, Hollow Ossuary, Pit of Echoes (Shrine Field also a spur) |
| **The Tears** (centre band) | sealed | void backdrop showing through slits in the chart | five ragged tears in a horizontal band; each holds a locked door and a keyhole in its key's colour | Sealed Reliquary, Gilded Vault, Black Pit, Hunting Ground, Rift Nexus |

Region borders are drawn like chart borders: a 2-px rope line (iron + bone dither) with a wax-seal knot where a road
crosses. Region names are DOM banners (28 px Cinzel, tracked out, 55% alpha, `pointer-events:none`) that fade in when the
region is at least partly discovered and are replaced by a small "?" stamp otherwise.

### 4.2 Coordinates (art pixels on a 640x360 chart; world is 640x360 art px, shown at 2x or 3x)

Topology is unchanged. These replace the `x/y` percent fields (proposal; tune in the prototype):

| Area | x,y | | Area | x,y |
|---|---|---|---|---|
| cinderCrossing | 50,180 | | winterThrone | 330,262 |
| emberRoad | 120,88 | | emberCitadel | 400,48 |
| boneApproach | 118,262 | | frozenPassage | 400,255 |
| emberVault (spur, top edge) | 95,26 | | lastKiln | 470,60 |
| furnaceYard | 190,74 | | echoBastion | 470,248 |
| glassSepulchre | 190,190 | | heartOfForge | 545,68 |
| ironMarch | 190,300 | | eternalArena | 545,282 |
| hollowOssuary (spur) | 262,215 | | shrineField (spur) | 604,34 |
| pitOfEchoes (spur, bottom edge) | 215,342 | | sealedReliquary | 330,168 |
| shatteredForge | 260,60 | | gildedVault | 400,158 |
| championsApproach | 262,300 | | blackPit | 470,168 |
| crownFoundry | 330,52 | | huntingGround | 545,172 |
| | | | riftNexus | 604,164 |

The cross-lane roads run vertically through the central band; the Tears sit *between* them so a sealed area can never be
mistaken for a road destination (the current code needed a special-case bezier for exactly this: `Atlas.tsx` comment
"sealed destinations sit between the two lanes").

### 4.3 ASCII sketch (not to scale)

```
 THE MARGINS   o Ember Vault                                                     o Shrine Field
                \                                                                  \
 THE CINDER REACH  Ember Road--Furnace Yard--Shattered Forge--Crown Foundry--Ember Citadel--Last Kiln--Heart of Forge
             /        |             |               |              |             |            |          |
 Cinder  ==>*         |     (tear)  |      (tear)   |    (tear)    |   (tear)    |    (tear)  |  (tear)  |
 Crossing   \   THE RIMED DEEP                 THE TEARS (sealed band: Reliquary  Gilded  Black  Hunting  Rift)
             Bone Approach--Glass Sepulchre    Winter Throne----Frozen Passage----Echo Bastion
                  |               \  o Hollow Ossuary   |             |                |
             THE IRON MARCHES: Iron March-----Champion's Approach            Eternal Arena
                  \  o Pit of Echoes
```

## 5. Nodes

### 5.1 Anatomy (art px; shown 2x/3x)

```
         crown pips (boss, 1-3)             <- 12x6
              .-^-.
        _.--"  ___  "--._                   plate frame, 40x40, material = tier band
      .'  ,-'  emblem  '-.  `.              emblem 24x24 in the centre (theme)
     |   |   (   *   )   |   |             inner ring = state light (glow layer)
      `.  `-.._____..-'  .'                 halo 56x56 additive, theme colour
        "--._  ___  _.--"                   
             ~ T7 ~  pips ●●○○○             tier pips: 5 slots, each = 3 tiers (12x4)
            [ Furnace Yard ]                name plate (DOM, 14/16 px), only at zoom>=2x, or hover/selected
```

- **Plate frame** (40x40): five materials by ceiling band: T1-3 forged iron, T4-6 bronze, T7-9 gilt, T10-12 ember-cracked
  (emissive fissures in the frame), T13-15 void-etched with a hot-white core seam. A rivet count adds one rivet per tier
  within the band, so "T5" vs "T6" is readable without text.
- **Emblem** (24x24): six theme glyphs drawn from the same primitives as the currency icons: Ashen Forge = anvil over
  a coal; Cinder Chapel = broken rose window; Rimed Ossuary = skull in a shard of ice; Choral Crypt = open-mouthed cantor
  in a niche; Iron Coliseum = arch and crossed blades; Chainworks = cog and hook.
- **Halo**: 56x56 soft additive sprite tinted with the theme colour (ember, ochre, frost, violet, rust, tar-grey).
- **Boss crown pips**: 1 pip normal, 2 keystone-unique areas (those with `uniquePool`), 0 for Shrine Field (no boss).
  Hover shows the boss portrait in the rail.

### 5.2 State table

| State | Visual | Motion | Sound | Notes |
|---|---|---|---|---|
| **Undiscovered** | nothing but fog; if an *adjacent completed* area still has unrevealed neighbours, a thin **smoke plume** (2 px wide, 24 px tall, ember tip) rises at that neighbour's true position, no plate, no name, not clickable | plume sways; embers rise | none | shows "there is more here" and where, without spoiling identity. Owner-decided rule (fog hides name/type/rewards) preserved |
| **Discovered, unvisited (available)** | full plate, coloured halo, ember ring pulsing slowly (1.6 s), name plate on | pulse | hover: soft `uiHover`; select: stone chime | |
| **Selected** | bright flame ring (2 px), corner brackets, a "you are here" mini-sigil spins above the plate; route to it brightens | ring rotates | `atlasSelect` | mirrors `aria-pressed` |
| **Cleared** (credit earned) | inner ring steady bone-white, a small wax-seal stamp bottom-right, halo dimmed 40%, roads to it "cooled" (bone) | one slow ember mote every ~4 s | none | first-clear point gem (tree points) shows as a tiny gem on the seal until seen |
| **Boss-only marker** | crown pips above plate | crowns glint | | |
| **Dead end** | plate hangs from a dashed leader on the chart margin; a lantern-on-a-pole ornament where the road ends | lantern flickers | | never drawn on the main road grid |
| **Sealed (no key)** | ragged tear in the chart, plate replaced by a locked door in the key's colour, keyhole glyph, chain | chain sways | key-clink on hover | "Reveal" state from the 1-in-8 door roll: the tear *rips open* on first appearance |
| **Sealed (key owned)** | door unlocked ajar, key-colour light spills out, dashed thread of that colour from the key's icon in the dock to the door | light breathes | `atlasSeal` on select | thread only exists while a key is in inventory/stash (already resolved by the server for entry) |
| **Fits current map** (map slotted, tier <= ceiling) | normal | | | small check pip on the plate |
| **Too shallow** (map tier > ceiling) | desaturate 60%, chain glyph over tier pips, tooltip "needs an area accepting T{n}" | none | uiError on click | replaces the red sentence at the bottom of the detail box |
| **Corrupted map slotted** | selected node gets a void hairline crack overlay and violet halo; other nodes unchanged | crack pulses | low sub-thump on select | corruption is a map property; this makes the Atlas acknowledge it |
| **Newly revealed** | plays the discovery cinematic once (5.4) | see 5.4 | `atlasReveal` | |

### 5.3 Tier cues beyond the plate
- Region tint deepens toward the east: a gentle horizontal gradient overlay (cool to hot) sells "deeper = closer to the Heart".
- A slim **tier ruler** runs along the bottom edge of the viewport (1..15) with a marker at the slotted map's tier and
  every node's ceiling as a tick on the region strip. Purely orientation; 16 px tall.
- Nodes whose ceiling equals the slotted map's tier get a tiny "Ceiling" corner flag (the sweet spot for "I climbed here").

### 5.4 Connections, fog and the discovery moment

**Roads.** Drawn per frame on the canvas from authored control points (2-3 per edge, Catmull-Rom, so cross-lane roads bow
into the gaps). Pattern is a 3 px cobbled band (two-tone iron + stone dither, 2 px dash offset so it reads as a path).
Kinds: *hidden* (not drawn), *known-not-walked* (dotted, char), *open* (both ends discovered: solid cobble), *walked*
(both ends completed: bone-lit, with slow ember dots travelling along it in the direction of depth), *spur* (dashed leader
ending in a lantern).

**Fog.** Two layers baked at 160x90 art px and scaled 4x with pixelation for the unknown ground: (a) a `valueNoise`
soot texture (`src/art/shade.ts`) scrolled slowly in two directions; (b) a reveal mask built from discs around every
discovered node (r about 70 art px) and capsules along open roads, with the edge noise-warped and rimmed by a 3-px ember
burn line. Undiscovered nodes lie entirely under (a) with no reveal disc, so nothing leaks.

**Discovery cinematic** (plays the first time the Atlas is opened after a boss revealed something; 1.6 s, skippable by any
click; audio `atlasReveal`):
1. the camera eases to the *completed* area (0.3 s);
2. an ember dot runs along the road to the new node at 240 art px/s, leaving bone-lit cobble;
3. the fog reveal disc expands from 0 to full over 0.6 s while the burn line glows white-hot then settles;
4. the plate "forges in": 6 frames of scale 1.25 to 1 with a hammer spark burst; name plate types on;
5. rail auto-selects nothing (never steal focus), but a "New" flag stays on the plate until inspected.
Knowing "what is new" needs a per-viewer seen-set; use localStorage (per-viewer convenience, try/catch, degrade to no
cinematic) for slice 1 and an account flag later if the owner wants it durable.

**Parallax / ambient animation** (all cheap, all optional via a "Reduce motion" setting):
- three canvas layers: ground (0 parallax), fog-drift (0.9x), embers/ash (1.15x); a 6-px shift between layers on pan is
  enough to feel like depth;
- ambient: lava-vein pulse in the Reach, drifting frost glints in the Deep, torch flicker in the Marches, a slow sigil turn
  in the Verge; particles are the same `fx/ember|ash|frost|spark` sprites the game uses;
- `prefers-reduced-motion` and the game's screen-shake setting both switch off parallax, plumes swaying and the cinematic
  (which becomes a 0.2 s cross-fade).

### 5.5 Sound (procedural, `src/audio/sfx.ts` recipes; ids must be appended to `SFX_IDS` in `src/contracts/audio.ts`, a frozen contract with a required-recipe test)
| id | Recipe sketch | Group |
|---|---|---|
| `atlasOpen` | slate scrape (brown noise sweep) + one low bell, reverb send 0.4 | ui |
| `atlasHover` | 25 ms soft tick, pitchVar 0.08 (bank-eligible) | ui |
| `atlasSelect` | stone chime, two partials a fifth apart | ui |
| `atlasRoute` | ember crackle (crackle noise) that follows the dot; 0.8 s | flow |
| `atlasReveal` | rising three-note bell ladder, `fixedPitch`, `impact` at the plate-forged frame so flash and sound align (`sfxImpactDelay`) | flow |
| `atlasSeal` | chain drag + key turn + latch, dual transient | ui |
| `atlasZoom` | soft paper-slide, 120 ms | ui |
| ambient bed | -30 LUFS low drone + ember crackle while the table is open; the hideout music ducks 6 dB (existing `duck`) | ambience |
Frequent ones (`atlasHover`, `atlasZoom`) declare a `bank` like other frequent ids.

## 6. Layout and interaction

### 6.1 Structure
The Atlas stops being a sub-view. One full-screen overlay, **the Cartography Table** (hotkey `M`, replaces the current
Map Device panel; the legacy `PanelShell panel="mapDevice"` keeps its id so hotkeys and stash drag targets keep working):

- **Centre**: the chart viewport (canvas + DOM button layer).
- **Right rail** (320 px): inspector for the selected area (or the tree node while in tree mode).
- **Bottom dock** (96 px): the device: map slot, four scarab sockets, expedition readout, Activate. It is always visible so
  the player never loses the map they are choosing a destination for.
- **Mode tabs** top-left: `Chart` | `Codex` (the tree, section 8) | (no Stash tab: maps and scarabs are dragged from the inventory, which opens beside the table; see the addendum at the end of section 6.7).

### 6.2 Wireframe, 1280x720 (panel about 1100x696)

```
+--------------------------------------------------------------------------------------------------+
| [Chart] [Codex] [Stash v]     THE ATLAS        7 / 25 areas charted        Points 3        [x] |
+---------------------------------------------------------------------+----------------------------+
|  THE CINDER REACH                                            . shrine|  FURNACE YARD          T1-5|
|      (o)Ember Road ---(O)Furnace Yard ---(#)Shattered Forge          |  [boss portrait: Cinder    |
|        \                 |  selected                                  |   Matriarch  x2 crown]     |
|  ==>*  ~  "?"plume       |                                            |  Forge . Ashen Forge       |
|        \      THE TEARS  (~) (~) (~) (~) (~)                          |  ----------------------    |
|   (o)Bone Approach--(o)Glass Sepulchre                                |  Fights: [ashling][skitter]|
|          THE RIMED DEEP                                               |          [spitter][stalker]|
|                       (o)Iron March                                   |  Drops: [wand x2][sceptre] |
|                        THE IRON MARCHES                               |         [Catalyst x2]      |
|   [tier ruler 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15]   [-][+] [fit]    |  Encounters here: Hunted   |
|                                                                      |   +10%, Wound +5%          |
|                                                                      |  Implicit: Ember Ess. x3   |
|                                                                      |  [ Set course ]            |
+---------------------------------------------------------------------+----------------------------+
| [MAP T4 Cinder..] [scarab][scarab][scarab][scarab] | Danger .. Qty +58% Rarity +41% (?) |[ACTIVATE]|
+--------------------------------------------------------------------------------------------------+
```

### 6.3 Wireframe, 1024x600 (the hard minimum the browser scenarios use)

The rail becomes a **drawer**: closed by default, opens on selecting a node (slides over the right 300 px, 180 ms),
`Esc` closes it. Dock collapses to one 64-px row: map icon, 4 socket icons (icon-only, tooltip), readout summary, button.

```
+--------------------------------------------------------------------------+
| [Chart][Codex][Stash]     THE ATLAS   7/25 charted   Points 3         [x] |
+--------------------------------------------------------------------------+
|                                                          +--------------+|
|          chart (about 980 x 420 viewport)                | FURNACE YARD ||
|                                                          | boss . drops ||
|                                                          | [Set course] ||
|                                                          +--------------+|
+--------------------------------------------------------------------------+
| [MAP] [s][s][s][s]  Qty +58% . Rarity +41% . Danger 3          [ACTIVATE] |
+--------------------------------------------------------------------------+
```

### 6.4 Pan / zoom / focus
- **Zoom is discrete and pixel-perfect**: three levels: *Overview* 1x (icons and colours only; whole 640x360 chart fits),
  *Chart* 2x (default; plates + names), *Inspect* 3x (names + ambient detail + parallax). Wheel, `+ -`, or the on-screen
  buttons step between them with a 140 ms cross-scale; never non-integer scales (they smear pixel art).
- **Pan**: drag, arrow keys / WASD (the game's movement keys work while the table is open), edge-scroll off. Inertia 250 ms.
  The viewport clamps to the chart with a 40 px overscroll for the parchment border.
- **Focus**: selecting a node centres it (as `Atlas.tsx` does today via `scrollTo`); `F` = "fit to discovered"; `Home` =
  Cinder Crossing; `G` = jump to the area of the slotted map's ceiling ("where can I go with this?").
- **Keyboard**: `Tab` cycles discovered nodes in graph order (DOM buttons), `Enter` selects, `Space` sets course, `E`
  activates when the dock is ready. All existing button `aria-label`s remain.
- **Click model**: click = select and open inspector; double-click or `Enter` on a selected node = "Set course" (no
  Back/Use two-step). If a map is not slotted, the rail says to drag one from the inventory into the dock.

### 6.5 Tooltips (hover, DOM, caption/secondary type only)
Hover over a plate (150 ms delay) shows a 240 px compact card: name, `Forge . T1-T5`, boss name, two drop chips with icons,
"+N% event odds" if any, and one status line ("Cleared", "New", "Needs Reliquary Key", "Too shallow for T7"). The rail
shows the full detail; the tooltip is only for scanning. Tooltips flip at viewport edges and never cover the hovered plate.

### 6.6 The rail (inspector) contents, in order
1. **Hero band** 320x96: the boss idle sprite (real `monster/*/idle` frame, 3x) standing on the theme floor tile with a
   fire/ice/torch light pool and the area name in 28 px Cinzel. Shrine Field shows the banner-and-brazier prop instead.
2. **Facts row**: type chip, theme chip (emblem), tier range (`atlasTierCeiling`), and depth ("Depth 4").
3. **Fights**: family strip of the theme's monster idle sprites (4-5 at 2x) with names on hover (from `THEME_ROSTER`).
4. **What it pays**: drop chips (currency `icon()` art, class icons) with multipliers ("x2 Ember Essence", "Wand bases x2"),
   plus ingredient bosses, keystone uniques (existing `keystoneRewards`) as unique-orange icons.
5. **What can happen here**: encounter odds from `mapEventOdds` as small glyph chips (glyphs from part C), replacing the
   current paragraph.
6. **Entry**: key icon and requirement, Territory fee (`territoryEntryFee`), Bounty requirement for the Pit.
7. **Set course** button + "why disabled" line (too shallow, sealed without key, not discovered).

### 6.7 Map device and scarab flow (the dock)
One left-to-right sentence: **Chart a course, load the map, socket scarabs, read the price, light it.**

```
 1 COURSE            2 MAP              3 SCARABS            4 PRICE / READOUT             5 GO
 Furnace Yard  <-    [ T4 Rare map ]    [s1][s2][s3][s4]     Danger: Teeming, Fortified    [ ACTIVATE ]
 (set on chart)      drag / click       drag / Ctrl-click    Qty +58%  Rarity +41%         fee 1 Scrap
                     from inventory     tooltip = effect     Event odds (?)  Tree: 12 nodes
```
- Steps are *soft*: any order works. The dock draws a thin ember thread through whichever step still blocks Activate.
- Scarab sockets are 44 px tiles; empty sockets show a ghost of the family they accept once families beyond Haste and
  Invasion exist (`src/data/scarabs.ts`); a socketed scarab shows its tier frame (Weathered/Etched/Gilded/Exalted =
  the same iron/bronze/gilt/ember frame ladder as nodes).
- The readout is the existing summary/luck breakdown (`store.rules.openMap`, `lootLuck`) in a popover from the "(?)":
  full stat breakdown lines, personal luck, event odds, party scaling, fees. No new rules.
- **No stash drawer** (owner feedback after wave 1/2, now the game-wide rule in AGENTS.md): the table opens together with the
  inventory, which sits at the right (the table is `100vw - panel width - 36 px` wide, so the chart, dock and inventory fit
  side by side at 1280x720 and 1024x600). The dock's map slot and scarab sockets take items dragged from the inventory (slots
  glow green while a valid item is dragged, turn red with the reason when it is refused; Ctrl/Cmd-click in the inventory
  quick-loads); dragging out returns them to the inventory. Maps in the Map Stash and scarabs in the Crafting Stash are moved
  into the inventory with the Stash panel first. The inspector rail is always a drawer below 1500 px of window width, and the
  dock wraps into two rows below 900 px of table width (container query).
- Activation feedback: the chosen node flares, the dock's socketed scarabs consume with a spark each, a 0.6 s sigil
  ring closes over the map slot, then the existing portal opening runs. `portalOpen` sound already exists.
- While a portal is open, the dock's map slot shows the portal status note that `PortalNote` renders today (kept), and the
  target node shows a small portal glyph.

## 7. State machine for the view (for implementers)

`closed -> open(chart) <-> open(codex)`; `chart.selected: AtlasAreaId | null`; `chart.zoom: 1|2|3`;
`chart.camera: {x,y}`; `drawer: none|stash|inspector`; `cinematic: null|{from,to,t}`. Everything except selection is
view-only state (Preact local state; no store changes). Selected area is still synced to the device's `areaId` state as
today.

## 8. The Codex (Atlas tree) visuals

Structure and numbers are in brief B; this section is the look. The tree is the **reverse of the table**: the same slate
seen as a brass-and-wire instrument panel.

### 8.1 Language
- Background: dark slate with etched concentric bearing rings (compass degrees, 15-px ticks) and the six branch names as
  engraved arcs. Constellation wires are 2-px brass (`#8a6a3e` to `#c9a064`); allocated wires carry an ember glow with
  slow travelling dots.
- Distinct from the future character passive tree (which should read as sinew/rune-circuit, red and blue): the Codex is
  **brass, wax and glass**, warm and mechanical.

### 8.2 Node classes (art px, drawn at 2x/3x)
| Class | Size | Look | Locked | Reachable | Allocated |
|---|---|---|---|---|---|
| Small | 16 | brass rivet-head with a 10x10 glyph in relief | dark iron | brass, faint ember pulse | polished, glyph glows in branch colour |
| Notable | 24 | wax-seal medallion in the branch colour, raised rim, glyph 14x14 | greyed wax | wax with pulsing rim | bright wax + gold edge, 2 rotating sparks |
| Keystone | 40 | forged iron sigil-ring, chains, an ember core (emissive), glyph 24x24 | chained, core dark | core embers, chain loosens on hover | chains fall away, core white-hot, ring rotates slowly |
| Tier-bonus | 24 | stamped plate with roman numeral, tier-band frame material | | | numeral lit |
| Theme-specific | 24 | wax seal in the *theme's* colour with the theme emblem | | | |
| Event-focused | 24 | violet rift-glass lens with the event's glyph inside | | | lens glows, glyph animates |
| Mutually excluded | any | crossed by an iron chain, tooltip "Excludes X" | | | |

Glyph grammar (so 60+ nodes are not 60 hand-drawn icons): a code-generated set of about 30 primitive 10x10 glyphs (drop,
gear, skull, coin, eye, flame, snowflake, chain, key, crown, hourglass, star, ring, paw, hook, bell, chest, anvil,
scarab, bloom, ...) drawn with `Sculpt` and `Frame`, each recoloured through branch ramps. Branch colour identity:
Cartography bone+mana blue, Foundry ember, Bounty rust+olive, Fortune gold, Echoes void glow, Peril blood+hot white.

### 8.3 Allocation feedback (every step a small reward)
1. hover a reachable node: cheapest path from the allocated set lights as a dotted ember line with the cost floated at
   the node ("3 points"); if unaffordable the line is grey and the cost red;
2. click: ember runs along the wires (0.25 s per hop) into the node; hammer strike shakes it 2 px for 2 frames, white-hot
   flash 3 frames, spark burst using `fx/spark`;
3. sound: `codexAlloc` tink pitched by class (small high, notable mid, keystone low gong + sub, chained rattle when the
   chains fall), `fixedPitch` so the ladder stays in tune;
4. refund: node crumbles to ash (`fx/ash` puff), wires go dark from the leaf inward, `codexRefund` dry crunch;
5. keystone: 250 ms hit-stop equivalent (canvas freeze), a ring shockwave across the whole table, six-second ambient
   change (embers thicker, bearing rings glow) until the panel closes.
Tooltip on hover/selection uses the rail (same DOM component), never a floating card that hides neighbours.

### 8.4 Wireframe (1280x720)
```
+--------------------------------------------------------------------------------------------------+
| [Chart] [Codex]      THE CODEX      Points 3 free / 10 earned      [search: "essence"____]   [x] |
+---------------------------------------------------------------------+----------------------------+
|            . . FORTUNE . .                     . . ECHOES . .        |  DEEP SEAMS      (Notable) |
|        o--o--O--o--o--@KEYSTONE                o--o--O--o           |  +40% more Essence weight  |
|       /                                          \                   |  Monsters +8% more Life    |
|   CARTOGRAPHY                  ( ORIGIN )        PERIL              |  ----------------------    |
|      o--o--O--o                  (*)             o--o--O--@         |  Path cost: 3 points       |
|            \                    /  \            /                    |  Excludes: none            |
|   FOUNDRY   o--O--o--o--@      /    \    o--o--O--o   BOUNTY         |  Synergy: Ashen Forge,     |
|                                                                      |  Essence Laden mod         |
| zoom [1x][2x][3x]  [fit]  [path preview: on]                          |  [ Allocate ] refund 15 Sc |
+---------------------------------------------------------------------+----------------------------+
```

## 9. What we can actually produce (be realistic)

### 9.1 The pipeline as it is
- All art is **code-generated pixel art** from raw RGBA `Raster`/`Frame` (colour + emissive layers) with `Sculpt`
  primitives, `valueNoise`, `outline`, a single `PALETTE` (`src/art/raster.ts`, `frame.ts`, `shade.ts`, `palette.ts`).
  It runs in Node and the browser and is deterministic; there are no image assets, and the v2 brief explicitly abandoned
  external/AI art (CONCEPTS section 13).
- DOM art comes out of `icon(id, size)` (integer nearest-neighbour data URLs at 32 px per cell) with
  `image-rendering: pixelated`; sprites come out of `generateSprites()` (`SpriteDef` with frames + emissive masks).
- The in-game renderer is a WebGL2 sprite batcher with dynamic lighting; **the Atlas is DOM**, so it will use a plain 2D
  `<canvas>` (or several stacked) fed from the same `SpriteDef`s, compositing the emissive mask with `lighter` to get the
  same glow feel. No engine library, consistent with AGENTS.md.
- Known cost: an icon-heavy first open hitches (documented in `src/art/dom.ts`); bake lazily in `requestIdleCallback`
  slices and cache.

### 9.2 What is easy, medium, hard
| Item | Effort | Why |
|---|---|---|
| Ground: biome baked from existing floor tiles + noise mottling + region masks + rope borders | M | tile sprites exist; new code is the Voronoi/warp mask and blending (`wangNoise`, `hash2`, `valueNoise` exist) |
| Fog, burn edge, soot scroll, embers | S | noise + particles; all cheap |
| Roads with cobble pattern and travelling dots | S | polyline stroke with dither |
| Node plates: 5 tier materials x (base, glow layer) | M | generated by one parametric function (`plate(band)`), not 5 drawings |
| Six theme emblems 24x24 | M | hand-composed with `Sculpt`, like currency icons; the biggest art-quality risk |
| Sealed tear + 5 keyed doors, dead-end lantern, plume | M | small custom sprites |
| Landmark scenery (reuse props at 1x) | S | existing sprites |
| Boss portraits and family strips in the rail | S | existing monster idle frames at 2-3x; needs a helper `spriteUrl(id, frame, scale)` beside `icon()` |
| Codex node frames, wires, 30 glyph primitives x branch ramps | M | primitives x ramps multiplies value |
| Hand-illustrated regions, painterly map, illuminated borders | **not feasible** | out of style, no asset pipeline; do not promise it |
| Video/particles in DOM beyond the canvas | avoid | canvas particles only |

### 9.3 Prototype-first gate
Before building any UI: a throwaway **Table prototype** page (dev sandbox exists at `src/present/dev/sandbox.ts`; a
`dev/` folder exists) that renders the baked ground + fog + 25 plates + roads at 2x on a 1280x720 canvas from the
authored coordinates. Owner approves the look (or redirects) *before* the interaction and cinematic work. This is the
single biggest risk reducer: art direction is the failed part of v1, and a static frame is cheap to iterate.

## 10. Component list with sizes

| # | Component | Size | Notes |
|---|---|---|---|
| 1 | Chart ground bake (offscreen) | 640x360 art px (1280x720 at 2x; 1920x1080 at 3x) | 6 regions + margins + tears; generated once, cached |
| 2 | Fog layers | 160x90 art px scaled 4x, two scrolls | mask recomputed only on discovery change |
| 3 | Reveal mask | 640x360, 1 bit, warped edge | |
| 4 | Node plate frames | 40x40 x 5 tier bands x (base + emissive) | parametric |
| 5 | Theme emblems | 24x24 x 6 | |
| 6 | Halo sprite | 56x56 additive, 1 tinted | |
| 7 | Crown pips, tier pips, rivets, wax seal, first-clear gem, "New" flag | 12x6 / 12x4 / 4x4 / 12x12 / 8x8 / 16x8 | |
| 8 | Sealed door x 5 key colours + tear frame | 40x48 each; tear 64x72 | |
| 9 | Dead-end lantern, margin leader, insert vignette frame | 12x20; 1-px dashed; 72x56 | |
| 10 | Smoke plume | 8x28 x 4 frames | |
| 11 | Compass sigil / corner ornaments | reuse `fx/sigil`; corner 24x24 x1 | |
| 12 | Road styles | 3 px band, 5 styles | |
| 13 | Region banner (DOM) | 28 px Cinzel | 6 |
| 14 | Chart viewport | flexible; min 700x420 at 1024x600, about 780x540 at 1280x720 | canvas + DOM button overlay |
| 15 | Right rail (DOM) | 320 wide; drawer 300 at compact size | hero band 320x96 |
| 16 | Bottom dock (DOM) | 96 tall (64 compact) | map 44 px, scarab sockets 44 px |
| 17 | Tooltip card (DOM) | 240 wide | |
| 18 | Tier ruler | 16 tall | |
| 19 | Codex world | 512x512 art px (zoom 1x/2x/3x) | |
| 20 | Codex node frames: small 16, notable 24, keystone 40, plus locked/reachable/allocated/excluded | ~40 frames | |
| 21 | Glyph primitives | 10x10 (small, relief) and 24x24 (keystone) | ~30 |
| 22 | Sound ids | 7 atlas + 3 codex + ambient bed | see 5.5 |

## 11. Data and engine changes this brief needs

- `AtlasAreaDef`: replace `x,y` with art-pixel `pos`, add optional `roadControls` per edge and `region` tag (derived from
  `type` by default). No rule changes.
- `src/art/atlas/*` (new): `ground.ts`, `fog.ts`, `plates.ts`, `emblems.ts`, `codex.ts`, `glyphs.ts`; register plate and
  emblem generators in `src/art/icons` style so `icon('atlas/plate/gilt')` works for DOM chips too.
- A `spriteUrl(spriteId, frame, scale)` helper next to `icon()` in `src/art/index.ts` for boss and family portraits.
- New sfx ids and recipes (contract append + analysis test).
- UI: new `Table` overlay component replacing the `showAtlas/showTree` ternary in `MapDevice.tsx`; new CSS with tokens only.
- Nothing in `src/sim` or the wire protocol.

## 12. Acceptance criteria

1. A first-time viewer can tell, without reading, which nodes are unknown, available, cleared, sealed and too deep for the
   slotted map, at 1024x600.
2. Zero text below 14 px; typography test passes.
3. Open-to-first-frame under 250 ms after the first warm bake; bake work never blocks input for more than 50 ms.
4. Discovering an area plays the cinematic exactly once per viewer, is skippable, and is silent-safe with reduced motion.
5. All existing `atlas` browser scenarios pass unmodified except selector text; `data-area` and `aria-pressed` retained.
6. Screenshot review by the owner at both resolutions is the gate for slice 1; no interaction polish before it.
