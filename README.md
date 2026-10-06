# Forge of Echoes

An online browser action RPG: **Path of Exile itemization and crafting × Vampire Survivors waves.** You craft your
gear and your maps in a hideout, open a map with friends, fight six escalating waves up to a boss, and come home with
loot to craft again.

- Three map types, each with its own monster family, lieutenant and boss: the **Ashen Forge** (fire; the Ashbound
  Herald and the Cinder Matriarch), the **Rimed Ossuary** (cold and bone; the Bone Chorister and The Hollow Warden)
  and the **Iron Coliseum** (steel and blood; The Chainmaster and Varkus, the Iron Champion).
- Monsters inflict **debuffs** you can read and answer: Chilled, Frozen, Rooted, Burning, Bleeding, Shocked and
  Withered, each with its own look on your character, an icon and timer on the HUD, and a counter (see below).
- **Special stash tabs**: a Map Stash for 400 maps, and a Crafting Stash with a slot for every currency (5,000 each)
  and a **work slot**: drag an item into it and craft on it in place with one click per currency.
- Pixel-art world with dynamic lights, rendered by our own WebGL2 renderer; procedural art and audio (no image or
  sound files).
- One authoritative Node server runs the rules and a deterministic 60 Hz simulation for every hideout and map. The
  browser client predicts your own movement and interpolates everything else.
