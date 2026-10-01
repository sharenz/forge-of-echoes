// Map events on screen and in the ears (Event Director v2): every zone and marker kind draws finite shapes on the decal
// layer (never above telegraph rims), the beats voice the shared audio vocabulary, and the residue outlives the event.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtBundle, SpriteDef } from '../../src/contracts/art';
import type { MapEventBeat, MapEventView } from '../../src/contracts/map-events';
import { MAP_EVENT_BEATS, MAP_EVENT_ICONS, MAP_EVENT_KINDS, MAP_EVENT_ZONES } from '../../src/contracts/map-events';
import type { PresentInput } from '../../src/contracts/present';
import type { SimEvent, WorldView } from '../../src/contracts/sim';
import { generateSprites } from '../../src/art';
import { createPresenter } from '../../src/present';
import { SoundDirector } from '../../src/present/sound';
import { encodeAreaId } from '../../src/sim/area-geometry';
import { emptyWorld, player, RecordingAudio, RecordingRenderer } from './helpers';

let sprites: SpriteDef[];
beforeAll(() => { sprites = generateSprites(); });
const art = (): ArtBundle => ({ sprites, icon: () => '', portrait: () => '', palette: {} });
const input = (world: WorldView, events: SimEvent[] = []): PresentInput => ({
  world, localPlayerId: 1, alpha: 1, dt: 1 / 60, events, cursorWorld: { x: 0, y: 0 }, hoverPropId: -1, hoverDropId: -1,
  settings: { screenShake: 1 }, paused: false,
});

function view(kind: MapEventView['kind'], over: Partial<MapEventView> = {}): MapEventView {
  return { uid: 1, kind, phase: 'active', x: 40, y: 20, grade: 2, hint: 0, objectives: [], timers: [], zones: [], markers: [], ...over };
}

