import type { CharacterClassId } from "../domain";

export type CharacterDirection = "north" | "south" | "east" | "west";
export type CharacterAnimationState = "idle" | "run" | "attack" | "cast" | "dash";
export type CharacterSpriteSheetId = "main" | "locomotion" | "actions";

export interface CharacterAnimationClipDefinition {
  sheet: CharacterSpriteSheetId;
  row: number;
  startColumn: number;
  frameCount: number;
  frameRate: number;
  repeat: number;
  releaseFrame?: number;
}

export interface CharacterSpriteSheetDefinition {
  url: string;
  columns: number;
  frameWidth: number;
  frameHeight: number;
}

export interface CharacterAnimationDefinition {
  sheets: Partial<Record<CharacterSpriteSheetId, CharacterSpriteSheetDefinition>>;
  defaultSheet: CharacterSpriteSheetId;
  renderScale: number;
  footPadding: number;
  clips: Record<CharacterDirection, Record<CharacterAnimationState, CharacterAnimationClipDefinition>>;
}

const sharedDirectionalRows = {
  south: { locomotion: 0, actions: 1 },
  north: { locomotion: 2, actions: 3 },
  east: { locomotion: 4, actions: 5 },
} as const;

function sharedClipsForDirection(direction: keyof typeof sharedDirectionalRows): Record<CharacterAnimationState, CharacterAnimationClipDefinition> {
  const rows = sharedDirectionalRows[direction];
  return {
    idle: { sheet: "main", row: rows.locomotion, startColumn: 0, frameCount: 4, frameRate: 5, repeat: -1 },
    run: { sheet: "main", row: rows.locomotion, startColumn: 4, frameCount: 4, frameRate: 11, repeat: -1 },
    attack: { sheet: "main", row: rows.actions, startColumn: 0, frameCount: 4, frameRate: 12, repeat: 0, releaseFrame: 2 },
    cast: { sheet: "main", row: rows.actions, startColumn: 4, frameCount: 4, frameRate: 10, repeat: 0, releaseFrame: 2 },
    dash: { sheet: "main", row: rows.locomotion, startColumn: 4, frameCount: 4, frameRate: 18, repeat: 0, releaseFrame: 1 },
  };
}

function sharedClips(): CharacterAnimationDefinition["clips"] {
  return {
    south: sharedClipsForDirection("south"),
    north: sharedClipsForDirection("north"),
    east: sharedClipsForDirection("east"),
    west: sharedClipsForDirection("east"),
  };
}

const sorceressRows = {
  south: { idle: 0, run: 1, attack: 0, cast: 1 },
  north: { idle: 2, run: 3, attack: 2, cast: 3 },
  east: { idle: 4, run: 5, attack: 4, cast: 5 },
} as const;

function sorceressClipsForDirection(direction: keyof typeof sorceressRows): Record<CharacterAnimationState, CharacterAnimationClipDefinition> {
  const rows = sorceressRows[direction];
  // All eight side-facing locomotion poses are required: the final pose bridges
  // the stride back to frame zero. West mirrors this same seamless strip.
  const sideRunFrameCount = 8;
  const defaultFrameCount = direction === "east" ? 7 : 8;
  return {
    // The generated idle row contains leg-step variants, so a single grounded
    // pose is intentionally held until a dedicated breathing-only clip exists.
    idle: { sheet: "locomotion", row: rows.idle, startColumn: 0, frameCount: 1, frameRate: 1, repeat: -1 },
    run: { sheet: "locomotion", row: rows.run, startColumn: 0, frameCount: sideRunFrameCount, frameRate: 13, repeat: -1 },
    attack: { sheet: "actions", row: rows.attack, startColumn: 0, frameCount: defaultFrameCount, frameRate: 14, repeat: 0, releaseFrame: 4 },
    cast: { sheet: "actions", row: rows.cast, startColumn: 0, frameCount: defaultFrameCount, frameRate: 12, repeat: 0, releaseFrame: 4 },
    dash: { sheet: "locomotion", row: rows.run, startColumn: 0, frameCount: sideRunFrameCount, frameRate: 18, repeat: 0, releaseFrame: 2 },
  };
}

