import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://crafty.example/", { headers: { accept: "text/html", host: "crafty.example" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Crafty application shell and production metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Crafty — The Crucible<\/title>/i);
  assert.match(html, /Lighting the forge/);
  assert.match(html, /Craft maps, shape rare equipment/);
  assert.match(html, /property="og:image" content="https:\/\/crafty\.example\/og\.png"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the game systems modular and ships its social artwork", async () => {
  const [page, shell, engine, domain, profile, gameDesign] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GameShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game/engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/domain.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/profile.ts", import.meta.url), "utf8"),
    readFile(new URL("../GAME_DESIGN.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<GameShell \/>/);
  assert.match(shell, /<Arena/);
  assert.match(engine, /class GameEngine/);
  assert.match(engine, /TOTAL_WAVES = 6/);
  assert.match(domain, /interface MapItem/);
  assert.match(domain, /interface EquipmentItem/);
  assert.match(profile, /level < 99/);
  assert.match(profile, /localStorage/);
  assert.match(gameDesign, /hard cap of level 99/i);
  await access(new URL("../public/og.png", import.meta.url));
});