describe('map event painter', () => {
  it('draws every zone and marker kind as finite decal/fx shapes, with labels and light', () => {
    const r = new RecordingRenderer();
    r.registerSprites(sprites);
    const p = createPresenter(r, art(), new RecordingAudio());
    const world = emptyWorld([player(1, 0, 0)]);
    world.run.events = [
      view('hunted', { zones: [{ kind: 'eye', x: 30, y: 10, r: 26, a: 0, v: 0 }],
        markers: [{ icon: 'claw', x: 60, y: 30, v: 2 }, { icon: 'pounce', x: 20, y: 20, v: 1 }] }),
      view('echoRift', { zones: [{ kind: 'anchor', x: 0, y: 40, r: 46, a: 0, v: 60 }],
        markers: [{ icon: 'echo', x: 40, y: 40, v: 3 }, { icon: 'echoRare', x: 50, y: 42, v: 3 }, { icon: 'warden', x: 10, y: 10, v: 0 }] }),
      view('wound', { zones: [{ kind: 'crack', x: -60, y: 0, r: 48, a: 0, v: 0 }, { kind: 'field', x: 0, y: 0, r: 240, a: 0.3, v: 1 },
        { kind: 'wedgePlan', x: 0, y: 0, r: 240, a: 1, v: 1 }, { kind: 'wedgePlan', x: 0, y: 0, r: 240, a: 2.6, v: 2 }], markers: [{ icon: 'guardian', x: 5, y: 5, v: 1 }] }),
      view('blackout', { zones: [{ kind: 'brazier', x: 20, y: 0, r: 210, a: 0, v: 255 }, { kind: 'brazier', x: -30, y: 30, r: 210, a: 0, v: 40 }],
        markers: [{ icon: 'ember', x: 0, y: 10, v: 1 }] }),
      view('vaultbreakers', { zones: [{ kind: 'road', x: -80, y: 0, r: 24, a: 0, v: 0 }, { kind: 'road', x: 80, y: 0, r: 24, a: 0, v: 1 }],
        markers: [{ icon: 'wagon', x: 0, y: 0, v: 50 }, { icon: 'lock', x: 5, y: 5, v: 1 }] }),
      view('secondCrown', { markers: [{ icon: 'crown', x: 10, y: 10, v: 0 }, { icon: 'crown', x: -10, y: 10, v: 1 }] }),
    ];
    world.areas.push(
      { id: encodeAreaId(1, 0.8, 0), kind: 'faultWedge', x: 0, y: 0, radius: 240, age: 0.9, duration: 1.8 },
      { id: encodeAreaId(2, 0, 0), kind: 'echoMark', x: 20, y: 20, radius: 24, age: 0.4, duration: 1.4 },
    );
    expect(() => { p.frame(input(world)); p.frame(input(world)); }).not.toThrow();
    expect(r.frameShapes.length).toBeGreaterThan(80);
    // Nothing of an event ever sits above the telegraph layer except the small world icons and the wedge rims.
    const layers = new Set(r.frameShapes.map(s => s.layer));
    expect([...layers].every(l => ['decal', 'fx', 'ground', 'top', 'shadow', 'world'].includes(l))).toBe(true);
    expect(r.frameTexts.map(t => t.text)).toEqual(expect.arrayContaining(['I', 'II', 'III', 'IV', 'NEXT', 'THEN', 'Hunt 2', 'Wagon']));
    expect(r.frameLights.length).toBeGreaterThan(3);
    expect(r.frameShapes.every(s => Number.isFinite(s.alpha))).toBe(true);
  });

  it('every wire enum has a drawer (no kind, zone or icon is silently ignored)', () => {
    expect(MAP_EVENT_ZONES.length).toBeGreaterThan(0);
    expect(MAP_EVENT_ICONS.length).toBeGreaterThan(0);
    expect(MAP_EVENT_KINDS).toEqual(['hunted', 'echoRift', 'blackout', 'vaultbreakers', 'secondCrown', 'wound',
      'pactAltar', 'orchard', 'ring', 'host', 'anvil', 'bellwatch', 'voidBreach']); // append-only
  });

  it('leaves a residue mark in the ground when an event ends, for the rest of the map', () => {
    const r = new RecordingRenderer();
    r.registerSprites(sprites);
    const p = createPresenter(r, art(), new RecordingAudio());
    const world = emptyWorld([player(1, 0, 0)]);
    p.frame(input(world));
    const before = r.frameShapes.length;
    p.frame(input(world, [{ t: 'mapEvent', kind: 'echoRift', beat: 'seal', x: 30, y: 30, n: 3 }]));
    p.frame(input(world));
    expect(r.frameShapes.length).toBeGreaterThan(before);
    expect(r.frameShapes.some(s => s.kind === 'ring' && s.layer === 'decal' && s.x === 30 && s.y === 30)).toBe(true);
  });
});

describe('map event sound', () => {
  interface Call { id: string; x?: number; y?: number; volume: number; pitch: number }
  function director() {
    const calls: Call[] = [];
    const d = new SoundDirector((id, x, y, volume, pitch) => calls.push({ id, x, y, volume, pitch }), () => 0.5);
    d.beginFrame(0);
    return { d, calls };
  }
  const beat = (kind: MapEventView['kind'], b: MapEventBeat, n = 0): SimEvent => ({ t: 'mapEvent', kind, beat: b, x: 10, y: 20, n });

  it('voices every beat, and grades with their own chord', () => {
    const { d, calls } = director();
    let t = 0;
    for (const b of MAP_EVENT_BEATS) {
      d.beginFrame(t += 2);
      d.handle(beat('echoRift', b, 3), 1);
    }
    const ids = new Set(calls.map(c => c.id));
    for (const id of ['eventOmen', 'eventOnset', 'eventStep', 'eventWhiff', 'eventHit', 'eventReturn', 'eventSeal', 'eventErupt', 'eventGold', 'eventFail']) expect(ids.has(id), id).toBe(true);
    for (const [grade, id] of [[1, 'eventBronze'], [2, 'eventSilver'], [3, 'eventGold']] as const) {
      const c = director();
      c.d.handle(beat('hunted', 'complete', grade), 1);
      expect(c.calls.map(x => x.id)).toEqual([id]);
    }
  });

  it('climbs the fixed-pitch ladder one note per step, and the Stalker lock has its own sound', () => {
    const { d, calls } = director();
    const pitches: number[] = [];
    for (let n = 0; n < 5; n++) {
      d.beginFrame(n);
      d.handle(beat('vaultbreakers', 'step', n), 1);
      pitches.push(calls.at(-1)!.pitch);
    }
    for (let k = 1; k < pitches.length; k++) expect(pitches[k]).toBeGreaterThan(pitches[k - 1]);
    const s = director();
    s.d.handle(beat('hunted', 'lock'), 1);
    expect(s.calls[0].id).toBe('eventLock');
    const c = director();
    c.d.handle(beat('vaultbreakers', 'lock', 1), 1);
    expect(c.calls.map(x => x.id)).toEqual(['chestOpen', 'dropCurrency']);
  });

  it('runs the Stalker heartbeat faster as the pounce nears', () => {
    const gaps: number[] = [];
    for (const seconds of [9, 1]) {
      const { d, calls } = director();
      const world = emptyWorld([player(1, 0, 0)]);
      world.run.events = [view('hunted', { timers: [{ id: 0, seconds, total: 9 }] })];
      let last = -1;
      for (let t = 0; t < 12 && gaps.length < 2; t += 1 / 60) {
        d.beginFrame(t);
        const before = calls.length;
        d.ambient(world, 0, 0);
        if (calls.length > before) { if (last >= 0) { gaps.push(t - last); break; } last = t; }
      }
    }
    expect(gaps).toHaveLength(2);
    expect(gaps[1]).toBeLessThan(gaps[0]);
  });
});

