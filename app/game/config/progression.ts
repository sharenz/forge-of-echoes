export const MAX_CHARACTER_LEVEL = 99;

export const XP_BY_LEVEL = (level: number): number =>
  Math.max(80, Math.floor(65 * Math.pow(level, 1.58)));