- Characters, parties and open maps are saved in SQLite. A deploy does not cost you your party or your map (see
  [Deploying](#deploying)).

There are no game-engine libraries. Everything is TypeScript: `ws` + `node:http` + `node:sqlite` on the server, and
Vite + WebGL2 + WebAudio + Preact (DOM UI only) in the browser.

## Running it locally

Requirements: Node **22.13+** (for `node:sqlite`) and npm.

```bash
npm install
npm run dev          # game server (tsx watch, port 8787) + Vite (http://localhost:5173)
```

Open http://localhost:5173, create an account and a Sorceress, and you start in your hideout. The dev database is
`data/dev.db`. Delete it to start over.

Other useful scripts:

| Command | What it does |
|---|---|
| `npm test` | All unit and integration tests (vitest; the servers in tests use `:memory:` databases) |
| `npm run typecheck` | `tsc --noEmit` for the whole repository |
| `npm run e2e` | End-to-end run: the real server and client, played by two headless browsers (add `-- --prod` to test the production bundle) |
| `npm run build` | Typecheck, then build the client into `dist/` |
| `npm start` | Production mode: the server also serves `dist/` (build first) |
| `npm run shot -- /dev/present.html?theme=rimedOssuary --out .shots/x.png` | Headless screenshot of any page; `dev/*.html` are per-module sandboxes |

## Selling equipment

Click Rook in any hideout: his stall opens beside your inventory, like a Path of Exile vendor. He has an inventory like yours: one
plain item grid with tabs **Gear**, **Maps** (area maps and scarabs), **Supplies** (flasks, Kindling, Map Dust, currency), **Gamble** and **Sell**.
To buy, drag an item onto your backpack cell where you want it (green means it fits and you can pay, red says why not), or Ctrl/⌘-click
(or right-click) it to buy into the first free spot. The price is the last line of the hover card (red when you cannot pay). The stock is Rook's
luck of the day: four maps and eight items, random and mostly junk, sometimes a really good find, plus a small staples shelf
(flasks, Kindling, Map Dust). Nothing to pick: the board is yours alone, changes every 6 hours (04:00, 10:00, 16:00, 22:00 UTC) and at every
level-up, and **Ask for new wares** rerolls it for Scrap (3, 6, 12 ... doubling until the next rotation). A bought item leaves a gap; nothing shifts.
To sell, open the **Sell** tab and drag equipment from your backpack into his window (Ctrl/⌘-click works too); hover an offered item
for Rook's appraisal, read the payout under the grid, press **Accept**, then confirm. Drag an item back out (or Ctrl-click it) to keep it.
Equipped gear must be unequipped first; gear offered in a trade is locked.

Rook appraises the actual **item level, base, number of affixes and affix tiers**. Hover an offered item
for its breakdown. Better bases, higher item levels, more affixes and stronger tiers raise the appraisal;
rarity colour alone does not set a fixed price. Payment goes into your account's Crafting Stash, with overflow
in your backpack. Visitors sell their own gear and receive their own payment. Sales are permanent and survive
restarts. Maps, flasks and currencies cannot be sold.

## Admin CLI (`foe`)

`foe` (also `foe-cli`) is the admin tool for accounts, characters and the testing merchant. The deploy installs it
on the server next to the old `debug_merch` command, which still works and is now just `foe merchant`.

```bash
ssh -t crafty-prod foe            # interactive menu (-t gives it a terminal); alias: alias foe='ssh -t crafty-prod foe'
ssh crafty-prod foe online        # anything else runs one command and exits
# Local development against a dev database (DB_PATH, default data/dev.db)
./scripts/foe accounts            # or: npm run foe -- accounts
```

**Interactive mode** (no arguments): type to fuzzy-search characters (by account, name, class, level) or
accounts, arrow keys to move, enter to select, esc to go back. The preview under the list shows level, class, highest
map tier, last played and online status. No dependencies: it uses raw terminal keys.

| Command | What it does |
| --- | --- |
| `foe accounts [--search q]` | all accounts with character counts, created, last seen, online |
| `foe chars [account]` | characters with class, level, tier, last played, online, testing merchant |
| `foe online` | players in the running server: account, character, level, hideout/map, party |
| `foe show <account> [character]` | read-only details (progress, stash tabs, party, open map, location) |
| `foe merchant <account> <character> enable\|disable\|status` | the testing merchant (below), live, no restart |
| `foe kick <account> [character]` | disconnect players from the running server |
| `foe delete-char <account> <character>` | delete one character; the account's stash and Atlas stay |
| `foe reset <account>` | delete ALL characters and progress of one account; the login stays |
| `foe reset --all` | the same for every account |

Every read command takes `--json` (`ssh crafty-prod foe chars sharenz --json | jq ...`). Online columns show `?`
when the server cannot be asked. Options: `--db <path>`, `--dry-run`, `--yes --i-know`, `--confirm <phrase>`,
`--force`, `--offline`.

**What "progress" is.** A reset deletes, in one transaction: `characters` (saves: levels, equipment, backpack,
map device, skills, flasks), `account_storage` (the shared stash tabs, currency and map stash, and the Atlas
including tree points), `atlas_credit_queue` (pending Atlas awards), `open_maps`, `character_maps` (where
characters stood, including visits to their hideouts), `party_members` / `parties` and `debug_merchants`. Accounts and login
sessions stay. A party that keeps two members under a deleted leader gets a new leader; smaller ones dissolve.
`foe delete-char` removes that character's rows but leaves the account stash/Atlas.

**Safety of destructive commands** (`reset`, `delete-char`):

1. A summary with row counts per table is always printed first; `--dry-run` stops there.
2. The full database is copied to `<data dir>/backups/pre-reset-<time>.db` (SQLite backup API, verified,
   mode 600) before anything is deleted; no backup, no reset.
3. Typed confirmation: the account name (`reset <account>`), the character name (`delete-char`), or
   `RESET-ALL-ACCOUNTS <number of characters>` (`reset --all`). Scripts pass `--confirm "<phrase>"`, or
   `--yes --i-know` together (either alone is refused).
4. It needs to know the server state: through the admin channel, or `--offline` when the server is stopped.
   Affected players online block the command unless `--force`, which kicks them.
5. While it runs the server refuses their logins; it then drops their sessions, parties and open maps from memory, the
   CLI backs up, deletes the rows in one transaction (rolled back on any error), and lifts the lock.
   Nobody needs to restart the server. A crashed CLI cannot leave a lock behind: it expires after 10 minutes.
6. Every action (also refusals and dry runs) is appended as a JSON line to `<data dir>/admin-audit.log`
   (`/var/lib/forge/admin-audit.log`: time, actor, account/characters, counts, backup path). If the log cannot be written, nothing is changed.

```bash
ssh crafty-prod foe reset sharenz --dry-run
ssh -t crafty-prod foe reset sharenz                     # asks you to type: sharenz
ssh crafty-prod foe reset --all --force --confirm "RESET-ALL-ACCOUNTS 14"
ssh crafty-prod 'tail -5 /var/lib/forge/admin-audit.log'
```

**The admin channel** (`src/server/admin.ts`): the running server listens on a unix socket
`<data dir>/admin.sock` (mode 600) and requires the secret in `<data dir>/admin.token` (mode 600, new on every start)
in each request. There is no TCP listener and Caddy only proxies the game port, so it is not reachable from
outside. The CLI runs as the `forge` service user (the wrapper switches from root), so file ownership stays correct.
Set `ADMIN_DIR` to move the socket and token.

## Testing merchant

Enable **Mira the Provisioner** in one character's hideout using the server CLI. The account must own the
character; names are case-insensitive. It updates live without restarting and persists across releases.

```bash
# Local development (DB_PATH defaults to data/dev.db)
./scripts/foe merchant sharenz eldurin enable
# Production (the deploy installs foe and debug_merch on the server)
ssh crafty-prod foe merchant sharenz eldurin enable
ssh crafty-prod debug_merch sharenz eldurin disable     # the old name still works
```

Click Mira, south of Rook. Every visitor to that hideout can buy free scarabs (all tiers), crafting supplies,
maps, equipment bases, uniques and flasks. Choose quantity (1–100), map tier (1–15), equipment item level
(1–99), and normal/magic/rare rolls where applicable. Purchases go to the buyer's backpack; flasks refill
their belt first. A purchase that cannot fit is rejected in full. Item and Atlas requirements still apply.
Disabling removes Mira and immediately blocks purchases, including from already-open panels. Other
characters on the account are unaffected. No hideout has her enabled by default.

Mira's panel opens beside the inventory too: drag a stock row onto the backpack (the dropped cell picks the slot of the
first stack) or use its Buy button.

`npm run e2e -- --prod --only debugmerchant --size 1024x600` tests live activation, stock, dragging and buying,
guest purchases, disable and restart with two real browser clients and a disposable database.
`npm run e2e -- --only modal --size 1280x720` (and `1024x600`) plays the Atlas area modal in every state (no map, highlight, wrong-area drop and Go to, loaded map, scarabs, held surge, Open area and Repeat last setup, sealed area with its key, keyboard) and screenshots each into `.shots/e2e-modal-*.png`.
`npm run e2e -- --only territory --size 1280x720` (and `1024x600`) plays pins, the Stock and Sources lenses, Re-chart, Recycle by dragging three maps into the bench, Rook's Maps tab and the Map Stash grouped by area.
`npm run e2e -- --only wares --size 1280x720` (and `1024x600`) plays Rook's vendor window (tabs and item shelving, typical and lucky boards, the glint, the price in the hover card, buying by drag and Ctrl-click, gaps for sold items, the no-room and can't-afford drops, the doubling reroll, the staples and a level-up refresh) and screenshots each state into `.shots/e2e-wares-*`.
`npm run e2e -- --only selling --size 1280x720` (and `1024x600`) runs the debug merchant flow plus Rook: offering gear by
drag, protected gear, appraisal, atomic payout, buying and gambling by drag onto a chosen cell, the can't-afford state and a restart.

