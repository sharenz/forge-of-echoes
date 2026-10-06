// Skills panel v2 helpers (src/ui/lib/skilltree.ts, src/ui/lib/loadout.ts): the skill book, the augment graph (checked
// against the rules' own canPickAugment for every shipped skill, rank and augment), number deltas, refund wording and the
// loadout/preset helpers. The panel itself is driven end to end by `node scripts/e2e.mjs --only skills` (keyboard-only flow,
// 1280x720 and 1024x600).
import { describe, expect, it } from 'vitest';
import type { SkillId } from '../../src/contracts/content';
import type { SkillInfo } from '../../src/contracts/game';
import type { CharacterSave, LoadoutPreset } from '../../src/contracts/items';
import { LOADOUT_SLOTS } from '../../src/contracts/items';
import { AUGMENT_RULES, RESPEC } from '../../src/data/progression';
import { rules } from '../../src/game';
import { firstFreeSlot, matchingPreset, presetEmpty } from '../../src/ui/lib/loadout';
import {
  ELEMENT_ORDER,
  augmentGraph,
  augmentSlotsAt,
  matchesSkill,
  refundSummary,
  sheetDeltas,
  skillBook,
  stepBook,
  withAugment,
  withoutAugment,
} from '../../src/ui/lib/skilltree';

const skills = Object.values(rules.content.skills) as SkillInfo[];

function character(level: number, patch: Partial<CharacterSave> = {}): CharacterSave {
  const ch = rules.createCharacter('Tester', 7);
  return { ...ch, level, unspentSkillPoints: rules.skillPointsTotal(level), ...patch };
}

describe('skill book', () => {
  it('groups playable skills by element in the book order and hides the unshipped ones (counted as coming)', () => {
    const ch = character(10);
    const book = skillBook(skills, ch);
    const unavailable = skills.filter((s) => !s.available);
    expect(book.coming).toBe(unavailable.length);
    const listed = book.groups.flatMap((g) => g.entries.map((e) => e.id));
    expect(listed.sort()).toEqual(skills.filter((s) => s.available).map((s) => s.id).sort());
    const order = book.groups.map((g) => ELEMENT_ORDER.indexOf(g.element));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const g of book.groups) {
      const levels = g.entries.map((e) => e.unlockLevel);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
    }
    expect(book.order).toEqual(book.groups.flatMap((g) => g.entries.map((e) => e.id)));
  });

  it('marks learned, learnable and locked skills (locked ones carry their unlock level)', () => {
    const ch = character(3, { skillRanks: { emberLance: 1, emberNova: 2 } as CharacterSave['skillRanks'], loadout: ['emberLance', 'emberNova'], augments: { emberNova: ['widerRing'] } });
    const entries = skillBook(skills, ch).groups.flatMap((g) => g.entries);
    const by = (id: SkillId) => entries.find((e) => e.id === id)!;
    expect(by('emberNova')).toMatchObject({ state: 'learned', rank: 2, slot: 1, augments: 1 });
    expect(by('rimeShards').state).toBe('learnable'); // unlock level 3
    const wave = by('flameWave');
    expect(wave.state).toBe('locked');
    expect(wave.unlockLevel).toBe(rules.content.skills.flameWave.unlockLevel);
  });

  it('shows a new skill as soon as its data turns available (no hard-coded list)', () => {
    const flipped = skills.map((s) => (s.id === 'phaseStride' ? { ...s, available: true } : s));
    const ch = character(10);
    const before = skillBook(skills, ch);
    const after = skillBook(flipped, ch);
    expect(before.order).not.toContain('phaseStride');
    expect(after.order).toContain('phaseStride');
    expect(after.coming).toBe(before.coming - 1);
  });

  it('searches names, tags and elements; every word must match', () => {
    const nova = rules.content.skills.emberNova;
    expect(matchesSkill(nova, 'nova')).toBe(true);
    expect(matchesSkill(nova, 'FIRE ember')).toBe(true);
    expect(matchesSkill(nova, 'cold')).toBe(false);
    const book = skillBook(skills, character(30), 'rime');
    expect(book.order).toEqual(['rimeShards']);
  });

  it('steps through the flat order with wrap-around (arrow keys)', () => {
    const order = ['emberLance', 'emberNova', 'rimeShards'] as SkillId[];
    expect(stepBook(order, 'emberLance', 1)).toBe('emberNova');
    expect(stepBook(order, 'rimeShards', 1)).toBe('emberLance');
    expect(stepBook(order, 'emberLance', -1)).toBe('rimeShards');
    expect(stepBook(order, null, 1)).toBe('emberLance');
    expect(stepBook([], null, 1)).toBeNull();
  });
});

