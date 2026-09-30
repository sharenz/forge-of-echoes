#!/usr/bin/env node
// End-to-end test of the real game: the real server (src/server/main.ts via tsx, a throwaway SQLite file) and the
// real client (Vite dev server proxying /api and /ws to it), played by two headless Chromium players.
//
//   node scripts/e2e.mjs [--fight 40] [--size 1024x600] [--headed] [--keep-db] [--prod]
//                        [--only wave5|qol|account|atlas|events|crafting|ingredients|economy|maps] [--smoke 30]
//
// --prod tests the production bundle instead of the Vite dev server: `vite build` (with VITE_FOE_DEBUG=1, so the
// window.__foe hooks this script drives are compiled in) into a temp dir, served by the game server itself
// (NODE_ENV=production, STATIC_DIR).
//
// Flow (every user scenario of GAME_SPEC §11–§12, through the real UI where a player would use it):
//   1. Both players register and create a character; both learn Ember Nova in the skill tree.
//   2. A clicks the map device in the world, Ctrl-clicks a map into it and activates it (8 portals).
//   3. A invites B from the party panel; B joins from the invite card and visits A's hideout.
//   4. B clicks Rook in A's hideout and BUYS Kindling with its own Scrap (A's currency untouched).
//   5. Stash search: matches glow, the rest dims; Esc clears it.
//   6. A drags its robe out of the inventory onto the floor (a public drop); B clicks it (walking there) and picks it up.
//   7. Trade from the party panel: robe ↔ a currency stack, both accept; the items of A + B are conserved exactly.
//   8. Crafting Bench: A clicks the anvil, places the wand, crafts a recipe, then clears the crafted affix.
//   9. A and B each CLICK the portal (8 → 6); the autopilots fight (screenshots, drop ownership sampling).
//  10. Click-only equipment: the first own equipment drop is stood on for 1.5 s (it stays on the ground), then its
//      label is clicked and it lands in the backpack. Shared XP; B's link drops and resumes in place.
//  11. B walks into the horde and dies; "Return to hideout" puts B in A's hideout NEXT TO the portals (run summary:
//      failed); B clicks back in (6 → 5). A leaves (run summary) and re-enters (5 → 4); both leave (A home, B in A's
//      hideout, then home from the party panel); both click back into A's map (4 → 2).
//  12. Server update mid-map (SIGTERM, a short drain): both clients show "Server updating — reconnecting…", come back
//      on their own INSIDE the restored map (same instance, same map, 2 portals), still in their party, same levels;
//      the portal keeps working afterwards (2 → 1).
//  13. A stale bundle after a deploy (snapshots in a newer format): one automatic reload back into the game; when the
//      reload does not help, the page explains instead of reloading again, and "Try again" brings the player back.
// Wave 5 (GAME_SPEC §12 special stash tabs, §13 debuffs, §14 bestiary; `--only wave5` runs just these, A alone):
//  14. A takes a free Rimed Ossuary and Iron Coliseum map from Rook and Ctrl-clicks every map into the Map Stash tab.
//  15. Crafting Stash: "Deposit all" (every backpack currency, conserved), Shift+Ctrl-click takes exactly 1 Scrap,
//      Ctrl-click a full stack.
//  16. Crafting from the Crafting Stash: right-click a slot, left-click the equipped wand (one use from the slot).
//  17. For the Ossuary, then the Coliseum: the map device's Map Stash picker loads the map, Activate, click the portal;
//      the autopilot baits the map's debuff dealers (bot option `bait`: it stands in reach of Frost Weavers and Glacial
//      Wisps / Chain Thralls, Tar Slingers and Crossbowmen without shooting them or dodging their shots) until the
//      checks have what they need, then fights on to --smoke seconds. Asserted: only that map's roster appears (its
//      tells too); Chilled (Ossuary) / Bleeding and Rooted (Coliseum) reach the HUD; at least one root or freeze lands,
//      and every one comes from a visible source (a web / hook / tar glob passing her, or tar / an ice prison / a wisp
//      burst under her, sampled every frame — GAME_SPEC §13); after each chain-hook drag her prediction agrees with the
//      server's snapshot (no rubber band); the raw replica debuffs keep the PlayerDebuffView contract (ids, timers,
//      stack caps, root sources); no errors. A fall before the checks are done goes back in through the portal. Then
//      home. No debug fast path is needed: every wave draws from the map's own family (thralls from wave 2); the
//      tables and constants these checks use are loaded from src/contracts and src/sim (tsx), never copied.
// Asserts throughout: no page errors, console errors or unexpected console warnings (a malformed server message is a
// warning), each client only ever sees its own loot or public drops (in snapshots AND drop/pickup events), portal
// counts, zones and run summaries. Prints PASS/FAIL per step and exits 0 / 1.
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const FIGHT_SECONDS = Number(opt('fight', '40'));
/** --only wave5: skip the two-player core scenario (A alone plays the special stash tabs and both new map types). */
const WAVE5_ONLY = opt('only', 'all') === 'wave5';
const QOL_ONLY = opt('only', 'all') === 'qol';
const ACCOUNT_ONLY = opt('only', 'all') === 'account';
const ATLAS_ONLY = opt('only', 'all') === 'atlas';
const INGREDIENTS_ONLY = opt('only', 'all') === 'ingredients';
const UNIQUES_ONLY = opt('only', 'all') === 'uniques';
const TREE_ONLY = opt('only', 'all') === 'tree';
const SCARABS_ONLY = opt('only', 'all') === 'scarabs';
const DEBUGMERCHANT_ONLY = opt('only', 'all') === 'debugmerchant';
const EVENTS_ONLY = opt('only', 'all') === 'events';
const MAPS_ONLY = opt('only', 'all') === 'maps';
const ECONOMY_ONLY = opt('only', 'all') === 'economy';
const CRAFTING_ONLY = opt('only', 'all') === 'crafting' || ECONOMY_ONLY;
/** Seconds of fighting in each new map type (longer while its family has not shown two kinds yet). */
const SMOKE_SECONDS = Number(opt('smoke', '30'));
const PROD = flag('prod');
const [VW, VH] = opt('size', '1024x600').split('x').map(Number);
const SHOTS = join(root, '.shots');
mkdirSync(SHOTS, { recursive: true });

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;
const log = (...a) => console.log(`[e2e ${elapsed()}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------------------
// Infrastructure: free port, game server, Vite, browser
// ---------------------------------------------------------------------------------------------------------------

function freePort() {
  return new Promise((res, rej) => {
    const s = createNetServer();
    s.unref();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

const serverLog = [];
let serverProc = null;
let vite = null;
let browser = null;
const tmp = mkdtempSync(join(tmpdir(), 'foe-e2e-'));

async function stopGameServer() {
  if (!serverProc || serverProc.exitCode !== null) return;
  const proc = serverProc;
  proc.kill('SIGTERM');
  await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(10_000)]);
  if (proc.exitCode === null) proc.kill('SIGKILL');
}

/** --prod: the built client the game server serves. */
let staticDir = null;

async function startGameServer(port) {
  const dbPath = join(tmp, 'e2e.db');
  // A short drain, so the restart phase sees the update announcement (toast + chat) before the 4004 close.
  const env = { ...process.env, PORT: String(port), DB_PATH: dbPath, NODE_ENV: 'development', DRAIN_SECONDS: '2' };
  if (staticDir) Object.assign(env, { NODE_ENV: 'production', STATIC_DIR: staticDir, RATE_LIMITS: 'dev' });
  serverProc = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (buf) => {
    for (const line of buf.toString().split('\n')) if (line.trim()) serverLog.push(line);
  };
  serverProc.stdout.on('data', collect);
  serverProc.stderr.on('data', collect);
  let exited = null;
  serverProc.on('exit', (code) => (exited = code));
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`game server exited with code ${exited}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error('game server did not become healthy within 40 s');
}

async function startVite(serverPort) {
  const target = `http://127.0.0.1:${serverPort}`;
  process.env.GAME_SERVER = target; // vite.config.ts reads it for its proxy
  const { createServer, createLogger } = await import('vite');
  // The proxy reports every socket the game server drops (expected during the restart phase): keep it quiet.
  const logger = createLogger('error');
  const baseError = logger.error.bind(logger);
  logger.error = (msg, opts) => {
    if (/ws proxy|ECONNRESET|ECONNREFUSED|EPIPE/.test(String(msg))) return;
    baseError(msg, opts);
  };
  vite = await createServer({
    root,
    customLogger: logger,
    logLevel: 'error',
    server: {
      port: 0,
      host: '127.0.0.1',
      strictPort: false,
      hmr: false,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/ws': { target, ws: true, changeOrigin: true },
      },
    },
  });
  await vite.listen();
  return `http://127.0.0.1:${vite.httpServer.address().port}`;
}

/** --prod: build the client (debug hooks compiled in for this script) into the temp dir. */
async function buildClient() {
  const outDir = join(tmp, 'dist');
  process.env.VITE_FOE_DEBUG = '1';
  const { build, createLogger } = await import('vite');
  await build({ root, logLevel: 'error', customLogger: createLogger('error'), build: { outDir, emptyOutDir: true } });
  return outDir;
}

async function cleanup() {
  try {
    await browser?.close();
  } catch {}
  try {
    await vite?.close();
  } catch {}
  await stopGameServer();
  if (!flag('keep-db')) rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------------------------------------------

/** Console noise that is not an application error (software WebGL driver chatter). */
const BENIGN = [/GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i];
/** Warnings that are not the application's (dev tooling); anything else fails the run. */
const BENIGN_WARNINGS = [/\[vite\]/i, /Download the Preact DevTools/i];

/** Set while the game server is deliberately down: the browser logs each failed WebSocket attempt itself. */
let outage = false;
const OUTAGE_NOISE = [/WebSocket connection to .* failed/i, /Failed to load resource.*(502|503|504)/i];
/** Set while a client is fed snapshots it cannot decode (the stale-bundle step): it warns once per page. */
let staleSnapshots = false;
const STALE_NOISE = [/world snapshot format \d+ could not be decoded/i];

class Player {
  constructor(label, page) {
    this.label = label;
    this.page = page;
    this.errors = [];
    this.warnings = [];
    this.expected = 0;
    /** Main-frame navigations (the first load included): the stale-bundle step counts the client's own reloads. */
    this.navigations = 0;
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) this.navigations++;
    });
    page.on('console', (m) => {
      const text = m.text();
      if (BENIGN.some((re) => re.test(text))) return;
      if ((outage && OUTAGE_NOISE.some((re) => re.test(text))) || (staleSnapshots && STALE_NOISE.some((re) => re.test(text)))) {
        this.expected++;
        return;
      }
      if (m.type() === 'error') this.errors.push(`console.error: ${text}`);
      else if (m.type() === 'warning' && !BENIGN_WARNINGS.some((re) => re.test(text))) this.warnings.push(text);
    });
    page.on('pageerror', (e) => this.errors.push(`pageerror: ${e.message}\n${e.stack ?? ''}`));
  }

  state(fn = 's => s') {
    return this.page.evaluate(`(${fn})(window.__foe.store.get())`);
  }

  eval(fn, arg) {
    return this.page.evaluate(fn, arg);
  }

  async waitFor(desc, fn, arg, timeout = 20_000) {
    try {
      await this.page.waitForFunction(fn, arg, { timeout, polling: 100 });
    } catch (err) {
      throw new Error(`${this.label}: waiting for ${desc}: ${err.message}`);
    }
  }

  /** Wait (node side) until the page has navigated `n` times in total, then for its load event. */
  async waitForNavigations(n, what, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    while (this.navigations < n) {
      if (Date.now() > deadline) throw new Error(`${this.label}: timed out waiting for ${what}`);
      await sleep(50);
    }
    await this.page.waitForLoadState('load', { timeout });
  }

  async shot(name) {
    const file = join(SHOTS, `e2e-${name}.png`);
    await this.page.screenshot({ path: file });
    shots.push(file);
    return file;
  }
}

const shots = [];
const results = [];

