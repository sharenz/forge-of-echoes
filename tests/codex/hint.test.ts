import { describe, expect, it } from 'vitest';
import { rules } from '../../src/game';
import { rollMapWithRarity } from '../../src/game/progression';
import { createRng } from '../../src/core/rng';
import { mapHint, withNodes } from '../../src/ui/codex/hint';
import type { CharacterSave } from '../../src/contracts/items';

const base = rules.createCharacter('Hint', 7);
const ch = { ...base, atlas: { discovered: ['cinderCrossing'], completed: ['cinderCrossing', 'emberRoad'], clears: 2, nodes: [] } } as CharacterSave;
const map = rollMapWithRarity(createRng(5), 'ashenForge', 4, 'rare', 'hint-map', 5, false);

describe('Codex map hint', () => {
  it('diffs the map summary with and without a node', () => {
    const h = mapHint(rules, ch, map, ['scavenger'], true, 'scavenger');
    expect(h.note).toBeUndefined();
    const q = h.lines.find(l => l.label === 'Map Item Quantity')!;
    expect(q).toBeTruthy();
    expect(q.from).not.toBe(q.to);
    expect(q.to).toMatch(/^\+\d+%$/);
  });
  it('shows the loss when a node is refunded', () => {
    const on = withNodes(ch, ['scavenger'], true);
    const h = mapHint(rules, on, map, ['scavenger'], false, 'scavenger');
    const q = h.lines.find(l => l.label === 'Map Item Quantity')!;
    expect(parseInt(q.to.replace(/\D/g, ''))).toBeLessThan(parseInt(q.from.replace(/\D/g, '')));
  });
  it('prices a whole path, not just the target', () => {
    const one = mapHint(rules, ch, map, ['scavenger'], true, 'scavenger').lines.find(l => l.label === 'Map Item Quantity')!;
    const path = mapHint(rules, ch, map, ['scavenger', 'gemEyed'], true, 'gemEyed').lines.find(l => l.label === 'Map Item Quantity')!;
    expect(parseInt(path.to.replace(/\D/g, ''))).toBeGreaterThan(parseInt(one.to.replace(/\D/g, '')));
  });
  it('says so when there is no map, or the node does not touch this map', () => {
    expect(mapHint(rules, ch, null, ['scavenger'], true, 'scavenger').note).toMatch(/Load a map/);
    const theme = mapHint(rules, ch, map, ['emberDrift'], true, 'emberDrift');
    const off = mapHint(rules, ch, rollMapWithRarity(createRng(5), 'rimedOssuary', 4, 'rare', 'rime', 5, false), ['emberDrift'], true, 'emberDrift');
    expect(off.lines).toEqual([]);
    expect(off.note).toMatch(/No change to the loaded map\. It only works on ashen forge maps\./);
    expect(theme.lines.length).toBeGreaterThan(0);
  });
  it('never mutates the character it previews', () => {
    const before = JSON.stringify(ch.atlas);
    withNodes(ch, ['scavenger'], true);
    mapHint(rules, ch, map, ['scavenger'], true, 'scavenger');
    expect(JSON.stringify(ch.atlas)).toBe(before);
  });
});
