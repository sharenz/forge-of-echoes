#!/usr/bin/env node
// Promo screenshot harness: the real server (throwaway SQLite) + the real client (Vite dev server), one headless
// Chromium, a fresh test account with the character "Mira". Scenarios seed the throwaway DB (like scripts/e2e.mjs)
// and grab candidate frames into .shots/promo/raw/<scenario>-*.png.
//
//   node scripts/promo/capture.mjs <scenario> [--size 1920x1080] [--scale 1] [--seconds 60] [--every 1500]
//        [--area furnaceYard] [--tier 3] [--event secondCrown] [--wave 2]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const scenario = args[0];
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [VW, VH] = opt('size', '1920x1080').split('x').map(Number);
const SCALE = Number(opt('scale', '1'));
const OUT = join(root, '.shots/promo/raw');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[promo]', ...a);
const tmp = mkdtempSync(join(tmpdir(), 'foe-promo-'));
let serverProc = null, vite = null, browser = null, port = 0;

const freePort = () => new Promise((res, rej) => { const s = createNetServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => res(p)); }); });

async function stopServer() {
  if (!serverProc || serverProc.exitCode !== null) return;
  const p = serverProc; p.kill('SIGTERM');
  await Promise.race([new Promise((r) => p.once('exit', r)), sleep(10000)]);
  if (p.exitCode === null) p.kill('SIGKILL');
}
async function startServer() {
  const env = { ...process.env, PORT: String(port), DB_PATH: join(tmp, 'promo.db'), NODE_ENV: 'development', DRAIN_SECONDS: '1', ADMIN_DIR: tmp };
  serverProc = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  serverProc.stdout.on('data', () => {}); serverProc.stderr.on('data', (b) => { const t = b.toString(); if (/error/i.test(t)) log('server:', t.trim().slice(0, 300)); });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {}
    await sleep(250);
  }
  throw new Error('server not healthy');
}
async function startVite() {
  const target = `http://127.0.0.1:${port}`;
  process.env.GAME_SERVER = target;
  const { createServer, createLogger } = await import('vite');
  const logger = createLogger('error');
  vite = await createServer({ root, customLogger: logger, logLevel: 'error', server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false, proxy: { '/api': { target, changeOrigin: true }, '/ws': { target, ws: true, changeOrigin: true } } } });
  await vite.listen();
  return `http://127.0.0.1:${vite.httpServer.address().port}`;
}
async function cleanup() {
  try { await browser?.close(); } catch {}
  try { await vite?.close(); } catch {}
  await stopServer();
  rmSync(tmp, { recursive: true, force: true });
}
process.on('SIGINT', async () => { await cleanup(); process.exit(1); });

let page;
const ev = (fn, arg) => page.evaluate(fn, arg);
const waitFor = (desc, fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 }).catch((e) => { throw new Error(`waiting for ${desc}: ${e.message}`); });

async function boot(base, charName = 'Mira') {
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: SCALE });
  page.on('pageerror', (e) => log('pageerror', e.message));
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.waitForSelector('.fe-auth', { timeout: 60000 });
  await page.click('.fe-auth__tab:has-text("Create account")');
  await page.fill('#fe-user', 'promoacct'); await page.fill('#fe-pass', 'promo-pass-123'); await page.fill('#fe-pass2', 'promo-pass-123');
  await page.click('.fe-auth__form button[type=submit]');
  await page.waitForSelector('.fe-chars', { timeout: 20000 });
  await page.fill('#fe-cname', charName);
  await page.click('.fe-create button[type=submit]');
  await waitFor('character', (n) => window.__foe.store.get().characters.some((c) => c.name === n), charName);
  await page.click('.fe-selected__actions button:has-text("Play")');
  await page.addStyleTag({ content: '.fe-net{display:none!important}' });
  await waitFor('game', () => { const s = window.__foe.store.get(); return s.screen === 'game' && !!s.hud && !!s.character && s.zone === 'hideout'; }, undefined, 60000);
}

