// Per-map rosters and bosses in the rules' text (GAME_SPEC §13–§14): map tooltips and descriptions name
// the boss, the map device readout lists the monsters, lieutenant, boss and the debuffs they inflict,
// item histories name the new bosses correctly, and flasks name their cleanse.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MapBaseId } from '../../src/contracts/content';
import { MAP_BASE_IDS, MONSTER_KINDS } from '../../src/contracts/content';
import { PLAYER_DEBUFFS, THEME_ROSTER, type PlayerDebuff } from '../../src/contracts/bestiary';
import { AREA_KINDS, PROJECTILE_KINDS, type AreaKind, type ProjectileKind } from '../../src/contracts/sim';
import { createRng } from '../../src/core/rng';
import { rules } from '../../src/game';
import { BOSS_LOOT, DEBUFFS, HAZARD_AFFLICTION, MAP_AFFLICTIONS, MAP_BASES, MONSTER_NAMES } from '../../src/data/progression';
import { AREA_RIDERS } from '../../src/sim/areas';
import { PROJECTILE_RIDERS } from '../../src/sim/projectiles';
import { craftMap, mapBosses, monsterSentenceName } from '../../src/game/progression';
import { bareCharacter, kill, map, setupFor } from './fixtures';

const BOSSES: Record<MapBaseId, { boss: string; sentence: string; lieutenant: string }> = {
  ashenForge: { boss: 'Cinder Matriarch', sentence: 'the Cinder Matriarch', lieutenant: 'the Ashbound Herald' },
  rimedOssuary: { boss: 'The Hollow Warden', sentence: 'The Hollow Warden', lieutenant: 'the Bone Chorister' },
  ironColiseum: { boss: 'Varkus, the Iron Champion', sentence: 'Varkus, the Iron Champion', lieutenant: 'The Chainmaster' },
};

describe('rosters', () => {
  it('take every map base\'s monsters from the sim\'s roster for its theme', () => {
    for (const id of MAP_BASE_IDS) {
      const base = MAP_BASES[id];
      const roster = THEME_ROSTER[base.theme as keyof typeof THEME_ROSTER];
      expect(base.family).toEqual([...roster.family]);
      expect(base.lieutenant).toBe(roster.lieutenant);
      expect(base.boss).toBe(roster.boss);
    }
  });

  it('names every monster kind, and titled bosses read right in a sentence', () => {
    for (const kind of MONSTER_KINDS) expect(MONSTER_NAMES[kind]).toMatch(/^[A-Z]/);
    expect(monsterSentenceName('cinderMatriarch')).toBe('the Cinder Matriarch');
    expect(monsterSentenceName('hollowWarden')).toBe('The Hollow Warden');
    expect(monsterSentenceName('varkus')).toBe('Varkus, the Iron Champion');
    expect(monsterSentenceName('boneThrall')).toBe('the Bone Thrall');
    for (const id of MAP_BASE_IDS) {
      expect(mapBosses(id).boss).toMatchObject({ name: BOSSES[id].boss, sentence: BOSSES[id].sentence });
      expect(mapBosses(id).lieutenant.sentence).toBe(BOSSES[id].lieutenant);
    }
  });
});

