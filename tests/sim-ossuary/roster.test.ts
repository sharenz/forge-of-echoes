// The Rimed Ossuary roster's definitions (GAME_SPEC §14): one MonsterDef per kind, numbers next to their
// Ashen Forge twins, the flags the spec asks for, and how the kinds enter the waves.
import { describe, expect, it } from 'vitest';
import { OSSUARY_MONSTERS, THEME_ROSTER } from '../../src/contracts/bestiary';
import type { MonsterKind } from '../../src/contracts/content';
import { monsterDef, rosterFor } from '../../src/sim/rosters';
import { ossuaryRoster } from '../../src/sim/rosters/ossuary';
import { createRunInternal } from '../../src/sim/run';
import { planWave } from '../../src/sim/waves';
import { makeConfig, makeJoin } from '../sim/fixtures';
import { MAP_BASES } from '../../src/data/progression/maps';

const def = (k: MonsterKind) => monsterDef(k);

describe('the Rimed Ossuary roster', () => {
  it('defines every Ossuary kind exactly once and is what an Ossuary map uses', () => {
    const kinds = ossuaryRoster().map((d) => d.kind);
    expect([...kinds].sort()).toEqual([...OSSUARY_MONSTERS].sort());
    expect(rosterFor('rimedOssuary')).toEqual(THEME_ROSTER.rimedOssuary);
    for (const k of OSSUARY_MONSTERS) {
      expect(def(k).name.length).toBeGreaterThan(3);
      expect(def(k).resist).toHaveLength(5);
    }
    expect(def('boneChorister').name).toBe('Bone Chorister');
    expect(def('hollowWarden').name).toBe('The Hollow Warden');
  });

  it('sits next to the Ashen Forge numbers (GAME_SPEC §14 scaling table)', () => {
    const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b) / b).toBeLessThanOrEqual(tol);
    const pairs: [MonsterKind, MonsterKind, number][] = [
      ['boneThrall', 'ashling', 0.05], // swarmers ≈ Ashling
      ['ossuaryGolem', 'ironhideBrute', 0.05], // bruisers ≈ Ironhide Brute
      ['boneChorister', 'ashboundHerald', 0.05], // lieutenants ≈ Herald
      ['hollowWarden', 'cinderMatriarch', 0.05], // bosses ≈ Matriarch (the tier easing applies to both alike)
    ];
    for (const [k, twin, tol] of pairs) {
      if (k !== 'hollowWarden') near(def(k).life, def(twin).life, tol);
      near(def(k).xp, def(twin).xp, tol);
      near(def(k).damage, def(twin).damage, 0.1);
    }
    // The Warden's life is set so that, with the Ossuary's +20% monster life implicit, she has the Matriarch's
    // life in her own map (balance pass: the implicit alone made hers the longest boss fight by a third).
    const ossuaryLife = MAP_BASES.rimedOssuary.implicitEffects.find((e) => e.stat === 'monsterLife' && e.mode === 'increased');
    expect(ossuaryLife?.value).toBeGreaterThan(0);
    near(def('hollowWarden').life * (1 + ossuaryLife!.value / 100), def('cinderMatriarch').life, 0.05);
    // The rest by role: fast ≈ Ember Skitter, artillery ≈ Cinder Spitter, hunter ≈ Rift Stalker (life and XP).
    near(def('glacialWisp').life, def('emberSkitter').life, 0.05);
    near(def('frostWeaver').life, def('cinderSpitter').life, 0.15);
    near(def('rimeshade').life, def('riftStalker').life, 0.2);
    near(def('rimeshade').xp, def('riftStalker').xp, 0.2);
    // Cold family: its own attacks are cold (the thrall's bite is bone), and it shrugs off cold a little.
    for (const k of ['rimeshade', 'frostWeaver', 'glacialWisp', 'ossuaryGolem', 'boneChorister', 'hollowWarden'] as const) {
      expect(def(k).damageType, k).toBe('cold');
    }
    for (const k of OSSUARY_MONSTERS) expect(def(k).resist[2], k).toBeGreaterThan(0);
  });

  it('carries the flags GAME_SPEC §14 asks for', () => {
    expect(def('rimeshade').ghost).toBe(true);
    for (const k of OSSUARY_MONSTERS) if (k !== 'rimeshade') expect(def(k).ghost ?? false, k).toBe(false);
    // The golem is armoured like the brute (a little less), heavy like every big body.
    expect(def('ossuaryGolem').heavy).toBe(true);
    expect(def('ossuaryGolem').hitReduction).toBeGreaterThan(0.2);
    expect(def('ossuaryGolem').hitReduction).toBeLessThanOrEqual(def('ironhideBrute').hitReduction!);
    expect(def('boneChorister').heavy).toBe(true);
    expect(def('boneChorister').role).toBe('lieutenant');
    expect(def('hollowWarden').heavy).toBe(true);
    expect(def('hollowWarden').role).toBe('boss');
    expect(def('hollowWarden').boss?.phases).toEqual([0.66, 0.33]);
    // Lieutenant and boss never join regular packs.
    expect(def('boneChorister').fromWave).toBe(0);
    expect(def('hollowWarden').fromWave).toBe(0);
  });

  it('brings the family in wave by wave: thralls and wisps first, then shades and weavers, golems from wave 4', () => {
    const { run, world } = createRunInternal(makeConfig({ theme: 'rimedOssuary', seed: 3 }));
    run.addPlayer(makeJoin(1));
    const fams = (wave: number) => new Set(planWave(world, wave).families);
    expect([...fams(1)].sort()).toEqual(['boneThrall', 'glacialWisp']);
    for (const k of ['rimeshade', 'frostWeaver'] as const) expect(fams(2).has(k), k).toBe(true);
    expect(fams(3).has('ossuaryGolem')).toBe(false);
    expect(fams(4).has('ossuaryGolem')).toBe(true);
    // Few weavers and golems per pack (roots and slams, not walls of them); the thralls are the bulk.
    for (let wave = 1; wave <= 6; wave++) {
      for (const pk of planWave(world, wave).packs) {
        expect(pk.members.filter((k) => k === 'frostWeaver').length).toBeLessThanOrEqual(2);
        expect(pk.members.filter((k) => k === 'ossuaryGolem').length).toBeLessThanOrEqual(2);
      }
    }
    const w6 = planWave(world, 6);
    const count = (k: MonsterKind) => w6.packs.reduce((n, pk) => n + pk.members.filter((m) => m === k).length, 0);
    expect(count('boneThrall')).toBeGreaterThan(count('ossuaryGolem'));
    expect(planWave(world, 3).lieutenant).toBe(true);
    expect(planWave(world, 6).boss).toBe(true);
  });
});
