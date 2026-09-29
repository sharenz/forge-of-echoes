import { ELITE_BIT } from '../../contracts/sim';
import { Bar, cx } from '../components/common';
import { monsterTitle } from '../lib/content';
import { shallowEqual, useUi } from '../store';

const MODS = [
  [ELITE_BIT.swift, 'Swift', 'Moves faster'],
  [ELITE_BIT.stout, 'Stout', 'Extra life'],
  [ELITE_BIT.fierce, 'Fierce', 'Deals more damage'],
  [ELITE_BIT.juggernaut, 'Juggernaut', 'Greatly increased life'],
  [ELITE_BIT.frenzied, 'Frenzied', 'Moves much faster'],
  [ELITE_BIT.emberTouched, 'Ember-touched', 'Explodes after death — leave the warning circle'],
  [ELITE_BIT.warded, 'Warded', 'Takes less damage while allies are nearby'],
] as const;

export function MonsterHover() {
  const monster = useUi((s) => s.hud?.hoveredMonster ?? null, shallowEqual);
  if (!monster) return null;
  return <div class={cx('fe-monster-hover', `fe-monster-hover--${monster.rarity}`)} role="status">
    <strong>{monsterTitle(monster.kind)} <span>{monster.rarity === 'rare' ? 'Rare' : 'Magic'}</span></strong>
    <Bar kind="life" value={monster.life} />
    {MODS.filter(([bit]) => monster.mods & bit).map(([bit, name, effect]) => <div key={bit}><b>{name}</b> · {effect}</div>)}
  </div>;
}
