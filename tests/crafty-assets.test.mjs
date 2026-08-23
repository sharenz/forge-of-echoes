import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { buildSorceressReview } from "../scripts/crafty-assets/build.mjs";
import { ASSET_TYPES, SORCERESS_CLIPS, SORCERESS_DIRECTIONS } from "../scripts/crafty-assets/definitions.mjs";
import { createSorceressProject, inspectSorceressProject, nextSorceressStep } from "../scripts/crafty-assets/project.mjs";

test("asset CLI starts through an npm-style executable symlink", () => {
  const directory = mkdtempSync(join(tmpdir(), "crafty-assets-cli-"));
  const executable = join(directory, "crafty-assets");
  try {
    symlinkSync(resolve("scripts/crafty-assets/index.mjs"), executable);
    const result = spawnSync(executable, ["--help"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: crafty-assets/);
    assert.match(result.stdout, /interactive wizard/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the wizard starts from reusable asset types while only characters are enabled", () => {
  assert.deepEqual(ASSET_TYPES.map(({ id }) => id), ["character", "monster", "portal", "world-object"]);
  assert.equal(ASSET_TYPES.find(({ id }) => id === "character")?.available, true);
  assert.equal(ASSET_TYPES.filter(({ available }) => available).length, 1);
});

test("Sorceress project scaffolding is complete, deterministic, and idempotent", () => {
  const directory = mkdtempSync(join(tmpdir(), "sorceress-project-"));
  try {
    const first = createSorceressProject(directory);
    assert.ok(first.changed.length > 20);
    const second = createSorceressProject(directory);
    assert.deepEqual(second.changed, []);

    const concept = readFileSync(join(first.projectRoot, "prompts", "01-concept.md"), "utf8");
    const cast = readFileSync(join(first.projectRoot, "prompts", "animations", "east-cast.md"), "utf8");
    const manifest = JSON.parse(readFileSync(join(first.projectRoot, "asset-project.json"), "utf8"));
    assert.match(concept, /GPT Image/);
    assert.match(concept, /roughly 160–220 pixels tall/);
    assert.match(cast, /Recommended tool: \*\*Veo\*\*/);
    assert.match(cast, /Generate synchronized dry game sound effects only/);
    assert.match(cast, /No character drift/);
    assert.deepEqual(manifest.directions, ["south", "north", "east"]);
    assert.ok(manifest.clips.some(({ id }) => id === "death"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("project status advances from master to directions to core animation clips", () => {
  const directory = mkdtempSync(join(tmpdir(), "sorceress-status-"));
  try {
    let status = inspectSorceressProject(directory);
    assert.equal(nextSorceressStep(status).kind, "concept");
    writeFileSync(join(status.sourceRoot, "references", "master.png"), "image");
    status = inspectSorceressProject(directory);
    assert.equal(nextSorceressStep(status).kind, "direction");
    for (const { id } of SORCERESS_DIRECTIONS) writeFileSync(join(status.sourceRoot, "references", `${id}.png`), "image");
    status = inspectSorceressProject(directory);
    const next = nextSorceressStep(status);
    assert.equal(next.kind, "animation");
    assert.match(next.destination, /videos\/south\/idle\.mp4$/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("review build delegates complete Sorceress media to the deterministic packer", () => {
  const directory = mkdtempSync(join(tmpdir(), "sorceress-build-"));
  try {
    const initial = inspectSorceressProject(directory);
    writeFileSync(join(initial.sourceRoot, "references", "master.png"), "image");
    for (const { id: direction } of SORCERESS_DIRECTIONS) {
      writeFileSync(join(initial.sourceRoot, "references", `${direction}.png`), "image");
      for (const { id: clip } of SORCERESS_CLIPS) {
        const target = join(initial.sourceRoot, "videos", direction, `${clip}.mp4`);
        writeFileSync(target, "video");
      }
    }
    const status = inspectSorceressProject(directory);
    const calls = [];
    const outputs = buildSorceressReview(directory, status, {
      runProcess(command, args, options) {
        calls.push({ command, args, options });
        return { status: 0, stdout: "packed", stderr: "" };
      },
    });
    assert.equal(outputs.length, 3);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].command, "python3");
    assert.match(calls[0].args.join(" "), /player-sorceress-locomotion-candidate/);
    assert.match(calls[0].args.join(" "), /south-idle=.*idle\.mp4/);
    assert.match(calls[1].args.join(" "), /east-cast=.*cast\.mp4/);
    assert.match(calls[2].args.join(" "), /north-death=.*death\.mp4/);
    assert.equal(dirname(outputs[0].outputRoot), join(directory, "art-source", "characters", "sorceress"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