## The first run (tutorial)

A new account is guided through its first map; nothing is ever blocked and everything can be skipped. The **objective tracker** (top left) shows
three chapters (*First expedition*, *Win the map*, *Grow stronger*), at most five lines, one current step with its one-line help: click the **Map Device**,
pick the area, drag a starter map into the slot (the maps that fit are outlined and a hand shows the drag), Open area, step into the portal, fight,
defeat the boss, open the chest, return home, spend your points, equip your loot, then a *What next* card. Steps complete **by evidence** (a portal exists,
you are in a map), so a player who finds another way is never held up. A pulsing ring and chevron mark the object the step wants (an edge arrow with its
name when it is off screen); new players also see name plates on the hideout objects. On the first map entry a **controls cheat-sheet** appears (hold the
left button to cast at the cursor, WASD, flasks, Rift Step, panel hotkeys) and each chip dims when used. **The very first map of an account opens gently**:
the monsters wait until you move or cast (or 15 seconds). About fifteen first-time **coach cards** appear once each (low Life, first level-up, first loot,
first death, first craft, ...). **Help** (`H`, the `?` button, Esc menu) holds the Controls reference, how a run works, a glossary and *Reset tutorial*.
The tutorial state is **per account** (a second character does not repeat it); an account that already has a character of level 5 or higher or a completed
map is skipped for good (a *veteran*). Flasks refill for free whenever you enter a hideout. Copy lives in `src/data/guide/strings.ts`; the step machine and
hints are pure (`src/ui/guide/steps.ts`, `hints.ts`). `npm run e2e -- --only guide --size 1280x720` (and `1024x600`) plays a fresh account through all of it
and screenshots each step into `.shots/e2e-guide-*.png`. `foe show <account>` prints the account's tutorial funnel.