async function step(name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - start, detail });
    log(`PASS  ${name}${detail ? `  (${detail})` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - start, detail: err.message });
    log(`FAIL  ${name}: ${err.message}`);
    throw err;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function registerAndPlay(p, base, username, password, charName, register = true) {
  const { page } = p;
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.waitForSelector('.fe-auth', { timeout: 60_000 });
  if (register) await page.click('.fe-auth__tab:has-text("Create account")');
  await page.fill('#fe-user', username);
  await page.fill('#fe-pass', password);
  if (register) await page.fill('#fe-pass2', password);
  await page.click('.fe-auth__form button[type=submit]');
  await page.waitForSelector('.fe-chars', { timeout: 20_000 });
  if (!register) await page.locator('.fe-charcard--new').click();
  await page.fill('#fe-cname', charName);
  await page.click('.fe-create button[type=submit]');
  await p.waitFor('the new character in the list', (n) => window.__foe.store.get().characters.some((c) => c.name === n), charName);
  await page.click('.fe-selected__actions button:has-text("Play")');
  await p.waitFor(
    'the game screen with a HUD',
    () => {
      const s = window.__foe.store.get();
      return s.screen === 'game' && !!s.hud && !!s.character && s.zone === 'hideout';
    },
    undefined,
    30_000,
  );
}

/** Where a prop is on screen (CSS px), or null. `lift`: world units above the base anchor (the sprite body). */
async function propOnScreen(p, kind, lift = 10) {
  return p.eval(([k, up]) => {
    const w = window.__foe.world;
    const prop = w?.view.props.find((q) => q.kind === k);
    if (!prop) return null;
    return window.__foe.worldToScreen(prop.x, prop.y - up);
  }, [kind, lift]);
}

// Drop ownership sampling: every drop a client can see must be its own (instanced loot) or public (owner 0, an item
// a player dropped on the floor). Drops are magnetised and picked up within a second or two, so an in-page sampler
// looks 10 times a second.
// It also arms the click-pickup check: the first own EQUIPMENT drop that lands (while `window.__e2eEquipArmed`)
// switches this client's autopilot to stand on it without collecting anything (bot option `hold`).
async function startDropSampler(p) {
  await p.eval(() => {
    const rec = { ids: new Set(), foreign: 0, foreignLabels: [], max: 0, equipSeen: 0, equipTest: null };
    window.__e2eDrops = rec;
    setInterval(() => {
      const w = window.__foe.world;
      if (!w || window.__foe.store.get().zone !== 'map') return;
      const me = w.localPlayerId;
      rec.max = Math.max(rec.max, w.view.drops.length);
      for (const d of w.view.drops) {
        if (!rec.ids.has(d.id)) {
          rec.ids.add(d.id);
          if (d.spec.owner === me && !d.spec.autoPickup) rec.equipSeen++;
          if (d.spec.owner !== me && d.spec.owner !== 0) {
            rec.foreign++;
            rec.foreignLabels.push(`${d.spec.label} (owner ${d.spec.owner}, me ${me})`);
          }
        }
        const alive = w.view.players.some((q) => q.id === me && !q.dead);
        if (window.__e2eEquipArmed && !rec.equipTest && alive && d.spec.owner === me && !d.spec.autoPickup && d.z <= 0.5 && !d.blocked) {
          window.__e2eEquipArmed = false;
          rec.equipTest = { id: d.id, label: d.spec.label, x: d.x, y: d.y, sprite: d.spec.sprite };
          window.__foe.bot.enable({ collect: false, hold: { x: d.x, y: d.y } });
        }
      }
    }, 100);
  });
}

async function dropReport(p) {
  return p.eval(() => {
    const r = window.__e2eDrops;
    // Drop / pickup events (the server filters them per owner) count as well as snapshot drops.
    const ev = window.__foe.dropEvents();
    return {
      seen: r.ids.size, foreign: r.foreign, labels: r.foreignLabels.slice(0, 5), max: r.max, equipSeen: r.equipSeen, equipTest: r.equipTest,
      events: ev.own, foreignEvents: ev.foreign, eventLabels: ev.foreignLabels.slice(0, 5),
    };
  });
}

/** True when the CSS point is on the world canvas (not under a UI surface) and inside the viewport. */
async function onWorld(p, at) {
  if (!at || at.x < 4 || at.y < 4 || at.x > VW - 4 || at.y > VH - 4) return false;
  return p.eval(([x, y]) => document.elementFromPoint(x, y)?.id === 'world', [at.x, at.y]);
}

/**
 * Walk (WASD, like a player) until `locate()` returns a CSS point on the world canvas with some margin, or give up.
 * `locate` returns the target's screen point (or null) and, as `dir`, which way to walk (world delta sign).
 */
async function walkUntilOnScreen(p, locate, what) {
  for (let i = 0; i < 40; i++) {
    const at = await locate();
    if (at && at.x > 80 && at.x < VW - 80 && at.y > 90 && at.y < VH - 150 && (await onWorld(p, at))) return at;
    const target = at ?? { x: VW / 2, y: VH / 2 };
    const keys = [];
    if (target.y < 90) keys.push('w');
    else if (target.y > VH - 150) keys.push('s');
    if (target.x < 80) keys.push('a');
    else if (target.x > VW - 80) keys.push('d');
    if (!keys.length) keys.push('s'); // under a panel: step aside
    for (const k of keys) await p.page.keyboard.down(k);
    await sleep(160);
    for (const k of keys) await p.page.keyboard.up(k);
    await sleep(100);
  }
  throw new Error(`${p.label}: ${what} never came into view`);
}

/** Click the world at `at` like a player: hover first (the hand cursor must show), then click. */
async function clickWorld(p, at, what) {
  await p.page.mouse.move(at.x, at.y);
  await p.waitFor(`the hand cursor over ${what}`, () => document.getElementById('world')?.classList.contains('foe-world--pointer'), undefined, 3000);
  await p.page.mouse.click(at.x, at.y);
}

/** Wait until every open panel has finished its slide-in (screenshots on a loaded machine catch it mid-fade). */
async function settlePanels(p) {
  try {
    await p.page.waitForFunction(() => [...document.querySelectorAll('.fe-panel')].every((e) => getComputedStyle(e).opacity === '1'), undefined, { timeout: 3000, polling: 50 });
  } catch {
    // cosmetic only: take the screenshot anyway
  }
}

/** Close every panel (and any dialog, and a run summary) so the world is clear. */
async function closePanels(p) {
  await p.eval(() => {
    window.__foe.store.actions.closeAllPanels();
    if (window.__foe.store.get().runSummary) window.__foe.store.actions.dismissRunSummary();
  });
  await sleep(150);
}

/** Items of the character by location kind, as { uid, kind, baseId, currencyId }. */
function itemsOf(p, where = 'backpack') {
  return p.eval((w) => {
    const ch = window.__foe.store.get().character;
    if (!ch) return [];
    const list = w === 'backpack' ? ch.backpack.entries.map((e) => e.item) : Object.values(ch.equipment);
    return list.map((i) => ({ uid: i.uid, kind: i.kind, baseId: i.baseId ?? null, currencyId: i.currencyId ?? null, count: i.count ?? 1 }));
  }, where);
}

/** Currency on hand by id (backpack stacks), e.g. { scrap: 10, kindling: 4 }. */
function currencyOf(p) {
  return p.eval(() => {
    const out = {};
    for (const e of window.__foe.store.get().character?.backpack.entries ?? []) {
      if (e.item.kind === 'currency') out[e.item.currencyId] = (out[e.item.currencyId] ?? 0) + e.item.count;
    }
    return out;
  });
}

/**
 * Everything a character holds (backpack, equipment, map device, stash tabs), as counts per identity: currency by id
 * and stack size, other items by kind + base + name (uids may be re-minted when an item changes hands).
 */
function holdingsOf(p) {
  return p.eval(() => {
    const ch = window.__foe.store.get().character;
    const out = {};
    const add = (i) => {
      if (!i) return;
      const stack = i.kind === 'currency' || i.kind === 'flask';
      const key = i.kind === 'currency'
        ? `currency:${i.currencyId}`
        : i.kind === 'flask' ? `flask:${i.flaskId}` : `${i.kind}:${i.baseId}:${i.tier ?? ''}:${i.name ?? ''}`;
      out[key] = (out[key] ?? 0) + (stack ? i.count : 1);
    };
    for (const e of ch?.backpack.entries ?? []) add(e.item);
    for (const i of Object.values(ch?.equipment ?? {})) add(i);
    add(ch?.mapDevice);
    for (const t of ch?.stash ?? []) for (const e of t.grid?.entries ?? []) add(e.item);
    return out;
  });
}

/** Sum of several holdings maps. */
function sumHoldings(...list) {
  const out = {};
  for (const h of list) for (const [k, n] of Object.entries(h)) out[k] = (out[k] ?? 0) + n;
  return out;
}

/** Keys whose counts differ between two holdings maps (empty = conserved). */
function holdingsDiff(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => (a[k] ?? 0) !== (b[k] ?? 0)).map((k) => `${k}: ${a[k] ?? 0} → ${b[k] ?? 0}`);
}

/** Distance (world units) from the local player to the first prop of `kind`, or -1. */
function distanceToProp(p, kind) {
  return p.eval((k) => {
    const w = window.__foe.world;
    const me = w?.view.players.find((q) => q.id === w.localPlayerId);
    const prop = w?.view.props.find((q) => q.kind === k);
    return me && prop ? Math.hypot(me.x - prop.x, me.y - prop.y) : -1;
  }, kind);
}

/** Click the open map portal in the world like a player (walking until it is on screen). */
async function clickPortal(p) {
  await closePanels(p);
  const at = await walkUntilOnScreen(p, () => propOnScreen(p, 'portal', 24), 'the portal');
  await clickWorld(p, at, 'the portal');
  return at;
}

// ---------------------------------------------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------
// The core scenario (GAME_SPEC §11–§12): two players, party, trade, maps, deaths, reconnects, a server update
// ---------------------------------------------------------------------------------------------------------------

async function coreScenario({ A, B, nameA, nameB, port }) {
  await sleep(1500);
  await A.shot('01-hideout-A');

  await step('both learn Ember Nova in the skill tree and slot it on Space (real UI)', async () => {
    for (const p of [A, B]) {
      await p.page.keyboard.press('k');
      await p.page.waitForSelector('.fe-skills', { timeout: 5000 });
      await p.page.click('button[aria-label="Rank up Ember Nova"]');
      await p.waitFor('Ember Nova rank 1', () => window.__foe.store.get().character?.skillRanks.emberNova === 1, undefined, 5000);
      await p.page.click('button[aria-label^="Ember Nova, rank"]');
      await p.page.locator('.fe-lslot').nth(1).click();
      await p.waitFor('Ember Nova on RMB', () => window.__foe.store.get().character?.loadout[1] === 'emberNova', undefined, 5000);
      if (p === A) await p.shot('01b-skills-A');
      await p.page.keyboard.press('k');
      // The server confirms: the HUD slot (from the replicated player) carries the skill.
      await p.waitFor('the RMB slot on the HUD', () => window.__foe.store.get().hud?.slots[1]?.skillId === 'emberNova', undefined, 5000);
    }
    return 'emberNova on slot 1 for both';
  });


  await step('A walks up to the map device and clicks it in the world', async () => {
    let at = await propOnScreen(A, 'mapDevice');
    assert(at, 'no map device prop in the hideout');
    // Walk north (W) until the device is comfortably on screen, like a player would.
    for (let i = 0; i < 30 && at && (at.y < 90 || at.y > VH - 170); i++) {
      await A.page.keyboard.down(at.y < 90 ? 'w' : 's');
      await sleep(180);
      await A.page.keyboard.up(at.y < 90 ? 'w' : 's');
      await sleep(120);
      at = await propOnScreen(A, 'mapDevice');
    }
    assert(at && at.y >= 60 && at.y <= VH - 140, `the map device never came into view (${JSON.stringify(at)})`);
    await A.page.mouse.move(at.x, at.y);
    await sleep(150);
    await A.page.mouse.click(at.x, at.y);
    await A.waitFor('the map device panel', () => window.__foe.store.get().openPanels.includes('mapDevice'), undefined, 5000);
    await A.page.waitForSelector('.fe-device', { timeout: 5000 });
    return `clicked at ${Math.round(at.x)},${Math.round(at.y)}`;
  });

  await step('A Ctrl-clicks a map into the device and activates it', async () => {
    const map = A.page.locator('.fe-grid[data-drop="backpack"] .fe-item[data-kind="map"]').first();
    await map.waitFor({ timeout: 5000 });
    await map.click({ modifiers: ['Control'] });
    await A.waitFor('the map in the device', () => !!window.__foe.store.get().character?.mapDevice, undefined, 5000);
    await A.shot('02-map-device-A');
    await A.page.click('.fe-device__activate');
    await A.waitFor('the portal to open', () => {
      const s = window.__foe.store.get();
      return !!s.hud?.portal && s.hud.portal.remaining === 8;
    }, undefined, 8000);
    const portal = await A.state('s => s.hud.portal');
    return `${portal.mapName} T${portal.tier}, ${portal.remaining}/${portal.total} portals`;
  });

  await step('A invites B from the party panel; B joins from the invite card', async () => {
    await A.page.keyboard.press('Escape'); // close the device + inventory
    await A.page.evaluate(() => window.__foe.store.actions.closeAllPanels());
    await A.page.keyboard.press('p');
    await A.page.waitForSelector('#fe-invite-name', { timeout: 5000 });
    await A.page.fill('#fe-invite-name', nameB);
    await A.page.click('.fe-invite button:has-text("Invite")');
    await B.page.waitForSelector('.fe-invite-card', { timeout: 8000 });
    await B.shot('03-invite-B');
    await B.page.click('.fe-invite-card button:has-text("Join")');
    await A.waitFor('a party of two', () => (window.__foe.store.get().party?.members.length ?? 0) === 2, undefined, 8000);
    await B.waitFor('a party of two', () => (window.__foe.store.get().party?.members.length ?? 0) === 2, undefined, 8000);
    await A.page.keyboard.press('Escape');
    await A.waitFor('the party panel closed', () => !window.__foe.store.get().openPanels.includes('party'), undefined, 3000);
    return 'party of 2';
  });

  await step("B visits A's hideout from the party panel", async () => {
    await B.page.keyboard.press('p');
    const row = B.page.locator('.fe-member', { hasText: nameA });
    await row.locator('button:has-text("Visit hideout")').click({ timeout: 5000 });
    await B.waitFor(
      "A's hideout",
      (owner) => {
        const s = window.__foe.store.get();
        return s.zone === 'hideout' && s.hud?.zoneOwnerName === owner && !s.hud.zoneIsOwn;
      },
      nameA,
      10_000,
    );
    await B.page.evaluate(() => window.__foe.store.actions.closeAllPanels());
    await A.waitFor('B in the hideout', () => (window.__foe.store.get().hud?.allies.length ?? 0) === 1, undefined, 8000);
    await sleep(800);
    await A.shot('04-hideout-together-A');
    await B.shot('04-hideout-together-B');
    const bPortal = await B.state('s => s.hud.portal');
    assert(bPortal && bPortal.remaining === 8, `B should see A's portal with 8 uses, got ${JSON.stringify(bPortal)}`);
    return 'both in A\'s hideout, B sees 8 portals';
  });

  await step("B clicks Rook in A's hideout and buys Kindling with its own Scrap", async () => {
    await closePanels(B);
    const before = { B: await currencyOf(B), A: await currencyOf(A) };
    const at = await walkUntilOnScreen(B, () => propOnScreen(B, 'merchant', 14), 'Rook');
    await clickWorld(B, at, 'Rook');
    await B.waitFor('the merchant panel', () => window.__foe.store.get().openPanels.includes('merchant'), undefined, 5000);
    await B.page.waitForSelector('.fe-merchant .fe-offer', { timeout: 5000 });
    const offer = B.page.locator('.fe-offer', { hasText: 'Kindling' }).first();
    await offer.locator('button:has-text("Buy")').click({ timeout: 5000 });
    await B.waitFor(
      'the Kindling in the backpack',
      (n) => {
        let k = 0;
        for (const e of window.__foe.store.get().character?.backpack.entries ?? []) if (e.item.kind === 'currency' && e.item.currencyId === 'kindling') k += e.item.count;
        return k === n;
      },
      (before.B.kindling ?? 0) + 1,
      8000,
    );
    await sleep(300);
    await settlePanels(B);
    await B.shot('04a-merchant-B');
    const after = { B: await currencyOf(B), A: await currencyOf(A) };
    assert(after.B.scrap === before.B.scrap - 3, `B should have paid 3 Scrap: ${before.B.scrap} → ${after.B.scrap}`);
    assert(JSON.stringify(after.A) === JSON.stringify(before.A), `A's currency must not change when B buys: ${JSON.stringify(before.A)} → ${JSON.stringify(after.A)}`);
    const zone = await B.state('s => ({ zone: s.zone, owner: s.hud?.zoneOwnerName })');
    assert(zone.zone === 'hideout' && zone.owner === nameA, `B should still be in A's hideout: ${JSON.stringify(zone)}`);
    await closePanels(B);
    return `B paid 3 Scrap (${before.B.scrap} → ${after.B.scrap}), Kindling ${before.B.kindling ?? 0} → ${after.B.kindling}`;
  });

  await step('stash search: A clicks the stash, searches, matches glow and the rest dims; Esc clears it', async () => {
    await closePanels(A);
    const at = await walkUntilOnScreen(A, () => propOnScreen(A, 'stash', 12), 'the stash');
    await clickWorld(A, at, 'the stash');
    await A.waitFor('the stash panel', () => window.__foe.store.get().openPanels.includes('stash'), undefined, 5000);
    await A.page.waitForSelector('.fe-search__input', { timeout: 5000 });
    await A.page.fill('.fe-search__input', 'scrap');
    await A.page.waitForSelector('.fe-search--active', { timeout: 3000 });
    // The grid items re-render a frame after the search box: wait for the highlight itself.
    await A.waitFor('the backpack dimmed', () => document.querySelectorAll('.fe-grid[data-drop="backpack"] .fe-item--dim').length > 0, undefined, 3000);
    const marks = await A.eval(() => {
      const items = [...document.querySelectorAll('.fe-grid[data-drop="backpack"] .fe-item')];
      return {
        dim: items.filter((e) => e.classList.contains('fe-item--dim')).length,
        lit: items.filter((e) => !e.classList.contains('fe-item--dim')).map((e) => e.getAttribute('data-kind')),
        count: document.querySelector('.fe-search__count')?.textContent ?? '',
      };
    });
    assert(marks.dim > 0 && marks.lit.length >= 1 && marks.lit.every((k) => k === 'currency'), `search marks look wrong: ${JSON.stringify(marks)}`);
    await settlePanels(A);
    await A.shot('04b-stash-search-A');
    await A.page.focus('.fe-search__input');
    await A.page.keyboard.press('Escape');
    await A.waitFor('the search cleared', () => !document.querySelector('.fe-search--active'), undefined, 3000);
    await closePanels(A);
    return `"scrap": ${marks.count.trim()} (${marks.dim} dimmed)`;
  });

  await step('A drags its robe onto the floor; B clicks it (walking there) and picks it up', async () => {
    await closePanels(A);
    await closePanels(B);
    const robe = (await itemsOf(A, 'equipment')).find((i) => i.baseId === 'ashenRobe');
    assert(robe, 'A has no Ashen Robe equipped');
    await A.page.keyboard.press('i');
    const el = A.page.locator(`.fe-item[data-uid="${robe.uid}"]`).first();
    await el.waitFor({ timeout: 5000 });
    const box = await el.boundingBox();
    // Release over the world, left of the docked inventory.
    const to = { x: Math.round(VW * 0.28), y: Math.round(VH * 0.5) };
    assert(await onWorld(A, to), 'the drop point is covered by UI');
    await A.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await A.page.mouse.down();
    for (let k = 1; k <= 12; k++) {
      await A.page.mouse.move(box.x + box.width / 2 + ((to.x - box.x - box.width / 2) * k) / 12, box.y + box.height / 2 + ((to.y - box.y - box.height / 2) * k) / 12);
      await sleep(16);
    }
    await A.page.mouse.up();
    await A.waitFor('the robe gone from A', () => !window.__foe.store.get().character?.equipment.chest, undefined, 5000);
    await closePanels(A);
    const dropId = await B.eval(async () => {
      for (let i = 0; i < 50; i++) {
        const d = window.__foe.world?.view.drops.find((q) => q.spec.owner === 0 && /Ashen Robe/.test(q.spec.label));
        if (d) return d.id;
        await new Promise((r) => setTimeout(r, 100));
      }
      return -1;
    });
    assert(dropId >= 0, 'B never saw the public drop');
    await sleep(700); // let the toss land
    await A.shot('04c-dropped-A');
    const at = await walkUntilOnScreen(B, () => B.eval((id) => window.__foe.dropOnScreen(id), dropId), 'the robe on the floor');
    await clickWorld(B, at, 'the robe');
    await B.waitFor('the robe in B\'s backpack', () => {
      const ch = window.__foe.store.get().character;
      return !!ch && ch.backpack.entries.some((e) => e.item.kind === 'equipment' && e.item.baseId === 'ashenRobe');
    }, undefined, 10_000);
    await A.waitFor('the drop gone for A', (id) => !window.__foe.world.view.drops.some((d) => d.id === id), dropId, 5000);
    await B.shot('04d-picked-up-B');
    return `drop ${dropId}: A → floor → B (clicked at ${Math.round(at.x)},${Math.round(at.y)})`;
  });

  await step('trade: A asks from the party panel, B accepts the card; robe ↔ currency, both accept', async () => {
    await closePanels(A);
    await closePanels(B);
    await A.page.keyboard.press('p');
    await A.page.locator('.fe-member', { hasText: nameB }).locator('button:has-text("Trade")').click({ timeout: 5000 });
    await B.page.waitForSelector('.fe-invite-card--trade', { timeout: 8000 });
    await sleep(400); // the card slides in (0.3 s)
    await B.shot('04e-trade-request-B');
    await B.page.click('.fe-invite-card--trade button:has-text("Trade")');
    for (const p of [A, B]) {
      await p.waitFor('the trade window', () => !!window.__foe.store.get().trade && window.__foe.store.get().openPanels.includes('trade'), undefined, 8000);
      await p.page.waitForSelector('.fe-trade', { timeout: 5000 });
    }
    const heldBefore = sumHoldings(await holdingsOf(A), await holdingsOf(B));
    const robeB = (await itemsOf(B)).find((i) => i.baseId === 'ashenRobe');
    // A keeps its Scrap and Essences: the bench step below pays with them.
    const spare = ['threatGlyph', 'mapDust', 'kindling', 'solvent', 'seal'];
    const coinA = (await itemsOf(A)).filter((i) => i.kind === 'currency' && spare.includes(i.currencyId)).sort((a, b) => spare.indexOf(a.currencyId) - spare.indexOf(b.currencyId))[0];
    assert(robeB && coinA, 'nothing to trade');
    await B.page.locator(`.fe-grid[data-drop="backpack"] .fe-item[data-uid="${robeB.uid}"]`).click({ modifiers: ['Control'] });
    await A.page.locator(`.fe-grid[data-drop="backpack"] .fe-item[data-uid="${coinA.uid}"]`).click({ modifiers: ['Control'] });
    for (const p of [A, B]) {
      await p.waitFor('both offers', () => {
        const t = window.__foe.store.get().trade;
        return !!t && t.yourItems.length === 1 && t.theirItems.length === 1;
      }, undefined, 5000);
    }
    await settlePanels(A);
    await A.shot('04f-trade-A');
    for (const p of [A, B]) {
      await p.waitFor('the accept lock to pass', () => {
        const b = document.querySelector('.fe-accept');
        return !!b && !b.disabled;
      }, undefined, 6000);
      await p.page.click('.fe-accept');
    }
    for (const p of [A, B]) await p.waitFor('the trade to complete', () => !window.__foe.store.get().trade, undefined, 8000);
    await A.waitFor('the robe with A', () => window.__foe.store.get().character.backpack.entries.some((e) => e.item.kind === 'equipment' && e.item.baseId === 'ashenRobe'), undefined, 5000);
    await B.waitFor('the currency with B', (cur) => window.__foe.store.get().character.backpack.entries.some((e) => e.item.kind === 'currency' && e.item.currencyId === cur.currencyId), coinA, 5000);
    await sleep(500); // both 'character' pushes settled
    const heldAfter = sumHoldings(await holdingsOf(A), await holdingsOf(B));
    const diff = holdingsDiff(heldBefore, heldAfter);
    assert(diff.length === 0, `items were created or lost by the trade: ${diff.join('; ')}`);
    const robeStillB = (await itemsOf(B)).some((i) => i.baseId === 'ashenRobe');
    assert(!robeStillB, 'the robe is still in B\'s backpack after the trade');
    await closePanels(A);
    await closePanels(B);
    return `robe → ${nameA}, ${coinA.count}× ${coinA.currencyId} → ${nameB}; ${Object.keys(heldAfter).length} kinds of items conserved`;
  });

  await step('crafting bench: A clicks the anvil, places the wand, crafts a recipe and clears it again', async () => {
    await closePanels(A);
    const at = await walkUntilOnScreen(A, () => propOnScreen(A, 'anvil', 8), 'the anvil');
    await clickWorld(A, at, 'the anvil');
    await A.waitFor('the bench panel', () => window.__foe.store.get().openPanels.includes('craftingBench'), undefined, 5000);
    await A.page.waitForSelector('.fe-bench', { timeout: 5000 });
    const wand = (await itemsOf(A, 'equipment')).find((i) => i.kind === 'equipment' && /Wand/i.test(i.baseId ?? ''));
    assert(wand, 'A has no wand equipped');
    await A.page.locator(`[data-drop="equip"] .fe-item[data-uid="${wand.uid}"]`).first().click({ modifiers: ['Control'] });
    await A.waitFor('the wand on the bench', (uid) => window.__foe.store.get().benchItemUid === uid, wand.uid, 5000);
    const go = A.page.locator('.fe-recipe__go:not([disabled])').first();
    try {
      await go.waitFor({ timeout: 5000 });
    } catch {
      const why = await A.eval(() => [...document.querySelectorAll('.fe-recipe__why')].map((e) => e.textContent).slice(0, 4));
      throw new Error(`no bench recipe is available: ${JSON.stringify(why)}`);
    }
    await go.click();
    await A.waitFor('a crafted affix on the wand', () => !!window.__foe.store.get().character.equipment.mainHand?.affixes.some((a) => a.crafted), undefined, 8000);
    await sleep(400);
    await settlePanels(A);
    await A.shot('04g-bench-A');
    await A.page.click('.fe-bench__clear');
    await A.page.click('.fe-dialog__actions button:has-text("Clear it")');
    await A.waitFor('the crafted affix gone', () => !window.__foe.store.get().character.equipment.mainHand?.affixes.some((a) => a.crafted), undefined, 8000);
    await closePanels(A);
    return 'bench recipe crafted and cleared';
  });

  await step('A and B each click the portal in the world (8 → 6 portals)', async () => {
    const atA = await clickPortal(A);
    await A.waitFor('the map zone', () => window.__foe.store.get().zone === 'map', undefined, 25_000);
    await A.eval(() => window.__foe.bot.enable({ returnPortal: false }));
    await B.waitFor('7 portals on the hideout readout', () => window.__foe.store.get().hud?.portal?.remaining === 7, undefined, 5000);
    const atB = await clickPortal(B);
    await B.waitFor('the map zone', () => window.__foe.store.get().zone === 'map', undefined, 25_000);
    await B.eval(() => window.__foe.bot.enable({ returnPortal: false }));
    await A.waitFor('the HUD run readout', () => !!window.__foe.store.get().hud?.run, undefined, 8000);
    await B.waitFor('the HUD run readout', () => !!window.__foe.store.get().hud?.run, undefined, 8000);
    await A.waitFor('6 portals left', () => window.__foe.store.get().hud?.run?.portalsRemaining === 6, undefined, 5000);
    await B.waitFor('6 portals left', () => window.__foe.store.get().hud?.run?.portalsRemaining === 6, undefined, 5000);
    const run = await A.state('s => ({ map: s.hud.run.mapName, tier: s.hud.run.tier, left: s.hud.run.portalsRemaining, total: s.hud.run.portalsTotal })');
    await A.waitFor('B in the map (party frame)', (n) => window.__foe.store.get().hud?.allies.some((a) => a.name === n), nameB, 5000);
    await B.waitFor('A in the map (party frame)', (n) => window.__foe.store.get().hud?.allies.some((a) => a.name === n), nameA, 5000);
    return `A clicked at ${Math.round(atA.x)},${Math.round(atA.y)}, B at ${Math.round(atB.x)},${Math.round(atB.y)}; ${run.map} T${run.tier}: ${run.left}/${run.total} portals`;
  });

  const xpBefore = {
    A: await A.state('s => ({ level: s.character.level, xp: s.character.xp })'),
    B: await B.state('s => ({ level: s.character.level, xp: s.character.xp })'),
  };
  await startDropSampler(A);
  await startDropSampler(B);

  await A.eval(() => (window.__e2eEquipArmed = true));
  await B.eval(() => (window.__e2eEquipArmed = true));

  await step(`bots fight for ${FIGHT_SECONDS} s (screenshots, drop ownership sampling, until an equipment drop)`, async () => {
    const shotAt = new Set([4, Math.round(FIGHT_SECONDS * 0.45), Math.max(6, FIGHT_SECONDS - 3)]);
    // Loot is random: fight on (up to 150 s more) until both players have had drops to check and one of them an own
    // equipment drop for the click-pickup check.
    const limit = FIGHT_SECONDS + 150;
    for (let sec = 1; sec <= limit; sec++) {
      await sleep(1000);
      const [da, db] = [await dropReport(A), await dropReport(B)];
      // Once one player stands on its equipment, the other stops looking for one.
      if (da.equipTest || db.equipTest) {
        await A.eval(() => (window.__e2eEquipArmed = false));
        await B.eval(() => (window.__e2eEquipArmed = false));
      }
      if (sec >= FIGHT_SECONDS && da.seen > 0 && db.seen > 0 && (da.equipTest || db.equipTest)) break;
      if (shotAt.has(sec)) {
        await A.shot(`05-fight-${String(sec).padStart(2, '0')}s-A`);
        await B.shot(`05-fight-${String(sec).padStart(2, '0')}s-B`);
      }
      const dead = await A.state('s => s.hud?.dead') || await B.state('s => s.hud?.dead');
      if (dead && sec % 5 === 0) log(`note: a player is dead at ${sec}s (allies keep fighting)`);
    }
    const run = await A.state('s => s.hud?.run && ({ wave: s.hud.run.wave, kills: s.hud.run.kills, alive: s.hud.run.monstersAlive, phase: s.hud.run.phase })');
    const statsA = await A.eval(() => window.__foe.stats());
    const statsB = await B.eval(() => window.__foe.stats());
    log(`run: ${JSON.stringify(run)}  fps A ${statsA.fps.toFixed(0)} / B ${statsB.fps.toFixed(0)}  rtt A ${statsA.rtt.toFixed(0)} ms`);
    assert(run && run.kills > 0, `the party should have killed monsters, run: ${JSON.stringify(run)}`);
    return `wave ${run.wave}, ${run.kills} kills`;
  });

  await step('equipment is click-only: standing on an own equipment drop leaves it; clicking its label picks it up', async () => {
    const [da, db] = [await dropReport(A), await dropReport(B)];
    const p = da.equipTest ? A : db.equipTest ? B : null;
    assert(p, `no own equipment dropped for either player (A saw ${da.equipSeen}, B saw ${db.equipSeen}); loot is random, run again`);
    const test = (p === A ? da : db).equipTest;
    const equipBefore = await p.eval(() => window.__foe.store.get().character.backpack.entries.filter((e) => e.item.kind === 'equipment').length);
    await p.waitFor(
      'standing on the equipment drop',
      (id) => {
        const w = window.__foe.world;
        const me = w.view.players.find((q) => q.id === w.localPlayerId);
        const d = w.view.drops.find((q) => q.id === id);
        return !!me && !!d && Math.hypot(me.x - d.x, me.y - d.y) < 6;
      },
      test.id,
      20_000,
    );
    await sleep(1500);
    const still = await p.eval((id) => window.__foe.world.view.drops.some((d) => d.id === id), test.id);
    assert(still, `${p.label}: the equipment drop "${test.label}" was collected without a click`);
    await p.shot(`05c-equipment-underfoot-${p.label}`);
    // Now a real click on it (the label or sprite, like a player).
    const at = await p.eval((id) => window.__foe.dropOnScreen(id), test.id);
    assert(at && (await onWorld(p, at)), `${p.label}: the equipment drop is not clickable on screen (${JSON.stringify(at)})`);
    await clickWorld(p, at, 'the equipment drop');
    await p.waitFor('the drop gone', (id) => !window.__foe.world.view.drops.some((d) => d.id === id), test.id, 8000);
    await p.waitFor('one more equipment item in the backpack', (n) => window.__foe.store.get().character.backpack.entries.filter((e) => e.item.kind === 'equipment').length === n + 1, equipBefore, 8000);
    await p.eval(() => window.__foe.bot.enable({ collect: true, hold: null }));
    return `${p.label} stood on "${test.label}" for 1.5 s (still on the ground), then clicked it into the backpack`;
  });

  await step('both players gained XP (shared XP)', async () => {
    const after = {
      A: await A.state('s => ({ level: s.character.level, xp: s.character.xp })'),
      B: await B.state('s => ({ level: s.character.level, xp: s.character.xp })'),
    };
    const gained = (b, a) => a.level > b.level || a.xp > b.xp;
    assert(gained(xpBefore.A, after.A), `A gained no XP: ${JSON.stringify(xpBefore.A)} → ${JSON.stringify(after.A)}`);
    assert(gained(xpBefore.B, after.B), `B gained no XP: ${JSON.stringify(xpBefore.B)} → ${JSON.stringify(after.B)}`);
    return `A L${after.A.level} ${after.A.xp} xp, B L${after.B.level} ${after.B.xp} xp`;
  });

  await step("B's link drops for a moment: the client resumes in place (same instance, no fade, no toast)", async () => {
    const before = await B.eval(() => ({
      instance: window.__foe.session.zone.instanceId,
      stats: window.__foe.stats(),
      toasts: window.__foe.store.get().toasts.length,
    }));
    await B.eval(() => window.__foe.dropConnection());
    await B.waitFor('the reconnecting state', () => window.__foe.store.get().connection !== 'online', undefined, 3000);
    await B.waitFor('the link back', () => window.__foe.store.get().connection === 'online', undefined, 10_000);
    await B.waitFor('the local player back in the replica', () => {
      const w = window.__foe.world;
      return !!w && w.view.players.some((p) => p.id === w.localPlayerId);
    }, undefined, 5000);
    const after = await B.eval(() => ({
      instance: window.__foe.session.zone.instanceId,
      zone: window.__foe.store.get().zone,
      stats: window.__foe.stats(),
      fade: document.getElementById('fade')?.classList.contains('foe-fade--on') ?? false,
      badToasts: window.__foe.store.get().toasts.filter((t) => t.tone === 'bad').map((t) => t.text),
    }));
    assert(after.instance === before.instance && after.zone === 'map', `B should be back in the same map instance, got ${JSON.stringify(after)}`);
    assert(after.stats.zoneResumes === before.stats.zoneResumes + 1, `expected a resume, stats ${JSON.stringify(after.stats)}`);
    assert(after.stats.zoneEntries === before.stats.zoneEntries, 'the resume must not count as a zone entry (fade + reset)');
    assert(!after.fade, 'the zone fade must stay off on a resume');
    assert(after.badToasts.length === 0, `no error toasts expected, got ${after.badToasts.join('; ')}`);
    await sleep(1500);
    await B.shot('05b-resumed-B');
    return `instance ${after.instance} resumed (resumes ${after.stats.zoneResumes}, entries ${after.stats.zoneEntries})`;
  });

  await step('each client only ever saw its own drops (instanced loot)', async () => {
    const [da, db] = [await dropReport(A), await dropReport(B)];
    assert(da.foreign === 0, `A saw ${da.foreign} foreign drops: ${da.labels.join('; ')}`);
    assert(db.foreign === 0, `B saw ${db.foreign} foreign drops: ${db.labels.join('; ')}`);
    assert(da.foreignEvents === 0, `A got ${da.foreignEvents} drop/pickup events for others: ${da.eventLabels.join('; ')}`);
    assert(db.foreignEvents === 0, `B got ${db.foreignEvents} drop/pickup events for others: ${db.eventLabels.join('; ')}`);
    if (da.seen === 0 || db.seen === 0) log(`note: few drops this run (A ${da.seen}, B ${db.seen}); ownership checked on what dropped`);
    return `A saw ${da.seen} own drops (max ${da.max} at once) + ${da.events} own drop events, B saw ${db.seen} (max ${db.max}) + ${db.events}`;
  });

  await step("B dies, returns from the death screen into A's hideout next to the portals, and clicks back in (6 → 5)", async () => {
    await B.eval(() => window.__foe.bot.enable({ charge: true, collect: false }));
    await B.waitFor('B to fall', () => window.__foe.store.get().hud?.dead === true, undefined, 120_000);
    await B.eval(() => window.__foe.bot.disable());
    await B.page.waitForSelector('.fe-death button:has-text("Return to hideout")', { timeout: 5000 });
    await sleep(700);
    await B.shot('05d-fallen-B');
    const note = await B.eval(() => document.querySelector('.fe-death')?.textContent ?? '');
    assert(/6 left/.test(note), `the death screen should say that coming back uses a portal (6 left): ${note}`);
    await B.page.click('.fe-death button:has-text("Return to hideout")');
    await B.waitFor(
      "A's hideout (the map owner's)",
      (owner) => {
        const s = window.__foe.store.get();
        return s.zone === 'hideout' && s.hud?.zoneOwnerName === owner && !s.isOwnHideout && !s.hud.dead;
      },
      nameA,
      10_000,
    );
    await B.waitFor('the local player in the hideout replica', () => {
      const w = window.__foe.world;
      return !!w && w.view.players.some((q) => q.id === w.localPlayerId) && w.view.props.some((q) => q.kind === 'portal');
    }, undefined, 5000);
    const dist = await distanceToProp(B, 'portal');
    assert(dist >= 0 && dist <= 60, `B should respawn next to the portals, but stands ${Math.round(dist)} units away`);
    const summary = await B.state('s => s.runSummary && s.runSummary.result');
    assert(summary === 'failed', `B's run summary should say failed (died), got ${summary}`);
    await B.eval(() => window.__foe.store.actions.dismissRunSummary());
    await B.waitFor('6 portals on the readout', () => window.__foe.store.get().hud?.portal?.remaining === 6, undefined, 5000);
    await sleep(400);
    await B.shot('05e-respawned-B');
    await clickPortal(B);
    await B.waitFor('the map again', () => window.__foe.store.get().zone === 'map', undefined, 25_000);
    await B.waitFor('5 portals left', () => window.__foe.store.get().hud?.run?.portalsRemaining === 5, undefined, 8000);
    await A.waitFor('5 portals left (A)', () => window.__foe.store.get().hud?.run?.portalsRemaining === 5, undefined, 8000);
    await B.eval(() => window.__foe.bot.enable({ returnPortal: false, charge: false, collect: true }));
    return `respawned ${Math.round(dist)} units from the portal in ${nameA}'s hideout; back in with 5 portals`;
  });

  await step('A leaves the map (run summary) and re-enters through the portal (5 → 4)', async () => {
    await A.eval(() => window.__foe.bot.disable());
    const r = await A.eval(() => window.__foe.send({ c: 'leaveMap' }));
    assert(r.ok, `leaveMap failed: ${r.error}`);
    await A.waitFor('home with a run summary', () => {
      const s = window.__foe.store.get();
      return s.zone === 'hideout' && !!s.runSummary && s.isOwnHideout;
    }, undefined, 10_000);
    await sleep(600);
    await A.shot('06-run-summary-A');
    const summary = await A.state('s => s.runSummary');
    await A.eval(() => window.__foe.store.actions.dismissRunSummary());
    await A.waitFor('the portal readout (5 left)', () => window.__foe.store.get().hud?.portal?.remaining === 5, undefined, 8000);
    await A.eval(() => window.__foe.bot.enable({ returnPortal: false }));
    await A.waitFor('the map again', () => window.__foe.store.get().zone === 'map', undefined, 25_000);
    await A.waitFor('4 portals left', () => window.__foe.store.get().hud?.run?.portalsRemaining === 4, undefined, 8000);
    await sleep(3000);
    await A.shot('07-reentered-A');
    return `summary: ${summary.result}, ${summary.kills} kills, ${summary.xpGained} xp; back in with 4 portals`;
  });

  await step("both leave the map: A lands home, B in A's hideout (the map owner's) and walks home from the party panel", async () => {
    await A.eval(() => window.__foe.bot.disable());
    await B.eval(() => window.__foe.bot.disable());
    const ra = await A.eval(() => window.__foe.send({ c: 'leaveMap' }));
    const rb = await B.eval(() => window.__foe.send({ c: 'leaveMap' }));
    assert(ra.ok && rb.ok, `leaveMap failed: A ${ra.error ?? 'ok'}, B ${rb.error ?? 'ok'}`);
    const home = () => {
      const s = window.__foe.store.get();
      return s.zone === 'hideout' && s.isOwnHideout && !!s.hud;
    };
    await A.waitFor('own hideout', home, undefined, 10_000);
    await B.waitFor(
      "A's hideout",
      (owner) => {
        const s = window.__foe.store.get();
        return s.zone === 'hideout' && s.hud?.zoneOwnerName === owner && !s.isOwnHideout;
      },
      nameA,
      10_000,
    );
    await B.eval(() => window.__foe.store.actions.dismissRunSummary());
    await B.page.keyboard.press('p');
    await B.page.locator('.fe-member', { hasText: nameB }).locator('button:has-text("Go home")').click({ timeout: 5000 });
    await B.waitFor('own hideout', home, undefined, 10_000);
    await B.eval(() => window.__foe.store.actions.closeAllPanels());
    await sleep(800);
    await B.shot('08-home-B');
    return "A home; B via A's hideout, then home";
  });

  await step("both go back into A's map before the update, clicking the portal (4 → 2 portals)", async () => {
    await B.page.keyboard.press('p');
    await B.page.locator('.fe-member', { hasText: nameA }).locator('button:has-text("Visit hideout")').click({ timeout: 5000 });
    await B.waitFor("A's hideout", (owner) => window.__foe.store.get().hud?.zoneOwnerName === owner, nameA, 10_000);
    await closePanels(B);
    await clickPortal(B);
    await B.waitFor('the map', () => window.__foe.store.get().zone === 'map', undefined, 25_000);
    await A.waitFor('3 portals left', () => window.__foe.store.get().hud?.portal?.remaining === 3, undefined, 8000);
    await clickPortal(A);
    await A.waitFor('the map', () => window.__foe.store.get().zone === 'map', undefined, 25_000);
    for (const p of [A, B]) await p.waitFor('2 portals left', () => window.__foe.store.get().hud?.run?.portalsRemaining === 2, undefined, 8000);
    // Fight a little so the restart has a run in progress to throw away.
    await A.eval(() => window.__foe.bot.enable({ returnPortal: false }));
    await B.eval(() => window.__foe.bot.enable({ returnPortal: false }));
    await sleep(6000);
    await A.eval(() => window.__foe.bot.disable());
    await B.eval(() => window.__foe.bot.disable());
    return 'A and B in the map, 2 portals left';
  });

  await step('server update mid-map: calm reconnect screen, then both are back INSIDE the map, with the party and 2 portals', async () => {
    const snap = (p) => p.state(`s => ({
      level: s.character.level,
      party: (s.party?.members ?? []).map((m) => m.name).sort(),
    })`);
    const before = { A: await snap(A), B: await snap(B) };
    const mapBefore = await A.state('s => s.hud.run.mapName');
    assert(before.A.party.length === 2 && before.B.party.length === 2, `expected a party of two before the update: ${JSON.stringify(before)}`);
    outage = true;
    await stopGameServer(); // SIGTERM: a 2 s drain (announcement), then sockets closed with 4004, saves flushed
    for (const p of [A, B]) {
      await p.waitFor(
        'the "Server updating" screen',
        (text) => {
          const s = window.__foe.store.get();
          return s.screen === 'disconnected' && s.connection === 'reconnecting' && s.error === text;
        },
        'Server updating — reconnecting…',
        15_000,
      );
    }
    const announced = await A.eval(() => window.__foe.store.get().chat.some((l) => /Server update/i.test(l.text)));
    assert(announced, 'A never saw the server update announcement in chat');
    const kept = serverLog.some((l) => /game stopped/.test(l) && /mapsKept=1/.test(l));
    assert(kept, `the server did not keep the open map on shutdown:\n${serverLog.filter((l) => /stopp|drain/.test(l)).join('\n')}`);
    await sleep(1500);
    await A.shot('09-server-updating-A');
    await startGameServer(port);
    const inMap = () => {
      const s = window.__foe.store.get();
      return s.connection === 'online' && s.screen === 'game' && s.zone === 'map' && !!s.hud?.run;
    };
    await A.waitFor('A back inside the restored map', inMap, undefined, 30_000);
    await B.waitFor('B back inside the restored map', inMap, undefined, 30_000);
    outage = false;
    for (const p of [A, B]) {
      await p.waitFor('the party back', () => (window.__foe.store.get().party?.members.length ?? 0) === 2, undefined, 8000);
      await p.waitFor('2 portals kept', () => window.__foe.store.get().hud?.run?.portalsRemaining === 2, undefined, 8000);
      await p.waitFor('the restart toast', () => window.__foe.store.get().toasts.some((t) => /fight restarted/.test(t.text)), undefined, 8000);
    }
    const ids = { A: await A.eval(() => window.__foe.session.zone.instanceId), B: await B.eval(() => window.__foe.session.zone.instanceId) };
    assert(ids.A === ids.B, `A and B should be in the same map instance: ${JSON.stringify(ids)}`);
    const mapAfter = await A.state('s => s.hud.run.mapName');
    assert(mapAfter === mapBefore, `a different map came back: ${mapBefore} → ${mapAfter}`);
    await A.waitFor('B in the map (party frame)', (n) => window.__foe.store.get().hud?.allies.some((a) => a.name === n), nameB, 8000);
    const after = { A: await snap(A), B: await snap(B) };
    assert(JSON.stringify(after) === JSON.stringify(before), `state changed across the update: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    await sleep(1200);
    await A.shot('10-reconnected-A');
    await B.shot('10-reconnected-B');
    return `party of 2 kept, both back in ${mapAfter} (${ids.A}) with 2 portals; A L${after.A.level}, B L${after.B.level}`;
  });

  await step('after the update: the portal still works and leaving lands in the hideouts as usual', async () => {
    await B.eval(() => window.__foe.send({ c: 'leaveMap' }));
    await B.waitFor("A's hideout", (owner) => {
      const s = window.__foe.store.get();
      return s.zone === 'hideout' && s.hud?.zoneOwnerName === owner;
    }, nameA, 10_000);
    await B.eval(() => window.__foe.store.actions.dismissRunSummary());
    await B.waitFor('2 portals on the readout', () => window.__foe.store.get().hud?.portal?.remaining === 2, undefined, 8000);
    await clickPortal(B);
    await B.waitFor('the map', () => window.__foe.store.get().zone === 'map', undefined, 25_000);
    for (const p of [A, B]) await p.waitFor('1 portal left', () => window.__foe.store.get().hud?.run?.portalsRemaining === 1, undefined, 8000);
    for (const p of [A, B]) await p.eval(() => window.__foe.send({ c: 'leaveMap' }));
    await A.waitFor('home', () => {
      const s = window.__foe.store.get();
      return s.zone === 'hideout' && s.isOwnHideout && !!s.hud;
    }, undefined, 10_000);
    await B.waitFor("A's hideout", (owner) => window.__foe.store.get().hud?.zoneOwnerName === owner, nameA, 10_000);
    for (const p of [A, B]) await p.eval(() => window.__foe.store.actions.dismissRunSummary());
    return 'B re-entered through the restored portal (2 → 1); both left to the map owner\'s hideout';
  });

  await step('a stale bundle after a deploy (undecodable snapshots): one reload back into the game, never a reload loop', async () => {
    const inGame = (zone) => {
      const s = window.__foe?.store.get();
      return !!s && s.screen === 'game' && s.connection === 'online' && s.zone === zone && !!s.hud;
    };
    const guardReleased = () => !sessionStorage.getItem('foe.reloadedForProtocol');
    const zone = await A.state('s => s.zone');
    const level = await A.state('s => s.character.level');
    staleSnapshots = true;
    // 1. This page cannot read the new world format: it reloads once and comes straight back into the character.
    let navs = A.navigations;
    await A.eval(() => window.__foe.skewSnapshots('once'));
    await A.waitForNavigations(navs + 1, 'the automatic reload');
    await A.waitFor('A back in the game after the reload', inGame, zone, 30_000);
    await A.waitFor('the reload guard released (the world reads fine)', guardReleased, undefined, 10_000);
    assert(A.navigations === navs + 1, `expected exactly one reload, saw ${A.navigations - navs}`);
    const resumedLevel = await A.state('s => s.character.level');
    assert(resumedLevel === level, `the reload came back as another character (level ${level} → ${resumedLevel})`);
    // 2. The reload does not help (a cache keeps serving the old bundle): explain, do not loop.
    navs = A.navigations;
    await A.eval(() => window.__foe.skewSnapshots('always'));
    await A.waitForNavigations(navs + 1, 'the automatic reload');
    await A.waitFor(
      'the stale-bundle explanation',
      () => {
        const s = window.__foe?.store.get();
        return !!s && s.screen === 'disconnected' && s.connection === 'offline' && /new version/i.test(s.error ?? '');
      },
      undefined,
      30_000,
    );
    await sleep(2500);
    assert(A.navigations === navs + 1, `the client reloaded ${A.navigations - navs} times: a reload loop`);
    await A.shot('11-stale-bundle-A');
    // 3. The new bundle is served ("Try again" reloads): back into the game, and the guard re-arms for the next deploy.
    await A.eval(() => window.__foe.skewSnapshots('off'));
    navs = A.navigations;
    await A.page.click('.fe-disc button:has-text("Try again")');
    await A.waitForNavigations(navs + 1, 'the reload from "Try again"');
    await A.waitFor('A back in the game', inGame, zone, 30_000);
    await A.waitFor('the reload guard released', guardReleased, undefined, 10_000);
    staleSnapshots = false;
    const party = await A.state('s => s.party?.members.length ?? 0');
    assert(party === 2, `A lost the party across the reloads (${party} members)`);
    return `1 reload + resume; a second failure explained (no loop); "Try again" back in the ${zone}`;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Wave 5 (GAME_SPEC §12 special stash tabs, §13 player debuffs, §14 bestiary per map type), played by A alone
// ---------------------------------------------------------------------------------------------------------------

/**
 * The frozen contract tables and sim constants the wave-5 checks use, loaded from the sources themselves (through
 * tsx, like the server), so a table that grows (they are append-only) is never mislabelled here.
 */
let C = null;
async function loadContracts() {
  if (C) return C;
  const { tsImport } = await import('tsx/esm/api');
  const [content, sim, bestiary, constants] = await Promise.all([
    tsImport('../src/contracts/content.ts', import.meta.url),
    tsImport('../src/contracts/sim.ts', import.meta.url),
    tsImport('../src/contracts/bestiary.ts', import.meta.url),
    tsImport('../src/sim/constants.ts', import.meta.url),
  ]);
  C = {
    monsterKinds: [...content.MONSTER_KINDS],
    projectileKinds: [...sim.PROJECTILE_KINDS],
    rosters: bestiary.THEME_ROSTER,
    debuffIds: [...bestiary.PLAYER_DEBUFFS],
    stackCaps: { bleeding: constants.BLEED_MAX_STACKS, withered: constants.WITHER_MAX_STACKS },
    playerRadius: constants.PLAYER_RADIUS,
    pullSteps: Math.round(constants.PULL_TIME * sim.SIM_HZ),
  };
  return C;
}

/**
 * What each new map type must show in its smoke (GAME_SPEC §13–§14). `bait`: the kinds the autopilot stands in
 * reach of (bot option `bait`: it never shoots them nor dodges their shots and hazards) until every debuff in
 * `require` has reached the HUD and a root or freeze has been checked for fairness; after that it fights normally.
 */
const THEME_CHECKS = {
  rimedOssuary: { name: 'Rimed Ossuary', tag: 'ossuary', bait: ['frostWeaver', 'glacialWisp'], require: ['chilled'] },
  ironColiseum: {
    name: 'Iron Coliseum', tag: 'coliseum', bait: ['chainThrall', 'tarSlinger', 'ironCrossbowman', 'chainmaster'], require: ['bleeding', 'rooted'],
  },
};
/** Longest a map may take to show what THEME_CHECKS asks (s; the Coliseum's thralls come from wave 2). */
const BAIT_BUDGET_SECONDS = 170;
/**
 * GAME_SPEC §13 "a debuff never comes from an invisible source": what may explain a root (by its RootSource; 'bone'
 * or unknown accepts any of them) or a freeze — a projectile (see ROOT_PROJECTILE_REACH) or ground that covers where
 * the server says it caught her (its radius + her body).
 */
const ROOT_EVIDENCE = { web: ['webShot'], chain: ['chainHook'], tar: ['tarPool', 'tarGlob'] };
const ROOT_PROJECTILES = ['webShot', 'chainHook', 'tarGlob'];
const ROOT_AREAS = ['tarPool'];
const FREEZE_AREAS = ['icePrison', 'wispBurst'];
/**
 * A root projectile explains a root when it was drawn flying at her: its drawn path — each frame's segment from the
 * older bracketing snapshot to the newer, carried on along its velocity for PROJECTILE_TAIL_S — passes this close to
 * where the server says it caught her (contact is its radius + hers ≈ 12 units). The tail covers the last flight the
 * replica never shows: it draws a projectile up to the last snapshot that still has it, and a congested link gets
 * snapshots at 15 Hz or skips one (src/server/instance.ts sendSnapshots), so that snapshot can be ~0.15 s before the
 * hit. Sideways the path must still run through her body. The page is sampled once per animation frame, and a
 * software-rendered headless page (≈ 12 fps, with occasional 200–300 ms frames under load) skips flight a real display
 * shows: each segment is also carried on over the time until the next sampled frame (at most PROJECTILE_UNSEEN_MAX_S).
 */
const ROOT_PROJECTILE_REACH = 20;
const PROJECTILE_TAIL_S = 0.15;
const PROJECTILE_UNSEEN_MAX_S = 0.5;
/** Look-back before a root / freeze (ms), and how long after it the render-delayed source may still be drawn. */
const FAIR_BEFORE_MS = 1500;
const FAIR_AFTER_MS = 450;
/** After her own 'pull': when her prediction must agree with the server's snapshot (ms), and how closely (units). */
const PULL_CHECK_MS = 300;
const PULL_AGREE_UNITS = 12;

/** The character as the SERVER last sent it (predictions aside): what the assertions trust. */
function serverCharacter(p) {
  return p.eval(() => {
    const ch = window.__foe.session?.character.authoritative;
    if (!ch) return null;
    const currency = {};
    const maps = [];
    for (const e of ch.backpack.entries) {
      if (e.item.kind === 'currency') currency[e.item.currencyId] = (currency[e.item.currencyId] ?? 0) + e.item.count;
      if (e.item.kind === 'map') maps.push({ uid: e.item.uid, baseId: e.item.baseId, tier: e.item.tier });
    }
    return {
      currency,
      maps,
      currencyStash: { ...ch.currencyStash },
      mapStash: ch.mapStash.map((m) => ({ uid: m.uid, baseId: m.baseId, tier: m.tier })),
      mapDevice: ch.mapDevice ? { uid: ch.mapDevice.uid, baseId: ch.mapDevice.baseId, tier: ch.mapDevice.tier } : null,
      wand: ch.equipment.mainHand
        ? { uid: ch.equipment.mainHand.uid, history: JSON.stringify(ch.equipment.mainHand.history), last: ch.equipment.mainHand.history.at(-1) ?? '', stability: ch.equipment.mainHand.stability }
        : null,
    };
  });
}

/** Wait until the server's character satisfies `fn(ch, arg)` (`fn` is sent to the page as source; `arg` as JSON). */
async function waitServer(p, desc, fn, arg, timeout = 8000) {
  const expr = `(() => { const ch = window.__foe.session?.character.authoritative; return !!ch && (${fn.toString()})(ch, ${JSON.stringify(arg ?? null)}); })()`;
  try {
    await p.page.waitForFunction(expr, undefined, { timeout, polling: 100 });
  } catch {
    throw new Error(`${p.label}: timed out waiting for ${desc}`);
  }
}

/** Currency per id: backpack + Crafting Stash (what a deposit / withdrawal must conserve). */
function currencyTotals(c) {
  const out = {};
  for (const [id, n] of Object.entries(c.currency)) out[id] = (out[id] ?? 0) + n;
  for (const [id, n] of Object.entries(c.currencyStash)) out[id] = (out[id] ?? 0) + (n ?? 0);
  return out;
}

/** Walk to the stash, click it in the world and show a special tab (real UI: the tab button). */
async function openStashTab(p, tab) {
  const open = await p.state('s => s.openPanels.includes("stash")');
  if (!open) {
    await closePanels(p);
    const at = await walkUntilOnScreen(p, () => propOnScreen(p, 'stash', 12), 'the stash');
    await clickWorld(p, at, 'the stash');
    await p.waitFor('the stash panel', () => window.__foe.store.get().openPanels.includes('stash'), undefined, 5000);
  }
  await p.page.click(`.fe-stab--${tab}`);
  await p.waitFor(`the ${tab} tab`, (t) => window.__foe.store.get().stashTab === t, tab, 3000);
  await p.page.waitForSelector(tab === 'maps' ? '.fe-mstash--stash' : `.fe-cstash--${tab}`, { timeout: 3000 });
}

/**
 * In-page, every animation frame (so a 0.8 s freeze or a fast bolt is never missed between samples): what the map
 * shows (monsters, hostile projectiles and hazards, counted once per entity), the local player's raw replica
 * debuffs checked against the contract, the HUD's debuffs, the wave tells — and the two live checks of GAME_SPEC §13:
 *   • fairness: every 'debuff' event rooting / freezing her (the server's position of the hit) is explained by a
 *     root projectile passing within reach or root / freeze ground under her, drawn in the 1.5 s before it (or while
 *     the render delay still shows it arriving);
 *   • her chain-hook drag: 300 ms after each 'pull', once a snapshot past the drag is in, her predicted position
 *     agrees with the server's (no rubber band).
 * Runs in the page (serialised by Playwright): no closures over this file.
 */
function rosterSamplerInPage(cfg) {
  const { monsterKinds, projectileKinds, debuffIds, stackCaps, playerRadius, pullSteps } = cfg;
  const { rootEvidence, rootProjectiles, rootAreas, freezeAreas, projectileReach, projectileTail, unseenMax, before, after, pullCheckMs, pullAgree } = cfg;
  if (window.__e2eRosterStop) window.__e2eRosterStop();
  const rec = {
    monsters: {}, projectiles: {}, areas: {}, playerDebuffs: {}, hudDebuffs: {}, tells: [], debuffNow: null,
    rawBad: [], holds: [], pulls: [], frames: 0,
  };
  window.__e2eRoster = rec;
  const seen = new Set();
  const note = (bucket, kind, id) => {
    const key = `${bucket}:${kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    rec[bucket][kind] = (rec[bucket][kind] ?? 0) + 1;
  };
  /** Frames of the last ~2.6 s: { t, projs: [kind, x, y, prevX, prevY, vx, vy][], areas: [kind, x, y, r][], root }. */
  const ring = [];
  const holds = [];
  const pulls = [];
  /** Batch ticks of her recent 'pull' events (a drag runs from its hit, at or before that tick, for pullSteps). */
  const dragTicks = [];
  const events = window.__foe.localDebuffEvents();
  let evSeq = events.length ? events[events.length - 1].seq : 0;
  const EPS = 1 / 60 + 1e-4;
  const segDist = (px, py, ax, ay, bx, by) => {
    const vx = bx - ax;
    const vy = by - ay;
    const l2 = vx * vx + vy * vy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2)) : 0;
    return Math.hypot(px - (ax + vx * u), py - (ay + vy * u));
  };

  const judgeHold = (h) => {
    let source = null;
    for (const fr of ring) if (fr.t >= h.at && fr.t <= h.at + after && fr.root && !source) source = fr.root;
    const kinds = h.id === 'frozen' ? freezeAreas : source && rootEvidence[source] ? rootEvidence[source] : [...rootProjectiles, ...rootAreas];
    // The closest any candidate came: a projectile's drawn path, or how deep she stood inside candidate ground.
    let bestProj = null;
    let bestArea = null;
    let firstSeen = Infinity;
    for (let fi = 0; fi < ring.length; fi++) {
      const fr = ring[fi];
      if (fr.t < h.at - before || fr.t > h.at + after) continue;
      // Flight the page did not sample: until its next frame (a real display draws those frames).
      const unseen = fi + 1 < ring.length ? Math.min(unseenMax, Math.max(0, (ring[fi + 1].t - fr.t) / 1000)) : 0;
      const tail = projectileTail + unseen;
      for (const [k, x, y, px, py, vx, vy] of fr.projs) {
        if (!kinds.includes(k)) continue;
        firstSeen = Math.min(firstSeen, fr.t);
        const d = segDist(h.x, h.y, px, py, x + vx * tail, y + vy * tail);
        if (!bestProj || d < bestProj.d) bestProj = { k, d, t: fr.t, gap: Math.round(unseen * 1000) };
      }
      for (const [k, x, y, r] of fr.areas) {
        if (!kinds.includes(k)) continue;
        firstSeen = Math.min(firstSeen, fr.t);
        const d = Math.hypot(h.x - x, h.y - y) - (r + playerRadius);
        if (!bestArea || d < bestArea.d) bestArea = { k, d, r };
      }
    }
    let evidence = null;
    if (bestProj && bestProj.d <= projectileReach) evidence = `${bestProj.k}'s path passed ${bestProj.d.toFixed(1)} u from her`;
    else if (bestArea && bestArea.d <= 4) evidence = `${bestArea.k} (r ${bestArea.r.toFixed(0)}) round her`;
    const closest = bestProj ? `${bestProj.k} ${bestProj.d.toFixed(1)} u` : bestArea ? `${bestArea.k} edge ${bestArea.d.toFixed(1)} u` : 'nothing drawn';
    const lead = Number.isFinite(firstSeen) ? Math.round(h.at - firstSeen) : null;
    // For a failure message: the frames round the closest approach (ms from the event, drawn segment, her position).
    const trace = [];
    if (bestProj && !evidence) {
      for (const fr of ring) {
        if (Math.abs(fr.t - bestProj.t) > 120) continue;
        const r = Math.round;
        for (const [k, x, y, px, py] of fr.projs) if (k === bestProj.k) trace.push(`${r(fr.t - h.at)}ms ${r(px)},${r(py)}→${r(x)},${r(y)} me ${fr.me ? `${r(fr.me[0])},${r(fr.me[1])}` : '–'}`);
      }
      trace.push(`next frame after ${bestProj.gap} ms`);
    }
    rec.holds.push({ id: h.id, source, fair: !!evidence, evidence, closest, leadMs: lead, x: Math.round(h.x), y: Math.round(h.y), trace });
  };

  const judgePull = (pl, w, now) => {
    const self = window.__foe.serverSelf();
    // Wait for a snapshot past the drag (the server's word on where it ended); give up after a second.
    if (!self || self.tick < pl.tick + pullSteps + 1) {
      if (now < pl.at + 1000) return false;
      rec.pulls.push({ ok: false, why: `no snapshot past the drag (newest tick ${self?.tick ?? '–'}, hit ${pl.tick})` });
      return true;
    }
    // Another hook of hers still dragging her on the newest snapshot: her prediction is already further along that
    // drag (by the ticks it runs ahead), so the two positions aren't comparable yet. Wait for a snapshot past every
    // drag; hooks chaining for 3 s leave this pull unjudged (it is not a failure: nothing was compared).
    if (dragTicks.some((t) => t <= self.tick && self.tick < t + pullSteps + 1)) {
      if (now < pl.at + 3000) return false;
      rec.pulls.push({ ok: true, skipped: true });
      return true;
    }
    const pp = w.predictedPosition();
    if (!pp || self.dead) return true;
    const st = w.stats();
    // Held (rooted after the drag) through her whole predicted stretch: she cannot move, so both must agree exactly.
    // Free — a root in its grace, or one that runs out within the ticks her prediction is ahead of this snapshot (a
    // second hook during ROOT_GRACE drags without re-rooting, so the first root can end right after the drag): her
    // unacknowledged inputs may have walked her on. Timers may run twice as fast (Cinder Ward), hence the × 2.
    const aheadSec = ((st.pendingInputs + 2) / 60) * 2;
    const held = self.debuffs.some((d) => (d.id === 'rooted' || d.id === 'frozen') && d.remaining > aheadSec);
    const bound = held ? pullAgree : pullAgree + (st.pendingInputs * st.moveSpeed) / 60;
    const dist = Math.hypot(pp.x - self.x, pp.y - self.y);
    rec.pulls.push({
      ok: dist <= bound, dist: +dist.toFixed(2), bound: +bound.toFixed(1), held, len: +Math.hypot(pl.toX - pl.fromX, pl.toY - pl.fromY).toFixed(1),
      replayed: st.pulls, pending: st.pendingInputs,
      holdLeft: +Math.max(0, ...self.debuffs.filter((d) => d.id === 'rooted' || d.id === 'frozen').map((d) => d.remaining)).toFixed(3),
    });
    return true;
  };

  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const foe = window.__foe;
    const w = foe.world;
    const s = foe.store.get();
    if (!w || s.zone !== 'map') {
      ring.length = 0;
      return;
    }
    rec.frames++;
    const me = w.view.players.find((q) => q.id === w.localPlayerId);
    const pos = w.predictedPosition() ?? me;
    const m = w.view.monsters;
    for (let i = 0; i < m.capacity; i++) if (m.alive[i]) note('monsters', monsterKinds[m.kind[i]] ?? `#${m.kind[i]}`, m.id[i]);
    const fr = { t: now, projs: [], areas: [], root: null, me: pos ? [pos.x, pos.y] : null };
    const pj = w.view.projectiles;
    for (let i = 0; i < pj.capacity; i++) {
      if (!pj.alive[i] || !pj.hostile[i]) continue;
      const k = projectileKinds[pj.kind[i]] ?? `#${pj.kind[i]}`;
      note('projectiles', k, pj.id[i]);
      if (pos && rootProjectiles.includes(k) && Math.hypot(pj.x[i] - pos.x, pj.y[i] - pos.y) < 400) {
        fr.projs.push([k, pj.x[i], pj.y[i], pj.prevX[i], pj.prevY[i], pj.vx[i], pj.vy[i]]);
      }
    }
    for (const a of w.view.areas) {
      note('areas', a.kind, a.id);
      if (pos && (rootAreas.includes(a.kind) || freezeAreas.includes(a.kind)) && Math.hypot(a.x - pos.x, a.y - pos.y) < 400) {
        fr.areas.push([a.kind, a.x, a.y, a.radius]);
      }
    }
    // The raw replica, before the HUD's clamping: the contract of PlayerDebuffView.
    for (const d of me?.debuffs ?? []) {
      rec.playerDebuffs[d.id] = (rec.playerDebuffs[d.id] ?? 0) + 1;
      const cap = stackCaps[d.id] ?? 1;
      const why = !debuffIds.includes(d.id)
        ? 'unknown id'
        : !(d.remaining > 0 && d.remaining <= d.duration + EPS)
          ? 'remaining outside (0, duration]'
          : !(Number.isInteger(d.stacks) && d.stacks >= 1 && d.stacks <= cap)
            ? `stacks outside 1..${cap}`
            : (d.source !== null) !== (d.id === 'rooted')
              ? 'a source on a non-root or none on a root'
              : null;
      if (why && rec.rawBad.length < 5) rec.rawBad.push(`${why}: ${JSON.stringify(d)}`);
      if (d.id === 'rooted') fr.root = d.source;
    }
    ring.push(fr);
    while (ring.length && ring[0].t < now - (before + after + 700)) ring.shift();

    const hud = s.hud?.debuffs ?? [];
    for (const d of hud) rec.hudDebuffs[d.id] = (rec.hudDebuffs[d.id] ?? 0) + 1;
    rec.debuffNow = hud.length ? hud.map((d) => d.id).join('+') : null;
    const tell = s.hud?.run?.tell;
    if (tell && !rec.tells.some((t) => t.wave === tell.wave)) rec.tells.push({ wave: tell.wave, families: [...tell.families], lieutenant: tell.lieutenant, boss: tell.boss });

    for (const e of foe.localDebuffEvents(evSeq)) {
      evSeq = e.seq;
      const ev = e.event;
      if (ev.t === 'debuff' && (ev.debuff === 'rooted' || ev.debuff === 'frozen')) holds.push({ at: e.at, id: ev.debuff, x: ev.x, y: ev.y });
      else if (ev.t === 'pull') {
        pulls.push({ at: e.at, tick: e.tick, fromX: ev.fromX, fromY: ev.fromY, toX: ev.toX, toY: ev.toY });
        dragTicks.push(e.tick);
        if (dragTicks.length > 32) dragTicks.shift();
      }
    }
    while (holds.length && now >= holds[0].at + after) judgeHold(holds.shift());
    for (let k = 0; k < pulls.length; k++) {
      if (now < pulls[k].at + pullCheckMs || !judgePull(pulls[k], w, now)) continue;
      pulls.splice(k--, 1);
    }
  };
  raf = requestAnimationFrame(frame);
  window.__e2eRosterStop = () => cancelAnimationFrame(raf);
}

