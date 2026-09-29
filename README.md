# Forge of Echoes

An online browser action RPG: **Path of Exile itemization and crafting × Vampire Survivors waves.** You craft your
gear and your maps in a hideout, open a map with friends, fight six escalating waves up to a boss, and come home with
loot to craft again.

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

## Playing with friends

1. Everyone registers their own account on the same server and creates a character.
2. Press **P** (party panel) and invite a friend by character name. They accept from the card that pops up.
3. Party members can **visit each other's hideouts** from the party panel ("Visit hideout", and "Go home").
   Rook the merchant trades with everyone in any hideout, crafting works in any hideout, and the stash always opens
   your own stash.
4. The hideout owner puts a map into the **Map Device** and presses Activate: **8 portals** open. Each entry, by
   anyone, uses one portal (re-entering after death too). Click the portal to go in.
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
| `I` / `C` / `K` / `P` | Inventory / character / skills / party |
| `Enter` | Chat (party chat; `/trade <name>` requests a trade) |
| `Esc` | Close the top panel, or open the menu (the world keeps running: the game is online) |
| `Alt` (hold) | Affix tiers, roll ranges and a comparison with your equipped item |
| `Ctrl`/`⌘` + click | Quick-move an item (backpack ↔ stash, into a trade offer, onto the crafting bench) |
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

**Stash search.** The search box on the stash panel (`Ctrl`/`⌘`+`F` while the stash is open, `Esc` clears it)
highlights matching items in every tab and in your backpack and dims the rest; each tab shows its match count. It
matches names, base types, affix texts and names, tags, currency and map names, and rarity words. Space-separated
terms must all match, `"quoted phrases"` match as a whole, `a|b` matches either, and `!term` excludes.

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
