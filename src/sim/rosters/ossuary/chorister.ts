// The Bone Chorister (Choral Crypt final boss): a robed singer that keeps its distance, hastes the
// dead around it, sends Choir Waves (expanding frost rings you walk through at the gaps) and raises Bone
// Thralls from the fallen.
import { commanderBrain } from '../kit';
import {
  DAMAGE_INDEX, TAU, attackEvent, clampToArena, fieldFull, monsterDamage, randomAngle, spawnArea, spawnMonster, summonAt, takeCorpses,
  type World,
} from '../api';
import { CHORISTER as C } from './tuning';

/**
 * Per-monster Choir Wave state (the commander keeps its own timers in memoryOf; these SoA slots are the
 * Chorister's): timerB = rings sent in the current wave, timerC = the turn direction of its gaps (±1),
 * timerD = the first ring's gap heading.
 */
function beginChoir(w: World, i: number): void {
  const m = w.monsters;
  m.timerB[i] = 0;
  m.timerC[i] = w.worldRng.next() < 0.5 ? -1 : 1;
  m.timerD[i] = randomAngle(w);
}

/**
 * One ring of a Choir Wave: a frost band expanding from the Chorister with C.gaps gaps; each ring's gaps
 * sit a little further round than the last one's (walk to the side the gaps turn). Chills on touch.
 */
function choirRing(w: World, i: number): void {
  const m = w.monsters;
  const k = m.timerB[i];
  m.timerB[i] = k + 1;
  spawnArea(w, 'choirWave', m.x[i], m.y[i], C.ringStart, C.ringTime, {
    endRadius: C.ringEnd, angle: m.timerD[i] + k * C.gapTurn * m.timerC[i], variant: C.gaps - 1, hurts: 'player',
    damage: monsterDamage(w, i) * C.ringMult, dtype: DAMAGE_INDEX.cold,
  });
  attackEvent(w, i, 'sing');
}

/**
 * Raise Bone Thralls from the nearest unused corpses in reach (any kind: bones are bones), and from the
 * ground around the Chorister when there are too few. Raised thralls are summons: no loot, half XP.
 */
function raiseThralls(w: World, i: number): void {
  const m = w.monsters;
  if (fieldFull(w)) return;
  let raised = 0;
  for (const c of takeCorpses(w, m.x[i], m.y[i], C.raiseRadius, C.raiseCorpses)) {
    if (summonAt(w, i, 'boneThrall', c.x, c.y) >= 0) raised++;
  }
  const missing = C.raiseMin - raised;
  if (missing <= 0) return;
  const base = randomAngle(w);
  for (let k = 0; k < missing; k++) {
    const a = base + (k / missing) * TAU;
    const r = w.worldRng.range(C.raiseRingMin, C.raiseRingMax);
    const p = clampToArena(w, m.x[i] + Math.cos(a) * r, m.y[i] + Math.sin(a) * r, 16);
    summonAt(w, i, 'boneThrall', p.x, p.y);
  }
}

/**
 * Keeps 100–165 from its player. Aura: allies within 110 move HASTE_BONUS (25%) faster. Every 4 s a
 * 0.6 s toll, then a Choir Wave of two rings 0.6 s apart ('sing' on each ring). Every 9 s a 0.9 s chant
 * ('summon' when it starts), then thralls rise — neither while SUMMON_FIELD_CAP monsters are alive.
 */
export const brainChorister = commanderBrain({
  keepNear: C.keepNear,
  keepFar: C.keepFar,
  haste: C.haste,
  actions: [
    {
      every: C.choirEvery, first: C.choirFirst, cast: C.choirCast, release: C.release, repeats: C.rings, gap: C.ringGap,
      onCast: beginChoir,
      run: choirRing,
    },
    {
      every: C.raiseEvery, first: C.raiseFirst, cast: C.raiseCast, release: C.release, castAttack: 'summon',
      when: (w) => !fieldFull(w),
      run: raiseThralls,
    },
  ],
});

/** Arrival: a guard of Bone Thralls (regular pack members: they drop loot). */
export function onChoristerSpawn(w: World, i: number, pack: number, x: number, y: number): void {
  for (let k = 0; k < C.escorts; k++) {
    const a = (k / C.escorts) * TAU + 0.4;
    const p = clampToArena(w, x + Math.cos(a) * 30, y + Math.sin(a) * 30, 16);
    spawnMonster(w, 'boneThrall', p.x, p.y, { pack, wave: w.monsters.wave[i] });
  }
}
