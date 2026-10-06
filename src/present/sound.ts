// SimEvent → AudioEngine.play mapping with presentation-side throttling (pure logic; the sink does the playing).
//
// The audio engine already caps voices per id and merges same-frame hits of one id into a single, louder voice,
// so the director's job is (1) choosing the right sound, position, volume and pitch for every event, and (2) not
// flooding the engine: a dense wave produces hundreds of hit events per frame, and every play() call costs CPU
// even when it is merged or culled. Limits:
//   • a per-frame cap per sfx id (a few calls are enough for the engine's "mass" to register),
//   • a minimum interval per id for spammy ambient cues (monster attacks, spawns, motes),
//   • local-player sounds play un-positioned (centred) at full volume; allies and the world are positional and a
//     little quieter, so your own actions always sit on top of the mix.
//
// The Rimed Ossuary / Iron Coliseum cues follow the cue map in the header of src/audio/index.ts:
//   • debuff*: the local player only, un-positioned, once when the ailment takes hold — never on a refresh (the
//     sim repeats 'debuff' once a second while one keeps being refreshed); debuffBleed once per new stack at pitch
//     1 + 0.06·(stacks − 1); debuffCleanse when a flask (or Rift Step) lifts one. syncLocalDebuffs() tells the
//     director which debuffs she still carries (and how many stacks), so a debuff that ran out sounds again when it
//     comes back, and a bleed that ran down from 3 to 2 stacks voices its next third stack.
//   • burn / bleed ticks (a player 'hit' flagged `dot` by the presenter: the event itself has no DoT flag) never
//     grunt: the local player hears a soft tick of the damage type, allies' ticks are silent.
//   • telegraph pairs: wispPulse → wispBurst, crossbowAim → crossbowShot, icePrison when the ring forms (the capture
//     is debuffFreeze), executionMark on the mark → bossSlam + arenaSpikes at its strike.
//   • glacialSpikes per spike burst, kept ≥ SPIKE_GAP apart (a line plays spike by spike: closer bursts are queued
//     a moment rather than merged); arenaSpikes per tile (same-frame tiles merge in the engine); shieldBlock per
//     blocked projectile; tarSplat where tar lands.
//   • ambient(world) keeps the loops: blizzardLoop every BLIZZARD_GUST s for the storm nearest the listener (at
//     the listener while inside it), and chainWhirl / varkusWhirl replayed every 6 revolutions while a blade ring
//     keeps spinning; it also voices areas as they appear (the ice prison ring, the execution mark).
//   • every lieutenant and boss has its own voice from these ids (spawn, phase, death), per the cue map.
import type { SfxId } from '../contracts/audio';
import type { PlayerDebuff } from '../contracts/bestiary';
import type { DamageType, MonsterKind, SkillId, Theme } from '../contracts/content';
import type { DropTone, PlayerDebuffView, SimEvent, WorldView } from '../contracts/sim';
import { MONSTER_KINDS } from '../contracts/content';
import { RARITY_CODE } from '../contracts/sim';
import { AUDIBLE_RADIUS } from '../audio/mixing';
import { CHAIN_REV, VARKUS_REV } from '../audio/sfx';
import { areaVariant } from '../sim/area-geometry';
import { flowFieldFor, flowPhaseAt, type FlowField } from '../data/layouts';
import { MONSTER_LOOKS } from './bestiary';
import { CHARGE_MAX_RADIUS } from './context';

export type SfxSink = (id: SfxId, x: number | undefined, y: number | undefined, volume: number, pitch: number) => void;

interface Limit {
  /** Max calls per frame. */
  perFrame: number;
  /** Min seconds between calls (presentation time). */
  interval: number;
}

const DEFAULT_LIMIT: Limit = { perFrame: 3, interval: 0 };

