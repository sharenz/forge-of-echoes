import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUSIC_IDS, SFX_IDS, type AudioEngine, type PlayOptions, type SfxId } from '../../src/contracts/audio';
import { audioDebug, CHAIN_REV, createAudio, setMusicTheme, sfxImpactDelay, VARKUS_REV, WebAudioEngine } from '../../src/audio';
import { BANKED_IDS, SampleBank, type BankVariant } from '../../src/audio/bank';
import { START_SCATTER } from '../../src/audio/engine';
import { DEBUFF_LAG } from '../../src/audio/sfx';
import { FakeAudioContext, FakeBuffer, FakeBufferSource, FakeGain, FakeSource, installFakeAudio, uninstallFakeAudio } from './fake-audio';

describe('without WebAudio (Node, tests, old browsers)', () => {
  it('every call is a safe no-op', async () => {
    expect((globalThis as { AudioContext?: unknown }).AudioContext).toBeUndefined();
    const audio = createAudio();
    expect(audio.unlocked).toBe(false);
    await expect(audio.unlock()).resolves.toBeUndefined();
    expect(audio.unlocked).toBe(false);
    for (const id of SFX_IDS) audio.play(id, { x: 10, y: 20, volume: 0.5, pitch: 1.1 });
    audio.setListener(5, 5);
    for (const id of MUSIC_IDS) audio.setMusic(id);
    audio.setMusic(null);
    setMusicTheme(audio, 'ironColiseum');
    setMusicTheme(audio, null);
    audio.setIntensity(0.7);
    audio.setVolumes({ master: 0.5, music: 0.5, sfx: 0.5 });
    audio.dispose();
    audio.dispose();
    audio.play('uiClick');
    await expect(audio.unlock()).resolves.toBeUndefined();
    expect(audioDebug(audio)?.debug().state).toBe('disposed');
  });

  it('tolerates garbage input', () => {
    const audio = createAudio();
    audio.play('notARealSound' as never);
    audio.setMusic('nope' as never);
    audio.setIntensity(Number.NaN);
    audio.setVolumes({ master: Number.NaN, music: Infinity, sfx: -1 });
    audio.setListener(Number.NaN, Infinity);
    expect(() => audio.dispose()).not.toThrow();
  });
});