/** Stop the server, edit the throwaway DB, start it again and wait for the client to reconnect. */
async function seed(edit) {
  await stopServer();
  const { DatabaseSync } = await import('node:sqlite');
  const { tsImport } = await import('tsx/esm/api');
  const lib = {
    ...(await tsImport('../../src/game/items/index.ts', import.meta.url)),
    rng: (await tsImport('../../src/core/rng.ts', import.meta.url)).createRng,
    ATLAS_AREA_IDS: (await tsImport('../../src/contracts/atlas.ts', import.meta.url)).ATLAS_AREA_IDS,
  };
  const db = new DatabaseSync(join(tmp, 'promo.db'));
  const row = db.prepare('SELECT account_id, data FROM account_storage').get();
  const shared = JSON.parse(row.data);
  const ch = db.prepare('SELECT id, data FROM characters').get();
  let saved = JSON.parse(ch.data);
  saved = (await edit(shared, saved, lib, db)) ?? saved;
  db.prepare('UPDATE account_storage SET data = ? WHERE account_id = ?').run(JSON.stringify(shared), row.account_id);
  db.prepare('UPDATE characters SET data = ? WHERE id = ?').run(JSON.stringify(saved), ch.id);
  db.close();
  await startServer();
  await waitFor('reconnect', () => { const s = window.__foe.store.get(); return s.connection === 'online' && !!s.character; }, undefined, 60000);
  await sleep(800);
}

const wand = (lib) => lib.buildEquipment({ uid: 'promo-wand:i1', baseId: 'emberheartWand', itemLevel: 88, rarity: 'rare', name: 'Cinder Sovereign',
  affixes: ['spellDamage', 'fireDamage', 'addedSpellDamage', 'castSpeed', 'critChance', 'critMultiplier'].map((affixId) => ({ affixId, tier: 1 })) }, lib.rng(81));

/** A strong Mira with the full skill bar. */
function strong(saved, lib, level = Number(opt('level', '62'))) {
  saved.level = level;
  saved.allocated = { str: 195, dex: 100, int: 195 };
  if (!args.includes('--plainwand')) saved.equipment.mainHand = wand(lib);
  for (const id of Object.keys(saved.skillRanks)) saved.skillRanks[id] = Number(opt('rank', '20'));
  saved.loadout = ['emberLance', 'emberNova', 'flameWave', 'rimeShards', 'cinderWard', 'riftStep'];
}
const mapItem = (areaId, baseId, tier, extra = {}) => ({ kind: 'map', uid: `promo-map:${areaId}`, areaId, baseId, tier, rarity: 'rare', quality: 14, corrupted: false,
  mods: [{ modId: 'teeming', value: 100 }, { modId: 'restless', value: 110 }], ...extra });
const BASE_OF = { furnaceYard: 'ashenForge', glassSepulchre: 'choralCrypt', ironMarch: 'chainworks', crownFoundry: 'ashenForge', heartOfForge: 'ashenForge', emberRoad: 'ashenForge', championsApproach: 'ironColiseum', winterThrone: 'rimedOssuary', shatteredForge: 'ashenForge', lastKiln: 'chainworks', emberCitadel: 'cinderChapel', eternalArena: 'ironColiseum', frozenPassage: 'choralCrypt', echoBastion: 'rimedOssuary', riftNexus: 'choralCrypt', blackPit: 'cinderChapel' };

/** Open the map: put it in the device, activate, walk into the portal with the bot, wait for the map zone. */
async function enterMap() {
  const item = await ev(() => window.__foe.store.get().character.mapDevice ? 'device' : window.__foe.store.get().character.backpack.entries.find((e) => e.item.kind === 'map')?.item.uid);
  if (item && item !== 'device') { const r = await ev((u) => window.__foe.send({ c: 'moveItem', uid: u, to: { kind: 'mapDevice' } }), item); if (!r.ok) throw new Error(r.error); }
  const r = await ev(() => window.__foe.send({ c: 'activateMapDevice' })); if (!r.ok) throw new Error(r.error);
  await ev(() => window.__foe.bot.enable({ enterPortal: true, returnPortal: false, collect: false }));
  await waitFor('map zone', () => window.__foe.store.get().hud?.zone === 'map', undefined, 90000);
}