## Playing with friends

1. Everyone registers their own account on the same server and creates a character.
2. Press **P** (party panel) and invite a friend by character name. They accept from the card that pops up.
3. Party members can **visit each other's hideouts** from the party panel ("Visit hideout", and "Go home").
   Rook the merchant trades with everyone in any hideout, crafting works in any hideout, and the stash always opens
   your own stash.
4. The hideout owner opens the **Atlas** (click the Map Device in your hideout; the inventory opens beside it) and **clicks an area on the chart**:
   its modal opens with the **map slot** in the centre, four **scarab sockets** around it and an **Open area** button at the bottom, which says in
   words why it is disabled (no map, wrong area, key missing, not enough Scrap...). Drag a map and up to four scarabs out of your inventory into the
   slots (Ctrl/⌘-click works too; items in your stash go into the inventory first); the things that fit the area carry a quiet highlight in the inventory.
   **A map is bound to one area** ("Furnace Yard map"): another area's slot refuses it ("This map opens Furnace Yard") with a one-click *Go to Furnace Yard*
   that keeps the map in the slot. An area you hold no map for shows where to find one. *Repeat last setup* refills the scarabs of the last run there.
   A sealed area's modal has a **passage slot**: drag its key in (the Pit of Echoes opens with a Bounty map of Iron March). **Pin** up to three areas (the
   tray in the chart's corner, or the pin button in the modal): their maps drop three times as often. **Re-chart** (in the modal or at the bench) moves a map to a
   neighbouring area for Scrap; **Recycle** at the bench turns three maps of a tier into one of an area you choose; Rook's **Wares** board always carries one plain map and sometimes better ones. Press **Open area**: **8 portals** open,
   the modal closes and the status line under the chart offers *Enter the portal*. Each entry, by
   anyone, uses one portal (re-entering after death too). Click the portal to go in. Every area has **3 surge charges a day**
   (the day turns over at 04:00 UTC; the chart shows the countdown and brass pips mark each area): opening an area with
   the modal's Surge toggle on spends one for +30% item quantity (not maps) and +15% rarity in that expedition, for the whole
   party. With none left the area simply runs at the normal rate. Hourglass Sand (one area, in its modal) and the Grand Hourglass (all areas, in the
   chart's status line) refill charges. Esc closes the modal, then the Atlas; Enter opens the area when it is ready.
5. In the map, **loot is instanced**: everyone sees and picks up only their own drops. **XP is shared** by everyone
   alive in the map. Monsters get tougher and more numerous per extra player.
6. When you die, "Return to hideout" takes you to the map owner's hideout, right next to the portals, so you can
   walk back in.
7. To give someone an item, **trade** with them ("Trade" in the party panel or `/trade <name>` in chat), or drop it
   on the floor for them to pick up.

A party has up to 4 players; so does every map.

## Controls

| Input | Action |
|---|---|
| `WASD` / arrow keys | Move |
| Mouse | Aim |
| `LMB` (hold) | Basic attack (Ember Lance) |
| `Space` `Q` `E` `R` `F` | Skill slots 1–5 |
| `1`–`4` | Flasks |
| `T` | Toggle auto-attack (targets the nearest enemy near the cursor) |
| `I` / `C` / `K` / `P` / `M` | Inventory / character / skills / party / Atlas (the Map Device, in your own hideout); the buttons beside the command deck show the same keys |
| `H` / `F1` / `?` | Help: Controls, How a run works, a Glossary and the Tutorial tab (reset or skip it) |
| `Enter` | Chat (party chat; `/trade <name>` requests a trade) |
| `Esc` | Close the top panel, or open the menu (the world keeps running: the game is online) |
| `Alt` (hold) | Affix tiers, roll ranges and a comparison with your equipped item |
| `Ctrl`/`⌘` + click | Quick-move an item (backpack ↔ stash or a special stash tab, into a trade offer, onto the crafting bench, into the open map device) |
| `Shift` + `Ctrl`/`⌘` + click | Take exactly 1 currency from a Crafting Stash slot; gear or a map in the stash goes onto the crafting bench |
| `RMB` on a currency, then `LMB` on an item | Apply the currency (`Esc` or `RMB` cancels) |
| Click a hideout object | Map Device, stash, Rook the merchant, the anvil (Crafting Bench) |
| Click a portal | Enter the map (from anywhere in the hideout); in a map, the return portal takes you back |

**Loot.** Currency, flasks and maps are collected by walking over them. **Equipment is picked up by clicking** its
label or sprite. If it's out of reach, your character walks there first (any movement key cancels the walk). A click
on a label always wins over the basic attack, and hovering a drop highlights its label.

**Dropping items.** Drag an item out of any panel onto the world to drop it at your feet. Stash items can only be
dropped in a hideout. A dropped item is **public**: anyone in the area sees it (its label has a neutral "ground"
marker) and anyone can click it up. Public items are never collected by walking over them, and they vanish after
10 minutes or when the area closes.

**Trading.** Request a trade from the party panel or with `/trade <name>`; the other player accepts from the card
that pops up, anywhere on the server. Drag (or Ctrl-click) up to 12 backpack items into your offer. Any change to
either offer clears both accepts and locks accepting for 2 seconds. When both accept, the server checks that both
backpacks have room and swaps everything in one step. Offered items stay in your backpack but are locked until the
trade closes.

**Crafting Bench.** Click the anvil in any hideout and drag (or Ctrl-click) an item onto its slot. Each recipe adds
one chosen affix at a modest, fixed tier (never better than T4) for Forge Scrap, plus a matching essence for tagged
affixes. It costs 1 Stability with no scar risk. An item holds at most one bench-crafted affix; it is marked
"crafted" and can be removed for free ("Clear crafted affix"). The bench also lists every currency you carry: click
one to apply it to the bench item, with the odds preview.

**Special stash tabs.** Next to your normal stash tabs are three icon tabs; they don't count towards the tab limit.
- **Map Stash** (up to 400 maps): Ctrl-click or drag a map in and it files itself by tier and map type. Maps are
  listed by tier (click a tier) and grouped by map type, with their mods and a full tooltip. Drag one out, Ctrl-click
  it to your backpack and then drag it into the Atlas table's map slot (the table takes maps from the inventory only).
- **Crafting Stash** (two tabs: equipment currency and map currency): one labelled slot per currency, up to 5,000
  each. Drop or Ctrl-click any currency stack onto either tab and it files into its slot; **Deposit all** empties your
  backpack's currency into it. Ctrl-click a slot to take a stack, Shift+Ctrl-click to take exactly one. Right-click a
  slot to arm that currency and left-click an item to craft with it straight from the stash. Rook and the Crafting
  Bench take what your backpack can't pay from the Crafting Stash, so "Deposit all" never leaves you short.
  **Work slot**: next to the currency tiles sits one slot for the gear or map you are crafting. Drag an item out of the
  inventory into it (or Ctrl-click it while a Crafting Stash tab is open), then **click a currency tile** to craft on it
  without moving anything: the new or changed modifiers light up, Stability and the last crafts are shown, and
  Equip / Return / Bench sit below. Fracture Core, Anneal, Transmute and Void Needle ask first. The item is saved
  with your account storage, so it is still there after a restart or on another character.

**Stash search.** The search box on the stash panel (`Ctrl`/`⌘`+`F` while the stash is open, `Esc` clears it)
highlights matching items in every tab and in your backpack and dims the rest; each tab shows its match count. It
matches names, base types, affix texts and names, tags, currency and map names, and rarity words. Space-separated
terms must all match, `"quoted phrases"` match as a whole, `a|b` matches either, and `!term` excludes.

## Map types, bosses and debuffs

Every map type has its own family of five monsters, a **lieutenant** on wave 3 and a **boss** on wave 6. The map
device readout names the boss and lists the map's **Afflictions** (which debuffs its monsters inflict, from what, and
the counter).

