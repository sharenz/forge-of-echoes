import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  SORCERESS_CLIPS,
  SORCERESS_DIRECTIONS,
  SORCERESS_PROJECT,
  promptFileName,
  sorceressAnimationPrompt,
  sorceressConceptPrompt,
  sorceressDirectionPrompt,
} from "./definitions.mjs";

const IMAGE_EXTENSIONS = ["png", "webp", "jpg", "jpeg"];
const VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "mkv"];

function ensureInsideProject(projectRoot, target) {
  const root = resolve(projectRoot);
  const candidate = resolve(target);
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) throw new Error(`Asset path escapes project root: ${candidate}`);
  return candidate;
}

function writeGeneratedFile(projectRoot, relativePath, content) {
  const target = ensureInsideProject(projectRoot, join(projectRoot, relativePath));
  mkdirSync(dirname(target), { recursive: true });
  const next = `${content.trim()}\n`;
  if (existsSync(target) && readFileSync(target, "utf8") === next) return false;
  writeFileSync(target, next, "utf8");
  return true;
}

function promptDocument(title, tool, referenceInstruction, prompt) {
  return `# ${title}

Recommended tool: **${tool}**

## Before generating

- ${referenceInstruction}
- Generate alternatives until identity, perspective, silhouette, and framing are stable.
- Save only an approved result using the exact destination shown in the project guide.

## Base prompt

\`\`\`text
${prompt}
\`\`\`

## Approval checklist

- The complete character and staff remain inside the frame.
- Costume, anatomy, palette, lighting, and staff match the approved creative brief and attached references.
- Feet are readable and the character does not float.
- The camera and character scale are stable.
- There are no baked projectiles, scene elements, captions, or watermarks.
`;
}

function projectReadme() {
  const coreCount = SORCERESS_DIRECTIONS.length * SORCERESS_CLIPS.filter(({ group }) => group !== "extended-actions").length;
  const extendedCount = SORCERESS_DIRECTIONS.length * SORCERESS_CLIPS.filter(({ group }) => group === "extended-actions").length;
  return `# Sorceress asset-production project

This directory contains the versioned manifest and reusable AI prompt kit. Heavy source media is deliberately stored under the gitignored \`${SORCERESS_PROJECT.sourceRoot}/\` directory.

Run the interactive guide from the repository root:

\`\`\`bash
npm run assets
# or, after npm link
crafty-assets
\`\`\`

## Workflow

1. Generate and approve the master design with GPT Image.
2. Generate south, north, and east reference images from that master.
3. Animate each approved direction reference with Veo.
4. Review the generated video and synchronized sound before accepting it.
5. Save approved media under the exact filenames below.
6. Let the CLI validate progress and build review sprite sheets with the deterministic packer.

## Required source files

- Master image: \`${SORCERESS_PROJECT.sourceRoot}/references/master.png\`
${SORCERESS_DIRECTIONS.map(({ id }) => `- ${id} reference: \`${SORCERESS_PROJECT.sourceRoot}/references/${id}.png\``).join("\n")}

Core videos (${coreCount}):

${SORCERESS_DIRECTIONS.flatMap(({ id: direction }) => SORCERESS_CLIPS.filter(({ group }) => group !== "extended-actions").map(({ id }) => `- \`${SORCERESS_PROJECT.sourceRoot}/videos/${direction}/${id}.mp4\``)).join("\n")}

Extended videos (${extendedCount}, prepared for later runtime support):

${SORCERESS_DIRECTIONS.flatMap(({ id: direction }) => SORCERESS_CLIPS.filter(({ group }) => group === "extended-actions").map(({ id }) => `- \`${SORCERESS_PROJECT.sourceRoot}/videos/${direction}/${id}.mp4\``)).join("\n")}