describe('with a (fake) AudioContext', () => {
  beforeEach(() => {
    installFakeAudio();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    uninstallFakeAudio();
  });

  const ctxOf = () => FakeAudioContext.instances[FakeAudioContext.instances.length - 1];
  /** Advance both the audio clock and JS timers (the music scheduler). */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 25) {
      ctxOf().advance(0.025);
      vi.advanceTimersByTime(25);
    }
  };

  it('creates the context lazily on unlock and flushes sounds queued before it', async () => {
    const audio = createAudio();
    audio.play('uiClick');
    expect(FakeAudioContext.instances).toHaveLength(0); // no context before a gesture
    await audio.unlock();
    expect(audio.unlocked).toBe(true);
    const ctx = ctxOf();
    expect(ctx.state).toBe('running');
    expect(ctx.sources.some((s) => s.kind === 'oscillator')).toBe(true); // queued click played
    await audio.unlock(); // idempotent
    expect(FakeAudioContext.instances).toHaveLength(1);
    audio.dispose();
    expect(ctx.state).toBe('closed');
  });

  it('drops queued sounds that went stale before unlock', async () => {
    const audio = createAudio();
    audio.play('uiClick');
    const t0 = performance.now();
    vi.advanceTimersByTime(1000);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(1000); // fake timers drive the queue clock
    await audio.unlock();
    const ctx = ctxOf();
    // Only the 1-sample silent primer ran; the stale click was dropped.
    expect(ctx.sources.every((s) => s.kind === 'bufferSource')).toBe(true);
    audio.dispose();
  });

  it('keeps queueing while autoplay is blocked and flushes once a later gesture succeeds', async () => {
    FakeAudioContext.autoplayBlocked = true;
    const audio = createAudio();
    audio.setMusic('hideout');
    await audio.unlock();
    const ctx = ctxOf();
    expect(audio.unlocked).toBe(false);
    audio.play('dropRare');
    expect(ctx.sources.every((s) => s.kind === 'bufferSource')).toBe(true); // nothing audible yet
    ctx.allowResume = true;
    await audio.unlock(); // the next click
    expect(audio.unlocked).toBe(true);
    expect(ctx.sources.some((s) => s.kind === 'oscillator')).toBe(true); // queued rare drop played
    expect(audioDebug(audio)!.debug().music).toBe('hideout');
    audio.dispose();
  });

  it('plays every sound effect after unlock, with and without position', async () => {
    const audio = createAudio();
    await audio.unlock();
    const ctx = ctxOf();
    for (const id of SFX_IDS) {
      const before = ctx.sources.length;
      audio.play(id);
      expect(ctx.sources.length, id).toBeGreaterThan(before);
      run(50);
    }
    audio.setListener(100, 100);
    const before = ctx.sources.length;
    audio.play('hitFire', { x: 150, y: 120 });
    expect(ctx.sources.length).toBeGreaterThan(before);
    const culledBefore = ctx.sources.length;
    audio.play('hitFire', { x: 100 + 900, y: 100 }); // far outside the audible radius
    expect(ctx.sources.length).toBe(culledBefore);
    expect(audioDebug(audio)!.debug().stats.culled).toBe(1);
    audio.dispose();
  });

  it('limits voices per sound under a 200 plays/s barrage', async () => {
    const audio = createAudio();
    await audio.unlock();
    const dbg = audioDebug(audio)!;
    for (let i = 0; i < 400; i++) {
      audio.play('hitFire', { x: (i % 20) * 10, y: 0 });
      run(5 * ((i % 5) === 4 ? 1 : 0) + 5);
      expect(dbg.debug().activeVoices).toBeLessThanOrEqual(5);
    }
    const s = dbg.debug().stats;
    expect(s.droppedInterval).toBeGreaterThan(100);
    expect(s.played).toBeGreaterThan(50);
    audio.dispose();
  });

  it('remembers music requested before unlock, crossfades, and fades to silence', async () => {
    const audio = createAudio();
    audio.setMusic('title');
    audio.setVolumes({ master: 0.8, music: 0.5, sfx: 1 });
    await audio.unlock();
    const dbg = audioDebug(audio)!;
    expect(dbg.debug().music).toBe('title');
    const ctx = ctxOf();
    run(3000);
    const titleSources = ctx.sources.length;
    expect(titleSources).toBeGreaterThan(3); // drones + scheduled notes

    audio.setMusic('map');
    audio.setIntensity(1);
    expect(dbg.debug().music).toBe('map');
    run(6000);
    expect(dbg.debug().intensity).toBeGreaterThan(0.9); // smoothed toward the target
    expect(ctx.sources.length).toBeGreaterThan(titleSources + 20);

    // Crossfade gains: the old track fades to exactly 0, the new one ramps up.
    const fades = ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain && n.gain.events.length >= 2 && n.gain.events[0].value === 0 && n.gain.events[0].type === 'set');
    expect(fades.some((g) => g.gain.events.at(-1)!.value === 0 && g.gain.events.length >= 3)).toBe(true);

    audio.setMusic(null);
    run(10000);
    const count = ctx.sources.length;
    run(3000);
    expect(ctx.sources.length).toBe(count); // scheduler stopped: nothing new is scheduled
    expect(dbg.debug().music).toBeNull();
    audio.dispose();
  });

  it('colours map/boss music by theme: remembered before unlock, crossfaded on change, garbage-tolerant', async () => {
    const audio = createAudio();
    setMusicTheme(audio, 'rimedOssuary');
    audio.setMusic('map');
    await audio.unlock();
    const dbg = audioDebug(audio)!;
    const ctx = ctxOf();
    expect(dbg.debug().theme).toBe('rimedOssuary');
    expect(dbg.debug().music).toBe('map');
    run(1500);
    /** Track crossfade gains that faded out: a mid-fade `set` followed by the 12-segment ramp to 0. */
    const fadedOut = () =>
      ctx.nodes.filter((n): n is FakeGain => {
        if (!(n instanceof FakeGain)) return false;
        const ev = n.gain.events;
        if (ev.length < 13 || ev[0].type !== 'set' || ev.at(-1)!.value !== 0) return false;
        const tail = ev.slice(-13);
        return tail[0].type === 'set' && tail.slice(1).every((e) => e.type === 'linear');
      }).length;
    expect(fadedOut()).toBe(0);
    // A new colour under the playing map track: the old instance fades out (dry, reverb, echo).
    setMusicTheme(audio, 'ironColiseum');
    run(500);
    expect(fadedOut()).toBe(3);
    expect(dbg.debug().music).toBe('map');
    // The forge, the hideout, null and garbage all mean "plain": one more crossfade, then none.
    setMusicTheme(audio, 'ashenForge');
    run(500);
    expect(fadedOut()).toBe(6);
    setMusicTheme(audio, 'hideout');
    setMusicTheme(audio, null);
    setMusicTheme(audio, 'lavaLand' as never);
    run(500);
    expect(fadedOut()).toBe(6);
    expect(dbg.debug().theme).toBeNull();
    // Unthemed tracks ignore the colour.
    audio.setMusic('hideout');
    run(3000);
    const before = fadedOut();
    setMusicTheme(audio, 'rimedOssuary');
    run(500);
    expect(fadedOut()).toBe(before);
    audio.dispose();
    expect(() => setMusicTheme(audio, 'ironColiseum')).not.toThrow();
  });

  it('copies options queued before unlock (callers may reuse a scratch object)', async () => {
    const audio = createAudio();
    const scratch = { x: 20, y: 0 };
    audio.play('uiClick', scratch);
    scratch.x = 5000; // reused for something far away before the context unlocks
    await audio.unlock();
    expect(audioDebug(audio)!.debug().stats.culled).toBe(0);
    expect(ctxOf().sources.some((s) => s.kind === 'oscillator' || (s.kind === 'bufferSource' && s.started! > 0))).toBe(true);
    audio.dispose();
  });

  it('merges one frame of same-id kills into a single, massed voice', async () => {
    const audio = createAudio();
    await audio.unlock();
    const dbg = audioDebug(audio)!;
    const ctx = ctxOf();
    const before = ctx.sources.length;
    audio.play('monsterDeath', { x: 40, y: 0 });
    const perVoice = ctx.sources.length - before;
    for (let i = 1; i < 20; i++) audio.play('monsterDeath', { x: 40 + i * 8, y: 20 });
    const s = dbg.debug().stats;
    expect(s.played).toBe(1);
    expect(s.merged).toBe(19);
    expect(ctx.sources.length - before).toBe(perVoice);
    // The surviving voice's level rose by the burst mass (+4 dB cap for 20 requests).
    const inputs = ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain && n.gain.value > 0 && n.gain.value < 5);
    expect(inputs.length).toBeGreaterThan(0);
    audio.dispose();
  });

  it('turns a same-frame loot fountain into a cascade', async () => {
    const audio = createAudio();
    await audio.unlock();
    const ctx = ctxOf();
    const starts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = ctx.sources.length;
      audio.play('dropCurrency', { x: i * 10, y: 0 });
      starts.push(Math.min(...ctx.sources.slice(before).map((x) => x.started!)));
    }
    const s = audioDebug(audio)!.debug().stats;
    expect(s.played).toBe(6);
    expect(s.deferred).toBe(5);
    for (let i = 1; i < 6; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(0.05 - 1e-9);
      expect(starts[i] - starts[i - 1]).toBeLessThanOrEqual(0.08);
    }
    // The per-id cap (3) fades older coins as later ones start; every coin is still heard.
    for (const t of starts) {
      const voice = ctx.sources.filter((x) => Math.abs(x.started! - t) < 1e-9);
      for (const src of voice) expect(src.stopped!, 'stopped after it started').toBeGreaterThan(src.started! + 0.02);
    }
    audio.dispose();
  });

  it('scatters the start of frame-aligned combat plays by a few ms', async () => {
    const audio = createAudio();
    await audio.unlock();
    const ctx = ctxOf();
    const ids: SfxId[] = ['hitFire', 'hitCold', 'hitPhysical', 'hitLightning', 'monsterDeath', 'monsterAttack'];
    const firsts: number[] = [];
    for (const id of ids) {
      const before = ctx.sources.length;
      audio.play(id, { x: 60, y: 0 });
      firsts.push(Math.min(...ctx.sources.slice(before).map((x) => x.started!)));
    }
    const t0 = ctx.currentTime + 0.012;
    for (const t of firsts) {
      expect(t).toBeGreaterThanOrEqual(t0 - 1e-9);
      expect(t).toBeLessThanOrEqual(t0 + START_SCATTER + 0.02);
    }
    expect(new Set(firsts.map((t) => t.toFixed(5))).size).toBeGreaterThan(3);
    audio.dispose();
  });

  /** Play one request; return the sources it started (empty when the gate refused it). */
  const voiceOf = (audio: AudioEngine, id: SfxId, opts?: PlayOptions): FakeSource[] => {
    const ctx = ctxOf();
    const before = ctx.sources.length;
    audio.play(id, opts);
    return ctx.sources.slice(before);
  };
  const firstStart = (v: FakeSource[]) => Math.min(...v.map((s) => s.started!));

  it("gives an ally's (positioned) player sounds their own lane: they never block or steal the local player's", async () => {
    const audio = createAudio();
    await audio.unlock();
    // Same frame: an ally's chill first, then the local player's. Both play; the ally's is not stolen.
    const ally = voiceOf(audio, 'debuffChill', { x: 120, y: 0, volume: 0.6 });
    const local = voiceOf(audio, 'debuffChill');
    expect(ally.length).toBeGreaterThan(0);
    expect(local.length).toBeGreaterThan(0);
    for (const s of ally) expect(s.stopped!).toBeGreaterThan(s.started!);
    // Inside the freeze's minInterval: an ally is frozen, the local player 0.2 s later — still heard.
    run(1000);
    expect(voiceOf(audio, 'debuffFreeze', { x: -80, y: 30 }).length).toBeGreaterThan(0);
    run(200);
    expect(voiceOf(audio, 'debuffFreeze').length).toBeGreaterThan(0);
    // The local lane still guards against refresh spam: a re-application 0.2 s later is dropped.
    run(200);
    expect(voiceOf(audio, 'debuffFreeze')).toHaveLength(0);
    // Same for hurts: an ally's hurt in the same frame does not swallow the local one.
    run(1000);
    expect(voiceOf(audio, 'playerHurt', { x: 60, y: 0, volume: 0.45 }).length).toBeGreaterThan(0);
    expect(voiceOf(audio, 'playerHurt').length).toBeGreaterThan(0);
    expect(audioDebug(audio)!.debug().stats.droppedInterval).toBe(1);
    audio.dispose();
  });

  it('keeps the nearest storm zone when several blizzard gusts are requested in one frame', async () => {
    const audio = createAudio();
    await audio.unlock();
    const far = voiceOf(audio, 'blizzardLoop', { x: 380, y: 0 });
    const near = voiceOf(audio, 'blizzardLoop', { x: 40, y: 0 }); // the zone the player stands in
    expect(far.length).toBeGreaterThan(0);
    expect(near.length).toBeGreaterThan(0);
    // The far gust was cancelled before it ever started; the near one plays in full.
    for (const s of far) expect(s.stopped!).toBeLessThanOrEqual(firstStart(far) + 1e-9);
    for (const s of near) expect(s.stopped!).toBeGreaterThan(firstStart(near) + 1);
    const st = audioDebug(audio)!.debug().stats;
    expect(st.played).toBe(1);
    expect(st.merged).toBe(1);
    audio.dispose();
  });

  it('starts an ailment DEBUFF_LAG after the hit it arrives with (and reports it as its impact delay)', async () => {
    const audio = createAudio();
    await audio.unlock();
    const hurt = firstStart(voiceOf(audio, 'playerHurt'));
    for (const id of ['debuffFreeze', 'debuffRoot', 'debuffBleed', 'debuffChill'] as const) {
      expect(firstStart(voiceOf(audio, id)) - hurt, id).toBeCloseTo(DEBUFF_LAG, 6);
      expect(sfxImpactDelay(id), id).toBeCloseTo(DEBUFF_LAG, 6);
    }
    audio.dispose();
  });

  it('continues a whirl seamlessly when it is replayed every spin', async () => {
    const audio = createAudio();
    await audio.unlock();
    for (const [id, rev] of [['chainWhirl', CHAIN_REV], ['varkusWhirl', VARKUS_REV]] as const) {
      const a = voiceOf(audio, id);
      run(rev * 6 * 1000);
      const b = voiceOf(audio, id);
      const t1 = firstStart(b);
      expect(t1 - firstStart(a), id).toBeCloseTo(rev * 6, 1);
      // The previous play's wind-down is crossfaded out under the new spin, not layered on it.
      for (const s of a) expect(s.stopped!, id).toBeLessThanOrEqual(t1 + 0.03);
      run(4000);
    }
    // A continuation skips the blade being drawn: Varkus's replay starts fewer sources.
    const first = voiceOf(audio, 'varkusWhirl');
    run(VARKUS_REV * 6 * 1000);
    expect(voiceOf(audio, 'varkusWhirl').length).toBeLessThan(first.length);
    audio.dispose();
  });

  it('exposes impact delays for audio/visual sync', () => {
    for (const id of SFX_IDS) {
      const d = sfxImpactDelay(id);
      expect(d, id).toBeGreaterThanOrEqual(0);
      expect(d, id).toBeLessThan(0.6);
    }
    expect(sfxImpactDelay('dropUnique')).toBeCloseTo(0.15);
    expect(sfxImpactDelay('eruption')).toBe(0);
    expect(sfxImpactDelay('craftCorrupt')).toBeLessThanOrEqual(0.12);
    expect(sfxImpactDelay('hitFire')).toBe(0);
  });

  it('applies volumes with a perceptual taper and survives dispose mid-music', async () => {
    const audio = createAudio();
    await audio.unlock();
    audio.setVolumes({ master: 0.5, music: 1, sfx: 0 });
    const ctx = ctxOf();
    const targets = ctx.nodes
      .filter((n): n is FakeGain => n instanceof FakeGain)
      .flatMap((g) => g.gain.events.filter((e) => e.type === 'target').map((e) => e.value));
    expect(targets).toContain(0.25); // master 0.5 → 0.25
    expect(targets).toContain(0);
    audio.setMusic('boss');
    run(1000);
    audio.dispose();
    expect(() => run(1000)).not.toThrow();
    const n = ctx.sources.length;
    run(1000);
    expect(ctx.sources.length).toBe(n);
  });
});