const metrics = () => ev(() => {
  const w = window.__foe.world; if (!w) return null; const v = w.view; const me = v.players.find((p) => p.id === w.localPlayerId);
  let bossd = 9999; const M = v.monsters; if (me) for (let i = 0; i < M.capacity; i++) if (M.alive[i] && M.rarity[i] === 4) bossd = Math.hypot(M.x[i] - me.x, M.y[i] - me.y);
  return { bossd: Math.round(bossd), mons: v.monsters.count, proj: v.projectiles.count, areas: v.areas.length, boss: !!v.run.boss, wave: v.run.wave, phase: v.run.phase, ev: v.run.events.length, x: me?.x, y: me?.y, dead: me?.dead };
});
async function snap(name) {
  await ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}
/** Take a frame every `every` ms for `seconds`, tagged with live metrics (so the busiest can be picked by eye). */
async function burst(tag, seconds, every, filter = () => true) {
  const t0 = Date.now(); let n = 0;
  while (Date.now() - t0 < seconds * 1000) {
    const m = await metrics(); if (!m) { await sleep(300); continue; }
    if (m.dead) { log('dead; stopping'); return; }
    if (filter(m)) { const f = await snap(`${tag}-${String(n++).padStart(3, '0')}-w${m.wave}d${m.bossd}m${m.mons}p${m.proj}a${m.areas}${m.boss ? 'B' : ''}`); log('shot', f.split('/').pop()); }
    await sleep(every);
  }
}
const hideChat = () => ev(() => { /* leave the HUD as is */ });

const WANT = {
  any: (m) => m.mons >= 1,
  many: (m) => m.mons >= 30 && m.areas + m.proj >= 6,
  boss: (m) => m.boss && m.areas >= 1,
  bossnear: (m) => m.bossd < 330 && m.areas >= 1,
  event: (m) => m.ev > 0 && m.mons >= 5,
};
async function runMap() {
  const area = opt('area', 'furnaceYard'), tier = Number(opt('tier', '4')), event = opt('event', null);
  await seed((shared, saved, lib) => {
    shared.atlas = { discovered: [...lib.ATLAS_AREA_IDS], completed: [...lib.ATLAS_AREA_IDS], clears: 30 };
    shared.currencyStash = { ...(shared.currencyStash ?? {}), scrap: 500 };
    strong(saved, lib);
    saved.backpack.entries = [];
    saved.mapDevice = mapItem(area, BASE_OF[area], tier, args.includes('--corrupt') ? { corrupted: true } : {});
  });
  if (event) {
    const r = await ev(() => window.__foe.send({ c: 'activateMapDevice' })); if (!r.ok) throw new Error(r.error);
    await seed((shared, saved, lib, db) => {
      const row = db.prepare('SELECT map_id, setup FROM open_maps').get();
      const setup = JSON.parse(row.setup);
      setup.event = { kind: event, wave: Number(opt('wave', '2')), angle: 0 };
      db.prepare('UPDATE open_maps SET setup = ?, cleared = 0, portals_remaining = 8 WHERE map_id = ?').run(JSON.stringify(setup), row.map_id);
    });
    await ev(() => window.__foe.bot.enable({ enterPortal: true, returnPortal: false, collect: false }));
    await waitFor('map zone', () => window.__foe.store.get().hud?.zone === 'map', undefined, 90000);
  } else await enterMap();
  await ev((c) => window.__foe.bot.enable({ returnPortal: false, collect: c }), args.includes('--collect'));
  const want = opt('want', 'many');
  const t0 = Date.now(); const delay = Number(opt('delay', '8000'));
  await sleep(delay);
  await burst(`${opt('tag', 'run')}-${area}`, Number(opt('seconds', '90')), Number(opt('every', '2000')), (m) => WANT[want](m));
}
const S = {
  combat: runMap, run: runMap,
};

async function main() {
  if (!S[scenario]) { console.error('scenarios:', Object.keys(S).join(', ')); process.exit(2); }
  port = await freePort();
  await startServer();
  const base = await startVite();
  await boot(base);
  log('in hideout');
  await S[scenario]();
}
main().then(async () => { await cleanup(); process.exit(0); }, async (e) => { console.error(e); await cleanup(); process.exit(1); });