describe('Echoing choir hum', () => {
  function setup() {
    const calls: { id: string; volume: number; pitch: number }[] = [];
    const d = new SoundDirector((id, _x, _y, volume, pitch) => calls.push({ id, volume, pitch }), () => 0.5);
    return { d, calls };
  }
  const echo = (phase: MapEventView['phase'], hint: number, v: number): MapEventView => ({
    uid: 1, kind: 'echoRift', phase, x: 50, y: 60, grade: 0, hint, objectives: [], timers: [], markers: [],
    zones: [{ kind: 'anchor', x: 50, y: 60, r: 46, a: 0, v }],
  });
  function hums(view: MapEventView | null, seconds: number, d: SoundDirector, calls: { id: string }[]): number {
    const world = emptyWorld([player(1, 0, 0)]);
    world.run.events = view ? [view] : [];
    const before = calls.filter(c => c.id === 'eventHum').length;
    for (let t = 0; t < seconds; t += 1 / 30) { d.beginFrame(hums.clock += 1 / 30); d.ambient(world, 0, 0); }
    return calls.filter(c => c.id === 'eventHum').length - before;
  }
  hums.clock = 0;

  it('replays every couple of seconds while the rift recalls, quieter while it wakes, and stops once it erupts or seals', () => {
    const { d, calls } = setup();
    expect(hums(null, 6, d, calls)).toBe(0);
    expect(hums(echo('warning', 0, 0), 6, d, calls)).toBeGreaterThanOrEqual(2);
    const quiet = calls.filter(c => c.id === 'eventHum').at(-1)!.volume;
    expect(hums(echo('active', 1, 0), 6, d, calls)).toBeGreaterThanOrEqual(2);
    expect(calls.filter(c => c.id === 'eventHum').at(-1)!.volume).toBeGreaterThan(quiet);
    expect(hums(echo('active', 2, 50), 6, d, calls)).toBe(0); // erupting: its own voice
    expect(hums(echo('active', 4, 50), 6, d, calls)).toBe(0);
    expect(hums(echo('complete', 4, 50), 6, d, calls)).toBe(0);
    expect(hums(null, 6, d, calls)).toBe(0);
  });

  it('rises in pitch with Resonance', () => {
    const pitches: number[] = [];
    for (const v of [0, 50, 100]) {
      const { d, calls } = setup();
      hums(echo('active', 1, v), 3, d, calls);
      pitches.push(calls.find(c => c.id === 'eventHum')!.pitch);
    }
    expect(pitches[1]).toBeGreaterThan(pitches[0]);
    expect(pitches[2]).toBeGreaterThan(pitches[1]);
  });
});
