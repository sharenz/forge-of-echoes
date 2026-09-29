// World clicks: open portals under the cursor (which kinds count where, the pick box, nearest wins) and the click
// routing the app runs (resolveWorldClick) — a ground item beats a portal or hideout object, which beat the basic
// attack; the last frame's highlight counts only for a click near where it was shown.
import { describe, expect, it } from 'vitest';
import type { PropView } from '../../src/contracts/sim';
import {
  HOVER_DROP_SLOP_PX, HOVER_PROP_SLOP_PX, isUsablePortal, panelForProp, pickClickableProp, pickPortal, propClick, resolveWorldClick,
  type HoverSnapshot, type WorldClickInput,
} from '../../src/client/world-pick';
import { prop } from './helpers';

describe('pickPortal', () => {
  it('finds an open map portal in the hideout and an open return portal in a map', () => {
    const props = [prop(1, 'portal', 100, 0, 8), prop(2, 'returnPortal', -100, 0, 1), prop(3, 'mapDevice', 0, 0)];
    expect(pickPortal(props, 100, -20, 'hideout')).toBe(1);
    expect(pickPortal(props, -100, -20, 'hideout')).toBe(-1);
    expect(pickPortal(props, -100, -20, 'map')).toBe(2);
    expect(pickPortal(props, 100, -20, 'map')).toBe(-1);
  });

  it('ignores closed portals and points outside the silhouette', () => {
    const props = [prop(1, 'portal', 0, 0, 0)];
    expect(isUsablePortal(props[0], 'hideout')).toBe(false);
    expect(pickPortal(props, 0, -20, 'hideout')).toBe(-1);
    const open = [prop(1, 'portal', 0, 0, 3)];
    expect(pickPortal(open, 0, -47, 'hideout')).toBe(1); // top of the arch
    expect(pickPortal(open, 0, -60, 'hideout')).toBe(-1); // above it
    expect(pickPortal(open, 30, -20, 'hideout')).toBe(-1); // beside it
  });

  it('prefers the portal whose body is nearest', () => {
    const props = [prop(1, 'portal', 0, 0, 1), prop(2, 'portal', 20, 0, 1)];
    expect(pickPortal(props, 4, -24, 'hideout')).toBe(1);
    expect(pickPortal(props, 16, -24, 'hideout')).toBe(2);
  });
});

