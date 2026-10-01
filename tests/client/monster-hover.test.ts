import { describe, expect, it } from 'vitest';
import { hoveredMonster } from '../../src/client/monster-hover';
import { ELITE_BIT, RARITY_CODE } from '../../src/contracts/sim';
import { addMonster, monsterStore } from './helpers';

describe('elite hover', () => {
  it('shows the replicated mods at the drawn position and clears over UI, empty space or a dead monster', () => {
    const m = monsterStore();
    const i = addMonster(m, 200, 100, 'ashling', { x: 100, y: 100 });
    m.rarity[i] = RARITY_CODE.rare;
    m.mods[i] = ELITE_BIT.juggernaut | ELITE_BIT.warded;
    m.maxLife[i] = 300;
    m.life[i] = 150;
    expect(hoveredMonster(m, { x: 150, y: 92 }, 0.5)).toMatchObject({kind: 'ashling', rarity: 'rare', mods: 72, life: 0.5});
    expect(hoveredMonster(m, { x: 150, y: 92 }, 1)).toBeNull();
    expect(hoveredMonster(m, null, 0.5)).toBeNull();
    m.alive[i] = 0;
    expect(hoveredMonster(m, { x: 150, y: 92 }, 0.5)).toBeNull();
  });
  it('shows blue pack mods without treating normal monsters or named bosses as elites', () => {
    const m = monsterStore();
    const i = addMonster(m, 0, 0);
    for (const rarity of [RARITY_CODE.normal, RARITY_CODE.boss, RARITY_CODE.lieutenant]) {
      m.rarity[i] = rarity;
      expect(hoveredMonster(m, {x: 0, y: 0})).toBeNull();
    }
    m.rarity[i] = RARITY_CODE.magic;
    m.mods[i] = ELITE_BIT.swift;
    expect(hoveredMonster(m, {x: 0, y: 0})).toMatchObject({rarity: 'magic', mods: ELITE_BIT.swift});
  });
});
