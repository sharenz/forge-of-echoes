export const ASSET_TYPES = [
  {
    id: "character",
    label: "Character",
    description: "A playable class with directional locomotion, combat actions, and audio",
    available: true,
  },
  {
    id: "monster",
    label: "Monster",
    description: "Enemy design, actions, death, and positional sound",
    available: false,
  },
  {
    id: "portal",
    label: "Portal",
    description: "Looping world animation, activation sequence, VFX, and ambient audio",
    available: false,
  },
  {
    id: "world-object",
    label: "World object",
    description: "Chests, map devices, crafting stations, props, and interactables",
    available: false,
  },
];

export const CHARACTER_PROJECTS = [
  {
    id: "sorceress",
    label: "Sorceress",
    description: "Rebuild the current playable class",
    available: true,
  },
  {
    id: "new-class",
    label: "Another class",
    description: "Reusable class creation will follow the Sorceress pipeline",
    available: false,
  },
];

export const SORCERESS_DIRECTIONS = [
  { id: "south", label: "South · facing the camera", description: "Elevated front three-quarter game view" },
  { id: "north", label: "North · facing away", description: "Elevated rear three-quarter game view" },
  { id: "east", label: "East · facing right", description: "Elevated side three-quarter game view; west is mirrored initially" },
];

export const SORCERESS_CLIPS = [
  {
    id: "idle",
    label: "Idle",
    group: "locomotion",
    frames: 10,
    frameRate: 8,
    loop: true,
    motion: "She remains firmly planted and breathes naturally. Her shoulders and hands move subtly, her hair and layered robes settle gently, and the small staff ember flickers. Her legs and feet do not walk, step, slide, or change stance. End on the exact opening pose for a seamless loop.",
    audio: "Isolated quiet robe movement and a very soft close fire crackle. No footsteps, voice, music, ambience, reverb, or environmental sound.",
  },
  {
    id: "run",
    label: "Run",
    group: "locomotion",
    frames: 12,
    frameRate: 12,
    loop: true,
    motion: "She performs one complete, energetic running cycle in place without travelling across the frame. Her feet make two clear ground contacts, while her hair and robes follow the motion with controlled secondary movement. End on the exact opening pose for a seamless loop.",
    audio: "Two clean light boot impacts on dry stone with restrained cloth movement. No voice, music, ambience, reverb, or environmental sound.",
  },
  {
    id: "attack",
    label: "Basic attack",
    group: "actions",
    frames: 10,
    frameRate: 14,
    loop: false,
    motion: "Starting in her neutral stance, she draws the staff back and performs one decisive forward staff thrust, then settles back into the identical neutral stance. The strongest readable strike pose occurs around sixty percent through the clip. No projectile or detached spell effect leaves the staff.",
    audio: "One isolated sharp staff movement with a compact fiery whoosh at the strike. No impact target, voice, music, ambience, reverb, or environmental sound.",
  },
  {
    id: "cast",
    label: "Spell cast",
    group: "actions",
    frames: 12,
    frameRate: 12,
    loop: false,
    motion: "Starting in her neutral stance, she gathers power close to the body, raises and arcs the staff with a strong readable silhouette, then releases the spell forward and returns to the identical neutral stance. The release pose occurs around sixty percent through the clip. No projectile, nova, ground effect, or detached spell effect appears.",
    audio: "An isolated short magical charge followed by one clean fiery release whoosh. No voice, music, ambience, reverb, or environmental sound.",
  },
  {
    id: "dash",
    label: "Dash",
    group: "extended-actions",
    frames: 8,
    frameRate: 18,
    loop: false,
    motion: "She compresses into a sharp forward-leaning dash pose and recovers to the identical neutral stance. Her body conveys sudden acceleration, but she remains centered and does not travel across the frame; game code applies displacement. No trail, projectile, smoke, or detached magical effect appears.",
    audio: "One isolated fast cloth snap and compact magical displacement whoosh. No voice, music, ambience, reverb, or environmental sound.",
  },
  {
    id: "hit",
    label: "Hit reaction",
    group: "extended-actions",
    frames: 7,
    frameRate: 14,
    loop: false,
    motion: "Starting in her neutral stance, she recoils once from a moderate impact without falling, then regains the identical neutral stance. The staff remains in her hand. No attacker, projectile, blood, flash, or detached effect appears.",
    audio: "One isolated restrained cloth-and-armor impact. No spoken line, scream, music, ambience, reverb, or environmental sound.",
  },
  {
    id: "death",
    label: "Death",
    group: "extended-actions",
    frames: 16,
    frameRate: 12,
    loop: false,
    motion: "Starting in her neutral stance, she loses strength and falls naturally to the ground in one readable motion. She remains motionless in the final fallen pose and does not stand up, reset, dissolve, or disappear. The staff falls with her and remains visible. No attacker, projectile, blood, flash, or detached effect appears.",
    audio: "One isolated body-and-cloth fall with the staff contacting dry stone. No spoken line, scream, music, ambience, reverb, or environmental sound.",
  },
];