async function startRosterSampler(p) {
  const c = await loadContracts();
  await p.eval(rosterSamplerInPage, {
    monsterKinds: c.monsterKinds, projectileKinds: c.projectileKinds, debuffIds: c.debuffIds, stackCaps: c.stackCaps,
    playerRadius: c.playerRadius, pullSteps: c.pullSteps, rootEvidence: ROOT_EVIDENCE, rootProjectiles: ROOT_PROJECTILES,
    rootAreas: ROOT_AREAS, freezeAreas: FREEZE_AREAS, projectileReach: ROOT_PROJECTILE_REACH, projectileTail: PROJECTILE_TAIL_S,
    unseenMax: PROJECTILE_UNSEEN_MAX_S, before: FAIR_BEFORE_MS,
    after: FAIR_AFTER_MS, pullCheckMs: PULL_CHECK_MS, pullAgree: PULL_AGREE_UNITS,
  });
}

const rosterReport = (p) => p.eval(() => window.__e2eRoster);

async function buyFromRook(p, labels) {
  await closePanels(p);
  const at = await walkUntilOnScreen(p, () => propOnScreen(p, 'merchant', 14), 'Rook');
  await clickWorld(p, at, 'Rook');
  await p.waitFor('the merchant panel', () => window.__foe.store.get().openPanels.includes('merchant'), undefined, 5000);
  await p.page.waitForSelector('.fe-merchant .fe-offer', { timeout: 5000 });
  const bought = [];
  for (const label of labels) {
    const before = (await serverCharacter(p)).maps.map((m) => m.uid);
    const offer = p.page.locator('.fe-offer', { hasText: label }).first();
    await offer.locator('button:has-text("Buy")').click({ timeout: 5000 });
    await waitServer(p, `the ${label} map`, (ch, known) => ch.backpack.entries.some((e) => e.item.kind === 'map' && !known.includes(e.item.uid)), before);
    const after = await serverCharacter(p);
    bought.push(after.maps.find((m) => !before.includes(m.uid)));
  }
  await closePanels(p);
  return bought;
}

