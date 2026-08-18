import type { CharacterClassId } from "../domain";

export type CharacterDirection = "north" | "south" | "east" | "west";
export type CharacterAnimationState = "idle" | "run" | "attack" | "cast" | "dash";

export interface CharacterAnimationClipDefinition {
  row: number;
  startColumn: number;
  frameCount: number;
  frameRate: number;
  repeat: number;
  releaseFrame?: number;
}

export interface CharacterSpriteSheetDefinition {
  url: string;
  frameWidth: number;
  frameHeight: number;
  renderScale: number;
}

export const CHARACTER_SPRITE_SHEETS: Record<CharacterClassId, CharacterSpriteSheetDefinition> = {
  amazon: { url: "/player-amazon-sheet-v1.png", frameWidth: 181, frameHeight: 181, renderScale: 0.82 },
  barbarian: { url: "/player-barbarian-sheet-v1.png", frameWidth: 181, frameHeight: 181, renderScale: 0.82 },
  sorceress: { url: "/player-sorceress-sheet-v1.png", frameWidth: 181, frameHeight: 181, renderScale: 0.82 },
};

const directionalRows = {
  south: { locomotion: 0, actions: 1 },
  north: { locomotion: 2, actions: 3 },
  east: { locomotion: 4, actions: 5 },
} as const;

function clipsForDirection(direction: keyof typeof directionalRows): Record<CharacterAnimationState, CharacterAnimationClipDefinition> {
  const rows = directionalRows[direction];
  return {
    idle: { row: rows.locomotion, startColumn: 0, frameCount: 4, frameRate: 5, repeat: -1 },
    run: { row: rows.locomotion, startColumn: 4, frameCount: 4, frameRate: 11, repeat: -1 },
    attack: { row: rows.actions, startColumn: 0, frameCount: 4, frameRate: 12, repeat: 0, releaseFrame: 2 },
    cast: { row: rows.actions, startColumn: 4, frameCount: 4, frameRate: 10, repeat: 0, releaseFrame: 2 },
    dash: { row: rows.locomotion, startColumn: 4, frameCount: 4, frameRate: 18, repeat: 0, releaseFrame: 1 },
  };
}

export const CHARACTER_ANIMATION_CLIPS: Record<CharacterDirection, Record<CharacterAnimationState, CharacterAnimationClipDefinition>> = {
  south: clipsForDirection("south"),
  north: clipsForDirection("north"),
  east: clipsForDirection("east"),
  west: clipsForDirection("east"),
};

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
