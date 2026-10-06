// The monster hover's level gap line (roadmap 4): the same rule the sim applies (levelGapMult in src/sim/combat.ts).
import { describe, expect, it } from 'vitest';
import { levelGapMult } from '../../src/sim/combat';
import { levelGapInfo } from '../../src/ui/lib/level-gap';

describe('monster hover: level gap', () => {
  it('names the gap and the extra damage beyond three levels, capped at +100%', () => {
    expect(levelGapInfo(34, 28)).toMatchObject({ gap: 6, damageMore: 15, tone: 'over', text: 'Level 34 · 6 above you · deals 15% more damage' });
    expect(levelGapInfo(30, 28)).toMatchObject({ gap: 2, damageMore: 0, tone: 'near', text: 'Level 30 · 2 above you' });
    expect(levelGapInfo(31, 28)).toMatchObject({ damageMore: 0, tone: 'near' });
    expect(levelGapInfo(20, 28)).toMatchObject({ gap: -8, damageMore: 0, tone: 'even', text: 'Level 20 · 8 below you' });
    expect(levelGapInfo(28, 28)?.text).toBe('Level 28 · your level');
    expect(levelGapInfo(88, 1)).toMatchObject({ damageMore: 100 });
  });

  it('agrees with the sim for every gap', () => {
    for (let player = 1; player <= 80; player += 3) {
      for (const ml of [4, 22, 40, 64, 88]) {
        const info = levelGapInfo(ml, player)!;
        expect(info.damageMore, `${ml} vs ${player}`).toBe(Math.round((levelGapMult(ml, player) - 1) * 100));
      }
    }
  });

  it('shows nothing without a monster level (hideout, before the run setup arrives)', () => {
    expect(levelGapInfo(null, 10)).toBeNull();
    expect(levelGapInfo(undefined, 10)).toBeNull();
  });
});