async function wave5Scenario({ A }) {
  const bought = {};

  await step('Map Stash: A takes a free Rimed Ossuary and Iron Coliseum map from Rook, then Ctrl-clicks every map into the Map Stash', async () => {
    const [ossuary, coliseum] = await buyFromRook(A, ['Rimed Ossuary (Tier 1)', 'Iron Coliseum (Tier 1)']);
    assert(ossuary?.baseId === 'rimedOssuary' && coliseum?.baseId === 'ironColiseum', `Rook sold the wrong maps: ${JSON.stringify([ossuary, coliseum])}`);
    bought.rimedOssuary = ossuary;
    bought.ironColiseum = coliseum;
    const before = await serverCharacter(A);
    await openStashTab(A, 'maps');
    for (let i = 0; i < 30; i++) {
      const map = A.page.locator('.fe-grid[data-drop="backpack"] .fe-item[data-kind="map"]').first();
      if ((await map.count()) === 0) break;
      const uid = await map.getAttribute('data-uid');
      await map.click({ modifiers: ['Control'] });
      await waitServer(A, `map ${uid} in the Map Stash`, (ch, u) => ch.mapStash.some((m) => m.uid === u), uid);
    }
    const after = await serverCharacter(A);
    assert(after.maps.length === 0, `maps left in the backpack: ${JSON.stringify(after.maps)}`);
    const stashed = new Set(after.mapStash.map((m) => m.uid));
    for (const m of [...before.maps, ...before.mapStash]) assert(stashed.has(m.uid), `map ${m.uid} (${m.baseId}) went missing`);
    assert(after.mapStash.length === before.maps.length + before.mapStash.length, `map count changed: ${before.maps.length} + ${before.mapStash.length} → ${after.mapStash.length}`);
    await A.page.waitForSelector(`.fe-mstash--stash .fe-maprow[data-uid="${ossuary.uid}"]`, { timeout: 3000 }).catch(async () => {
      // The page shows one tier at a time (the highest by default): open Tier 1.
      await A.page.click('.fe-mstash--stash button[aria-label^="Tier 1:"]');
      await A.page.waitForSelector(`.fe-mstash--stash .fe-maprow[data-uid="${ossuary.uid}"]`, { timeout: 3000 });
    });
    await settlePanels(A);
    await A.shot('w5-01-map-stash-A');
    return `${after.mapStash.length} maps filed (${after.mapStash.map((m) => `${m.baseId} T${m.tier}`).join(', ')})`;
  });

  await step('Crafting Stash: "Deposit all" files every backpack currency; Shift+Ctrl-click takes exactly 1, Ctrl-click a stack', async () => {
    await openStashTab(A, 'currency');
    const before = await serverCharacter(A);
    const totals = currencyTotals(before);
    assert(Object.keys(before.currency).length > 0, 'A carries no currency to deposit');
    await A.page.click('.fe-stash__deposit');
    await waitServer(A, 'no currency left in the backpack', (ch) => !ch.backpack.entries.some((e) => e.item.kind === 'currency'));
    await A.waitFor('the deposit toast', () => window.__foe.store.get().toasts.some((t) => /Crafting Stash/.test(t.text)), undefined, 5000);
    const deposited = await serverCharacter(A);
    const diff = holdingsDiff(totals, currencyTotals(deposited));
    assert(diff.length === 0, `currency created or lost by Deposit all: ${diff.join('; ')}`);
    await settlePanels(A);
    await A.shot('w5-02-crafting-stash-A');

    // Shift+Ctrl-click: exactly one Scrap.
    const scrapSlot = deposited.currencyStash.scrap ?? 0;
    assert(scrapSlot >= 2, `too little Scrap in the stash for the withdrawal checks (${scrapSlot})`);
    await A.page.locator('.fe-cslot[data-currency="scrap"]').click({ modifiers: ['Shift', 'Control'] });
    await waitServer(A, 'one Scrap in the backpack', (ch, n) => (ch.currencyStash.scrap ?? 0) === n - 1, scrapSlot);
    const one = await serverCharacter(A);
    assert(one.currency.scrap === 1, `Shift+Ctrl-click should take exactly 1 Scrap, the backpack has ${one.currency.scrap}`);

    // Ctrl-click: a full stack (up to the backpack stack size of 40).
    const withdrawId = ['kindling', 'essenceEmber', 'mapDust', 'threatGlyph'].find((id) => (one.currencyStash[id] ?? 0) > 0);
    let stackNote = 'no second currency to withdraw';
    if (withdrawId) {
      const slot = one.currencyStash[withdrawId];
      if (withdrawId === 'mapDust' || withdrawId === 'threatGlyph') await openStashTab(A, 'mapCurrency');
      await A.page.locator(`.fe-cslot[data-currency="${withdrawId}"]`).click({ modifiers: ['Control'] });
      await waitServer(A, `the ${withdrawId} stack in the backpack`, (ch, a) => (ch.currencyStash[a.id] ?? 0) === a.slot - Math.min(40, a.slot), { id: withdrawId, slot });
      const got = (await serverCharacter(A)).currency[withdrawId];
      assert(got === Math.min(40, slot), `Ctrl-click should take a stack of ${Math.min(40, slot)} ${withdrawId}, got ${got}`);
      stackNote = `Ctrl-click took ${got} ${withdrawId}`;
    }
    await openStashTab(A, 'mapCurrency');
    await settlePanels(A);
    await A.shot('w5-03-map-currency-A');
    const kinds = Object.keys(totals).length;
    return `${kinds} currencies deposited and conserved; Shift+Ctrl-click took 1 Scrap (${scrapSlot} → ${scrapSlot - 1}); ${stackNote}`;
  });

  await step('crafting straight from the Crafting Stash: right-click a slot, left-click the equipped wand', async () => {
    await openStashTab(A, 'currency');
    const before = await serverCharacter(A);
    assert(before.wand, 'A has no wand equipped');
    // A currency the rules let A use on the wand from its slot (Scrap first), without an affix choice.
    const pick = await A.eval((wandUid) => {
      const { rules } = window.__foe.store;
      const ch = window.__foe.store.get().character;
      const order = ['scrap', 'essenceEmber', 'kindling', 'reforge', 'solvent'];
      for (const id of order) {
        if ((ch.currencyStash[id] ?? 0) <= 0) continue;
        if (rules.content.currencies[id]?.needsAffixChoice) continue;
        if (rules.craftingTargetError(ch, `cstash:${id}`, wandUid) === null) return id;
      }
      return null;
    }, before.wand.uid);
    assert(pick, `no Crafting Stash currency can be used on the wand: ${JSON.stringify(before.currencyStash)}`);
    const slot = before.currencyStash[pick];
    await A.page.locator(`.fe-cslot[data-currency="${pick}"]`).click({ button: 'right' });
    await A.waitFor('the slot armed', (u) => window.__foe.store.get().armed?.uid === u, `cstash:${pick}`, 3000);
    await settlePanels(A);
    await A.shot('w5-04-armed-slot-A');
    await A.page.locator(`[data-drop="equip"] .fe-item[data-uid="${before.wand.uid}"]`).first().click();
    await waitServer(A, `one ${pick} used from the slot`, (ch, a) => (ch.currencyStash[a.id] ?? 0) === a.slot - 1, { id: pick, slot });
    // The history is capped, so compare its lines rather than its length.
    await waitServer(A, 'the wand crafted', (ch, h) => JSON.stringify(ch.equipment.mainHand?.history ?? []) !== h, before.wand.history);
    const after = await serverCharacter(A);
    assert(JSON.stringify(after.currency) === JSON.stringify(before.currency), `the craft must not touch backpack currency: ${JSON.stringify(before.currency)} → ${JSON.stringify(after.currency)}`);
    await sleep(300);
    await A.shot('w5-05-crafted-from-stash-A');
    await closePanels(A);
    return `${pick} slot ${slot} → ${slot - 1}; wand: "${after.wand.last}", stability ${before.wand.stability} → ${after.wand.stability}`;
  });

  const contracts = await loadContracts();
  for (const theme of ['rimedOssuary', 'ironColiseum']) {
    const check = THEME_CHECKS[theme];
    const roster = contracts.rosters[theme];
    const { tag } = check;

    await step(`Map Stash → map device: A picks the ${check.name} map in the device's Map Stash picker and activates it`, async () => {
      const map = bought[theme];
      assert(map, `no ${check.name} map was bought`);
      await closePanels(A);
      const at = await walkUntilOnScreen(A, () => propOnScreen(A, 'mapDevice', 10), 'the map device');
      await clickWorld(A, at, 'the map device');
      await A.waitFor('the map device panel', () => window.__foe.store.get().openPanels.includes('mapDevice'), undefined, 5000);
      await A.page.waitForSelector('.fe-mstash--device', { timeout: 5000 });
      const row = `.fe-mstash--device .fe-maprow[data-uid="${map.uid}"]`;
      if ((await A.page.locator(row).count()) === 0) await A.page.click(`.fe-mstash--device button[aria-label^="Tier ${map.tier}:"]`);
      await A.page.locator(row).click({ timeout: 5000 });
      await waitServer(A, `the ${check.name} map in the device`, (ch, u) => ch.mapDevice?.uid === u && !ch.mapStash.some((m) => m.uid === u), map.uid);
      await settlePanels(A);
      await A.shot(`w5-06-device-${tag}-A`);
      await A.page.click('.fe-device__activate');
      // An earlier map's portal that still has entries asks first.
      const confirm = A.page.locator('.fe-dialog__actions button:has-text("Activate")');
      if (await confirm.isVisible({ timeout: 1000 }).catch(() => false)) await confirm.click();
      await A.waitFor(`the ${check.name} portal`, (name) => {
        const p = window.__foe.store.get().hud?.portal;
        return !!p && p.remaining === 8 && p.mapName.includes(name);
      }, check.name, 8000);
      const portal = await A.state('s => s.hud.portal');
      return `${portal.mapName} T${portal.tier}: ${portal.remaining}/${portal.total} portals`;
    });

    await step(`${check.name}: only its own roster fights; baited debuffs (${check.require.join(', ')}) land from visible sources and reach the HUD`, async () => {
      await startRosterSampler(A);
      await clickPortal(A);
      await A.waitFor('the map zone', () => window.__foe.store.get().zone === 'map', undefined, 25_000);
      await A.waitFor('the HUD run readout', () => !!window.__foe.store.get().hud?.run, undefined, 8000);
      const run0 = await A.state('s => ({ map: s.hud.run.mapName, theme: window.__foe.session.zone.theme })');
      assert(run0.theme === theme, `the zone should be ${theme}, got ${run0.theme}`);
      // Baiting from the start: the autopilot stands in reach of the kinds whose debuffs the checks need (it never
      // shoots them) and fights everything else; once they have landed it fights normally.
      let baiting = true;
      await A.eval((bait) => window.__foe.bot.enable({ returnPortal: false, collect: true, skills: false, bait }), check.bait);
      const allowed = new Set([...roster.family, roster.lieutenant, roster.boss]);
      const met = (rec) => check.require.every((id) => rec.hudDebuffs[id]) && rec.holds.length > 0;
      const shots = { debuff: null, hold: null, fight: false };
      let deaths = 0;
      const limit = SMOKE_SECONDS + BAIT_BUDGET_SECONDS;
      const started = Date.now();
      let sec = 0;
      let rec = null;
      for (;;) {
        await sleep(250);
        sec = (Date.now() - started) / 1000;
        rec = await rosterReport(A);
        const family = roster.family.filter((k) => rec.monsters[k]);
        if (!shots.debuff && rec.debuffNow) {
          shots.debuff = rec.debuffNow;
          await A.shot(`w5-07-debuff-${tag}-A`);
        }
        if (!shots.hold && rec.debuffNow && /rooted|frozen/.test(rec.debuffNow)) {
          shots.hold = rec.debuffNow;
          await A.shot(`w5-07-hold-${tag}-A`);
        }
        if (!shots.fight && sec >= 6) {
          shots.fight = true;
          await A.shot(`w5-07-fight-${tag}-A`);
        }
        if (baiting && met(rec)) {
          baiting = false;
          await A.eval(() => window.__foe.bot.enable({ bait: null, skills: true }));
        }
        if (await A.state('s => !!s.hud?.dead')) {
          // A fall after the checks ends the smoke; before them, back in through the portal (the bot walks into it
          // from the hideout) — twice at most.
          if (!baiting || deaths >= 2) break;
          deaths++;
          log(`note: A fell in the ${check.name} at ${sec.toFixed(0)} s; respawning and going back in`);
          const r = await A.eval(() => window.__foe.send({ c: 'respawn' }));
          assert(r.ok, `respawn failed: ${r.error}`);
          await A.waitFor('the hideout', () => window.__foe.store.get().zone === 'hideout', undefined, 10_000);
          await A.eval(() => window.__foe.store.actions.dismissRunSummary());
          await A.waitFor('the map again', () => window.__foe.store.get().zone === 'map', undefined, 30_000);
          continue;
        }
        const done = !baiting && sec >= SMOKE_SECONDS && family.length >= 2;
        if (done || sec >= limit) break;
      }
      await A.shot(`w5-09-end-${tag}-A`);
      const run = await A.state('s => s.hud?.run && ({ wave: s.hud.run.wave, kills: s.hud.run.kills, phase: s.hud.run.phase })');
      const stats = await A.eval(() => {
        const st = window.__foe.world.stats();
        return { pulls: st.pulls, corrections: st.corrections, snaps: st.snaps };
      });
      await A.eval(() => window.__e2eRosterStop?.());

      const seen = Object.keys(rec.monsters);
      const foreign = seen.filter((k) => !allowed.has(k));
      assert(foreign.length === 0, `monsters from another roster in the ${check.name}: ${foreign.join(', ')}`);
      const family = roster.family.filter((k) => rec.monsters[k]);
      assert(family.length >= 1, `none of the ${check.name} family showed up in ${sec.toFixed(0)} s (saw ${seen.join(', ') || 'nothing'})`);
      for (const t of rec.tells) {
        const off = t.families.filter((k) => !allowed.has(k));
        assert(off.length === 0, `the wave ${t.wave} tell announces other rosters: ${off.join(', ')}`);
      }
      assert(rec.rawBad.length === 0, `replica debuffs out of contract: ${rec.rawBad.join('; ')}`);
      const replica = Object.keys(rec.playerDebuffs);
      const hud = Object.keys(rec.hudDebuffs);
      // Whatever the replica had for a while (≥ 12 frames, 0.2 s), the HUD (15 Hz) showed.
      const missing = replica.filter((d) => !hud.includes(d) && rec.playerDebuffs[d] >= 12);
      assert(missing.length === 0, `debuffs on the player that never reached the HUD: ${missing.join(', ')}`);
      const absent = check.require.filter((d) => !rec.hudDebuffs[d]);
      assert(absent.length === 0, `${absent.join(', ')} never reached the HUD in the ${check.name} (${sec.toFixed(0)} s, HUD saw ${hud.join(', ') || 'nothing'}; baited ${check.bait.join('/')}; monsters ${seen.join(', ')})`);
      // GAME_SPEC §13: every root and freeze from a projectile you can see or a telegraph you can read.
      const unfair = rec.holds.filter((h) => !h.fair);
      assert(unfair.length === 0, `roots / freezes without a visible source: ${JSON.stringify(unfair.slice(0, 4))}`);
      assert(rec.holds.length > 0, `no root or freeze landed on A in the ${check.name} while baiting ${check.bait.join('/')} (${sec.toFixed(0)} s)`);
      // Her chain-hook drags: the prediction agrees with the server after each one.
      const bands = rec.pulls.filter((pl) => !pl.ok);
      assert(bands.length === 0, `rubber band after a chain hook: ${JSON.stringify(bands.slice(0, 4))}`);
      if (rec.holds.some((h) => h.source === 'chain')) assert(rec.pulls.length > 0, 'a chain root landed but no pull of hers was checked');

      // Leave (dead: back through the death screen's respawn).
      await A.eval(() => window.__foe.bot.disable());
      const dead = await A.state('s => !!s.hud?.dead');
      const r = await A.eval((d) => window.__foe.send({ c: d ? 'respawn' : 'leaveMap' }), dead);
      assert(r.ok, `leaving the ${check.name} failed: ${r.error}`);
      await A.waitFor('home', () => {
        const s = window.__foe.store.get();
        return s.zone === 'hideout' && s.isOwnHideout && !!s.hud;
      }, undefined, 10_000);
      await A.eval(() => window.__foe.store.actions.dismissRunSummary());
      const list = (o) => Object.entries(o).map(([k, n]) => `${k}×${n}`).join(' ') || '–';
      const holdText = rec.holds.map((h) => `${h.id}${h.source ? `(${h.source})` : ''} ← ${h.evidence ?? h.closest}${h.leadMs !== null ? `, drawn ${h.leadMs} ms before` : ''}`);
      const pullText = rec.pulls.map((pl) => (pl.skipped ? 'unjudged (hooks kept dragging her)' : `${pl.len} u drag → ${pl.dist} u off (≤ ${pl.bound}${pl.held ? ', held' : ''})`));
      return [
        `wave ${run?.wave ?? '?'}, ${run?.kills ?? 0} kills in ${sec.toFixed(0)} s${deaths ? ` (A fell ${deaths}×)` : ''}`,
        `monsters ${list(rec.monsters)}`,
        `debuffs HUD ${hud.join(', ') || '–'}${shots.debuff ? ` (shot: ${shots.debuff})` : ''}`,
        `holds ${holdText.join('; ') || '–'}`,
        `pulls ${pullText.join('; ') || '–'} (replayed ${stats.pulls}, corrections ${stats.corrections}, snaps ${stats.snaps})`,
        `hazards ${list(rec.areas)}`,
        `hostile projectiles ${list(rec.projectiles)}`,
        `tells ${rec.tells.map((t) => `w${t.wave}: ${t.families.join('/')}${t.lieutenant ? ' +lt' : ''}${t.boss ? ' +boss' : ''}`).join('; ') || '–'}`,
      ].join(' | ');
    });
  }
}