Do not copy generated assets over the live game files until they have been visually approved in the generated contact sheets and in a dedicated in-game comparison.
`;
}

export function createSorceressProject(repositoryRoot = process.cwd()) {
  const projectRoot = join(repositoryRoot, SORCERESS_PROJECT.projectRoot);
  const sourceRoot = join(repositoryRoot, SORCERESS_PROJECT.sourceRoot);
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(join(sourceRoot, "references"), { recursive: true });
  for (const { id } of SORCERESS_DIRECTIONS) mkdirSync(join(sourceRoot, "videos", id), { recursive: true });
  mkdirSync(join(sourceRoot, "build"), { recursive: true });

  const changed = [];
  if (writeGeneratedFile(projectRoot, "asset-project.json", JSON.stringify(SORCERESS_PROJECT, null, 2))) changed.push("asset-project.json");
  if (writeGeneratedFile(projectRoot, "README.md", projectReadme())) changed.push("README.md");
  if (writeGeneratedFile(projectRoot, `prompts/${promptFileName("concept")}`, promptDocument("Sorceress master design", "GPT Image", "Attach one representative hideout or map screenshot as the game-style reference; do not attach the current low-quality Sorceress as an identity reference.", sorceressConceptPrompt()))) changed.push(`prompts/${promptFileName("concept")}`);

  for (const direction of SORCERESS_DIRECTIONS) {
    const relativePath = `prompts/${promptFileName("direction", direction.id)}`;
    if (writeGeneratedFile(projectRoot, relativePath, promptDocument(`Sorceress ${direction.id} reference`, "GPT Image", "Attach the approved master Sorceress image as the strict identity reference.", sorceressDirectionPrompt(direction.id)))) changed.push(relativePath);
  }
  for (const direction of SORCERESS_DIRECTIONS) {
    for (const clip of SORCERESS_CLIPS) {
      const relativePath = `prompts/${promptFileName("animation", direction.id, clip.id)}`;
      if (writeGeneratedFile(projectRoot, relativePath, promptDocument(`Sorceress ${direction.id} ${clip.label.toLowerCase()}`, "Veo", `Attach the approved ${direction.id} Sorceress reference image as the first-frame and identity reference.`, sorceressAnimationPrompt(direction.id, clip.id)))) changed.push(relativePath);
    }
  }
  return { projectRoot, sourceRoot, changed };
}

function findMedia(basePath, extensions) {
  return extensions.map((extension) => `${basePath}.${extension}`).find(existsSync) ?? null;
}

export function inspectSorceressProject(repositoryRoot = process.cwd()) {
  const project = createSorceressProject(repositoryRoot);
  const master = findMedia(join(project.sourceRoot, "references", "master"), IMAGE_EXTENSIONS);
  const directions = SORCERESS_DIRECTIONS.map((direction) => ({
    ...direction,
    mediaPath: findMedia(join(project.sourceRoot, "references", direction.id), IMAGE_EXTENSIONS),
  }));
  const clips = SORCERESS_DIRECTIONS.flatMap((direction) => SORCERESS_CLIPS.map((clip) => ({
    ...clip,
    directionId: direction.id,
    mediaPath: findMedia(join(project.sourceRoot, "videos", direction.id, clip.id), VIDEO_EXTENSIONS),
  })));
  return {
    ...project,
    master,
    directions,
    clips,
    completeCoreClips: clips.filter(({ group, mediaPath }) => group !== "extended-actions" && mediaPath).length,
    totalCoreClips: clips.filter(({ group }) => group !== "extended-actions").length,
    completeExtendedClips: clips.filter(({ group, mediaPath }) => group === "extended-actions" && mediaPath).length,
    totalExtendedClips: clips.filter(({ group }) => group === "extended-actions").length,
  };
}

export function nextSorceressStep(status) {
  if (!status.master) {
    return {
      kind: "concept",
      title: "Create and approve the master Sorceress design",
      promptPath: join(status.projectRoot, "prompts", promptFileName("concept")),
      destination: join(status.sourceRoot, "references", "master.png"),
      instruction: "Use GPT Image. Iterate on the character design before creating any directional views.",
    };
  }
  const missingDirection = status.directions.find(({ mediaPath }) => !mediaPath);
  if (missingDirection) {
    return {
      kind: "direction",
      title: `Create and approve the ${missingDirection.label} reference`,
      promptPath: join(status.projectRoot, "prompts", promptFileName("direction", missingDirection.id)),
      destination: join(status.sourceRoot, "references", `${missingDirection.id}.png`),
      instruction: `Use GPT Image and attach the approved master image: ${status.master}`,
    };
  }
  const missingCoreClip = status.clips.find(({ group, mediaPath }) => group !== "extended-actions" && !mediaPath);
  if (missingCoreClip) {
    return {
      kind: "animation",
      title: `Generate and approve ${missingCoreClip.directionId} ${missingCoreClip.label.toLowerCase()}`,
      promptPath: join(status.projectRoot, "prompts", promptFileName("animation", missingCoreClip.directionId, missingCoreClip.id)),
      destination: join(status.sourceRoot, "videos", missingCoreClip.directionId, `${missingCoreClip.id}.mp4`),
      instruction: `Use Veo and attach the approved ${missingCoreClip.directionId} reference image. Review both motion and generated sound.`,
    };
  }
  const missingExtendedClip = status.clips.find(({ group, mediaPath }) => group === "extended-actions" && !mediaPath);
  if (missingExtendedClip) {
    return {
      kind: "animation",
      title: `Generate optional ${missingExtendedClip.directionId} ${missingExtendedClip.label.toLowerCase()}`,
      promptPath: join(status.projectRoot, "prompts", promptFileName("animation", missingExtendedClip.directionId, missingExtendedClip.id)),
      destination: join(status.sourceRoot, "videos", missingExtendedClip.directionId, `${missingExtendedClip.id}.mp4`),
      instruction: `Core runtime clips are complete. Use Veo with the approved ${missingExtendedClip.directionId} reference to prepare this extended action.`,
    };
  }
  return {
    kind: "complete",
    title: "All planned Sorceress source media is present",
    promptPath: null,
    destination: null,
    instruction: "Build the review sheets, inspect every frame, then validate the candidate assets inside the game before publishing them.",
  };
}

export function readPrompt(path) {
  return readFileSync(path, "utf8");
}
