// Monster rosters — the extension API for the sim's monsters (GAME_SPEC §8, §13, §14).
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//  GUIDE FOR ROSTER AUTHORS
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// Layout
//   rosters/types.ts         MonsterDef, Brain, BossScript, BlockSpec, Roster (the contract of a roster)
//   rosters/api.ts           every helper a roster may use — import from here, ./kit and ./types ONLY
//   rosters/kit.ts           reusable brains: meleeBrain, skirmishBrain, shooterBrain, slamBrain,
//                            pulseBrain, commanderBrain (lieutenants / bosses), empowerAround, hasteAround
//   rosters/ashenForge/      the original roster (Ashling … Cinder Matriarch), hand-written brains
//   rosters/ossuary/         Rimed Ossuary  ─┐ export `ossuaryRoster()` / `coliseumRoster()`: one
//   rosters/coliseum/        Iron Coliseum  ─┘ MonsterDef per kind of OSSUARY/COLISEUM_MONSTERS
//   rosters/common.ts        the training dummy
//   rosters/index.ts         this file: the registry (monsterDefs, monsterDef, rosterFor)
//
// Which monsters a map uses
//   RunConfig.theme picks THEME_ROSTER[theme] (contracts/bestiary.ts; the hideout uses the Ashen
//   Forge's). The wave director (waves.ts) plans every wave from `family` (weights: MonsterDef.weight,
//   weightGrowth, fromWave; stream share: streamWeight; per-pack cap: maxPerPack), spawns `lieutenant`
//   on WaveConfig.lieutenantWave and `boss` on WaveConfig.bossWave; killing the boss clears the map.
//   A kind's stats are multiplied at spawn by MonsterScaling, +8% life / +4% damage per wave, elite mods
//   (magic packs, rare leaders) and party size — never scale them yourself. Summons (`summon`,
//   `summonAt`) drop no loot and give half XP. RunView.lieutenant / .boss show MonsterDef.name.
//
// A MonsterDef (types.ts)
//   stats        radius, life, speed, damage, xp, damageType, resist, knockback (see §14's table:
//                swarmers ≈ Ashling, bruisers ≈ Ironhide Brute, lieutenants ≈ Herald, bosses ≈ Matriarch)
//   flags        heavy (players can't shove it; bosses and lieutenants always are), hitReduction (armour:
//                less damage from hits, not from burning), ghost (drifts through monsters and props, no
//                crowding, never slows a player), block ({ arc, turnRate }: frontal shield, below).
//                A heavy body that hunts and walks (MSTATE.chase) into props without headway slides
//                around them by itself (ai.ts integrate) — no pathing needed in brains.
//   brain        called every tick while awake (see Brain in types.ts for its arguments and duties)
//   boss         BossScript: phase thresholds + roar (the core drives phases; your brain reads
//                `phaseOf(w, i)`; encounter state via `bossState<S>(w, i)`)
//   onSpawn      lieutenant / boss arrival (escorts, auras, opening timers)
//   onDeath      after it died (its slot is already free)
//
// Per-monster state
//   The SoA store `w.monsters` gives every monster: state/stateTime (MSTATE: chase, windup, attack,
//   leap, cast, charge, roar), attackCd, timerA–D, tx/ty/sx/sy (targets, start points, a locked angle),
//   offsetAngle/phase (personal randomness), aim (radians; blockers' shield direction), anim/animTime
//   (MONSTER_ANIM — the presenter's pose: use setAnim). Lieutenants and bosses with more state use
//   `memoryOf(w, i, n)` (per run, dropped on death) or their BossScript state. NEVER keep per-monster
//   state in module or closure variables: one server runs many instances with overlapping ids.
//
// Acting on players (api.ts)
//   meleeHit(w, i, t, mult?, debuff?, source?)       evadable strike (contact caps apply); −1 = missed
//   hitPlayer / damagePlayer(w, p, amount, dtype, kind, debuff?, source?)
//   hitPlayersIn(w, x, y, r, dmg, dtype, debuff, already, onHit?)   contact of a charge / sweep, once each
//                                                    (a player is hit when their body touches the circle r)
//   applyDebuff(w, p, id, hit?, source?, duration?)  directly (GAME_SPEC §13 rules: debuffs.ts header);
//                                                    nothing lands on an invulnerable player
//   knockPlayer(w, p, dx, dy, dist)                  displacement over a few ticks (after a connecting hit)
//   pullPlayer(w, p, x, y, dist, source?)            drag toward a point over PULL_TIME (0.25 s), at most
//                                                    PULL_MAX_DISTANCE (140) and never past the first
//                                                    prop in the way, then rooted; emits 'pull' (with the
//                                                    real end); nothing while invulnerable
//   Debuffs ride on hits: an evaded / invulnerable hit applies nothing; a zero-damage hit (a web) can
//   still carry one. FAIRNESS RULE: every root and freeze must come from a visible projectile or a
//   readable telegraph — never apply them from an invisible source. The core enforces the obvious
//   part: a 'melee' hit (meleeHit, kit melee) never carries 'frozen' or 'rooted' (the rider is
//   dropped); a lane's or sweep's contact must match what is drawn (below).
//
// Projectiles (any PROJECTILE_KINDS)
//   fireHostile(w, i, PROJ.kind, angle, speed, range, radius, damage, dtype, flight?) → slot
//   fireHostileFrom(w, i, PROJ.kind, x, y, angle, …) → the same from an explicit point (e.g. an aim
//                                                   line's start: the kit's shooterBrain aimLine does)
//   lobAt(w, i, kind, tx, ty, flight, radius, damage, dtype) → a lob landing on (tx, ty)
//   Each hostile kind has a default rider (projectiles.ts PROJECTILE_RIDERS): cinderSpit / matriarchOrb
//   burn, heraldOrb withers, webShot roots (web), frostShard chills, crossbowBolt bleeds. Override per
//   shot: setProjectileDebuff(w, slot, debuff | null, source). Built in: a chainHook that connects pulls
//   its victim toward its thrower (setProjectilePull for the distance, default 40, capped at
//   PULL_MAX_DISTANCE) and roots them; a tarGlob lob
//   leaves a tarPool where it lands; setProjectileSplash sets a lob's landing radius. Anything else:
//   registerProjectileEffect({ onHit, onLand, onExpire }) at module load, then setProjectileEffect.
//   Remember extraProjectiles(w) (the Splitting map mod) for volleys.
//
// Areas (any AREA_KINDS) — spawnArea(w, kind, x, y, radius, duration, AreaOptions)
//   Telegraphs resolve at age == duration ('areaResolve', damage + rider to players inside); ticking
//   ground (tickInterval) damages every interval; `owner` = the monster's id cancels its telegraphs when
//   it dies or a boss changes phase. `hurts` decides who takes DAMAGE (default 'none' = nobody); the
//   rider (`debuff`, default per kind: areas.ts AREA_RIDERS) lands on every player the area acts on
//   whenever hurts isn't 'monsters' — an icePrison or wispBurst freezes / chills even at hurts 'none';
//   a purely cosmetic area of a kind with a default rider must pass `debuff: null` (burning and
//   bleeding need damage, so they never ride a harmless area). Options the core honours for every
//   kind: follow (a monster id), followPlayer + lockAt, vx/vy drift, endRadius (grow / shrink),
//   angle + variant (packed into the id, see area-geometry.ts), target (ice prison), effect
//   (registerAreaEffect({ onTick, onResolve })). Kind conventions the presenter relies
//   on (area-geometry.ts header): chargeLine = a lane from (x, y) along its angle, length = radius,
//   width by variant (0 aim line, 1+ charge lanes); choirWave = an expanding band with variant + 1
//   gaps; icePrison = a closing ring (walk out to break it; frozen if inside when it closes);
//   wispBurst = chill in the radius, freeze in its inner 40%; blizzard = a drifting zone (its packed
//   angle is the heading at spawn only: it bounces off the arena edge);
//   tarPool = 50% slow inside + a ROOT_DURATION root on first contact; executionMark = follows then
//   locks; whirlwind = follows its monster (variant 0 = harmless windup, 1 = spinning blades).
//   areaLine(w, kind, x, y, angle, count, spacing, radius, firstDelay, stepDelay, opts) builds spike
//   runs and charge lanes out of discs.
//
// Telegraph honesty (FAIRNESS RULE, in practice)
//   - Draw a charge lane for the whole cast AND the dash (duration = cast + dash), dash exactly along
//     it (the id-quantised `area.angle`, from `area.x/y`, never past its length), and hit with exactly
//     its drawn width: hitPlayersIn(w, x, y, CHARGE_LINE_HALF_WIDTH[variant], …) from points on its
//     axis. Pick a variant at least as wide as the body. The Varkus skeleton (coliseum/) does all this.
//   - A teleport / leap must never move a monster off a lane it is telegraphing or dashing (Varkus's
//     Execution Mark skips the leap then, and no charge starts while a mark is pending).
//   - Shots with an aim line leave from the line's start (fireHostileFrom), not the shoved body.
//
// Frontal shields (MonsterDef.block)
//   While MFLAG.guard is set (at spawn; `setGuard(w, i, on)`), player projectiles travelling into its
//   front arc (±arc/2 around `m.aim[i]`) are blocked: no damage, a 'blocked' event, the projectile is
//   consumed (even a piercing one). The core turns `aim` toward the target at `turnRate` rad/s while
//   guarding (flanking is the counterplay) and faces the sprite that way; lower the guard while
//   bashing to give an opening. Arc Chain, Cinder Ward and fire trails are not projectiles.
//
// Auras
//   commanderBrain({ aura: r }) / empowerAround(w, i, r): allies within r +30% speed AND damage
//   (AILMENT_BIT.empowered, the Herald). commanderBrain({ haste: r }) / hasteAround(w, i, r): allies
//   +HASTE_BONUS (25%) speed only (the Chorister) — the frozen AILMENT_BIT has no bit for it, so the
//   presenter can't show it on the allies. Refresh either every few ticks (they last 0.25 s).
//
// Summons, corpses, targets
//   summon(w, i, kind, count, rMin, rMax), summonAt(w, i, kind, x, y); takeCorpses(w, x, y, r, max,
//   kind?) → recent death positions to raise from (every death is remembered for CORPSE_LIFETIME);
//   nearestLiving, farthestLiving, randomLiving (world rng), w.living (join order).
//
// Events
//   attackEvent(w, i, attack, x?, y?) sends 'monsterAttack' — the presenter's pose and sound cue
//   (src/audio/index.ts maps the attack names: melee, spit, leap, slam, summon, orb, meteor, charge, web,
//   hook, aim, bolt, tar, nova, spikes, prison, blizzard, whirl, mark, sing, pulse, burst, bash).
//   Send one on every telegraph start and every release. 'bossPhase' is the core's.
//
// Determinism and performance
//   Randomness only from w.worldRng (AI, placement) — never Math.random / Date.now. Brains run for up
//   to ~1000 monsters per tick: no allocation per tick (closures are built once, in the factories),
//   grid queries through w.grid with w.scratch2, and no scans over all monsters per monster.
//
// Tests: tests/sim/rosters.test.ts plays every theme with the strong bot and checks determinism;
// tests/sim/balance-<theme>.test.ts is the balance signal — the fair bot must clear at least
// BALANCE_MIN_CLEARS (9) of seeds 1–12 per theme, never get stuck, and no monster may leave its own
// shown charge lane (the per-seed results print with the test); tests/sim/bestiary.test.ts covers the
// generic projectile / area / shield behaviour; tests/sim/debuffs.test.ts the debuff rules;
// tests/sim/skeletons.test.ts the fairness rules the skeletons demonstrate (Varkus's lane and mark, the
// aim line, the hook, the haste aura) — keep those passing when replacing a skeleton.
import { MONSTER_KINDS, type MonsterKind, type Theme } from '../../contracts/content';
import { THEME_ROSTER } from '../../contracts/bestiary';
import { ashenForgeRoster } from './ashenForge';
import { coliseumRoster } from './coliseum';
import { commonDefs } from './common';
import { ossuaryRoster } from './ossuary';
import type { MonsterDef, Roster } from './types';