| Map type | Family | Lieutenant | Boss | Debuffs |
|---|---|---|---|---|
| Ashen Forge | Ashling, Ember Skitter, Cinder Spitter, Rift Stalker, Ironhide Brute | Ashbound Herald | Cinder Matriarch | Burning, Withered |
| Rimed Ossuary | Bone Thrall, Rimeshade, Frost Weaver, Glacial Wisp, Ossuary Golem | Bone Chorister | The Hollow Warden | Chilled, Rooted, Frozen |
| Iron Coliseum | Pit Hound, Chain Thrall, Iron Crossbowman, Shieldbearer, Tar Slinger | The Chainmaster | Varkus, the Iron Champion | Bleeding, Rooted |

| Debuff | What it does | Counter |
|---|---|---|
| Chilled | 30% slower movement and casting | Cold resistance shortens it |
| Frozen | Can't move or cast for 0.8 s (only from telegraphed attacks: an Ice Prison, a Glacial Wisp at point blank), then 3 s immune | Walk out of the telegraph |
| Rooted | Can't move, can still cast; no new root for 3 s after one | **Rift Step** breaks it |
| Burning | Fire damage over 3 s | Life flask; fire resistance shortens it |
| Bleeding | Physical damage over 4 s, doubled while you move, stacks to 3 | Life flask; stand still |
| Shocked | 20% more damage taken (no monster inflicts it yet) | Lightning resistance shortens it |
| Withered | −12% to all elemental and void resistances per stack, stacks to 3 | Focus flask |

