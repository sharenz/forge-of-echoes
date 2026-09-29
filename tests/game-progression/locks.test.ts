// Trade locks (GAME_SPEC §12: items in an open trade stay in the backpack but are locked): the
// withItemLocks wrapper refuses every rule that would move, craft, discard, spend or top up an offered
// item, and pays / places around it instead — so nobody can change an offer after the partner accepted.
import { describe, expect, it } from 'vitest';
import type { GameRulesApi } from '../../src/contracts/game';
import type { CharacterSave, EquipmentItem } from '../../src/contracts/items';
import {
  LOCKED_CHANGE_ERROR, LOCKED_ITEM_ERROR, rules, withItemLocks, withServerEntropy,
} from '../../src/game';
import { bareCharacter, currency, equip, expectErr, expectOk, map, withBackpack } from './fixtures';

const RING = (): EquipmentItem => equip({
  baseId: 'emberRing', itemLevel: 48, rarity: 'magic', uid: 'ring', affixes: [{ affixId: 'life', tier: 4, crafted: true }],
});

/** Offered: the 5 Scrap (smallest stack, paid first without locks), the ring and a map. */
function trader(): CharacterSave {
  return withBackpack(bareCharacter({ level: 30, nextUid: 50 }), [
    [currency('scrap', 5, 'scrap-offered'), 0, 0], [currency('scrap', 30, 'scrap-free'), 1, 0],
    [RING(), 2, 0], [map('ashenForge', 1, { uid: 'map-offered' }), 3, 0],
    [currency('essenceVital', 2, 'vital'), 4, 0], [currency('kindling', 3, 'kindling'), 5, 0],
    [equip({ baseId: 'silkWraps', itemLevel: 30, rarity: 'normal', uid: 'gloves' }), 6, 0],
  ]);
}

const OFFER = new Set(['scrap-offered', 'ring', 'map-offered']);
const locked: GameRulesApi = withItemLocks(rules, (ch) => (ch.id === 'c1' ? OFFER : null));

const offered = (ch: CharacterSave) => [...OFFER].map((uid) => rules.findItem(ch, uid));

