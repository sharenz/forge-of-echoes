// Pure mixing policy (no WebAudio): positional attenuation/pan and the voice gate that keeps
// hundreds of plays per second musical instead of fatiguing.

/** Sounds beyond this distance (world units ≈ pixels) are inaudible and culled. */
export const AUDIBLE_RADIUS = 500;
/**
 * Inside this distance a sound plays at full level. The view is ~640×360 world units, so most of
 * the player's own hits land 100–320 units away; the curve stays flat-ish across the screen and
 * does its real falloff off-screen.
 */
export const NEAR_RADIUS = 150;
/** Air absorption (a closing lowpass) only starts beyond this distance: on-screen hits stay crisp. */
export const AIR_RADIUS = 300;
/** Lowpass cutoff reached at the audible radius. */
export const AIR_CUTOFF = 4000;
/** Horizontal offset at which a sound reaches maximum pan. */
export const PAN_WIDTH = 340;
/** Never pan fully hard: keeps off-screen action natural on headphones. */
export const MAX_PAN = 0.8;

export interface Spatial {
  /** Linear gain 0..1 (distance falloff × pan-law compensation). */
  gain: number;
  /** Stereo pan −MAX_PAN..MAX_PAN. */
  pan: number;
  /** Air-absorption lowpass cutoff in Hz (0 = none). */
  lowpass: number;
  /** Extra reverb send: distant sounds sit further back in the room. */
  wet: number;
}

/**
 * Voices are stereo when they reach the StereoPannerNode, and for stereo input the node uses a
 * balance law that *sums* the far channel into the near one: correlated (centre-ish) material gets
 * up to +3 dB louder as it is panned. This gain undoes that so a sound keeps the same power at any
 * pan position (1 at the centre).
 */
export function panCompensation(pan: number): number {
  return 1 / Math.sqrt(1 + Math.sin((Math.min(1, Math.abs(pan)) * Math.PI) / 2));
}

export function spatialize(dx: number, dy: number): Spatial {
  const d = Math.hypot(dx, dy);
  const t = Math.min(1, Math.max(0, (d - NEAR_RADIUS) / (AUDIBLE_RADIUS - NEAR_RADIUS)));
  const pan = Math.max(-1, Math.min(1, dx / PAN_WIDTH)) * MAX_PAN;
  const air = (d - AIR_RADIUS) / (AUDIBLE_RADIUS - AIR_RADIUS);
  const lowpass = air > 0 ? 18000 * Math.pow(AIR_CUTOFF / 18000, Math.min(1, air)) : 0;
  return { gain: (1 - t) * panCompensation(pan), pan, lowpass, wet: 0.22 * t };
}

// ---------------------------------------------------------------------------
// Voice gate
// ---------------------------------------------------------------------------

/**
 * What to do with a request that arrives inside the minimum interval of the previous play:
 *  - `drop`: discard it (UI, skills, one-shot events).
 *  - `defer`: queue it just after the previous one (with a little random spacing), so loot
 *    fountains become a cascade of tinks instead of collapsing to a single sound.
 *  - `loudest`: requests from the same frame merge into one voice; the loudest (nearest) request
 *    wins, and every merged request adds "mass" (+1.5 dB per doubling, capped).
 */
export type BurstPolicy = 'drop' | 'defer' | 'loudest';

export interface GateRules {
  /** Concurrent voices of this id; the oldest is stolen (faded) beyond this. */
  maxVoices: number;
  /** Minimum seconds between two starts of this id. */
  minInterval: number;
  /** 0 = expendable spam (dropped when the global budget is full), 1 = normal, 2 = never dropped. */
  priority: 0 | 1 | 2;
  /** Density group (e.g. 'combat'): many plays across ids get gently quieter together. */
  group?: string;
  burst?: BurstPolicy;
  /** Repetition-energy time constant (s): longer = sustained spam settles lower. */
  energyTau?: number;
  /** Plays of the same id closer than this count as a combo (rising pickup notes, short variants). */
  comboWindow?: number;
}

export interface GateVoice {
  /** Audio-clock start time. */
  readonly start: number;
  /** Audio-clock time the voice ends. */
  readonly end: number;
  readonly priority: number;
  /** Fade out and stop (voice stealing). A voice that has not started yet is cancelled silently. */
  kill(when: number): void;
  /** Raise a not-yet-started voice to `db` above its admitted level (burst mass). */
  mass?(db: number): void;
}