A debuff never comes from an invisible source: every root and freeze comes from a projectile you can see or a
telegraph you can read. Cinder Ward makes debuffs run out twice as fast; dying or killing the boss clears them. Hold
`Alt` (or open a panel) and hover a debuff icon for its details. Iron Coliseum tips: Shieldbearers block your
projectiles from the front (flank them), and Varkus's charge lane is drawn before he runs it.

## Deploying

Production is one VM running the game server under systemd behind Caddy (automatic HTTPS). The settings (SSH host
alias, IP, domain) are in `scripts/deploy/config.sh`; override them in `scripts/deploy/.env.deploy` (git-ignored).

```bash
npm run deploy:setup   # once per VM: Node packages, the forge user, systemd unit, Caddy, firewall
npm run deploy         # typecheck + tests, build, upload a new release, switch, health-check, roll back on failure
```

`npm run deploy` (`SKIP_CHECKS=1` skips the typecheck and tests) uploads an immutable release to
`/opt/forge/releases/<time>-<commit>`, installs the runtime dependencies, points `/opt/forge/current` at it and
restarts the `forge` service. The database lives outside the releases, in `/var/lib/forge/forge.db`. The last 5
releases are kept.

**Deploys keep your session.** On `systemctl restart` the server gets SIGTERM and:

1. announces "Server update in 20 seconds — your party and open maps are kept." (chat and a toast) and keeps the
   world running for `DRAIN_SECONDS` (20 in production);
2. saves every character, party and open map, then closes the sockets with code 4004;
3. the clients show "Server updating — reconnecting…" and reconnect on their own when the new server is up.

After the restart, parties are back, and every open map that wasn't cleared is recreated with the same portals left.
Players who were inside go straight back into it without using a portal (the fight restarts from wave 1, and loot
nobody picked up yet is lost). Players who were visiting a party member's hideout go back to that hideout. Items a player
dropped on the floor go back to whoever dropped them, and open trades are cancelled.

The systemd unit (`scripts/deploy/forge.service`, re-installed by every deploy) runs the server as a single
`node --import tsx` process with `KillMode=mixed`, so the server receives exactly one SIGTERM and gets 60 s to
drain and save. Server logs: `ssh crafty-prod journalctl -u forge -f`.

## How the code is organised

| Document | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module map, dependency rules, timing, determinism, the online data flow |
| [GAME_SPEC.md](GAME_SPEC.md) | The buildable spec: every number, rule, monster and online behaviour |
| [CONCEPTS.md](CONCEPTS.md) | The design brief: pillars, the numeric core, why things are the way they are |
| [AGENTS.md](AGENTS.md) | Contributor guidance, including the UI type scale |

In short: `src/contracts` holds the shared interfaces; `src/game` + `src/data` the rules; `src/sim` the deterministic
simulation; `src/server` the authoritative server (auth, SQLite, instances, parties, trades); `src/net` the binary
snapshot protocol; and `src/client`, `src/render`, `src/present`, `src/art`, `src/audio` and `src/ui` the browser
side. Each module's `index.ts` starts with a header describing its conventions, and tests live in `tests/<module>/`.
