#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSET_TYPES, CHARACTER_PROJECTS, SORCERESS_CLIPS, SORCERESS_DIRECTIONS, promptFileName } from "./definitions.mjs";
import { buildSorceressReview } from "./build.mjs";
import { createSorceressProject, inspectSorceressProject, nextSorceressStep, readPrompt } from "./project.mjs";
import { PromptInterruptedError, assertInteractive, clearScreen, pause, select, style } from "../crafty-cli/prompt.mjs";

function usage() {
  return `Usage: crafty-assets

Interactive Forge of Echoes asset-production guide.

  crafty-assets                  Start the interactive wizard
  crafty-assets --init-sorceress Generate or refresh the Sorceress project kit
  crafty-assets --status         Print Sorceress source-media progress
`;
}

function banner() {
  process.stdout.write(`${style.magenta("◆")} ${style.bold("FORGE OF ECHOES · ASSET FORGE")}\n`);
  process.stdout.write(`${style.dim("AI-assisted source creation · deterministic runtime assets")}\n\n`);
}

function repositoryPath(repositoryRoot, absolutePath) {
  const path = relative(repositoryRoot, absolutePath);
  return path || ".";
}

function progressBar(completed, total, width = 18) {
  const filled = total === 0 ? width : Math.round((completed / total) * width);
  return `${style.green("█".repeat(filled))}${style.dim("░".repeat(Math.max(0, width - filled)))} ${completed}/${total}`;
}

function printStatus(repositoryRoot, status) {
  const referenceCount = status.directions.filter(({ mediaPath }) => mediaPath).length;
  process.stdout.write(`${style.bold("SORCERESS PRODUCTION STATUS")}\n\n`);
  process.stdout.write(`Master design       ${status.master ? style.green("● approved source present") : style.yellow("○ missing")}\n`);
  process.stdout.write(`Direction references ${progressBar(referenceCount, status.directions.length)}\n`);
  process.stdout.write(`Core animation clips ${progressBar(status.completeCoreClips, status.totalCoreClips)}\n`);
  process.stdout.write(`Extended actions     ${progressBar(status.completeExtendedClips, status.totalExtendedClips)}\n\n`);
  process.stdout.write(`${style.dim(`Prompt kit: ${repositoryPath(repositoryRoot, status.projectRoot)}`)}\n`);
  process.stdout.write(`${style.dim(`Source media: ${repositoryPath(repositoryRoot, status.sourceRoot)}`)}\n`);
}

function printDetailedStatus(repositoryRoot, status) {
  clearScreen();
  banner();
  printStatus(repositoryRoot, status);
  process.stdout.write(`\n${style.bold("REFERENCES")}\n`);
  process.stdout.write(`${status.master ? style.green("✓") : style.yellow("○")} master\n`);
  for (const direction of status.directions) process.stdout.write(`${direction.mediaPath ? style.green("✓") : style.yellow("○")} ${direction.id}\n`);
  for (const group of ["locomotion", "actions", "extended-actions"]) {
    process.stdout.write(`\n${style.bold(group.replaceAll("-", " ").toUpperCase())}\n`);
    for (const direction of SORCERESS_DIRECTIONS) {
      const entries = status.clips.filter((clip) => clip.directionId === direction.id && clip.group === group);
      if (!entries.length) continue;
      process.stdout.write(`${direction.id.padEnd(6)} ${entries.map((clip) => `${clip.mediaPath ? style.green("✓") : style.yellow("○")} ${clip.id}`).join("  ")}\n`);
    }
  }
  process.stdout.write(`\n${style.dim("Supported image extensions: png, webp, jpg, jpeg · video: mp4, mov, webm, mkv")}\n`);
}

function tryCopyToClipboard(value, platform = process.platform, runProcess = spawnSync) {
  const candidates = platform === "darwin"
    ? [["pbcopy", []]]
    : platform === "win32"
      ? [["clip", []]]
      : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]]];
  for (const [command, args] of candidates) {
    const result = runProcess(command, args, { input: value, encoding: "utf8" });
    if (!result.error && result.status === 0) return true;
  }
  return false;
}

