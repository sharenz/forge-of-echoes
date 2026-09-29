// The Chainmaster (Chainworks final boss; GAME_SPEC §14).
//
//   Hook     every CHAINMASTER.hookEvery s: aims at the FARTHEST living player within hookMax who is at least
//            hookMin away. The cast shows a locked aim line (chargeLine variant 0) from his fist for its whole
//            windup; the chainHook then flies exactly along it ('hook'). A hook that connects drags its victim
//            to about hookLeave units from him (at most PULL_MAX_DISTANCE) and roots them ('chain').
//   Whirl    when a player is within whirlRange: his chains spin round him — a harmless ring (whirlwind
//            variant 0) for the whole cast ('whirl'), then the blades (variant 1) for whirlChannel s while he
//            walks at his target (never into a held one): every tick interval they hit and Bleed whoever they
//            touch. No whirl starts for hookGate s after a hook, so a hooked player's root always runs out long
//            before blades turn.
//   Summons  Chain Thralls ('summon') while fewer than summonCap of them are near him and the field isn't saturated
//            (SUMMON_FIELD_CAP); arrives with escorts.
//   Melee    a plain hit when a player touches him.
// Per-monster state: m.timerD = seconds left of the hook gate; during the hook cast m.timerC = 1 (an aim is
// locked: he faces along it) with the aim line's heading / reach / start point in m.sx / m.sy / m.tx, m.ty
// (commanderBrain keeps its timers in memoryOf). Telegraph starts are the areas themselves (the aim line, the
// ring); the cues mark the releases.
import { MONSTER_KINDS } from '../../../contracts/content';
import { commanderBrain } from '../kit';
import {
  DAMAGE_INDEX, DT, MSTATE, PROJ, PULL_MAX_DISTANCE, TAU, attackEvent, clamp, clampToArena, farthestLiving, fieldFull, fireHostileFrom,
  monsterDamage, moveAlong, muzzleOffset, quantizeAreaAngle, setProjectilePull, spawnArea, spawnMonster, stop, summon, type Brain, type World,
} from '../api';
import { held } from './common';
import { CHAINMASTER as C } from './tuning';

const CHAIN_THRALL = MONSTER_KINDS.indexOf('chainThrall');

/** The player his hook would go for (farthest within hookMax), or null when none is at least hookMin away. */
function hookTarget(w: World, i: number) {
  const m = w.monsters;
  const p = farthestLiving(w, m.x[i], m.y[i], C.hookMax);
  if (!p) return null;
  const dx = p.x - m.x[i];
  const dy = p.y - m.y[i];
  return dx * dx + dy * dy >= C.hookMin * C.hookMin ? p : null;
}

/** Hook cast start: lock the heading toward the farthest player and show the aim line from his fist. */
function hookAim(w: World, i: number): void {
  const m = w.monsters;
  const p = hookTarget(w, i);
  if (!p) return;
  const a = quantizeAreaAngle(Math.atan2(p.y - m.y[i], p.x - m.x[i]));
  const off = muzzleOffset(w, i);
  const d = Math.hypot(p.x - m.x[i], p.y - m.y[i]);
  m.sx[i] = a;
  m.sy[i] = Math.min(C.hookMax + 40, d + 40); // the hook's reach along the line
  m.tx[i] = m.x[i] + Math.cos(a) * off;
  m.ty[i] = m.y[i] + Math.sin(a) * off;
  m.timerC[i] = 1; // an aim is locked
  spawnArea(w, 'chargeLine', m.tx[i], m.ty[i], m.sy[i], C.hookCast, { angle: a, variant: 0, owner: m.id[i], hurts: 'none', debuff: null });
}

/** Hook release: the chain flies exactly along the aim line; its pull brings the victim to him. */
function hookThrow(w: World, i: number): void {
  const m = w.monsters;
  if (m.timerC[i] !== 1) return;
  m.timerC[i] = 0;
  const a = m.sx[i];
  const reach = m.sy[i];
  m.facing[i] = Math.cos(a) >= 0 ? 1 : -1;
  const slot = fireHostileFrom(
    w, i, PROJ.chainHook, m.tx[i], m.ty[i], a, C.hookSpeed, reach, C.hookRadius, monsterDamage(w, i) * C.hookMult, DAMAGE_INDEX.physical,
  );
  setProjectilePull(w, slot, clamp(reach - 40 - C.hookLeave, 40, PULL_MAX_DISTANCE));
  attackEvent(w, i, 'hook');
  m.timerD[i] = C.hookGate;
}