describe('map text names the boss', () => {
  it('in the map base description, the tooltip and the Boss property', () => {
    expect(rules.content.mapBases.ashenForge.description).toMatch(/Its boss is the Cinder Matriarch/);
    expect(rules.content.mapBases.rimedOssuary.description).toMatch(/Its boss is The Hollow Warden/);
    expect(rules.content.mapBases.ironColiseum.description).toMatch(/Its boss is Varkus, the Iron Champion/);
    for (const id of MAP_BASE_IDS) {
      const d = rules.describeItem(map(id, 4));
      expect(d.properties).toContainEqual({ label: 'Boss', value: BOSSES[id].boss });
      expect(d.description).toBe(MAP_BASES[id].description);
    }
  });

  it('in the map device readout: monsters, lieutenant, boss and afflictions', () => {
    const lines = (id: MapBaseId) => rules.mapSummary(bareCharacter(), map(id, 3));
    const ossuary = lines('rimedOssuary');
    const waves = ossuary.find((l) => l.label === 'Waves')!;
    expect(waves.breakdown).toEqual([
      'Each wave lasts up to 60 seconds; unfinished waves stack',
      'Monsters: Bone Thralls, Rimeshades, Frost Weavers, Glacial Wisps and Ossuary Golems',
      'Wave 3: the Bone Chorister',
      'Wave 6: The Hollow Warden',
    ]);
    expect(ossuary.find((l) => l.label === 'Boss')).toEqual({
      label: 'Boss', value: 'The Hollow Warden', breakdown: ['Wave 6: killing The Hollow Warden clears the map'],
    });
    const afflictions = ossuary.find((l) => l.label === 'Afflictions')!;
    expect(afflictions.value).toBe('Chilled, Rooted, Frozen');
    expect(afflictions.breakdown[2]).toBe('Frozen (from Glacial Wisps bursting at point blank and the Warden’s Ice Prison): cannot move or '
      + 'act for 0.8 seconds, then immune to Freeze for 3 seconds. Counter: dodge the telegraph (only telegraphed attacks freeze); '
      + 'Cold Resistance shortens it');
    expect(afflictions.breakdown.at(-1)).toBe('Cinder Ward halves every debuff duration while it is active');

    const coliseum = lines('ironColiseum');
    expect(coliseum.find((l) => l.label === 'Waves')!.breakdown.slice(1)).toEqual([
      'Monsters: Pit Hounds, Chain Thralls, Iron Crossbowmen, Shieldbearers and Tar Slingers',
      'Wave 3: The Chainmaster',
      'Wave 6: Varkus, the Iron Champion',
    ]);
    expect(coliseum.find((l) => l.label === 'Afflictions')!.value).toBe('Bleeding, Rooted');
    expect(coliseum.find((l) => l.label === 'Afflictions')!.breakdown[0]).toBe('Bleeding (from Pit Hound bites, crossbow bolts, the '
      + 'Chainmaster’s whirling chains and Varkus): Physical damage over 4 seconds, doubled while you move; stacks up to 3 times. '
      + 'Counter: a Life Flask removes it; standing still avoids the doubling');
    expect(coliseum.find((l) => l.label === 'Afflictions')!.breakdown[1]).toMatch(/^Rooted \(from chain hooks and tar pools\): .* Counter: Rift Step breaks it$/);

    const forge = lines('ashenForge');
    expect(forge.find((l) => l.label === 'Waves')!.breakdown.slice(2)).toEqual(['Wave 3: the Ashbound Herald', 'Wave 6: the Cinder Matriarch']);
    expect(forge.find((l) => l.label === 'Afflictions')!.value).toBe('Burning, Withered');
    // The Herald's void orbs wither too (sim PROJECTILE_RIDERS.heraldOrb), and the source reads before the effect.
    expect(forge.find((l) => l.label === 'Afflictions')!.breakdown[1]).toBe('Withered (from Rift Stalker leaps and the Herald’s void '
      + 'orbs): 12% lower resistances per stack for 4 seconds; stacks up to 3 times. Counter: a Focus Flask removes it');
    // The readout order the UI relies on: Waves, Experience, then the boss and afflictions.
    const labels = forge.map((l) => l.label);
    expect(labels.slice(labels.indexOf('Waves'), labels.indexOf('Waves') + 4)).toEqual(['Waves', 'Experience', 'Boss', 'Afflictions']);
  });

  it('describes every debuff and lists only real ones per map', () => {
    for (const d of PLAYER_DEBUFFS) expect(DEBUFFS[d]).toMatchObject({ id: d, name: d[0].toUpperCase() + d.slice(1) });
    for (const id of MAP_BASE_IDS) {
      expect(MAP_AFFLICTIONS[id].length).toBeGreaterThan(0);
      for (const a of MAP_AFFLICTIONS[id]) expect(a.sources.length, `${id} ${a.debuff}`).toBeGreaterThan(0);
    }
  });

  it('warns that Volcanic eruptions set you Burning, on any map base', () => {
    const volcanic = (id: MapBaseId) => map(id, 3, { mods: [{ modId: 'volcanic', value: 100 }] });
    const ossuary = rules.mapSummary(bareCharacter(), volcanic('rimedOssuary'));
    const hazards = ossuary.find((l) => l.label === 'Hazards')!;
    expect(hazards.breakdown).toEqual(['Telegraphed fire eruptions that set you Burning; a Life Flask removes it; Fire Resistance shortens it (Volcanic)']);
    const afflictions = ossuary.find((l) => l.label === 'Afflictions')!;
    expect(afflictions.value).toBe('Chilled, Rooted, Frozen, Burning');
    expect(afflictions.breakdown[3]).toBe('Burning (from Volcanic eruptions): Fire damage over 3 seconds. Counter: a Life Flask removes it; '
      + 'Fire Resistance shortens it');
    // The Ashen Forge already lists Burning: the eruptions join its sources instead of a second line.
    const forge = rules.mapSummary(bareCharacter(), volcanic('ashenForge')).find((l) => l.label === 'Afflictions')!;
    expect(forge.value).toBe('Burning, Withered');
    expect(forge.breakdown[0]).toMatch(/^Burning \(from Cinder Spitter lobs, the Matriarch’s orbs, fire pools and Volcanic eruptions\): /);
    // Without the mod nothing mentions eruptions.
    const plain = rules.mapSummary(bareCharacter(), map('rimedOssuary', 3));
    expect(plain.find((l) => l.label === 'Hazards')).toBeUndefined();
    expect(plain.find((l) => l.label === 'Afflictions')!.value).toBe('Chilled, Rooted, Frozen');
    expect(rules.describeItem(volcanic('ironColiseum')).affixes.map((l) => l.text)).toContain('Volcanic eruptions burst around you and set you Burning');
  });

  it('in the Echo wave line and the Void Needle message', () => {
    for (const id of MAP_BASE_IDS) {
      const echo = { ...map(id, 5), corrupted: true, mods: [{ modId: 'echo', value: 100, corrupted: true }] };
      const lines = rules.describeItem(echo).affixes.map((l) => l.text);
      expect(lines).toContain(`An Echo wave follows ${BOSSES[id].sentence}: a 7th wave with double loot`);
      expect(rules.mapSummary(bareCharacter(), echo).find((l) => l.label === 'Waves')!.breakdown.at(-1))
        .toBe('Wave 7: the Echo wave, double loot');
    }
    // Find a seed that rolls the Echo outcome and check the message names the boss.
    for (let seed = 1; seed < 400; seed++) {
      const res = craftMap(map('ironColiseum', 3), 'voidNeedle', createRng(seed));
      if (res.map.mods.some((m) => m.modId === 'echo')) {
        expect(res.message).toBe('Void Needle corrupted the map: an Echo wave will follow Varkus, the Iron Champion');
        return;
      }
    }
    throw new Error('no Echo outcome in 400 seeds');
  });
});