/** Throttle table (ids not listed use DEFAULT_LIMIT). */
export const SFX_LIMITS: Partial<Record<SfxId, Limit>> = {
  hitFire: { perFrame: 5, interval: 0 },
  hitCold: { perFrame: 5, interval: 0 },
  hitLightning: { perFrame: 5, interval: 0 },
  hitVoid: { perFrame: 5, interval: 0 },
  hitPhysical: { perFrame: 5, interval: 0 },
  crit: { perFrame: 2, interval: 0.03 },
  monsterDeath: { perFrame: 4, interval: 0 },
  monsterDeathBig: { perFrame: 2, interval: 0.05 },
  monsterAttack: { perFrame: 2, interval: 0.07 },
  monsterSpit: { perFrame: 2, interval: 0.08 },
  monsterLeap: { perFrame: 1, interval: 0.1 },
  monsterSlam: { perFrame: 2, interval: 0.06 },
  eruption: { perFrame: 2, interval: 0.08 },
  mote: { perFrame: 2, interval: 0.035 },
  evade: { perFrame: 1, interval: 0.12 },
  playerHurt: { perFrame: 1, interval: 0.12 },
  notEnoughFocus: { perFrame: 1, interval: 0.6 },
  dropNormal: { perFrame: 3, interval: 0 },
  dropCurrency: { perFrame: 3, interval: 0 },
  pickupItem: { perFrame: 2, interval: 0.04 },
  pickupCurrency: { perFrame: 2, interval: 0.04 },
  castEmber: { perFrame: 2, interval: 0 },
  waveStart: { perFrame: 1, interval: 1 },
  waveTell: { perFrame: 1, interval: 1 },
  bossRoar: { perFrame: 1, interval: 0.5 },
  heraldCall: { perFrame: 1, interval: 0.3 },
  // Rimed Ossuary / Iron Coliseum
  debuffChill: { perFrame: 1, interval: 0 },
  debuffFreeze: { perFrame: 1, interval: 0 },
  debuffRoot: { perFrame: 1, interval: 0 },
  debuffBurn: { perFrame: 1, interval: 0 },
  debuffBleed: { perFrame: 1, interval: 0 },
  debuffShock: { perFrame: 1, interval: 0 },
  debuffWither: { perFrame: 1, interval: 0 },
  debuffCleanse: { perFrame: 1, interval: 0.1 },
  boneRattle: { perFrame: 3, interval: 0.03 },
  ghostWail: { perFrame: 1, interval: 0.35 },
  webShot: { perFrame: 2, interval: 0.08 },
  wispPulse: { perFrame: 2, interval: 0.08 },
  wispBurst: { perFrame: 2, interval: 0.06 },
  golemSlam: { perFrame: 2, interval: 0.08 },
  choirSing: { perFrame: 1, interval: 0.3 },
  wardenNova: { perFrame: 1, interval: 0.2 },
  glacialSpikes: { perFrame: 2, interval: 0 },
  icePrison: { perFrame: 1, interval: 0.2 },
  blizzardLoop: { perFrame: 1, interval: 0.5 },
  houndBite: { perFrame: 2, interval: 0.06 },
  chainThrow: { perFrame: 2, interval: 0.08 },
  crossbowAim: { perFrame: 2, interval: 0.08 },
  crossbowShot: { perFrame: 2, interval: 0.06 },
  shieldBlock: { perFrame: 3, interval: 0.03 },
  tarSplat: { perFrame: 2, interval: 0.06 },
  chainWhirl: { perFrame: 1, interval: 0 },
  varkusWhirl: { perFrame: 1, interval: 0 },
  varkusCharge: { perFrame: 1, interval: 0.3 },
  executionMark: { perFrame: 1, interval: 0.2 },
  arenaSpikes: { perFrame: 3, interval: 0 },
  // map events
  eventStep: { perFrame: 2, interval: 0.08 },
  eventReturn: { perFrame: 2, interval: 0.2 },
  eventBeat: { perFrame: 1, interval: 0.25 },
  eventLock: { perFrame: 1, interval: 0.4 },
  eventWhiff: { perFrame: 1, interval: 0.4 },
  eventHum: { perFrame: 1, interval: 1 },
  bloomBite: { perFrame: 2, interval: 0.15 },
  bloomGrow: { perFrame: 2, interval: 0.2 },
  pactStone: { perFrame: 1, interval: 0.2 },
  anvilStrike: { perFrame: 2, interval: 0.1 },
  dirge: { perFrame: 1, interval: 0.6 },
  crowdRoar: { perFrame: 1, interval: 1.2 },
  // power rework SK2 roster batch 1
  castSpark: { perFrame: 2, interval: 0 },
  castKinetic: { perFrame: 2, interval: 0 },
  mortarBlast: { perFrame: 2, interval: 0.05 },
  stormCallStrike: { perFrame: 3, interval: 0.03 },
  frostSpike: { perFrame: 2, interval: 0.03 },
  // power rework SK3 roster batch 2
  castLash: { perFrame: 2, interval: 0.06 },
  sigilPillar: { perFrame: 2, interval: 0.05 },
  barrierBreak: { perFrame: 1, interval: 0.2 },
  // power rework SK4 roster batch 3
  meteorImpact: { perFrame: 2, interval: 0.06 },
  stormStepStrike: { perFrame: 2, interval: 0.04 },
};

/** The cue of each debuff taking hold on the local player. */
export const DEBUFF_SFX: Record<PlayerDebuff, SfxId> = {
  chilled: 'debuffChill',
  frozen: 'debuffFreeze',
  rooted: 'debuffRoot',
  burning: 'debuffBurn',
  bleeding: 'debuffBleed',
  shocked: 'debuffShock',
  withered: 'debuffWither',
};

/** Glacial Spikes play spike by spike: bursts closer than this are queued a moment instead of merging. */
export const SPIKE_GAP = 0.05;
/** A spike burst is never queued longer than this (a long line resolving at once plays as a quick run). */
const SPIKE_MAX_DELAY = 0.35;
/** Blizzard gusts (2.7 s each) are replayed this often for the storm nearest the listener. */
export const BLIZZARD_GUST = 2;
/** One whole whirl sound: 6 revolutions (src/audio/sfx.ts CHAIN_REV / VARKUS_REV). */
export const CHAIN_SPIN = CHAIN_REV * 6;
export const VARKUS_SPIN = VARKUS_REV * 6;
/** A voiced debuff that was never seen active in the view is forgotten after this long (it ran out in between). */
const VOICED_GRACE = 0.6;
/** Volume of the local player's own burn / bleed tick (the damage type's hit sound, pitched down). */
export const DOT_TICK_VOLUME = 0.22;
/** Raised thralls rattle while they claw up this long after the Chorister's chant starts. */
const RAISE_WINDOW = 1.6;

/**
 * Sound for a cast of `skill`. Rift Step plays through its 'dash' event and Ember Nova through its 'nova' event
 * (a Nova echo emits only 'nova', so voicing the nova keeps echoes audible and never doubles a cast).
 */
export const CAST_SFX: Partial<Record<SkillId, SfxId | null>> = {
  emberLance: 'castEmber',
  emberNova: null,
  flameWave: 'castWave',
  rimeShards: 'castFrost',
  arcChain: 'castArc',
  riftStep: null,
  cinderWard: 'ward',
  // power rework SK2 roster batch 1 (Glacial Nova is voiced by its 'nova' burst; the buffs by their cast)
  phaseStride: 'phaseStride',
  glacialNova: null,
  spark: 'castSpark',
  cinderMortar: 'castMortar',
  arcaneReprieve: 'arcaneReprieve',
  umbralBolt: 'castUmbral',
  kineticLance: 'castKinetic',
  frostOrb: 'castOrb',
  stormCall: 'castStormCall',
  glacialSpikes: 'castFrost',
  // power rework SK3 roster batch 2 (Voltaic Pulse is voiced by its 'nova' ring)
  gravityWell: 'castGravityWell',
  rimeBulwark: 'barrierUp',
  immolationSigil: 'castSigil',
  staticAegis: 'aegisUp',
  voltaicPulse: null,
  entropyHex: 'castHex',
  concussiveBlast: 'concussiveBlast',
  staticLash: 'castLash',
  echoSigil: 'echoSigil',
  witherField: 'castWither',
  // power rework SK4 roster batch 3 (Storm Step is a blink: its 'dash' and its strikes' 'nova' carry the sound)
  meteorRain: 'castMeteor',
  stormStep: null,
  tempestSurge: 'tempestSurge',
  blizzard: 'castBlizzard',
  eventHorizon: 'castHorizon',
};

export const HIT_SFX: Record<DamageType, SfxId> = {
  physical: 'hitPhysical',
  fire: 'hitFire',
  cold: 'hitCold',
  lightning: 'hitLightning',
  void: 'hitVoid',
};

