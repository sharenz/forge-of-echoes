// Uniques (GAME_SPEC §5): fixed, rule-changing items. They keep their base's implicit and properties,
// roll their own mod values and grant player flags. Only Crown Fragments reroll their values.
import type { UniqueId } from '../../contracts/content';
import type { UniqueDef } from './types';

export const UNIQUES: Record<UniqueId, UniqueDef> = {
  thePatientSpark: {
    id: 'thePatientSpark',
    name: 'The Patient Spark',
    baseId: 'ashwoodWand',
    flavor: 'It waits for the whole line.',
    levelRequirement: 10,
    mods: [
      { stats: ['fireDamage'], mode: 'increased', min: 30, max: 45 },
      { stats: ['castSpeed'], mode: 'increased', min: -15, max: -15 },
    ],
    flags: [{ flag: 'lancePierceAll', text: 'Ember Lance pierces all targets' }],
    dropWeight: 100,
  },
  cinderwalkers: {
    id: 'cinderwalkers',
    name: 'Cinderwalkers',
    baseId: 'ashenSandals',
    flavor: 'Where she walked, the ash remembered.',
    levelRequirement: 16,
    mods: [
      { stats: ['moveSpeed'], mode: 'increased', min: 15, max: 20 },
      { stats: ['fireRes'], mode: 'flat', min: 20, max: 30 },
    ],
    flags: [{ flag: 'fireTrail', text: 'You leave a trail of burning ground while moving' }],
    dropWeight: 100,
  },
  echoOfTheMatriarch: {
    id: 'echoOfTheMatriarch',
    name: 'Echo of the Matriarch',
    baseId: 'cinderPendant',
    flavor: 'Her last command still rings in the embers.',
    levelRequirement: 20,
    mods: [
      { stats: ['maxFocus'], mode: 'flat', min: 15, max: 25 },
      { stats: ['maxLife'], mode: 'increased', min: -8, max: -8 },
    ],
    flags: [{ flag: 'novaEcho', text: 'Ember Nova repeats once after 0.4 seconds' }],
    dropWeight: 100,
  },
  ruinheartBand: {
    id: 'ruinheartBand',
    name: 'Ruinheart Band',
    baseId: 'voidSignet',
    flavor: 'Power pours from the wound, not the hand.',
    levelRequirement: 24,
    mods: [
      { stats: ['extraProjectiles'], mode: 'flat', min: 1, max: 1 },
      { stats: ['voidRes'], mode: 'flat', min: 20, max: 30 },
      { stats: ['damageTaken'], mode: 'increased', min: 12, max: 12 },
    ],
    flags: [],
    dropWeight: 100,
  },
  everburn: {
    id: 'everburn', name: 'Everburn', baseId: 'emberheartWand', levelRequirement: 46,
    bossSource: 'cinderMatriarch', dropWeight: 100, flavor: 'A promise the flame refuses to forget.',
    mods: [
      { stats: ['fireDamage'], mode: 'increased', min: 35, max: 50 },
      { stats: ['castSpeed'], mode: 'increased', min: -10, max: -10 },
    ],
    flags: [{ flag: 'lanceIgnites', text: 'Ember Lance always ignites' }],
  },
  sunkenSun: {
    id: 'sunkenSun', name: 'The Sunken Sun', baseId: 'echoingFocus', levelRequirement: 58,
    bossSource: 'cinderMatriarch', dropWeight: 100, flavor: 'All its light falls in one direction.',
    mods: [
      { stats: ['spellDamage'], mode: 'increased', min: 30, max: 45 },
      { stats: ['maxFocus'], mode: 'flat', min: 20, max: 30 },
      { stats: ['area'], mode: 'increased', min: -20, max: -20 },
    ],
    flags: [{ flag: 'novaFan', text: 'Ember Nova fires its flames in a 150° fan toward the cursor' }],
  },
  winterstride: {
    id: 'winterstride', name: 'Winterstride', baseId: 'wayfarerGreaves', levelRequirement: 46,
    bossSource: 'hollowWarden', dropWeight: 100, flavor: 'Every arrival is the first day of winter.',
    mods: [
      { stats: ['moveSpeed'], mode: 'increased', min: 8, max: 12 },
      { stats: ['coldRes'], mode: 'flat', min: 25, max: 35 },
      { stats: ['fireRes'], mode: 'flat', min: -15, max: -15 },
    ],
    flags: [{ flag: 'riftChill', text: 'Rift Step chills enemies within 100 units of its landing for 2 seconds' }],
  },
  stillwinter: {
    id: 'stillwinter', name: 'Stillwinter', baseId: 'duskweaveRobe', levelRequirement: 58,
    bossSource: 'hollowWarden', dropWeight: 100, flavor: 'The cold does not end. It keeps watch.',
    mods: [
      { stats: ['maxLife'], mode: 'flat', min: 25, max: 40 },
      { stats: ['coldDamage'], mode: 'increased', min: 35, max: 50 },
      { stats: ['fireRes'], mode: 'flat', min: -20, max: -20 },
    ],
    flags: [{ flag: 'coldWard', text: 'Cinder Ward deals Cold damage and always chills' }],
  },
  vigilOfAsh: {
    id: 'vigilOfAsh', name: 'Vigil of Ash', baseId: 'forgemasterGloves', levelRequirement: 46,
    bossSource: 'ashboundHerald', dropWeight: 100, flavor: 'The faithful feed the fire with their doubt.',
    mods: [
      { stats: ['maxFocus'], mode: 'flat', min: 30, max: 45 },
      { stats: ['focusRegen'], mode: 'increased', min: 15, max: 25 },
      { stats: ['spellDamage'], mode: 'increased', min: -15, max: -15 },
    ],
    flags: [{ flag: 'wardFocus', text: 'Cinder Ward deals no damage; each pulse restores 2 Focus per nearby enemy, up to 6' }],
  },
  lastRite: {
    id: 'lastRite', name: 'The Last Rite', baseId: 'stormglassSceptre', levelRequirement: 58,
    bossSource: 'ashboundHerald', dropWeight: 100, flavor: 'No one stands outside the final circle.',
    mods: [
      { stats: ['fireDamage'], mode: 'increased', min: 45, max: 60 },
      { stats: ['castSpeed'], mode: 'increased', min: 10, max: 15 },
      { stats: ['maxLife'], mode: 'increased', min: -10, max: -10 },
    ],
    flags: [{ flag: 'flameRing', text: 'Flame Wave sends its waves in a full circle around you' }],
  },
  choirOfGlass: {
    id: 'choirOfGlass', name: 'Choir of Glass', baseId: 'prismaticAmulet', levelRequirement: 46,
    bossSource: 'boneChorister', dropWeight: 100, flavor: 'One note passes through every throat.',
    mods: [
      { stats: ['coldDamage'], mode: 'increased', min: 35, max: 50 },
      { stats: ['castSpeed'], mode: 'increased', min: 8, max: 12 },
      { stats: ['maxLife'], mode: 'increased', min: -8, max: -8 },
    ],
    flags: [{ flag: 'shardPierceAll', text: 'Rime Shards pierce all targets' }],
  },
  secondVerse: {
    id: 'secondVerse', name: 'The Second Verse', baseId: 'echoingFocus', levelRequirement: 58,
    bossSource: 'boneChorister', dropWeight: 100, flavor: 'The answer comes from an empty choir.',
    mods: [
      { stats: ['coldDamage'], mode: 'increased', min: 30, max: 45 },
      { stats: ['maxFocus'], mode: 'flat', min: 20, max: 30 },
      { stats: ['castSpeed'], mode: 'increased', min: -15, max: -15 },
    ],
    flags: [{ flag: 'rimeEcho', text: 'Rime Shards repeat once after 0.4 seconds at no additional Focus cost' }],
  },
  brokenLink: {
    id: 'brokenLink', name: 'The Broken Link', baseId: 'ironweaveGirdle', levelRequirement: 46,
    bossSource: 'chainmaster', dropWeight: 100, flavor: 'Freedom begins with one missing link.',
    mods: [
      { stats: ['maxLife'], mode: 'flat', min: 25, max: 40 },
      { stats: ['cooldownRecovery'], mode: 'increased', min: 12, max: 18 },
      { stats: ['focusRegen'], mode: 'increased', min: -20, max: -20 },
    ],
    flags: [{ flag: 'riftCleanse', text: 'Rift Step removes all harmful effects from you' }],
  },
  ironRefrain: {
    id: 'ironRefrain', name: 'Iron Refrain', baseId: 'bastionHelm', levelRequirement: 58,
    bossSource: 'chainmaster', dropWeight: 100, flavor: 'Every chain returns to its master.',
    mods: [
      { stats: ['lightningDamage'], mode: 'increased', min: 35, max: 50 },
      { stats: ['castSpeed'], mode: 'increased', min: 8, max: 12 },
      { stats: ['maxLife'], mode: 'increased', min: -8, max: -8 },
    ],
    flags: [{ flag: 'arcReturns', text: 'Arc Chain can revisit earlier targets, but cannot hit the same target twice in succession' }],
  },
  unbowedCrown: {
    id: 'unbowedCrown', name: 'The Unbowed Crown', baseId: 'bastionHelm', levelRequirement: 46,
    bossSource: 'varkus', dropWeight: 100, flavor: 'The crowd falls silent. The champion does not.',
    mods: [
      { stats: ['maxLife'], mode: 'flat', min: 30, max: 45 },
      { stats: ['lifeRegen'], mode: 'flat', min: 2, max: 4 },
      { stats: ['moveSpeed'], mode: 'increased', min: -8, max: -8 },
    ],
    flags: [{ flag: 'wardRenew', text: 'Taking a Physical hit restores 0.5 seconds to Cinder Ward, up to its original duration' }],
  },
  victorsDebt: {
    id: 'victorsDebt', name: "Victor's Debt", baseId: 'dusksteelRing', levelRequirement: 58,
    bossSource: 'varkus', dropWeight: 100, flavor: 'Victory is paid for at arm’s length.',
    mods: [
      { stats: ['spellDamage'], mode: 'increased', min: 25, max: 35 },
      { stats: ['fireRes', 'coldRes', 'lightningRes', 'voidRes'], mode: 'flat', min: 10, max: 14, text: '{+v}% to all Resistances' },
      { stats: ['damageTaken'], mode: 'increased', min: 10, max: 10 },
    ],
    flags: [{ flag: 'closeQuarters', text: 'Hits deal 25% more damage within 80 units of you, and 25% less beyond 200 units' }],
  },
};