async function showPrompt(repositoryRoot, promptPath, destination, instruction) {
  while (true) {
    clearScreen();
    banner();
    process.stdout.write(`${style.bold("WHAT TO DO")}\n${instruction}\n\n`);
    if (destination) process.stdout.write(`${style.bold("SAVE THE APPROVED RESULT AS")}\n${style.cyan(repositoryPath(repositoryRoot, destination))}\n\n`);
    process.stdout.write(`${style.bold("PROMPT FILE")}\n${style.cyan(repositoryPath(repositoryRoot, promptPath))}\n\n`);
    const command = await select("Choose an action", [
      { label: "Show the complete prompt", value: "show" },
      { label: "Copy the complete prompt", value: "copy" },
      { label: "Back", value: "back" },
    ]);
    if (!command || command === "back") return;
    const prompt = readPrompt(promptPath);
    if (command === "show") {
      clearScreen();
      banner();
      process.stdout.write(`${prompt}\n`);
      await pause();
    }
    if (command === "copy") {
      const copied = tryCopyToClipboard(prompt);
      process.stdout.write(copied ? `${style.green("Prompt copied to the clipboard.")}\n` : `${style.yellow("Clipboard utility unavailable. Open the prompt file shown above instead.")}\n`);
      await pause();
    }
  }
}

async function guideNextStep(repositoryRoot, status) {
  const step = nextSorceressStep(status);
  if (!step.promptPath) {
    clearScreen();
    banner();
    process.stdout.write(`${style.green(style.bold(step.title))}\n\n${step.instruction}\n\n`);
    await pause();
    return;
  }
  await showPrompt(repositoryRoot, step.promptPath, step.destination, step.instruction);
}

async function browsePrompts(repositoryRoot, status) {
  const category = await select("Which prompt do you need?", [
    { label: "Master Sorceress design · GPT Image", value: "concept" },
    { label: "Directional reference · GPT Image", value: "direction" },
    { label: "Animation video + sound · Veo", value: "animation" },
    { label: "Back", value: null },
  ]);
  if (!category) return;
  if (category === "concept") {
    await showPrompt(repositoryRoot, resolve(status.projectRoot, "prompts", promptFileName("concept")), resolve(status.sourceRoot, "references", "master.png"), "Generate alternatives with GPT Image and approve the definitive Sorceress identity before moving on.");
    return;
  }
  const direction = await select("Choose a direction", [
    ...SORCERESS_DIRECTIONS.map((candidate) => ({ label: `${candidate.label} · ${candidate.description}`, value: candidate.id })),
    { label: "Back", value: null },
  ]);
  if (!direction) return;
  if (category === "direction") {
    await showPrompt(repositoryRoot, resolve(status.projectRoot, "prompts", promptFileName("direction", direction)), resolve(status.sourceRoot, "references", `${direction}.png`), "Attach the approved master design to GPT Image and preserve its identity exactly.");
    return;
  }
  const clip = await select("Choose an animation", [
    ...SORCERESS_CLIPS.map((candidate) => ({ label: `${candidate.label} · ${candidate.loop ? "loop" : "one shot"} · ${candidate.frames} target frames`, value: candidate.id })),
    { label: "Back", value: null },
  ]);
  if (!clip) return;
  await showPrompt(repositoryRoot, resolve(status.projectRoot, "prompts", promptFileName("animation", direction, clip)), resolve(status.sourceRoot, "videos", direction, `${clip}.mp4`), `Attach the approved ${direction} reference to Veo. Approve both the motion and its isolated generated sound.`);
}

async function buildReview(repositoryRoot, status) {
  clearScreen();
  banner();
  if (status.completeCoreClips !== status.totalCoreClips) {
    process.stdout.write(`${style.yellow("Core videos are not complete yet.")}\n\nCreate the missing videos first: ${status.completeCoreClips}/${status.totalCoreClips} present.\n\n`);
    await pause();
    return;
  }
  const confirmed = await select("Build candidate sheets and extract their audio now?", [
    { label: "Build review assets", value: true },
    { label: "Cancel", value: false },
  ]);
  if (!confirmed) return;
  process.stdout.write(style.dim("Running deterministic frame, chroma-key, sheet, preview, and audio extraction…"));
  try {
    const outputs = buildSorceressReview(repositoryRoot, status);
    process.stdout.write("\r\u001b[2K");
    process.stdout.write(`${style.green(style.bold("Review assets built successfully."))}\n\n`);
    for (const output of outputs) process.stdout.write(`- ${output.name}\n  ${repositoryPath(repositoryRoot, output.outputRoot)}\n`);
    process.stdout.write(`\n${style.yellow("Candidate output is intentionally not installed into the live game.")} Review every WebP and sheet first.\n\n`);
  } catch (error) {
    process.stdout.write("\r\u001b[2K");
    process.stdout.write(`${style.red(style.bold("Build failed"))}\n${error instanceof Error ? error.message : String(error)}\n\n`);
  }
  await pause();
}

