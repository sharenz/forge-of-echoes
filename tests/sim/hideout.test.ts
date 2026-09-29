import { describe, expect, it } from 'vitest';
import { MONSTER_KINDS } from '../../src/contracts/content';
import { SIM_DT, type SimRun } from '../../src/contracts/sim';
import { STRONG_LOADOUT, idleIntent, makeJoin, makeSolo, strongSkills, strongStats } from './fixtures';
import { hold, ofType, outcomesOf, pv, stepN, walkIntent, type Recorded } from './helpers';

const strong = { stats: strongStats(), skills: strongSkills(), loadout: STRONG_LOADOUT };

function hideout() {
  return makeSolo({ mode: 'hideout', ...strong }).run;
}

function walkTo(run: SimRun, x: number, y: number, n: number, id = 1): Recorded {
  return stepN(run, n, () => {
    const p = pv(run, id);
    return Math.hypot(x - p.x, y - p.y) > 1.5 ? walkIntent(p.x, p.y, x, y) : idleIntent();
  }, id);
}

describe('hideout', () => {
  it('lays out the courtyard: device north, stash west, merchant east, dummy south; no waves', () => {
    const run = hideout();
    const props = run.view.props;
    const find = (k: string) => props.find((p) => p.kind === k)!;
    expect(find('mapDevice').y).toBeLessThan(-50);
    expect(find('mapDevice').interactive).toBe(true);
    expect(find('stash').x).toBeLessThan(-50);
    expect(find('stash').interactive).toBe(true);
    expect(find('merchant').x).toBeGreaterThan(50);
    expect(find('merchant').interactive).toBe(true);
    expect(props.filter((p) => p.kind === 'brazier').length).toBeGreaterThanOrEqual(4);
    // The anvil is the Crafting Bench: clickable, in the west crafting corner beside the stash.
    expect(find('anvil').interactive).toBe(true);
    expect(find('anvil').x).toBeLessThan(-50);
    expect(Math.hypot(find('anvil').x - find('stash').x, find('anvil').y - find('stash').y)).toBeLessThan(90);
    // Only the stations are clickable (decor never is; the portal only while open).
    expect(props.filter((p) => p.interactive).map((p) => p.kind).sort()).toEqual(['anvil', 'mapDevice', 'merchant', 'stash']);
    expect(props.some((p) => p.kind === 'banner')).toBe(true);
    expect(props.some((p) => p.kind === 'pillar')).toBe(true);
    expect(props.some((p) => p.kind === 'portal')).toBe(false);
    const m = run.view.monsters;
    let dummy = -1;
    for (let i = 0; i < m.capacity; i++) if (m.alive[i]) dummy = i;
    expect(MONSTER_KINDS[m.kind[dummy]]).toBe('trainingDummy');
    expect(m.y[dummy]).toBeGreaterThan(50);
    const r = stepN(run, Math.round(10 / SIM_DT));
    expect(run.view.run.phase).toBe('hideout');
    expect(run.view.run.wave).toBe(0);
    expect(run.view.run.playersAlive).toBe(1);
    expect(r.outcomes.filter((o) => o.t === 'waveStart')).toHaveLength(0);
    expect(ofType(r.events, 'waveTell')).toHaveLength(0);
  });

  it('the training dummy shows damage numbers, plays its struck animation and never dies', () => {
    const run = hideout();
    const m = run.view.monsters;
    let dummy = -1;
    for (let i = 0; i < m.capacity; i++) if (m.alive[i]) dummy = i;
    let struck = 0;
    const all = stepN(run, Math.round(20 / SIM_DT), () => {
      if (m.anim[dummy] === 3) struck++;
      const it = hold(0, m.x[dummy], m.y[dummy]);
      it.held[2] = true; // arc chain
      return it;
    });
    const hits = ofType(all.events, 'hit').filter((h) => h.target === 'monster');
    expect(hits.length).toBeGreaterThan(20);
    expect(hits.every((h) => h.kind === 'trainingDummy' && !h.killed && h.playerId === 1)).toBe(true);
    expect(struck).toBeGreaterThan(0);
    expect(m.alive[dummy]).toBe(1);
    expect(all.outcomes.filter((o) => o.t === 'kill' || o.t === 'xp')).toHaveLength(0);
  });

  it('setPortal shows the map portal by the device with its remaining count; walking in enters it', () => {
    const run = hideout();
    expect(run.view.run.portalOpen).toBe(false);
    run.setPortal(8);
    run.setPortal(8); // idempotent
    const portals = run.view.props.filter((p) => p.kind === 'portal');
    expect(portals).toHaveLength(1);
    const portal = portals[0];
    expect(portal.state).toBe(8);
    expect(run.view.run.portalOpen).toBe(true);
    const device = run.view.props.find((p) => p.kind === 'mapDevice')!;
    expect(Math.hypot(portal.x - device.x, portal.y - device.y)).toBeLessThan(80);
    const opened = run.drainEvents();
    expect(ofType(opened, 'portal').filter((e) => e.kind === 'open')).toHaveLength(1);
    const r = walkTo(run, portal.x, portal.y, 300);
    expect(outcomesOf(r.outcomes, 'enterPortal')).toEqual([{ t: 'enterPortal', playerId: 1 }]);
    expect(ofType(r.events, 'portal').filter((e) => e.kind === 'enter' && e.playerId === 1)).toHaveLength(1);
    // Stepping out and back in enters again (the server may have refused the first entry).
    walkTo(run, portal.x, portal.y + 60, 120);
    const again = walkTo(run, portal.x, portal.y, 200);
    expect(outcomesOf(again.outcomes, 'enterPortal')).toHaveLength(1);
  });

  it('the portal count follows setPortal; at 0 it is hidden and cannot be entered', () => {
    const run = hideout();
    run.setPortal(8);
    const portal = run.view.props.find((p) => p.kind === 'portal')!;
    const id = portal.id;
    run.setPortal(3);
    expect(portal.state).toBe(3);
    run.setPortal(0);
    expect(portal.state).toBe(0);
    expect(run.view.run.portalOpen).toBe(false);
    run.drainEvents();
    const r = walkTo(run, portal.x, portal.y, 300);
    expect(outcomesOf(r.outcomes, 'enterPortal')).toHaveLength(0);
    // Reopened (a new map): same prop, new count, an 'open' cue, and it works again.
    walkTo(run, portal.x, portal.y + 70, 150);
    run.setPortal(8);
    expect(run.view.props.filter((p) => p.kind === 'portal').map((p) => p.id)).toEqual([id]);
    expect(portal.state).toBe(8);
    expect(ofType(run.drainEvents(), 'portal').filter((e) => e.kind === 'open')).toHaveLength(1);
    expect(outcomesOf(walkTo(run, portal.x, portal.y, 300).outcomes, 'enterPortal')).toHaveLength(1);
  });

  it('visitors walk the courtyard next to the owner and each enters the portal on their own', () => {
    const run = hideout();
    expect(ofType(run.drainEvents(), 'playerJoin').map((e) => e.playerId)).toEqual([1]);
    run.addPlayer(makeJoin(7, { ...strong, name: 'Visitor' }));
    const joins = ofType(run.drainEvents(), 'playerJoin');
    expect(joins.map((e) => e.playerId)).toEqual([7]);
    expect(run.view.players.map((p) => p.id)).toEqual([1, 7]);
    expect(pv(run, 7).name).toBe('Visitor');
    // They don't arrive on top of each other.
    expect(Math.hypot(pv(run, 1).x - pv(run, 7).x, pv(run, 1).y - pv(run, 7).y)).toBeGreaterThan(8);
    run.setPortal(8);
    const portal = run.view.props.find((p) => p.kind === 'portal')!;
    const visitor = walkTo(run, portal.x, portal.y, 300, 7);
    expect(outcomesOf(visitor.outcomes, 'enterPortal')).toEqual([{ t: 'enterPortal', playerId: 7 }]);
    run.removePlayer(7);
    expect(run.view.players.map((p) => p.id)).toEqual([1]);
    const owner = walkTo(run, portal.x, portal.y, 300, 1);
    expect(outcomesOf(owner.outcomes, 'enterPortal')).toEqual([{ t: 'enterPortal', playerId: 1 }]);
  });

  it('the Crafting Bench (anvil) stands on open ground: walkable up to from the spawn, clear of the other stations', () => {
    for (const R of [260, 300]) {
      const { run } = makeSolo({ mode: 'hideout', arenaRadius: R, ...strong });
      const anvil = run.view.props.find((p) => p.kind === 'anvil')!;
      // No solid prop crowds it: a player fits around it on every side.
      for (const p of run.view.props) {
        if (p === anvil || p.radius <= 0) continue;
        expect(Math.hypot(p.x - anvil.x, p.y - anvil.y)).toBeGreaterThan(p.radius + anvil.radius + 2 * 7 + 4);
      }
      // Off the spawn → training dummy line (players shoot the dummy from the spawn).
      const dummyX = 0;
      expect(Math.abs(anvil.x - dummyX)).toBeGreaterThan(60);
      // Walk up to it from the spawn: the player ends right beside it.
      const r = walkTo(run, anvil.x + anvil.radius + 12, anvil.y, 300);
      const p = pv(run);
      expect(Math.hypot(p.x - anvil.x, p.y - anvil.y)).toBeLessThan(anvil.radius + 7 + 8);
      expect(outcomesOf(r.outcomes, 'enterPortal')).toHaveLength(0);
    }
  });

  it('the map portal is clickable exactly while it is open', () => {
    const run = hideout();
    run.setPortal(8);
    const portal = run.view.props.find((p) => p.kind === 'portal')!;
    expect(portal.interactive).toBe(true);
    run.setPortal(1);
    expect(portal.interactive).toBe(true);
    run.setPortal(0);
    expect(portal.interactive).toBe(false);
    run.setPortal(8);
    expect(portal.interactive).toBe(true);
  });

  it('the player cannot walk through solid furniture', () => {
    const run = hideout();
    const stash = run.view.props.find((p) => p.kind === 'stash')!;
    walkTo(run, stash.x, stash.y, 400);
    const p = pv(run);
    expect(Math.hypot(p.x - stash.x, p.y - stash.y)).toBeGreaterThanOrEqual(stash.radius + 7 - 1e-3);
  });
});
