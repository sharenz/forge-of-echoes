// Slice B1 wire: slotSigil / unslotSigil and the protocol bump that carries them (old clients reload on a rules change).
import { expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../../src/contracts/net';
import { parseClientMessage } from '../../src/net';

const parse = (c: Record<string, unknown>) => parseClientMessage(JSON.stringify({ t: 'cmd', id: 1, cmd: c }));

it('accepts a beacon area, a slot index 0 or 1 and (to slot) one item uid, and nothing else', () => {
  for (const good of [
    { c: 'slotSigil', areaId: 'furnaceYard', slot: 0, uid: 'i12' },
    { c: 'slotSigil', areaId: 'blackPit', slot: 1, uid: 'i3' },
    { c: 'unslotSigil', areaId: 'emberCitadel', slot: 1 },
  ]) {
    const r = parse(good);
    expect(r.ok && r.value).toEqual({ t: 'cmd', id: 1, cmd: good });
  }
  for (const bad of [
    { c: 'slotSigil', areaId: 'furnaceYard', slot: 0 }, { c: 'slotSigil', areaId: 'moonPalace', slot: 0, uid: 'i1' },
    { c: 'slotSigil', areaId: 'furnaceYard', slot: 2, uid: 'i1' }, { c: 'slotSigil', areaId: 'furnaceYard', slot: -1, uid: 'i1' },
    { c: 'slotSigil', areaId: 'furnaceYard', slot: 0.5, uid: 'i1' }, { c: 'slotSigil', areaId: 'furnaceYard', slot: 0, uid: 'i 1' },
    { c: 'slotSigil', areaId: 'furnaceYard', slot: 0, uid: 'i1', extra: 1 },
    { c: 'unslotSigil', areaId: 'furnaceYard' }, { c: 'unslotSigil', areaId: 'furnaceYard', slot: '0' }, { c: 'unslotSigil', areaId: 'furnaceYard', slot: 0, uid: 'i1' },
  ]) expect(parse(bad).ok, JSON.stringify(bad)).toBe(false);
});

it('bumped the protocol for the sigil ids and the beacon commands', () => {
  // 28: the skill rework (R2) bumped it again on top of the sigils.
  expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(27);
});