export const DROP_SFX: Record<DropTone, SfxId> = {
  normal: 'dropNormal',
  magic: 'dropMagic',
  rare: 'dropRare',
  unique: 'dropUnique',
  currency: 'dropCurrency',
  map: 'dropMap',
  flask: 'dropNormal',
};

const BIG_KINDS: ReadonlySet<MonsterKind> = new Set(MONSTER_KINDS.filter((k) => MONSTER_LOOKS[k].big));

interface Voiced {
  stacks: number;
  at: number;
  seen: boolean;
}

/** Volume of sounds made by other players (allies) relative to your own. */
export const ALLY_VOLUME = 0.6;

/** Seconds between replays of the Echoing's choir hum (each is 2.4 s, so they overlap into one held chord). */
const HUM_PERIOD = 2;

export class SoundDirector {
  private readonly sink: SfxSink;
  private readonly frameCount = new Map<SfxId, number>();
  private readonly lastPlayed = new Map<SfxId, number>();
  private now = 0;
  /** Random source for pitch jitter (injectable for tests). */
  private readonly random: () => number;
  /** Map theme (picks the boss's voice for 'bossSpawn' / 'bossPhase', which name no kind). */
  private theme: Theme = 'ashenForge';
  /** Debuffs voiced for the local player during their current run (see syncLocalDebuffs). */
  private readonly voiced = new Map<PlayerDebuff, Voiced>();
  /** Queued glacial spike bursts (x, y, due time) and the time of the last one played or queued. */
  private readonly spikes: number[] = [];
  private lastSpike = -Infinity;
  /** Areas already voiced on appearance (id → frame last seen), whirl rings (id → next replay time, sfx). */
  private readonly appeared = new Map<number, number>();
  private readonly whirls = new Map<number, { next: number; id: SfxId; period: number }>();
  private lastGust = -Infinity;
  private frameNo = 0;
  /** The Chorister's latest raising chant: where and until when rising thralls rattle. */
  private raiseUntil = -Infinity;
  private raiseX = 0;
  private raiseY = 0;

  constructor(sink: SfxSink, random: () => number = Math.random) {
    this.sink = sink;
    this.random = random;
  }

  /** Start a new frame at presentation time `now` (seconds). Resets the per-frame caps, plays due queued spikes. */
  beginFrame(now: number): void {
    this.now = now;
    this.frameNo++;
    this.frameCount.clear();
    const q = this.spikes;
    let w = 0;
    for (let k = 0; k < q.length; k += 3) {
      if (q[k + 2] <= now) this.play('glacialSpikes', q[k], q[k + 1], 0.9, this.jitter(0.05));
      else {
        q[w] = q[k];
        q[w + 1] = q[k + 1];
        q[w + 2] = q[k + 2];
        w += 3;
      }
    }
    q.length = w;
  }