describe('click priority: item > prop > attack (resolveWorldClick)', () => {
  const props = [prop(1, 'mapDevice', 0, -180), prop(2, 'stash', -200, 0), prop(3, 'merchant', 200, 0), prop(4, 'anvil', -180, 80), prop(5, 'portal', 60, -150, 8), prop(6, 'brazier', 0, 0)];
  const NO_HOVER: HoverSnapshot = { x: -1, y: -1, dropId: -1, propId: -1 };

  /** A click at (400, 300) with nothing highlighted; `at` is what lies under the click point itself. */
  function click(p: Partial<WorldClickInput> & { at?: number; drops?: number[] } = {}) {
    const drops = new Set(p.drops ?? [12]);
    let asked = 0;
    const r = resolveWorldClick({
      x: 400,
      y: 300,
      zone: 'hideout',
      props,
      dropAt: -1,
      hover: NO_HOVER,
      hasDrop: (id) => drops.has(id),
      propAt: () => {
        asked++;
        return p.at ?? -1;
      },
      ...p,
    });
    return { r, asked };
  }

  it('a ground item under the click always wins', () => {
    expect(click({ dropAt: 12, at: 1 }).r).toEqual({ kind: 'pickup', dropId: 12 });
    expect(click({ dropAt: 12, at: 5 }).r).toEqual({ kind: 'pickup', dropId: 12 });
    expect(click({ dropAt: 12, zone: 'map' }).r).toEqual({ kind: 'pickup', dropId: 12 });
    // Even over a highlighted portal.
    expect(click({ dropAt: 12, hover: { x: 400, y: 300, dropId: -1, propId: 5 } }).r).toEqual({ kind: 'pickup', dropId: 12 });
  });

  it('the highlighted item counts for a click right where it was highlighted, not after the pointer moved', () => {
    const hover = { x: 400, y: 300, dropId: 12, propId: -1 };
    expect(click({ hover }).r).toEqual({ kind: 'pickup', dropId: 12 });
    expect(click({ hover: { ...hover, x: 400 - HOVER_DROP_SLOP_PX } }).r).toEqual({ kind: 'pickup', dropId: 12 });
    expect(click({ hover: { ...hover, x: 400 - HOVER_DROP_SLOP_PX - 1 } }).r).toEqual({ kind: 'none' });
  });

  it('an item that just vanished falls through to what else is there', () => {
    expect(click({ dropAt: 12, drops: [], at: 2 }).r).toEqual({ kind: 'panel', panel: 'stash', propId: 2 });
    expect(click({ dropAt: 12, drops: [] }).r).toEqual({ kind: 'none' });
  });

  it('then portals and hideout objects under the click (the anvil opens the Crafting Bench)', () => {
    expect(click({ at: 5 }).r).toEqual({ kind: 'portal', propId: 5 });
    expect(click({ at: 1 }).r).toEqual({ kind: 'panel', panel: 'mapDevice', propId: 1 });
    expect(click({ at: 2 }).r).toEqual({ kind: 'panel', panel: 'stash', propId: 2 });
    expect(click({ at: 3 }).r).toEqual({ kind: 'panel', panel: 'merchant', propId: 3 });
    expect(click({ at: 4 }).r).toEqual({ kind: 'panel', panel: 'craftingBench', propId: 4 });
    expect(panelForProp('anvil')).toBe('craftingBench');
  });

  it('the highlighted object wins for a click near its highlight (the camera lean slid it away from the pointer)', () => {
    const hover = { x: 390, y: 310, dropId: -1, propId: 2 };
    const { r, asked } = click({ hover, at: -1 });
    expect(r).toEqual({ kind: 'panel', panel: 'stash', propId: 2 });
    expect(asked).toBe(0);
    expect(click({ hover: { ...hover, x: 400 - HOVER_PROP_SLOP_PX } }).r).toEqual({ kind: 'panel', panel: 'stash', propId: 2 });
  });

  it('a flick away from a highlighted portal uses what is under the click, never the stale highlight', () => {
    // The portal was highlighted at (100, 120) in the last frame; the click lands on a monster far away.
    const hover = { x: 100, y: 120, dropId: -1, propId: 5 };
    expect(click({ hover, at: -1 }).r).toEqual({ kind: 'none' });
    // …or on another object: that one.
    expect(click({ hover, at: 3 }).r).toEqual({ kind: 'panel', panel: 'merchant', propId: 3 });
    // Just outside the slop on one axis is already a flick.
    expect(click({ hover: { ...hover, x: 400, y: 300 - HOVER_PROP_SLOP_PX - 1 }, at: -1 }).r).toEqual({ kind: 'none' });
  });

  it('a highlight that no longer does anything (portal closed meanwhile) falls back to the click point', () => {
    const closed = props.map((p) => (p.id === 5 ? { ...p, state: 0 } : p));
    expect(click({ props: closed, hover: { x: 400, y: 300, dropId: -1, propId: 5 }, at: -1 }).r).toEqual({ kind: 'none' });
    expect(click({ props: closed, hover: { x: 400, y: 300, dropId: -1, propId: 5 }, at: 1 }).r).toEqual({ kind: 'panel', panel: 'mapDevice', propId: 1 });
  });

  it('anything else is the basic attack', () => {
    expect(click().r).toEqual({ kind: 'none' });
    expect(click({ at: 6 }).r).toEqual({ kind: 'none' }); // decoration
    expect(click({ at: 99 }).r).toEqual({ kind: 'none' }); // gone
    // Hideout objects do nothing in a map; a closed portal does nothing anywhere.
    expect(propClick([prop(1, 'stash', 0, 0)], 1, 'map')).toEqual({ kind: 'none' });
    expect(click({ zone: 'map', at: 2 }).r).toEqual({ kind: 'none' });
    expect(propClick([prop(5, 'portal', 0, 0, 0)], 5, 'hideout')).toEqual({ kind: 'none' });
    expect(propClick([prop(7, 'returnPortal', 0, 0, 1)], 7, 'map')).toEqual({ kind: 'portal', propId: 7 });
  });

  it('pickClickableProp: an interactive prop a click would use, else an unflagged open portal', () => {
    const picker = (id: number) => (_props: readonly PropView[], _x: number, _y: number) => id;
    expect(pickClickableProp(props, 0, 0, 'hideout', picker(4))).toBe(4);
    // The interactive pick is not clickable here (hideout objects in a map): fall back to the portal pick.
    expect(pickClickableProp(props, 0, 0, 'map', picker(1))).toBe(-1);
    const unflagged: PropView[] = [{ ...prop(8, 'portal', 0, 0, 3), interactive: false }];
    expect(pickClickableProp(unflagged, 0, -20, 'hideout', picker(-1))).toBe(8);
  });
});
