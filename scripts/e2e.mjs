#!/usr/bin/env node
// End-to-end test of the real game: the real server (src/server/main.ts via tsx, a throwaway SQLite file) and the
// real client (Vite dev server proxying /api and /ws to it), played by two headless Chromium players.
//
//   node scripts/e2e.mjs [--fight 40] [--size 1024x600] [--headed] [--keep-db] [--prod]
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
// Asserts throughout: no page errors, console errors or unexpected console warnings (a malformed server message is a
// warning), each client only ever sees its own loot or public drops (in snapshots AND drop/pickup events), portal
// counts, zones and run summaries. Prints PASS/FAIL per step and exits 0 / 1.
import { spawn } from 'node:child_process';
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
      throw new Error(`${this.label}: timed out waiting for ${desc}`);
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

async function registerAndPlay(p, base, username, password, charName) {
  const { page } = p;
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.waitForSelector('.fe-auth', { timeout: 60_000 });
  await page.click('.fe-auth__tab:has-text("Create account")');
  await page.fill('#fe-user', username);
  await page.fill('#fe-pass', password);
  await page.fill('#fe-pass2', password);
  await page.click('.fe-auth__form button[type=submit]');
  await page.waitForSelector('.fe-chars', { timeout: 20_000 });
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
  await step('B registers, creates a character and enters the game (real UI)', async () => {
    await registerAndPlay(B, base, `e2e_b_${suffix}`, 'emberpass-B1', nameB);
    return nameB;
  });
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
      await p.waitFor('Ember Nova on Space', () => window.__foe.store.get().character?.loadout[1] === 'emberNova', undefined, 5000);
      if (p === A) await p.shot('01b-skills-A');
      await p.page.keyboard.press('k');
      // The server confirms: the HUD slot (from the replicated player) carries the skill.
      await p.waitFor('the Space slot on the HUD', () => window.__foe.store.get().hud?.slots[1]?.skillId === 'emberNova', undefined, 5000);
    }
    return 'emberNova on slot 1 for both';
  });

  const idA = await A.state('s => s.character.id');
  const idB = await B.state('s => s.character.id');

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

  await step('no page errors, console errors or unexpected warnings in either client', async () => {
    const errs = [...A.errors.map((e) => `A ${e}`), ...B.errors.map((e) => `B ${e}`)];
    assert(errs.length === 0, `${errs.length} error(s):\n  ${errs.slice(0, 12).join('\n  ')}`);
    const warns = [...A.warnings.map((w) => `A ${w}`), ...B.warnings.map((w) => `B ${w}`)];
    assert(warns.length === 0, `${warns.length} warning(s):\n  ${warns.slice(0, 12).join('\n  ')}`);
    return `${A.expected + B.expected} expected messages (failed reconnect attempts during the outage, stale-snapshot warnings)`;
  });

  void idA;
  void idB;
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