/** Real UI and real sockets: channel routing and the context-menu hand-offs. */
async function qolScenario({ A, B, nameA, nameB }) {
  await step('global chat crosses hideouts and right-click invites a sender', async () => {
    await B.page.keyboard.press('Enter');
    await B.page.getByRole('textbox', { name: 'Message everyone online' }).fill('Anyone up for a map?');
    await B.page.keyboard.press('Enter');
    await A.waitFor('global message from the other hideout', (n) => window.__foe.store.get().chat.some((l) => l.channel === 'global' && l.fromName === n && l.text === 'Anyone up for a map?'), nameB);
    await A.page.keyboard.press('Enter');
    await A.page.getByText(`${nameB}:`, { exact: true }).click({ button: 'right' });
    await A.page.getByRole('dialog', { name: `Player actions for ${nameB}` }).getByRole('button', { name: 'Invite to party' }).click();
    await B.waitFor('party invitation', () => window.__foe.store.get().invites.length === 1);
    await B.page.getByRole('alertdialog', { name: `Party invite from ${nameA}` }).getByRole('button', { name: 'Join', exact: true }).click();
    for (const p of [A, B]) await p.waitFor('two party members', () => window.__foe.store.get().party?.members.length === 2);
    await A.shot('qol-party-avatars');
  });
  await step('party channel, avatar hideout visit and avatar trade', async () => {
    await A.page.keyboard.press('Enter');
    await A.page.getByRole('button', { name: 'Party', exact: true }).click();
    await A.page.getByRole('textbox', { name: 'Message your party' }).fill('Meet in my hideout');
    await A.page.keyboard.press('Enter');
    await B.waitFor('party message', () => window.__foe.store.get().chat.some((l) => l.channel === 'party' && l.text === 'Meet in my hideout'));
    await B.page.getByRole('button', { name: new RegExp(`^${nameA}, level`) }).click({ button: 'right' });
    await B.page.getByRole('dialog', { name: `Player actions for ${nameA}` }).getByRole('button', { name: 'Join hideout' }).click();
    await B.waitFor('the other hideout', (n) => window.__foe.store.get().hud?.zoneOwnerName === n && !window.__foe.store.get().hud?.zoneIsOwn, nameA);
    await B.page.getByRole('button', { name: new RegExp(`^${nameA}, level`) }).click({ button: 'right' });
    await B.page.getByRole('dialog', { name: `Player actions for ${nameA}` }).getByRole('button', { name: 'Trade', exact: true }).click();
    await A.waitFor('trade request', () => window.__foe.store.get().tradeRequests.length === 1);
    await A.page.getByRole('alertdialog', { name: `Trade request from ${nameB}` }).getByRole('button', { name: 'Trade', exact: true }).click();
    for (const p of [A, B]) await p.waitFor('trade opened', () => !!window.__foe.store.get().trade);
    await B.shot('qol-avatar-trade');
  });
}

async function accountScenario({ A, B, nameB, port }) {
  let uid;
  await step('a normal stash tab files maps/currency into storage shared with an online alt', async () => {
    await openStashTab(A, 'maps');
    await A.page.locator('.fe-tabs__normal .fe-tab').first().click();
    const map = (await itemsOf(A)).find((i) => i.kind === 'map');
    const currency = (await itemsOf(A)).find((i) => i.currencyId === 'scrap');
    uid = map.uid;
    await A.page.locator(`[data-drop="backpack"] [data-uid="${uid}"]`).click({ modifiers: ['Control'] });
    await B.waitFor('shared map from the other character', (id) => window.__foe.store.get().character.mapStash.some((m) => m.uid === id), uid);
    await A.page.locator(`[data-drop="backpack"] [data-uid="${currency.uid}"]`).click({ modifiers: ['Control'] });
    await B.waitFor('shared currency from the other character', (n) => window.__foe.store.get().character.currencyStash.scrap === n, currency.count);
    await A.page.locator('.fe-tabs__normal .fe-tab').first().dblclick();
    await A.page.locator('.fe-tabs__rename').fill('Account Gear');
    await A.page.locator('.fe-tabs__rename').press('Enter');
    await B.waitFor('shared tab name', () => window.__foe.store.get().character.stash[0].name === 'Account Gear');
    await A.shot('account-stash-normal');
  });
  await step('the alt withdraws the shared map once and both clients lose the stash entry', async () => {
    await openStashTab(B, 'maps');
    await B.page.locator(`.fe-maprow[data-uid="${uid}"]`).click({ modifiers: ['Control'] });
    await B.waitFor('map in alt backpack', (id) => window.__foe.store.get().character.backpack.entries.some((e) => e.item.uid === id), uid);
    await A.waitFor('map removed from the shared stash', (id) => !window.__foe.store.get().character.mapStash.some((m) => m.uid === id), uid);
    await B.page.locator(`[data-drop="backpack"] [data-uid="${uid}"]`).click({ modifiers: ['Control'] });
    await A.waitFor('map returned to the shared stash', (id) => window.__foe.store.get().character.mapStash.some((m) => m.uid === id), uid);
    await B.shot('account-stash-maps');
  });
  await step('both alts reconnect after a server restart with the same shared map and tab name', async () => {
    outage = true;
    await stopGameServer();
    await startGameServer(port);
    for (const p of [A, B]) await p.waitFor('reconnected shared stash', (id) => {
      const s = window.__foe.store.get();
      return s.connection === 'online' && s.screen === 'game' && s.character.stash[0].name === 'Account Gear' && s.character.mapStash.filter((m) => m.uid === id).length === 1;
    }, uid, 30_000);
    outage = false;
    return `one shared map, two online characters; alt ${nameB}`;
  });
}

async function atlasScenario({ A, port }) {
  const { tsImport } = await import('tsx/esm/api');
  const { ATLAS_AREA_IDS } = await tsImport('../src/contracts/atlas.ts', import.meta.url);
  const { ATLAS_AREAS, ATLAS_KEYS } = await tsImport('../src/data/progression/atlas.ts', import.meta.url);
  const { buildEquipment } = await tsImport('../src/game/items/index.ts', import.meta.url);
  const { createRng } = await tsImport('../src/core/rng.ts', import.meta.url);
  const openDevice = async () => {
    await A.page.evaluate(() => window.__foe.store.actions.closeAllPanels());
    let at = await propOnScreen(A, 'mapDevice');
    for (let i = 0; i < 30 && at && (at.y < 90 || at.y > VH - 170); i++) {
      const key = at.y < 90 ? 'w' : 's';
      await A.page.keyboard.down(key); await sleep(180); await A.page.keyboard.up(key); await sleep(120);
      at = await propOnScreen(A, 'mapDevice');
    }
    assert(at && at.y >= 60 && at.y <= VH - 140, 'map device is not on screen');
    await A.page.mouse.click(at.x, at.y);
    await A.page.waitForSelector('.fe-device');
  };
  await step('a fresh account sees one Atlas area and fog over every other destination', async () => {
    await openDevice();
    await A.page.locator('.fe-grid[data-drop="backpack"] .fe-item[data-kind="map"]').first().click({ modifiers: ['Control'] });
    await A.waitFor('inserted map', () => !!window.__foe.store.get().character.mapDevice);
    await A.page.locator('.fe-device__destination').click();
    assert(await A.page.locator('.fe-atlas__node--known').count() === 1, 'fresh Atlas has extra revealed areas');
    assert(await A.page.locator('.fe-atlas__node:disabled').count() === ATLAS_AREA_IDS.length - 1, 'fog areas are not disabled');
    await A.shot(`atlas-fresh-${VW}x${VH}`);
  });
  await step('explored Atlas handles tier limits and an item from another theme', async () => {
    // Seed only the harness's disposable database while its server is stopped. Backend tests exercise
    // boss discovery/party credit; this browser fixture reaches the deepest layout without hours of combat.
    outage = true;
    await stopGameServer();
    const { DatabaseSync } = await import('node:sqlite');
    const { tsImport } = await import('tsx/esm/api');
    const { ATLAS_AREA_IDS } = await tsImport('../src/contracts/atlas.ts', import.meta.url);
    const db = new DatabaseSync(join(tmp, 'e2e.db'));
    const row = db.prepare('SELECT account_id, data FROM account_storage').get();
    const shared = JSON.parse(row.data);
    shared.atlas = { discovered: [...ATLAS_AREA_IDS], completed: ATLAS_AREA_IDS.filter((id) => id !== 'sealedReliquary'), clears: 12 };
    shared.currencyStash.reliquaryKey = 1;
    db.prepare('UPDATE account_storage SET data = ? WHERE account_id = ?').run(JSON.stringify(shared), row.account_id);
    const character = db.prepare('SELECT id, data FROM characters').get();
    const saved = JSON.parse(character.data);
    saved.mapDevice.tier = 3;
    saved.mapDevice.baseId = 'ashenForge';
    db.prepare('UPDATE characters SET data = ? WHERE id = ?').run(JSON.stringify(saved), character.id);
    db.close();
    await startGameServer(port);
    await A.waitFor('explored Atlas after restart', (total) => {
      const s = window.__foe.store.get();
      return s.connection === 'online' && s.character?.atlas?.discovered.length === total;
    }, ATLAS_AREA_IDS.length, 30_000);
    outage = false;
    await openDevice();
    await A.page.locator('.fe-device__destination').click();
    await A.page.getByRole('button', { name: /^Cinder Crossing,/ }).click();
    assert(await A.page.getByRole('button', { name: 'Use this area', exact: true }).isDisabled(), 'Tier 3 should not fit the starting area');
    await A.page.getByRole('button', { name: /^Bone Approach,/ }).click();
    const overlaps = await A.eval(() => {
      const nodes = [...document.querySelectorAll('.fe-atlas__node')].map(n => ({ name: n.textContent, r: n.getBoundingClientRect() }));
      return nodes.flatMap((a, i) => nodes.slice(i + 1).filter(b =>
        a.r.left < b.r.right && a.r.right > b.r.left && a.r.top < b.r.bottom && a.r.bottom > b.r.top
      ).map(b => `${a.name} / ${b.name}`));
    });
    assert(overlaps.length === 0, `Atlas area cards overlap: ${overlaps.join('; ')}`);
    const falseEntrances = await A.eval(() => {
      const nodes = [...document.querySelectorAll('.fe-atlas__node')].map(n => ({ id: n.dataset.area, r: n.getBoundingClientRect() }));
      return [...document.querySelectorAll('.fe-atlas__routes path')].flatMap(path => {
        const matrix = path.getScreenCTM(), length = path.getTotalLength();
        for (let step = 1; step < 100; step++) {
          const p = path.getPointAtLength(length * step / 100).matrixTransform(matrix);
          const crossed = nodes.find(n => n.id !== path.dataset.from && n.id !== path.dataset.to
            && p.x > n.r.left - 2 && p.x < n.r.right + 2 && p.y > n.r.top - 2 && p.y < n.r.bottom + 2);
          if (crossed) return [`${path.dataset.from} → ${path.dataset.to} crosses ${crossed.id}`];
        }
        return [];
      });
    });
    assert(falseEntrances.length === 0, `Atlas routes imply false entrances: ${falseEntrances.join('; ')}`);
    await A.shot(`atlas-explored-${VW}x${VH}`);
    await A.page.getByRole('button', { name: 'Use this area', exact: true }).click();
    assert((await A.page.locator('.fe-device__destination').innerText()).includes('Bone Approach'), 'area choice was not retained');
    await A.shot(`atlas-device-${VW}x${VH}`);
  });
  await step('the Sealed Reliquary consumes one key and opens the selected area', async () => {
    await A.page.locator('.fe-device__destination').click();
    await A.page.getByRole('button', { name: /^Sealed Reliquary,/ }).click();
    await A.page.getByRole('button', { name: 'Use this area', exact: true }).click();
    await A.shot(`atlas-sealed-${VW}x${VH}`);
    await A.page.locator('.fe-device__activate').click();
    await A.waitFor('sealed area portal and key spent', () => {
      const s = window.__foe.store.get();
      return s.hud?.portal?.mapName === 'Sealed Reliquary' && s.hud.portal.tier === 3 && !s.character.mapDevice && !s.character.currencyStash.reliquaryKey;
    });
  });
  const play = opt('play-areas', '').split(',');
  for (const areaId of ['heartOfForge', 'eternalArena', 'hollowOssuary', 'pitOfEchoes', 'shrineField', 'gildedVault', 'blackPit', 'huntingGround', 'riftNexus']) {
    const area = ATLAS_AREAS.find(a => a.id === areaId);
    const tier = ['heartOfForge', 'eternalArena'].includes(areaId) ? 15 : 3;
    await step(`${area.name}: select destination, disclose costs and activate through the UI`, async () => {
      outage = true;
      await stopGameServer();
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(join(tmp, 'e2e.db'));
      const row = db.prepare('SELECT account_id, data FROM account_storage').get();
      const shared = JSON.parse(row.data);
      shared.atlas = { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 };
      shared.currencyStash.scrap = 100;
      for (const key of ATLAS_KEYS) shared.currencyStash[key.currencyId] = 2;
      db.prepare('UPDATE account_storage SET data = ? WHERE account_id = ?').run(JSON.stringify(shared), row.account_id);
      const ch = db.prepare('SELECT id, data FROM characters').get();
      const saved = JSON.parse(ch.data);
      saved.mapDevice = { kind: 'map', uid: `e2e-atlas:${areaId}`, baseId: 'ashenForge', tier, rarity: 'normal', quality: 0, corrupted: false, mods: [], ...(area.requiresBounty ? { bounty: true } : {}) };
      saved.level = 60; saved.allocated = { str: 195, dex: 100, int: 195 };
      saved.equipment.mainHand = buildEquipment({ uid: 'atlas-wand:i1', baseId: 'emberheartWand', itemLevel: 88, rarity: 'rare',
        affixes: [{ affixId: 'spellDamage', tier: 1 }, { affixId: 'fireDamage', tier: 1 }, { affixId: 'addedSpellDamage', tier: 1 },
          { affixId: 'castSpeed', tier: 1 }, { affixId: 'critChance', tier: 1 }, { affixId: 'critMultiplier', tier: 1 }] }, createRng(81));
      for (const id of Object.keys(saved.skillRanks)) saved.skillRanks[id] = 20;
      saved.loadout = ['emberLance', 'emberNova', 'arcChain', 'flameWave', 'cinderWard', 'riftStep'];
      db.prepare('UPDATE characters SET data = ? WHERE id = ?').run(JSON.stringify(saved), ch.id);
      db.close();
      await startGameServer(port);
      await A.waitFor('new area fixture reconnect', (uid) => window.__foe.store.get().connection === 'online' && window.__foe.store.get().character?.mapDevice?.uid === uid, saved.mapDevice.uid, 30000);
      outage = false;
      await openDevice();
      await A.page.locator('.fe-device__destination').click();
      await A.page.getByRole('button', { name: new RegExp(`^${area.name},`) }).click();
      await A.shot(`atlas-${areaId}-detail-${VW}x${VH}`);
      await A.page.getByRole('button', { name: 'Use this area', exact: true }).click();
      if (area.chosenClass) await A.page.getByRole('combobox', { name: 'Hunter reward class' }).selectOption('ring');
      await A.shot(`atlas-${areaId}-device-${VW}x${VH}`);
      const currencyOnHand = id => {
        const ch = window.__foe.store.get().character;
        return (ch.currencyStash[id] ?? 0) + [...ch.backpack.entries, ...ch.stash.flatMap(t => t.grid.entries)]
          .reduce((n, e) => n + (e.item.kind === 'currency' && e.item.currencyId === id ? e.item.count : 0), 0);
      };
      const scrapBefore = await A.eval(currencyOnHand, 'scrap');
      const keyBefore = area.entranceKey ? await A.eval(currencyOnHand, area.entranceKey) : 0;
      await A.page.locator('.fe-device__activate').click();
      const confirm = A.page.locator('.fe-dialog__actions button:has-text("Activate")');
      if (await confirm.isVisible()) await confirm.click();
      await A.waitFor('selected area portal', (name) => window.__foe.store.get().hud?.portal?.mapName === name && !window.__foe.store.get().character.mapDevice, area.name);
      if (area.entranceKey) assert(await A.eval(currencyOnHand, area.entranceKey) === keyBefore - 1, 'wrong key payment');
      const fee = Math.max(0, Math.floor((tier - 1) / 3));
      assert(await A.eval(currencyOnHand, 'scrap') === scrapBefore - fee, 'wrong territory fee');
      await closePanels(A);
    });
    if (!play.includes(areaId)) continue;
    await step(`${area.name}: complete its real encounter chain and map objective`, async () => {
      await clickPortal(A);
      await A.waitFor('in the selected area', id => window.__foe.store.get().run?.atlasAreaId === id, areaId);
      assert(await A.eval(() => !Object.hasOwn(window.__foe.store.get().run, 'event')), 'encounter chain leaked');
      if (area.chosenClass) assert(await A.eval(() => window.__foe.store.get().run.lootClass === 'ring'), 'reward class was not retained');
      await A.eval(() => {
        window.__atlasPlay = { last: '', hold: '', resolved: [] };
        window.__foe.bot.enable({ returnPortal: false, collect: false });
      });
      await A.waitFor('full area objective', () => {
        const f = window.__foe, state = window.__atlasPlay, event = f.world.view.run.event;
        const phase = event ? `${event.kind}:${event.phase}` : '';
        if (phase !== state.last && event && ['complete', 'failed'].includes(event.phase)) state.resolved.push(event.kind);
        state.last = phase;
        if (event?.phase === 'available') {
          const key = `${event.x},${event.y}`;
          if (state.hold !== key) {
            state.hold = key;
            f.bot.enable({ returnPortal: false, collect: false, hold: { x: event.x, y: event.y } });
          }
        } else if (state.hold && event && ['complete', 'failed'].includes(event.phase)) {
          state.hold = '';
          f.bot.enable({ returnPortal: false, collect: false });
        }
        return f.world.view.run.phase === 'cleared';
      }, undefined, 600000);
      const resolved = await A.eval(() => window.__atlasPlay.resolved);
      if (area.encounters) assert(isDeepStrictEqual(resolved, area.encounters.map(e => e.kind)), `wrong encounter sequence: ${resolved.join(', ')}`);
      assert(await A.eval(id => window.__foe.store.get().character.atlas.completed.includes(id), areaId), 'Atlas credit missing');
      await A.shot(`atlas-${areaId}-cleared-${VW}x${VH}`);
      await A.eval(() => window.__foe.bot.disable());
      const leave = await A.eval(() => window.__foe.send({ c: 'leaveMap' }));
      assert(leave.ok, leave.error);
      await A.waitFor('home after area clear', () => window.__foe.store.get().hud?.zone === 'hideout');
      await closePanels(A);
    });
  }
}

