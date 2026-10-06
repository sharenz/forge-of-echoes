// The `blast` primitive: an extra burst a skill sets off besides its hits, with damage the rules resolved from an effectiveness
// (so Rift Step, a non-damaging skill, still scales with spell power). Where and when:
//   origin   Afterimage: where the blink started, `delay` s later
//   landing  Static Arrival: where it lands, at once
//   wardEnd  Pyre Burst: around her when the ward runs out
//   orbEnd   Frost Orb's Shatter: where the orb fades
//   final    Eye of the Storm / rowEnd Shattering Rows: queued as a strike by ../roster.ts (they share the strike telegraphs)
// Also the `weave` primitive (Phase Weave: a stride after landing) and the ward's raised cap (`wardCap`, Hardened Ember).
import type { PlayerDebuff } from '../../../contracts/bestiary';
import type { AugmentRuntime, SkillRuntimeDef } from '../../../contracts/sim';
import { cleanseDebuffs } from '../../debuffs';
import { DAMAGE_INDEX } from '../../math';
import type { PlayerState, World } from '../../world';
import { augmentCue, burstAt } from './burst';
import { augPlayer, peekPlayer, prim, schedule } from './state';

export type Blast = Extract<AugmentRuntime, { p: 'blast' }>;

/** Every blast primitive of a def (a blink can carry two: Afterimage and Static Arrival). */
export function blastsOf(def: SkillRuntimeDef, at?: Blast['at']): Blast[] {
  const out: Blast[] = [];
  for (const a of def.augments ?? []) if (a.p === 'blast' && (at === undefined || a.at === at)) out.push(a);
  return out;
}

/** Set off a blast of `def` at (x, y) now. */
export function blastNow(w: World, owner: number, def: SkillRuntimeDef, b: Blast, x: number, y: number): void {
  const dtype = DAMAGE_INDEX[b.damageType];
  augmentCue(w, owner, 'blast', x, y, b.radius, dtype);
  burstAt(w, {
    owner, x, y, radius: b.radius, damage: b.damage, dtype, critChance: def.critChance, critMult: def.critMultiplier,
    ailmentChance: b.ailment, knock: 0.5,
  });
}

/** Set off a blast at (x, y) after its delay (dropped if she dies first). */
export function blastLater(w: World, p: PlayerState, def: SkillRuntimeDef, b: Blast, x: number, y: number): void {
  if (b.delay <= 0) {
    blastNow(w, p.id, def, b, x, y);
    return;
  }
  // The afterimage shows where it will burst.
  augmentCue(w, p.id, 'lodge', x, y, b.radius, DAMAGE_INDEX[b.damageType]);
  schedule(p, w.time + b.delay, (ww, pp) => blastNow(ww, pp.id, def, b, x, y));
}

const WEAVE_CLEANSE: readonly PlayerDebuff[] = ['chilled', 'rooted'];

/** After a blink from (fx, fy) to (tx, ty): Afterimage, Static Arrival, Phase Weave. */
export function afterBlink(w: World, p: PlayerState, def: SkillRuntimeDef, fx: number, fy: number, tx: number, ty: number): void {
  if (!def.augments) return;
  for (const b of blastsOf(def, 'origin')) blastLater(w, p, def, b, fx, fy);
  for (const b of blastsOf(def, 'landing')) blastLater(w, p, def, b, tx, ty);
  const weave = prim(def, 'weave');
  if (weave) {
    p.stride.time = Math.max(p.stride.time, weave.seconds);
    p.stride.speed = Math.max(p.stride.speed, weave.speed);
    cleanseDebuffs(w, p, WEAVE_CLEANSE);
    w.events.push({ t: 'buff', playerId: p.id, skill: 'phaseStride', x: tx, y: ty, duration: weave.seconds });
  }
}

/** The ward was cast: remember its end burst and raised cap (a recast replaces both). */
export function wardCast(p: PlayerState, def: SkillRuntimeDef): void {
  const cap = prim(def, 'wardCap');
  const end = blastsOf(def, 'wardEnd')[0] ?? null;
  const s = cap || end ? augPlayer(p) : peekPlayer(p);
  if (!s) return;
  s.wardCap = cap ? cap.cap : -1;
  s.wardBlast = end;
  wardDefs.set(p, def);
}

const wardDefs = new WeakMap<PlayerState, SkillRuntimeDef>();

/** The ward ran out: Pyre Burst. */
export function wardEnded(w: World, p: PlayerState): void {
  const s = peekPlayer(p);
  if (!s || !s.wardBlast) return;
  const def = wardDefs.get(p);
  const b = s.wardBlast;
  s.wardBlast = null;
  if (def && !p.dead) blastNow(w, p.id, def, b, p.x, p.y);
}
