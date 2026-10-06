// The `convert` primitive (Frostfire Core, Inverted Heat, Void Convert): a share of the hit becomes a second damage type (the
// projectile's convTo / convShare columns: sim/combat.ts resists, penetrates and ailments each share on its own type). The rules
// already gave the hit both types' modifiers. What the ailment does is the primitive's choice:
//   keep     both parts roll their own type's ailment at the skill's chance (the plain conversion)
//   always   the converted type's ailment always lands; the rest keeps its own chance (Frostfire Core: hits always chill)
//   instead  the projectile carries no ailment chance; the converted type's ailment rolls at the skill's chance (Inverted Heat)
//   decay    no elemental ailment; hits apply Decay (Void Convert)
import { DAMAGE_TYPES } from '../../../contracts/content';
import type { AugmentRuntime, SkillRuntimeDef } from '../../../contracts/sim';
import { DOT_RESIST_FACTOR } from '../../../data/progression/combat';
import { applyAilment, applyDecay, monsterResist } from '../../combat';
import { DAMAGE_INDEX } from '../../math';
import type { ProjectileSpec } from '../../projectiles';
import type { World } from '../../world';

type Convert = Extract<AugmentRuntime, { p: 'convert' }>;

/** Fill a projectile spec's conversion (and its ailment chance) for a converted skill. */
export function convertSpec(s: ProjectileSpec, def: SkillRuntimeDef, c: Convert): void {
  s.convTo = DAMAGE_INDEX[c.to];
  s.convShare = Math.max(0, Math.min(1, c.share));
  s.ailmentChance = c.ailment === 'instead' || c.ailment === 'decay' ? 0 : def.ailmentChance;
}

/** After a converted hit of `hit` average damage on monster slot `i`: the ailment the primitive asks for. */
export function convertedHit(w: World, i: number, owner: number, hit: number, def: SkillRuntimeDef, c: Convert): void {
  if (!w.monsters.alive[i] || c.ailment === 'keep') return;
  if (c.ailment === 'decay') {
    if (c.decay && c.decay > 0) applyDecay(w, i, hit, c.decay, owner);
    return;
  }
  const to = DAMAGE_INDEX[c.to];
  const pen = owner > 0 ? w.playerById[owner]?.stats.pen?.[DAMAGE_TYPES[to]] ?? 0 : 0;
  const r = monsterResist(w, i, to, pen);
  applyAilment(w, i, hit * c.share * (1 - DOT_RESIST_FACTOR * r), to, c.ailment === 'always' ? 1 : def.ailmentChance, owner);
}
