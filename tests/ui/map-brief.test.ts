// The short map tooltip (F-28): a one-line summary, the luck, one line per mod, warnings; the long card follows on hover or Alt.
import { describe, expect, it } from 'vitest';
import { rules } from '../../src/game';
import { DANGER_MODS, REWARD_MODS } from '../../src/data/progression/maps';
import { findAtlasArea } from '../../src/data/progression/atlas';
import { MAP_BRIEF_LINGER_MS, MAP_BRIEF_MODS, mapBrief, rechartHint, surgeText } from '../../src/ui/lib/map-brief';
import { map } from '../game-progression/fixtures';

describe('mapBrief', () => {
  it('sums a plain map up in one line: tier, area, waves and boss, from the rules\' own description', () => {
    const m = map('ashenForge', 3, { uid: 'm1' });
    const desc = rules.describeItem(m);
    const brief = mapBrief(m, desc);
    const area = findAtlasArea(m.areaId)!;
    const waves = desc.properties.find((p) => p.label === 'Waves')!.value;
    const boss = desc.properties.find((p) => p.label === 'Boss')!.value;
    expect(brief.head).toBe(`Tier 3 · ${area.name} · ${waves} waves · boss: ${boss}`);
    expect(brief.mods).toEqual([]);
    expect(brief.more).toBe(0);
    // the theme's own effects (Cinder Crossing: "Monsters have +10% to all Resistances") are in the summary, the level lines are not
    expect(brief.base.length).toBeGreaterThan(0);
    for (const l of brief.base) expect(desc.implicits.map((i) => i.text)).toContain(l.text);
    expect(brief.base.some((l) => /monster level/.test(l.text))).toBe(false);
    expect(brief.warnings).toEqual([]);
  });

  it('lists one line per mod (not one per effect line), danger flagged, and counts the overflow', () => {
    const mods = [...DANGER_MODS.slice(0, MAP_BRIEF_MODS), REWARD_MODS[0]].map((d) => ({ modId: d.id, value: 0.5 }));
    const m = map('ashenForge', 5, { uid: 'm2', mods });
    const desc = rules.describeItem(m);
    const brief = mapBrief(m, desc);
    expect(brief.mods).toHaveLength(MAP_BRIEF_MODS);
    expect(brief.more).toBe(1);
    expect(brief.mods.length + brief.more).toBeLessThanOrEqual(desc.affixes.length);
    for (const line of brief.mods) expect(desc.affixes.map((a) => a.text)).toContain(line.text);
    expect(brief.mods.some((l) => l.negative)).toBe(true);
  });

  it('shows the luck and the surge charges, and stays quiet about a zero luck', () => {
    const m = map('ashenForge', 2, { uid: 'm3', quality: 10 });
    const brief = mapBrief(m, rules.describeItem(m), { remaining: 2, max: 3 });
    expect(brief.luck).toContain('Quality +10%');
    expect(brief.luck).toContain('Surge 2/3 today');
    expect(brief.luck ?? '').not.toMatch(/\+0%/);
  });

  it('keeps the warnings a player must not miss: unexplored area and corruption', () => {
    const m = { ...map('ashenForge', 2, { uid: 'm4' }), corrupted: true };
    const desc = rules.describeItem(m);
    const unexplored = 'Unexplored territory: defeat bosses to chart this area before the map can be opened';
    const brief = mapBrief(m, { ...desc, headerLines: [...desc.headerLines, unexplored] });
    expect(brief.warnings).toContain(unexplored);
    expect(brief.warnings.some((w) => w.startsWith('Corrupted'))).toBe(true);
  });
});

describe('map tooltip extras', () => {
  it('says the surge charges only where the area has a surge', () => {
    expect(surgeText({ remaining: 1, max: 3 })).toBe('Surge 1/3 today');
    expect(surgeText({ remaining: 0, max: 0 })).toBeNull();
    expect(surgeText(null)).toBeNull();
  });
  it('points to Re-chart, except on a corrupted map', () => {
    const m = map('ashenForge', 2, { uid: 'm5' });
    expect(rechartHint(m)).toMatch(/Re-chart/);
    expect(rechartHint({ ...m, corrupted: true })).toBeNull();
  });
  it('grows into the full card after about 600 ms', () => {
    expect(MAP_BRIEF_LINGER_MS).toBe(600);
  });
});
