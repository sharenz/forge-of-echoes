import { describe, expect, it } from 'vitest';
import { SCARAB_IDS, UNIQUE_IDS } from '../../src/contracts/content';
import { rules, withItemLocks } from '../../src/game';
import { DEBUG_MERCHANT_DEFAULTS, debugMerchantOffers } from '../../src/game/progression/debug-merchant';
import { bareCharacter, currency, expectOk, withBackpack } from './fixtures';

const options = { ...DEBUG_MERCHANT_DEFAULTS };
describe('testing merchant purchases', () => {
  it('sells every catalog entry, including all scarab tiers and uniques, with save-safe items', () => {
    const offers = debugMerchantOffers(options);
    for (const id of SCARAB_IDS) expect(offers.some(o => o.id === `currency:${id}`)).toBe(true);
    for (const id of UNIQUE_IDS) expect(offers.some(o => o.id === `unique:${id}`)).toBe(true);
    for (const offer of offers) {
      const result = expectOk(rules.buyDebugOffer(bareCharacter(), offer.id, options));
      const saved = rules.parseSave(rules.serializeSave({ ...rules.newSave(), characters: [result.character] })).characters[0];
      expect(saved.backpack).toEqual(result.character.backpack);
    }
  });

  it('splits quantities at real stack limits, uses unique IDs, and charges no currency', () => {
    const ch = withBackpack(bareCharacter(), [[currency('scrap', 3, 'money'), 0, 0]]);
    const out = expectOk(rules.buyDebugOffer(ch, 'currency:hasteScarab4', { ...options, quantity: 100 })).character;
    const scarabs = out.backpack.entries.map(e => e.item).filter(i => i.kind === 'currency' && i.currencyId === 'hasteScarab4');
    expect(scarabs).toHaveLength(5);
    expect(scarabs.every(i => i.kind === 'currency' && i.count === 20)).toBe(true);
    expect(new Set(scarabs.map(i => i.uid)).size).toBe(5);
    expect(rules.findItem(out, 'money')?.item).toMatchObject({ count: 3 });
    expect(ch.backpack.entries).toHaveLength(1);
    const locked = withItemLocks(rules, () => new Set(['money']));
    const bought = expectOk(locked.buyDebugOffer(ch, 'currency:scrap', options)).character;
    expect(rules.findItem(bought, 'money')?.item).toEqual(ch.backpack.entries[0].item);
  });

  it('generates the chosen map tier, equipment level and rarity; refuses an oversized batch atomically', () => {
    const ch = bareCharacter();
    const map = expectOk(rules.buyDebugOffer(ch, 'map:ashenForge', { ...options, mapTier: 15, rarity: 'rare' })).character.backpack.entries[0].item;
    expect(map).toMatchObject({ kind: 'map', tier: 15, rarity: 'rare' });
    expect(map.kind === 'map' && map.mods.length).toBeGreaterThan(0);
    const item = expectOk(rules.buyDebugOffer(ch, 'base:ashwoodWand', { ...options, itemLevel: 46, rarity: 'rare' })).character.backpack.entries[0].item;
    expect(item).toMatchObject({ kind: 'equipment', itemLevel: 46, rarity: 'rare' });
    const before = JSON.stringify(ch);
    expect(rules.buyDebugOffer(ch, 'base:ashwoodWand', { ...options, quantity: 100 }).ok).toBe(false);
    expect(JSON.stringify(ch)).toBe(before);
    for (const invalid of [{ quantity: 101 }, { quantity: 1.5 }, { itemLevel: 0 }, { mapTier: 16 }])
      expect(rules.buyDebugOffer(ch, 'currency:scrap', { ...options, ...invalid }).ok).toBe(false);
    expect(rules.buyDebugOffer(ch, 'not-an-offer', options).ok).toBe(false);
  });
});
