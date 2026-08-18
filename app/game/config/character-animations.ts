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

const legacyDirectionalRows = {
  south: { locomotion: 0, actions: 1 },
  north: { locomotion: 2, actions: 3 },
  east: { locomotion: 4, actions: 5 },
} as const;

function legacyClipsForDirection(direction: keyof typeof legacyDirectionalRows): Record<CharacterAnimationState, CharacterAnimationClipDefinition> {
  const rows = legacyDirectionalRows[direction];
  return {
    idle: { sheet: "main", row: rows.locomotion, startColumn: 0, frameCount: 4, frameRate: 5, repeat: -1 },
    run: { sheet: "main", row: rows.locomotion, startColumn: 4, frameCount: 4, frameRate: 11, repeat: -1 },
    attack: { sheet: "main", row: rows.actions, startColumn: 0, frameCount: 4, frameRate: 12, repeat: 0, releaseFrame: 2 },
    cast: { sheet: "main", row: rows.actions, startColumn: 4, frameCount: 4, frameRate: 10, repeat: 0, releaseFrame: 2 },
    dash: { sheet: "main", row: rows.locomotion, startColumn: 4, frameCount: 4, frameRate: 18, repeat: 0, releaseFrame: 1 },
  };
}

function legacyClips(): CharacterAnimationDefinition["clips"] {
  return {
    south: legacyClipsForDirection("south"),
    north: legacyClipsForDirection("north"),
    east: legacyClipsForDirection("east"),
    west: legacyClipsForDirection("east"),
  };
}

const sorceressRows = {
  south: { idle: 0, run: 1, attack: 0, cast: 1 },
  north: { idle: 2, run: 3, attack: 2, cast: 3 },
  east: { idle: 4, run: 5, attack: 4, cast: 5 },
} as const;

function sorceressClipsForDirection(direction: keyof typeof sorceressRows): Record<CharacterAnimationState, CharacterAnimationClipDefinition> {
  const rows = sorceressRows[direction];
  // The generated east-facing strip has seven complete poses. West mirrors it.
  const frameCount = direction === "east" ? 7 : 8;
  return {
    idle: { sheet: "locomotion", row: rows.idle, startColumn: 0, frameCount, frameRate: 7, repeat: -1 },
    run: { sheet: "locomotion", row: rows.run, startColumn: 0, frameCount, frameRate: 13, repeat: -1 },
    attack: { sheet: "actions", row: rows.attack, startColumn: 0, frameCount, frameRate: 14, repeat: 0, releaseFrame: 4 },
    cast: { sheet: "actions", row: rows.cast, startColumn: 0, frameCount, frameRate: 12, repeat: 0, releaseFrame: 4 },
    dash: { sheet: "locomotion", row: rows.run, startColumn: 0, frameCount, frameRate: 18, repeat: 0, releaseFrame: 2 },
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

const legacySheet = (url: string): CharacterSpriteSheetDefinition => ({
  url,
  columns: 8,
  frameWidth: 181,
  frameHeight: 181,
});

export const CHARACTER_ANIMATIONS: Record<CharacterClassId, CharacterAnimationDefinition> = {
  amazon: {
    sheets: { main: legacySheet("/player-amazon-sheet-v1.png") },
    defaultSheet: "main",
    renderScale: 0.82,
    footPadding: 0,
    clips: legacyClips(),
  },
  barbarian: {
    sheets: { main: legacySheet("/player-barbarian-sheet-v1.png") },
    defaultSheet: "main",
    renderScale: 0.82,
    footPadding: 0,
    clips: legacyClips(),
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

export function characterDirectionVector(direction: CharacterDirection): { x: number; y: number } {
  if (direction === "north") return { x: 0, y: -1 };
  if (direction === "south") return { x: 0, y: 1 };
  if (direction === "west") return { x: -1, y: 0 };
  return { x: 1, y: 0 };
}
