// E1, anchor-aware events (docs/atlas-rework/D-territory.md 8, 10.5a and 12 item 13): with a hand-crafted layout live, every event
// is placed on one of the layout's declared anchors of its kind (picked with the run seed, tier-filtered, seated inside the rim);
// without a layout, or when every anchor is blocked, the old radial rules place it exactly as before.
import { afterEach, describe, expect, it } from 'vitest';
import type { AtlasAreaId } from '../../src/contracts/atlas';
import type { MapEventKind } from '../../src/contracts/map-events';
import { layoutFor, overrideLayout, registeredLayouts } from '../../src/data/layouts';
import { areaRadius, areaTheme } from '../../src/data/layouts/area';
import { compileLayout } from '../../src/data/layouts/compile';
import type { AreaLayout, EventAnchorKind } from '../../src/data/layouts/schema';
import { seatAnchor } from '../../src/data/progression/events/anchors';
import { ANVIL_CLEARANCE } from '../../src/data/progression/events/anvil';
import { BELL_CLEARANCE } from '../../src/data/progression/events/bellwatch';
import { HOST_CLEARANCE } from '../../src/data/progression/events/host';
import { ORCHARD_CLEARANCE } from '../../src/data/progression/events/orchard';
import { PACT_CLEARANCE } from '../../src/data/progression/events/pact-altar';
import { RING_SITE_CLEARANCE } from '../../src/data/progression/events/ring';
import {
  ECHO_ANCHOR_CLEARANCE, ECHO_ANCHOR_RIM, FAULT_CLEARANCE, RELAY_SPACING, STALKER_SPAWN_CLEARANCE,
} from '../../src/data/progression/map-events';
import { pickSite } from '../../src/sim/events/kit';
import type { EventInstance } from '../../src/sim/events/types';
import { eventRun, revealed } from './helpers';

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

type XY = { x: number; y: number };

/** Point-like events: the anchor kind, the player clearance of their rule and where their state keeps the site. */
const POINT: { kind: MapEventKind; fits: EventAnchorKind; clear: number; site: (s: any) => XY }[] = [
  { kind: 'hunted', fits: 'perch', clear: STALKER_SPAWN_CLEARANCE, site: (s) => s.site },
  { kind: 'echoRift', fits: 'echo', clear: ECHO_ANCHOR_CLEARANCE, site: (s) => s.anchor },
  { kind: 'wound', fits: 'fault', clear: FAULT_CLEARANCE, site: (s) => s.center },
  { kind: 'pactAltar', fits: 'altar', clear: PACT_CLEARANCE, site: (s) => s.altar },
  { kind: 'orchard', fits: 'orchard', clear: ORCHARD_CLEARANCE, site: (s) => s.blooms[0] },
  { kind: 'ring', fits: 'ring', clear: RING_SITE_CLEARANCE, site: (s) => s.center },
  { kind: 'host', fits: 'host', clear: HOST_CLEARANCE, site: (s) => s.center },
  { kind: 'anvil', fits: 'anvil', clear: ANVIL_CLEARANCE, site: (s) => s.site },
  { kind: 'bellwatch', fits: 'bell', clear: BELL_CLEARANCE, site: (s) => s.bell },
];

function startOf(areaId: AtlasAreaId): XY {
  const l = layoutFor(areaId)!;
  return compileLayout(l, areaRadius(areaId)).start;
}

/** A forced event of `kind` in `areaId` with its layout live, the player(s) at the landing (or `players`), revealed. */
function reveal(kind: MapEventKind, areaId: AtlasAreaId, o: { seed?: number; players?: XY[] } = {}): { e: EventInstance; s: any } & ReturnType<typeof eventRun> {
  const setup = eventRun(kind, {
    areaId, theme: areaTheme(areaId), arenaRadius: areaRadius(areaId), seed: o.seed ?? 7, players: o.players ?? [startOf(areaId)],
  });
  const e = revealed(setup.w, kind);
  return { ...setup, e, s: e.s };
}

const near = (a: XY, b: XY, tol = 2) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

