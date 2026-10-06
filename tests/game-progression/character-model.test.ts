// The analytic band model against the printed tables of docs/power-rework/power-curve.md (5.2, 7.1, 7.2, 9.3).
// The model is the specification the rules and the sim are compared with, so it must first agree with the document.
// Always on, a few milliseconds. PRINT=1 prints the tables.
import { describe, expect, it } from 'vitest';
import { BANDS, BAND_MLS, DOC_TABLE, build, clearBreakdown, clearSeconds, incoming, killRate, killTimes, levelFor, monsterRow, packFactor, proofRareSeconds } from './character-model';

const close = (a: number, b: number, tol: number, label: string) => expect(Math.abs(a - b) / Math.max(1e-9, Math.abs(b)), `${label}: ${a.toFixed(3)} vs ${b}`).toBeLessThanOrEqual(tol);

describe('band model reproduces power-curve 5.2', () => {
  it('derives spell power, casts per second, hit and DPS of every printed row within 2%', () => {
    for (const band of BANDS) {
      for (const ml of BAND_MLS) {
        const r = build(ml, band);
        const d = DOC_TABLE[band][ml];
        close(r.spellPower, d.sp, 0.005, `${band} ML${ml} spell power`);
        close(r.castsPerSecond, d.castsPerSecond, 0.01, `${band} ML${ml} casts/s`);
        close(r.hit, d.hit, 0.02, `${band} ML${ml} hit`);
        close(r.dps, d.dps, 0.02, `${band} ML${ml} DPS`);
      }
    }
  });

  it('uses the table level clamp(ML - 2, 3, 80)', () => {
    expect([4, 10, 16, 22, 28, 40, 60, 88].map(levelFor)).toEqual([3, 8, 14, 20, 26, 38, 58, 80]);
  });

  it('spreads single-target power as the document says (fair to endgame about 24x at ML88, 18x at ML60)', () => {
    close(build(88, 'endgame').dps / build(88, 'fair').dps, 24.5, 0.04, 'ML88 spread');
    close(build(60, 'endgame').dps / build(60, 'fair').dps, 18, 0.05, 'ML60 spread');
  });

  it('interpolates between table levels monotonically', () => {
    for (const band of BANDS) {
      let last = 0;
      for (let ml = 4; ml <= 88; ml += 3) {
        const d = build(ml, band).dps;
        expect(d, `${band} ML${ml}`).toBeGreaterThan(last * 0.97);
        last = d;
      }
    }
  });
});

describe('band model reproduces the monster-side tables', () => {
  // 7.1 (boss column, w6) and 6.3 (rare column), in seconds, rounded in the document.
  const BOSS: Record<string, number[]> = {
    fair: [192, 139, 121, 212, 308, 409, 710, 1405], good: [40, 33, 24, 39, 50, 60, 79, 124], endgame: [14, 8, 6, 10, 12, 14, 18, 26],
  };
  const RARE: Record<string, number[]> = {
    fair: [0.8, 1.3, 1.7, 4.1, 7.4, 11.9, 20.7, 40.9], good: [0.3, 0.5, 0.6, 1.2, 2.0, 2.9, 3.8, 6.0], endgame: [0.1, 0.2, 0.2, 0.4, 0.6, 0.9, 1.1, 1.7],
  };
  it('boss and rare times to kill follow 7.1 and 6.3 (curve v3, 12%)', () => {
    for (const band of BANDS) {
      BAND_MLS.forEach((ml, i) => {
        const k = killTimes(ml, band);
        // The printed good-band boss times at ML4 to 16 are 10 to 22% above DPS x uptime (design-ceiling rows of 5.2): wider there.
        close(k.boss, BOSS[band][i], ml < 22 ? 0.25 : 0.12, `${band} ML${ml} boss`);
        if (RARE[band][i] >= 0.5) close(k.rare, RARE[band][i], 0.2, `${band} ML${ml} rare`);
      });
    }
  });

  it('keeps every band inside the targets of 7.1 on the home levels', () => {
    for (const ml of BAND_MLS) {
      const g = killTimes(ml, 'good'), e = killTimes(ml, 'endgame');
      expect(g.boss, `good ML${ml}`).toBeGreaterThanOrEqual(20);
      expect(g.boss, `good ML${ml}`).toBeLessThanOrEqual(130);
      expect(e.boss, `endgame ML${ml}`).toBeGreaterThanOrEqual(5);
      expect(e.boss, `endgame ML${ml}`).toBeLessThanOrEqual(27);
    }
  });

  it('reads the proof-rare matrix of 4.3 (Good ML60: 38 s with no answer, 9.6 s with 30 penetration)', () => {
    close(proofRareSeconds(60, 'good', 0.1), 38, 0.2, 'no answer');
    close(proofRareSeconds(60, 'good', 0.4), 9.6, 0.2, 'pen 30');
  });

  it('hit sizes follow 7.2 (ML28 and ML60, armour build)', () => {
    const rows: [number, 'fair' | 'good' | 'endgame', number, number][] = [
      [28, 'fair', 21.2, 253], [28, 'good', 12.5, 193], [28, 'endgame', 6.7, 136], [60, 'fair', 72.9, 732], [60, 'good', 39.4, 553], [60, 'endgame', 20.7, 392],
    ];
    for (const [ml, band, bite, slam] of rows) {
      const i = incoming(ml, band);
      close(i.biteAbs, bite, 0.12, `${band} ML${ml} bite`);
      close(i.bossSlamAbs, slam, 0.12, `${band} ML${ml} slam`);
    }
  });

  it('the pack factor is 0.8 x min(targets, 6) x 0.85', () => {
    expect(packFactor('fair')).toBeCloseTo(1.02, 5);
    expect(packFactor('good')).toBeCloseTo(2.72, 5);
    expect(packFactor('endgame')).toBeCloseTo(4.08, 5);
  });
});