async function craftingScenario({ A, port }) {
  const shot = async name => {
    await settlePanels(A);
    await A.page.waitForFunction(() => [...document.querySelectorAll('.fe-tooltip-layer')].every(e => getComputedStyle(e).opacity === '1'));
    await A.shot(`${ECONOMY_ONLY ? 'economy-' : ''}${name}-${VW}x${VH}`);
  };
  await step('prepare advanced gear and runes in the disposable database', async () => {
    outage = true;
    await stopGameServer();
    const { DatabaseSync } = await import('node:sqlite');
    const { tsImport } = await import('tsx/esm/api');
    const { ATLAS_AREA_IDS } = await tsImport('../src/contracts/atlas.ts', import.meta.url);
    const { BASES } = await tsImport('../src/data/items/index.ts', import.meta.url);
    const { buildEquipment, generateEquipment, addToBackpack } = await tsImport('../src/game/items/index.ts', import.meta.url);
    const { createRng } = await tsImport('../src/core/rng.ts', import.meta.url);
    const db = new DatabaseSync(join(tmp, 'e2e.db'));
    const row = db.prepare('SELECT account_id, data FROM account_storage').get();
    const shared = JSON.parse(row.data);
    shared.atlas = { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 12 };
    shared.currencyStash = { prefixRune: 2, suffixRune: 2, ...(ECONOMY_ONLY ? { scrap: 500 } : {}) };
    db.prepare('UPDATE account_storage SET data = ? WHERE account_id = ?').run(JSON.stringify(shared), row.account_id);
    const character = db.prepare('SELECT id, data FROM characters').get();
    let saved = JSON.parse(character.data);
    saved.level = 46;
    saved.backpack.entries = [];
    saved.equipment.mainHand = buildEquipment({ uid: 'e2e-rune-project', baseId: 'emberheartWand', itemLevel: 46,
      rarity: 'rare', name: 'Ember Testament', ...(ECONOMY_ONLY ? { stability: 6 } : {}), affixes: [
        { affixId: 'fireDamage', tier: 6 }, { affixId: 'spellDamage', tier: 6 },
        { affixId: 'castSpeed', tier: 6 }, { affixId: 'critChance', tier: 6 },
      ] }, createRng(1));
    for (const base of Object.values(BASES).filter(b => b.levelRequirement >= 42)) {
      if (base.id === 'emberheartWand') continue;
      const result = addToBackpack(saved, generateEquipment(base.id, 46, 'normal', createRng(base.name.length), { uid: `e2e-${base.id}` }));
      assert(result.ok, `cannot place ${base.id}`);
      saved = result.value;
    }
    if (ECONOMY_ONLY) {
      const addition = addToBackpack(saved, { kind: 'map', uid: 'e2e-sink-map:i1', baseId: 'ashenForge', tier: 5,
        rarity: 'rare', quality: 7, corrupted: false,
        mods: [{ modId: 'teeming', value: 100 }, { modId: 'restless', value: 110 }, { modId: 'commanded', value: 95 }] });
      assert(addition.ok, 'cannot place service map');
      saved = addition.value;
    }
    saved.mapDevice = { kind: 'map', uid: 'e2e-source-map', baseId: 'ashenForge', tier: 3, rarity: 'normal', mods: [], quality: 0, corrupted: false };
    db.prepare('UPDATE characters SET data = ? WHERE id = ?').run(JSON.stringify(saved), character.id);
    db.close();
    await startGameServer(port);
    await A.waitFor('advanced project after restart', () => {
      const s = window.__foe.store.get();
      return s.connection === 'online' && s.character?.equipment.mainHand?.uid === 'e2e-rune-project';
    }, undefined, 30_000);
    outage = false;
    await A.page.keyboard.press('i');
    await A.page.waitForSelector('.fe-grid[data-drop="backpack"]');
    await settlePanels(A);
    await A.page.mouse.move(10, 10);
    await shot('crafting-advanced-bases');
  });
  await step('both rune previews and bench clicks preserve the opposite affixes', async () => {
    await closePanels(A);
    const at = await walkUntilOnScreen(A, () => propOnScreen(A, 'anvil', 8), 'the anvil');
    await clickWorld(A, at, 'the anvil');
    await A.page.waitForSelector('.fe-bench');
    await A.page.locator('[data-drop="equip"] .fe-item[data-uid="e2e-rune-project"]').click({ modifiers: ['Control'] });
    await A.waitFor('project on bench', () => window.__foe.store.get().benchItemUid === 'e2e-rune-project');
    for (const [id, label, kept] of [
      ['prefixRune', 'Prefix Rune', ['castSpeed', 'critChance']],
      ['suffixRune', 'Suffix Rune', null],
    ]) {
      const before = await A.eval(() => structuredClone(window.__foe.store.get().character.equipment.mainHand));
      const keptIds = kept ?? before.affixes.filter(a => !['castSpeed', 'critChance'].includes(a.affixId)).map(a => a.affixId);
      const button = A.page.getByRole('button', { name: label, exact: true });
      await button.hover();
      await A.page.waitForSelector('.fe-curtip');
      await shot(`crafting-${id}-preview`);
      await button.click();
      await A.waitFor(`${id} consumed from shared stash`, (id) => window.__foe.store.get().character.currencyStash[id] === 1, id);
      const after = await A.eval(() => window.__foe.store.get().character.equipment.mainHand);
      assert(after.stability === before.stability - 3, 'rune paid the wrong stability');
      assert(after.affixes.length === before.affixes.length, 'rune changed affix count');
      assert(after.name === before.name && after.rarity === before.rarity, 'rune changed item identity');
      for (const id of keptIds) assert(JSON.stringify(after.affixes.find(a => a.affixId === id)) === JSON.stringify(before.affixes.find(a => a.affixId === id)), `rune changed preserved ${id}`);
      await A.page.mouse.move(10, 10);
      await sleep(350);
    }
    await shot('crafting-runes-applied');
  });
  if (ECONOMY_ONLY) await step('repair Finished gear twice and commission a selectively rerolled Bounty map through the bench', async () => {
    const before = await A.eval(() => structuredClone(window.__foe.store.get().character.equipment.mainHand));
    assert(before.stability === 0, 'the project should be Finished');
    for (let n = 1; n <= 2; n++) {
      const quoted = await A.eval(() => {
        const s = window.__foe.store.get();
        const service = window.__foe.store.rules.benchServices(s.character, s.benchItemUid).find(s => s.id === 'bench:repair');
        return { price: service.cost[0].count, scrap: s.character.currencyStash.scrap };
      });
      await A.page.locator('.fe-bench-service details summary').first().click();
      await shot(`repair-${n}-price`);
      await A.page.locator('[data-service="bench:repair"]').click();
      await A.waitFor('repaired Stability', n => window.__foe.store.get().character.equipment.mainHand.stability === n, n);
      const now = await A.eval(() => ({ item: window.__foe.store.get().character.equipment.mainHand, scrap: window.__foe.store.get().character.currencyStash.scrap }));
      assert(now.scrap === quoted.scrap - quoted.price, 'repair charged a different price');
      assert(now.item.repairCount === n, 'repair lifetime counter was not saved');
      assert(JSON.stringify(now.item.scars) === JSON.stringify(before.scars), 'repair changed scars');
      assert(JSON.stringify(now.item.affixes) === JSON.stringify(before.affixes), 'repair changed affixes');
    }
    await A.page.locator('.fe-grid[data-drop="backpack"] .fe-item[data-uid="e2e-sink-map:i1"]').click({ modifiers: ['Control'] });
    await A.waitFor('map on bench', () => window.__foe.store.get().benchItemUid === 'e2e-sink-map:i1');
    const beforeMap = await A.eval(() => structuredClone(window.__foe.store.get().character.backpack.entries.find(e => e.item.uid === 'e2e-sink-map:i1').item));
    await A.page.locator('[data-service="bench:map:teeming"]').click();
    await A.waitFor('selected danger mod replaced', () => !window.__foe.store.get().character.backpack.entries.find(e => e.item.uid === 'e2e-sink-map:i1').item.mods.some(m => m.modId === 'teeming'));
    const afterMap = await A.eval(() => window.__foe.store.get().character.backpack.entries.find(e => e.item.uid === 'e2e-sink-map:i1').item);
    for (const kept of beforeMap.mods.slice(1)) assert(afterMap.mods.some(m => JSON.stringify(m) === JSON.stringify(kept)), 'reroll changed an unselected mod');
    assert(afterMap.quality === 7 && afterMap.rarity === 'rare' && afterMap.mods.length === 3, 'reroll changed the map structure');
    await A.page.locator('[data-service="bench:bounty"]').click();
    await A.waitFor('Bounty commission', () => window.__foe.store.get().character.backpack.entries.find(e => e.item.uid === 'e2e-sink-map:i1').item.bounty === true);
    await A.page.mouse.move(10, 10);
    await shot('bounty-map');
  });
  await step('rune stash slots and Atlas boss sources are visible', async () => {
    await closePanels(A);
    await openStashTab(A, 'currency');
    for (const id of ['prefixRune', 'suffixRune']) assert(await A.page.locator(`.fe-cslot[data-currency="${id}"]`).count() === 1, `missing ${id} slot`);
    await A.page.mouse.move(10, 10);
    await shot('crafting-rune-stash');
    const bindingSlot = A.page.locator('.fe-cslot[data-currency="fractureCore"]');
    await bindingSlot.scrollIntoViewIfNeeded();
    const bindingBox = await bindingSlot.boundingBox();
    assert(bindingBox && bindingBox.y > 0 && bindingBox.y + bindingBox.height < VH - 90, 'lower crafting currencies are unreachable');
    const blockedSlots = await A.eval(() => [...document.querySelectorAll('.fe-cstash .fe-cslot')].filter(el => {
      const r = el.getBoundingClientRect();
      const parent = el.closest('.fe-cstash').getBoundingClientRect();
      const visible = r.top >= parent.top && r.bottom <= parent.bottom;
      return visible && !el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }).map(el => el.dataset.currency));
    assert(blockedSlots.length === 0, `currency controls are covered: ${blockedSlots.join(', ')}`);
    await shot('crafting-stash-binding');
    await closePanels(A);
    let at = await propOnScreen(A, 'mapDevice');
    for (let i = 0; i < 30 && at && (at.y < 90 || at.y > VH - 170); i++) {
      const key = at.y < 90 ? 'w' : 's';
      await A.page.keyboard.down(key); await sleep(180); await A.page.keyboard.up(key); await sleep(120);
      at = await propOnScreen(A, 'mapDevice');
    }
    assert(at && at.y >= 60 && at.y <= VH - 140, 'map device is not on screen');
    await A.page.mouse.click(at.x, at.y);
    await A.page.waitForSelector('.fe-device');
    await A.page.locator('.fe-device__destination').click();
    for (const [area, rune] of [['Glass Sepulchre', 'Prefix Rune'], ['Ember Vault', 'Suffix Rune']]) {
      await A.page.getByRole('button', { name: new RegExp(`^${area},`) }).click();
      const detail = await A.page.locator('.fe-atlas__detail').innerText();
      assert(detail.includes(rune) && detail.includes('25%'), 'missing ingredient source');
      await shot(`crafting-source-${rune.split(' ')[0]}`);
    }
  });
  if (ECONOMY_ONLY) await step('the Map Device shows and spends the territory fee once and guarantees The Hunted', async () => {
    await A.page.getByRole('button', { name: /^Glass Sepulchre,/ }).click();
    await A.page.getByRole('button', { name: 'Use this area', exact: true }).click();
    await A.page.locator('.fe-grid[data-drop="backpack"] .fe-item[data-uid="e2e-sink-map:i1"]').click({ modifiers: ['Control'] });
    await A.waitFor('Bounty in device', () => window.__foe.store.get().character.mapDevice?.uid === 'e2e-sink-map:i1');
    const text = await A.page.locator('.fe-device').innerText();
    assert(text.includes('Territory fee: 1 Scrap'), 'missing upfront fee');
    assert(text.includes('The Hunted 100%'), 'Bounty encounter odds are not guaranteed');
    const before = await A.eval(() => window.__foe.store.get().character.currencyStash.scrap);
    await shot('territory-fee');
    await A.page.locator('.fe-device__activate').click();
    await A.waitFor('paid portal', () => window.__foe.store.get().hud?.portal?.tier === 5 && !window.__foe.store.get().character.mapDevice);
    const after = await A.eval(() => window.__foe.store.get().character.currencyStash.scrap);
    assert(after === before - 1, 'wrong territory payment');
  });
  await step('crafted advanced gear and rune counts survive a real server restart', async () => {
    const before = await A.eval(() => structuredClone(window.__foe.store.get().character.equipment.mainHand));
    const scrapBefore = await A.eval(() => window.__foe.store.get().character.currencyStash.scrap);
    outage = true;
    await stopGameServer();
    await startGameServer(port);
    await A.waitFor('reconnected with crafted item', () => window.__foe.store.get().connection === 'online', undefined, 30_000);
    outage = false;
    const after = await A.eval(() => ({ item: window.__foe.store.get().character.equipment.mainHand, stash: window.__foe.store.get().character.currencyStash }));
    assert(JSON.stringify(after.item) === JSON.stringify(before), 'crafted item changed on restart');
    assert(after.stash.prefixRune === 1 && after.stash.suffixRune === 1, 'rune count changed on restart');
    assert(after.stash.scrap === scrapBefore, 'Scrap changed on restart or territory was charged twice');
  });
}

async function debugMerchantScenario({ A, B, base, port, nameA, nameB, suffix }) {
  const cli = action => new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/debug-merch-cli.ts', `e2e_a_${suffix}`, nameA, action],
      { cwd: root, env: { ...process.env, DB_PATH: join(tmp, 'e2e.db') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    proc.stdout.on('data', b => { output += b; }); proc.stderr.on('data', b => { output += b; });
    proc.on('error', reject); proc.on('exit', code => code === 0 ? resolve(output) : reject(new Error(output)));
  });
  const merchantVisible = () => window.__foe.world.view.props.some(p => p.kind === 'debugMerchant');
  const open = async player => {
    await closePanels(player);
    const at = await walkUntilOnScreen(player, () => propOnScreen(player, 'debugMerchant', 10), 'Mira');
    await clickWorld(player, at, 'Mira'); await player.page.waitForSelector('.fe-debug-merchant');
  };
  const buy = async (player, id) => {
    const before = await player.eval(() => JSON.stringify(window.__foe.store.get().character.backpack.entries));
    await player.page.locator(`[data-debug-offer="${id}"] button`).click();
    await player.waitFor('purchase delivered', before => JSON.stringify(window.__foe.store.get().character.backpack.entries) !== before, before);
  };
  await step('CLI enables only the named character while both players are online', async () => {
    await registerAndPlay(B, base, `e2e_b_${suffix}`, 'emberpass-B1', nameB);
    assert(!await A.eval(merchantVisible) && !await B.eval(merchantVisible), 'merchant should default to disabled');
    assert((await cli('enable')).includes('enabled'), 'CLI did not enable merchant');
    await A.waitFor('Mira appears live', merchantVisible);
    assert(!await B.eval(merchantVisible), 'activation leaked to another hideout');
    await A.shot(`debug-merchant-world-${VW}x${VH}`);
  });
  await step('buy all scarab tiers and inspect configurable map and equipment stock', async () => {
    await open(A);
    await A.page.getByLabel('Quantity', { exact: true }).fill('20');
    const ids = await A.page.locator('[data-debug-offer]').evaluateAll(rows => rows.map(row => row.dataset.debugOffer));
    assert(ids.length === 8, 'expected all eight scarabs');
    for (const id of ids) await buy(A, id);
    await A.page.mouse.move(VW / 2, VH / 2);
    await A.shot(`debug-merchant-scarabs-${VW}x${VH}`);
    await A.page.getByLabel('Quantity', { exact: true }).fill('1');
    await A.page.getByLabel('Testing category').selectOption('Maps');
    await A.page.getByLabel('Map tier', { exact: true }).fill('15');
    await A.page.getByLabel('Testing rarity').selectOption('rare');
    await buy(A, 'map:ashenForge');
    assert(await A.eval(() => window.__foe.store.get().character.backpack.entries.some(e => e.item.kind === 'map' && e.item.tier === 15 && e.item.rarity === 'rare' && e.item.mods.length)), 'selected map tier/rarity ignored');
    await A.shot(`debug-merchant-maps-${VW}x${VH}`);
    await A.page.getByLabel('Testing category').selectOption('Bases');
    await A.page.getByLabel('Item level', { exact: true }).fill('46');
    await A.page.getByLabel('Search testing stock').fill('wand');
    const baseId = await A.page.locator('[data-debug-offer]').first().getAttribute('data-debug-offer');
    await buy(A, baseId);
    assert(await A.eval(() => window.__foe.store.get().character.backpack.entries.some(e => e.item.kind === 'equipment' && e.item.itemLevel === 46 && e.item.rarity === 'rare')), 'selected equipment level/rarity ignored');
    await A.page.getByLabel('Testing category').selectOption('Uniques');
    await A.page.getByLabel('Item level', { exact: true }).fill('22');
    const uniqueId = await A.page.locator('[data-debug-offer]').first().getAttribute('data-debug-offer');
    await buy(A, uniqueId);
    await A.page.locator(`[data-debug-offer="${uniqueId}"]`).hover();
    await A.shot(`debug-merchant-unique-${VW}x${VH}`);
    const bounds = await A.page.locator('.fe-debug-merchant').boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.y + bounds.height <= VH, 'merchant exceeds viewport');
    return 'eight scarabs, T15 rare map, ilvl46 rare base and unique delivered';
  });
  await step('guest visits the enabled hideout and buys with no change to host inventory', async () => {
    await closePanels(A); await A.page.keyboard.press('p');
    await A.page.waitForSelector('#fe-invite-name'); await A.page.fill('#fe-invite-name', nameB);
    await A.page.click('.fe-invite button:has-text("Invite")');
    await B.page.waitForSelector('.fe-invite-card'); await B.page.click('.fe-invite-card button:has-text("Join")');
    await B.waitFor('party of two', () => window.__foe.store.get().party?.members.length === 2);
    await B.page.keyboard.press('p');
    await B.page.locator('.fe-member', { hasText: nameA }).locator('button:has-text("Visit hideout")').click();
    await B.waitFor('host hideout', owner => window.__foe.store.get().hud?.zoneOwnerName === owner && !window.__foe.store.get().hud.zoneIsOwn, nameA);
    await B.waitFor('guest sees Mira', merchantVisible);
    const before = await A.eval(() => JSON.stringify(window.__foe.store.get().character.backpack.entries));
    await open(B); await B.page.getByLabel('Quantity', { exact: true }).fill('5'); await buy(B, 'currency:invasionScarab4');
    assert(await B.eval(() => window.__foe.store.get().character.backpack.entries.some(e => e.item.currencyId === 'invasionScarab4' && e.item.count === 5)), 'guest purchase missing');
    assert(before === await A.eval(() => JSON.stringify(window.__foe.store.get().character.backpack.entries)), 'guest changed host inventory');
    await B.shot(`debug-merchant-guest-${VW}x${VH}`);
  });
  await step('disable is immediate for stale purchase panels and removes the NPC for everyone', async () => {
    const before = await B.eval(() => JSON.stringify(window.__foe.store.get().character.backpack.entries));
    assert((await cli('disable')).includes('disabled'), 'CLI did not disable');
    await B.page.locator('[data-debug-offer="currency:invasionScarab4"] button').click();
    await B.waitFor('purchase rejected', () => window.__foe.store.get().toasts.some(t => t.text.includes('not active')));
    assert(before === await B.eval(() => JSON.stringify(window.__foe.store.get().character.backpack.entries)), 'disabled merchant delivered items');
    await A.waitFor('host NPC removed', () => !window.__foe.world.view.props.some(p => p.kind === 'debugMerchant'));
    await B.waitFor('guest NPC removed', () => !window.__foe.world.view.props.some(p => p.kind === 'debugMerchant'));
    assert((await cli('status')).includes('disabled'), 'CLI status is wrong');
  });
  await step('activation and purchases survive a real server restart', async () => {
    await cli('enable'); await A.waitFor('merchant enabled again', merchantVisible);
    const before = await B.eval(() => JSON.stringify(window.__foe.store.get().character.backpack.entries));
    outage = true; await stopGameServer(); await startGameServer(port);
    for (const p of [A, B]) await p.waitFor('online after restart', () => window.__foe.store.get().connection === 'online', undefined, 30000);
    outage = false;
    await A.waitFor('merchant restored', merchantVisible);
    assert(before === await B.eval(() => JSON.stringify(window.__foe.store.get().character.backpack.entries)), 'purchase changed at restart');
    assert((await cli('status')).includes('enabled'), 'activation did not persist');
  });
}

