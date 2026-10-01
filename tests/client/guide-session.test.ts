// The `guide` action on the client: applied at once (predicted with the server's own pure rule), sent as one command, never sent when it
// changes nothing, never toasting, and rolled back when the server refuses.
import { describe, expect, it } from 'vitest';
import { newGuide } from '../../src/game/progression/guide';
import { answer, commands, enter, feed, flush, rig } from './rig';

function ready() {
  const r = rig();
  r.ch = { ...r.ch, guide: newGuide() };
  enter(r);
  return r;
}

describe('GameSession.guide', () => {
  it('records a step on screen at once and sends one command', () => {
    const r = ready();
    r.session.guide({ op: 'done', id: 'device' });
    expect(r.box.get().character?.guide?.done).toEqual(['device']);
    expect(commands(r)).toEqual([{ c: 'guide', op: 'done', id: 'device' }]);
  });

  it('does not send what is already recorded', () => {
    const r = ready();
    r.session.guide({ op: 'done', id: 'device' });
    answer(r, true);
    const before = commands(r).length;
    r.session.guide({ op: 'done', id: 'device' });
    expect(commands(r)).toHaveLength(before);
  });

  it('is silent when the server refuses: the prediction goes, no toast', async () => {
    const r = ready();
    r.session.guide({ op: 'hint', id: 'lowLife' });
    expect(r.box.get().character?.guide?.hints).toEqual(['lowLife']);
    answer(r, false, { error: 'Nope.' });
    await flush();
    expect(r.box.get().character?.guide?.hints ?? []).toEqual([]);
    expect(r.box.get().toasts).toHaveLength(0);
  });

  it('skip, replay and finish switch the mode', () => {
    const r = ready();
    r.session.guide({ op: 'skip' });
    expect(r.box.get().character?.guide).toMatchObject({ mode: 'skipped', skippedBy: 'player' });
    answer(r, true);
    r.session.guide({ op: 'replay' });
    expect(r.box.get().character?.guide).toMatchObject({ mode: 'active', done: [], replays: 1 });
  });

  it('does nothing for a character that has no guide yet (the server decides it first)', () => {
    const r = rig();
    enter(r);
    r.session.guide({ op: 'done', id: 'device' });
    expect(commands(r)).toHaveLength(0);
  });

  it('takes the account projection the server pushes', () => {
    const r = ready();
    feed(r, { t: 'character', character: { ...r.ch, guide: { ...newGuide(), done: ['device', 'area'] } } });
    expect(r.box.get().character?.guide?.done).toEqual(['device', 'area']);
  });
});