export const SORCERESS_PROJECT = {
  schemaVersion: 1,
  assetType: "character",
  id: "sorceress",
  displayName: "Sorceress",
  sourceRoot: "art-source/characters/sorceress",
  projectRoot: "asset-projects/characters/sorceress",
  outputRoot: "art-source/characters/sorceress/build",
  directions: SORCERESS_DIRECTIONS.map(({ id }) => id),
  clips: SORCERESS_CLIPS.map(({ id, group, frames, frameRate, loop }) => ({ id, group, frames, frameRate, loop })),
  runtime: {
    initialDirections: ["south", "north", "east"],
    mirroredDirection: { west: "east" },
    atlasCellSize: 304,
  },
};

const DESIGN = `an ember sorceress and keeper of the last flame; an immediately readable dark-fantasy ARPG silhouette; elegant layered charcoal and deep-purple robes with restrained glowing ember-orange trim; long dark hair with subtle ember glints; an ornate but practical flame staff carrying one small contained ember; believable anatomy; premium hand-painted pixel-art-inspired game illustration; rich controlled contrast; consistent materials and proportions`;

const CAMERA = `Fixed elevated three-quarter camera matching an isometric action RPG; full body visible from head to feet; centered with generous clear margin; character sized consistently; no perspective distortion`;

const CLEAN_BACKGROUND = `perfectly flat solid chroma green #00FF00 background; no ground plane, no cast shadow, no border, no text, no UI, no scenery, no atmospheric particles`;

export function sorceressConceptPrompt() {
  return `Create the definitive gameplay character design for Forge of Echoes: ${DESIGN}. ${CAMERA}. Show her in a relaxed grounded south-facing neutral stance, holding the staff naturally. Prioritize a clean readable silhouette and details that survive reduction to roughly 160–220 pixels tall. Neutral dark studio background for design review only. No spell projectile, no large aura, no action pose, no text, no border. Produce one polished full-body character, not a character sheet.`;
}

export function sorceressDirectionPrompt(directionId) {
  const direction = SORCERESS_DIRECTIONS.find((candidate) => candidate.id === directionId);
  if (!direction) throw new Error(`Unknown Sorceress direction: ${directionId}`);
  const view = directionId === "south"
    ? "She faces toward the camera in the south-facing gameplay direction."
    : directionId === "north"
      ? "She faces directly away from the camera in the north-facing gameplay direction; show the exact rear construction of the same costume and staff."
      : "She faces right in the east-facing gameplay direction; preserve the same elevated camera angle rather than switching to a flat orthographic side view.";
  return `Using the attached approved Sorceress master image as the strict identity reference, render exactly the same character: ${DESIGN}. Do not redesign, simplify, add, remove, or move costume elements. ${CAMERA}. ${view} Relaxed grounded neutral stance with both feet fully visible and the staff held naturally. Match the master image's scale, lighting direction, palette, anatomy, face, hair, staff, and robe construction exactly. ${CLEAN_BACKGROUND}. Output one character only.`;
}

export function sorceressAnimationPrompt(directionId, clipId) {
  const direction = SORCERESS_DIRECTIONS.find((candidate) => candidate.id === directionId);
  const clip = SORCERESS_CLIPS.find((candidate) => candidate.id === clipId);
  if (!direction) throw new Error(`Unknown Sorceress direction: ${directionId}`);
  if (!clip) throw new Error(`Unknown Sorceress clip: ${clipId}`);
  const loopInstruction = clip.loop
    ? "The first and final pose must match exactly and the motion must form one seamless loop."
    : clip.id === "death"
      ? "This is a single non-looping action; hold the final fallen pose through the end."
      : "This is one non-looping action starting and ending in the same neutral pose.";
  return `Animate the attached approved Sorceress ${directionId} reference image as a strict image-to-video identity reference.

IDENTITY AND CAMERA
Keep the exact character design, face, anatomy, costume, colors, proportions, staff, camera angle, framing, lighting, and scale unchanged in every frame. Locked-off static camera: no zoom, pan, orbit, shake, cut, reframing, or focus change. The character remains centered with her entire body and staff visible. ${direction.description}. ${CLEAN_BACKGROUND}.

MOTION — ${clip.label.toUpperCase()}
${clip.motion} ${loopInstruction}

AUDIO
${clip.audio} Generate synchronized dry game sound effects only. Keep the audio clean enough to extract into individual gameplay samples.

TECHNICAL NEGATIVES
No character drift, foot sliding outside the intended action, morphing, costume changes, extra limbs, broken hands, changing staff geometry, background texture, ground shadow, baked projectile, baked gameplay VFX, subtitles, watermark, logo, or camera motion.`;
}

export function promptFileName(kind, directionId, clipId) {
  if (kind === "concept") return "01-concept.md";
  if (kind === "direction") return `directions/${directionId}.md`;
  if (kind === "animation") return `animations/${directionId}-${clipId}.md`;
  throw new Error(`Unknown prompt kind: ${kind}`);
}
