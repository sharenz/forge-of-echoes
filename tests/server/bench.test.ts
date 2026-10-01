// The Crafting Bench over the wire (in-process): benchCraft / benchClear in any hideout, refused elsewhere,
// the rules' limits passed through, and equipped items refreshed into the sim.
import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterSave } from '../../src/contracts/items';
import { rules } from '../../src/game';
import { LocalPlayer, createClock, createLocalCharacter, openMap, partyUp, startTestServer, tick, walkIntoProp } from './helpers';

type Server = Awaited<ReturnType<typeof startTestServer>>;

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function setup(names: string[]) {
  const clock = createClock();
  server = await startTestServer({ game: { autoTick: false, now: clock.now } });
  const players = names.map((n) => new LocalPlayer(server!, createLocalCharacter(server!, n)));
  return { server, clock, players };
}

function scrapCount(ch: CharacterSave): number {
  let n = 0;
  for (const e of ch.backpack.entries) if (e.item.kind === 'currency' && e.item.currencyId === 'scrap') n += e.item.count;
  return n;
}

describe('crafting bench', () => {
  it('adds a chosen crafted affix to an equipped item (the sim follows), refuses a second one, and clears it for free', async () => {
    const { clock, players } = await setup(['Smith Sera']);
    const [p] = players;
    const robe = p.session.record.ch.equipment.chest!;
    const recipe = rules.benchRecipes(p.session.record.ch, robe.uid).find((r) => r.id === 'bench:focus');
    expect(recipe?.available).toBe(true);
    const focusBefore = p.me()!.maxFocus;
    const scrapBefore = scrapCount(p.session.record.ch);

    const r = p.command({ c: 'benchCraft', targetUid: robe.uid, recipeId: 'bench:focus' });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Bench: added/);
    const crafted = p.session.record.ch.equipment.chest!;
    expect(crafted.rarity).toBe('magic');
    expect(crafted.affixes.filter((a) => a.crafted)).toHaveLength(1);
    expect(crafted.stability).toBe(robe.stability - recipe!.stabilityCost);
    expect(scrapCount(p.session.record.ch)).toBe(scrapBefore - recipe!.cost.find((c) => c.currencyId === 'scrap')!.count);
    tick(p.server, clock);
    expect(p.me()!.maxFocus).toBeGreaterThan(focusBefore);
    // The pushed character carries it (redacted as always).
    expect(p.last('character')!.character.equipment.chest!.affixes.some((a) => a.crafted)).toBe(true);

    // One bench affix per item.
    const second = p.command({ c: 'benchCraft', targetUid: robe.uid, recipeId: 'bench:strength' });
    expect(second.ok).toBe(false);
    expect(second.error).toBeTruthy();

    // Clearing is free and gives the focus back to the sim.
    const scrapAfterCraft = scrapCount(p.session.record.ch);
    const cleared = p.command({ c: 'benchClear', targetUid: robe.uid });
    expect(cleared.ok).toBe(true);
    expect(p.session.record.ch.equipment.chest!.affixes.some((a) => a.crafted)).toBe(false);
    expect(scrapCount(p.session.record.ch)).toBe(scrapAfterCraft);
    tick(p.server, clock);
    expect(p.me()!.maxFocus).toBe(focusBefore);
    expect(p.command({ c: 'benchClear', targetUid: robe.uid }).ok).toBe(false);
  });

  it('works in a party member\'s hideout, not in a map; unknown items and recipes are refused', async () => {
    const { clock, players } = await setup(['Host Hana', 'Guest Gale']);
    const [host, guest] = players;
    partyUp(host, guest);
    expect(guest.command({ c: 'visitHideout', characterId: host.characterId }).ok).toBe(true);
    const robe = guest.session.record.ch.equipment.chest!.uid;
    expect(guest.command({ c: 'benchCraft', targetUid: robe, recipeId: 'bench:intelligence' }).ok).toBe(true);
    expect(guest.command({ c: 'benchCraft', targetUid: 'i999', recipeId: 'bench:focus' }).error).toMatch(/no longer exists/);
    const wand = guest.session.record.ch.equipment.mainHand!.uid;
    expect(guest.command({ c: 'benchCraft', targetUid: wand, recipeId: 'bench:nope' }).ok).toBe(false);

    openMap(host);
    walkIntoProp(host, 'portal', clock, [guest]);
    const before = host.session.record.ch;
    const hostRobe = before.equipment.chest!.uid;
    expect(host.command({ c: 'benchCraft', targetUid: hostRobe, recipeId: 'bench:focus' }).error).toBe('The crafting bench is in the hideout.');
    expect(host.command({ c: 'benchClear', targetUid: hostRobe }).error).toBe('The crafting bench is in the hideout.');
    expect(host.session.record.ch).toBe(before);
  });
});


it('repairs Finished gear with a current price, rejects stale quotes and exposes persisted lifetime counters', async () => {
  const { server, players } = await setup(['Repair Ren']);
  const [p] = players;
  const robe = { ...p.session.record.ch.equipment.chest!, stability: 0 };
  server.game.setCharacter(p.session, { ...p.session.record.ch, equipment: { ...p.session.record.ch.equipment, chest: robe },
    currencyStash: { scrap: 200 } });
  const price = rules.benchServices(p.session.record.ch, robe.uid)[0].cost[0].count;
  const cmd = { c: 'benchCraft' as const, targetUid: robe.uid, recipeId: 'bench:repair' };
  expect(p.command(cmd).error).toContain('price');
  const before = p.session.record.ch;
  expect(p.command({ ...cmd, expectedScrap: price - 1 }).ok).toBe(false);
  expect(p.session.record.ch).toBe(before);
  expect(p.command({ ...cmd, expectedScrap: price }).ok).toBe(true);
  const repaired = p.session.record.ch.equipment.chest!;
  expect(repaired.stability).toBe(1);
  expect(repaired.repairCount).toBe(1);
  expect(repaired.craftCount).toBeGreaterThan(0);
  expect(p.command({ ...cmd, expectedScrap: price }).error).toContain('price');
  expect(p.session.record.ch.equipment.chest).toEqual(repaired);
  server.game.store.flushAll();
  const saved = JSON.parse(server.db.characterById(p.characterId)!.data).equipment.chest;
  expect(saved).toEqual(repaired);
});