// The Afflictions readout must list exactly what each map's roster can do to a player. The sim owns the
// behaviour, so this reads the roster code (src/sim/rosters/<theme>/) and follows every projectile and area
// kind it uses through the sim's rider tables (PROJECTILE_RIDERS, AREA_RIDERS), plus the few follow-ups those
// tables don't carry. When a roster gains or loses a debuff, update MAP_AFFLICTIONS (and this table if the
// sim grows a new kind of follow-up).
describe('the Afflictions readout matches what the sim\'s rosters apply', () => {
  const ROSTER_DIR: Record<MapBaseId, string> = { ashenForge: 'ashenForge', rimedOssuary: 'ossuary', ironColiseum: 'coliseum' };
  /** Debuffs a kind leads to beyond its rider: a hook's pull ends rooted, tar globs leave a tar pool, a wisp freezes at point blank. */
  const FOLLOW_UPS: Partial<Record<ProjectileKind | AreaKind, readonly PlayerDebuff[]>> = {
    chainHook: ['rooted'],
    tarGlob: [AREA_RIDERS.tarPool!],
    wispBurst: ['frozen'],
  };
  const DEBUFF_LITERAL = new RegExp(`'(${PLAYER_DEBUFFS.join('|')})'`, 'g');
  const KINDS = new Set<string>([...PROJECTILE_KINDS, ...AREA_KINDS]);

  function rosterSource(id: MapBaseId): string {
    const dir = new URL(`../../src/sim/rosters/${ROSTER_DIR[id]}/`, import.meta.url);
    if (!existsSync(dir)) throw new Error(`no roster code for ${id} at src/sim/rosters/${ROSTER_DIR[id]}/ (update ROSTER_DIR)`);
    return readdirSync(dir).filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(new URL(f, dir), 'utf8'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
  }

  function rosterDebuffs(id: MapBaseId): PlayerDebuff[] {
    const code = rosterSource(id);
    const kinds = new Set<string>();
    for (const m of code.matchAll(/\bPROJ\.(\w+)/g)) kinds.add(m[1]);
    for (const m of code.matchAll(/'(\w+)'/g)) if (KINDS.has(m[1])) kinds.add(m[1]);
    if (/\bpulseBrain\(/.test(code)) kinds.add('wispBurst'); // the kit's default pulse telegraph
    if (/\bpoolDuration\b/.test(code)) kinds.add('firePool'); // telegraphs that leave fire pools behind
    const out = new Set<PlayerDebuff>();
    for (const m of code.matchAll(DEBUFF_LITERAL)) out.add(m[1] as PlayerDebuff);
    if (/\b(pullPlayer|setProjectilePull)\(/.test(code)) out.add('rooted');
    for (const k of kinds) {
      const rider = PROJECTILE_RIDERS[k as ProjectileKind]?.debuff ?? AREA_RIDERS[k as AreaKind];
      if (rider) out.add(rider);
      for (const d of FOLLOW_UPS[k as ProjectileKind | AreaKind] ?? []) out.add(d);
    }
    return [...out].sort();
  }

  it.each(MAP_BASE_IDS)('%s', (id) => {
    const listed = MAP_AFFLICTIONS[id].map((a) => a.debuff).sort();
    expect(rosterDebuffs(id), `MAP_AFFLICTIONS.${id} vs src/sim/rosters/${ROSTER_DIR[id]}/`).toEqual(listed);
  });

  it('the Volcanic eruptions\' debuff', () => {
    expect(AREA_RIDERS.eruptionWarning).toBe(HAZARD_AFFLICTION.debuff);
  });
});

describe('item histories name the new bosses and lieutenants', () => {
  it('reads "Dropped by The Hollow Warden", "Dropped by the Bone Chorister", "Dropped by Varkus, the Iron Champion"', () => {
    const origin = (id: MapBaseId, ctx: Parameters<typeof kill>[0]) => {
      const setup = setupFor(map(id, 2));
      const items = rules.rollKillLoot(setup, kill(ctx), createRng(5), bareCharacter());
      const eq = items.find((i) => i.kind === 'equipment');
      return eq && eq.kind === 'equipment' ? eq.history[0] : null;
    };
    expect(origin('rimedOssuary', { kind: 'hollowWarden', isBoss: true, rarity: 'rare', wave: 6 })).toBe('Dropped by The Hollow Warden in Rimed Ossuary (Tier 2)');
    expect(origin('rimedOssuary', { kind: 'boneChorister', isLieutenant: true, rarity: 'rare', wave: 3 })).toBe('Dropped by the Bone Chorister in Rimed Ossuary (Tier 2)');
    expect(origin('ironColiseum', { kind: 'varkus', isBoss: true, rarity: 'rare', wave: 6 })).toBe('Dropped by Varkus, the Iron Champion in Iron Coliseum (Tier 2)');
    expect(origin('ironColiseum', { kind: 'chainmaster', isLieutenant: true, rarity: 'rare', wave: 3 })).toBe('Dropped by The Chainmaster in Iron Coliseum (Tier 2)');
  });

  it('gives the new bosses the same guaranteed drops as the Matriarch', () => {
    const setup = setupFor(map('ironColiseum', 3));
    const count = (kind: 'varkus' | 'cinderMatriarch') => rules.rollKillLoot(setup, kill({ kind, isBoss: true, rarity: 'rare', wave: 6 }), createRng(9), bareCharacter())
      .filter((i) => i.kind === 'equipment').length;
    expect(count('varkus')).toBeGreaterThanOrEqual(1 + BOSS_LOOT.extraEquipment);
    expect(count('varkus')).toBe(count('cinderMatriarch'));
  });
});

describe('flasks name their cleanse', () => {
  it('Life removes Burning and Bleeding; Focus removes Withered', () => {
    expect(rules.content.flasks.lifeFlask.description).toBe('Recovers Life over a few seconds. Drinking it removes Burning and Bleeding.');
    expect(rules.content.flasks.focusFlask.description).toBe('Recovers Focus over a few seconds. Drinking it removes Withered.');
    const d = rules.describeItem({ kind: 'flask', uid: 'f', flaskId: 'lifeFlask', count: 2 }, bareCharacter());
    expect(d.description).toMatch(/^Recovers Life over a few seconds\. Drinking it removes Burning and Bleeding\. Each belt slot holds up to 5 charges/);
    const offer = rules.merchantOffers(bareCharacter()).find((o) => o.id === 'flask-focus')!;
    expect(offer.description).toMatch(/removes Withered/);
  });
});