describe('augment graph', () => {
  it('slots are floor(rank / 2), at most 5; tiers open at ranks 2, 5 and 8; T3 costs 2', () => {
    expect([0, 1, 2, 3, 4, 9, 10, 14].map(augmentSlotsAt)).toEqual([0, 0, 1, 1, 2, 4, 5, 5]);
    const nova = rules.content.skills.emberNova;
    const g = augmentGraph(nova, 5, [], 10);
    expect(g.tiers.map((t) => [t.tier, t.rankRequired, t.unlocked])).toEqual([
      [1, AUGMENT_RULES.tierRank[1], true],
      [2, AUGMENT_RULES.tierRank[2], true],
      [3, AUGMENT_RULES.tierRank[3], false],
    ]);
    for (const n of g.tiers.find((t) => t.tier === 3)!.nodes) expect(n.info.cost).toBe(2);
    expect(g.slots).toBe(2);
    expect(g.nextSlotRank).toBe(6);
    expect(augmentGraph(nova, 10, [], 10).nextSlotRank).toBeNull();
  });

  it('names the picked augment that excludes another, both ways', () => {
    const nova = rules.content.skills.emberNova;
    const g = augmentGraph(nova, 6, ['widerRing'], 10);
    const fan = g.tiers.flatMap((t) => t.nodes).find((n) => n.info.id === 'emberFan')!;
    expect(fan.state).toBe('excluded');
    expect(fan.excludedBy).toBe('Wider Ring');
    const g2 = augmentGraph(nova, 6, ['emberFan'], 10);
    expect(g2.tiers.flatMap((t) => t.nodes).find((n) => n.info.id === 'widerRing')!.excludedBy).toBe('Ember Fan');
    expect(fan.excludes).toContain('Wider Ring');
  });

  it('agrees with rules.canPickAugment for every shipped skill, rank, picked set and point count', () => {
    let checked = 0;
    for (const info of skills.filter((s) => s.available && s.augments.length)) {
      const live = info.augments.filter((a) => a.available).map((a) => a.id);
      const pickedSets: string[][] = [[], live.slice(0, 1), live.slice(0, 2)];
      for (const rank of [1, 2, 4, 5, 8, 10]) {
        for (const picked of pickedSets) {
          for (const points of [0, 1, 3]) {
            const ch = character(60, {
              skillRanks: { ...rules.createCharacter('x', 1).skillRanks, [info.id]: rank },
              augments: picked.length ? { [info.id]: picked } : {},
              unspentSkillPoints: points,
            });
            const g = augmentGraph(info, rank, picked, points);
            for (const node of g.tiers.flatMap((t) => t.nodes)) {
              if (node.state === 'picked') continue;
              const can = rules.canPickAugment(ch, info.id, node.info.id);
              expect(node.state === 'open', `${info.id}/${node.info.id} r${rank} picked=${picked} pts=${points}: ${node.state} vs ${can.reason}`).toBe(can.ok);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('previews an augment added or removed without touching the original', () => {
    const ch = character(20, { augments: { emberNova: ['widerRing'] } });
    const added = withAugment(ch, 'emberNova', 'echoingRing');
    expect(added.augments?.emberNova).toEqual(['widerRing', 'echoingRing']);
    expect(ch.augments?.emberNova).toEqual(['widerRing']);
    expect(withoutAugment(added, 'emberNova', 'widerRing').augments?.emberNova).toEqual(['echoingRing']);
    expect(withAugment(ch, 'emberNova', 'widerRing')).toBe(ch);
  });
});

describe('number deltas', () => {
  it('a rank up shows the numbers that grow, in green', () => {
    const ch = character(20, { skillRanks: { ...rules.createCharacter('x', 1).skillRanks, emberNova: 4 } });
    const now = rules.skillSheet(ch, 'emberNova');
    const next = rules.skillSheet(ch, 'emberNova', 5);
    const d = sheetDeltas(now, next);
    expect(d.length).toBeGreaterThan(0);
    const dmg = d.find((x) => x.label === 'Damage per hit')!;
    expect(dmg.better).toBe(true);
    expect(Number(dmg.to)).toBeGreaterThan(Number(dmg.from));
  });

  it('lower is better for costs and cooldowns; equal values are left out', () => {
    const base = rules.skillSheet(character(20), 'emberLance');
    const cheaper = { ...base, runtime: { ...base.runtime, focusCost: base.runtime.focusCost + 5, cooldown: 2 } };
    const d = sheetDeltas(cheaper, { ...cheaper, runtime: { ...cheaper.runtime, focusCost: cheaper.runtime.focusCost - 5, cooldown: 1 } });
    expect(d.map((x) => [x.label, x.better])).toEqual([
      ['Focus cost', true],
      ['Cooldown', true],
    ]);
    expect(sheetDeltas(base, base)).toEqual([]);
  });

  it('an augment that changes numbers shows them (Ember Fan: more damage)', () => {
    const ch = character(20, { skillRanks: { ...rules.createCharacter('x', 1).skillRanks, emberNova: 5 } });
    const d = sheetDeltas(rules.skillSheet(ch, 'emberNova'), rules.skillSheet(withAugment(ch, 'emberNova', 'emberFan'), 'emberNova'));
    expect(d.find((x) => x.label === 'Damage per hit')?.better).toBe(true);
  });
});

describe('refund confirmation', () => {
  it('free below level 20', () => {
    const s = refundSummary({ points: 3, freePoints: 3, scrap: 0 }, 12, 0, RESPEC.freeBelowLevel);
    expect(s.confirm).toBe('Refund for free');
    expect(s.lines.join(' ')).toMatch(/below level 20/);
    expect(s.affordable).toBe(true);
  });

  it('names the Scrap price, the free part and what you hold; refuses when short', () => {
    const s = refundSummary({ points: 3, freePoints: 1, scrap: 8 }, 30, 5, RESPEC.freeBelowLevel);
    expect(s.confirm).toBe('Refund for 8 Scrap');
    expect(s.lines.join(' ')).toMatch(/1 skill point of it is free/);
    expect(s.lines.join(' ')).toMatch(/Costs 8 Forge Scrap\. You have 5\./);
    expect(s.affordable).toBe(false);
  });

  it('matches the rules price: the first free points, then 4 Scrap per point', () => {
    const ch = character(30, {
      skillRanks: { ...rules.createCharacter('x', 1).skillRanks, emberNova: 5 },
      augments: { emberNova: ['widerRing'] },
      respecFreeUsed: RESPEC.freePoints,
    });
    const price = rules.respecPrice(ch, { skillId: 'emberNova', augmentId: 'widerRing' });
    expect(price).toEqual({ points: 1, freePoints: 0, scrap: RESPEC.scrapPerPoint });
    expect(refundSummary(price, ch.level, 100, RESPEC.freeBelowLevel).confirm).toBe(`Refund for ${RESPEC.scrapPerPoint} Scrap`);
  });
});

describe('loadout helpers', () => {
  it('Ctrl-click finds the first empty slot, never a second copy', () => {
    const bar: (SkillId | null)[] = ['emberLance', null, 'emberNova', null, null, null, null, null];
    expect(firstFreeSlot(bar, 'rimeShards', LOADOUT_SLOTS)).toBe(1);
    expect(firstFreeSlot(bar, 'emberNova', LOADOUT_SLOTS)).toBe(-1);
    const full = Array.from({ length: LOADOUT_SLOTS }, (_, i) => (i === 0 ? 'emberLance' : 'emberNova')) as SkillId[];
    expect(firstFreeSlot(full, 'rimeShards', LOADOUT_SLOTS)).toBe(-1);
  });

  it('finds the preset that matches the bar; empty presets never match', () => {
    const bar: (SkillId | null)[] = ['emberLance', 'emberNova', null, null, null, null, null, null];
    const presets: LoadoutPreset[] = [
      { name: 'Preset 1', loadout: Array(LOADOUT_SLOTS).fill(null) },
      { name: 'Boss', loadout: [...bar] },
      { name: 'Clear', loadout: ['emberLance', null, 'emberNova', null, null, null, null, null] },
    ];
    expect(presetEmpty(presets[0])).toBe(true);
    expect(matchingPreset(presets, bar, LOADOUT_SLOTS)).toBe(1);
    expect(matchingPreset(presets, Array(LOADOUT_SLOTS).fill(null), LOADOUT_SLOTS)).toBe(-1);
  });
});