async function scarabsScenario({ A, port }) {
  const { tsImport } = await import('tsx/esm/api');
  const { SCARABS } = await tsImport('../src/data/scarabs.ts', import.meta.url);
  const openDevice = async () => {
    await closePanels(A);
    const at = await walkUntilOnScreen(A, () => propOnScreen(A, 'mapDevice', 10), 'map device');
    await clickWorld(A, at, 'map device'); await A.page.waitForSelector('.fe-device');
  };
  await step('prepare rare scarabs in a disposable shared stash', async () => {
    outage = true; await stopGameServer();
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(tmp, 'e2e.db'));
    const row = db.prepare('SELECT account_id, data FROM account_storage').get(), shared = JSON.parse(row.data);
    for (const scarab of SCARABS) shared.currencyStash[scarab.id] = 3;
    db.prepare('UPDATE account_storage SET data = ? WHERE account_id = ?').run(JSON.stringify(shared), row.account_id);
    const char = db.prepare('SELECT id, data FROM characters').get(), ch = JSON.parse(char.data);
    ch.mapDevice = { kind: 'map', uid: 'scarab-map:i1', baseId: 'ashenForge', tier: 1, quality: 0, rarity: 'normal', mods: [], corrupted: false };
    ch.backpack.entries = []; ch.level = 99; ch.allocated = { str: 490, dex: 0, int: 0 };
    db.prepare('UPDATE characters SET data = ? WHERE id = ?').run(JSON.stringify(ch), char.id);
    db.close(); await startGameServer(port);
    await A.waitFor('scarabs after reconnect', () => window.__foe.store.get().connection === 'online' && window.__foe.store.get().character?.currencyStash.hasteScarab4 === 3, undefined, 30000);
    outage = false;
  });
  await step('inspect every scarab tier, load from stash and remove through the device', async () => {
    await openDevice();
    assert(await A.page.locator('[data-drop="scarabSlot"]').count() === 4, 'expected four sockets beside one map');
    await A.page.locator('.fe-device__scarab-picker summary').click();
    await A.shot(`scarabs-picker-${VW}x${VH}`);
    for (const scarab of SCARABS) {
      await A.page.locator('.fe-device__scarab-choice').filter({ hasText: scarab.name }).click();
      await A.waitFor('scarab loaded', id => window.__foe.store.get().character.mapScarabs?.[0]?.currencyId === id, scarab.id);
      await A.page.locator('[data-drop="scarabSlot"][data-index="0"] .fe-item').hover();
      await A.shot(`scarab-${scarab.id}-${VW}x${VH}`);
      await A.page.getByRole('button', { name: 'Remove scarab 1', exact: true }).click();
      await A.waitFor('scarab removed', () => !window.__foe.store.get().character.mapScarabs?.[0]);
    }
    assert(await A.eval(() => Object.entries(window.__foe.store.get().character.currencyStash).filter(([id]) => id.includes('Scarab')).every(([, count]) => count === 2)), 'socketting did not take exactly one');
    await A.page.locator('.fe-device__scarab-picker summary').click();
  });
  await step('drag and Ctrl-click load distinct types and reject a second tier of the same type', async () => {
    const uid = await A.eval(() => window.__foe.store.get().character.backpack.entries.find(e => e.item.currencyId === 'hasteScarab4').item.uid);
    const source = A.page.locator(`[data-drop="backpack"] .fe-item[data-uid="${uid}"]`);
    const target = A.page.locator('[data-drop="scarabSlot"][data-index="2"]');
    await target.scrollIntoViewIfNeeded();
    const a = await source.boundingBox(), b = await target.boundingBox();
    assert(a && b, 'scarab drag targets missing');
    await A.page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await A.page.mouse.down();
    await A.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 }); await A.page.mouse.up();
    await A.waitFor('dragged scarab loaded', () => window.__foe.store.get().character.mapScarabs?.[2]?.currencyId === 'hasteScarab4');
    for (const id of ['hasteScarab1', 'invasionScarab4']) {
      const uid = await A.eval(id => window.__foe.store.get().character.backpack.entries.find(e => e.item.currencyId === id).item.uid, id);
      await A.page.locator(`[data-drop="backpack"] .fe-item[data-uid="${uid}"]`).click({ modifiers: ['Control'] });
      if (id === 'invasionScarab4') await A.waitFor('Ctrl-click scarab loaded', id => window.__foe.store.get().character.mapScarabs?.some(i => i?.currencyId === id), id);
    }
    assert(await A.eval(() => window.__foe.store.get().character.mapScarabs.filter(Boolean).length === 2), 'duplicate scarab type accepted');
    await A.page.locator('.fe-device__scarab-picker summary').click();
    for (const scarab of SCARABS) assert(await A.page.locator('.fe-device__scarab-choice').filter({ hasText: scarab.name }).isDisabled(), 'duplicate tier remains selectable');
    await A.page.locator('.fe-device__scarab-picker summary').click();
    await A.shot(`scarabs-loaded-${VW}x${VH}`);
    const summary = A.page.getByText('Scarab wave duration', { exact: true }); await summary.scrollIntoViewIfNeeded();
    assert((await A.page.locator('.fe-device__summary').innerText()).includes('30s'), 'combined wave duration missing');
    await A.shot(`scarabs-readout-${VW}x${VH}`);
    const bounds = await A.page.locator('.fe-device__activate').boundingBox();
    assert(bounds && bounds.y + bounds.height <= VH, 'activation exceeds viewport');
  });
  await step('loaded sockets survive restart, activation consumes once, and the map opens on wave five', async () => {
    const before = await A.eval(() => window.__foe.store.get().character.mapScarabs);
    outage = true; await stopGameServer(); await startGameServer(port);
    await A.waitFor('loaded sockets restored', () => window.__foe.store.get().connection === 'online', undefined, 30000); outage = false;
    assert(isDeepStrictEqual(before, await A.eval(() => window.__foe.store.get().character.mapScarabs)), 'loaded scarabs lost at restart');
    await openDevice(); await A.page.locator('.fe-device__activate').click();
    await A.waitFor('scarabs consumed', () => !!window.__foe.store.get().hud?.portal && !window.__foe.store.get().character.mapDevice && !window.__foe.store.get().character.mapScarabs.some(Boolean));
    await clickPortal(A);
    await A.waitFor('wave five opening', () => window.__foe.store.get().hud?.run?.wave === 5, undefined, 20000);
    assert(await A.eval(() => window.__foe.store.get().hud.run.monstersAlive >= 380), 'opening omitted earlier-wave monsters');
    assert(await A.eval(() => window.__foe.world.view.run.waveDuration === 30), 'shortened wave timer missing');
    await A.shot(`scarabs-wave-five-${VW}x${VH}`);
    outage = true; await stopGameServer(); await startGameServer(port);
    await A.waitFor('scarab expedition restored', () => window.__foe.store.get().connection === 'online' && window.__foe.store.get().zone === 'map', undefined, 30000); outage = false;
    assert(await A.eval(() => window.__foe.store.get().run.scarabs.length === 2 && !window.__foe.store.get().character.mapScarabs.some(Boolean)), 'expedition restarted without its paid scarabs');
  });
}

async function mapTreeScenario({ A, port }) {
  const { tsImport } = await import('tsx/esm/api');
  const { ATLAS_AREA_IDS } = await tsImport('../src/contracts/atlas.ts', import.meta.url);
  const { MAP_TREE, MAP_TREE_BRANCHES } = await tsImport('../src/data/progression/map-tree.ts', import.meta.url);
  const openDevice = async () => {
    await closePanels(A);
    const at = await walkUntilOnScreen(A, () => propOnScreen(A, 'mapDevice', 10), 'map device');
    await clickWorld(A, at, 'map device'); await A.page.waitForSelector('.fe-device');
  };
  await step('prepare a completed account Atlas and Scrap in a disposable database', async () => {
    outage = true; await stopGameServer();
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(tmp, 'e2e.db'));
    const row = db.prepare('SELECT account_id, data FROM account_storage').get();
    const shared = JSON.parse(row.data);
    shared.atlas = { discovered: [...ATLAS_AREA_IDS], completed: [...ATLAS_AREA_IDS], clears: 25 };
    shared.currencyStash.scrap = 100;
    db.prepare('UPDATE account_storage SET data = ? WHERE account_id = ?').run(JSON.stringify(shared), row.account_id);
    const char = db.prepare('SELECT id, data FROM characters').get(), ch = JSON.parse(char.data);
    ch.mapDevice = { kind: 'map', uid: 'tree-map:i1', baseId: 'ashenForge', tier: 1, quality: 0, rarity: 'normal', mods: [], corrupted: false };
    ch.backpack.entries = ch.backpack.entries.filter(e => e.item.kind !== 'currency');
    db.prepare('UPDATE characters SET data = ? WHERE id = ?').run(JSON.stringify(ch), char.id);
    db.close(); await startGameServer(port);
    await A.waitFor('completed Atlas after reconnect', () => window.__foe.store.get().connection === 'online' && window.__foe.store.get().character?.atlas.completed.length === 25, undefined, 30000);
    outage = false;
  });
  await step('all fifteen nodes can be inspected, allocated and refunded through the UI', async () => {
    await openDevice();
    await A.page.locator('.fe-device__destination').click();
    await A.page.getByRole('button', { name: /^Cinder Crossing,/ }).click();
    await A.page.getByRole('button', { name: 'Use this area', exact: true }).click();
    await A.page.getByRole('button', { name: /^Map tree/ }).click();
    assert(await A.page.locator('[data-map-node]').count() === 15, 'expected fifteen map nodes');
    await settlePanels(A); await A.shot(`tree-empty-${VW}x${VH}`);
    for (const branch of MAP_TREE_BRANCHES) {
      const path = MAP_TREE.filter(n => n.branch === branch);
      for (const node of path) {
        await A.page.locator(`[data-map-node="${node.id}"]`).click();
        assert((await A.page.locator('.fe-maptree__detail').innerText()).includes(node.text), 'missing exact effect');
        await A.page.getByRole('button', { name: 'Allocate point', exact: true }).click();
        await A.waitFor('node allocated', id => window.__foe.store.get().character.atlas.nodes?.includes(id), node.id);
      }
      await settlePanels(A); await A.shot(`tree-${branch}-${VW}x${VH}`);
      await A.page.locator(`[data-map-node="${path[0].id}"]`).click();
      assert(await A.page.getByRole('button', { name: 'Refund · 5 Scrap', exact: true }).isDisabled(), 'parent refunded before child');
      for (const node of [...path].reverse()) {
        await A.page.locator(`[data-map-node="${node.id}"]`).click();
        await A.page.getByRole('button', { name: 'Refund · 5 Scrap', exact: true }).click();
        await A.waitFor('node refunded', id => !window.__foe.store.get().character.atlas.nodes?.includes(id), node.id);
      }
    }
    assert(await A.eval(() => window.__foe.store.get().character.currencyStash.scrap === 25), 'refunds did not cost 75 Scrap');
    for (const node of MAP_TREE.slice(0, 10)) {
      await A.page.locator(`[data-map-node="${node.id}"]`).click();
      await A.page.getByRole('button', { name: 'Allocate point', exact: true }).click();
      await A.waitFor('node allocated', id => window.__foe.store.get().character.atlas.nodes?.includes(id), node.id);
    }
    await A.page.locator('[data-map-node="discerningEye"]').click();
    assert(await A.page.getByRole('button', { name: 'Allocate point', exact: true }).isDisabled(), 'point budget bypass');
    await A.shot(`tree-budget-${VW}x${VH}`);
    const bounds = await A.page.getByRole('button', { name: 'Back', exact: true }).boundingBox();
    assert(bounds && bounds.y + bounds.height <= VH, 'map-tree controls exceed viewport');
  });
  await step('the map readout includes choices, while respec only changes future expeditions', async () => {
    await A.page.getByRole('button', { name: 'Back', exact: true }).click();
    const summary = A.page.getByText('Map tree', { exact: true });
    await summary.scrollIntoViewIfNeeded(); await summary.click();
    assert((await A.page.locator('.fe-device__summary').innerText()).includes('Far Horizon'), 'map summary lacks allocated effects');
    await A.shot(`tree-preview-${VW}x${VH}`);
    await A.page.locator('.fe-device__activate').click();
    await A.waitFor('new portal', () => !!window.__foe.store.get().hud?.portal && !window.__foe.store.get().character.mapDevice);
    await clickPortal(A); await A.waitFor('entered tree expedition', () => window.__foe.store.get().zone === 'map');
    assert(await A.eval(() => window.__foe.store.get().run.mapTree.length === 10), 'map did not snapshot nodes');
    await A.eval(() => window.__foe.store.actions.leaveMap());
    await A.waitFor('back in hideout', () => window.__foe.store.get().zone === 'hideout');
    await openDevice(); await A.page.getByRole('button', { name: /^Map tree/ }).click();
    await A.page.locator('[data-map-node="farHorizon"]').click();
    await A.page.getByRole('button', { name: 'Refund · 5 Scrap', exact: true }).click();
    await A.waitFor('respec applied', () => window.__foe.store.get().character.atlas.nodes.length === 9);
    await clickPortal(A); await A.waitFor('reentered tree expedition', () => window.__foe.store.get().zone === 'map');
    assert(await A.eval(() => window.__foe.store.get().run.mapTree.includes('farHorizon')), 'respec changed existing expedition');
  });
  await step('account choices, paid refunds and the original expedition survive server restart', async () => {
    const before = await A.eval(() => ({ atlas: window.__foe.store.get().character.atlas, scrap: window.__foe.store.get().character.currencyStash.scrap, nodes: window.__foe.store.get().run.mapTree }));
    outage = true; await stopGameServer(); await startGameServer(port);
    await A.waitFor('tree restart', () => window.__foe.store.get().connection === 'online' && window.__foe.store.get().zone === 'map', undefined, 30000); outage = false;
    const after = await A.eval(() => ({ atlas: window.__foe.store.get().character.atlas, scrap: window.__foe.store.get().character.currencyStash.scrap, nodes: window.__foe.store.get().run.mapTree }));
    assert(isDeepStrictEqual(before, after), 'map-tree or currency state changed after restart');
    await A.shot(`tree-restarted-${VW}x${VH}`);
  });
}

async function uniquesScenario({ A, port }) {
  const { tsImport } = await import('tsx/esm/api');
  const { UNIQUES, getBase } = await tsImport('../src/data/items/index.ts', import.meta.url);
  const { ATLAS_AREA_IDS } = await tsImport('../src/contracts/atlas.ts', import.meta.url);
  const { generateUnique, addToBackpack } = await tsImport('../src/game/items/index.ts', import.meta.url);
  const { createRng } = await tsImport('../src/core/rng.ts', import.meta.url);
  const defs = Object.values(UNIQUES).filter(u => u.bossSource);
  await step('prepare the twelve boss uniques and explored destinations in a disposable account', async () => {
    outage = true; await stopGameServer();
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(tmp, 'e2e.db'));
    const row = db.prepare('SELECT id, data FROM characters').get();
    let ch = JSON.parse(row.data); ch.backpack.entries = []; ch.level = 80;
    ch.allocated = { str: 150, dex: 150, int: 200 };
    ch.mapDevice = { kind: 'map', uid: 'e2e-unique-map:i1', baseId: 'ashenForge', tier: 10, rarity: 'normal', quality: 0, mods: [], corrupted: false };
    const sorted = [...defs].sort((a, b) => getBase(b.baseId).size.h - getBase(a.baseId).size.h);
    for (const def of sorted) {
      const placed = addToBackpack(ch, generateUnique(def.id, createRng(101), { uid: `e2e-${def.id.toLowerCase()}:i1`, itemLevel: 88 }));
      assert(placed.ok, `no space for ${def.id}`); ch = placed.value;
    }
    db.prepare('UPDATE characters SET data = ? WHERE id = ?').run(JSON.stringify(ch), row.id);
    const account = db.prepare('SELECT account_id, data FROM account_storage').get();
    const shared = JSON.parse(account.data);
    shared.atlas = { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 }; shared.currencyStash.scrap = 100;
    db.prepare('UPDATE account_storage SET data = ? WHERE account_id = ?').run(JSON.stringify(shared), account.account_id);
    db.close(); await startGameServer(port);
    await A.waitFor('unique collection after reconnect', () => window.__foe.store.get().connection === 'online'
      && window.__foe.store.get().character?.backpack.entries.filter(e => e.item.rarity === 'unique').length === 12, undefined, 30000);
    outage = false;
  });
  await step('all twelve unique icons, sources, behavior tooltips and equipment swaps work', async () => {
    await closePanels(A); await A.page.keyboard.press('i');
    await A.page.waitForSelector('.fe-grid[data-drop="backpack"]');
    for (const def of defs) {
      const uid = `e2e-${def.id.toLowerCase()}:i1`;
      const target = A.page.locator(`.fe-grid[data-drop="backpack"] .fe-item[data-uid="${uid}"]`);
      await target.hover();
      const tooltip = A.page.locator('.fe-tooltip-layer .fe-tt').first();
      await tooltip.waitFor();
      await A.waitFor('unique tooltip content', name => [...document.querySelectorAll('.fe-tt')].some(e => e.textContent.includes(name)), def.name);
      const text = await tooltip.innerText();
      assert(text.includes('Exclusive keystone drop') && text.includes(def.flags[0].text), `missing source or behavior for ${def.id}`);
      await settlePanels(A); await A.shot(`uniques-${def.id}-${VW}x${VH}`);
      const bounds = await tooltip.boundingBox();
      assert(bounds && bounds.y >= -1 && bounds.y + bounds.height <= VH + 1, `${def.id} tooltip exceeds the viewport`);
      await target.click({ modifiers: ['Control'] });
      await A.waitFor('unique equipped', uid => Object.values(window.__foe.store.get().character.equipment).some(i => i?.uid === uid), uid);
      assert(await A.eval(flag => window.__foe.store.rules.deriveStats(window.__foe.store.get().character).combat.flags.includes(flag), def.flags[0].flag), `missing equipped effect ${def.id}`);
      await A.page.locator(`[data-drop="equip"] .fe-item[data-uid="${uid}"]`).click({ modifiers: ['Control'] });
      await A.waitFor('unique returned to backpack', uid => window.__foe.store.get().character.backpack.entries.some(e => e.item.uid === uid), uid);
    }
  });
  await step('the Atlas and Map Device disclose all six exclusive pools and their actual chances', async () => {
    await closePanels(A);
    const at = await walkUntilOnScreen(A, () => propOnScreen(A, 'mapDevice', 10), 'map device');
    await clickWorld(A, at, 'map device'); await A.page.waitForSelector('.fe-device');
    for (const [name, first, second] of [
      ['Heart of the Forge', 'Everburn', 'The Sunken Sun'], ['Echo Bastion', 'Winterstride', 'Stillwinter'],
      ['Ember Citadel', 'Vigil of Ash', 'The Last Rite'], ['Frozen Passage', 'Choir of Glass', 'The Second Verse'],
      ['The Last Kiln', 'The Broken Link', 'Iron Refrain'], ['Eternal Arena', 'The Unbowed Crown', "Victor's Debt"],
    ]) {
      await A.page.locator('.fe-device__destination').click();
      await A.page.getByRole('button', { name: new RegExp(`^${name},`) }).click();
      const detail = await A.page.locator('.fe-atlas__detail').innerText();
      assert(detail.includes(first) && detail.includes(second) && detail.includes('T8+') && detail.includes('T10+'), 'missing keystone eligibility');
      await settlePanels(A); await A.shot(`uniques-source-${name.replaceAll(' ', '-')}-${VW}x${VH}`);
      await A.page.getByRole('button', { name: 'Use this area', exact: true }).click();
      const chance = A.page.getByText(/^Exclusive unique chance:/);
      await chance.scrollIntoViewIfNeeded();
      assert(/Exclusive unique chance: [1-9]/.test(await chance.innerText()), 'eligible keystone has no drop chance');
      await A.shot(`uniques-chance-${name.replaceAll(' ', '-')}-${VW}x${VH}`);
    }
  });
  await step('all twelve uniques survive a real server restart unchanged', async () => {
    const before = await A.eval(() => window.__foe.store.get().character.backpack);
    outage = true; await stopGameServer(); await startGameServer(port);
    await A.waitFor('unique restart', () => window.__foe.store.get().connection === 'online', undefined, 30000); outage = false;
    assert(isDeepStrictEqual(before, await A.eval(() => window.__foe.store.get().character.backpack)), 'unique collection changed after restart');
  });
}

