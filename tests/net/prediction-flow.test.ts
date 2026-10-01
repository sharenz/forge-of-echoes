// Conveyor belts (layout flow zones, D 10.5a) and client prediction: the client derives the belts from the area layout and
// ZoneInfo.flowSeed alone (no snapshot field), so a predicted step on a belt, through a wall of crates and through a reversal's telegraph,
// lands exactly where the server's does: no rubber-banding, no snaps, and the learned base speed ignores the drift.
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/contracts/sim';
import { areaRadius } from '../../src/data/layouts/area';
import { compileLayout, flowFieldFor, layoutFor, flowPhaseAt, type FlowZone } from '../../src/data/layouts';
import { NetHarness } from './harness';
import { makeProp } from './fixtures';

const R = areaRadius('ironMarch');
const layout = layoutFor('ironMarch')!;
const props = compileLayout(layout, R).props.filter((p) => p.radius > 0).map((p, k) => makeProp({ id: k + 1, kind: p.kind, x: p.x, y: p.y, radius: p.radius }));

function compare(h: NetHarness, fromSeq: number): { compared: number; maxErr: number } {
  let compared = 0;
  let maxErr = 0;
  for (const [seq, pred] of h.predictedAt) {
    if (seq < fromSeq) continue;
    const auth = h.serverAt.get(seq);
    if (!auth) continue;
    maxErr = Math.max(maxErr, Math.hypot(pred.x - auth.x, pred.y - auth.y));
    compared++;
  }
  return { compared, maxErr };
}

/** First reversal of the lane-0 belt for `seed` (seconds): the walk below is timed round it. */
function firstReversal(seed: number): { start: number; zone: FlowZone } {
  const field = flowFieldFor('ironMarch', R, seed)!;
  const zone = field.zones.find((z) => z.id === 'belt-0')!;
  return { start: zone.evT[0], zone };
}

describe('prediction on a conveyor belt', () => {
  it('equals the server on a belt: with it, against it, into a crate rail, and through a reversal', () => {
    const seed = 12345;
    const { start, zone } = firstReversal(seed);
    // Walk the centre lane (y = 0) east then west so she rides with and against whichever way it runs, bumping the lane's crate rails when she
    // strays (steered by a slow weave), for long enough to cover the whole reversal (telegraph + ramp).
    const h = new NetHarness({ latencyMs: 45, moveSpeed: 110, arenaRadius: R, props, startX: -150, startY: 0, flow: { areaId: 'ironMarch', seed } });
    const t0 = Math.max(0, start - 4);
    h.run((t0 + 12) * 1000, (seq) => {
      const t = seq * SIM_DT;
      const weave = Math.sin(seq * 0.05) * 0.6; // wanders into the rails now and then
      if (t < t0 + 3) return { moveX: 0, moveY: 0 }; // standing still: carried
      return { moveX: Math.floor(t / 4) % 2 === 0 ? 1 : -1, moveY: weave };
    });

    const { compared, maxErr } = compare(h, 60);
    expect(compared).toBeGreaterThan(500);
    expect(maxErr).toBeLessThan(1e-3);
    expect(h.client.stats().snaps).toBe(0);
    expect(h.client.stats().moveSpeed).toBeCloseTo(110, 3); // the drift is not part of her speed
    // The run really covered the reversal: the belt passed through a standstill while she was predicted.
    const ph = flowPhaseAt(zone, start + 0.5);
    expect(ph.phase).toBe(1);
    expect(h.serverTick * SIM_DT).toBeGreaterThan(start + zone.reverse!.telegraph + zone.reverse!.ramp);
  });

  it('a body standing still on the belt is carried at the belt speed, and the client agrees', () => {
    const h = new NetHarness({ latencyMs: 40, moveSpeed: 110, arenaRadius: R, props, startX: -150, startY: 0, flow: { areaId: 'ironMarch', seed: 7 } });
    h.run(1500, () => ({ moveX: 0, moveY: 0 }));
    const field = flowFieldFor('ironMarch', R, 7)!;
    const sign = field.zones.find((z) => z.id === 'belt-0')!.sign0;
    // 1.5 s at 48 u/s (the first 8 u of the belt edge feather in): about 70 u along the belt, in its direction.
    expect(Math.sign(h.player.x + 150)).toBe(sign);
    expect(Math.abs(h.player.x + 150)).toBeGreaterThan(55);
    expect(Math.abs(h.player.x + 150)).toBeLessThan(75);
    expect(Math.abs(h.player.y)).toBeLessThan(1e-6);
    const { compared, maxErr } = compare(h, 10);
    expect(compared).toBeGreaterThan(30);
    expect(maxErr).toBeLessThan(1e-3);
  });
});
