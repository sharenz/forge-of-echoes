import { describe, expect, it } from 'vitest';
import { MUSIC_IDS, SFX_IDS, type MusicId, type SfxId } from '../../src/contracts/audio';
import type { Theme } from '../../src/contracts/content';
import { dspResources } from '../../src/audio/dsp';
import { MUSIC_TARGET, MUSIC_TRIM_DB, SFX_TRIM_DB } from '../../src/audio/levels';
import { colourKey } from '../../src/audio/music/colours';
import type { TrackIO } from '../../src/audio/music/instruments';
import { stepDuration, TRACKS } from '../../src/audio/music/tracks';
import { Rand } from '../../src/audio/rand';
import { CHAIN_REV, coinStep, COMBAT_BUS_GROUPS, DEBUFF_LAG, DENSITY_GROUPS, MOTE_LADDER, moteStep, SFX, VARKUS_REV } from '../../src/audio/sfx';
import { VoiceBuilder } from '../../src/audio/voice';
import { asCtx, FakeAudioContext, FakeBiquad, FakeGain, FakeNode, FakeOscillator, FakeParam, FakeSource } from './fake-audio';

const ctx = new FakeAudioContext();
const res = dspResources(asCtx(ctx));

/**
 * Check the nodes a voice created: sources are bounded, envelopes are click-free, params sane.
 * An amplitude envelope is a gain that starts its automation at 0 and feeds audio (not a
 * modulation depth feeding an AudioParam). `sustainedFadeIns` allows long-lived music layers
 * that fade in and hold (the track's crossfade gain silences them).
 */
function checkNodes(nodes: FakeNode[], start: number, maxLen: number, sustainedFadeIns = false): { end: number } {
  let end = start;
  const sources = nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  expect(sources.length).toBeGreaterThan(0);
  for (const s of sources) {
    expect(s.started, `${s.kind} started`).not.toBeNull();
    expect(s.stopped, `${s.kind} stopped`).not.toBeNull();
    expect(s.stopped!).toBeGreaterThan(s.started!);
    expect(s.started!).toBeGreaterThanOrEqual(start - 1e-9);
    end = Math.max(end, s.stopped!);
  }
  expect(end - start).toBeLessThanOrEqual(maxLen);
  for (const n of nodes) {
    if (n instanceof FakeGain) {
      const ev = n.gain.events;
      // An envelope starts from silence and must return to exactly 0 before its sources stop.
      const isDepth = n.outputs.some((o) => o instanceof FakeParam);
      const holdsFadeIn = sustainedFadeIns && ev.length === 2 && ev[1].type === 'linear' && ev[1].value > 0;
      if (ev.length > 1 && ev[0].type === 'set' && ev[0].value === 0 && n.gain.modulators === 0 && !isDepth && !holdsFadeIn) {
        const last = ev[ev.length - 1];
        expect(last.value, 'envelope ends at 0').toBe(0);
        expect(last.time).toBeLessThanOrEqual(end + 1e-9);
        for (let i = 1; i < ev.length; i++) expect(ev[i].time).toBeGreaterThanOrEqual(ev[i - 1].time - 1e-9);
      }
    }
    if (n instanceof FakeOscillator) {
      for (const e of n.frequency.events) {
        expect(e.value).toBeGreaterThan(0);
        expect(e.value).toBeLessThan(20000);
      }
    }
    if (n instanceof FakeBiquad) {
      for (const e of n.frequency.events) {
        expect(e.value).toBeGreaterThan(10);
        expect(e.value).toBeLessThan(24000);
      }
    }
  }
  return { end };
}

function buildSfx(id: SfxId, t: number, pitch = 1, combo = 0) {
  const before = ctx.nodes.length;
  const out = ctx.createGain();
  const v = new VoiceBuilder(asCtx(ctx), res, t, { out: out as unknown as AudioNode, wet: () => out as unknown as AudioNode, echo: () => out as unknown as AudioNode }, pitch, new Rand(3), combo);
  SFX[id].build(v);
  let done = false;
  v.finish(() => {
    done = true;
  });
  const nodes = ctx.nodes.slice(before + 1);
  return { v, nodes, isDone: () => done };
}

