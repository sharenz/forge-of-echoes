# Onboarding and UX review: the first 15 minutes of Forge of Echoes

Status: **implemented** (see "Implementation status" below). This document was written first as research and design; the owner then decided section 9
(Q1 warm-up: yes; Q3 flasks refill free on entering a hideout; Q4 account-level state with a veteran auto-skip; Q5 names: Map Device / Atlas; Q6 double-click
to load: yes; Q7 protocol bump: yes) and the guide was built against it.
Written 2026-10-01 after a first-time-player run on a clean copy of the committed game (`632f318`) and a second look at
the in-progress Atlas "area modal" and Rook "Wares" work in the working tree.

Trigger: our first outside player: "Very impressive, great design direction. My only gripe is that UI/UX still needs work
and the onboarding itself: it took me ~2 minutes to figure out I need to drag a map to start."

## Implementation status

Built: the tracker with its 11 steps and the closing card, world markers and name plates, the controls cheat-sheet, 17 hints, Help (`H`), panel buttons,
account-level `GuideState` with the veteran rule, warm-up, free flask refill, and fixes F-1 to F-16, F-18 to F-19, F-20 to F-27, F-29 to F-36 (see the list
in `GAME_SPEC.md` section 12b). Not done: F-17 (Rook's prices, owned by the vendor rebuild), F-28 (the short map tooltip). The e2e `--only guide` plays it at
both sizes; its screenshots are in `.shots/e2e-guide-*`. Deviations from the design: the chest opens by walking up to it (it is not clickable), so step 8 says
"walk up"; the one-line hint "flasksRefilled" is the toast of the refill itself; the tracker's `Skip` sits in its footer from the start.

## Contents

1. [Summary and the ten biggest friction points](#1-summary)
2. [How this was tested (and its limits)](#2-method)
3. [The first 15 minutes, moment by moment](#3-walkthrough)
4. [What onboarding exists today](#4-existing)
5. [Committed flow vs the flow being built (Atlas area modal, Rook Wares)](#5-flows)
6. [Design: the first-run experience](#6-design)
   - [6.1 Principles and the 10-minute path](#61-principles)
   - [6.2 The objective tracker and its steps](#62-tracker)
   - [6.3 World-space guidance](#63-world)
   - [6.4 The starter-map "drag me" hand](#64-hand)
   - [6.5 Controls cheat-sheet on first map entry](#65-cheatsheet)
   - [6.6 Contextual first-time hints](#66-hints)
   - [6.7 Help ("?"), glossary, replay and skip](#67-help)
   - [6.8 Copy deck and the strings file](#68-copy)
   - [6.9 Persistent state: schema, protocol, migration](#69-state)
   - [6.10 Veterans, parties, accessibility](#610-cross)
   - [6.11 Where it plugs into the code](#611-code)
7. [Test plan](#7-tests)
8. [UX fix list outside onboarding (prioritised)](#8-fixlist)
9. [Open questions for the owner](#9-open)

Screenshots live in `docs/onboarding-ux/` (all captured headless at 1280x720 unless the name says `1024`). Annotated
images are the `a*-` files; raw captures keep their sequence number.

---

<a id="1-summary"></a>
## 1. Summary

**The core finding.** The game never tells a new player what to do. After character creation the player lands in a
hideout with five interactive objects, no objective, no labels, no highlighted target and a HUD that shows keys for
skills but not for panels. The one object that matters (the Map Device) is *cropped by the top edge of the screen* at
both test sizes, and the single instruction that explains the loop ("Drag a map from your inventory into the slot") is
grey 16 px text at the bottom of a window that only appears after the player has found and clicked that object.
The outside player's two minutes are not a failure of the player; they are the missing first step.

The second finding is that the first map is entered with no guidance at all and punishes standing still: a player who
reads the screen for ten seconds starts taking damage, and an idle character is dead after about twenty (measured,
section 3, "Entering the map"). The balance notes say the early game is hard on purpose; that is fine, but the player has
to be *taught* to hold the mouse button, move and drink a flask before being asked to survive 35 monsters.

The rest of the game is in better shape than the first impression suggests: panels are consistent, the Character
sheet explains itself on hover, the level-up burst and unspent-point badges work, the death screen is reassuring, and
the Controls reference is complete. Most of the work is *sequencing and signposting*, not new systems.

### Top 10 friction points (ranked by severity x how many players hit it)

Severity: **S1** blocks progress or causes quits; **S2** costs minutes or causes a wrong mental model; **S3** friction or
polish. Frequency is the share of first-time players expected to hit it.

| # | Friction | Sev | Freq | Evidence |
|---|---|---|---|---|
| 1 | **No objective, no first step.** Hideout shows no prompt, no marker, no names on the five props. | S1 | ~100% | `a1-arrival.png` |
| 2 | **The Map Device is cropped by the top of the viewport** (screen y ~16 of 720; its hover label is clipped too). The hideout camera leans toward the cursor, so it only appears when the player drifts the mouse up. | S1 | ~100% | `06-arrival-t0-1280.png`, `09-hover-mapdevice-1280.png`, `13-hover-device-1280.png` |
| 3 | **Loading a map is a hidden drag.** The three starter maps look like any item; the only instruction is small grey text at the bottom edge of the dock; the slot is a tiny corner square; Ctrl-click is a footnote. | S1 | ~80% | `a2-atlas.png` |
| 4 | **No combat teaching on map entry.** Nothing says "hold the left mouse button to cast at the cursor", "move with WASD", "flasks are 1 to 3". An idle character takes damage after 11 s and is dead at 20 s. | S1 | ~70% | `a3-map-entry.png`, `91-map-t9-1024.png`, section 3 |
| 5 | **Panel hotkeys are invisible.** Inventory, Character, Skills and Party exist only as I / C / K / P; there are no buttons and no "?" anywhere. The only way to learn them is Esc, Controls. | S2 | ~90% | `a1-arrival.png`, `12-controls-1280.png` |
| 6 | **Death and failure copy contradicts the HUD.** "Map lost. The portals are spent." appears while the card above says "7/8 portals, click the portal to enter". | S2 | ~60% | `a4-death-summary.png` |
| 7 | **Jargon with no on-ramp:** Atlas / Map Device / Cartography Table / Ember Chart for one thing; Surge, Scarab, Passage, Pins, Re-chart, Stability, Focus, Quantity, Rarity, "+10% to all Resistances", and "T1" meaning *easiest* for maps but *best* for affixes. | S2 | ~100% | `a2-atlas.png`, `a3-map-entry.png` |
| 8 | **Unspent points are silent until they are noticed.** A new character starts with 1 unspent skill point and gets 3 attribute and 1 skill point per level, but the only cue is a small chip; a mid-run screenshot shows 6 attribute and 2 skill points unspent at level 3. | S2 | ~60% | `a8-boss.png` |
| 9 | **Flasks are never introduced and never refilled visibly.** Three flasks, no hint to press 1 to 3, and after one run the belt reads 0 / 0 / 2 charges at home with no explanation of how to refill. | S2 | ~70% | `a8-boss.png`, `30-character-1280.png` |
| 10 | **Panels clip at the supported sizes.** The Controls window and the Crafting Bench panel cut text off at 1280x720 and 1024x600 with no scroll cue; the area modal's readout is below the fold at 1024x600. | S3 | ~50% | `a5-controls.png`, `a7-bench.png`, `74-controls-1024.png`, `57-wt2-areamodal-1024.png` |

### The proposed first-run path (detail in section 6)

Eleven short steps in three chapters, never more than five lines on screen:

| Chapter | Step | Tracker line (verb first) |
|---|---|---|
| Your first map | 1 | **Click the Map Device** |
| | 2 | **Pick Cinder Crossing** (click the area on the chart) |
| | 3 | **Drag a map into the slot** |
| | 4 | **Open the area** |
| | 5 | **Step into the portal** |
| Win the map | 6 | **Fight!** (hold the left mouse button, move with WASD) |
| | 7 | **Defeat the Cinder Matriarch** (wave 6) |
| | 8 | **Open the chest** |
| | 9 | **Return home** |
| Grow stronger | 10 | **Spend your points** |
| | 11 | **Equip your loot** |

then a closing "What next" card (craft at the anvil, visit Rook, spend an Atlas point, open another map).

---

<a id="2-method"></a>
## 2. How this was tested (and its limits)

* **Clean copy.** `git worktree add <scratchpad>/wt HEAD --detach` of `632f318` (committed code only), its own server
  (`PORT=18787`, a throwaway SQLite file, a short `ADMIN_DIR` because the unix-socket path was too long) and its own Vite
  dev server on `15173`. Nothing touched production or the shared dev database. A second worktree (`wt2`) was built from
  `git diff HEAD` plus the untracked files to look at the Atlas area modal and Rook's Wares as they are *today* in the
  working tree (server `18788`, Vite `15174`). Everything was removed from the real repo except the screenshots and this
  document.
* **A brand-new account and character** (`uxtester` / `Ysolde`) were registered through the real UI and played with real
  mouse and keyboard events in headless Chromium (Playwright, software WebGL) at 1280x720 and 1024x600. The tooling used
  `window.__foe` only to *find* world positions (where the device is on screen), never to perform the action: clicks,
  drags, Ctrl-clicks, hotkeys and the Esc menu were real input.
* **Limits, stated plainly.**
  * Software WebGL ran at about 10 fps, so I could not judge real-time feel. I do not claim a human cannot kite the first
    wave; I measured the *idle* case and watched the balance bot (`window.__foe.bot`) for everything that needs skill.
  * The first boss is hard (the owner's own playtest says so). My level-3 and level-9 bot runs died to the Cinder
    Matriarch; to see the chest and the return trip I raised the test character to level 22 directly in the throwaway
    database. That path is therefore *not* a first-time-player experience; it is evidence about the screens after the
    boss only.
  * Rook was reviewed in the working-tree build only (the committed stall is being replaced). Party play was reviewed
    from the Party panel and the code, not with two live players.
  * My own note-taking is a sample of one researcher who already knows the game. Severity and frequency are judgement
    calls; the validation step is the usability test in section 7.
* **One mishap to report.** A `pkill -f "src/server/main.ts"` I ran to restart my own server also matched other agents'
  local dev servers for a moment (a `tsx watch` one restarted by itself). It touched nothing persistent, but if another
  agent saw a dropped local connection around that time, that was me.

---

<a id="3-walkthrough"></a>
## 3. The first 15 minutes, moment by moment

Each row is a moment where a first-time player has a question. Severity S1/S2/S3 as above. "Fix" points to section 6
(onboarding) or section 8 (UX fix list).

### 3.1 Title, account, character (0:00 to 1:00)

| Moment | What I saw | Confusion / gap | Sev | Fix |
|---|---|---|---|---|
| Title (`01-title-1280.png`, `01-title-1024.png`) | A beautiful login card. "Log in" is the default tab; "Create account" is a muted tab beside it. No one-line pitch; the footer says "Online only." | A brand-new visitor sees a login, not a sign-up. No hint at what the game is. | S3 | F-25 |
| Register (`02-register-1280.png`) | Username, password, confirm password. Works, validation messages appear after a try. | None. | - | - |
| Character (`03-characters-empty-1280.png`) | One class (Sorceress) pre-selected, short description, name field with placeholder "3 to 16 characters". The "Create character" button is the focus. | The player must invent a name before seeing any game. Not auto-focused. | S3 | F-26 |
| Play (`05-loading-1280.png`) | A loading state while art is generated, then the hideout. | Fine. | - | - |

### 3.2 First arrival in the hideout (1:00 to 3:00)

`06-arrival-t0-1280.png`, `07-arrival-t4s-1280.png`, annotated: `a1-arrival.png`.

* The screen shows: a lit courtyard, the character in a glowing ring at the centre, a chest to the left, an anvil
  lower left, a hooded figure to the right (Rook), a training dummy below, a banner, pillars. The title "Your Hideout"
  sits in the top-right corner. The HUD shows two globes, three flasks, six skill slots (only LMB filled) and a small
  "1 / star 1 K" chip over the deck.
* **What it tells you to do: nothing.** No objective, no prompt, no pulse on any object, no names. The mouse-lean
  camera is the only reason the Map Device ever becomes visible: it is a stone table at the very top edge, its label
  appears only on hover and is itself clipped (`13-hover-device-1280.png`).
* A new player will try, in order of likelihood: click the glowing swirl on the floor under the character (it is just
  a spawn mark; nothing opens, and a click on empty ground is the LMB attack, so wrong clicks cast spells), click the chest (stash opens: inventory-like grid,
  empty, "Shared by all characters on your account"), click Rook (a shop of icon tiles; in the working-tree build I tested the tiles show no visible prices), click
  the anvil (Crafting Bench, an empty bench and a wall of text), hit WASD. Each of these opens something that is
  *not* the way forward and none of them says "that is not the first thing to do". This is where the two minutes go.
* Hover names do exist ("Map Device") but only on hover; nothing teaches that hovering helps.
* Where do the panels come from? Only by guessing I/C/K. The "K" chip is the single hint.

Severity: **S1**, frequency ~100%. Fix: tracker step 1, a world marker, name plates on unused props, an opening camera
framing that includes the Map Device (6.2, 6.3, F-23, F-29).

### 3.3 Finding the Map Device and the Atlas (3:00 to 4:00)

`15-atlas-opened-1280.png` / `a2-atlas.png`.

* Click on the device: the character walks to it and **two windows open**: "The Atlas" (left, chart canvas) and the
  Inventory (right). So the maps are in view, which is good, but:
* The Atlas is a dark chart with **one lit node** ("Cinder Crossing", T1, with a small "3" badge), a handful of "?"
  nodes, a lens switch (Stock / Sources), a pin tray (0/3), zoom controls, a "Motion: auto" toggle, a tier ruler 1 to 15
  and a dock strip at the bottom: a small "Drop map" square, "No map", "Surge: Surges refresh in 15 h 12 m",
  "Scarab 1..4", "Passage", a disabled "Activate" button.
* The one useful line is at the very bottom: "Drag a map from your inventory into the slot: it opens the area it is
  bound to." It is in the secondary (16 px) grey style, below everything, and a first-time eye lands on the big chart
  and the busy toolbar first.
* In the inventory the three starter maps are in the second row with a small "T1" badge and the same frame as
  currency. **Nothing highlights them** in the committed build (the working-tree area modal outlines fitting maps in
  green, which is the right idea).
* "Activate" is disabled without saying why. Hovering a map shows a long tooltip (monster level, "Map Item Quantity
  +0%", "Waves 6", boss, "Experience 0.5x", "Monsters have +10% to all Resistances", flavour, "Hold Alt for mod
  details"): useful, but a wall of numbers for a first look (`16-hover-map-1280.png`).
* At 1024x600 the Atlas and the Inventory share the full width, which works, but the instruction line and the dock are
  cramped.

Severity: **S1** (the reported two minutes) because the drag target is small, the cue is quiet and the maps are not
marked. Fix: tracker steps 2 to 4, the hand animation, map highlight (6.2, 6.4, F-1, F-18).

### 3.4 Loading the map and opening the portal (4:00 to 5:00)

`17-dragging-map-1280.png`, `18-over-slot-1280.png`, `19-map-slotted-1280.png`, `20-activated-1280.png`.

* Real drag with the mouse works well: the ghost follows, the slot lights green when the map fits, the dock fills in
  ("Cinder Crossing", "Re-chart", three pips, "Surge 3/3", quantity +30%, rarity +15%, danger 0, "Next drops this area
  100%"). "Activate" turns orange.
* **After Activate** the Atlas closes, the toast says "The portals to Cinder Crossing are open.", a pill appears
  top-left ("Cinder Crossing T1, 8 portals") and the portal stands near the top of the hideout. The Inventory stays
  open on the right and covers part of the portal's surroundings at 1280x720. Reasonable, but the player is not told
  "now click the portal"; that line exists only in the small top-right card ("Click the portal to enter. Each entry
  uses one.") and only once the inventory is closed.
* Clicking the portal walks the character in. Clicking the device again re-opens the Atlas, whose status line then
  says "Cinder Crossing T1 - 8/8 portals left. Click the portal to enter. A new map closes it once nobody is inside."
  (`23-walking-to-portal-1280.png`): good copy, but it appears *only if you go back*.
* "Portals", "8 portals", "Each entry uses one": the player does not learn that dying costs a portal until the death
  screen.

Severity: S2 (steps 4 and 5 lack a clear next action). Fix: steps 4 and 5, auto-close panels when the portal opens,
camera nudge to the portal (6.2, 6.3).

### 3.5 Skills before the first fight (optional, any time)

`21-skills-1280.png`, `22-nova-learned-1280.png`, `35-skills-spent-1280.png`.

* The starting character has Ember Lance on LMB and **1 unspent skill point** (the chip says "1 K"). The Skills window
  (K) is clear: four columns (Basic, Destruction, Mobility, Survival), "+" rank buttons, prerequisite lines, a skill bar
  at the bottom: "Drag skills to any slot, or click a skill then a slot. Right-click to clear." Learning a skill
  **auto-assigns it to the next free slot** (Nova to RMB, Rift Step to Q, Cinder Ward to E): excellent.
* Gaps: skills that cannot be afforded show a padlock exactly like skills locked behind other skills, so "0 skill
  points" looks like "locked until some level". There is no one-line summary of what each skill is *for* before the
  tooltip. **Rift Step is the dash/blink, but nothing says so**, and it is not in the Controls list. The player is not
  nudged to spend the point before the first fight.

### 3.6 Entering the map (5:00 to 6:00)

`24-map-arrival-t0-1280.png`, `24b-map-arrival-t3-1280.png`, `90-map-t0-1024.png`, `91-map-t9-1024.png`,
annotated `a3-map-entry.png`.

* A wave panel at the top ("Wave 1 of 6", a diamond track, "0 alive, 0 slain"), a map card top-right ("Cinder
  Crossing, Tier 1, Monster level 4, Quantity +30%, Rarity +15%, two mod lines, 7/8 portals left"), the deck at the
  bottom. The character stands in a ring. Monsters are off-screen and arrive from the edges.
* **Nothing says "hold the left mouse button to cast at the cursor"**, nothing says "WASD to move", nothing says what
  the blue globe is for. Ember Lance costs 0 Focus, so the Focus bar never moves and the player never learns what it
  is for until a skill with a cost is learned.
* **Measured idle survival** (character standing still at level 1, 80 life, T1 Cinder Crossing, 1024x600): life 80
  until 9 s; 71 at 12 s; 48 at 16 s; 6 at 18 s; dead at 20 s. With 35 to 40 monsters alive at 9 s.
  Two scripted *non-kiting* fighting attempts (cast at the nearest target, no movement) died at 10 to 20 s with 0 to 2
  kills. A kiting bot at level 3 clears waves 1 to 5 and then dies to the boss.
* This matches the roadmap ("early game is hard on purpose"), but it means *the first 20 seconds are the tutorial*, and
  today they contain no teaching.

Severity: **S1**. Fix: cheat-sheet, fight step, optional warm-up (6.2, 6.5, section 9 Q1).

### 3.7 Combat feedback, level-up and loot (6:00 to 11:00)

`w-level2.png`, `w-phase-tell-3.png`, `w-boss.png`.

What works: damage numbers, the 3 s wave "Tell" (names families and the debuffs they bring), a gold **level-up burst**
("Level up / Level 2 / New attribute points and a skill point are waiting" plus a toast), the XP bar, unspent-point
chips with the real hotkeys ("6 C", "2 K") and tooltips that name the key. Drop labels carry the item name in rarity
colour ("Ritual Circlet", "Elusive Ashen Robe of the Kiln").

Gaps:

* The level-up burst shows "Level 2" twice (pixel text and overlay). Minor.
* **Equipment must be clicked to pick up**; currency, flasks and maps are auto-collected. The only explanation is a
  toast the first time you *drop* something. A player who walks over an equipment label and sees nothing happen will
  assume it is broken.
* The first rare item does not announce itself beyond its colour. "Hold Alt for tiers" appears only in tooltips.
* **Flasks.** Three flasks (two Life, one Focus) with keys 1 to 3 visible as tiny numerals; nothing says "press 1 when
  your life is low". No hint ever appears at low life: in the boss death screenshot (`w-lowlife.png`) every Life flask was already at 0
  charges, and **at home after the run the belt shows 0 / 0 / 2**: flasks do not refill in the hideout
  (they refill from drops and Rook's Supplies), and nothing says so.
* The "Stalker" map event card ("Hunt 0/3, Whiffs 3/3, Next pounce 45 s, Every whiff raises the trophy", "On track:
  Gold") is jargon with no one-line goal.
* Monster nameplates for rare packs ("Frenzied Juggernaut Ironhide Brute", "Crackling Storm Loop of Haste") pile up
  at 130+ monsters and cover the screen at 1024x600.
* Wave tell says "Brings Withered, Burning" with icons: the debuffs are explained only if the player holds Alt over
  the icon later ("point at a debuff for its counter" is in Controls).
* Spending points: nothing prompts it. The character sheet itself is excellent (`30-character-1280.png`,
  `31-hover-int-1280.png`, `33-expanded-row-1280.png`: attributes explain what they grant; each stat row expands to
  its breakdown), but the player has to open it.

### 3.8 First death (any time from 5:00)

`25-first-fight-1280.png`, `26-after-death-hideout-1280.png`, `a4-death-summary.png`, `w-lowlife.png` (the same overlay at the boss).

* The death screen is calm and good: "You have fallen. Your experience and every item you picked up are safe. Coming
  back uses a portal (7 left). [Return to hideout]". No XP loss is a great message.
* After "Return", a **summary modal** says "Map lost. The portals are spent. Everything you picked up is still
  yours. 1:05, 0 kills, 0 XP, Found (0): Nothing worth carrying this time." while the card behind it reads "7/8
  portals, click the portal to enter". "Map lost" plus "The portals are spent" is wrong when portals remain.
* The next action (re-enter, or first spend points and learn from the death) is not suggested. A first death with
  0 kills is exactly when a coaching line ("Hold the mouse button to cast; keep moving") would land.

Severity S2 (S1 for players who quit here). Fix: first-death hint, summary copy (6.6, F-4).

### 3.9 Boss, chest, return (about 11:00 to 15:00)

`w-boss.png`, `w-phase-cleared-6.png`, `w-chest.png`, `100-summary-cleared-1280.png`. (Caveat from section 2: a level-3 and a level-9 bot died to the Cinder Matriarch;
this segment was captured with the test character raised to level 22, so it shows the *screens*, not a realistic
first-timer fight.)

* **Boss.** Wave 6 starts with a tell, then a wide red boss bar with phase notches ("The Cinder Matriarch, Phase I")
  and the usual wall of rare-pack nameplates. Nothing tells the player *this is the boss* beyond the bar, and nothing
  explains the notches (phases) or the telegraph circles.
* **Clear.** The wave card turns into "Map cleared / The return portal is open", toasts say "Cinder Crossing cleared!",
  "Atlas revealed: Ember Road, Bone Approach." and "Atlas point earned: a new encounter completed." A reward chest
  glows in the middle of the arena with a light column, and a handful of drops lie around it.
  * **No one says "open the chest".** It is unlabelled and the card talks only about the portal. A player who walks
    straight into the return portal leaves the chest.
  * The **return portal sits at the bottom-left, partly under the Life globe**, and the portal card at the top right now
    reads "0/8 portals left" in red, which looks like a failure on a victory screen (the portals were spent entering; the
    return portal is separate).
  * Equipment still has to be clicked to pick up (the clear does not auto-collect).
* **Summary** (`100-summary-cleared-1280.png`): "Map cleared. The Matriarch is ash. Your spoils are safe in your
  inventory." with Time 9:12, Kills 491, Experience 1,646, Levels, and a "Found (32)" list in rarity colours. It is
  rewarding and readable. It ends in a single "Continue": **no "what now?"** (spend points, equip, craft, next map), and
  the list is cut at the bottom edge without a scroll cue.
* **Back home** (`102-inventory-with-loot-1280.png`): a frost-diamond badge "3"
  (Atlas points) appears beside the "K" chip without a hotkey letter; the Atlas tab shows "Codex 3" and "Points 3"; the
  inventory marks new items with an orange "new" badge (good), but twelve pieces of gear, six maps and a Rime Talon now
  share a single unsorted grid with no sort or stack-all button, and the two glowing Atlas areas ("The Cinder Reach",
  "The Rimed Deep") are named in huge chart lettering with no instruction about what to do with them
  (`110-atlas-after-clear-1280.png`).

### 3.10 Equipping gear, the stash, the Crafting Bench, Rook (hideout, after the first run)

`61-stash-1280.png`, `62-bench-1280.png`, `a7-bench.png`, `60-wt2-rook-wares-1280.png`, `64-wt2-rook-supplies-1280.png`.

* **Equipping.** There is no prompt. A player who found a Ritual Circlet has to open the Inventory (I), find it among
  the currency icons, and drag it to the helmet slot of the paperdoll (the slot is a dark, unlabelled silhouette). The
  tooltip's comparison needs Alt. "Ctrl click moves" is in the inventory footer, which is the only place that teaches
  the quick-move. Level and attribute requirements are in the tooltip but not on the slot.
  Drag works well once started: the matching slot lights green while an item is held over it
  (`106-dragging-circlet-1280.png`), "new" badges mark fresh loot, and the starter wand's tooltip shows how affixes
  read (`104-hover-gear-alt-1280.png`: "Prefix, Blazing, **Tier 10**, Fire, 10% increased Fire Damage (8 to 12)").
  Tier 10 is the *lowest* band of ten, which the tooltip never says, and the same "T1" label means the *easiest* on a
  map (F-9). The 12-piece pile of loot after one map has no sort or stack-all.
* **Stash.** A chest tile opens "Stash: Shared by all characters on your account", tabs "Main", "Maps", search, and a
  hint line "Ctrl-click: to your inventory...". Clear enough once opened; its purpose is not obvious from the
  hideout (an unlabelled chest).
* **Crafting Bench (the anvil).** The panel opens with "The bench is empty / Drag a piece of gear or a map onto the
  socket", then **Recycle maps** (a second feature with its own slots), then "How the bench works" (four bullet
  paragraphs, clipped at the bottom of the panel at 1280x720) and a Currency row of eight icons with counts but no
  names. Crafting is *the heart of the game*, and its first screen is a text wall plus two features at once. The
  Stability concept is explained only in hover titles.
* **Rook.** (Working-tree Wares board.) Tabs Gear / Maps / Supplies / Gamble / Sell, tiles with no visible prices,
  "New wares in 2 h 54 m", "Ask for new wares (3 Scrap)". The luck-of-the-day idea is good; for a first visit it needs
  one line ("Rook's board is random and refreshes every 6 hours or when you level up. Sell spare gear to him.") and
  visible prices.
* **Atlas tree (Codex tab).** `80-codex-1280.png`: a ~300-node tree with the line "0 points to spend, 0 spent, 0 / 60
  earned" and a hint ("Click a node to inspect it. Double-click to allocate."). For a new account it is an
  intimidating empty tree; progressive disclosure would hold it back until the first Atlas point is earned.

### 3.11 Terms that are never explained in the flow

Resistances (the T1 map says "+10% to all Resistances"), Armour, Evasion, Stability, Focus, item tier vs map tier,
Areas, Surge, Scarabs, Passage, Pins, Re-chart, Quantity/Rarity. Several are well explained *if you open the right
panel and hover* (Character sheet, Skills tooltips, Stability titles), but there is no single place to look them up.
Glossary in 6.7.

---

<a id="4-existing"></a>
## 4. What onboarding exists today

Searched `src/` for hint, tutorial, help, tip, welcome, first-run, seen/dismissed flags and `localStorage` use.

| Where | What it says / does | Persistence |
|---|---|---|
| `src/ui/panels/Modals.tsx` `HelpModal` (Esc menu, "Controls") | Full controls reference: Combat (WASD, LMB RMB Q E R F, 1 to 4, T), Interface (I C K Esc Alt), Party and chat, Items and crafting; footer: "Click the map device, stash, anvil or Rook in a hideout to use them, and a portal to enter it. There is no pause online: your party keeps playing." | none |
| `src/ui/panels/Modals.tsx` `MenuModal` | Sound, screen shake, auto-attack, frame rate; Resume, Controls, Character select, Log out | settings in `localStorage` |
| `src/ui/atlas/Dock.tsx` line ~195 | "Drag a map from your inventory into the slot: it opens the area it is bound to." Also "N in your Map Stash: move it to your inventory..." | none |
| `src/ui/atlas/Rail.tsx` | "Your slotted map opens here." / "Browsing. Drag a map from your inventory into the dock..." | none |
| `src/ui/atlas/AreaModal.tsx` (working tree) | "Drag a map into the slot / You hold N maps for X: the highlighted ones in your inventory. Ctrl/Cmd-click loads one too." and a written reason next to a disabled "Open area" | none |
| `src/ui/panels/MapDevice.tsx` / `TopHud.tsx` portal card | "Click the portal to enter. Each entry uses one." "A new map closes it once nobody is inside." | none |
| `src/ui/hud/Feedback.tsx` | Death overlay copy; Level-up burst "New attribute points and a skill point are waiting" | none |
| `src/ui/lib/points.ts` + `CommandDeck.tsx` | Unspent-point chips ("6 attribute points to spend (C)"), pop effect on a new level | derived from the save |
| `src/ui/panels/Inventory.tsx` footer | "Ctrl click moves - right-click currency to craft" | none |
| `src/ui/panels/SkillTooltip.tsx` | "Click the rank button to spend a skill point." | none |
| `src/ui/panels/CraftingBench.tsx`, `WorkSlot.tsx` | "How the bench works" bullets; Stability titles; per-craft rules lines | none |
| `src/ui/panels/Party.tsx` | "You are playing alone. Invite up to three friends by character name..." plus "Loot is personal..." | none |
| `src/ui/codex/Codex.tsx` | "Click a node to inspect it. Double-click to allocate. Drag to pan, scroll to zoom." | none |
| `src/ui/panels/Atlas.tsx` | A skippable *discovery cinematic* for newly charted areas, once per viewer | `localStorage` lists (`SEEN_KEY`, `FRESH_KEY`) |
| `src/ui/atlas/activation.ts`, `motion.ts` | Remember the last activation signature and the chart motion preference | `localStorage` (per viewer) |
| server toast on first public drop | "Items dropped on the floor are public; they vanish after 10 minutes" | one-shot server toast |
| `src/ui/dev/mockStore.ts`, `dev/ui.html?hud=...` | Sandbox previews (not player-facing) | n/a |

**What does not exist:** an objective or step tracker, any world-space marker, any highlight of a thing to do next, any
first-run or "seen" flag in the **account or character save** (the only persistence is per-browser `localStorage`),
a "?" or Help button, a glossary, a controls overlay on map entry, event-driven hints (level-up, loot, low life, empty
Focus, first death, first rare, first craft), or a way to replay any of it. `CharacterSave` has no tutorial field; the
account-wide `AtlasProgress` has several optional fields (`pins?`, `surge?`, `redrawn?`, `tiersCleared?` ...) that show
exactly how optional state is added without a version bump (design in 6.9).

The `Panel` union already contains `'help'` and the `HelpModal` exists, so the Help work is an extension, not a new
surface.

---

<a id="5-flows"></a>
## 5. Committed flow vs the flow being built

Two agents are reworking the Atlas into an **area modal** and Rook's shop into a **Wares board**. The onboarding in
section 6 is designed for the *final* flow; this table says where the committed build differs, so the step logic can
tolerate both until the work lands.

| Aspect | Committed (`632f318`, tested) | Working tree (final target) | Consequence for onboarding |
|---|---|---|---|
| Opening the Atlas | Click the Map Device: Atlas (chart) on the left, Inventory on the right | Same | Step 1 identical |
| Where a map goes | A **dock strip** at the bottom of the Atlas: small "Drop map" slot, Scarab 1..4, Passage, Activate | Click an area: **area modal** with the map slot **centred**, scarab sockets around it, a **Passage** slot only for sealed areas, readout, and **Open area** with its reason written out | Add step 2 "Pick Cinder Crossing"; mark it done by evidence if the slot is filled without it |
| Marking the right map | None | Inventory maps that fit the area get a green outline; "You hold 3 maps for Cinder Crossing: the highlighted ones in your inventory" | Reuse this highlight for the animated hand |
| Primary button | "Activate" (disabled with no reason) | "Open area" with "Load a map for Cinder Crossing: drag one from your inventory into the map slot." | Step 4 copy says "Open the area" (works for both: map the verb in the strings file) |
| After the button | Atlas closes, portal opens, toast, Inventory stays | Modal is meant to close and the Atlas to stay with a status line "Cinder Crossing T1 - 8/8 portals left - Enter the portal". In the working-tree build I tested the modal *stayed on screen* in its empty state with "Replaces your Cinder Crossing portal (8 left)" about 1.8 s after the click (`58-wt2-opened-1280.png`) | Verify; the guide should close panels itself on step 5 either way |
| Stale copy | Map tooltip: "Activate the Map Device to open a portal." (`src/game/progression/maps.ts:772`) | Button is now "Open area" | F-3 |
| Rook | Gear / Maps / Supplies / Gamble / Sell tabs | **Wares board** (4 maps and 8 items, random, new every 6 hours and at each level-up, a staples shelf, "Ask for new wares" for Scrap), plus Gamble and Sell | Rook is *not* in the 11 steps; he appears in the "What next" card and gets a first-open hint (6.6) |
| Atlas extras shown at first open | Lens, Pins, Surge, Scarab, Passage all visible | Same, plus "Repeat last setup" etc. | Progressive disclosure in F-18 |

The step state machine in 6.2 is a pure function of observable state (which panel is open, whether the device slot is
filled, whether a portal exists, zone, run phase, ...), so it works unchanged for both flows; only `strings.ts` varies
by one verb ("Activate" vs "Open area").

---

<a id="6-design"></a>
## 6. Design: the first-run experience

<a id="61-principles"></a>
### 6.1 Principles and the 10-minute path

1. **Show the next thing, not all things.** One current step, highlighted *in the world or UI where the action
   happens*; everything else is quiet.
2. **A verb on every line.** "Click", "Drag", "Open", "Step", "Fight", "Defeat", "Spend", "Equip".
3. **Never block, never gate.** The tracker and hints only point. A player who ignores them or finds another way is never
   stopped; steps complete **by evidence** ("a portal exists"), not by obedience.
4. **Teach by doing the real thing.** The tutorial is the real first map; no scripted fake level.
5. **Quiet by default, loud when stuck.** Marker pulse and the drag hand appear immediately for step 1 and step 3, but for
   later steps only after N seconds of inactivity (below), so competent players barely see anything.
6. **Respect the type scale.** Tracker title 19 px (body), lines 16 px (secondary), keycaps and kickers 14 px
   (caption), Help title 28 px (title). No new `font-size` values (AGENTS.md; `tests/ui/typography.test.ts` already
   enforces it).
7. **Always skippable, always replayable, never nagging.**

Target timeline (login to "I killed my first boss and know what to do next"):

| Segment | Today (observed) | Target |
|---|---|---|
| Register + create character | ~1 min | ~1 min |
| Hideout to first portal click (steps 1 to 5) | 2+ min (outside player), several wrong clicks | **<= 90 s**, no wrong clicks |
| Fight to the boss (waves 1 to 6) | ~5 min of clock at wave 6 start (bot) | unchanged; the tracker only keeps the player oriented |
| Boss + chest + return | 1 to 5 min | unchanged |
| "What now?" (points, gear, next map) | not taught | ~2 min, guided |
| **Total** | **unknown** | **~10 to 12 min** if the first map is cleared; deaths add ~2 min each, all of them keep the tracker on the fight step |

<a id="62-tracker"></a>
### 6.2 The objective tracker

A compact card, **top-left**, under any party portraits. It shows the *current chapter* (3 to 5 lines max), ticks done
steps (they fade after 3 s and fold away), and highlights the current one with its one-line body.

```
 FIRST EXPEDITION                          2 / 5
 [x] Click the Map Device
 [>] Pick Cinder Crossing                   <- current, ember accent
     Click the pulsing area on the chart.
 [ ] Drag a map into the slot
 [ ] Open the area
 [ ] Step into the portal
                       Hide        ?  Help
```

* **Placement.** Top-left in both zones is free (zone title and portal card are top-right; the wave panel is top
  centre). It follows the existing `--free-l` variable (`GameScreen` publishes docked panels to CSS): when a left panel
  covers it, or free width is under about 260 px (1024x600 with Atlas plus Inventory), the tracker **collapses to a
  one-line pill** with the current verb, and the *open panel* shows the same line as a coach strip under its title
  (e.g. in the Atlas header: "Step 3: drag a map into the slot"). At 1280x720 with the Atlas open the free area is
  empty, so the pill is hidden and only the strip shows.
* **Size.** 280 px wide at both test sizes; <= 5 lines; chapter title in caption (14 px, letter-spaced), current step in
  body (19 px), supporting lines in secondary (16 px).
* **Controls on the card.** "Hide" (collapses to a pill; stays hidden until the next step), "?" (opens Help), and in
  Help: "Skip the tutorial" and "Replay". A one-click **Skip** is also on the card's overflow in the first 2 minutes so
  veterans who slip through the auto-detection are never trapped.
* **Never in the way.** `pointer-events: none` on the body, only the two small buttons are interactive. It is hidden
  during modals, the death overlay and the run summary.

#### Chapters and steps

Steps are *derived*, not stored as a cursor (6.9): `deriveStep(state)` returns the first step in order whose
completion predicate is false, except that evidence of a later step completes earlier ones.

| # | Id | Chapter | Tracker line | Body (<= 90 chars) | Completes when (evidence) | Marker / emphasis |
|---|---|---|---|---|---|---|
| 1 | `device` | First expedition | **Click the Map Device** | The glowing stone table. It opens the Atlas. | Atlas (`mapDevice` panel) opened | Pulsing ring + bouncing chevron on the device; camera framing includes it; edge arrow if off-screen |
| 2 | `area` | | **Pick Cinder Crossing** | Click the pulsing area on the chart. | Area modal open, *or* device slot filled | Node halo pulse; coach strip in the Atlas header |
| 3 | `map` | | **Drag a map into the slot** | Take one of your three maps from the inventory and drop it in the middle. | `character.mapDevice != null` | Hand animation (6.4); starter maps outlined; slot pulses |
| 4 | `open` | | **Open the area** | Press the button: it spends the map and opens 8 portals. | `hud.portal` exists (or a portal prop) | Button pulse; reason line stays visible |
| 5 | `enter` | | **Step into the portal** | Click the swirling portal. Each entry uses one of 8. | `zone === 'map'` | Auto-close Atlas and Inventory once; ring + chevron on the portal; pan camera to it |
| 6 | `fight` | Win the map | **Fight!** | Hold the left mouse button to cast at your cursor. Move with WASD. | 10 kills in this run (or wave 2 reached) | Cheat-sheet (6.5) |
| 7 | `boss` | | **Defeat the {boss}** | She arrives in wave 6. Wave {w} of {n}. | `run.phase === 'cleared'` (boss dead) | Boss name from `run.map` / `boss`; live "Wave w of n" |
| 8 | `chest` | | **Open the chest** | Walk up to the glowing chest and click it. Loot is yours alone. | A chest opened event / `chest.state != 0` | Ring + chevron on the chest; edge arrow if off-screen |
| 9 | `home` | | **Return home** | Click the return portal. Everything you picked up comes with you. | `zone === 'hideout'` after a cleared run | Marker on the return portal |
| 10 | `points` | Grow stronger | **Spend your points** | Click the glowing badges: C for attributes, K for skills. | Unspent attribute and skill points are 0 (or >= 1 spent) | Existing badges get a stronger pulse; opens nothing by itself |
| 11 | `equip` | | **Equip your loot** | Press I and drag gear onto its slot. Hold Alt to compare. | Any item equipped since step 9, *or* no unequipped gear in the backpack | Outline equipment slots that accept a held item; "I" keycap pulse |
| - | `next` | (closing card) | **What next?** | See 6.2.1 | Dismissed | Card |

* If the player **dies**, the tracker stays on `fight` and the body becomes "You fell. Nothing is lost. Click the portal
  to try again ({n} left)." The marker moves to the portal *only when they are back in the hideout*.
* If the player is **on someone else's hideout or map**, see 6.10 (parties).
* The step logic is idempotent and tolerant: a player who ctrl-clicks the map straight into the slot skips steps 2 and
  3 visually; a player who drags before opening the Atlas is not interrupted.
* **Escalation when stuck.** Steps 1 and 3 get their marker/hand immediately (they are the two documented stalls). For
  every other step the world marker only starts pulsing after 20 s on that step, and the tracker body text after 8 s.
  Competent players see only a quiet checklist.

##### 6.2.1 The closing "What next" card

Shown once after step 11 (or when the player returns home and dismisses the summary). Four short rows, each a button
that **opens the right thing**:

* **Craft at the anvil.** Right-click Scrap, click a piece of gear. Every craft costs Stability.  [Show the anvil]
* **Visit Rook.** His wares are random and change every 6 hours. Sell spare gear to him.  [Show Rook]
* **Spend an Atlas point.** Clearing new areas, tiers and bosses earns points in the Codex.  [Open the Atlas]
* **Open your next map.** Two Tier 1 maps are left. Higher tiers drop better gear.  [Open the Atlas]

Pressing a row sets the marker on the object (anvil, Rook, device) and closes the card; it never opens a panel
the player did not ask for.

<a id="63-world"></a>
### 6.3 World-space guidance

* **Marker.** A soft ring on the floor (the target's footprint) plus a chevron bouncing 8 px above it, in the ember
  accent, drawn by the renderer in `src/present` so it lights and occludes like the world (a new
  `guide-marker.ts`, one instance, fed by `guide.target` = `{ kind, id | x,y }`). Hideout targets: Map Device, portal;
  map targets: boss (the existing boss bar already guides), chest, return portal.
* **Off-screen arrow.** When the target is outside the viewport (it is *right now* for the Map Device on arrival), a
  DOM arrow clamped to the viewport edge points to it with the target name ("Map Device"). Position from
  `__foe`-style `worldToScreen`, updated at the HUD's 15 Hz rate.
* **Opening framing.** On the first arrival the camera eases for 1.2 s from the character to the Map Device and back
  (skippable by any input; replaced by a cut when reduced motion is on). Cheaper alternative: bias the new-character
  spawn point or the hideout camera offset 80 px upward so the table is always in frame.
* **Name plates on unused interactives** (new accounts only): small caption-size plates over Map Device, Stash, Crafting
  Bench, Rook ("Map Device", "Stash", "Crafting Bench", "Rook: merchant"). Each plate fades the first time that object
  is used (`guide.used` in 6.9). This single change removes most wrong first clicks.
* **Portal.** After step 4 the portal gets the same marker; if the player has Atlas or Inventory open, the guide closes
  them once and eases the camera to the portal so it is not hidden behind a panel.
* **Escalation and quietness.** Markers pulse for 4 s, rest at 40% opacity, and pulse again after 20 s of inactivity on
  that step. With the motion setting on `calm` / `prefers-reduced-motion`, the ring is static and the chevron does not
  bounce.

<a id="64-hand"></a>
### 6.4 The starter-map "drag me" hand

* While step 3 is current and the Atlas or area modal is open, the **three starter maps** in the inventory get a gold
  outline (the same outline the area modal already draws for "maps that fit", extended to the dock flow) and a small
  caption badge "Drag".
* A pointer **hand sprite** (caption-size label "Drag me") loops every 2.4 s: rest on the first starter map, press
  (scale 0.9), glide along a curved path to the map slot, release (slot flashes green), fade, repeat. It stops on
  `pointerdown` on any item and never restarts that session unless the player idles 10 s with nothing dragged.
* The **slot** pulses while the hand plays. When a dragged map is over the slot the existing green "fits" state
  appears (already working in the committed build).
* **Reduced motion:** a static dashed arrow from the map to the slot with the label "Drag" and the slot outlined; no
  looping hand.
* **Keyboard and assistive alternative (must exist, and does not today):** focus a map in the inventory, press Enter or
  Space ("Load into the Map Device"); and a visible "Load" button in the area modal's instruction card. Ctrl/Cmd-click
  stays. Double-click on a highlighted map should also load it (cheap, discoverable; mirrors Path of Exile habits).

<a id="65-cheatsheet"></a>
### 6.5 Controls cheat-sheet on first map entry

On the first two map entries (and again if the player has fewer than 3 kills at 30 s), a translucent strip appears
**centre-low**, about 120 px above the command deck so it does not cover the character, with six chips. Each chip dims
the first time it is used; the strip fades 3 s after the core two are done (move and cast) or after 40 s, and is
always one keypress away through Help.

```
 [Mouse] Aim     [Hold LMB] Cast at your cursor     [W A S D] Move
 [RMB] [Q] [E] More skills (learn them in K)     [1] [2] [3] Flasks     [?] Help
```

* Chips: Aim (move the mouse), Cast (LMB), Move (WASD), More skills (RMB Q E R F), Flasks (1 to 4), Help.
* The text on each chip is 16 px; keycaps are 14 px; the strip is `role="note"` and not announced repeatedly.
* It is **not shown in the hideout** and not after the player has used each of Cast, Move and a flask in a map.
* **Warm-up recommendation (open question Q1):** for a character's very first map entry, start wave 1 after the first
  cast or 12 s, whichever comes first, or push the first spawn ring out by ~40%. Idle death at 20 s means a player who
  is *reading the cheat-sheet* can lose the run.

<a id="66-hints"></a>
### 6.6 Contextual first-time hints

Small **coach cards** appear above the deck (centre-low), one at a time, 9 s auto-dismiss that pauses on hover and
keyboard focus, with "Got it" and a quiet "Don't show tips". Rules:

* Each hint has a stable id, fires **at most once per account**, and is stored in `guide.hints`.
* One card at a time; queue by priority; at least 25 s between cards; never while a modal, death overlay or run summary
  is open; never in the first 4 s after the portal entry (the wave tell is playing); a card that points at a UI control
  (flask, badge, panel) pulses that control.
* A `Settings.hints` toggle ("Show tips") in the Esc menu turns all coach cards off for this browser.
* Veterans (6.10) start with every hint marked seen.

| Id | Trigger (first time only) | Card text (<= 90 chars) | Points at |
|---|---|---|---|
| `firstEntry` | Enter any map | (the cheat-sheet; not a card) | - |
| `lowLife` | Life < 40% and a Life flask has charges | "Low on Life. Press 1 or 2 to drink a Life flask." | Flask slots |
| `flasksEmpty` | A belt flask hits 0 charges, or home with 0-charge Life flasks | "Flask empty. Kills drop more; Rook sells them under Supplies." | Flask slot / Rook |
| `focusEmpty` | A skill fails for lack of Focus | "Out of Focus. Spells spend the blue globe; it refills over time." | Focus globe |
| `levelUp` | First level-up (after the burst) | "Level up! Spend points any time: C for attributes, K for skills." | Badges |
| `firstLoot` | First equipment drop lands | "Gear lies on the ground. Click its name to pick it up. Currency is automatic." | The drop label |
| `firstRare` | First yellow (rare) or orange (unique) drop | "A rare! Press I, then hold Alt over it to see its tiers and compare." | Inventory key |
| `firstDeath` | First death | "You fell. Nothing is lost. Keep moving, hold the mouse button, and try again." | Return button |
| `secondDeath` | Second death in the same area | "Tough map? Spend your points and equip upgrades first, then try again." | Badges |
| `firstDebuff` | First debuff icon | "You are {debuff}. Hold Alt over the icon to see how to cure it." | The icon |
| `firstEvent` | First map event card | "An encounter started. Its card shows the goal; better grades pay more." | Event card |
| `firstBossPhase` | Boss crosses a phase tick | "The boss changes tactics at each notch on its bar. Watch the ground for red circles." | Boss bar |
| `firstBench` | First open of the Crafting Bench | "Drag gear on the anvil. Each craft costs Stability; at 0 the item is Finished, never destroyed." | Bench socket |
| `firstMerchant` | First open of Rook | "Rook's board is random and refreshes every 6 hours and when you level up. Sell spare gear here." | Reroll button |
| `firstAtlasPoint` | First Atlas point earned | "An Atlas point! Open the Map Device, then the Codex tab, to spend it." | Device |
| `firstStash` | First stash open | "The stash is shared by all your characters. Ctrl-click moves items fast." | Search box |

Cards never repeat text already visible (for example the death overlay). The wording for existing surfaces (death
overlay, run summary) is also fixed in F-4.

<a id="67-help"></a>
### 6.7 Help ("?"), glossary, replay and skip

* **Entry points.** A persistent round **"?"** button (32 px target, 44 px hit area) at the **bottom-right above the
  latency readout**, key **H** (and F1, and Shift+/), and a new **Help** button at the top of the Esc menu above
  Controls. The existing `HelpModal` and the `'help'` panel id become this window.
* **Tabs** (keyboard: arrows; each tab `role="tab"`):
  1. **Controls** (the existing reference, fixed so it never clips: F-6) with two additions: *Rift Step is your dash, learn
     it in K and it takes the next free slot*, and *H opens this window*.
  2. **How a run works** (six lines): "Open a map in the Atlas -> step through the portal -> fight six waves -> defeat the
     boss -> open the chest -> come home. Dying costs a portal, not your gear or XP."
  3. **Glossary** (searchable; <= 16 entries, below).
  4. **Tutorial**: progress list with ticks, **Replay tutorial**, **Hide tracker**, **Skip tutorial**.
* **Replay** clears `guide.done`/`guide.hints` for this account and sets `mode: 'active'`; **Skip** sets `mode:
  'skipped', skippedBy: 'player'`. Both are single clicks with an undo toast ("Tutorial hidden. Replay it from Help").
* Title: 28 px; entries: term in body weight 19 px, definition 16 px, <= 2 lines each.

**Glossary (draft copy):**

| Term | Definition |
|---|---|
| Life | Your health (red globe). At 0 you fall. Life flasks (1, 2) restore it over 3 seconds. |
| Focus | Mana for spells (blue globe). Ember Lance is free; stronger skills spend Focus, which refills over time. |
| Resistance | Cuts fire, cold, lightning or void damage by that percent (cap 75%). Negative resistance means you take extra. |
| Armour | Cuts physical hits. It helps most against small hits. |
| Evasion | Chance to avoid a hit entirely (cap 75%). |
| Stability | How many crafts an item can still take. At 0 it is Finished (never destroyed). |
| Affix | A bonus on an item (prefix or suffix). Affix tier: **lower is better**, T1 is the best roll band. |
| Map tier | How hard a map is (T1 to T15). **Higher is harder** and pays more. Not the same as affix tier. |
| Area | A place on the Atlas with its own monsters and boss. A map item opens exactly one area. |
| Atlas | Your chart of areas, opened at the Map Device. The Codex tab is the passive tree for maps. |
| Surge | Daily charges per area (refreshed 04:00 UTC). A charged run gets +30% item quantity and +15% rarity. |
| Scarab | A consumable you socket beside a map to change the run (more loot, more danger). One of each kind. |
| Pin | Pin an area and its maps drop three times as often. |
| Portal | A map opens 8 portals. Each entry, including re-entry after a fall, uses one. |
| Quantity / Rarity | How many items drop / how likely they are to be better. They never change each other. |
| Scrap | Basic crafting and shop currency. Rook pays in it and charges it. |

<a id="68-copy"></a>
### 6.8 Copy deck and the strings file

**All guide text lives in one data file**, `src/ui/guide/strings.ts`, typed so a missing key is a compile error:

```ts
// src/ui/guide/strings.ts (design sketch)
export const GUIDE_EN = {
  tracker: { chapter: { enter: 'First expedition', win: 'Win the map', grow: 'Grow stronger' }, hide: 'Hide', help: 'Help', skip: 'Skip tutorial', progress: '{done} / {total}' },
  steps: {
    device: { title: 'Click the Map Device',      body: 'The glowing stone table. It opens the Atlas.' },
    area:   { title: 'Pick {area}',               body: 'Click the pulsing area on the chart.' },
    map:    { title: 'Drag a map into the slot',  body: 'Take one of your maps from the inventory and drop it in the middle.' },
    open:   { title: 'Open the area',             body: 'It spends the map and opens {portals} portals.' },
    enter:  { title: 'Step into the portal',      body: 'Click the swirling portal. Each entry uses one of {portals}.' },
    fight:  { title: 'Fight!',                    body: 'Hold the left mouse button to cast at your cursor. Move with WASD.' },
    boss:   { title: 'Defeat {boss}',             body: 'Wave {wave} of {waves}. She arrives on the last one.' },
    chest:  { title: 'Open the chest',            body: 'Walk up to the glowing chest and click it. Loot is yours alone.' },
    home:   { title: 'Return home',               body: 'Click the return portal. Everything you picked up comes with you.' },
    points: { title: 'Spend your points',         body: 'Click the glowing badges: C for attributes, K for skills.' },
    equip:  { title: 'Equip your loot',           body: 'Press I and drag gear onto its slot. Hold Alt to compare.' },
  },
  stuck: { fightDied: 'You fell. Nothing is lost. Click the portal to try again ({portals} left).' },
  hints: { lowLife: '...', /* one key per row of 6.6 */ },
  cheatsheet: { aim: 'Aim', cast: 'Cast at your cursor', move: 'Move', skills: 'More skills (learn them in K)', flasks: 'Flasks', help: 'Help' },
  help: { title: 'Help', tabs: { controls: 'Controls', run: 'How a run works', glossary: 'Glossary', tutorial: 'Tutorial' }, /* ... */ },
  glossary: { life: { term: 'Life', def: '...' }, /* ... */ },
  names: { mapDevice: 'Map Device', stash: 'Stash', anvil: 'Crafting Bench', merchant: 'Rook: merchant', portal: 'Portal' },
} as const;
export type GuideStrings = typeof GUIDE_EN;
export function gt(path: string, params?: Record<string, string | number>): string;   // {name} interpolation, no concatenation
```

* **Localisation-friendly:** whole sentences with `{param}` slots (no string concatenation, no plural-by-appending), one
  locale object per language implementing `GuideStrings`; plural forms via a tiny `{n, one|other}` helper only where
  needed ("portal(s)"). Keys are stable ids shared with the tests and with the e2e.
* **Voice:** friendly, concrete, second person, present tense, <= 90 characters per body, no jargon without a glossary
  entry, no exclamation marks except the level-up and "Fight!".
* **Terminology (decide once):** *Map Device* = the object in the hideout; *Atlas* = the window it opens; *map* = the
  consumable item; *area* = the place a map opens; "Cartography Table" and "Ember Chart" are retired from player text
  (F-2).
* A **copy lint test** asserts every body is <= 90 chars, every `{param}` is supplied, every key exists in each locale and
  is referenced by code (6/7).

<a id="69-state"></a>
### 6.9 Persistent state: schema, protocol, migration

**Where.** Per **account**, because the player is the learner (a second character should not repeat the tutorial). The
account already has one durable shared blob (`account_storage`, which holds the stash, the Crafting Stash, the work slot
and `atlas`) projected into `CharacterSave` (`atlas?`, `craftSlot?` precedent). Add `guide?` beside `atlas`.

```ts
// src/contracts/guide.ts (design sketch)
export const GUIDE_STEP_IDS = ['device','area','map','open','enter','fight','boss','chest','home','points','equip','next'] as const;
export type GuideStepId = (typeof GUIDE_STEP_IDS)[number];
export const GUIDE_HINT_IDS = ['lowLife','flasksEmpty','focusEmpty','levelUp','firstLoot','firstRare','firstDeath','secondDeath',
  'firstDebuff','firstEvent','firstBossPhase','firstBench','firstMerchant','firstAtlasPoint','firstStash'] as const;
export type GuideHintId = (typeof GUIDE_HINT_IDS)[number];
export type GuideProp = 'mapDevice' | 'stash' | 'anvil' | 'merchant';

export interface GuideState {
  /** Schema of this blob (not the save version). */
  v: 1;
  /** active: show tracker and hints; skipped: the player or the veteran rule said no; done: finished. */
  mode: 'active' | 'skipped' | 'done';
  skippedBy?: 'player' | 'veteran';
  /** Steps ever completed. Monotonic; order irrelevant; the current step is derived (6.2). */
  done: GuideStepId[];
  /** Hints already shown. */
  hints: GuideHintId[];
  /** Interactive hideout objects the player has used (name plates fade). */
  used?: GuideProp[];
  /** Completion time (ms since epoch) per step: the funnel (see Telemetry). Capped at 12 entries. */
  t?: Partial<Record<GuideStepId, number>>;
  startedAt?: number;
  finishedAt?: number;
  replays?: number;
}
```

(`CharacterSave.guide?: GuideState`, account-wide like `atlas`; one account row, a few hundred bytes.)

* **Safe defaults.** Missing = "not decided yet". `normalizeGuide(raw, ctx)` (in `src/game/progression`, next to the
  other normalisers) drops unknown ids, de-duplicates, caps lengths, coerces bad shapes to `undefined`, and never
  throws, exactly like `normalizeAtlas`. **No `SAVE_VERSION` bump and no storage-version bump**: the field is optional
  and absent reads as "decide at load" (the same rule as `mapScarabs?`, `craftSlot?`, `pins?`).
* **Commands.** One new client command `{ c: 'guide'; op: 'done' | 'hint' | 'used' | 'skip' | 'replay' | 'finish'; id?: string }`
  in `src/net/messages.ts` / `src/server/commands.ts`: server validates the id against the whitelists above, is idempotent,
  rate-limited with the existing per-socket limiter, writes the blob in the same transaction path as other account
  storage updates and replies with the new `GuideState` (or includes it in the next character snapshot). A **protocol
  version bump** is needed for the new command (the protocol is currently 23 / 24); stale clients are already handled by
  the reload guard. The client never trusts nor needs server-side "step" logic: the cosmetic tracker is derived locally and
  only the monotonic `done`/`hints` facts are persisted. A hostile client can only mark its own tutorial as done.
* **Migration for existing accounts** (`decideGuide` at login, persisted once): a stored account with no `guide` is a
  **veteran** if *any* of: a character at level >= 5, `atlas.clears > 0`, any character `stats.mapsCompleted > 0`, or
  `atlas.completed.length > 0`. Veterans get `{ v:1, mode:'skipped', skippedBy:'veteran', done:[], hints:[ALL] }`
  so no card ever appears. Everyone else (a brand-new account, or an old account that never got anywhere) gets
  `{ v:1, mode:'active', done:[], hints:[] }`. New accounts are created `active`. The decision runs on the server in the
  same place that builds the character list (`src/server/game.ts`), so all of an account's characters agree.
* **Veteran opt-out at character creation** (the user's specific ask): creating a character on an account that is
  already `skipped:veteran` or `done` never shows the tutorial; creating one on an `active` account with another
  character past level 5 or a completed map flips the account to `skipped:veteran` at creation time. A discreet link
  under the name field ("I have played before: skip the tutorial") sets `skippedBy:'player'` for those who want it
  up front.
* **Telemetry (no third party):** `t` records when each step completed; the admin CLI's `foe show <account>` should print
  `guide.mode`, the last step and the time between steps, so the funnel (where do new players stall?) can be read from
  production without new infrastructure. The existing server log gets one line per `skip`/`finish`.

<a id="610-cross"></a>
### 6.10 Veterans, parties, accessibility

**Veterans.** Covered in 6.9. Additionally the Esc menu has "Show tips" (per browser) and Help has "Skip tutorial" and
"Replay tutorial". A veteran account never sees a coach card; they still get the Help button.

**Parties.**

* The guide is **local to each player** and never shown to others. It never blocks party actions (invites, trades, chat).
* It only drives the **own** hideout and **own** map for steps 1 to 5. In **someone else's hideout** the tracker shows a
  single line while a portal is open: "Click the portal to join {name}'s map" (step `enter` by evidence), else hides.
* Joining a map via a friend's portal before finishing steps 1 to 4 **completes them by evidence** (`enter` satisfied);
  steps 1 to 4 then show as done and the tracker starts at `fight`. A newcomer in a veteran's map still gets the
  cheat-sheet and low-life hints (they are per-viewer and non-blocking).
* `boss` and `chest` use the run state of the party's instance; the chest line says "Loot is yours alone" (loot is
  personal), and `home` marks done when the zone becomes a hideout after a cleared run, whoever opened the return portal.
* If the leader closes the map or the party dissolves mid-tutorial, the guide simply re-derives: back in the hideout the
  next undone step is shown.
* Experience is shared in parties, so "10 kills" for `fight` counts the player's *own* kills when available, else the
  run's kill counter after 30 s, so a carried newcomer is not stuck on step 6.
* Voice/chat: nothing is posted to party chat by the guide.

**Accessibility.**

* **Keyboard-complete.** Every step has a non-pointer path: Tab to the tracker's buttons; H/F1 for Help; step 3 has a
  Load action reachable by keyboard (6.4); the Map Device and portal remain click targets in a canvas, so Enter on a
  focused tracker row offers "Walk to it" (sends the same click-to-walk the world click uses).
* **Screen readers.** The tracker is a `role="region" aria-label="Objective"` with an `aria-live="polite"` line that
  announces *only* step changes ("Step 3 of 5: Drag a map into the slot") and never progress ticks; world markers and the
  hand are `aria-hidden` and have a text equivalent in the tracker ("Map Device, ahead and above"). Coach cards are
  `role="status"` (polite) with a labelled dismiss button; the cheat-sheet is a static `role="note"`.
* **Reduced motion.** Honour `prefers-reduced-motion` *and* the existing motion setting (`useMotion().calm`): no
  pulsing, bouncing or looping hand; static ring, static dashed arrow, instant tracker updates, camera cut instead of
  pan. Pulses that remain are single 0.5 s fades, like `fe-sigil-calm`.
* **Contrast and size.** Tracker and cards use the existing solid panel surface; text is on a >= 4.5:1 background; no
  information by colour alone (a ring plus chevron plus text); touch/click targets >= 32 px (hit area 44 px); all
  sizes from the 14/16/19/28 token scale.
* **Language.** Plain, <= 90 characters, strings in one file (6.8) ready for translation.

<a id="611-code"></a>
### 6.11 Where it plugs into the code

Nothing below is implemented; this is a map for whoever builds it.

| Piece | Likely files |
|---|---|
| Contracts (ids, `GuideState`, command) | new `src/contracts/guide.ts`; `src/contracts/items.ts` (`CharacterSave.guide?`), `src/contracts/net.ts`, `src/net/messages.ts` (+ protocol bump), `src/contracts/ui.ts` (`UiState.guide`, `UiActions.guide...`) |
| Normaliser, migration, veteran rule | new `src/game/progression/guide.ts`; `src/game/progression/save.ts` (call `normalizeGuide`), `src/server/game.ts` / `src/server/db.ts` (account storage projection) |
| Commands and persistence | `src/server/commands.ts`, `src/client/commands.ts`, `src/client/session.ts` |
| Step state machine and hint triggers (pure) | new `src/ui/guide/steps.ts`, `src/ui/guide/hints.ts` |
| Strings | new `src/ui/guide/strings.ts` |
| Tracker, coach card, cheat-sheet, hand, edge arrow, Help tabs | new `src/ui/guide/*.tsx`, `src/ui/styles/guide.css` (tokens only), `src/ui/screens/Game.tsx` (mount), `src/ui/panels/Modals.tsx` (`HelpModal`), `src/ui/lib/keys.ts` (H / F1) |
| World marker, name plates, opening camera | `src/present/props.ts`, new `src/present/guide-marker.ts`, camera in the client loop |
| Map highlight / hand targets | `src/ui/atlas/AreaModal.tsx`, `src/ui/atlas/Dock.tsx` (committed), `src/ui/items/dnd.ts`, `src/ui/items/ItemView.tsx` |
| Esc-menu "Show tips", `Settings.hints` | `src/contracts/items.ts` (`Settings`), `src/client/settings.ts`, `Modals.tsx` |
| Admin visibility | `src/server/admin.ts` / the `foe show` command |

---

<a id="7-tests"></a>
## 7. Test plan

**Unit (vitest, `tests/ui/guide-*.test.ts`, `tests/game-progression/guide.test.ts`, `tests/server/guide.test.ts`)**

1. **Step state machine** (`deriveStep`): a table test over crafted `{ panels, zone, mapDevice, portal, run, chest,
   points, equipment, guide }` fixtures: fresh -> `device`; Atlas open -> `area`; area modal open -> `map`; slot filled ->
   `open`; portal exists -> `enter`; in map, kills < 10 -> `fight`; kills >= 10 -> `boss`; cleared + chest closed ->
   `chest`; chest open -> `home`; hideout with unspent points -> `points`; points spent, unequipped gear -> `equip`;
   all done -> `null`. Evidence shortcuts (slot filled skips `area`; being in a map skips 1 to 5). Monotonicity (a step
   done never un-completes; the displayed step never moves backwards even if the player takes a map out). Death keeps
   `fight`. Party cases (someone else's hideout, joined map).
2. **Hint triggers** (`hints.ts`, pure over a snapshot and the persisted `hints`): each trigger fires once; respects the
   25 s gap, the modal/death suppression and the 4 s post-entry quiet window; veterans see none; `Show tips` off sees none.
3. **Cheat-sheet** chip logic: chips dim on use, strip ends after the core two or 40 s; not in the hideout.
4. **State (`normalizeGuide`)**: garbage in, safe defaults out (unknown ids dropped, duplicates removed, lengths capped,
   wrong types ignored); old accounts without `guide` load unchanged (no version bump, `atlas` round-trips); migration
   rule table (level 5, `atlas.clears`, `mapsCompleted`, `atlas.completed`, brand-new) -> expected mode and `skippedBy`.
5. **Server commands** (`tests/server/guide.test.ts`, using `tests/server/helpers.ts`): `done`/`hint`/`used`/`skip`/
   `replay`/`finish` validate ids, are idempotent and rate-limited, persist across a restart, are shared by all of an
   account's characters; invalid ids are refused; `messages.test.ts` round-trips the new command.
6. **Strings**: key parity between locales, `{param}` coverage, <= 90 chars per body, no unused keys; existing
   `tests/ui/typography.test.ts` extended to the new stylesheet (only the four tokens).
7. **Layout**: a pure `trackerRect(viewport, panels)` test for both viewports (1280x720, 1024x600) with every panel
   combination: no overlap with the deck, the wave panel, the zone card or open panels; collapses to a pill under 260 px.

**End-to-end** (`scripts/e2e.mjs --only onboarding`, run at **both** `--size 1280x720` and `--size 1024x600`)

1. A **fresh account and character** are created through the real UI. Assertions use the *tracker's text* and the
   marker's screen position (exposed via `window.__foe.guide` in debug builds), then the script performs real input:
   * step 1: the marker/arrow is within the viewport (it must not be cropped), the script clicks the **marker position**;
     the tracker moves to step 2;
   * step 2: click the highlighted area node; step 3: the starter maps carry the highlight; the script **drags** one
     to the slot (and a second run uses Ctrl-click and a third the keyboard Load path); step 4: click Open area; step 5:
     the Atlas and Inventory are closed by the guide and the script clicks the portal;
   * a time budget: steps 1 to 5 in **under 90 s** of script time with **zero wrong clicks** (no unrelated panel opened);
   * the cheat-sheet appears on entry, a chip dims after a real cast and after WASD, the strip fades;
   * the bot fights; steps 6 and 7 progress; a forced level-up shows the `levelUp` card exactly once; a scripted low
     life shows `lowLife` once; a scripted death shows `firstDeath` once and the tracker stays on `fight` and the summary
     copy is correct;
   * the boss dies (balance-bot character), the chest marker appears, `chest`, `home`, `points`, `equip` complete, the
     "What next" card appears and its buttons place the marker;
   * persistence: reload the page and reconnect mid-tutorial -> same step, no card repeats; a **second character** on the
     account shows no tracker; **Replay** from Help restarts it; **Skip** hides it for good.
2. **Veteran opt-out**: an account with a completed map or a level-5 character never shows the tracker, a new character on
   it neither; an old-format account (no `guide`) is migrated once and kept.
3. **Party**: two players, the newcomer joins the leader's open map before finishing the tutorial -> steps 1 to 5 are
   marked done by evidence, the tracker starts at `fight`; the leader sees nothing from the newcomer's guide.
4. **Accessibility**: with `page.emulateMedia({ reducedMotion: 'reduce' })` no `guide-*` animation runs
   (`document.getAnimations()` filtered by class is empty); the aria-live region receives exactly one announcement per step;
   a keyboard-only run completes steps 3 and 4 (Load button, Enter).
5. **Layout at both sizes**: tracker, pill, cheat-sheet and coach card never overlap the command deck, the wave panel, the zone
   card, an open panel or the Controls window; the Help window never clips (all rows reachable by scrolling; a visible
   scrollbar).
6. **Screenshots** of each step at both sizes are written to `.shots/` for review (and these are the images to re-take
   for this document after the build).

**Usability validation (the real test).** After shipping, run 5 unguided first-time players (no prior knowledge of the
game), record screen and think-aloud, and measure: time to first portal click (target <= 90 s; baseline >= 120 s), wrong
clicks before it, whether they cast without being told, whether they know what to do after the boss. Compare against the
funnel from `guide.t` in production (median seconds per step; drop-off per step).

---

<a id="8-fixlist"></a>
## 8. UX fix list outside onboarding (prioritised)

**Quick wins first** (each is roughly half a day or less). IDs are referenced from section 3. Severity as before.

### Quick wins

| ID | Sev | Problem | Suggested change | Likely files |
|---|---|---|---|---|
| F-1 | S1 | Starter maps are not marked; the drag instruction is quiet grey text at the bottom edge | Ship the green "fits this area" outline in the committed dock flow too and enlarge the empty-slot instruction to body size and move it *into* the slot area ("Drag a map here"); keep Ctrl-click as a visible footnote | `src/ui/atlas/Dock.tsx`, `src/ui/items/ItemView.tsx`, `src/ui/styles/atlas.css` |
| F-2 | S2 | One thing, four names: Map Device / Atlas / Cartography Table / Ember Chart | Pick *Map Device* (object) and *Atlas* (window); replace "Cartography Table" in the points tooltips and docs | `src/ui/lib/points.ts` (+ `tests/ui/points.test.ts`), `README.md`, `GAME_SPEC.md` |
| F-3 | S3 | Stale copy "Activate the Map Device to open a portal." under maps | Say "Open the area in the Atlas to open a portal." | `src/game/progression/maps.ts:772` (+ tests that pin it) |
| F-4 | S2 | Death/failure copy: "Map lost. The portals are spent." while portals remain | Choose the title by state: portals left -> "You fell" / "Run over: 7 portals left. Click the portal to go back in."; none left -> "Map lost. The portals are spent."; add one actionable line after a 0-kill death | `src/ui/panels/Modals.tsx` (`RESULT_TEXT`), `src/ui/hud/TopHud.tsx:198`, `src/ui/hud/Feedback.tsx` |
| F-5 | S1 | The Map Device and its hover label are clipped by the viewport top | Clamp world labels inside the viewport (>= 24 px) and bias the first-arrival camera so the device is visible; see also 6.3 | `src/present` label drawing, camera offset in the client loop |
| F-6 | S3 | Controls window clips at 1280x720 and 1024x600; Dash/Rift Step is absent | Make the body scrollable with a visible scrollbar and a fade, reduce the footer to one line, add "Rift Step: your dash, learn it in K", add H for Help | `src/ui/panels/Modals.tsx` (`HelpModal`), `src/ui/styles/*.css` |
| F-7 | S2 | No on-screen way to open Inventory / Character / Skills / Party | Add a row of four small buttons with keycaps (I C K P) at the right end of the deck (or beside the "?"), tooltips "Inventory (I)"; the existing badges stay | `src/ui/hud/CommandDeck.tsx`, `src/ui/styles/hud.css` |
| F-8 | S3 | Esc with nothing open opens the Menu, so a double Esc pops it | Ignore the Esc that follows a panel close for 300 ms | `src/ui/App.tsx` (`handleKey`), `src/ui/lib/panels.ts` |
| F-9 | S2 | "T1" means easiest for a map and *best* for an affix; the starter wand's affix reads "T10" | Display affix tiers as "Tier 10 (lowest of 10)" or "T10/10" in tooltips, and name them *rank* in the glossary; keep "T" for map tiers only | `src/ui/items/ItemTooltip.tsx`, `src/ui/lib/items.ts`, glossary |
| F-10 | S2 | Flasks: empty with no cue; no refill in the hideout; no explanation | Draw an empty flask as dimmed with an "empty" tooltip ("Kills drop flasks; Rook sells them"), pulse the key once at low life; decide whether the belt refills in your own hideout (open question Q3) | `src/ui/hud/CommandDeck.tsx`, rules (`src/game`) if refill is chosen |
| F-11 | S3 | Top-right map card (Quantity +30%, Rarity +15%, "+10% to all Resistances") has no explanation | Make each chip a tooltip that links to its glossary line ("Quantity: how many items drop. This map: +30% because of Surge."), and show the Surge source | `src/ui/hud/TopHud.tsx` |
| F-12 | S3 | Event card jargon (Hunt / Whiffs / Next pounce) | Add a one-sentence goal as the first line of every event card ("Dodge the Stalker's pounces; each dodge raises the reward") | `src/ui/hud/TopHud.tsx` (`text.hints`), `src/ui/hud/EventGlyph.tsx` |
| F-13 | S3 | Wave tell lists debuffs ("Brings Withered, Burning") with no explanation | Debuff chips with hover text; first-time `firstDebuff` card | `src/ui/hud/Feedback.tsx` / tell component |
| F-14 | S3 | Level-up burst prints "Level 2" twice | Remove the pixel-text duplicate | `src/ui/hud/Feedback.tsx` (`LevelUpBurst`), `src/present` text effect |
| F-15 | S3 | Skills panel: the padlock appears on skills you merely cannot afford | Reserve the padlock for prerequisites; show unaffordable skills as normal but dimmed with "needs a skill point" | `src/ui/panels/Skills.tsx` |
| F-16 | S3 | The Character sheet does not say which attribute the class wants | One line under the attributes: "Sorceress: Intelligence adds Focus and spell damage." (data already in the class blurb) | `src/ui/panels/Character.tsx` |
| F-34 | S2 | After the boss the chest is unlabelled, the return portal is partly under the Life globe, and the portal card turns red "0/8 portals left" on a victory | Name plates "Reward chest" and "Return portal" (caption size) for the first clears (or always, fading after 6 s); keep the return portal out of the HUD band (spawn it above the player); on a cleared map the portal card should read "Return portal open", not 0/8 | `src/present/props.ts`, `src/sim` return-portal placement, `src/ui/hud/TopHud.tsx` (portal card) |
| F-35 | S3 | The cleared summary ends in a single "Continue" and its list is cut at the bottom without a scroll cue | Add a footer row of up to three next actions (Spend points, Equip, Open the Atlas) shown only when relevant, and a scroll shadow on the list | `src/ui/panels/Modals.tsx` (`RunSummaryModal`) |
| F-36 | S3 | The inventory has no sort or stack-all; 12 gear pieces and 6 maps scatter across the grid after one clear | A "Sort" button (currency, maps, then gear by slot) in the inventory footer | `src/ui/panels/Inventory.tsx`, `src/game` move rules |
| F-17 | S2 | Rook's tiles have no visible price (working-tree Wares) | Print the price under every tile in secondary type; add the one-line explanation (6.6 `firstMerchant`); add an empty state for each tab | `src/ui/panels/MerchantWares.tsx`, `src/ui/panels/Merchant.tsx`, `src/ui/styles/merchant.css` |

### Medium

| ID | Sev | Problem | Suggested change | Likely files |
|---|---|---|---|---|
| F-18 | S2 | The Atlas opens with Lens, Pins, Surge, Scarab, Passage, zoom, "Motion" and a tier ruler for a player with one area | Progressive disclosure: for accounts with no completed map show only the chart, the slot, the Open button and one status line; reveal lenses, pins and Surge after the first clear (a first-clear toast says what appeared) | `src/ui/panels/Atlas.tsx`, `src/ui/atlas/*`, `src/ui/styles/atlas.css` |
| F-19 | S3 | The Codex tab is a 300-node tree with no points | While 0 points have ever been earned show a calm "Earn your first point by clearing a map" overlay and zoom to the origin; keep search disabled until then | `src/ui/codex/Codex.tsx` |
| F-20 | S2 | Crafting Bench: a text wall (clipped at 1280x720), two features at once (Recycle maps + recipes), icon-only currency | Collapse "How the bench works" into a `?` disclosure that opens once and is remembered; put Recycle under a second tab; label the currency row with names and counts; make the panel scroll | `src/ui/panels/CraftingBench.tsx`, `src/ui/panels/MapRecycle.tsx`, `src/ui/styles/crafting.css` (or `bench` styles) |
| F-21 | S3 | 1024x600: area modal readout is below the fold; the Atlas dock is cramped | Pin the footer (reason + Open area) and make the middle column scroll with a scroll shadow; keep the slot visible | `src/ui/atlas/AreaModal.tsx`, `src/ui/styles/atlas.css` |
| F-22 | S3 | Rare-pack nameplates pile up at 130+ monsters and cover the screen | Show full names only on hover or for the nearest 3 rares; otherwise a coloured tick | `src/present/monsters.ts` (label pass), `src/ui/hud/MonsterHover.tsx` |
| F-23 | S1 | Props are anonymous; wrong clicks (the spawn swirl fires a spell, Rook, the anvil) cost minutes | Name plates on unused interactives for new accounts (6.3); a pointer cursor and a hover outline on all five props | `src/present/props.ts`, `src/client/world-pick.ts`, `src/client/dom-input.ts` |
| F-24 | S2 | Unspent points are a small chip | At 3+ unspent points, or when a hideout is entered with points, pulse the chips for 4 s and name the key in the toast ("6 attribute points: press C") | `src/ui/hud/CommandDeck.tsx`, `src/ui/hud/Feedback.tsx` |

### Small content and layout items

| ID | Sev | Problem | Suggested change | Likely files |
|---|---|---|---|---|
| F-25 | S3 | A new visitor lands on "Log in"; no pitch | Default to "Create account" when there is no stored session and no "foe.seen" flag; add one line under the logo ("Craft your gear. Craft your maps. Survive six waves.") | `src/ui/screens/Title.tsx` |
| F-26 | S3 | Character name must be invented before seeing the game; field not focused | Pre-fill a generated name with a dice button and focus the field; keep validation | `src/ui/screens/Title.tsx` |
| F-27 | S3 | The "Esc" window and the Menu have no Help entry | Add Help above Controls | `src/ui/panels/Modals.tsx` |
| F-28 | S3 | Tooltips for maps are long (a wall of mod numbers) | Show a three-line summary ("Tier 1 - Cinder Crossing - 6 waves - boss: Cinder Matriarch - +10% resistances") with the long form after a 600 ms hover or Alt | `src/ui/items/ItemTooltip.tsx` |
| F-29 | S1 | The hideout camera leans with the mouse and hides the Map Device on arrival | Spawn the new character 80 to 100 units north or bias the hideout camera offset up for the first minute | hideout layout / spawn in `src/sim` hideout config, camera in `src/client` |
| F-30 | S3 | After a run, flasks and Focus are unexplained; the Focus globe never moves with Ember Lance | A one-line glossary tooltip on both globes ("Life", "Focus: spells cost Focus; Ember Lance is free") | `src/ui/hud/CommandDeck.tsx` |
| F-31 | S3 | Equipment slots are dark unlabelled silhouettes | Show slot names on hover and highlight valid slots while dragging gear | `src/ui/panels/Inventory.tsx`, `src/ui/items/dnd.ts`, `src/ui/items/Containers.tsx` |
| F-32 | S3 | The Party panel says "Loot is personal" but the chest/loot behaviour is not previewed anywhere | Reuse the line in the chest step and in the first loot hint | `src/ui/guide/strings.ts` |

---

<a id="9-open"></a>
## 9. Open questions for the owner

* **Q1. First-map warm-up.** Idle death is ~20 s and the first wave is ~36 monsters. Do we add a grace period only for
  a character's *first ever* map (wave 1 starts after the first cast or 12 s, or the spawn ring is pushed out), or
  accept the design intent that "the early game is hard" and let the tutorial carry the load? My recommendation: grace
  for the first entry only; it does not touch balance for real play.
* **Q2. Tutorial depth.** The 11-step tracker covers one full map. Should the optional "What next" rows (craft, Rook,
  Atlas point) become *tracked* steps for a first-night experience, or stay an invitation? Recommendation: invitation.
* **Q3. Flask refill.** Should flasks refill when the player returns to their own hideout (the PoE convention), or stay
  drop-only? Today they do not, and nothing says so. This is a balance decision.
* **Q4. Where the tutorial state lives.** Account-level (recommended, a second character never repeats) vs
  character-level. Account-level also makes the veteran rule trivial.
* **Q5. Names.** Confirm "Map Device" (object) and "Atlas" (window), and retire "Cartography Table" and "Ember Chart" from
  player-facing text.
* **Q6. Double-click to load.** OK to add double-click on a highlighted map to load it into the open area modal? It is
  the cheapest cure for "I did not know I had to drag".
* **Q7. Protocol bump.** One new client command needs a protocol bump; confirm that fits the release cadence, or fold the
  commands into the existing account-storage update.

## Appendix: screenshot index

| File | Moment |
|---|---|
| `01-title-1280.png`, `01-title-1024.png` | Title / login |
| `02-register-1280.png`, `03-characters-empty-1280.png`, `04-char-created-1280.png` | Registration and creation |
| `06-arrival-t0-1280.png`, `07-arrival-t4s-1280.png`, `a1-arrival.png`, `70-hideout-1024.png` | First arrival (1280 and 1024) |
| `08-hover-stash-1280.png`, `09-hover-mapdevice-1280.png`, `13-hover-device-1280.png` | Hover and camera lean |
| `11-esc-menu-1280.png`, `12-controls-1280.png`, `a5-controls.png`, `74-controls-1024.png` | Menu and Controls |
| `15-atlas-opened-1280.png`, `a2-atlas.png`, `16-hover-map-1280.png` | Atlas and the starter map |
| `17-dragging-map-1280.png`, `18-over-slot-1280.png`, `19-map-slotted-1280.png`, `20-activated-1280.png`, `23-walking-to-portal-1280.png` | Drag, slot, activate, portal |
| `21-skills-1280.png`, `22-nova-learned-1280.png`, `35-skills-spent-1280.png` | Skills |
| `24-map-arrival-t0-1280.png`, `24b-map-arrival-t3-1280.png`, `a3-map-entry.png`, `90-map-t0-1024.png`, `91-map-t9-1024.png` | Map entry |
| `w-level2.png`, `w-phase-tell-3.png`, `w-boss.png`, `a8-boss.png`, `w-phase-cleared-6.png`, `w-chest.png`, `100-summary-cleared-1280.png` | Fighting, tell, boss, clear, chest, summary |
| `25-first-fight-1280.png`, `26-after-death-hideout-1280.png`, `a4-death-summary.png`, `w-lowlife.png` | Death and summary |
| `30-character-1280.png`, `31-hover-int-1280.png`, `33-expanded-row-1280.png`, `34-points-spent-1280.png`, `72-character-1024.png` | Character sheet |
| `102-inventory-with-loot-1280.png`, `104-hover-gear-alt-1280.png`, `106-dragging-circlet-1280.png`, `110-atlas-after-clear-1280.png` | After the clear: loot, tooltip, equipping, Atlas |
| `61-stash-1280.png`, `62-bench-1280.png`, `a7-bench.png`, `71-inventory-1024.png`, `73-party-1024.png` | Stash, bench, inventory, party |
| `80-codex-1280.png`, `81-codex-1024.png` | Atlas tree |
| `51-wt2-atlas-1280.png`, `53-wt2-areamodal-1280.png`, `a6-areamodal-final.png`, `54`-`56-wt2-*`, `57-wt2-areamodal-1024.png`, `58-wt2-opened-1280.png` | Final Atlas flow (working tree) |
| `60-wt2-rook-wares-1280.png`, `63-wt2-rook-hover-1280.png`, `64-wt2-rook-supplies-1280.png` | Rook (working tree) |
