// Command-facing rules take values straight off the network (src/contracts/net.ts Command). The server
// validates message shapes, but one missed check must never take a room handler down: every rule a
// command reaches returns a Result error (or a harmless value) on garbage — it never throws, never
// returns undefined, and never resolves an id through Object.prototype ("constructor", "__proto__").
import { describe, expect, it } from 'vitest';
import type { Result } from '../../src/contracts/game';
import type { CharacterSave } from '../../src/contracts/items';
import { rules } from '../../src/game';

const HOSTILE: readonly unknown[] = [
  null, undefined, NaN, Infinity, -Infinity, -1, 0.5, 1e308, '', ' ', '__proto__', 'constructor', 'toString', 'hasOwnProperty',
  'valueOf', {}, [], [1], { kind: 'nope' }, { kind: 'backpack' }, { kind: 'backpack', x: '0', y: 0 },
  { kind: 'stash', tab: '__proto__', x: 0, y: 0 }, { kind: 'equipment', slot: '__proto__' }, { kind: 'belt', index: '1' },
  { kind: 'belt', index: NaN }, true, false, 'belt:__proto__', 'belt:-1', 'belt:1e3', 'belt:', 'x'.repeat(10_000),
  Object.create(null), { toString: () => { throw new Error('boom'); } },
];

function kit(): { ch: CharacterSave; currencyUid: string; mapUid: string; sealUid: string; wandUid: string } {
  const ch = { ...rules.createCharacter('Fuzz', 1), unspentAttributePoints: 3, unspentSkillPoints: 3 };
  const find = (pred: (i: CharacterSave['backpack']['entries'][number]['item']) => boolean) => ch.backpack.entries.find((e) => pred(e.item))!.item.uid;
  return {
    ch,
    currencyUid: find((i) => i.kind === 'currency' && i.currencyId === 'scrap'),
    mapUid: find((i) => i.kind === 'map'),
    sealUid: find((i) => i.kind === 'currency' && i.currencyId === 'seal'),
    wandUid: ch.equipment.mainHand!.uid,
  };
}

/** Printable label of a hostile value (some of them cannot be converted to a string). */
function show(x: unknown): string {
  try {
    return typeof x === 'string' ? JSON.stringify(x.length > 20 ? `${x.slice(0, 20)}…` : x) : String(x);
  } catch {
    return Object.prototype.toString.call(x);
  }
}

function isResult(r: unknown): r is Result<unknown> {
  return !!r && typeof r === 'object' && 'ok' in r && typeof (r as { ok: unknown }).ok === 'boolean';
}