describe('sfx recipes', () => {
  it('cover every SfxId with sane mixing rules', () => {
    expect(Object.keys(SFX).sort()).toEqual([...SFX_IDS].sort());
    for (const id of SFX_IDS) {
      const d = SFX[id];
      expect(d.maxVoices, id).toBeGreaterThanOrEqual(1);
      expect(d.minInterval, id).toBeGreaterThanOrEqual(0);
      expect(d.minInterval, id).toBeLessThan(3);
      expect(d.pitchVar, id).toBeGreaterThanOrEqual(0);
      expect(d.pitchVar, id).toBeLessThanOrEqual(0.15);
      expect(d.reverb, id).toBeGreaterThanOrEqual(0);
      expect(d.reverb, id).toBeLessThanOrEqual(1);
      expect(d.target, id).toBeLessThan(-6);
      expect(d.target, id).toBeGreaterThan(-40);
    }
  });

  it('are all loudness-calibrated', () => {
    for (const id of SFX_IDS) {
      const trim = SFX_TRIM_DB[id];
      expect(trim, `${id} has a trim`).toBeTypeOf('number');
      expect(Math.abs(trim!)).toBeLessThan(30);
    }
  });

  it('keep frequent combat sounds short and cheap', () => {
    for (const id of SFX_IDS) {
      if (!COMBAT_BUS_GROUPS.has(SFX[id].group) || SFX[id].priority !== 0) continue;
      const { v, nodes } = buildSfx(id, 1);
      expect(nodes.length, `${id} node count`).toBeLessThanOrEqual(40);
      expect(v.end - 1, `${id} length`).toBeLessThan(0.6);
    }
  });

  it.each(SFX_IDS)('%s builds click-free, bounded voices (with pitch and combo variation)', (id) => {
    for (const [pitch, combo] of [[1, 0], [0.9, 3], [1.12, 12]] as const) {
      const t = ctx.currentTime + 0.5;
      const { v, nodes, isDone } = buildSfx(id, t, pitch, combo);
      const { end } = checkNodes(nodes, t, 6);
      expect(v.end).toBeCloseTo(end, 6);
      expect(nodes.length).toBeLessThan(400);
      // Once every source has ended, the whole voice disconnects itself.
      ctx.advance(end - ctx.currentTime + 0.01);
      expect(isDone()).toBe(true);
      expect(nodes.every((n) => n.disconnected)).toBe(true);
    }
  });

  it('assign burst policies by role: combat merges, loot cascades', () => {
    for (const id of SFX_IDS) {
      const d = SFX[id];
      if (DENSITY_GROUPS.has(d.group)) expect(d.burst, id).toBe('loudest');
      if (d.group === 'loot') expect(d.burst, id).toBe('defer');
      expect(d.impact ?? 0, id).toBeGreaterThanOrEqual(0);
    }
  });

  it('debuffs: start behind the hit, and guard against refresh spam', () => {
    const ailments = ['debuffChill', 'debuffFreeze', 'debuffRoot', 'debuffBurn', 'debuffBleed', 'debuffShock', 'debuffWither'] as const;
    for (const id of ailments) {
      expect(SFX[id].group, id).toBe('player');
      expect(SFX[id].lag, id).toBe(DEBUFF_LAG);
      expect(SFX[id].maxVoices, id).toBe(1);
    }
    // Shortest legitimate re-application (after resistance and Cinder Ward halving); freeze has 3 s immunity.
    expect(SFX.debuffFreeze.minInterval).toBeGreaterThanOrEqual(2.5);
    for (const id of ['debuffChill', 'debuffRoot'] as const) expect(SFX[id].minInterval, id).toBeGreaterThanOrEqual(0.6);
    for (const id of ['debuffBurn', 'debuffWither'] as const) expect(SFX[id].minInterval, id).toBeGreaterThanOrEqual(0.75);
    expect(SFX.debuffCleanse.lag ?? 0).toBe(0);
  });

  it('whirls continue on a replay: the continuation has no soft first turn or blade draw', () => {
    for (const id of ['chainWhirl', 'varkusWhirl'] as const) {
      const rev = id === 'chainWhirl' ? CHAIN_REV : VARKUS_REV;
      expect(SFX[id].maxVoices, id).toBe(1);
      expect(SFX[id].comboWindow!, id).toBeGreaterThan(rev * 6);
      const first = buildSfx(id, ctx.currentTime + 0.5, 1, 0);
      const cont = buildSfx(id, ctx.currentTime + 0.5, 1, 1);
      expect(cont.nodes.length, id).toBeLessThanOrEqual(first.nodes.length);
      expect(first.v.end - (ctx.currentTime + 0.5), id).toBeGreaterThan(rev * 6);
    }
  });

  it('voice stealing stops every source early', () => {
    const t = ctx.currentTime + 0.1;
    const { v, nodes } = buildSfx('dropUnique', t);
    v.stopAll(t + 0.2);
    for (const n of nodes) if (n instanceof FakeSource) expect(n.stopped!).toBeLessThanOrEqual(t + 0.2 + 1e-9);
  });
});