describe('E1: events stand on the layout anchors of every shipped area', () => {
  for (const layout of registeredLayouts()) {
    it(layout.areaId, () => {
      const R = areaRadius(layout.areaId);
      const c = compileLayout(layout, R);
      for (const k of POINT) {
        // What the director may take: declared anchors of the kind that seat inside the rim and clear the player at the landing.
        const ok = c.anchors.filter((a) => a.fits === k.fits).flatMap((a) => {
          const p = seatAnchor(k.fits, a.x, a.y, R);
          return p && Math.hypot(p.x - c.start.x, p.y - c.start.y) >= k.clear ? [{ id: a.id, ...p }] : [];
        });
        const { e, s } = reveal(k.kind, layout.areaId);
        if (ok.length === 0) {
          expect(e.anchors, `${k.kind}: no anchor fits, radial rules expected`).toBeUndefined();
          continue;
        }
        expect(e.anchors?.length, `${k.kind}: should stand on an anchor`).toBeGreaterThan(0);
        const used = ok.find((a) => a.id === e.anchors![0]);
        expect(used, `${k.kind} used ${e.anchors![0]}, not a fitting ${k.fits}`).toBeDefined();
        expect(near(k.site(s), used!), `${k.kind} site ${JSON.stringify(k.site(s))} vs anchor ${JSON.stringify(used)}`).toBe(true);
      }
    });
  }

  it('from the landing, most events of most areas stand on an anchor (the radial rule is the exception)', () => {
    let pairs = 0, anchored = 0;
    for (const layout of registeredLayouts()) for (const k of POINT) {
      pairs++;
      if (reveal(k.kind, layout.areaId).e.anchors) anchored++;
    }
    expect(anchored / pairs).toBeGreaterThanOrEqual(0.8);
  });

  it('the Ember Relay lights a triad of relay anchors, at least RELAY_SPACING apart', () => {
    for (const layout of registeredLayouts()) {
      const { e, s } = reveal('blackout', layout.areaId);
      const ids = new Set(layout.anchors.filter((a) => a.fits === 'relay').map((a) => a.id));
      expect(e.anchors?.length, layout.areaId).toBe(3);
      expect(new Set(e.anchors).size).toBe(3);
      for (const id of e.anchors!) expect(ids.has(id)).toBe(true);
      const b: XY[] = s.braziers;
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y)).toBeGreaterThanOrEqual(RELAY_SPACING - 2);
    }
  });

  it('the Laden Caravan drives a road anchor from an end clear of the party', () => {
    for (const layout of registeredLayouts()) {
      const R = areaRadius(layout.areaId);
      const c = compileLayout(layout, R);
      const start = c.start;
      const { e, s } = reveal('vaultbreakers', layout.areaId);
      const road = c.anchors.find((a) => a.id === e.anchors?.[0]);
      expect(road?.fits, layout.areaId).toBe('road');
      const path = road!.path;
      const ends = [path[0], path[path.length - 1]];
      const first: XY = s.road[0];
      expect(ends.some((p) => near(p, first)), layout.areaId).toBe(true);
      expect(Math.hypot(first.x - start.x, first.y - start.y)).toBeGreaterThanOrEqual(250);
      expect(s.road.length).toBe(path.length);
    }
  });

  it('Rival Crowns arrives on a second boss stage when the layout has one', () => {
    const withSecond = registeredLayouts().filter((l) => l.bossStage.second);
    expect(withSecond.length).toBeGreaterThan(0);
    for (const layout of withSecond) {
      const c = compileLayout(layout, areaRadius(layout.areaId));
      const { e, s } = reveal('secondCrown', layout.areaId);
      if (Math.hypot(c.bossStage.second!.x - c.start.x, c.bossStage.second!.y - c.start.y) < 350) continue;
      expect(e.anchors).toEqual(['bossStage.second']);
      expect(near(s.site, c.bossStage.second!)).toBe(true);
    }
  });
});

