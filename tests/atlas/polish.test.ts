// Slice F1 "Polish" (brief D 13, 7.6; brief A 5.4, 5.5): the Atlas sounds, the discovery / pin / surge banners, Calm following the
// game's screen-shake setting, and the territory telemetry counts.
import { describe, expect, it } from 'vitest';
import { SFX_IDS } from '../../src/contracts/audio';
import type { CharacterSave } from '../../src/contracts/items';
import { SFX } from '../../src/audio/sfx';
import { activationSounds, newlyDiscovered, pinBanner } from '../../src/client/atlas-feedback';
import { rules } from '../../src/game';
import { surgeNotice } from '../../src/game/progression/surge';
import { TerritoryCounts } from '../../src/server/territory-counts';
import { isCalm } from '../../src/ui/atlas/motion';
import { bareCharacter, expectOk, map } from '../game-progression/fixtures';

const NOON = Date.parse('2026-10-01T12:00:00Z');
const withAtlas = (discovered: string[], over: Partial<CharacterSave> = {}): CharacterSave =>
  bareCharacter({ atlas: { discovered: discovered as never, completed: [], clears: 0 }, ...over });

describe('Atlas sounds (A 5.5)', () => {
  it('are appended to the frozen id list with recipes in their groups; the frequent ones are banked', () => {
    const ids = ['atlasOpen', 'atlasHover', 'atlasSelect', 'atlasRoute', 'atlasReveal', 'atlasSeal', 'atlasZoom', 'atlasPin', 'atlasUnpin', 'surgeSpend', 'surgeRefill'] as const;
    // Appended as one block (later appends, such as the SK2 skill cues, follow it).
    const at = SFX_IDS.indexOf('atlasOpen');
    expect(SFX_IDS.slice(at, at + ids.length)).toEqual([...ids]);
    expect(SFX.atlasRoute.group).toBe('flow');
    expect(SFX.atlasReveal.group).toBe('flow');
    expect(SFX.atlasReveal.fixedPitch).toBe(true);
    expect(SFX.atlasReveal.impact).toBeGreaterThan(0);
    for (const id of ['atlasOpen', 'atlasSelect', 'atlasSeal', 'atlasZoom', 'atlasHover'] as const) expect(SFX[id].group).toBe('ui');
    expect(SFX.atlasHover.bank).toBeDefined();
    expect(SFX.atlasZoom.bank).toBeDefined();
  });
});

describe('banners and feedback', () => {
  it('hears a discovery only when the same character gains ground', () => {
    const before = withAtlas(['cinderCrossing']);
    const after = withAtlas(['cinderCrossing', 'emberRoad']);
    expect(newlyDiscovered(before, after)).toEqual(['emberRoad']);
    expect(newlyDiscovered(null, after)).toEqual([]);
    expect(newlyDiscovered(after, after)).toEqual([]);
    expect(newlyDiscovered({ ...before, id: 'someone-else' }, after)).toEqual([]);
  });

  it('says what a pin does and how many pins are in use; unpinning says nothing', () => {
    const ch = withAtlas(['cinderCrossing', 'emberRoad']);
    const pinned = { ...ch, atlas: { ...ch.atlas!, pins: ['emberRoad' as never] } };
    expect(pinBanner(pinned, 'emberRoad', true)).toBe('Pinned Ember Road: its maps drop x3 as often (1 of 3 pins).');
    expect(pinBanner(ch, 'emberRoad', false)).toBeNull();
  });

  it('plays the seal for a key passage and the surge swell for a surged opening', () => {
    expect(activationSounds(null)).toEqual([]);
    expect(activationSounds({})).toEqual([]);
    expect(activationSounds({ passage: { kind: 'key', currencyId: 'ossuaryKey' as never }, surge: { areaId: 'cinderCrossing', quantityMore: 30, rarityMore: 15, day: 1 } }))
      .toEqual(['atlasSeal', 'surgeSpend']);
    expect(activationSounds({ passage: { kind: 'bounty' } })).toEqual([]);
  });

  it('banners the surge with the opening: the bonus and what is left of the day (D 7.6)', () => {
    const ch = bareCharacter({ mapDevice: map('furnaceYard', 5), currencyStash: { scrap: 99 } });
    const opened = expectOk(rules.openMap(ch, { useSurge: true, now: NOON }));
    expect(opened.notices?.[0]).toBe('Surge: +30% item quantity, +15% item rarity. 2 of 3 charges left in Furnace Yard today.');
    const plain = expectOk(rules.openMap(ch, { useSurge: false, now: NOON }));
    expect(plain.notices ?? []).toEqual([]);
    const kept = surgeNotice({ areaId: 'furnaceYard', quantityMore: 30, rarityMore: 15, day: 0, kept: true }, ch.atlas, NOON);
    expect(kept).toContain('Afterglow kept the charge: 3 of 3 left');
  });
});

describe('Calm (A 5.4)', () => {
  it('follows the game screen shake at 0 on "system", never over an explicit choice', () => {
    expect(isCalm('auto', false, true)).toBe(true);
    expect(isCalm('auto', false, false)).toBe(false);
    expect(isCalm('full', true, true)).toBe(false);
    expect(isCalm('calm', false, false)).toBe(true);
  });
});

describe('territory telemetry counts', () => {
  it('counts in memory, drains the non-zero counts in a fixed order and resets', () => {
    const c = new TerritoryCounts();
    expect(c.drain()).toBeUndefined();
    c.add('surgeSpent');
    c.add('revealed', 2);
    c.add('pinned', 0);
    c.add('revealed', 1);
    expect(c.drain()).toEqual({ revealed: 3, surgeSpent: 1 });
    expect(c.drain()).toBeUndefined();
  });
});
