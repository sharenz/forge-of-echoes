import { inc, more, onBase, weight } from './dsl';
import type { MapBaseId } from '../../../contracts/content';
import type { AtlasNodeSpec } from './types';

type Spec = Omit<AtlasNodeSpec, 'ring' | 'lane' | 'from'>;
export interface ThemeSeal { base: MapBaseId; angle: number; between: [string, string]; small: Spec; seal: Spec }

/** Outer belt: six theme seals, each reachable from two neighbouring branches. Active only on that base. */
export const BELT: readonly ThemeSeal[] = [
  { base: 'ashenForge', angle: -120, between: ['foundry', 'cartography'],
    small: { id: 'emberDrift', name: 'Ember Drift', kind: 'small', base: 'ashenForge', effects: [inc('emberEssenceChance', 10, onBase('ashenForge'))] },
    seal: { id: 'emberwrightsDue', name: "Emberwright's Due", kind: 'theme', base: 'ashenForge',
      effects: [more('emberEssenceChance', 35, onBase('ashenForge')), { stat: 'monsterResist', mode: 'flat', value: 5, when: onBase('ashenForge') }] } },
  { base: 'cinderChapel', angle: -60, between: ['cartography', 'fortune'],
    small: { id: 'chapelDust', name: 'Chapel Dust', kind: 'small', base: 'cinderChapel', rules: [weight(['seal'], 'increased', 10, 'cinderChapel')] },
    seal: { id: 'heraldsLitany', name: "Herald's Litany", kind: 'theme', base: 'cinderChapel',
      rules: [weight(['seal'], 'more', 30, 'cinderChapel')],
      effects: [more('bossIngredientChance', 10, onBase('cinderChapel')), inc('monsterDamage', 4, onBase('cinderChapel'))] } },
  { base: 'rimedOssuary', angle: 0, between: ['fortune', 'echoes'],
    small: { id: 'rimeFrost', name: 'Rime Frost', kind: 'small', base: 'rimedOssuary', effects: [inc('rimeEssenceChance', 10, onBase('rimedOssuary'))] },
    seal: { id: 'rimewrightsDue', name: "Rimewright's Due", kind: 'theme', base: 'rimedOssuary',
      effects: [more('rimeEssenceChance', 35, onBase('rimedOssuary')), inc('monsterDamage', 3.5, onBase('rimedOssuary'))] } },
  { base: 'choralCrypt', angle: 60, between: ['echoes', 'peril'],
    small: { id: 'choirNotes', name: 'Choir Notes', kind: 'small', base: 'choralCrypt', rules: [weight(['solvent'], 'increased', 10, 'choralCrypt')] },
    seal: { id: 'choirmastersEar', name: "Choirmaster's Ear", kind: 'theme', base: 'choralCrypt',
      rules: [weight(['solvent'], 'more', 30, 'choralCrypt')],
      effects: [more('bossIngredientChance', 10, onBase('choralCrypt')), inc('monsterSpeed', 4, onBase('choralCrypt'))] } },
  { base: 'ironColiseum', angle: 120, between: ['peril', 'bounty'],
    small: { id: 'sandPit', name: 'Sand Pit', kind: 'small', base: 'ironColiseum', rules: [weight(['fractureCore'], 'increased', 10, 'ironColiseum')] },
    seal: { id: 'gladiatorsPurse', name: "Gladiator's Purse", kind: 'theme', base: 'ironColiseum',
      rules: [weight(['fractureCore'], 'more', 30, 'ironColiseum')],
      effects: [more('equipmentDropChance', 5, onBase('ironColiseum')), inc('monsterCount', 6, onBase('ironColiseum'))] } },
  { base: 'chainworks', angle: 180, between: ['bounty', 'foundry'],
    small: { id: 'chainLink', name: 'Chain Link', kind: 'small', base: 'chainworks', rules: [weight(['scrap'], 'increased', 10, 'chainworks')] },
    seal: { id: 'chainbreaker', name: 'Chainbreaker', kind: 'theme', base: 'chainworks',
      rules: [weight(['scrap'], 'more', 30, 'chainworks')],
      effects: [inc('mapDropChance', 8, onBase('chainworks')), more('monsterDamage', 3, onBase('chainworks'))] } },
];