/** A whirlwind ring following monster `i` (variant 0: the harmless windup, 1: bleeding chains). */
export function chainWhirl(w: World, i: number, radius: number, duration: number, blades: boolean, mult: number, tick: number): void {
  const m = w.monsters;
  spawnArea(w, 'whirlwind', m.x[i], m.y[i], radius, duration, {
    follow: m.id[i], variant: blades ? 1 : 0, hurts: blades ? 'player' : 'none', damage: blades ? monsterDamage(w, i) * mult : 0,
    dtype: DAMAGE_INDEX.physical, tickInterval: blades ? tick : 0, firstTick: 0.1, debuff: blades ? 'bleeding' : null,
  });
}

/** Chain Thralls within `r` of monster `i` (grid query: the positions at the start of this tick). */
function thrallsNear(w: World, i: number, r: number): number {
  const m = w.monsters;
  const cand = w.scratch2;
  const n = w.grid.query(m.x[i] - r, m.y[i] - r, m.x[i] + r, m.y[i] + r, cand);
  let c = 0;
  for (let k = 0; k < n; k++) {
    const j = cand[k];
    if (!m.alive[j] || m.kind[j] !== CHAIN_THRALL) continue;
    const dx = m.x[j] - m.x[i];
    const dy = m.y[j] - m.y[i];
    if (dx * dx + dy * dy <= r * r) c++;
  }
  return c;
}

/** The Chainmaster's brain (built when the roster table is): the hook gate, then his commander (see the header). */
export function chainmasterBrain(): Brain {
  const commander = commanderBrain({
    keepNear: C.keepNear,
    keepFar: C.keepFar,
    melee: { reach: C.meleeReach, cooldown: C.meleeCd },
    actions: [
      {
        every: C.hookEvery, first: C.hookFirst, cast: C.hookCast, release: C.hookRelease,
        when: (w, i) => hookTarget(w, i) !== null,
        onCast: hookAim,
        run: hookThrow,
      },
      {
        every: C.whirlEvery, first: C.whirlFirst, cast: C.whirlCast, castAttack: 'whirl', range: C.whirlRange, channel: C.whirlChannel,
        release: C.whirlRelease,
        when: (w, i) => w.monsters.timerD[i] <= 0,
        onCast: (w, i) => chainWhirl(w, i, C.whirlRadius, C.whirlCast, false, 0, 0),
        run: (w, i) => chainWhirl(w, i, C.whirlRadius, C.whirlChannel, true, C.whirlMult, C.whirlTick),
        // He walks his chains at his target — but never into one who is held (a thrall's hook, tar).
        tick: (w, i, t, dx, dy) => {
          if (t && !held(t)) moveAlong(w, i, dx, dy, C.whirlSpeed);
          else stop(w, i);
        },
      },
      {
        every: C.summonEvery, first: C.summonFirst, cast: C.summonCast,
        when: (w, i) => !fieldFull(w) && thrallsNear(w, i, C.summonCountRadius) < C.summonCap,
        run: (w, i) => summon(w, i, 'chainThrall', C.summonCount, 36, 64),
      },
    ],
  });
  return (w, i, t, dx, dy, d, hunting) => {
    const m = w.monsters;
    if (m.timerD[i] > 0) m.timerD[i] -= DT;
    commander(w, i, t, dx, dy, d, hunting);
    // The hook's cast faces his own locked aim line, not the nearest player (the commander turns him to them).
    if (m.state[i] !== MSTATE.cast) m.timerC[i] = 0;
    else if (m.timerC[i] === 1) m.facing[i] = Math.cos(m.sx[i]) >= 0 ? 1 : -1;
  };
}

/** Director spawn: his escort of Chain Thralls, round him and inside the arena. */
export function onChainmasterSpawn(w: World, i: number, pack: number, x: number, y: number): void {
  const m = w.monsters;
  for (let k = 0; k < C.escorts; k++) {
    const a = (k / C.escorts) * TAU + 0.4;
    const p = clampToArena(w, x + Math.cos(a) * 32, y + Math.sin(a) * 32, 16);
    spawnMonster(w, 'chainThrall', p.x, p.y, { pack, wave: m.wave[i] });
  }
}
