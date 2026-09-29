// Balance across the three map types (GAME_SPEC §7, §13, §14): the real rules, the real sim and the scripted bot of
// playthrough.ts, per map base. It guards the promise that matters most to a new player: whichever map she opens
// first — the Ashen Forge or the Rimed Ossuary of her starting kit, or the Iron Coliseum Rook hands out for free —
// she clears Tier 1 with the starting kit, levelling as she plays.
//
// Always on (about ten seconds): one new character per theme clears its Tier 1 alone.
// On demand (BALANCE=1, about two minutes):
//   • new characters clear Tier 1 of every theme on four seeds alone and on two seeds as a pair;
//   • debuffs never chain-lock a player (GAME_SPEC §13): a careless player who stops walking 1.2 s in every 3 s
//     (so every web, hook, tar pool, wisp burst and Ice Prison lands) is held — rooted or frozen — for at most 40%
//     of any 10 s, a freeze is always followed by its immunity, and Rift Step breaks roots.
// The Tier 1–6 ladder across themes (clear times, margins, boss fights) is tests/game-progression/balance-ladder.test.ts.
//
//   BALANCE=1 npx vitest run tests/game-progression/balance-themes.test.ts
import { describe, expect, it } from 'vitest';
import { MAP_BASE_IDS, type MapBaseId } from '../../src/contracts/content';
import type { CharacterSave, MapItem } from '../../src/contracts/items';
import { SIM_DT } from '../../src/contracts/sim';
import { rules } from '../../src/game';
import { createMapItem } from '../../src/game/progression';
import { createRun } from '../../src/sim';
import { FREEZE_DURATION, FREEZE_IMMUNITY, ROOT_DURATION } from '../../src/sim/constants';
import { createBot } from '../sim/bot';
import { describePlay, mapInBag, playParty, spendPoints, upgradeGear, type PlayResult } from './playthrough';

const MINUTES = 60;
const enabled = !!process.env.BALANCE;

/**
 * A new character's Tier 1 of `theme`: the one in her starting kit when she has it, else Rook's free one — the map
 * a player actually opens. Returns the character (after the purchase) and the map.
 */
function tier1(ch: CharacterSave, theme: MapBaseId): { character: CharacterSave; map: MapItem } {
  const own = mapInBag(ch, (m) => m.baseId === theme && m.tier === 1);
  if (own) return { character: ch, map: own };
  const bought = rules.buyOffer(ch, `map-t1-${theme}`);
  if (!bought.ok || bought.value.item.kind !== 'map') throw new Error(`Rook sells no Tier 1 ${theme}`);
  return { character: bought.value.character, map: bought.value.item };
}

/** New characters (the first one opens the map) play Tier 1 of `theme` together; one result per member. */
function freshTier1(theme: MapBaseId, seed: number, size = 1): PlayResult[] {
  const party = Array.from({ length: size }, (_, i) => rules.createCharacter(i === 0 ? 'Balance' : `Friend${i}`, seed + 100 * i));
  const { character, map } = tier1(party[0], theme);
  return playParty([character, ...party.slice(1)], map, { maxMinutes: 20 });
}

/** A healthy first map: cleared in time without dying, under real pressure, and it levels her up. */
function expectHealthyTier1(r: PlayResult): void {
  expect(r.result, describePlay(r)).toBe('cleared');
  expect(r.deaths, describePlay(r)).toBe(0);
  expect(r.seconds, describePlay(r)).toBeLessThanOrEqual(12 * MINUTES);
  expect(r.levelEnd, describePlay(r)).toBeGreaterThanOrEqual(4);
}

describe('a new character clears Tier 1 of every map type (always on)', () => {
  for (const theme of MAP_BASE_IDS) {
    it(`${theme}: cleared alone with the starting kit, and it pushes back`, () => {
      const [r] = freshTier1(theme, 1);
      console.log(`[balance] new character, ${describePlay(r)}`);
      expect(r.setup.map.baseId).toBe(theme);
      expectHealthyTier1(r);
      // Not a stroll: the horde gets to her.
      expect(r.minLife, 'lowest life on a cleared Tier 1').toBeLessThan(0.9);
    }, 60_000);
  }
});