describe('music tracks', () => {
  it('cover every MusicId and are calibrated', () => {
    expect(Object.keys(TRACKS).sort()).toEqual([...MUSIC_IDS].sort());
    for (const id of MUSIC_IDS) {
      expect(TRACKS[id].bpm).toBeGreaterThan(30);
      expect(MUSIC_TARGET[id]).toBeLessThan(-12);
      expect(MUSIC_TRIM_DB[id]).toBeTypeOf('number');
    }
  });

  /** Run `steps` grid steps of a track and check it schedules valid notes and stops cleanly. */
  const scheduleCleanly = (id: MusicId, intensity: number, theme: Theme | null = null, steps = 160): number => {
    const t0 = ctx.currentTime + 0.1;
    const before = ctx.nodes.length;
    const bus = ctx.createGain() as unknown as AudioNode;
    const io: TrackIO = { ctx: asCtx(ctx), res, out: bus, wet: bus, echo: bus, rand: new Rand(9), theme };
    const def = TRACKS[id];
    const state = def.create(io, t0);
    const sd = stepDuration(def);
    for (let i = 0; i < steps; i++) state.step(i, t0 + i * sd, intensity);
    const stopAt = t0 + steps * sd;
    state.stop(stopAt);
    const nodes = ctx.nodes.slice(before + 1);
    const sources = nodes.filter((n): n is FakeSource => n instanceof FakeSource);
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      expect(s.stopped, `${id} ${s.kind} stopped`).not.toBeNull();
      expect(s.stopped!).toBeGreaterThan(s.started!);
      expect(s.stopped!).toBeLessThanOrEqual(stopAt + 8);
    }
    checkNodes(nodes, t0, stopAt - t0 + 8, true);
    // Everything ends: sources fire `ended` and note voices disconnect themselves.
    ctx.advance(stopAt + 8 - ctx.currentTime);
    expect(sources.every((s) => s.ended)).toBe(true);
    expect(sources.every((s) => s.disconnected)).toBe(true);
    return sources.length;
  };

  it.each(MUSIC_IDS)('%s schedules valid notes at every intensity and stops cleanly', (id) => {
    for (const intensity of [0, 0.5, 1]) scheduleCleanly(id, intensity);
  });

  it.each(['rimedOssuary', 'ironColiseum'] as const)('map and boss in the %s colour schedule valid notes and stop cleanly', (theme) => {
    // 272 steps: long enough for the map's breakdown bar and every colour's phrase-level events.
    for (const id of ['map', 'boss'] as const) for (const intensity of [0, 0.5, 1]) scheduleCleanly(id, intensity, theme, 272);
  });

  it('colour only the themed tracks, and each colour adds its own layers', () => {
    expect(MUSIC_IDS.filter((id) => TRACKS[id].themed)).toEqual(['map', 'boss']);
    expect(colourKey('rimedOssuary')).toBe('rimedOssuary');
    expect(colourKey('ironColiseum')).toBe('ironColiseum');
    for (const plain of ['ashenForge', 'hideout', null, undefined] as const) expect(colourKey(plain)).toBeNull();
    for (const id of ['map', 'boss'] as const) {
      const base = scheduleCleanly(id, 0.8, null, 272);
      expect(scheduleCleanly(id, 0.8, 'ashenForge', 272)).toBe(base); // the forge is the plain track
      expect(scheduleCleanly(id, 0.8, 'rimedOssuary', 272)).toBeGreaterThan(base * 1.05);
      expect(scheduleCleanly(id, 0.8, 'ironColiseum', 272)).toBeGreaterThan(base * 1.05);
    }
  });

  it('map drums get denser with intensity', () => {
    const count = (intensity: number) => {
      const before = ctx.sources.length;
      const bus = ctx.createGain() as unknown as AudioNode;
      const io: TrackIO = { ctx: asCtx(ctx), res, out: bus, wet: bus, echo: bus, rand: new Rand(5) };
      const state = TRACKS.map.create(io, ctx.currentTime);
      for (let i = 0; i < 128; i++) state.step(i, ctx.currentTime + i * 0.15, intensity);
      state.stop(ctx.currentTime + 128 * 0.15);
      return ctx.sources.length - before;
    };
    expect(count(1)).toBeGreaterThan(count(0) * 1.8);
  });
});

