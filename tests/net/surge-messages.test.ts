// Slice G1 wire: the refillSurge command (Hourglass Sand on one area, a Grand Hourglass on all) and the protocol bump that carries it.
import { expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../../src/contracts/net';
import { parseClientMessage } from '../../src/net';

const parse = (c: Record<string, unknown>) => parseClientMessage(JSON.stringify({ t: 'cmd', id: 1, cmd: c }));

it('accepts exactly one of an area or all, and nothing else', () => {
  for (const good of [{ c: 'refillSurge', areaId: 'furnaceYard' }, { c: 'refillSurge', all: true }]) {
    const r = parse(good);
    expect(r.ok && r.value).toEqual({ t: 'cmd', id: 1, cmd: good });
  }
  for (const bad of [
    { c: 'refillSurge' }, { c: 'refillSurge', areaId: 'furnaceYard', all: true }, { c: 'refillSurge', all: false }, { c: 'refillSurge', all: 1 },
    { c: 'refillSurge', areaId: 'moonPalace' }, { c: 'refillSurge', areaId: 7 }, { c: 'refillSurge', areaId: 'furnaceYard', extra: 1 },
  ]) expect(parse(bad).ok, JSON.stringify(bad)).toBe(false);
});

it('the protocol moved past the surge-less versions', () => {
  expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(22);
});