async function sorceressDashboard(repositoryRoot) {
  createSorceressProject(repositoryRoot);
  while (true) {
    const status = inspectSorceressProject(repositoryRoot);
    const next = nextSorceressStep(status);
    clearScreen();
    banner();
    printStatus(repositoryRoot, status);
    process.stdout.write(`\n${style.bold("NEXT MILESTONE")}\n${next.title}\n${style.dim(next.instruction)}\n\n`);
    const command = await select("Sorceress asset project", [
      { label: "Guide me through the next step", value: "next" },
      { label: "Browse and copy all prompts", value: "prompts" },
      { label: "Check source files and progress", value: "status" },
      { label: `Build candidate sheets ${status.completeCoreClips === status.totalCoreClips ? "" : `· locked ${status.completeCoreClips}/${status.totalCoreClips}`}`, value: "build" },
      { label: "Back to asset types", value: "back" },
    ]);
    if (!command || command === "back") return;
    if (command === "next") await guideNextStep(repositoryRoot, status);
    if (command === "prompts") await browsePrompts(repositoryRoot, status);
    if (command === "status") {
      printDetailedStatus(repositoryRoot, status);
      await pause();
    }
    if (command === "build") await buildReview(repositoryRoot, status);
  }
}

async function chooseCharacter(repositoryRoot) {
  const selected = await select("Which character do you want to create?", [
    ...CHARACTER_PROJECTS.map((candidate) => ({
      label: `${candidate.label} · ${candidate.description}${candidate.available ? "" : " · coming soon"}`,
      value: candidate,
    })),
    { label: "Back", value: null },
  ]);
  if (!selected) return;
  if (!selected.available) {
    process.stdout.write(`\n${style.yellow("This character flow is not enabled yet.")} The project format is ready to gain more class definitions after the Sorceress pipeline is proven.\n\n`);
    await pause();
    return;
  }
  await sorceressDashboard(repositoryRoot);
}

export async function runAssetCli(argv = process.argv.slice(2), options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    return 0;
  }
  if (argv.length === 1 && argv[0] === "--init-sorceress") {
    const project = createSorceressProject(repositoryRoot);
    process.stdout.write(`Sorceress asset project ready at ${repositoryPath(repositoryRoot, project.projectRoot)}\n`);
    process.stdout.write(`${project.changed.length ? `${project.changed.length} generated files updated` : "Prompt kit already up to date"}\n`);
    return 0;
  }
  if (argv.length === 1 && argv[0] === "--status") {
    const status = inspectSorceressProject(repositoryRoot);
    printStatus(repositoryRoot, status);
    return 0;
  }
  if (argv.length !== 0) {
    process.stderr.write(usage());
    return 2;
  }

  assertInteractive();
  while (true) {
    clearScreen();
    banner();
    const selected = await select("What would you like to create?", [
      ...ASSET_TYPES.map((assetType) => ({
        label: `${assetType.label} · ${assetType.description}${assetType.available ? "" : " · coming soon"}`,
        value: assetType,
      })),
      { label: "Exit", value: null },
    ]);
    if (!selected) return 0;
    if (!selected.available) {
      process.stdout.write(`\n${style.yellow(`${selected.label} projects are coming next.`)} The first Sorceress run establishes the reusable prompt, source, processing, and review contract.\n\n`);
      await pause();
      continue;
    }
    if (selected.id === "character") await chooseCharacter(repositoryRoot);
  }
}

function invokedAsMain(moduleUrl = import.meta.url, executablePath = process.argv[1]) {
  if (!executablePath) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(executablePath);
  } catch {
    return false;
  }
}

if (invokedAsMain()) {
  runAssetCli().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    if (error instanceof PromptInterruptedError) {
      process.stdout.write("\n");
      process.exitCode = 130;
      return;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export { tryCopyToClipboard };
