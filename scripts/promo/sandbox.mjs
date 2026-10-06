#!/usr/bin/env node
// Promo shots from the dev/ui.html sandbox (Atlas chart, Codex wheel, Crafting Stash work slot, event HUD).
//   node scripts/promo/sandbox.mjs atlas|codex|keystone|workslot|event [--size 1920x1080]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [scenario, ...rest] = process.argv.slice(2);
const sizeI = rest.indexOf('--size');
const [w, h] = (sizeI >= 0 ? rest[sizeI + 1] : '1920x1080').split('x').map(Number);
const out = `${root}/.shots/promo/raw`; mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const tree = await server.ssrLoadModule('/src/data/progression/map-tree.ts');
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const snap = async (name) => { await page.mouse.move(w - 3, h - 3); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${name}.png` }); console.log('[shot]', name); };
const chartReady = () => page.waitForFunction(() => document.querySelector('.fe-chart__canvas') && !document.querySelector('.fe-chart__loading'), null, { timeout: 120000 });
const closeInv = () => page.addStyleTag({ content: '.fe-inv,.fe-net{display:none!important}' });
const S = {
  async atlas() {
    await page.goto(`${base}/dev/ui.html?panels=mapDevice&atlas=full`); await chartReady(); await closeInv(); await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Fit' }).click().catch(() => {}); await page.waitForTimeout(2500);
    await snap('atlas-fit');
  },
  async codex() {
    await page.goto(`${base}/dev/ui.html?panels=mapDevice&atlas=full&tree=full`); await chartReady(); await closeInv();
    await page.getByRole('tab', { name: /Codex/ }).click(); await page.waitForSelector('.fe-cx__canvas');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Whole' }).click().catch(() => {}); await page.waitForTimeout(1500);
    await snap('codex-whole');
    const ks = tree.MAP_TREE.filter((n) => n.kind === 'keystone');
    console.log('keystones', ks.map((k) => k.id).join(','));
  },
  async keystone() {
    await page.goto(`${base}/dev/ui.html?panels=mapDevice&atlas=full&tree=full`); await chartReady(); await closeInv();
    await page.getByRole('tab', { name: /Codex/ }).click(); await page.waitForSelector('.fe-cx__canvas'); await page.waitForTimeout(1500);
    const group = process.env.GROUP ?? 'cartography';
    const ks = tree.MAP_TREE.filter((n) => n.kind === 'keystone' && n.group === group)[Number(process.env.KI ?? 0)];
    const zoomTo = async (z) => { const cur = () => page.locator('.fe-cx .fe-chart__zoomread').innerText(); for (let i = 0; i < 4 && (await cur()).trim() !== `${z}×`; i++) await page.click(`.fe-cx [aria-label="Zoom ${Number((await cur()).trim().replace('×', '')) < z ? 'in' : 'out'}"]`); await page.waitForTimeout(500); };
    await zoomTo(Number(process.env.ZOOM ?? 1));
    await page.locator('.fe-cx__branch').nth(Number(process.env.BR ?? 0)).click(); await page.waitForTimeout(1200);
    await page.locator(`[data-map-node="${ks.id}"]`).evaluate((n) => n.click()); await page.waitForTimeout(1200);
    console.log('keystone', ks.id, ks.name);
    await snap('codex-keystone');
  },
  async workslot() {
    await page.goto(`${base}/dev/ui.html?workslot=crafted`); await page.waitForTimeout(6000); await snap('workslot');
  },
  async event() {
    await page.goto(`${base}/dev/ui.html?zone=map&event=secondCrown&eventphase=active`); await page.waitForTimeout(6000); await snap('event-sandbox');
  },
};
try { await S[scenario](); } finally { await browser.close(); await server.close(); }