// ---------------------------------------------------------------------------------------------------------
// Debuff lock (GAME_SPEC §13)
// ---------------------------------------------------------------------------------------------------------

/** 10 s window for the "held" share. */
const WINDOW_TICKS = Math.round(10 / SIM_DT);

interface LockReport {
  result: 'cleared' | 'died' | 'timeout';
  /** Most seconds rooted or frozen within any 10 s. */
  heldIn10s: number;
  /** Longest unbroken stretch rooted or frozen (s). */
  longestHeld: number;
  roots: number;
  /** Roots that ended early (Rift Step). */
  rootsBroken: number;
  freezes: number;
  /** Shortest time from one freeze starting to the next (s; Infinity with fewer than two). */
  freezeGap: number;
}

/**
 * A careless player plays `map`: the bot, except that she stops walking for 1.2 s in every 3 s (still casting and
 * drinking) — slow webs, hooks, tar, wisp bursts and closing Ice Prisons all land on her. Loot is left on the floor;
 * XP levels her up as usual. Measures how long she is held in place.
 */
function playCareless(start: CharacterSave, map: MapItem): LockReport {
  let ch = spendPoints({ ...start, mapDevice: map });
  const opened = rules.openMap(ch);
  if (!opened.ok) throw new Error(opened.error);
  const setup = opened.value.setup;
  ch = opened.value.character;
  const run = createRun(rules.buildRunConfig(setup, { rollKillLoot: () => [], rollChestLoot: () => [], tryPickup: () => false }));
  run.addPlayer({ id: 1, name: ch.name, level: ch.level, runtime: rules.playerRuntime(ch, setup) });
  const bot = createBot({ collectDrops: false });
  const out: LockReport = { result: 'timeout', heldIn10s: 0, longestHeld: 0, roots: 0, rootsBroken: 0, freezes: 0, freezeGap: Infinity };
  const held = new Uint8Array(WINDOW_TICKS);
  let heldSum = 0;
  let run0 = 0;
  let wasRooted = false;
  let wasFrozen = false;
  let rootLeft = 0;
  let lastFreeze = -Infinity;
  const every = Math.round(3 / SIM_DT);
  const idle = Math.round(1.2 / SIM_DT);
  for (let t = 0; t < Math.round((20 * MINUTES) / SIM_DT); t++) {
    const intent = bot.intent(run.view, 1);
    if (t % every < idle) {
      intent.moveX = 0;
      intent.moveY = 0;
    }
    run.setIntent(1, intent);
    run.step();
    run.drainEvents();
    const p = run.view.players[0];
    const rooted = !p.dead && p.debuffs.some((d) => d.id === 'rooted' && d.remaining > 0);
    const frozen = !p.dead && p.debuffs.some((d) => d.id === 'frozen' && d.remaining > 0);
    if (rooted && !wasRooted) out.roots++;
    if (!rooted && wasRooted && !p.dead && rootLeft > 3 * SIM_DT) out.rootsBroken++;
    if (frozen && !wasFrozen) {
      out.freezes++;
      out.freezeGap = Math.min(out.freezeGap, (t - lastFreeze) * SIM_DT);
      lastFreeze = t;
    }
    const h = rooted || frozen ? 1 : 0;
    heldSum += h - held[t % WINDOW_TICKS];
    held[t % WINDOW_TICKS] = h;
    out.heldIn10s = Math.max(out.heldIn10s, heldSum * SIM_DT);
    run0 = h ? run0 + 1 : 0;
    out.longestHeld = Math.max(out.longestHeld, run0 * SIM_DT);
    wasRooted = rooted;
    wasFrozen = frozen;
    rootLeft = p.debuffs.find((d) => d.id === 'rooted')?.remaining ?? 0;
    let done = false;
    for (const o of run.drainOutcomes()) {
      if (o.t === 'xp') {
        const g = rules.grantXp(ch, o.amount);
        ch = g.character;
        if (g.levelsGained > 0) {
          ch = spendPoints(ch);
          run.updatePlayer(1, { ...rules.playerRuntime(ch, setup), restore: true });
        }
      } else if (o.t === 'flaskUsed') ch = rules.consumeFlask(ch, o.slot);
      else if (o.t === 'playerDied') {
        out.result = 'died';
        done = true;
      } else if (o.t === 'cleared') {
        out.result = 'cleared';
        done = true;
      }
    }
    if (done) break;
  }
  return out;
}

