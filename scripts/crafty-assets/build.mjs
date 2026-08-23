import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { SORCERESS_CLIPS, SORCERESS_DIRECTIONS } from "./definitions.mjs";

function defaultRunProcess(command, args, options) {
  return spawnSync(command, args, { ...options, encoding: "utf8" });
}

function mediaArgument(status, directionId, clipId) {
  const clip = status.clips.find((candidate) => candidate.directionId === directionId && candidate.id === clipId);
  if (!clip?.mediaPath) throw new Error(`Missing approved video: ${directionId}/${clipId}`);
  return `${directionId}-${clipId}=${clip.mediaPath}`;
}

function runPacker(repositoryRoot, status, name, clips, options = {}) {
  const runProcess = options.runProcess ?? defaultRunProcess;
  const packer = join(repositoryRoot, "tools", "sprite-pipeline", "pack_sprite_sheet.py");
  const outputRoot = join(repositoryRoot, "art-source", "characters", "sorceress", "build");
  mkdirSync(outputRoot, { recursive: true });
  const args = [
    packer,
    "--name", name,
    "--out", outputRoot,
    "--size", "304",
    "--key", "green",
    ...clips.map(({ directionId, clipId }) => mediaArgument(status, directionId, clipId)),
  ];
  const result = runProcess("python3", args, { cwd: repositoryRoot });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([`Sprite packer failed for ${name}.`, result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join("\n"));
  }
  return { name, outputRoot, stdout: result.stdout ?? "" };
}

export function buildSorceressReview(repositoryRoot, status, options = {}) {
  if (status.completeCoreClips !== status.totalCoreClips) {
    throw new Error(`Core animation videos are incomplete (${status.completeCoreClips}/${status.totalCoreClips}).`);
  }
  const locomotion = SORCERESS_DIRECTIONS.flatMap(({ id: directionId }) => ["idle", "run"].map((clipId) => ({ directionId, clipId })));
  const actions = SORCERESS_DIRECTIONS.flatMap(({ id: directionId }) => ["attack", "cast"].map((clipId) => ({ directionId, clipId })));
  const outputs = [
    runPacker(repositoryRoot, status, "player-sorceress-locomotion-candidate", locomotion, options),
    runPacker(repositoryRoot, status, "player-sorceress-actions-candidate", actions, options),
  ];
  if (status.completeExtendedClips === status.totalExtendedClips) {
    const extendedIds = SORCERESS_CLIPS.filter(({ group }) => group === "extended-actions").map(({ id }) => id);
    const extended = SORCERESS_DIRECTIONS.flatMap(({ id: directionId }) => extendedIds.map((clipId) => ({ directionId, clipId })));
    outputs.push(runPacker(repositoryRoot, status, "player-sorceress-extended-candidate", extended, options));
  }
  return outputs;
}