describe('sample bank playback', () => {
  beforeEach(() => installFakeAudio(true));
  afterEach(() => uninstallFakeAudio());

  const variant = (channels: number, seconds: number, wet = false): BankVariant => {
    const b = new FakeBuffer(channels, Math.round(seconds * 48000), 48000) as unknown as AudioBuffer;
    return { dry: b, wet: wet ? b : null, echo: null, duration: seconds };
  };

  it('plays a banked sound as one buffer source through a handful of nodes', async () => {
    const bank = new SampleBank(48000, 1, null);
    bank.insert('hitFire', [[variant(1, 0.17), variant(1, 0.16)]]);
    bank.insert('crit', [[variant(1, 0.4, true)]]);
    const audio = new WebAudioEngine({ bank });
    await audio.unlock();
    const ctx = FakeAudioContext.instances.at(-1)!;
    audio.setListener(0, 0);
    let nodes = ctx.nodes.length;
    let sources = ctx.sources.length;
    audio.play('hitFire', { x: 380, y: 60, pitch: 1.1 }); // positional + air absorption
    const hit = ctx.sources.slice(sources);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toBeInstanceOf(FakeBufferSource);
    expect((hit[0] as FakeBufferSource).playbackRate.value).toBeGreaterThan(1.0);
    expect(ctx.nodes.length - nodes).toBeLessThanOrEqual(5); // source, level, lowpass, panner, send
    // A recipe with a per-layer reverb send gets a second source for it.
    nodes = ctx.nodes.length;
    sources = ctx.sources.length;
    audio.play('crit');
    expect(ctx.sources.length - sources).toBe(2);
    expect(ctx.nodes.length - nodes).toBeLessThanOrEqual(5);
    // Voices clean up after themselves once the buffers end.
    ctx.advance(1);
    for (const s of ctx.sources) (s as FakeSource).onended?.();
    const d = audioDebug(audio)!.debug();
    expect(d.stats.banked).toBe(2);
    expect(d.stats.live).toBe(0);
    audio.dispose();
  });

  it('renders the bank in the background after unlock and switches to it', async () => {
    const audio = new WebAudioEngine();
    const live = audioDebug(audio)!;
    await audio.unlock();
    await live.prepareBank();
    expect(live.debug().bank!.ready).toBe(BANKED_IDS.length);
    const ctx = FakeAudioContext.instances.filter((c) => !('startRendering' in c)).at(-1)!;
    const before = ctx.sources.length;
    audio.play('hitCold', { x: 30, y: 0 });
    expect(ctx.sources.slice(before).map((s) => s.kind)).toEqual(['bufferSource']);
    audio.play('dropUnique'); // big moments stay live-synthesised
    expect(ctx.sources.slice(before + 1).some((s) => s.kind === 'oscillator')).toBe(true);
    audio.dispose();
  });
});
