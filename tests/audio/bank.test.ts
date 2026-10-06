import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SfxId } from '../../src/contracts/audio';
import { BANKED_IDS, SampleBank, type OfflineCtor } from '../../src/audio/bank';
import { dspResources } from '../../src/audio/dsp';
import { Rand } from '../../src/audio/rand';
import { SFX } from '../../src/audio/sfx';
import { VoiceBuilder } from '../../src/audio/voice';
import { asCtx, FakeAudioContext, FakeOfflineAudioContext, installFakeAudio, uninstallFakeAudio } from './fake-audio';

const Offline = FakeOfflineAudioContext as unknown as OfflineCtor;

describe('sample bank', () => {
  beforeEach(() => installFakeAudio(true));
  afterEach(() => uninstallFakeAudio());

  it('covers the frequent sounds, and only short ones', () => {
    const frequent: SfxId[] = [
      'hitFire', 'hitCold', 'hitLightning', 'hitVoid', 'hitPhysical', 'crit', 'evade', 'monsterDeath', 'monsterAttack', 'monsterSpit',
      'castEmber', 'castFrost', 'mote', 'pickupItem', 'pickupCurrency', 'dropNormal', 'uiHover', 'uiClick',
      // wave 5: swarmer / artillery attacks and the shield clank (hit by every blocked projectile)
      'boneRattle', 'houndBite', 'crossbowShot', 'tarSplat', 'shieldBlock',
      // the Atlas: the node hover tick and the zoom slide (slice F1)
      'atlasHover', 'atlasZoom',
    ];
    expect([...BANKED_IDS].sort()).toEqual([...frequent].sort());
    // Telegraphs, boss moves and debuffs stay live: they are rare, and several are longer than a bank slot.
    for (const id of ['wispPulse', 'wispBurst', 'webShot', 'crossbowAim', 'debuffChill', 'debuffFreeze', 'varkusWhirl', 'crowdRoar'] as const) {
      expect(SFX[id].bank, id).toBeUndefined();
    }
    // Memory bound: every banked recipe is short, and the whole bank stays small.
    const ctx = new FakeAudioContext();
    const res = dspResources(asCtx(ctx));
    const out = ctx.createGain() as unknown as AudioNode;
    let bytes = 0;
    for (const id of BANKED_IDS) {
      const spec = SFX[id].bank!;
      const v = new VoiceBuilder(asCtx(ctx), res, 0, { out, wet: () => out, echo: () => out }, 1, new Rand(1), 0);
      SFX[id].build(v);
      expect(v.end, `${id} length`).toBeLessThan(0.6);
      bytes += v.end * 48000 * 2 * 4 * spec.variants * (spec.steps ?? 1);
    }
    // Worst case (all stereo); mono recipes store half. The wave-5 additions are all mono, so
    // they cost ~1.2 MB of real memory; the bound grew with the roster (12 → 14 MB).
    expect(bytes).toBeLessThan(14 * 1024 * 1024);
  });

  it('renders every id in one offline pass into seeded variants (per combo step)', async () => {
    FakeOfflineAudioContext.renders = 0;
    const bank = new SampleBank(48000, 7, Offline);
    await bank.prepare(() => Promise.resolve());
    const st = bank.stats();
    expect(st.ready).toBe(BANKED_IDS.length);
    expect(st.failed).toBe(0);
    expect(FakeOfflineAudioContext.renders).toBe(BANKED_IDS.length); // the length probe never renders
    const expected = BANKED_IDS.reduce((n, id) => n + SFX[id].bank!.variants * (SFX[id].bank!.steps ?? 1), 0);
    expect(st.variants).toBe(expected);
    const rand = new Rand(3);
    for (const id of BANKED_IDS) {
      const v = bank.pick(id, 0, rand)!;
      expect(v, id).not.toBeNull();
      expect(v.duration).toBeGreaterThan(0.02);
      expect(v.dry.numberOfChannels).toBe(1); // the fake renders silence, which is L = R
      expect(v.dry.length).toBe(Math.round(v.duration * 48000));
    }
    // Ladders: each combo step has its own variants.
    const low = bank.pick('mote', 0, rand)!;
    const high = bank.pick('mote', 9, rand)!;
    expect(low).not.toBe(high);
    expect(bank.pick('mote', 25, rand)).not.toBeNull(); // past the top it ping-pongs, never out of range
  });

  it('never plays the same variant twice in a row, and returns null for unbanked ids', async () => {
    const bank = new SampleBank(48000, 7, Offline);
    await bank.render('hitFire');
    const rand = new Rand(11);
    let last = bank.pick('hitFire', 0, rand);
    const seen = new Set([last]);
    for (let i = 0; i < 200; i++) {
      const v = bank.pick('hitFire', 0, rand);
      expect(v).not.toBe(last);
      seen.add(v);
      last = v;
    }
    expect(seen.size).toBe(SFX.hitFire.bank!.variants);
    expect(bank.pick('dropUnique', 0, rand)).toBeNull();
    expect(bank.pick('hitCold', 0, rand)).toBeNull(); // not rendered yet
  });

  it('is inert without OfflineAudioContext', async () => {
    const bank = new SampleBank(48000, 7, null);
    await bank.prepare();
    expect(bank.stats().ready).toBe(0);
  });
});