/** A character after a Tier 1, Tier 1, Tier 2 (one map of each theme), gear upgraded between maps: on level for Tier 3. */
function readyForTier3(seed: number): CharacterSave {
  let ch = rules.createCharacter('Careless', seed);
  const tiers = [1, 1, 2];
  tiers.forEach((tier, k) => {
    const theme = MAP_BASE_IDS[(seed + k) % MAP_BASE_IDS.length];
    const r = playParty([ch], createMapItem(theme, tier, `careless-${seed}-${k}`), { maxMinutes: 20 })[0];
    ch = upgradeGear(r.character);
  });
  return ch;
}

describe.runIf(enabled)('balance across map types (BALANCE=1)', () => {
  it('new characters clear Tier 1 of every map type on every seed, alone and as a pair', () => {
    for (const theme of MAP_BASE_IDS) {
      for (const seed of [1, 2, 3, 4]) {
        const [r] = freshTier1(theme, seed);
        console.log(`[balance] new character, seed ${seed}, ${describePlay(r)}`);
        expectHealthyTier1(r);
      }
      const pairs = [1, 2].flatMap((seed) => {
        const pair = freshTier1(theme, seed, 2);
        pair.forEach((r, k) => console.log(`[balance] new pair, seed ${seed}, member ${k + 1}: ${describePlay(r)}`));
        return pair;
      });
      for (const r of pairs) expectHealthyTier1(r);
      // Party scaling keeps the pressure on: someone gets hurt.
      expect(Math.min(...pairs.map((r) => r.minLife)), `${theme}: lowest life of the pairs`).toBeLessThan(0.9);
    }
  }, 600_000);

  it('debuffs never chain-lock a careless player: held ≤ 40% of any 10 s, freeze immunity holds, Rift Step breaks roots', () => {
    const reports: { label: string; r: LockReport }[] = [];
    for (const theme of ['rimedOssuary', 'ironColiseum'] as const) {
      reports.push({ label: `${theme} T1 (new character)`, r: playCareless(rules.createCharacter('Careless', 2), createMapItem(theme, 1, `careless-${theme}-1`)) });
      reports.push({ label: `${theme} T3`, r: playCareless(readyForTier3(2), createMapItem(theme, 3, `careless-${theme}-3`)) });
    }
    for (const { label, r } of reports) {
      console.log(`[balance] careless ${label}: ${r.result}, held ${r.heldIn10s.toFixed(2)} s of 10 s at most, longest ${r.longestHeld.toFixed(2)} s, `
        + `roots ${r.roots} (${r.rootsBroken} broken), freezes ${r.freezes}${r.freezes > 1 ? ` (≥ ${r.freezeGap.toFixed(1)} s apart)` : ''}`);
      expect(r.heldIn10s, label).toBeLessThanOrEqual(4);
      // A root and a freeze may overlap, but nothing holds her longer than one of each back to back.
      expect(r.longestHeld, label).toBeLessThanOrEqual(ROOT_DURATION + FREEZE_DURATION + SIM_DT);
      if (r.freezes > 1) expect(r.freezeGap, label).toBeGreaterThanOrEqual(FREEZE_IMMUNITY);
    }
    // The roster really roots and freezes her (the guard above isn't vacuous)…
    expect(reports.reduce((n, { r }) => n + r.roots, 0)).toBeGreaterThan(10);
    expect(reports.reduce((n, { r }) => n + r.freezes, 0)).toBeGreaterThan(0);
    // …and once she has Rift Step, it breaks roots.
    expect(reports.filter(({ label }) => label.endsWith('T3')).reduce((n, { r }) => n + r.rootsBroken, 0)).toBeGreaterThan(0);
  }, 600_000);
});
