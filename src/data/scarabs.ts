import { SCARAB_IDS, type ScarabId } from '../contracts/content';

export interface ScarabDef {
  id: ScarabId;
  name: string;
  family: 'haste' | 'invasion';
  tier: number;
  minMonsterLevel: number;
  weight: number;
  durationLess: number;
  startWave: number;
  description: string;
}

/** Separate rare drop roll; quantity and monster rarity's quantity multiplier apply. */
export const SCARAB_DROP_CHANCE = 0.0005;
export const SCARABS: readonly ScarabDef[] = SCARAB_IDS.map((id, index) => {
  const tier = index % 4 + 1;
  const haste = id.startsWith('haste');
  const durationLess = haste ? [15, 25, 35, 50][tier - 1] : 0;
  const startWave = haste ? 1 : tier + 1;
  return {
    id, tier, family: haste ? 'haste' as const : 'invasion' as const, name: `${['Weathered', 'Etched', 'Gilded', 'Exalted'][tier - 1]} ${haste ? 'Haste' : 'Invasion'} Scarab`,
    minMonsterLevel: [4, 22, 46, 70][tier - 1], weight: [100, 30, 8, 2][tier - 1], durationLess, startWave,
    description: haste
      ? `Reduces wave duration by ${durationLess}%. Only one Haste Scarab per map, regardless of tier.`
      : `Starts at wave ${startWave}. Every monster from waves 1–${startWave} spawns at the opening, including the streaming monsters. Only one Invasion Scarab per map.`,
  };
});
export function findScarab(id: unknown): ScarabDef | undefined { return SCARABS.find(s => s.id === id); }
export function isScarabId(id: unknown): id is ScarabId { return !!findScarab(id); }
export function scarabEffects(ids: readonly ScarabId[] = []) {
  return ids.reduce((effects, id) => {
    const s = findScarab(id)!;
    return { durationMultiplier: effects.durationMultiplier * (1 - s.durationLess / 100), startWave: Math.max(effects.startWave, s.startWave) };
  }, { durationMultiplier: 1, startWave: 1 });
}
/** Invalid persisted expedition data is refused rather than silently losing paid modifiers. */
export function validScarabs(raw: unknown): raw is ScarabId[] {
  return Array.isArray(raw) && raw.length <= 4 && raw.every(isScarabId)
    && new Set(raw.map(id => findScarab(id)!.family)).size === raw.length;
}
