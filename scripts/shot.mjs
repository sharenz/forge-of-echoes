#!/usr/bin/env node
// Screenshot any page of the app in headless Chromium (WebGL2 via SwiftShader).
//
// Usage:
//   node scripts/shot.mjs <path> [options]
//
//   <path>                 URL path served by Vite, e.g. "/" or "/dev/art.html?sheet=sorceress"
//   --out <file.png>       Output file (default .shots/<slug>.png). With --at, a suffix -<ms> is added.
//   --size 1280x720        Viewport size (default 1280x720)
//   --wait <ms>            Wait before the (single) screenshot (default 1500)
//   --at 500,2000,6000     Take several screenshots at these times (ms after load) instead of --wait
//   --eval "<js>"          JS evaluated in the page after load (before waiting). May be async.
//   --script <file.js>     Like --eval but read from a file.
//   --keys "w:1500,space"  Hold/press keys after load: "key:holdMs" or "key" (tap). Sequential.
//   --fullpage             Capture the full page
//   --port <n>             Port for the dev server (default: random free port)
//
// Always prints console errors/warnings and page errors, and exits 1 if the page threw.
// Screenshots can then be viewed with the Read tool.

import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (!args.length || args[0].startsWith('--')) {
  console.error('usage: node scripts/shot.mjs <path> [--out f.png] [--size WxH] [--wait ms] [--at a,b,c] [--eval js] [--script f.js] [--keys spec]');
  process.exit(2);
}
const pagePath = args[0];
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

const [w, h] = opt('size', '1280x720').split('x').map(Number);
const slug = pagePath.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'index';
const out = resolve(root, opt('out', `.shots/${slug}.png`));
const at = opt('at', null)?.split(',').map(Number) ?? null;
const wait = Number(opt('wait', '1500'));
const evalSrc = opt('script', null) ? readFileSync(resolve(opt('script')), 'utf8') : opt('eval', null);
const keys = opt('keys', null);
const port = Number(opt('port', '0'));

mkdirSync(dirname(out), { recursive: true });

const server = await createServer({
  root,
  logLevel: 'error',
  server: { port: port || 0, strictPort: false, host: '127.0.0.1', hmr: false },
});
await server.listen();
const address = server.httpServer.address();
const base = `http://127.0.0.1:${address.port}`;

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text()}`);
    else if (m.text().startsWith('[shot]')) console.log(m.text());
  });
  page.on('pageerror', (e) => {
    failed = true;
    console.log(`[pageerror] ${e.message}\n${e.stack ?? ''}`);
  });
  const t0 = Date.now();
  await page.goto(base + pagePath, { waitUntil: 'load' });
  if (evalSrc) {
    try {
      const r = await page.evaluate(`(async () => { ${evalSrc} })()`);
      if (r !== undefined) console.log('[eval]', typeof r === 'string' ? r : JSON.stringify(r));
    } catch (e) {
      failed = true;
      console.log('[eval error]', e.message);
    }
  }
  if (keys) {
    for (const part of keys.split(',')) {
      const [key, hold] = part.split(':');
      const k = key.length === 1 ? key : key[0].toUpperCase() + key.slice(1);
      if (hold) {
        await page.keyboard.down(k);
        await page.waitForTimeout(Number(hold));
        await page.keyboard.up(k);
      } else await page.keyboard.press(k);
    }
  }
  const snap = async (file) => {
    await page.screenshot({ path: file, fullPage: flag('fullpage') });
    console.log(`[shot] saved ${file}`);
  };
  if (at) {
    for (const ms of at) {
      const dt = ms - (Date.now() - t0);
      if (dt > 0) await page.waitForTimeout(dt);
      await snap(out.replace(/\.png$/, `-${ms}.png`));
    }
  } else {
    await page.waitForTimeout(wait);
    await snap(out);
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