export type { BlockSpec, BossScript, Brain, MonsterDef, MonsterRole, ResistRow, Roster } from './types';

let table: MonsterDef[] | null = null;

/**
 * Every MonsterDef, indexed like MONSTER_KINDS (so `monsterDefs()[m.kind[i]]`). Built on first use,
 * after every module has loaded (the rosters import the core and the core imports this).
 */
export function monsterDefs(): readonly MonsterDef[] {
  return table ?? (table = buildTable());
}

export function monsterDef(kind: MonsterKind): MonsterDef {
  return monsterDefs()[MONSTER_KINDS.indexOf(kind)];
}

function buildTable(): MonsterDef[] {
  const all = [...commonDefs(), ...ashenForgeRoster(), ...ossuaryRoster(), ...coliseumRoster()];
  const out: (MonsterDef | undefined)[] = new Array(MONSTER_KINDS.length).fill(undefined);
  for (const def of all) {
    const k = MONSTER_KINDS.indexOf(def.kind);
    if (k < 0) throw new Error(`sim rosters: unknown monster kind '${def.kind}'`);
    if (out[k]) throw new Error(`sim rosters: '${def.kind}' is defined twice`);
    out[k] = def;
  }
  const missing = MONSTER_KINDS.filter((_, k) => !out[k]);
  if (missing.length > 0) throw new Error(`sim rosters: no MonsterDef for ${missing.join(', ')}`);
  return out as MonsterDef[];
}

/** The roster a map theme uses (contracts/bestiary.ts THEME_ROSTER); the hideout gets the Ashen Forge's. */
export function rosterFor(theme: Theme): Roster {
  const r = theme === 'hideout' || !(theme in THEME_ROSTER) ? THEME_ROSTER.ashenForge : THEME_ROSTER[theme];
  return { family: r.family, lieutenant: r.lieutenant, boss: r.boss };
}