/** Peak level of every amplitude envelope in a voice. */
function envelopePeaks(nodes: FakeNode[]): number[] {
  return nodes
    .filter((n): n is FakeGain => n instanceof FakeGain && n.gain.events.length > 1 && n.gain.events[0].type === 'set' && n.gain.events[0].value === 0)
    .map((g) => Math.max(...g.gain.events.map((e) => e.value)));
}

describe('repetition design', () => {
  it('the mote ladder climbs, then keeps moving through the top octave instead of sticking', () => {
    const steps = Array.from({ length: 300 }, (_, c) => moteStep(c));
    expect(steps.slice(0, MOTE_LADDER.length)).toEqual(MOTE_LADDER.map((_, i) => i));
    for (let c = MOTE_LADDER.length; c < 295; c++) {
      expect(steps[c]).toBeGreaterThanOrEqual(5);
      expect(steps[c]).toBeLessThan(MOTE_LADDER.length);
      expect(steps[c]).not.toBe(steps[c - 1]);
      expect(new Set(steps.slice(c, c + 5)).size).toBeGreaterThanOrEqual(3);
    }
  });

  it('higher motes are quieter and the timbre varies per play', () => {
    const moteVoice = (combo: number, seed: number): FakeNode[] => {
      const before = ctx.nodes.length;
      const out = ctx.createGain() as unknown as AudioNode;
      const v = new VoiceBuilder(asCtx(ctx), res, 1, { out, wet: () => out, echo: () => out }, 1, new Rand(seed), combo);
      SFX.mote.build(v);
      return ctx.nodes.slice(before + 1);
    };
    const peak = (combo: number) => Math.max(...envelopePeaks(moteVoice(combo, 1)));
    expect(20 * Math.log10(peak(9) / peak(0))).toBeLessThan(-2.4); // ~1.5 dB per octave over ~1.8 octaves
    /** FM depth (the gain feeding the carrier frequency) and carrier detune of one play. */
    const timbre = (seed: number): [number, number] => {
      const nodes = moteVoice(3, seed);
      const depth = nodes.find((n): n is FakeGain => n instanceof FakeGain && n.outputs.some((o) => o instanceof FakeParam && o.name === 'frequency'))!;
      const carrier = nodes.find((n): n is FakeOscillator => n instanceof FakeOscillator && n.detune.events.length > 0)!;
      return [depth.gain.events[0].value, carrier.detune.events[0].value];
    };
    const [a, b] = [timbre(1), timbre(2)];
    expect(a[0]).not.toBeCloseTo(b[0], 3);
    expect(a[1]).not.toBeCloseTo(b[1], 3);
  });

  it('coin cascades climb and stay in range', () => {
    for (let c = 0; c < 100; c++) {
      expect(coinStep(c)).toBeGreaterThanOrEqual(0);
      expect(coinStep(c)).toBeLessThan(6);
    }
    expect([0, 1, 2, 3, 4, 5].map(coinStep)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('repeated craft applications play a short, dry tap; the first strike keeps the full anvil', () => {
    const first = buildSfx('craftApply', 1, 1, 0);
    const repeat = buildSfx('craftApply', 3, 1, 1);
    expect(first.v.end - 1).toBeGreaterThan(1);
    expect(repeat.v.end - 3).toBeLessThan(0.6);
    expect(repeat.nodes.length).toBeLessThan(first.nodes.length);
    expect(SFX.craftApply.comboWindow).toBeGreaterThanOrEqual(1);
    expect(SFX.craftApply.energyTau).toBeGreaterThanOrEqual(1);
  });
});