describe('E1: the pick is seeded, tier-filtered and falls back', () => {
  const AREA: AtlasAreaId = 'furnaceYard';
  const radialStalker = (w: ReturnType<typeof eventRun>['w'], angle = 0.7) =>
    pickSite(w, angle, { minPlayer: STALKER_SPAWN_CLEARANCE, rim: 50, from: 0.93, to: 1 });

  it('same seed, same anchor; different seeds spread over the candidates', () => {
    const pick = (seed: number) => reveal('hunted', AREA, { seed }).e.anchors![0];
    expect(pick(3)).toBe(pick(3));
    const seen = new Set(Array.from({ length: 16 }, (_, k) => pick(k + 1)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('picking an anchor never draws from the director stream', () => {
    const full = reveal('pactAltar', AREA, { seed: 9 });
    const stateWith = full.w.mapEvent!.rng.state();
    expect(full.e.anchors?.length).toBe(1);
    restore = overrideLayout({ ...layoutFor(AREA)!, anchors: [] });
    const bare = reveal('pactAltar', AREA, { seed: 9 });
    expect(bare.e.anchors).toBeUndefined();
    expect(bare.w.mapEvent!.rng.state()).toBe(stateWith);
  });

  it('only anchors whose tier window holds the map tier are offered', () => {
    const base = layoutFor(AREA)!;
    const perches = base.anchors.filter((a) => a.fits === 'perch');
    const keep = perches[1].id;
    const tiered: AreaLayout = { ...base, anchors: base.anchors.map((a) => (a.fits === 'perch' && a.id !== keep ? { ...a, tier: [5, 16] as [number, number] } : a)) };
    restore = overrideLayout(tiered);
    for (let seed = 1; seed <= 8; seed++) expect(reveal('hunted', AREA, { seed }).e.anchors).toEqual([keep]);
    restore();
    // No perch in the tier window: the radial rule (tier 1 maps).
    restore = overrideLayout({ ...base, anchors: base.anchors.map((a) => (a.fits === 'perch' ? { ...a, tier: [5, 16] as [number, number] } : a)) });
    const r = reveal('hunted', AREA);
    expect(r.e.anchors).toBeUndefined();
    expect(near(r.s.site, radialStalker(r.w), 0.01)).toBe(true);
  });

  it('a layout without anchors keeps the radial rules exactly', () => {
    restore = overrideLayout({ ...layoutFor(AREA)!, anchors: [] });
    const r = reveal('hunted', AREA);
    expect(r.e.anchors).toBeUndefined();
    expect(near(r.s.site, radialStalker(r.w), 0.01)).toBe(true);
    const echo = reveal('echoRift', AREA);
    expect(echo.e.anchors).toBeUndefined();
    expect(near(echo.s.anchor, pickSite(echo.w, 0.7, { minPlayer: ECHO_ANCHOR_CLEARANCE, rim: ECHO_ANCHOR_RIM, from: 0.1, to: 0.8 }), 0.01)).toBe(true);
  });

  it('no layout (the procedural generator): never an anchor', () => {
    for (const k of POINT) {
      const setup = eventRun(k.kind);
      const e = revealed(setup.w, k.kind);
      expect(e.anchors, k.kind).toBeUndefined();
    }
  });

  it('anchors blocked by players fall back to the radial rule', () => {
    const c = compileLayout(layoutFor(AREA)!, areaRadius(AREA));
    // One player on every perch: none clears the Stalker's spawn distance.
    const players = c.anchors.filter((a) => a.fits === 'perch').map((a) => ({ x: a.x, y: a.y }));
    const r = reveal('hunted', AREA, { players });
    expect(r.e.anchors).toBeUndefined();
    expect(near(r.s.site, radialStalker(r.w), 0.01)).toBe(true);
    // Free one perch: the director takes exactly that one.
    const r2 = reveal('hunted', AREA, { players: players.slice(1) });
    const free = c.anchors.filter((a) => a.fits === 'perch')[0];
    const others = players.slice(1);
    if (others.every((p) => Math.hypot(p.x - free.x, p.y - free.y) >= STALKER_SPAWN_CLEARANCE)) expect(r2.e.anchors).toEqual([free.id]);
  });

  it('an anchor over the rim is seated inward (at most ANCHOR_SEAT), farther it is blocked', () => {
    const base = layoutFor(AREA)!;
    const R = areaRadius(AREA);
    const onlyBell = (at: { r: number; a: number }): AreaLayout => ({
      ...base, anchors: [...base.anchors.filter((a) => a.fits !== 'bell'), { id: 'bell-x', fits: 'bell', at }],
    });
    // 280 u rim: a bell at R - 230 sits 50 u over and is slid in to R - 280.
    restore = overrideLayout(onlyBell({ r: (R - 230) / R, a: 0 }));
    const seated = reveal('bellwatch', AREA, { players: [{ x: 0, y: 0 }] });
    expect(seated.e.anchors).toEqual(['bell-x']);
    expect(Math.hypot(seated.s.bell.x, seated.s.bell.y)).toBeCloseTo(R - 280, 0);
    restore();
    restore = overrideLayout(onlyBell({ r: (R - 150) / R, a: 0 }));
    expect(reveal('bellwatch', AREA, { players: [{ x: 0, y: 0 }] }).e.anchors).toBeUndefined();
  });
});