describe('command-facing rules on hostile input', () => {
  const { ch, currencyUid, mapUid, sealUid, wandUid } = kit();
  // Each case gets one hostile value `x`; `mustFail` = the call can never succeed with a hostile value.
  const cases: { name: string; call: (x: never) => unknown; mustFail: boolean }[] = [
    { name: 'moveItem(uid)', call: (x) => rules.moveItem(ch, x, { kind: 'backpack', x: 0, y: 4 }), mustFail: true },
    { name: 'moveItem(to)', call: (x) => rules.moveItem(ch, currencyUid, x), mustFail: true },
    { name: 'moveItem(map, to)', call: (x) => rules.moveItem(ch, mapUid, x), mustFail: true },
    { name: 'quickMove(uid)', call: (x) => rules.quickMove(ch, x, { stashTab: null }), mustFail: true },
    { name: 'quickMove(ctx)', call: (x) => rules.quickMove(ch, currencyUid, x), mustFail: false },
    { name: 'quickMove(stashTab)', call: (x) => rules.quickMove(ch, currencyUid, { stashTab: x }), mustFail: false },
    { name: 'discardItem(uid)', call: (x) => rules.discardItem(ch, x), mustFail: true },
    { name: 'applyCurrency(currencyUid)', call: (x) => rules.applyCurrency(ch, x, wandUid), mustFail: true },
    { name: 'applyCurrency(targetUid)', call: (x) => rules.applyCurrency(ch, currencyUid, x), mustFail: true },
    { name: 'applyCurrency(affixIndex)', call: (x) => rules.applyCurrency(ch, sealUid, wandUid, x), mustFail: false },
    { name: 'renameStashTab(tab)', call: (x) => rules.renameStashTab(ch, x, 'Loot'), mustFail: true },
    // Any string is a legal tab name ("constructor" included: it is stored as a value, never a key).
    { name: 'renameStashTab(name)', call: (x) => rules.renameStashTab(ch, 0, x), mustFail: false },
    { name: 'allocateAttribute(attr)', call: (x) => rules.allocateAttribute(ch, x), mustFail: true },
    { name: 'rankUpSkill(skillId)', call: (x) => rules.rankUpSkill(ch, x), mustFail: true },
    { name: 'setLoadoutSlot(slot)', call: (x) => rules.setLoadoutSlot(ch, x, 'emberLance'), mustFail: true },
    { name: 'buyOffer(offerId)', call: (x) => rules.buyOffer(ch, x), mustFail: true },
    { name: 'applyBenchRecipe(targetUid)', call: (x) => rules.applyBenchRecipe(ch, x, 'bench:critChance'), mustFail: true },
    { name: 'applyBenchRecipe(recipeId)', call: (x) => rules.applyBenchRecipe(ch, wandUid, x), mustFail: true },
    { name: 'clearCraftedAffix(targetUid)', call: (x) => rules.clearCraftedAffix(ch, x), mustFail: true },
  ];

  for (const c of cases) {
    it(`${c.name} returns a Result and never throws`, () => {
      for (const x of HOSTILE) {
        let r: unknown;
        expect(() => { r = c.call(x as never); }, `${c.name} with ${show(x)}`).not.toThrow();
        expect(isResult(r), `${c.name} with ${show(x)} returns a Result`).toBe(true);
        if (c.mustFail) expect((r as Result<unknown>).ok, `${c.name} with ${show(x)} fails`).toBe(false);
      }
    });
  }

  it('setLoadoutSlot(skillId) accepts null (clear the slot) and rejects every other hostile value', () => {
    const learned = rules.rankUpSkill(ch, 'emberNova');
    expect(learned.ok).toBe(true);
    for (const x of HOSTILE) {
      let r: Result<CharacterSave> | undefined;
      expect(() => { r = rules.setLoadoutSlot(ch, 1, x as never); }).not.toThrow();
      expect(isResult(r)).toBe(true);
      if (x !== null) expect(r!.ok, show(x)).toBe(false);
    }
  });

  it('renameStashTab rejects every name that is not a string', () => {
    for (const x of HOSTILE) {
      if (typeof x === 'string') continue;
      expect(rules.renameStashTab(ch, 0, x as never)).toEqual({ ok: false, error: 'A stash tab needs a name.' });
    }
  });

  it('never resolves ids through Object.prototype', () => {
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(rules.canRankUpSkill(ch, id as never)).toEqual({ ok: false, reason: 'Unknown skill.' });
      const ranked = rules.rankUpSkill(ch, id as never);
      expect(ranked.ok).toBe(false);
      expect(rules.allocateAttribute(ch, id as never).ok).toBe(false);
    }
  });

  it('display queries return nothing or an explanation instead of throwing', () => {
    for (const x of HOSTILE) {
      expect(() => rules.findItem(ch, x as never)).not.toThrow();
      expect(rules.findItem(ch, x as never)).toBeNull();
      expect(() => rules.craftingTargetError(ch, x as never, x as never)).not.toThrow();
      expect(typeof rules.craftingTargetError(ch, x as never, wandUid)).toBe('string');
      expect(() => rules.craftPreview(ch, x as never, x as never)).not.toThrow();
      expect(() => rules.consumeFlask(ch, x as never)).not.toThrow();
      expect(rules.consumeFlask(ch, x as never)).toBe(ch);
      expect(() => rules.grantXp(ch, x as never)).not.toThrow();
      expect(rules.benchRecipes(ch, x as never)).toEqual([]);
    }
  });

  it('a valid command still works after the guards', () => {
    expect(rules.moveItem(ch, currencyUid, { kind: 'backpack', x: 11, y: 4 }).ok).toBe(true);
    expect(rules.quickMove(ch, currencyUid, { stashTab: 0 }).ok).toBe(true);
    expect(rules.renameStashTab(ch, 0, '  Loot \u0007 Tab ')).toMatchObject({ ok: true });
    const renamed = rules.renameStashTab(ch, 0, '  Loot \u0007 Tab ');
    expect(renamed.ok && renamed.value.stash[0].name).toBe('Loot Tab');
    // The starting wand (magic, one prefix) takes a crafted suffix; the kit's 10 Scrap pay for it.
    const benched = rules.applyBenchRecipe(ch, wandUid, 'bench:critChance');
    expect(benched.ok).toBe(true);
    expect(benched.ok && rules.clearCraftedAffix(benched.value.character, wandUid).ok).toBe(true);
  });
});