function sorceressClips(): CharacterAnimationDefinition["clips"] {
  return {
    south: sorceressClipsForDirection("south"),
    north: sorceressClipsForDirection("north"),
    east: sorceressClipsForDirection("east"),
    west: sorceressClipsForDirection("east"),
  };
}

const sharedSheet = (url: string): CharacterSpriteSheetDefinition => ({
  url,
  columns: 8,
  frameWidth: 181,
  frameHeight: 181,
});

export const CHARACTER_ANIMATIONS: Record<CharacterClassId, CharacterAnimationDefinition> = {
  amazon: {
    sheets: { main: sharedSheet("/player-amazon-sheet-v1.png") },
    defaultSheet: "main",
    renderScale: 0.82,
    footPadding: 0,
    clips: sharedClips(),
  },
  barbarian: {
    sheets: { main: sharedSheet("/player-barbarian-sheet-v1.png") },
    defaultSheet: "main",
    renderScale: 0.82,
    footPadding: 0,
    clips: sharedClips(),
  },
  sorceress: {
    sheets: {
      locomotion: { url: "/player-sorceress-locomotion-v3.png", columns: 8, frameWidth: 304, frameHeight: 304 },
      actions: { url: "/player-sorceress-actions-v3.png", columns: 8, frameWidth: 304, frameHeight: 304 },
    },
    defaultSheet: "locomotion",
    renderScale: 0.82,
    footPadding: 18,
    clips: sorceressClips(),
  },
};

export function characterSpriteSheetKey(classId: CharacterClassId, sheet: CharacterSpriteSheetId): string {
  return `player-${classId}-${sheet}-sheet`;
}

export function characterDefaultSpriteSheetKey(classId: CharacterClassId): string {
  return characterSpriteSheetKey(classId, CHARACTER_ANIMATIONS[classId].defaultSheet);
}

export function characterVisualOffsetY(classId: CharacterClassId): number {
  const definition = CHARACTER_ANIMATIONS[classId];
  return 28 + definition.footPadding * definition.renderScale;
}

export function characterAnimationKey(classId: CharacterClassId, direction: CharacterDirection, state: CharacterAnimationState): string {
  return `player:${classId}:${direction}:${state}`;
}

export function resolveCharacterDirection(x: number, y: number, fallback: CharacterDirection = "south"): CharacterDirection {
  if (Math.abs(x) < 0.0001 && Math.abs(y) < 0.0001) return fallback;
  if (Math.abs(y) > Math.abs(x) * 0.78) return y < 0 ? "north" : "south";
  return x < 0 ? "west" : "east";
}

/**
 * Keeps four-direction locomotion stable while the player crosses a diagonal.
 * Without this hysteresis, tiny input/velocity changes repeatedly restart two
 * different animation clips and make the character appear to flicker or jump.
 */
export function resolveLocomotionDirection(
  x: number,
  y: number,
  current: CharacterDirection = "south",
): CharacterDirection {
  const absoluteX = Math.abs(x);
  const absoluteY = Math.abs(y);
  if (absoluteX < 0.0001 && absoluteY < 0.0001) return current;

  const currentIsVertical = current === "north" || current === "south";
  const switchBias = 1.3;
  const useVerticalAxis = currentIsVertical
    ? absoluteX <= absoluteY * switchBias
    : absoluteY > absoluteX * switchBias;

  if (useVerticalAxis && absoluteY >= 0.0001) return y < 0 ? "north" : "south";
  if (absoluteX >= 0.0001) return x < 0 ? "west" : "east";
  return y < 0 ? "north" : "south";
}

export function characterDirectionVector(direction: CharacterDirection): { x: number; y: number } {
  if (direction === "north") return { x: 0, y: -1 };
  if (direction === "south") return { x: 0, y: 1 };
  if (direction === "west") return { x: -1, y: 0 };
  return { x: 1, y: 0 };
}
