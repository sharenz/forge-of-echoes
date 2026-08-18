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
  assert.match(html, /craft maps and rare equipment/i);
  assert.match(html, /property="og:image" content="https:\/\/crafty\.example\/og\.png"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the game systems modular and ships its social artwork", async () => {
  const [page, shell, world, domain, content, profile, gameDesign] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GameShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game2d/PhaserRuntime.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/domain.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/content.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/profile.ts", import.meta.url), "utf8"),
    readFile(new URL("../GAME_DESIGN.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<GameShell \/>/);
  assert.match(shell, /<PhaserWorld/);
  assert.match(shell, /mode="class-select"/);
  assert.match(world, /class PhaserRuntime/);
  assert.match(world, /pixelArt: true/);
  assert.match(world, /spatialBuckets/);
  assert.match(world, /MAP_SIZE = VIEW_SIZE \* 4/);
  assert.match(world, /setDeadzone\(360, 360\)/);
  assert.match(world, /PACK_REGIONS/);
  assert.match(world, /rollGroundDrop/);
  assert.match(world, /updateGroundDrops/);
  assert.match(shell, /onLootPickup/);
  assert.doesNotMatch(content, /BARGAINS|Bargain/);
  assert.doesNotMatch(domain, /Bargain/);
  assert.match(domain, /interface MapItem/);
  assert.match(domain, /interface EquipmentItem/);
  assert.match(profile, /level < 99/);
  assert.match(profile, /localStorage/);
  assert.match(gameDesign, /hard cap of level 99/i);
  assert.match(gameDesign, /No temporary run power/);
  await access(new URL("../public/og.png", import.meta.url));
});