export type Admission =
  | {
      ok: true;
      /** Start time: the request time, or later when the play was deferred. */
      at: number;
      /** Repetition / density attenuation (linear). */
      gain: number;
      combo: number;
      /** Burst mass to add (dB); non-zero only when this request replaced a merged burst voice. */
      massDb: number;
    }
  | { ok: false; reason: 'interval' | 'budget' | 'merged' };

interface Lane {
  voices: GateVoice[];
  /** Start times of deferred plays that have not started yet. */
  queue: number[];
  /** Start time of the most recently admitted voice. */
  last: number;
  energy: number;
  energyAt: number;
  combo: number;
  /** The current same-frame burst (loudest policy). */
  burstAt: number;
  burstCount: number;
  burstLoud: number;
  burstGain: number;
  burstVoice: GateVoice | null;
}

interface Density {
  energy: number;
  at: number;
}

export interface GateStats {
  played: number;
  droppedInterval: number;
  droppedBudget: number;
  stolen: number;
  /** Requests folded into a same-frame burst voice (loudest policy). */
  merged: number;
  /** Requests queued behind the previous play (defer policy). */
  deferred: number;
}

/** Default energy time constant (s): how long a burst of plays keeps a sound attenuated. */
export const ENERGY_TAU = 0.3;
/** Default combo window (s). */
export const COMBO_WINDOW = 0.35;
/** Requests this close to a burst's first request belong to the same frame (60 Hz presenter). */
export const BURST_WINDOW = 0.005;
/** A same-frame request must be this much louder to replace the burst voice. */
export const BURST_LOUDER = 1.5;
/** Mass added per doubling of merged requests, and its cap (dB). */
export const MASS_DB_PER_DOUBLING = 1.5;
export const MASS_DB_MAX = 4;
/** Deferred plays: random extra spacing, how far ahead they may queue, and how many. */
export const DEFER_JITTER = 0.025;
export const DEFER_HORIZON = 0.6;
export const DEFER_MAX = 6;

/** Mass (dB) for a voice that stands for `count` simultaneous requests. */
export function massDb(count: number): number {
  return count <= 1 ? 0 : Math.min(MASS_DB_MAX, MASS_DB_PER_DOUBLING * Math.log2(count));
}