  /** Zone change: forget loops, queued spikes and voiced debuffs. */
  reset(): void {
    this.voiced.clear();
    this.spikes.length = 0;
    this.lastSpike = -Infinity;
    this.appeared.clear();
    this.whirls.clear();
    this.lastGust = -Infinity;
    this.humAt = 0;
    this.raiseUntil = -Infinity;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  /**
   * The local player's debuffs after this frame's events (call after handle()): a voiced debuff she no longer
   * carries is forgotten, so it sounds again the next time it takes hold.
   */
  syncLocalDebuffs(list: readonly PlayerDebuffView[] | null): void {
    if (this.voiced.size === 0) return;
    for (const [id, v] of this.voiced) {
      let stacks = 0;
      if (list) for (let k = 0; k < list.length; k++) if (list[k].id === id) stacks = Math.max(1, list[k].stacks);
      if (stacks > 0) {
        v.seen = true;
        // Stacks ran down (bleed stacks have independent timers): the next new stack voices again. A view lagging
        // the event stream is given the grace first.
        if (stacks < v.stacks && this.now - v.at > VOICED_GRACE) v.stacks = stacks;
      } else if (v.seen || this.now - v.at > VOICED_GRACE) this.voiced.delete(id);
    }
  }

  /** A glacial spike burst at (x, y): now, or queued so consecutive spikes stay ≥ SPIKE_GAP apart. */
  private spike(x: number, y: number): void {
    const due = Math.max(this.now, this.lastSpike + SPIKE_GAP);
    if (due - this.now > SPIKE_MAX_DELAY) return;
    this.lastSpike = due;
    if (due <= this.now) this.play('glacialSpikes', x, y, 0.9, this.jitter(0.05));
    else if (this.spikes.length < 36) this.spikes.push(x, y, due);
  }

  /**
   * Per-frame cues from the world state: areas voiced as they appear (the ice prison forming, the execution mark),
   * whirl replays while a blade ring spins, and the blizzard's gusts near the listener at (lx, ly).
   */
  ambient(world: WorldView, lx: number, ly: number): void {
    const areas = world.areas;
    this.heartbeat(world);
    this.hum(world);
    if (world.flowSeed !== undefined) this.belts(world, lx, ly);
    const frame = this.frameNo;
    let storm = -1;
    let stormD = Infinity;
    for (let k = 0; k < areas.length; k++) {
      const a = areas[k];
      switch (a.kind) {
        case 'icePrison':
        case 'executionMark':
          // Voiced as they form (one already standing when we arrive is not news).
          if (!this.appeared.has(a.id) && a.age < 0.3) this.play(a.kind === 'icePrison' ? 'icePrison' : 'executionMark', a.x, a.y, 1, 1);
          this.appeared.set(a.id, frame);
          break;
        case 'whirlwind': {
          if (areaVariant(a) < 1) break;
          let w = this.whirls.get(a.id);
          if (!w) {
            const varkus = this.ownerKind(world, a.x, a.y) === 'varkus';
            w = { next: this.now, id: varkus ? 'varkusWhirl' : 'chainWhirl', period: varkus ? VARKUS_SPIN : CHAIN_SPIN };
            this.whirls.set(a.id, w);
          }
          if (this.now >= w.next) {
            this.play(w.id, a.x, a.y, 1, 1);
            w.next += w.period;
            if (w.next < this.now) w.next = this.now + w.period;
          }
          this.appeared.set(a.id, frame);
          break;
        }
        case 'blizzard': {
          const d = Math.hypot(a.x - lx, a.y - ly) - a.radius;
          if (d < stormD) {
            stormD = d;
            storm = k;
          }
          break;
        }
      }
    }
    if (storm >= 0 && stormD < AUDIBLE_RADIUS && this.now - this.lastGust >= BLIZZARD_GUST) {
      this.lastGust = this.now;
      const a = areas[storm];
      // Inside the storm the gale is all around her; outside it blows from where the storm is.
      if (stormD <= 0) this.play('blizzardLoop', lx, ly, 0.9, 1);
      else this.play('blizzardLoop', a.x, a.y, 0.9, 1);
    }
    if (frame % 30 === 0) {
      for (const [id, seen] of this.appeared) {
        if (seen === frame) continue;
        this.appeared.delete(id);
        this.whirls.delete(id);
      }
    }
  }

  /** Kind of the lieutenant / boss standing at (x, y) (a whirl ring follows its owner), or null. */
  private ownerKind(world: WorldView, x: number, y: number): MonsterKind | null {
    const m = world.monsters;
    let best: MonsterKind | null = null;
    let bd = 24 * 24;
    for (let i = 0; i < m.capacity; i++) {
      if (!m.alive[i] || m.rarity[i] < RARITY_CODE.lieutenant) continue;
      const d = (m.x[i] - x) * (m.x[i] - x) + (m.y[i] - y) * (m.y[i] - y);
      if (d <= bd) {
        bd = d;
        best = MONSTER_KINDS[m.kind[i]] ?? null;
      }
    }
    return best;
  }

  /** A driven monster action began (monsters.ts): Varkus launches his charge. Whirls are voiced by ambient(). */
  action(kind: MonsterKind, action: 'charge' | 'whirl', x: number, y: number): void {
    if (action === 'charge' && kind === 'varkus') this.play('varkusCharge', x, y, 1, 1);
  }

  /**
   * Play `id` if the throttle allows. `x`/`y` undefined = un-positioned (UI / own player). Returns whether the
   * sink was called.
   */
  play(id: SfxId, x?: number, y?: number, volume = 1, pitch = 1): boolean {
    const lim = SFX_LIMITS[id] ?? DEFAULT_LIMIT;
    const n = this.frameCount.get(id) ?? 0;
    if (n >= lim.perFrame) return false;
    if (lim.interval > 0) {
      const last = this.lastPlayed.get(id);
      if (last !== undefined && this.now - last < lim.interval) return false;
    }
    this.frameCount.set(id, n + 1);
    this.lastPlayed.set(id, this.now);
    this.sink(id, x, y, volume, pitch);
    return true;
  }

  /**
   * The Echoing's choir hum: a 2.4 s pad replayed every HUM_PERIOD s at the anchor while the rift recalls its dead (quietly while it
   * wakes), rising a little with every Resonance (anchor zone v = percent of the rift's tolerance, about six steps). The erupt,
   * warden and sealed stages have their own voices, so the hum stops there.
   */
  private humAt = 0;
  private hum(world: WorldView): void {
    const events = world.run.events;
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      if (e.kind !== 'echoRift') continue;
      const recall = e.phase === 'active' && e.hint === 1;
      if (!recall && e.phase !== 'warning') continue;
      if (this.now < this.humAt) continue;
      const anchor = e.zones.find(z => z.kind === 'anchor');
      const x = anchor ? anchor.x : e.x, y = anchor ? anchor.y : e.y;
      const steps = anchor ? anchor.v / 100 * 6 : 0;
      this.play('eventHum', x, y, recall ? 0.75 : 0.35, 1 + 0.04 * steps);
      this.humAt = this.now + HUM_PERIOD;
    }
  }

  /**
   * Conveyor belts (layout flow zones): a reversal is voiced from the schedule itself (the field is built from the same area, radius and
   * flow seed as the sim's): a low metal clank when the telegraph begins (the belt starts slowing) and a lower one when it stops and
   * turns. Reuses `shieldBlock`; audible only near the belt (positional at its point nearest the listener).
   */
  private beltKey = '';
  private beltField: FlowField | null = null;
  private beltPhase: number[] = [];
  private belts(world: WorldView, lx: number, ly: number): void {
    const key = `${world.areaId ?? ''}:${world.arenaRadius}:${world.flowSeed}`;
    if (key !== this.beltKey) {
      this.beltKey = key;
      this.beltField = flowFieldFor(world.areaId, world.arenaRadius, world.flowSeed ?? 0);
      this.beltPhase = this.beltField ? this.beltField.zones.map(() => 0) : [];
    }
    const field = this.beltField;
    if (!field) return;
    const t = world.time;
    for (let k = 0; k < field.zones.length; k++) {
      const z = field.zones[k];
      if (!z.reverse) continue;
      const ph = flowPhaseAt(z, t);
      const was = this.beltPhase[k];
      this.beltPhase[k] = ph.phase;
      const into = ph.phase === 2 ? ph.since - z.reverse.telegraph : ph.since;
      if (ph.phase === was || into > 0.6) continue; // a cue only on the edge (never replayed for a belt already mid-reversal)
      // The point of the zone nearest the listener.
      let px = z.cx;
      let py = z.cy;
      if (z.shape === 'annulus') {
        const d = Math.hypot(lx - z.cx, ly - z.cy) || 1;
        const r = (z.r0 + z.r1) / 2;
        px = z.cx + ((lx - z.cx) / d) * r;
        py = z.cy + ((ly - z.cy) / d) * r;
      } else {
        let best = Infinity;
        for (const s of z.segs) {
          const al = Math.max(0, Math.min(s.len, (lx - s.ax) * s.ux + (ly - s.ay) * s.uy));
          const qx = s.ax + s.ux * al;
          const qy = s.ay + s.uy * al;
          const d = Math.hypot(lx - qx, ly - qy);
          if (d < best) { best = d; px = qx; py = qy; }
        }
      }
      if (Math.hypot(lx - px, ly - py) > AUDIBLE_RADIUS) continue;
      if (ph.phase === 1) this.play('shieldBlock', px, py, 0.9, 0.75);
      else if (ph.phase === 2) this.play('shieldBlock', px, py, 1, 0.55);
    }
  }

