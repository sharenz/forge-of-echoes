// Controls cheat-sheet logic (src/ui/guide/cheatsheet.ts).
import { describe, expect, it } from 'vitest';
import { CHIPS, FADE_AFTER_CORE_MS, MAX_SHOW_MS, cheatsheetState, chipOf, coreDone, type ChipId } from '../../src/ui/guide/cheatsheet';

const input = { wanted: true, inMap: true, startedAt: 1000, coreDoneAt: null as number | null, used: new Set<ChipId>(), now: 2000 };

describe('cheatsheetState', () => {
  it('shows in a map while the fight is unlearned', () => {
    expect(cheatsheetState(input)).toMatchObject({ visible: true, fading: false });
  });
  it('is never shown in the hideout, or when the guide is off or the fight is learned', () => {
    expect(cheatsheetState({ ...input, inMap: false }).visible).toBe(false);
    expect(cheatsheetState({ ...input, wanted: false }).visible).toBe(false);
    expect(cheatsheetState({ ...input, startedAt: null }).visible).toBe(false);
  });
  it('fades 3 s after both core chips are used', () => {
    const used = new Set<ChipId>(['cast', 'move']);
    expect(cheatsheetState({ ...input, used, coreDoneAt: 5000, now: 5000 + FADE_AFTER_CORE_MS - 1 })).toMatchObject({ visible: true, fading: true });
    expect(cheatsheetState({ ...input, used, coreDoneAt: 5000, now: 5000 + FADE_AFTER_CORE_MS }).visible).toBe(false);
  });
  it('ends after 40 s regardless', () => {
    expect(cheatsheetState({ ...input, now: 1000 + MAX_SHOW_MS }).visible).toBe(false);
  });
  it('dims chips as they are used', () => {
    const used = new Set<ChipId>(['move']);
    expect(cheatsheetState({ ...input, used }).dimmed.has('move')).toBe(true);
  });
  it('maps actions to chips', () => {
    expect(chipOf('cast')).toBe('cast');
    expect(chipOf('move')).toBe('move');
    expect(chipOf('flask')).toBe('flasks');
    expect(chipOf('dash')).toBe('dash');
    expect(chipOf('skill')).toBeNull();
    expect(CHIPS).toContain('panels');
  });
  it('latches the moment the core pair was used', () => {
    expect(coreDone(null, new Set<ChipId>(['cast']), 10)).toBeNull();
    expect(coreDone(null, new Set<ChipId>(['cast', 'move']), 10)).toBe(10);
    expect(coreDone(10, new Set<ChipId>(), 99)).toBe(10);
  });
});