async function ingredientsScenario({ A, port }) {
  const ids = ['scarBalm', 'anneal', 'graft', 'transmute', 'echoShard', 'crownFragment', 'compass', 'twinInk', 'voidSplinter'];
  const names = ['Scar Balm', 'Anneal', 'Graft', 'Transmute', 'Echo Shard', 'Crown Fragment', 'Compass', 'Twin Ink', 'Void Splinter'];
  const shot = async name => { await settlePanels(A); await A.shot(`ingredients-${name}-${VW}x${VH}`); };
  await step('prepare one project per advanced ingredient in the disposable database', async () => {
    outage = true; await stopGameServer();
    const { DatabaseSync } = await import('node:sqlite');
    const { tsImport } = await import('tsx/esm/api');
    const { buildEquipment, generateUnique, addToBackpack } = await tsImport('../src/game/items/index.ts', import.meta.url);
    const { createRng } = await tsImport('../src/core/rng.ts', import.meta.url);
    const db = new DatabaseSync(join(tmp, 'e2e.db'));
    const account = db.prepare('SELECT account_id, data FROM account_storage').get();
    const shared = JSON.parse(account.data);
    shared.currencyStash = Object.fromEntries(ids.map(id => [id, 2]));
    db.prepare('UPDATE account_storage SET data = ? WHERE account_id = ?').run(JSON.stringify(shared), account.account_id);
    const row = db.prepare('SELECT id, data FROM characters').get();
    let ch = JSON.parse(row.data); ch.backpack.entries = []; ch.level = 60;
    for (const id of ids) {
      const uid = `e2e-${id.toLowerCase()}:i1`, rng = createRng(83);
      let item;
      if (id === 'crownFragment') item = generateUnique('thePatientSpark', rng, { uid });
      else if (['compass', 'twinInk', 'voidSplinter'].includes(id)) item = {
        kind: 'map', uid, baseId: 'ashenForge', tier: 3, rarity: 'magic', quality: 12, corrupted: id === 'voidSplinter',
        mods: [{ modId: 'teeming', value: 108 }, { modId: 'gilded', value: 102 },
          ...(id === 'voidSplinter' ? [{ modId: 'echo', value: 100, corrupted: true }] : [])],
      };
      else {
        item = buildEquipment({ uid, baseId: 'emberRing', itemLevel: 60, rarity: 'magic',
          stability: ['scarBalm', 'anneal'].includes(id) ? 0 : 8,
          affixes: [{ affixId: 'life', tier: 5 }, { affixId: 'coldResistance', tier: 5, sealed: true }],
        }, rng);
        if (id === 'scarBalm') item.scars = [{ scarId: 'frail', value: 5 }];
      }
      const placed = addToBackpack(ch, item); assert(placed.ok, `cannot place ${id}`); ch = placed.value;
    }
    db.prepare('UPDATE characters SET data = ? WHERE id = ?').run(JSON.stringify(ch), row.id);
    db.close(); await startGameServer(port);
    await A.waitFor('ingredient projects after reconnect', () => window.__foe.store.get().connection === 'online'
      && window.__foe.store.get().character?.currencyStash?.crownFragment === 2, undefined, 30000);
    outage = false;
  });
  await step('apply every new ingredient through the bench palette, including Graft affix selection', async () => {
    await closePanels(A);
    const at = await walkUntilOnScreen(A, () => propOnScreen(A, 'anvil', 8), 'the anvil');
    await clickWorld(A, at, 'the anvil'); await A.page.waitForSelector('.fe-bench');
    for (let n = 0; n < ids.length; n++) {
      const id = ids[n], uid = `e2e-${id.toLowerCase()}:i1`;
      const target = A.page.locator(`.fe-grid[data-drop="backpack"] .fe-item[data-uid="${uid}"]`);
      await target.click({ modifiers: ['Control'] });
      await A.waitFor('ingredient target on bench', uid => window.__foe.store.get().benchItemUid === uid, uid);
      const button = A.page.getByRole('button', { name: names[n], exact: true });
      await button.scrollIntoViewIfNeeded(); await button.hover();
      await A.page.waitForSelector('.fe-curtip');
      await shot(`${id}-preview`);
      const bounds = await A.page.locator('.fe-curtip').boundingBox();
      assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= VH + 1, `${id} preview exceeds viewport`);
      await button.click();
      if (id === 'graft') {
        await A.page.waitForSelector('.fe-affix-choice'); await shot('graft-choice');
        await A.page.locator('.fe-affix-choice .fe-affix-row:not([disabled])').first().click();
      }
      await A.waitFor(`${id} applied exactly once`, id => window.__foe.store.get().character.currencyStash[id] === 1, id);
      await A.page.mouse.move(10, 10); await sleep(250);
    }
  });
  await step('all new stash slots are reachable and expose their drop sources', async () => {
    await closePanels(A);
    for (const tab of ['currency', 'mapCurrency']) {
      await openStashTab(A, tab);
      for (const id of ids.filter(id => (['compass', 'twinInk', 'voidSplinter'].includes(id)) === (tab === 'mapCurrency'))) {
        const slot = A.page.locator(`.fe-cslot[data-currency="${id}"]`);
        await slot.scrollIntoViewIfNeeded(); await slot.hover(); await sleep(200);
        const b = await slot.boundingBox();
        assert(b && b.y > 0 && b.y + b.height < VH - 90, `${id} slot is unreachable`);
        assert(await slot.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), `${id} slot is covered`);
        await shot(`${id}-stash`);
      }
      await closePanels(A);
    }
  });
  await step('all nine crafted projects and shared material counts survive a real restart', async () => {
    const before = await A.eval(() => ({ backpack: window.__foe.store.get().character.backpack, stash: window.__foe.store.get().character.currencyStash }));
    outage = true; await stopGameServer(); await startGameServer(port);
    await A.waitFor('ingredient reconnect', () => window.__foe.store.get().connection === 'online', undefined, 30000);
    outage = false;
    const after = await A.eval(() => ({ backpack: window.__foe.store.get().character.backpack, stash: window.__foe.store.get().character.currencyStash }));
    assert(isDeepStrictEqual(after, before), `advanced crafts or payments changed after restart: ${JSON.stringify({ before, after })}`);
  });
}

async function eventsScenario({ A, port }) {
  const eventShot = async (name) => {
    await A.shot(`${name}-${VW}x${VH}`);
    if (VW !== 1024 || VH !== 600) {
      await A.page.setViewportSize({ width: 1024, height: 600 });
      await sleep(120);
      await A.shot(`${name}-600`);
      await A.page.setViewportSize({ width: VW, height: VH });
    }
  };
  await step('open a map for the event browser fixture', async () => {
    const result = await A.eval(async () => {
      const f = window.__foe;
      const item = f.store.get().character.backpack.entries.find(e => e.item.kind === 'map').item;
      let r = await f.send({ c: 'moveItem', uid: item.uid, to: { kind: 'mapDevice' } });
      if (!r.ok) return r;
      return f.send({ c: 'activateMapDevice' });
    });
    assert(result.ok, result.error);
  });
  for (const kind of opt('events', 'hunted,echoRift,blackout,vaultbreakers,wound,secondCrown').split(',')) {
    await step(`${kind}: seed the disposable map and strong browser-test character`, async () => {
      outage = true;
      await stopGameServer();
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(join(tmp, 'e2e.db'));
      const row = db.prepare('SELECT map_id, setup FROM open_maps').get();
      const setup = JSON.parse(row.setup);
      setup.event = { kind, wave: kind === 'secondCrown' ? 6 : 2, angle: 0 };
      const tier = kind === 'secondCrown' ? 5 : ['hunted', 'echoRift'].includes(kind) ? 1 : 3;
      setup.map.tier = tier;
      if (setup.sourceMap) setup.sourceMap.tier = tier;
      db.prepare('UPDATE open_maps SET setup = ?, cleared = 0, portals_remaining = 8 WHERE map_id = ?').run(JSON.stringify(setup), row.map_id);
      const ch = db.prepare('SELECT id, data FROM characters').get();
      const saved = JSON.parse(ch.data);
      saved.level = 60;
      saved.allocated = { str: 195, dex: 100, int: 195 };
      const { tsImport } = await import('tsx/esm/api');
      const { buildEquipment } = await tsImport('../src/game/items/index.ts', import.meta.url);
      const { createRng } = await tsImport('../src/core/rng.ts', import.meta.url);
      saved.equipment.mainHand = buildEquipment({ uid: 'e2e-events-wand:i1', baseId: 'emberheartWand', itemLevel: 88, rarity: 'rare',
        affixes: [{ affixId: 'spellDamage', tier: 1 }, { affixId: 'fireDamage', tier: 1 }, { affixId: 'addedSpellDamage', tier: 1 },
          { affixId: 'castSpeed', tier: 1 }, { affixId: 'critChance', tier: 1 }, { affixId: 'critMultiplier', tier: 1 }] }, createRng(81));
      for (const id of Object.keys(saved.skillRanks)) saved.skillRanks[id] = 20;
      saved.loadout = ['emberLance', 'emberNova', 'arcChain', 'flameWave', 'cinderWard', 'riftStep'];
      db.prepare('UPDATE characters SET data = ? WHERE id = ?').run(JSON.stringify(saved), ch.id);
      db.close();
      await startGameServer(port);
      await A.waitFor('event fixture reconnect', () => window.__foe.store.get().connection === 'online' && window.__foe.store.get().character?.level === 60, undefined, 30000);
      outage = false;
    });
    await step(`${kind}: hidden before discovery; visible status and world marker during combat`, async () => {
      await clickPortal(A);
      await A.waitFor('inside the event map', () => window.__foe.store.get().hud?.zone === 'map');
      assert(await A.eval(() => !Object.hasOwn(window.__foe.store.get().run, 'event')), 'event plan leaked in ZoneInfo');
      assert(await A.eval(() => !window.__foe.world.view.run.event), 'event appeared before its wave');
      await A.eval(() => window.__foe.bot.enable({ returnPortal: false, collect: false }));
      await A.waitFor('event discovery', () => !!window.__foe.world.view.run.event, undefined, 450000);
      await A.eval(() => window.__foe.bot.disable());
      await A.page.waitForSelector('.fe-map-event');
      await eventShot(`events-${kind}-discovered`);
      const e = await A.eval(() => window.__foe.world.view.run.event);
      assert(e.kind === kind, 'wrong event');
      await A.eval(() => { window.__eventMaterialsBefore = Object.fromEntries(['seal', 'twinInk', 'voidSplinter', 'crownFragment'].map(id => [id, window.__foe.store.get().character.backpack.entries.reduce((n, e) => n + (e.item.kind === 'currency' && e.item.currencyId === id ? e.item.count : 0), 0)])); window.__eventEmbersBefore = window.__foe.store.get().character.backpack.entries.reduce((sum, e) => sum + (e.item.kind === 'currency' && e.item.currencyId === 'reforge' ? e.item.count : 0), 0); });
      await A.eval((event) => window.__foe.bot.enable({ returnPortal: false, collect: false, hold: ['echoRift', 'wound', 'blackout'].includes(event.kind) ? { x: event.x, y: event.y } : null }), e);
      await A.waitFor('completed event', () => {
        const event = window.__foe.world.view.run.event;
        if (event?.phase === 'available') {
          const key = `${event.x},${event.y}`;
          if (window.__eventHold !== key) {
            window.__eventHold = key;
            window.__foe.bot.enable({ returnPortal: false, collect: false, hold: { x: event.x, y: event.y } });
          }
        }
        return event?.phase === 'complete' || (event?.kind === 'vaultbreakers' && event.phase === 'failed');
      }, undefined, 300000);
      const outcome = await A.eval(() => window.__foe.world.view.run.event);
      await eventShot(`events-${kind}-${outcome.phase}`);
      if (kind === 'vaultbreakers') {
        assert(outcome.phase === 'complete' || (outcome.phase === 'failed' && outcome.seconds === 0 && outcome.remaining > 0), 'invalid escape outcome');
        log(`Vaultbreakers result: ${outcome.total - outcome.remaining}/${outcome.total} defeated, ${outcome.phase}`);
      }
      const drops = await A.eval(() => window.__foe.world.view.drops.map(d => ({ tone: d.spec.tone, label: d.spec.label })));
      const pickedEmbers = await A.eval(() => window.__foe.store.get().character.backpack.entries.reduce((sum, e) => sum + (e.item.kind === 'currency' && e.item.currencyId === 'reforge' ? e.item.count : 0), 0) > window.__eventEmbersBefore);
      if (kind === 'hunted') assert(drops.some(d => d.tone === 'rare'), 'hunter reward missing');
      else if (kind === 'echoRift') assert(drops.some(d => /Reforging Ember/.test(d.label)) || pickedEmbers, 'rift reward missing');
      else if (kind !== 'vaultbreakers') {
        const reward = { blackout: ['seal', 'Binding Seal'], wound: ['voidSplinter', 'Void Splinter'], secondCrown: ['crownFragment', 'Crown Fragment'] }[kind];
        const picked = await A.eval(id => window.__foe.store.get().character.backpack.entries.reduce((n, e) => n + (e.item.kind === 'currency' && e.item.currencyId === id ? e.item.count : 0), 0) > window.__eventMaterialsBefore[id], reward[0]);
        assert(drops.some(d => d.label.includes(reward[1])) || picked, `${reward[1]} reward missing`);
      }
      await A.eval(() => window.__foe.bot.disable());
      const leave = await A.eval(() => window.__foe.send({ c: 'leaveMap' }));
      assert(leave.ok, leave.error);
      await A.waitFor('home after event', () => window.__foe.store.get().hud?.zone === 'hideout');
      await closePanels(A);
    });
  }
}

async function expandedMapsScenario({ A, port }) {
  await step('prepare three new map types and a strong character in the disposable database', async () => {
    outage = true;
    await stopGameServer();
    const { DatabaseSync } = await import('node:sqlite');
    const { tsImport } = await import('tsx/esm/api');
    const { ATLAS_AREA_IDS } = await tsImport('../src/contracts/atlas.ts', import.meta.url);
    const db = new DatabaseSync(join(tmp, 'e2e.db'));
    const storage = db.prepare('SELECT account_id, data FROM account_storage').get();
    const shared = JSON.parse(storage.data);
    shared.atlas = { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 12 };
    shared.mapStash = ['cinderChapel', 'choralCrypt', 'chainworks'].map(baseId => ({
      kind: 'map', uid: `e2e-${baseId.toLowerCase()}:i1`, baseId, tier: 1, rarity: 'normal', mods: [], quality: 0, corrupted: false,
    }));
    db.prepare('UPDATE account_storage SET data = ? WHERE account_id = ?').run(JSON.stringify(shared), storage.account_id);
    const row = db.prepare('SELECT id, data FROM characters').get();
    const ch = JSON.parse(row.data);
    ch.level = 50;
    ch.allocated = { str: 100, dex: 50, int: 100 };
    for (const id of Object.keys(ch.skillRanks)) ch.skillRanks[id] = 20;
    ch.loadout = ['emberLance', 'emberNova', 'arcChain', 'flameWave', 'cinderWard', 'riftStep'];
    ch.backpack.entries = [];
    ch.mapDevice = null;
    db.prepare('UPDATE characters SET data = ? WHERE id = ?').run(JSON.stringify(ch), row.id);
    db.close();
    await startGameServer(port);
    await A.waitFor('new maps after reconnect', () => window.__foe.store.get().connection === 'online' && window.__foe.store.get().character?.mapStash?.length === 3, undefined, 30_000);
    outage = false;
  });
  for (const [theme, area, boss] of [
    ['cinderChapel', 'Ember Vault', 'Ashbound Herald'],
    ['choralCrypt', 'Glass Sepulchre', 'Bone Chorister'],
    ['chainworks', 'Iron March', 'The Chainmaster'],
  ]) {
    await step(`${theme}: select its Atlas encounter and open it from the Map Stash`, async () => {
      await closePanels(A);
      const at = await walkUntilOnScreen(A, () => propOnScreen(A, 'mapDevice', 10), 'the map device');
      await clickWorld(A, at, 'the map device');
      await A.page.waitForSelector('.fe-device');
      await A.page.locator('.fe-device__destination').click();
      await A.page.getByRole('button', { name: new RegExp(`^${area},`) }).click();
      assert((await A.page.locator('.fe-atlas__detail').innerText()).includes(boss), 'Atlas does not name this encounter');
      await A.page.mouse.move(10, 10);
      await settlePanels(A);
      await A.shot(`new-maps-${theme}-atlas-${VW}x${VH}`);
      await A.page.getByRole('button', { name: 'Use this area', exact: true }).click();
      const uid = `e2e-${theme.toLowerCase()}:i1`;
      const row = A.page.locator(`.fe-mstash--device .fe-maprow[data-uid="${uid}"]`);
      if (await row.count() === 0) await A.page.locator('.fe-mstash--device button[aria-label^="Tier 1:"]').click();
      await row.click();
      await A.waitFor('new map in device', uid => window.__foe.store.get().character.mapDevice?.uid === uid, uid);
      await A.page.locator('.fe-device__activate').click();
      const confirm = A.page.locator('.fe-dialog__actions button:has-text("Activate")');
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
      await A.waitFor('new map portal', area => window.__foe.store.get().hud?.portal?.mapName === area, area);
      await closePanels(A);
      await clickPortal(A);
      await A.waitFor('inside new theme', theme => window.__foe.world?.view.theme === theme, theme);
      await A.page.mouse.move(10, 10);
      await sleep(1600); // Let the zone fade and first world snapshot settle before the art check.
      await A.shot(`new-maps-${theme}-arrival-${VW}x${VH}`);
    });
    await step(`${theme}: no wave-3 lieutenant, correct final boss, completion chest and rewards`, async () => {
      await A.eval(() => {
        window.__mapAudit = { wave3: false, lieutenant: false, boss: '' };
        window.__mapAuditTimer = setInterval(() => {
          const run = window.__foe.world.view.run;
          window.__mapAudit.wave3 ||= run.wave === 3;
          window.__mapAudit.lieutenant ||= !!run.lieutenant;
          window.__mapAudit.boss ||= run.boss?.name ?? '';
        }, 16);
        window.__foe.bot.enable({ returnPortal: false, collect: true });
      });
      await A.waitFor('final boss reached', () => !!window.__mapAudit.boss, undefined, 480_000);
      assert(await A.eval(boss => window.__mapAudit.boss === boss, boss), 'wrong final boss');
      await sleep(800); // The spawn flash obscures the boss on its first rendered frame.
      await A.shot(`new-maps-${theme}-boss-${VW}x${VH}`);
      await A.waitFor('completion chest opened', () => window.__foe.world.view.props.some(p => p.kind === 'chest' && p.state === 1), undefined, 180_000);
      const audit = await A.eval(() => {
        clearInterval(window.__mapAuditTimer);
        window.__foe.bot.disable();
        return { ...window.__mapAudit, phase: window.__foe.world.view.run.phase, drops: window.__foe.world.view.drops.length,
          items: window.__foe.store.get().character.backpack.entries.length };
      });
      assert(audit.wave3 && !audit.lieutenant, 'wave 3 was absent or spawned a lieutenant');
      assert(audit.phase === 'cleared' && audit.drops + audit.items > 0, 'completion/rewards missing');
      await sleep(1800);
      await A.shot(`new-maps-${theme}-cleared-${VW}x${VH}`);
      const left = await A.eval(() => window.__foe.send({ c: 'leaveMap' }));
      assert(left.ok, left.error);
      await A.waitFor('home after completion', () => window.__foe.store.get().hud?.zone === 'hideout');
      await closePanels(A);
    });
  }
}

async function main() {
  const port = await freePort();
  if (PROD) {
    await step('vite build (production bundle, e2e hooks compiled in)', async () => {
      staticDir = await buildClient();
      return staticDir;
    });
  }
  await step('start game server', async () => {
    await startGameServer(port);
    return `port ${port}`;
  });
  let base = '';
  if (PROD) {
    await step('production build served by the game server', async () => {
      base = `http://127.0.0.1:${port}`;
      const r = await fetch(base + '/');
      const html = await r.text();
      assert(r.ok && /<canvas|id="ui"|<script/i.test(html), `the server did not serve the built client (${r.status})`);
      return `${base} (${staticDir})`;
    });
  } else {
    await step('start Vite dev server', async () => {
      base = await startVite(port);
      return base;
    });
  }

  browser = await chromium.launch({
    headless: !flag('headed'),
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctxA = await browser.newContext({ viewport: { width: VW, height: VH } });
  const ctxB = await browser.newContext({ viewport: { width: VW, height: VH } });
  const A = new Player('A', await ctxA.newPage());
  const B = new Player('B', await ctxB.newPage());
  const suffix = String(Date.now() % 100000);
  const nameA = `Ashveil${suffix}`.slice(0, 16);
  const nameB = `Mirael${suffix}`.slice(0, 16);

  await step('A registers, creates a character and enters the game (real UI)', async () => {
    await registerAndPlay(A, base, `e2e_a_${suffix}`, 'emberpass-A1', nameA);
    return nameA;
  });
  if (MAPS_ONLY) await expandedMapsScenario({ A, port });
  if (ATLAS_ONLY) await atlasScenario({ A, port });
  if (INGREDIENTS_ONLY) await ingredientsScenario({ A, port });
  if (UNIQUES_ONLY) await uniquesScenario({ A, port });
  if (TREE_ONLY) await mapTreeScenario({ A, port });
  if (SCARABS_ONLY) await scarabsScenario({ A, port });
  if (DEBUGMERCHANT_ONLY) await debugMerchantScenario({ A, B, base, port, nameA, nameB, suffix });
  if (EVENTS_ONLY) await eventsScenario({ A, port });
  if (CRAFTING_ONLY) await craftingScenario({ A, port });
  if (!WAVE5_ONLY && !ATLAS_ONLY && !EVENTS_ONLY && !CRAFTING_ONLY && !MAPS_ONLY && !INGREDIENTS_ONLY && !UNIQUES_ONLY && !TREE_ONLY && !SCARABS_ONLY && !DEBUGMERCHANT_ONLY) {
    await step('B registers, creates a character and enters the game (real UI)', async () => {
      await registerAndPlay(B, base, ACCOUNT_ONLY ? `e2e_a_${suffix}` : `e2e_b_${suffix}`, ACCOUNT_ONLY ? 'emberpass-A1' : 'emberpass-B1', nameB, !ACCOUNT_ONLY);
      return nameB;
    });
    if (ACCOUNT_ONLY) await accountScenario({ A, B, nameB, port });
    else if (QOL_ONLY) await qolScenario({ A, B, nameA, nameB });
    else await coreScenario({ A, B, nameA, nameB, port });
  }
  if (!QOL_ONLY && !ACCOUNT_ONLY && !ATLAS_ONLY && !EVENTS_ONLY && !CRAFTING_ONLY && !MAPS_ONLY && !INGREDIENTS_ONLY && !UNIQUES_ONLY && !TREE_ONLY && !SCARABS_ONLY && !DEBUGMERCHANT_ONLY) await wave5Scenario({ A, nameA });

  await step('no page errors, console errors or unexpected warnings in either client', async () => {
    const errs = [...A.errors.map((e) => `A ${e}`), ...B.errors.map((e) => `B ${e}`)];
    assert(errs.length === 0, `${errs.length} error(s):\n  ${errs.slice(0, 12).join('\n  ')}`);
    const warns = [...A.warnings.map((w) => `A ${w}`), ...B.warnings.map((w) => `B ${w}`)];
    assert(warns.length === 0, `${warns.length} warning(s):\n  ${warns.slice(0, 12).join('\n  ')}`);
    return `${A.expected + B.expected} expected messages (failed reconnect attempts during the outage, stale-snapshot warnings)`;
  });
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  if (!results.some((r) => !r.ok)) results.push({ name: 'setup', ok: false, detail: err.message });
  log(`aborted: ${err.stack ?? err.message}`);
  try {
    const pages = browser ? browser.contexts().flatMap((c) => c.pages()) : [];
    for (let i = 0; i < pages.length; i++) {
      const file = join(SHOTS, `e2e-failure-${i === 0 ? 'A' : 'B'}.png`);
      await pages[i].screenshot({ path: file });
      shots.push(file);
      const errs = await pages[i].evaluate(() => {
        const s = window.__foe?.store.get();
        return s ? { screen: s.screen, zone: s.zone, connection: s.connection, error: s.error, toasts: s.toasts.map((t) => t.text) } : null;
      });
      log(`client ${i === 0 ? 'A' : 'B'} state at failure: ${JSON.stringify(errs)}`);
    }
  } catch {}
  if (serverLog.length) {
    console.log('--- last server log lines ---');
    console.log(serverLog.slice(-40).join('\n'));
  }
} finally {
  await cleanup();
}

console.log('\n================ E2E SUMMARY ================');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`);
console.log(`screenshots (${shots.length}):`);
for (const s of shots) console.log(`  ${s}`);
const ok = !failed && results.every((r) => r.ok);
console.log(`\n${ok ? 'PASS' : 'FAIL'}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(ok ? 0 : 1);
