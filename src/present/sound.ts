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
import type { SfxId } from '../contracts/audio';
import type { DamageType, MonsterKind, SkillId } from '../contracts/content';
import type { DropTone, SimEvent } from '../contracts/sim';
import { RARITY_CODE } from '../contracts/sim';
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
};

/**
 * Sound for a cast of `skill`. Rift Step plays through its 'dash' event and Ember Nova through its 'nova' event
 * (a Nova echo emits only 'nova', so voicing the nova keeps echoes audible and never doubles a cast).
 */
export const CAST_SFX: Record<SkillId, SfxId | null> = {
  emberLance: 'castEmber',
  emberNova: null,
  flameWave: 'castWave',
  rimeShards: 'castFrost',
  arcChain: 'castArc',
  riftStep: null,
  cinderWard: 'ward',
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

const BIG_KINDS: ReadonlySet<MonsterKind> = new Set(['ironhideBrute', 'ashboundHerald', 'cinderMatriarch']);

/** Volume of sounds made by other players (allies) relative to your own. */
export const ALLY_VOLUME = 0.6;

export class SoundDirector {
  private readonly sink: SfxSink;
  private readonly frameCount = new Map<SfxId, number>();
  private readonly lastPlayed = new Map<SfxId, number>();
  private now = 0;
  /** Random source for pitch jitter (injectable for tests). */
  private readonly random: () => number;

  constructor(sink: SfxSink, random: () => number = Math.random) {
    this.sink = sink;
    this.random = random;
  }

  /** Start a new frame at presentation time `now` (seconds). Resets the per-frame caps. */
  beginFrame(now: number): void {
    this.now = now;
    this.frameCount.clear();
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

  private jitter(amount: number): number {
    return 1 + (this.random() * 2 - 1) * amount;
  }

  /** Map one sim event to sound. `localId` is the player this client controls. */
  handle(e: SimEvent, localId: number): void {
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
        if (big) this.play('monsterDeathBig', e.x, e.y, 1, this.jitter(0.04));
        else this.play('monsterDeath', e.x, e.y, 0.9, this.jitter(0.08));
        return;
      }
      case 'monsterAttack':
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
        if (e.rarity >= RARITY_CODE.lieutenant) this.play('heraldCall', e.x, e.y, 1, 1);
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
          default:
            return;
        }
      case 'projectileEnd':
        // Only the lobbed spit announces its landing; other ends are covered by hit sounds.
        if (e.kind === 'cinderSpit') this.play('hitFire', e.x, e.y, 0.45, 0.8);
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
      case 'nova':
        if (e.playerId === localId) this.play('castNova', undefined, undefined, 1, this.jitter(0.03));
        else this.play('castNova', e.x, e.y, ALLY_VOLUME, this.jitter(0.03));
        return;
      case 'chain':
        return; // visual only: Arc Chain's cast and hits carry the sound
      case 'ailment':
        // A soft tonal tick under the hit: the ailment took hold.
        if (e.ailment === 'burning') this.play('hitFire', e.x, e.y, 0.3, 0.7);
        else if (e.ailment === 'chilled') this.play('hitCold', e.x, e.y, 0.35, 1.3);
        else this.play('hitLightning', e.x, e.y, 0.35, 1.25);
        return;
      case 'waveTell':
        this.play('waveTell', undefined, undefined, 1, 1);
        return;
      case 'waveStart':
        this.play('waveStart', undefined, undefined, 1, 1);
        return;
      case 'bossSpawn':
        this.play('bossSpawn', undefined, undefined, 1, 1);
        return;
      case 'bossPhase':
        this.play('bossRoar', undefined, undefined, 1, 0.92);
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
    }
  }
}
