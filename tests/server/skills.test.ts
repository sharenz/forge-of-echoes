// Skill commands on the server (power rework R2): augments, refunds paid in Scrap, respec and loadout presets. Everything is
// validated by the shared rules; a refund's price must match what the client was shown, and Scrap, points and skills change in
// one character commit.
import { afterEach, describe, expect, it } from 'vitest';
import { RESPEC } from '../../src/data/progression';
import { currencyOnHand } from '../../src/game/progression/merchant';
import { LocalPlayer, createClock, createLocalCharacter, savedCharacter, startTestServer } from './helpers';

type Server = Awaited<ReturnType<typeof startTestServer>>;

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function player(name: string): Promise<LocalPlayer> {
  const clock = createClock();
  server = await startTestServer({ game: { autoTick: false, now: clock.now } });
  return new LocalPlayer(server, createLocalCharacter(server, name));
}

/** A level-30 character with Ember Nova at rank 6, 10 unspent points and exactly `scrap` Scrap (all in the Crafting Stash). */
function veteran(p: LocalPlayer, scrap = 40, freeUsed = RESPEC.freePoints): void {
  const ch = p.session.record.ch;
  const backpack = { ...ch.backpack, entries: ch.backpack.entries.filter((e) => !(e.item.kind === 'currency' && e.item.currencyId === 'scrap')) };
  server!.game.setCharacter(p.session, {
    ...ch, backpack, level: 30, unspentSkillPoints: 10, skillRanks: { ...ch.skillRanks, emberNova: 6 },
    loadout: ['emberLance', 'emberNova', null, null, null, null, null, null], currencyStash: { ...ch.currencyStash, scrap }, respecFreeUsed: freeUsed,
  });
}

describe('skill commands', () => {
  it('picks an augment through the rules and refuses an invalid one', async () => {
    const p = await player('Augmenter');
    veteran(p);
    expect(p.command({ c: 'pickAugment', skillId: 'emberNova', augmentId: 'echoingRing' }).ok).toBe(true);
    expect(p.session.record.ch.augments?.emberNova).toEqual(['echoingRing']);
    expect(p.session.record.ch.unspentSkillPoints).toBe(9);
    const bad = p.command({ c: 'pickAugment', skillId: 'emberNova', augmentId: 'tripleRing' });
    expect(bad).toMatchObject({ ok: false });
    expect(bad.error).toMatch(/later update/);
    expect(p.command({ c: 'pickAugment', skillId: 'emberNova', augmentId: 'nope' }).ok).toBe(false);
  });

  it('refunds an augment for Scrap only at the price the client saw, atomically', async () => {
    const p = await player('Refunder');
    veteran(p, 6);
    expect(p.command({ c: 'pickAugment', skillId: 'emberNova', augmentId: 'widerRing' }).ok).toBe(true);
    const before = p.session.record.ch;
    const stale = p.command({ c: 'refundAugment', skillId: 'emberNova', augmentId: 'widerRing', expectedScrap: 0 });
    expect(stale.ok).toBe(false);
    expect(stale.error).toMatch(/costs 4 Forge Scrap/);
    expect(p.session.record.ch).toBe(before);
    expect(p.command({ c: 'refundAugment', skillId: 'emberNova', augmentId: 'widerRing', expectedScrap: 4 }).ok).toBe(true);
    const ch = p.session.record.ch;
    expect(ch.augments?.emberNova).toBeUndefined();
    expect(ch.unspentSkillPoints).toBe(10);
    expect(currencyOnHand(ch, 'scrap')).toBe(2);
    // Written through at once: the stored character and account stash agree.
    const saved = savedCharacter(server!, p.characterId);
    expect(saved.augments?.emberNova).toBeUndefined();
    expect(saved.currencyStash.scrap).toBe(2);
    // Not enough Scrap: nothing changes.
    expect(p.command({ c: 'pickAugment', skillId: 'emberNova', augmentId: 'widerRing' }).ok).toBe(true);
    const poor = p.command({ c: 'refundAugment', skillId: 'emberNova', augmentId: 'widerRing', expectedScrap: 4 });
    expect(poor).toMatchObject({ ok: false });
    expect(p.session.record.ch.augments?.emberNova).toEqual(['widerRing']);
  });

  it('respecs one skill for Scrap, and everything with a free token', async () => {
    const p = await player('Respecer');
    veteran(p, 100);
    const price = 6 * RESPEC.scrapPerPoint;
    expect(p.command({ c: 'respec', skillId: 'emberNova', token: false, expectedScrap: price }).ok).toBe(true);
    expect(p.session.record.ch.skillRanks.emberNova).toBe(0);
    expect(p.session.record.ch.loadout[1]).toBeNull();
    expect(p.session.record.ch.currencyStash.scrap).toBe(100 - price);
    expect(p.command({ c: 'respec', skillId: null, token: true, expectedScrap: 0 }).error).toMatch(/no free respec|nothing to refund/);
    server!.game.setCharacter(p.session, { ...p.session.record.ch, respecTokens: 1, allocated: { str: 2, dex: 0, int: 0 } });
    expect(p.command({ c: 'respec', skillId: null, token: true, expectedScrap: 0 }).ok).toBe(true);
    expect(p.session.record.ch).toMatchObject({ respecTokens: 0, allocated: { str: 0, dex: 0, int: 0 } });
  });

  it('saves, renames and loads loadout presets in the hideout', async () => {
    const p = await player('Presetter');
    veteran(p);
    expect(p.command({ c: 'setPreset', preset: 0, op: 'save' }).ok).toBe(true);
    expect(p.command({ c: 'setPreset', preset: 0, op: 'rename', name: 'Boss' }).ok).toBe(true);
    expect(p.command({ c: 'setLoadoutSlot', slot: 1, skillId: null }).ok).toBe(true);
    expect(p.command({ c: 'setPreset', preset: 0, op: 'load' }).ok).toBe(true);
    expect(p.session.record.ch.loadout.slice(0, 2)).toEqual(['emberLance', 'emberNova']);
    expect(p.session.record.ch.loadoutPresets?.[0].name).toBe('Boss');
  });
});