describe('withItemLocks', () => {
  it('is the plain rules while nothing is locked', () => {
    const free = withItemLocks(rules, () => null);
    const ch = trader();
    expect(free.moveItem(ch, 'ring', { kind: 'backpack', x: 0, y: 3 })).toEqual(rules.moveItem(ch, 'ring', { kind: 'backpack', x: 0, y: 3 }));
    expect(free.applyBenchRecipe(ch, 'gloves', 'bench:life')).toEqual(rules.applyBenchRecipe(ch, 'gloves', 'bench:life'));
    expect(withItemLocks(rules, () => new Set()).buyOffer(ch, 'flask-life')).toEqual(rules.buyOffer(ch, 'flask-life'));
  });

  it('refuses every command aimed at a locked item', () => {
    const ch = trader();
    expect(expectErr(locked.moveItem(ch, 'ring', { kind: 'backpack', x: 0, y: 3 }))).toBe(LOCKED_ITEM_ERROR);
    expect(expectErr(locked.moveItem(ch, 'ring', { kind: 'equipment', slot: 'ring1' }))).toBe(LOCKED_ITEM_ERROR);
    expect(expectErr(locked.quickMove(ch, 'map-offered', { stashTab: null }))).toBe(LOCKED_ITEM_ERROR);
    expect(expectErr(locked.discardItem(ch, 'scrap-offered'))).toBe(LOCKED_ITEM_ERROR);
    expect(expectErr(locked.applyBenchRecipe(ch, 'ring', 'bench:castSpeed'))).toBe(LOCKED_ITEM_ERROR);
    expect(expectErr(locked.clearCraftedAffix(ch, 'ring'))).toBe(LOCKED_ITEM_ERROR);
    expect(expectErr(locked.applyCurrency(ch, 'kindling', 'ring'))).toBe(LOCKED_ITEM_ERROR);
    expect(expectErr(locked.applyCurrency(ch, 'scrap-offered', 'gloves'))).toBe(LOCKED_ITEM_ERROR);
    expect(locked.craftingTargetError(ch, 'kindling', 'ring')).toBe(LOCKED_ITEM_ERROR);
    expect(locked.craftingTargetError(ch, 'kindling', 'gloves')).toBe(rules.craftingTargetError(ch, 'kindling', 'gloves'));
    const recipes = locked.benchRecipes(ch, 'ring');
    expect(recipes.length).toBeGreaterThan(0);
    expect(recipes.every((r) => !r.available && r.reason === LOCKED_ITEM_ERROR)).toBe(true);
  });

  it('refuses moves that would disturb a locked item on the way (merge into it, swap it out)', () => {
    const ch = trader();
    // Dropping the free Scrap onto the offered stack would merge into it.
    expect(expectErr(locked.moveItem(ch, 'scrap-free', { kind: 'backpack', x: 0, y: 0 }))).toBe(LOCKED_CHANGE_ERROR);
    // Dropping the Kindling onto the ring would swap the ring out of its cell (plain rules: a swap).
    expect(rules.moveItem(ch, 'kindling', { kind: 'backpack', x: 2, y: 0 }).ok).toBe(true);
    expect(expectErr(locked.moveItem(ch, 'kindling', { kind: 'backpack', x: 2, y: 0 }))).toBe(LOCKED_CHANGE_ERROR);
    // Anything else still moves.
    const moved = expectOk(locked.moveItem(ch, 'gloves', { kind: 'backpack', x: 8, y: 2 }));
    expect(offered(moved)).toEqual(offered(ch));
  });

  it('pays Rook and the bench from the unlocked stacks and never tops up a locked one', () => {
    const ch = trader();
    // Without locks, both pay from the 5-Scrap stack first (smallest first).
    expect(rules.findItem(expectOk(rules.buyOffer(ch, 'flask-life')).character, 'scrap-offered')?.item).toMatchObject({ count: 4 });
    const bought = expectOk(locked.buyOffer(ch, 'flask-life')).character;
    expect(offered(bought)).toEqual(offered(ch));
    expect(rules.findItem(bought, 'scrap-free')?.item).toMatchObject({ count: 29 });

    const crafted = expectOk(locked.applyBenchRecipe(ch, 'gloves', 'bench:life')).character;
    expect(offered(crafted)).toEqual(offered(ch));
    expect((rules.findItem(crafted, 'gloves')!.item as EquipmentItem).affixes[0]).toMatchObject({ affixId: 'life', crafted: true });

    // A Scrap pickup opens a new stack instead of topping up the offered one.
    const picked = expectOk(locked.addToBackpack(ch, currency('scrap', 3, 'd-drop')));
    expect(offered(picked)).toEqual(offered(ch));
    expect(rules.findItem(picked, 'scrap-free')?.item).toMatchObject({ count: 33 });
    // (The plain rules would have topped up the offered stack.)
    const unlocked = expectOk(rules.addToBackpack(ch, currency('scrap', 3, 'd-drop')));
    expect(rules.findItem(unlocked, 'scrap-offered')?.item).toMatchObject({ count: 8 });
  });

  it('judges affordability without the locked stacks', () => {
    const poor = withBackpack(bareCharacter({ level: 30 }), [
      [currency('scrap', 20, 'scrap-offered'), 0, 0], [equip({ baseId: 'emberRing', itemLevel: 40, rarity: 'normal', uid: 'plain' }), 2, 0],
    ]);
    const lockPoor = withItemLocks(rules, () => new Set(['scrap-offered']));
    expect(rules.merchantOffers(poor).find((o) => o.id === 'gamble-ring')?.affordable).toBe(true);
    expect(lockPoor.merchantOffers(poor).find((o) => o.id === 'gamble-ring')?.affordable).toBe(false);
    expect(expectErr(lockPoor.buyOffer(poor, 'gamble-ring'))).toBe('You need 6 Forge Scrap (you have 0).');
    const regen = (api: GameRulesApi) => api.benchRecipes(poor, 'plain').find((r) => r.id === 'bench:focusRegen')!;
    expect(regen(rules).available).toBe(true);
    expect(regen(lockPoor).available).toBe(false);
    expect(regen(lockPoor).reason).toMatch(/^Not enough currency in your backpack/);
  });

  it('hands back the real items, never the stand-ins', () => {
    const ch = trader();
    const after = expectOk(locked.buyOffer(ch, 'map-t1-ashenForge')).character;
    for (const uid of OFFER) expect(rules.findItem(after, uid)).toEqual(rules.findItem(ch, uid));
    expect(after.backpack.entries.filter((e) => e.item.kind === 'map')).toHaveLength(2);
  });

  it('composes with withServerEntropy in either order', () => {
    const ch = trader();
    const a = withItemLocks(withServerEntropy(rules, () => 42), (c) => (c.id === 'c1' ? OFFER : null));
    const b = withServerEntropy(withItemLocks(rules, (c) => (c.id === 'c1' ? OFFER : null)), () => 42);
    const ra = expectOk(a.applyBenchRecipe(ch, 'gloves', 'bench:life'));
    const rb = expectOk(b.applyBenchRecipe(ch, 'gloves', 'bench:life'));
    expect(ra).toEqual(rb);
    expect(ra.character.rngState).not.toBe(expectOk(rules.applyBenchRecipe(ch, 'gloves', 'bench:life')).character.rngState);
    expect(expectErr(a.applyBenchRecipe(ch, 'ring', 'bench:castSpeed'))).toBe(LOCKED_ITEM_ERROR);
    expect(expectErr(b.applyBenchRecipe(ch, 'ring', 'bench:castSpeed'))).toBe(LOCKED_ITEM_ERROR);
  });
});