  /** The Stalker's heartbeat: 60 bpm while it stalks, quickening as its pounce nears (the sound encodes the pounce timer). */
  private beatAt = 0;
  private heartbeat(world: WorldView): void {
    const events = world.run.events;
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      if (e.kind !== 'hunted' || e.phase !== 'active' || e.timers.length === 0) continue;
      const t = e.timers[0];
      if (t.id !== 0 || this.now < this.beatAt) continue;
      const near = t.total > 0 ? Math.max(0, Math.min(1, 1 - t.seconds / t.total)) : 0;
      this.play('eventBeat', e.x, e.y, 0.5 + 0.4 * near, 1 + 0.15 * near);
      this.beatAt = this.now + 1 - 0.55 * near;
    }
  }

  /** One rung of the fixed-pitch progress ladder (D minor pentatonic, semitones over the base note). */
  private ladder(n: number): number {
    const steps = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
    const octave = Math.floor(Math.max(0, n) / steps.length);
    return Math.pow(2, (steps[Math.max(0, n) % steps.length] + 12 * Math.min(2, octave)) / 12);
  }

  /** Map-event beats (Event Director v2): omen sting, onset hit, ladder steps, whiff / hit / lock, returns, grade chords. */
  private mapEvent(e: Extract<SimEvent, { t: 'mapEvent' }>): void {
    switch (e.beat) {
      case 'omen':
        this.play('eventOmen', undefined, undefined, 1, 1);
        if (e.kind === 'pactAltar') this.play('pactStone', e.x, e.y, 0.8, 1);
        return;
      case 'onset': this.play(e.kind === 'pactAltar' ? 'pactWave' : 'eventOnset', undefined, undefined, 1, 1); return;
      case 'arrive': this.play(e.kind === 'voidBreach' ? 'voidSurge' : 'eventOnset', e.x, e.y, 0.8, 0.9); return;
      case 'step':
        if (e.kind === 'anvil') this.play('anvilStrike', e.x, e.y, 0.8, this.ladder(e.n));
        else if (e.kind === 'orchard') this.play('bloomGrow', e.x, e.y, 0.8, this.ladder(e.n));
        else this.play('eventStep', e.x, e.y, 0.9, this.ladder(e.n));
        return;
      case 'pulse': this.play('eventBeat', e.x, e.y, 0.8, 1.1); return;
      case 'lock':
        if (e.kind === 'hunted') this.play('eventLock', e.x, e.y, 1, 1);
        else if (e.kind === 'ring') this.play('ringSlam', e.x, e.y, 1, e.n === 1 ? 0.85 : 1);
        else { this.play('chestOpen', e.x, e.y, 0.9, 1); this.play('dropCurrency', e.x, e.y, 0.7, 1); }
        return;
      case 'whiff': this.play('eventWhiff', e.x, e.y, 1, this.jitter(0.05)); return;
      case 'hit': this.play(e.kind === 'orchard' ? 'bloomBite' : 'eventHit', e.x, e.y, 1, this.jitter(0.05)); return;
      case 'return': this.play('eventReturn', e.x, e.y, 0.9, this.ladder(e.n)); return;
      case 'lit': this.play('eventReturn', e.x, e.y, 1, this.ladder(e.n + 4)); return;
      case 'seal': this.play(e.kind === 'anvil' ? 'anvilCharged' : 'eventSeal', e.x, e.y, 1, 1); return;
      case 'erupt': this.play('eventErupt', e.x, e.y, 1, 1); return;
      case 'lost':
        if (e.kind === 'orchard') { this.play('bloomWither', e.x, e.y, 0.9, 1); return; }
        this.play('eventFail', undefined, undefined, 0.9, 1);
        return;
      case 'failed': this.play('eventFail', undefined, undefined, 0.9, 1); return;
      // Wave 2 of events (per-kind voices: the recipes live in audio/sfx.ts).
      case 'pick': this.play(e.kind === 'anvil' ? 'anvilForge' : e.kind === 'ring' ? 'ringChain' : 'pactSeal', e.x, e.y, 0.9, 1); return;
      case 'harvest': this.play('bloomHarvest', e.x, e.y, 1, this.jitter(0.03)); return;
      case 'shatter': this.play('prismShatter', e.x, e.y, 1, 1); return;
      case 'thaw': this.play('hostThaw', e.x, e.y, 0.7, this.jitter(0.06)); return;
      case 'toll':
        // Each Dirge stack drags the bell a little lower and adds the drone.
        this.play('bellToll', e.x, e.y, 1, Math.pow(2, -Math.max(0, e.n - 1) * 0.5 / 12));
        if (e.n >= 2) this.play('dirge', e.x, e.y, Math.min(1, 0.4 + 0.15 * e.n), 1);
        return;
      case 'forge': this.play('anvilForge', e.x, e.y, 1, 1); return;
      case 'tide': this.play('voidTide', e.x, e.y, 1, 1); return;
      case 'crack': this.play(e.kind === 'vaultbreakers' ? (e.n === 0 ? 'wheelBreak' : 'shieldBreak') : e.kind === 'host' ? 'prismShatter' : e.kind === 'voidBreach' ? 'heartCrack' : e.kind === 'bellwatch' ? 'cantorFall' : 'ringSlam', e.x, e.y, 0.9, this.jitter(0.04)); return;
      case 'complete': this.play(e.n >= 3 ? 'eventGold' : e.n === 2 ? 'eventSilver' : 'eventBronze', undefined, undefined, 1, 1); return;
    }
  }

  private jitter(amount: number): number {
    return 1 + (this.random() * 2 - 1) * amount;
  }

  /** A debuff took hold on the local player: its cue, once per run (bleeding and withered: once per new stack). */
  private debuff(id: PlayerDebuff, stacks: number): void {
    const v = this.voiced.get(id);
    if (v && stacks <= v.stacks) return;
    const pitch = id === 'bleeding' ? 1 + 0.06 * (Math.max(1, stacks) - 1) : 1;
    this.play(DEBUFF_SFX[id], undefined, undefined, 1, pitch);
    if (v) {
      v.stacks = stacks;
      v.at = this.now;
    } else this.voiced.set(id, { stacks, at: this.now, seen: false });
  }

  /** The Rimed Ossuary / Iron Coliseum 'monsterAttack' cues; false = not one of theirs (the old mapping applies). */
  private rosterAttack(e: Extract<SimEvent, { t: 'monsterAttack' }>): boolean {
    const { x, y } = e;
    switch (e.kind) {
      case 'boneThrall':
        if (e.attack !== 'melee') return false;
        this.play('boneRattle', x, y, 0.6, this.jitter(0.08));
        return true;
      case 'rimeshade':
        if (e.attack !== 'melee') return false;
        this.play('ghostWail', x, y, 0.7, this.jitter(0.06));
        return true;
      case 'frostWeaver':
        if (e.attack === 'web') this.play('webShot', x, y, 0.9, this.jitter(0.06));
        return e.attack === 'web';
      case 'glacialWisp':
        if (e.attack === 'pulse') this.play('wispPulse', x, y, 0.85, this.jitter(0.05));
        else if (e.attack === 'burst') this.play('wispBurst', x, y, 1, this.jitter(0.05));
        else return false;
        return true;
      case 'ossuaryGolem':
        if (e.attack !== 'slam') return false;
        this.play('golemSlam', x, y, 1, this.jitter(0.04));
        return true;
      case 'boneChorister':
        if (e.attack === 'sing') this.play('choirSing', x, y, 1, this.jitter(0.03));
        else if (e.attack === 'summon') {
          // The raising chant: the thralls rattle as they claw up (monsterSpawn).
          this.raiseUntil = this.now + RAISE_WINDOW;
          this.raiseX = x;
          this.raiseY = y;
          this.play('choirSing', x, y, 0.5, 0.8);
        } else return false;
        return true;
      case 'hollowWarden':
        switch (e.attack) {
          case 'nova':
            this.play('wardenNova', x, y, 1, 1);
            return true;
          case 'summon':
            this.play('ghostWail', x, y, 0.9, 0.85);
            return true;
          case 'orb':
            this.play('monsterSpit', x, y, 0.75, 1.25);
            return true;
          case 'melee':
            this.play('monsterAttack', x, y, 0.8, 0.75);
            return true;
          case 'prison':
          case 'spikes':
          case 'blizzard':
            return true; // the ring, the spikes and the storm voice themselves
          default:
            return false;
        }
      case 'pitHound':
        if (e.attack !== 'melee') return false;
        this.play('houndBite', x, y, 0.8, this.jitter(0.07));
        return true;
      case 'chainThrall':
        if (e.attack !== 'hook') return false;
        this.play('chainThrow', x, y, 0.9, this.jitter(0.05));
        return true;
      case 'ironCrossbowman':
        if (e.attack === 'aim') this.play('crossbowAim', x, y, 0.9, 1);
        else if (e.attack === 'bolt') this.play('crossbowShot', x, y, 1, this.jitter(0.04));
        else return false;
        return true;
      case 'tarSlinger':
        if (e.attack !== 'tar') return false;
        this.play('monsterSpit', x, y, 0.55, 0.7);
        return true;
      case 'shieldbearer':
        if (e.attack !== 'bash') return false;
        this.play('shieldBlock', x, y, 1, 0.85);
        this.play('monsterAttack', x, y, 0.8, 0.8);
        return true;
      case 'chainmaster':
        switch (e.attack) {
          case 'hook':
            this.play('chainThrow', x, y, 1, 0.9);
            return true;
          case 'summon':
            this.play('chainThrow', x, y, 0.8, 0.8);
            return true;
          case 'whirl':
            return true; // ambient() voices the spin while its blade ring turns
          default:
            return false;
        }
      case 'varkus':
        switch (e.attack) {
          case 'charge':
            // The launch (the lane showed for the whole cast); the painter's launch detection is the fallback.
            this.play('varkusCharge', x, y, 1, 1);
            return true;
          case 'slam':
            // The cleave swings down; the telegraph's resolve voices the impact.
            this.play('monsterAttack', x, y, 0.9, 0.72);
            return true;
          case 'spikes':
          case 'summon':
            this.play('crowdRoar', x, y, e.attack === 'spikes' ? 1 : 0.7, 1);
            return true;
          case 'leap':
            this.play('monsterLeap', x, y, 1, 0.8);
            return true;
          case 'melee':
            this.play('monsterAttack', x, y, 0.85, 0.8);
            return true;
          case 'whirl':
          case 'mark':
            return true; // the spin and the mark voice themselves (ambient)
          default:
            return false;
        }
      default:
        return false;
    }
  }

  /**
   * Map one sim event to sound. `localId` is the player this client controls; `dot` marks a 'hit' that is a burn /
   * bleed tick on a player (DebuffPainter.isDotTick).
   */
  handle(e: SimEvent, localId: number, dot = false): void {
    switch (e.t) {
      case 'cast': {
        const id = CAST_SFX[e.skill];
        if (!id) return;
        if (e.playerId === localId) this.play(id, undefined, undefined, 1, this.jitter(0.03));
        else this.play(id, e.x, e.y, ALLY_VOLUME, this.jitter(0.03));
        return;
      }
      case 'dash':
        if (e.playerId === localId) this.play('dash', undefined, undefined, 1, this.jitter(0.04));
        else this.play('dash', e.toX, e.toY, ALLY_VOLUME, this.jitter(0.04));
        return;
      case 'hit': {
        if (e.target === 'player') {
          if (dot) {
            if (e.playerId === localId) this.play(HIT_SFX[e.damageType], undefined, undefined, DOT_TICK_VOLUME, 0.8 * this.jitter(0.04));
            return;
          }
          if (e.playerId === localId) this.play('playerHurt', undefined, undefined, e.crit ? 1 : 0.85, this.jitter(0.05));
          else this.play('playerHurt', e.x, e.y, 0.45, this.jitter(0.05));
          return;
        }
        // Killing blows are voiced by the death event; the hit sound still lands for weight.
        const own = e.playerId === localId;
        const vol = own ? 0.9 : 0.5;
        this.play(HIT_SFX[e.damageType], e.x, e.y, vol, this.jitter(0.06));
        if (e.crit && own) this.play('crit', e.x, e.y, 1, this.jitter(0.03));
        return;
      }
      case 'evade':
        if (e.target === 'player' && e.playerId === localId) this.play('evade', undefined, undefined, 0.8, this.jitter(0.05));
        return;
      case 'death': {
        const big = e.rarity >= RARITY_CODE.rare || BIG_KINDS.has(e.kind);
        if (e.kind === 'hollowWarden') {
          this.play('monsterDeathBig', e.x, e.y, 1, this.jitter(0.04));
          this.play('wardenNova', e.x, e.y, 0.7, 0.9);
        } else if (e.kind === 'varkus') {
          this.play('monsterDeathBig', e.x, e.y, 1, this.jitter(0.04));
          this.play('crowdRoar', e.x, e.y, 1, 1);
        } else if (e.kind === 'boneThrall' && !big) {
          // A lower bone collapse, not the ashen crumble.
          this.play('boneRattle', e.x, e.y, 0.8, 0.8 * this.jitter(0.05));
        } else if (big) this.play('monsterDeathBig', e.x, e.y, 1, this.jitter(0.04));
        else this.play('monsterDeath', e.x, e.y, 0.9, this.jitter(0.08));
        return;
      }
      case 'monsterAttack':
        if (this.rosterAttack(e)) return;
        switch (e.attack) {
          case 'melee':
            this.play('monsterAttack', e.x, e.y, 0.7, this.jitter(0.08));
            return;
          case 'spit':
            this.play('monsterSpit', e.x, e.y, 0.8, this.jitter(0.08));
            return;
          case 'orb':
            this.play('monsterSpit', e.x, e.y, 0.9, e.kind === 'cinderMatriarch' ? 0.7 : 0.82);
            return;
          case 'leap':
            this.play('monsterLeap', e.x, e.y, 0.9, this.jitter(0.05));
            return;
          case 'slam':
            // The windup's thud; the landing is voiced by areaResolve.
            this.play(e.kind === 'cinderMatriarch' ? 'bossRoar' : 'monsterAttack', e.x, e.y, 0.8, e.kind === 'cinderMatriarch' ? 1.15 : 0.7);
            return;
          case 'summon':
            this.play('heraldCall', e.x, e.y, 1, 1);
            return;
          case 'meteor':
            this.play('bossRoar', e.x, e.y, 0.8, 1.2);
            return;
          case 'charge':
            this.play('bossRoar', e.x, e.y, 1, 0.9);
            return;
        }
        return;
      case 'monsterSpawn':
        if (e.rarity >= RARITY_CODE.lieutenant) {
          this.play('heraldCall', e.x, e.y, 1, 1);
          if (e.kind === 'boneChorister') this.play('choirSing', e.x, e.y, 0.6, 1);
          else if (e.kind === 'chainmaster') this.play('chainThrow', e.x, e.y, 1, 0.9);
        } else if (e.kind === 'rimeshade') this.play('ghostWail', e.x, e.y, 0.55, this.jitter(0.06));
        else if (e.kind === 'boneThrall' && this.now <= this.raiseUntil && Math.hypot(e.x - this.raiseX, e.y - this.raiseY) < 320) {
          // Raised by the Chorister: one rattle per thrall (same-frame rattles merge into one heavier voice).
          this.play('boneRattle', e.x, e.y, 0.8, this.jitter(0.08));
        }
        return;
      case 'areaResolve':
        switch (e.kind) {
          case 'slamWarning':
            // Charge-lane segments (small circles) resolve one by one as the Matriarch tramples over them: a run
            // of lighter, lower thuds rather than a string of full slams.
            if (e.radius < CHARGE_MAX_RADIUS) this.play('monsterSlam', e.x, e.y, 0.6, 0.82 * this.jitter(0.04));
            else this.play(e.radius >= 56 ? 'bossSlam' : 'monsterSlam', e.x, e.y, 1, this.jitter(0.04));
            return;
          case 'leapWarning':
            this.play('monsterSlam', e.x, e.y, 0.55, 1.25);
            return;
          case 'eruptionWarning':
          case 'meteorWarning':
            this.play('eruption', e.x, e.y, 1, this.jitter(0.05));
            return;
          case 'glacialSpike':
            this.spike(e.x, e.y);
            return;
          case 'arenaSpikes':
            this.play('arenaSpikes', e.x, e.y, 0.9, this.jitter(0.04));
            return;
          case 'executionMark':
            // The champion lands on the mark.
            this.play('bossSlam', e.x, e.y, 1, this.jitter(0.03));
            this.play('arenaSpikes', e.x, e.y, 0.8, 0.9);
            return;
          case 'stormStrike':
            this.play('hitLightning', e.x, e.y, 0.9, this.jitter(0.05));
            return;
          // power rework SK2: the player's own Storm Call bolts and Glacial Spikes
          case 'stormCall':
            this.play('stormCallStrike', e.x, e.y, 0.85, this.jitter(0.06));
            return;
          case 'frostSpike':
            this.play('frostSpike', e.x, e.y, 0.8, this.jitter(0.06));
            return;
          // power rework SK3: the sigil's pillar erupting
          case 'immolationSigil':
            this.play('sigilPillar', e.x, e.y, 0.95, this.jitter(0.05));
            return;
          // power rework SK4: a meteor of Meteor Rain landing
          case 'meteorRain':
            this.play('meteorImpact', e.x, e.y, 0.9, this.jitter(0.06));
            return;
          case 'rendStrike':
            this.play('monsterSlam', e.x, e.y, 0.6, 1.15 * this.jitter(0.04));
            return;
          case 'icePrison':
            // Closed or broken, the ice shatters (the capture itself is debuffFreeze on the one caught).
            this.play('hitCold', e.x, e.y, 0.55, 1.35);
            return;
          default:
            // frostNovaWarning and wispBurst are voiced by the 'slam' / 'nova' / 'burst' of the same tick.
            return;
        }
      case 'projectileEnd':
        // Lobs announce their landing; other ends are covered by hit sounds.
        if (e.kind === 'cinderSpit') this.play('hitFire', e.x, e.y, 0.45, 0.8);
        else if (e.kind === 'tarGlob') this.play('tarSplat', e.x, e.y, 0.9, this.jitter(0.06));
        else if (e.kind === 'cinderShell') this.play('mortarBlast', e.x, e.y, 1, this.jitter(0.05));
        return;
      case 'blocked':
        // A wall stopping a shot is a duller, lower knock than a shield's ring (same sample, pitched down, a step quieter).
        if (e.cover) this.play('shieldBlock', e.x, e.y, 0.6, 0.62 * this.jitter(0.08));
        else this.play('shieldBlock', e.x, e.y, 0.9, this.jitter(0.06));
        return;
      case 'pull':
        return; // the root it ends in is voiced by 'debuff'
      case 'debuff':
        if (e.playerId === localId) this.debuff(e.debuff, e.stacks);
        return;
      case 'cleanse':
        if (e.playerId === localId && e.debuffs.length > 0) {
          for (const d of e.debuffs) this.voiced.delete(d);
          this.play('debuffCleanse', undefined, undefined, 1, 1);
        }
        return;
      case 'dropSpawn':
        // Own loot chimes by rarity; an item someone put on the floor (public) lands with a soft, low thud.
        if (e.owner === localId) this.play(DROP_SFX[e.tone], e.x, e.y, 1, 1);
        else if (e.owner === 0) this.play('dropNormal', e.x, e.y, 0.5, 0.85);
        return;
      case 'pickup':
        // Only your own pickups sound (someone else lifting a public drop is a silent poof).
        if (e.playerId === localId) this.play(e.tone === 'currency' ? 'pickupCurrency' : 'pickupItem', undefined, undefined, 0.9, this.jitter(0.03));
        return;
      case 'mote':
        if (e.playerId === localId) this.play('mote', undefined, undefined, 0.8, this.jitter(0.04));
        return;
      case 'flask':
        if (e.playerId === localId) this.play(e.resource === 'life' ? 'flaskLife' : 'flaskFocus', undefined, undefined, 1, 1);
        return;
      case 'ward':
        return; // voiced by its 'cast' event
      case 'nova': {
        // Roster batch 2 (SK3): Voltaic Pulse's ring, Singularity's collapse, Brittle Retort's ice nova.
        const id: SfxId = e.skill === 'glacialNova' ? 'glacialNovaBurst' : e.skill === 'voltaicPulse' ? 'voltaicPulse'
          : e.skill === 'gravityWell' ? 'wellCollapse' : e.skill === 'rimeBulwark' ? 'glacialNovaBurst'
            // Roster batch 3 (SK4): Storm Step's strikes, Event Horizon's detonation.
            : e.skill === 'stormStep' ? 'stormStepStrike' : e.skill === 'eventHorizon' ? 'horizonCollapse' : 'castNova';
        if (e.playerId === localId) this.play(id, undefined, undefined, 1, this.jitter(0.03));
        else this.play(id, e.x, e.y, ALLY_VOLUME, this.jitter(0.03));
        return;
      }
      case 'augment': {
        // Flagship augments (SK5): detonations, bursts and corpse explosions reuse the element's blast sounds; the rest is silent.
        if (e.fx !== 'detonate' && e.fx !== 'blast' && e.fx !== 'explode') return;
        const id: SfxId = e.damageType === 'fire' ? 'mortarBlast' : e.damageType === 'cold' ? 'glacialNovaBurst'
          : e.damageType === 'lightning' ? 'stormCallStrike' : e.damageType === 'void' ? 'wellCollapse' : 'hitPhysical';
        const vol = e.fx === 'explode' ? 0.7 : 0.9;
        if (e.playerId === localId) this.play(id, e.x, e.y, vol, this.jitter(0.06));
        else this.play(id, e.x, e.y, ALLY_VOLUME * vol, this.jitter(0.06));
        return;
      }
      case 'buff':
        // Voiced by its 'cast' event; a zero-length Rime Bulwark buff is the barrier breaking.
        if (e.skill === 'rimeBulwark' && e.duration <= 0) {
          if (e.playerId === localId) this.play('barrierBreak', undefined, undefined, 1, this.jitter(0.04));
          else this.play('barrierBreak', e.x, e.y, ALLY_VOLUME, this.jitter(0.04));
        }
        return;
      case 'chain':
        return; // visual only: Arc Chain's cast and hits carry the sound
      case 'ailment':
        // A soft tonal tick under the hit: the ailment took hold.
        if (e.ailment === 'burning') this.play('hitFire', e.x, e.y, 0.3, 0.7);
        else if (e.ailment === 'chilled') this.play('hitCold', e.x, e.y, 0.35, 1.3);
        else this.play('hitLightning', e.x, e.y, 0.35, 1.25);
        return;
      case 'mapEvent':
        this.mapEvent(e);
        return;
      case 'waveTell':
        this.play('waveTell', undefined, undefined, 1, 1);
        return;
      case 'waveStart':
        this.play('waveStart', undefined, undefined, 1, 1);
        return;
      case 'bossSpawn':
        this.play('bossSpawn', undefined, undefined, 1, 1);
        if (this.theme === 'rimedOssuary') this.play('choirSing', undefined, undefined, 0.6, 0.9);
        else if (this.theme === 'ironColiseum') this.play('crowdRoar', undefined, undefined, 1, 1);
        return;
      case 'bossPhase':
        if (this.theme === 'rimedOssuary') {
          this.play('wardenNova', undefined, undefined, 1, 0.9);
          this.play('icePrison', undefined, undefined, 0.8, 0.9);
        } else if (this.theme === 'ironColiseum') this.play('crowdRoar', undefined, undefined, 1, 1.05);
        else this.play('bossRoar', undefined, undefined, 1, 0.92);
        return;
      case 'cleared':
        this.play('cleared', undefined, undefined, 1, 1);
        return;
      case 'chestOpen':
        this.play('chestOpen', e.x, e.y, 1, 1);
        return;
      case 'portal':
        if (e.kind === 'open') this.play('portalOpen', e.x, e.y, 1, 1);
        else if (e.playerId === localId) this.play('portalEnter', undefined, undefined, 1, 1);
        else this.play('portalEnter', e.x, e.y, ALLY_VOLUME, 1);
        return;
      case 'playerDeath':
        if (e.playerId === localId) this.play('playerDeath', undefined, undefined, 1, 1);
        else this.play('playerDeath', e.x, e.y, 0.7, 1.05);
        return;
      case 'playerJoin':
        if (e.playerId !== localId) this.play('allyJoin', e.x, e.y, 0.9, 1);
        return;
      case 'notEnoughFocus':
        if (e.playerId === localId) this.play('notEnoughFocus', undefined, undefined, 1, 1);
        return;
      case 'flank':
        // Flankers coming from behind: the tell horn, higher and panned to where they come from.
        if (e.playerId === localId) this.play('waveTell', e.x, e.y, 0.8, 1.25);
        return;
    }
  }
}
