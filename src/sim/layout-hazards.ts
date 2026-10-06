// Layout hazards in the sim (roadmap 4, "make the art keep its promises"): slag pools and lava cracks authored with a `hazard`
// (src/data/layouts/hazards.ts) burn the players standing on them. Every HAZARD_TICK seconds, each living player whose feet touch a
// burning hazard takes fire damage (scaled like the map's volcanic eruptions: the monsters' damage multiplier and the wave) and
// catches fire. Cracks warn first: their flare telegraph (a widening glow the presenter draws from the same schedule) lasts
// 1.5 s, so a player who reads the ground is never caught. Nothing burns once the map is cleared, and monsters are unharmed.
//
// Determinism: a pure function of the layout, the sim clock and the players; no RNG beyond the hit's own roll in hitPlayer.
import { hazardHits, hazardState, type CompiledHazard } from '../data/layouts/hazards';
import { damagePlayer, DT_FIRE } from './combat';
import { DT, PLAYER_RADIUS, WAVE_DAMAGE_GROWTH } from './constants';
import type { World } from './world';

/** Seconds between two burns of a player standing on burning ground. */
export const HAZARD_TICK = 0.5;
/** Base fire damage of one burn (before the map's damage multiplier and wave growth): a fire pool's tick and a quarter. */
export const HAZARD_DAMAGE = 3;
const TICKS = Math.round(HAZARD_TICK / DT);

/** Fire damage of one burn right now. */
export function hazardDamage(w: World): number {
  return HAZARD_DAMAGE * w.config.monsters.damageMultiplier * (1 + WAVE_DAMAGE_GROWTH * Math.max(0, w.director.wave - 1));
}

/** Is a player at (x, y) on a burning hazard at sim time `t`? (Shared with the tests and the bot's danger sense.) */
export function onBurningHazard(hazards: readonly CompiledHazard[], x: number, y: number, t: number): boolean {
  for (let k = 0; k < hazards.length; k++) {
    const h = hazards[k];
    if (hazardState(h, t).state === 2 && hazardHits(h, x, y, PLAYER_RADIUS * 0.5)) return true;
  }
  return false;
}

export function updateLayoutHazards(w: World): void {
  const hazards = w.layout?.compiled.hazards;
  if (!hazards || hazards.length === 0 || w.tick % TICKS !== 0 || w.director.cleared) return;
  const living = w.living;
  let dmg = -1;
  for (let k = 0; k < living.length; k++) {
    const p = living[k];
    if (p.dead || !onBurningHazard(hazards, p.x, p.y, w.time)) continue;
    if (dmg < 0) dmg = hazardDamage(w);
    damagePlayer(w, p, dmg, DT_FIRE, 'area', 'burning');
  }
}