/** Tiny deterministic LCG so the gate is reproducible in tests when no source is injected. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class VoiceGate<K extends string = string> {
  private readonly lanes = new Map<K, Lane>();
  private readonly groups = new Map<string, Density>();
  readonly stats: GateStats = { played: 0, droppedInterval: 0, droppedBudget: 0, stolen: 0, merged: 0, deferred: 0 };

  constructor(
    readonly maxTotal = 56,
    /** Uniform [0, 1) source for defer spacing. */
    private readonly random: () => number = lcg(0x5eed),
  ) {}

  private lane(id: K): Lane {
    let l = this.lanes.get(id);
    if (!l) {
      l = {
        voices: [], queue: [], last: -Infinity, energy: 0, energyAt: 0, combo: 0,
        burstAt: -Infinity, burstCount: 0, burstLoud: 0, burstGain: 1, burstVoice: null,
      };
      this.lanes.set(id, l);
    }
    return l;
  }

  private static prune(l: Lane, now: number): void {
    if (l.voices.some((v) => v.end <= now)) l.voices = l.voices.filter((v) => v.end > now);
  }

  /** Voices currently sounding or scheduled (after pruning finished ones). */
  active(now: number, id?: K): number {
    if (id !== undefined) {
      const l = this.lanes.get(id);
      if (!l) return 0;
      VoiceGate.prune(l, now);
      return l.voices.length;
    }
    let n = 0;
    for (const l of this.lanes.values()) {
      VoiceGate.prune(l, now);
      n += l.voices.length;
    }
    return n;
  }

  /**
   * Decide whether a new voice may start for a request at `now`; steals voices as needed.
   * `loudness` is the request's linear level after distance/volume (used by the loudest policy).
   */
  admit(id: K, now: number, rules: GateRules, loudness = 1): Admission {
    const lane = this.lane(id);
    VoiceGate.prune(lane, now);
    const policy = rules.burst ?? 'drop';
    let at = now;
    let replaced: GateVoice | null = null;

    if (now - lane.last < rules.minInterval) {
      if (policy === 'loudest' && lane.burstVoice && now - lane.burstAt <= BURST_WINDOW) {
        // Same frame as the burst voice, which has not started yet: merge.
        lane.burstCount++;
        if (loudness > lane.burstLoud * BURST_LOUDER) {
          replaced = lane.burstVoice;
        } else {
          lane.burstVoice.mass?.(massDb(lane.burstCount));
          this.stats.merged++;
          return { ok: false, reason: 'merged' };
        }
      } else if (policy === 'defer') {
        at = Math.max(now, lane.last + rules.minInterval + DEFER_JITTER * this.random());
        if (lane.queue.some((t) => t <= now)) lane.queue = lane.queue.filter((t) => t > now);
        if (at - now > DEFER_HORIZON || lane.queue.length >= DEFER_MAX) {
          this.stats.droppedInterval++;
          return { ok: false, reason: 'interval' };
        }
        lane.queue.push(at);
        this.stats.deferred++;
      } else {
        this.stats.droppedInterval++;
        return { ok: false, reason: 'interval' };
      }
    }

    if (replaced) {
      // The swapped-out voice never became audible: remove it and reuse its admission.
      lane.voices = lane.voices.filter((v) => v !== replaced);
      replaced.kill(now);
      this.stats.merged++;
      lane.burstLoud = loudness;
      lane.burstVoice = null;
      return { ok: true, at: lane.last, gain: lane.burstGain, combo: lane.combo, massDb: massDb(lane.burstCount) };
    }

    if (this.active(now) >= this.maxTotal) {
      if (rules.priority === 0) {
        this.stats.droppedBudget++;
        return { ok: false, reason: 'budget' };
      }
      this.stealExpendable(now);
    }
    // Per-id cap, counted over voices that will still sound when this one starts.
    const cap = Math.max(1, rules.maxVoices);
    let overlapping = lane.voices.filter((v) => v.end > at);
    while (overlapping.length >= cap) {
      const victim = overlapping.shift()!;
      lane.voices = lane.voices.filter((v) => v !== victim);
      victim.kill(Math.max(now, Math.min(at, victim.end)));
      this.stats.stolen++;
      overlapping = lane.voices.filter((v) => v.end > at);
    }

    // Repetition energy: a single play is untouched, sustained spam settles ~4–6 dB lower.
    const tau = rules.energyTau ?? ENERGY_TAU;
    lane.energy = lane.energy * Math.exp(-Math.max(0, at - lane.energyAt) / tau) + 1;
    lane.energyAt = Math.max(lane.energyAt, at);
    let gain = 1 / Math.sqrt(1 + 0.3 * (lane.energy - 1));
    if (rules.group) {
      let g = this.groups.get(rules.group);
      if (!g) {
        g = { energy: 0, at };
        this.groups.set(rules.group, g);
      }
      g.energy = g.energy * Math.exp(-Math.max(0, at - g.at) / ENERGY_TAU) + 1;
      g.at = Math.max(g.at, at);
      gain *= Math.pow(1 + Math.max(0, g.energy - 1) / 12, -0.4);
    }
    lane.combo = at - lane.last < (rules.comboWindow ?? COMBO_WINDOW) ? lane.combo + 1 : 0;
    lane.last = at;
    lane.burstAt = now;
    lane.burstCount = 1;
    lane.burstLoud = loudness;
    lane.burstGain = gain;
    lane.burstVoice = null;
    this.stats.played++;
    return { ok: true, at, gain, combo: lane.combo, massDb: 0 };
  }

  /** Register a voice that was admitted (it becomes the lane's current burst voice). */
  add(id: K, v: GateVoice): void {
    const lane = this.lane(id);
    lane.voices.push(v);
    lane.burstVoice = v;
  }

  private stealExpendable(now: number): void {
    let victim: { lane: Lane; voice: GateVoice } | null = null;
    for (const l of this.lanes.values()) {
      for (const v of l.voices) {
        if (v.priority === 0 && (!victim || v.end < victim.voice.end)) victim = { lane: l, voice: v };
      }
    }
    if (victim) {
      const { lane, voice } = victim;
      lane.voices = lane.voices.filter((v) => v !== voice);
      if (lane.burstVoice === voice) lane.burstVoice = null;
      voice.kill(now);
      this.stats.stolen++;
    }
  }

  clear(): void {
    this.lanes.clear();
    this.groups.clear();
  }
}