describe('clear-time model (9.3)', () => {
  const DOC_MIN: Record<string, number[]> = {
    fair: [7.6, 6.3, 5.9, 8.0, 10.3, 12.7, 19.7, 36.0], good: [3.7, 3.6, 3.4, 3.7, 3.9, 4.1, 4.5, 5.5], endgame: [3.0, 2.9, 2.8, 2.9, 3.0, 3.0, 3.1, 3.3],
  };
  it('reproduces the printed minutes per map (8%)', () => {
    for (const band of BANDS) {
      BAND_MLS.forEach((ml, i) => close(clearSeconds(ml, band) / 60, DOC_MIN[band][i], 0.08, `${band} ML${ml} minutes`));
    }
  });

  it('decomposes ML28 as the document does (walk 101, tells 18, loot 45, boss 308 fair)', () => {
    const c = clearBreakdown(28, 'fair');
    close(c.walk, 101, 0.03, 'walk');
    expect(c.tells).toBe(18);
    expect(c.loot).toBe(45);
    close(c.boss, 308, 0.1, 'boss');
  });

  it('a juiced map (monster count x2) costs good +22% and endgame +13% at ML60', () => {
    const rel = (b: 'good' | 'endgame') => clearSeconds(60, b, { density: 2 }) / clearSeconds(60, b) - 1;
    close(rel('good'), 0.22, 0.45, 'good');
    close(rel('endgame'), 0.13, 0.55, 'endgame');
  });

  it('exposes a kill rate for the Atlas harness that grows with the band', () => {
    for (const ml of [16, 40, 64, 88]) {
      const f = killRate(ml, 'fair'), g = killRate(ml, 'good'), e = killRate(ml, 'endgame');
      expect(g.speed).toBeGreaterThan(f.speed * 4);
      expect(e.speed).toBeGreaterThan(g.speed * 1.5);
      expect(monsterRow(ml).lifeScale).toBeGreaterThan(0);
    }
  });
});

if (process.env.PRINT) {
  describe('print', () => {
    it('tables', () => {
      for (const band of BANDS) {
        console.log(`\n${band}\n` + BAND_MLS.map((ml) => {
          const r = build(ml, band), k = killTimes(ml, band), c = clearBreakdown(ml, band);
          return `ML${ml} L${r.level} dps ${r.dps.toFixed(0)} hit ${r.hit.toFixed(0)} boss ${k.boss.toFixed(0)} rare ${k.rare.toFixed(1)} pack ${k.pack.toFixed(2)} clear ${(c.total / 60).toFixed(1)}m (walk ${c.walk.toFixed(0)} kills ${c.kills.toFixed(0)})`;
        }).join('\n'));
      }
    });
  });
}
