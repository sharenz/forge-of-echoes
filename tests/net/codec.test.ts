import type { MapEventView } from '../../src/contracts/map-events';
import { describe, expect, it } from 'vitest';
import { NEW_AREA_KINDS, NEW_MONSTER_KINDS, NEW_PROJECTILE_KINDS, PLAYER_DEBUFFS } from '../../src/contracts/bestiary';
import { MONSTER_KINDS } from '../../src/contracts/content';
import { AOI_HALF_HEIGHT, AOI_HALF_WIDTH } from '../../src/contracts/net';
import { AILMENT_BIT, AREA_KINDS, ELITE_BIT, MONSTER_ANIM, PROJECTILE_KINDS, RARITY_CODE } from '../../src/contracts/sim';
import type { PlayerDebuffView, RootSource } from '../../src/contracts/sim';
import {
  AOI_MARGIN, CLIENT_MONSTER_CAPACITY, CLIENT_PROJECTILE_CAPACITY, MAX_WIRE_AREAS, MAX_WIRE_DROPS,
  MAX_WIRE_GROUND_AREAS, MAX_WIRE_PUBLIC_DROPS, SNAPSHOT_VERSION, Snapshot, SnapshotDecodeError, createSnapshotEncoder,
  decodeSnapshot,
} from '../../src/net';
import { ByteReader, StringInterner } from '../../src/net/bytes';
import { AREA_TIER, MAX_WIRE_KINDS, MAX_WIRE_SLOT, ROOT_SOURCE_CODES } from '../../src/net/protocol';
import type { AreaView } from '../../src/contracts/sim';
import {
  fillSlots, makeArea, makeDrop, makeMonsterStore, makePlayer, makeProjectileStore, makeProp, makeView, putMonster,
  putMote, putProjectile, setTick,
} from './fixtures';

const Q = 1 / 16; // position quantum

function richWorld() {
  const v = makeView();
  setTick(v, 12345);
  const me = makePlayer(1, {
    name: 'Mira', level: 17, x: 100.25, y: -50.5, vx: 77.78, vy: -77.78, facing: 'east', aimX: 180, aimY: -20,
    anim: 'cast', animTime: 0.183, castSkill: 'emberNova', castProgress: 0.6, life: 211.5, maxLife: 260,
    focus: 44.25, maxFocus: 96, wardTime: 3.2, wardDuration: 5, invulnTime: 0.15, hitFlash: 0.5,
  });
  fillSlots(me, ['emberLance', 'emberNova', 'riftStep', null, 'cinderWard', null]);
  me.flasks[0] = { flaskId: 'lifeFlask', count: 3, resource: 'life', active: 1.5, duration: 3 };
  me.flasks[2] = { flaskId: 'focusFlask', count: 5, resource: 'focus', active: 0, duration: 4 };
  const ally = makePlayer(2, { name: 'Ösk the Ümläut', level: 9, x: 150, y: -40, anim: 'run', animTime: 1.5, facing: 'west', dead: false });
  const deadAlly = makePlayer(3, { name: 'Brann', x: 2000, y: 600, anim: 'death', dead: true, life: 0 });
  v.players.push(me, ally, deadAlly);
  v.run.boss = { name: 'Cinder Matriarch', life: 5123.5, maxLife: 7000, phase: 2 };
  v.run.lieutenant = { name: 'Ashbound Herald', life: 900, maxLife: 1200 };
  v.run.portalOpen = true;
  v.run.playersAlive = 2;

  putMonster(v, {
    slot: 5, gen: 3, kind: 4, rarity: RARITY_CODE.rare, x: 130.3, y: -20.7, radius: 12, facing: -1,
    anim: MONSTER_ANIM.windup, animTime: 0.35, life: 180, maxLife: 360, hitFlash: 0.8,
    ailments: AILMENT_BIT.burning | AILMENT_BIT.shocked, mods: ELITE_BIT.juggernaut | ELITE_BIT.frenzied,
  });
  putMonster(v, { slot: 6, gen: 1, kind: 0, rarity: RARITY_CODE.magic, x: 90, y: -60, life: 11, maxLife: 22, mods: ELITE_BIT.swift });
  putMonster(v, { slot: 2047, gen: 511, kind: 6, rarity: RARITY_CODE.boss, x: 300, y: 100, radius: 24, life: 5123.5, maxLife: 7000 });
  putProjectile(v, { slot: 3, gen: 2, kind: 0, x: 110, y: -45, vx: 400, vy: -128.5, radius: 3, age: 0.1 });
  putProjectile(v, { slot: 9, kind: 4, hostile: true, x: 50, y: 10, vx: -100, vy: 60, radius: 5, age: 0.4, life: 1.1 });
  putMote(v, 12, 105, -48, 2);
  putMote(v, 13, 95, -52, 0);
  v.areas.push(makeArea({ id: 900001, kind: 'meteorWarning', x: 140, y: -10, radius: 30.5, age: 0.4, duration: 1.2 }));
  v.drops.push(
    makeDrop({ id: 41, owner: 1, x: 120, y: -30, z: 6.25, age: 0.3, label: 'Glassbone Wand of Splintering' }),
    makeDrop({ id: 42, owner: 2, x: 121, y: -31 }), // someone else's instanced loot
    { ...makeDrop({ id: 43, owner: 1, x: 80, y: -70 }), blocked: true },
  );
  v.drops[2].spec = { token: 9, owner: 1, autoPickup: true, label: 'Ashen Forge Map (Tier 3)', tone: 'map', sprite: 'map', iconId: 'icon/map/ashenForge' };
  v.props.push(
    makeProp({ id: 1, kind: 'pillar', x: -200, y: 40, radius: 12, variant: 2 }), // static, state 0: not sent
    makeProp({ id: 2, kind: 'chest', x: 0, y: 0, radius: 14, state: 0 }),
    makeProp({ id: 3, kind: 'returnPortal', x: 30, y: 0, radius: 0, state: 1, interactive: true }),
    makeProp({ id: 4, kind: 'brazier', x: 3000, y: 3000, radius: 6, state: 2, variant: 1 }),
  );
  return v;
}

describe('snapshot codec', () => {
  it('round-trips concurrent event views (bars, timers, zones, markers) and clears them on the next snapshot', () => {
    const v = richWorld();
    const encoder = createSnapshotEncoder();
    const reader = new ByteReader(); const strings = new StringInterner(256); const snapshot = new Snapshot();
    const echoing: MapEventView = { uid: 2, kind: 'echoRift', phase: 'active', x: 345.5, y: -123.25, grade: 2, hint: 1,
      objectives: [{ id: 0, cur: 3, max: 6 }, { id: 1, cur: 9, max: 12 }], timers: [{ id: 0, seconds: 1.5, total: 2.5 }],
      zones: [{ kind: 'anchor', x: 345.5, y: -123.25, r: 46, a: 0, v: 50, n: 0 }, { kind: 'stone', x: 10, y: 20, r: 26, a: 0, v: 255, n: 3 }],
      markers: [{ icon: 'echoRare', x: 100, y: 50, v: 0, w: 0 }, { icon: 'echo', x: -40, y: 12, v: 7, w: 0 }, { icon: 'bloom', x: 5, y: 6, v: 2, w: 64 }] };
    const fault: MapEventView = { uid: 3, kind: 'wound', phase: 'warning', x: 20, y: -40, grade: 0, hint: 0, objectives: [], timers: [],
      zones: [{ kind: 'field', x: 20, y: -40, r: 240, a: Math.PI / 2, v: 1 }, { kind: 'wedgePlan', x: 20, y: -40, r: 240, a: 3.5, v: 2 }], markers: [] };
    v.run.events = [echoing, fault];
    snapshot.decode(encoder.encode(v, 1, 1), reader, strings);
    expect(snapshot.run.events).toHaveLength(2);
    expect(snapshot.run.events[0]).toEqual(echoing);
    expect(snapshot.run.events[1].zones[0]).toMatchObject({ kind: 'field', x: 20, y: -40, r: 240, v: 1 });
    expect(snapshot.run.events[1].zones[1].a).toBeCloseTo(3.5, 3); // quantised to 1/65536 of a turn
    v.run.events = [{ ...echoing, phase: 'complete', grade: 3, timers: [], objectives: [] }];
    snapshot.decode(encoder.encode(v, 1, 2), reader, strings);
    expect(snapshot.run.events).toHaveLength(1);
    expect(snapshot.run.events[0]).toMatchObject({ phase: 'complete', grade: 3, timers: [] }); // no stale countdown
    v.run.events = [];
    snapshot.decode(encoder.encode(v, 1, 3), reader, strings);
    expect(snapshot.run.events).toEqual([]);
  });

  it('round-trips the second boss bar (Rival Crowns) and drops it when the rival is gone', () => {
    const v = richWorld();
    const encoder = createSnapshotEncoder();
    const reader = new ByteReader(); const strings = new StringInterner(256); const snapshot = new Snapshot();
    v.run.boss = { name: 'Cinder Matriarch', life: 900, maxLife: 1000, phase: 2 };
    v.run.boss2 = { name: 'Hollow Warden', life: 120.5, maxLife: 600, phase: 1 };
    snapshot.decode(encoder.encode(v, 1, 1), reader, strings);
    expect(snapshot.run.boss).toMatchObject({ name: 'Cinder Matriarch', life: 900, phase: 2 });
    expect(snapshot.run.boss2).toMatchObject({ name: 'Hollow Warden', life: 120.5, maxLife: 600, phase: 1 });
    v.run.boss2 = null;
    snapshot.decode(encoder.encode(v, 1, 2), reader, strings);
    expect(snapshot.run.boss2).toBeNull();
  });

  it('round-trips a rich world view', () => {
    const v = richWorld();
    const enc = createSnapshotEncoder();
    const buf = enc.encode(v, 1, 987654);
    expect(buf.byteLength).toBe(enc.lastByteLength);
    const s = decodeSnapshot(buf);

    expect(s.tick).toBe(12345);
    expect(s.ackSeq).toBe(987654);
    expect(s.viewerId).toBe(1);
    expect(s.theme).toBe('ashenForge');
    expect(s.arenaRadius).toBe(900);

    // run
    expect(s.run.phase).toBe('fight');
    expect(s.run.wave).toBe(2);
    expect(s.run.waveCount).toBe(6);
    expect(s.run.waveTime).toBeCloseTo(12.5, 5);
    expect(s.run.elapsed).toBeCloseTo(75.25, 5);
    expect(s.run.kills).toBe(123);
    expect(s.run.monstersAlive).toBe(42);
    expect(s.run.portalOpen).toBe(true);
    expect(s.run.playersAlive).toBe(2);
    expect(s.run.boss).toEqual({ name: 'Cinder Matriarch', life: 5123.5, maxLife: 7000, phase: 2 });
    expect(s.run.lieutenant).toEqual({ name: 'Ashbound Herald', life: 900, maxLife: 1200 });

    // players: all of them, only the viewer carries HUD data
    expect(s.playerCount).toBe(3);
    const me = s.player(1)!;
    expect(me.full).toBe(true);
    expect(me.name).toBe('Mira');
    expect(me.level).toBe(17);
    expect(me.x).toBeCloseTo(100.25, 4);
    expect(me.y).toBeCloseTo(-50.5, 4);
    expect(me.vx).toBeCloseTo(77.78, 3);
    expect(me.vy).toBeCloseTo(-77.78, 3);
    expect(me.facing).toBe('east');
    expect(me.aimX).toBeCloseTo(180, 1);
    expect(me.aimY).toBeCloseTo(-20, 1);
    expect(me.anim).toBe('cast');
    expect(me.animTime).toBeCloseTo(0.183, 5);
    expect(me.castSkill).toBe('emberNova');
    expect(Math.abs(me.castProgress - 0.6)).toBeLessThanOrEqual(0.5 / 65535 + 1e-9); // u16 progress
    expect(me.life).toBeCloseTo(211.5, 4);
    expect(me.maxLife).toBe(260);
    expect(me.focus).toBeCloseTo(44.25, 4);
    expect(me.maxFocus).toBe(96);
    expect(me.wardTime).toBeCloseTo(3.2, 3);
    expect(me.wardDuration).toBeCloseTo(5, 3);
    expect(me.invulnTime).toBeCloseTo(0.15, 3);
    expect(me.hitFlash).toBeCloseTo(0.5, 2);
    expect(me.dead).toBe(false);
    expect(me.slots.map((sl) => sl.skillId)).toEqual(['emberLance', 'emberNova', 'riftStep', null, 'cinderWard', null, null, null]);
    expect(me.slots[1]).toEqual({ skillId: 'emberNova', cooldown: 1.25, cooldownTotal: 3, charges: 1, maxCharges: 2, focusCost: 12.5, usable: true });
    expect(me.slots[2].usable).toBe(false);
    expect(me.flasks[0]).toEqual({ flaskId: 'lifeFlask', count: 3, resource: 'life', active: 1.5, duration: 3 });
    expect(me.flasks[1]).toBeNull();
    expect(me.flasks[2]).toEqual({ flaskId: 'focusFlask', count: 5, resource: 'focus', active: 0, duration: 4 });

    const ally = s.player(2)!;
    expect(ally.full).toBe(false);
    expect(ally.name).toBe('Ösk the Ümläut');
    expect(ally.anim).toBe('run');
    expect(ally.facing).toBe('west');
    expect(ally.castSkill).toBeNull();
    const dead = s.player(3)!;
    expect(dead.dead).toBe(true);
    expect(dead.anim).toBe('death');
    expect(dead.x).toBe(2000); // players are never AOI-culled

    // monsters
    const m = s.monsters;
    expect(m.n).toBe(3);
    const byId = new Map<number, number>();
    for (let i = 0; i < m.n; i++) byId.set(m.id[i], i);
    const r = byId.get((3 << 16) | 5)!;
    expect(r).toBeDefined();
    expect(m.kind[r]).toBe(4);
    expect(m.rarity[r]).toBe(RARITY_CODE.rare);
    expect(Math.abs(m.x[r] - 130.3)).toBeLessThanOrEqual(Q / 2 + 1e-4);
    expect(Math.abs(m.y[r] - -20.7)).toBeLessThanOrEqual(Q / 2 + 1e-4);
    expect(m.radius[r]).toBe(12);
    expect(m.facing[r]).toBe(-1);
    expect(m.anim[r]).toBe(MONSTER_ANIM.windup);
    expect(m.animTime[r]).toBeCloseTo(0.35, 2);
    expect(m.maxLife[r]).toBe(360);
    expect(m.life[r]).toBe(180);
    expect(m.hitFlash[r]).toBeCloseTo(0.8, 1);
    expect(m.ailments[r]).toBe(AILMENT_BIT.burning | AILMENT_BIT.shocked);
    expect(m.mods[r]).toBe(ELITE_BIT.juggernaut | ELITE_BIT.frenzied);
    const g = byId.get((1 << 16) | 6)!;
    expect(m.rarity[g]).toBe(RARITY_CODE.magic);
    expect(m.maxLife[g]).toBe(1); // normal/magic: life travels as a fraction
    expect(m.life[g]).toBeCloseTo(0.5, 2);
    expect(m.mods[g]).toBe(ELITE_BIT.swift);
    const boss = byId.get(((511 & 0xff) << 16) | 2047)!;
    expect(boss).toBeDefined(); // generation travels as its low 8 bits
    expect(m.maxLife[boss]).toBe(7000);
    expect(m.life[boss]).toBe(5123.5);
    expect(m.life[boss]).toBeLessThanOrEqual(5123.5);

    // projectiles
    const p = s.projectiles;
    expect(p.n).toBe(2);
    const lance = p.id[0] === ((2 << 16) | 3) ? 0 : 1;
    const spit = 1 - lance;
    expect(p.kind[lance]).toBe(0);
    expect(p.hostile[lance]).toBe(0);
    expect(p.vx[lance]).toBeCloseTo(400, 1);
    expect(p.vy[lance]).toBeCloseTo(-128.5, 1);
    expect(p.age[lance]).toBeCloseTo(0.1, 3);
    expect(p.life[lance]).toBe(0);
    expect(p.hostile[spit]).toBe(1);
    expect(p.life[spit]).toBeCloseTo(1.1, 3);
    expect(p.radius[spit]).toBe(5);

    // motes
    expect(s.motes.n).toBe(2);
    expect([s.motes.slot[0], s.motes.slot[1]].sort()).toEqual([12, 13]);
    const big = s.motes.slot[0] === 12 ? 0 : 1;
    expect(s.motes.size[big]).toBe(2);
    expect(s.motes.x[big]).toBeCloseTo(105, 1);

    // areas
    expect(s.areaCount).toBe(1);
    expect(s.areas[0]).toMatchObject({ id: 900001, kind: 'meteorWarning', radius: 30.5 });
    expect(s.areas[0].age).toBeCloseTo(0.4, 5);
    expect(s.areas[0].duration).toBeCloseTo(1.2, 5);

    // drops: only the viewer's own
    expect(s.dropCount).toBe(2);
    const d41 = s.drops.slice(0, s.dropCount).find((d) => d.id === 41)!;
    expect(d41.spec).toEqual({ token: 77, owner: 1, autoPickup: true, label: 'Glassbone Wand of Splintering', tone: 'currency', sprite: 'currency', iconId: 'icon/currency/scrap' });
    expect(d41.z).toBeCloseTo(6.25, 3);
    expect(d41.age).toBeCloseTo(0.3, 5);
    expect(d41.blocked).toBe(false);
    const d43 = s.drops.slice(0, s.dropCount).find((d) => d.id === 43)!;
    expect(d43.blocked).toBe(true);
    expect(d43.spec).toEqual({ token: 9, owner: 1, autoPickup: true, label: 'Ashen Forge Map (Tier 3)', tone: 'map', sprite: 'map', iconId: 'icon/map/ashenForge' });

    // props: dynamic kinds always, others only with state != 0 (never AOI-culled)
    expect(s.props.slice(0, s.propCount).map((pr) => pr.id)).toEqual([2, 3, 4]);
    expect(s.props[1]).toEqual({ id: 3, kind: 'returnPortal', x: 30, y: 0, radius: 0, state: 1, variant: 0, interactive: true });
    expect(s.props[2]).toMatchObject({ kind: 'brazier', x: 3000, y: 3000, state: 2, variant: 1 });
  });

  it('never sends another player\'s instanced loot', () => {
    const v = richWorld();
    const enc = createSnapshotEncoder();
    const forAlly = decodeSnapshot(enc.encode(v, 2, 1));
    expect(forAlly.drops.slice(0, forAlly.dropCount).map((d) => d.id)).toEqual([42]);
    expect(forAlly.player(2)!.full).toBe(true);
    expect(forAlly.player(1)!.full).toBe(false);
    const forStranger = decodeSnapshot(enc.encode(v, 9, 1));
    expect(forStranger.dropCount).toBe(0);
    expect(forStranger.playerCount).toBe(3);
  });

  it('sends public drops (owner 0) to every viewer in the AOI, with their click / walk-over pickup mode', () => {
    const v = makeView();
    v.players.push(makePlayer(1, { x: 0, y: 0 }), makePlayer(2, { x: 800, y: 0 }), makePlayer(3, { x: 0, y: 0, dead: true }));
    const edgeX = AOI_HALF_WIDTH + AOI_MARGIN;
    v.drops.push(
      makeDrop({ id: 10, owner: 1, x: 10, y: 0, autoPickup: true }), // player 1's currency
      makeDrop({ id: 11, owner: 1, x: 12, y: 0, autoPickup: false, label: 'Ember Bite' }), // player 1's equipment
      makeDrop({ id: 12, owner: 2, x: 790, y: 0 }), // player 2's loot
      { ...makeDrop({ id: 20, owner: 0, x: 20, y: 5, autoPickup: false, label: 'Storm Loop' }), blocked: true }, // near 1 (and 3)
      makeDrop({ id: 21, owner: 0, x: 400, y: 0, autoPickup: false, label: 'Grave Coil' }), // in both AOIs
      makeDrop({ id: 22, owner: 0, x: 800 + edgeX - 1, y: 0, autoPickup: false }), // only near 2
    );
    v.drops[3].spec.tone = 'magic';
    v.drops[3].spec.sprite = 'equipment';
    const enc = createSnapshotEncoder();
    const ids = (viewer: number) => {
      const s = decodeSnapshot(enc.encode(v, viewer, 0));
      return s.drops.slice(0, s.dropCount);
    };

    const for1 = ids(1);
    expect(for1.map((d) => d.id)).toEqual([10, 11, 20, 21]); // own first, then public
    expect(for1.find((d) => d.id === 10)!.spec.autoPickup).toBe(true);
    expect(for1.find((d) => d.id === 11)!.spec.autoPickup).toBe(false);
    const pub = for1.find((d) => d.id === 20)!;
    expect(pub.spec).toEqual({ token: 77, owner: 0, autoPickup: false, label: 'Storm Loop', tone: 'magic', sprite: 'equipment', iconId: 'icon/currency/scrap' });
    // Somebody's failed pickup of a public drop is nobody else's business ("Inventory full" is personal).
    expect(pub.blocked).toBe(false);

    expect(ids(2).map((d) => d.id)).toEqual([12, 21, 22]);
    // A dead player still sees the floor around her; a viewer that has not joined sees the public drops at the centre.
    expect(ids(3).map((d) => d.id)).toEqual([20, 21]);
    expect(ids(9).map((d) => d.id)).toEqual([20, 21]);
    // Viewer id 0 is never a player: public drops once, no duplicates.
    expect(ids(0).map((d) => d.id)).toEqual([20, 21]);
  });

  it('pins the drop record layout: owner byte, then tone | sprite << 3 | blocked (bit 5) | autoPickup (bit 6)', () => {
    // Fixed layout up to the first drop record when the viewer is absent and the run has no boss/lieutenant:
    // header 23 B · run 23 B · players 1 · monsters 2 · projectiles 2 · motes 2 · areas 2 · drop count 1 → record at 56.
    const flagsOf = (drop: ReturnType<typeof makeDrop>) => {
      const v = makeView();
      v.drops.push(drop);
      const bytes = new Uint8Array(createSnapshotEncoder().encode(v, 1, 0));
      expect(bytes[0]).toBe(SNAPSHOT_VERSION);
      expect(bytes[53] | (bytes[54] << 8)).toBe(0); // no areas (u16 count)
      expect(bytes[55]).toBe(1); // one drop
      expect(bytes[56 + 8]).toBe(drop.spec.owner);
      return bytes[56 + 9];
    };
    const own = { ...makeDrop({ owner: 1, autoPickup: true }), blocked: true };
    own.spec.tone = 'rare'; // code 2
    own.spec.sprite = 'map'; // code 2
    expect(flagsOf(own)).toBe(2 | (2 << 3) | 32 | 64);
    const click = makeDrop({ owner: 1, autoPickup: false });
    expect(flagsOf(click)).toBe(4 | (1 << 3)); // currency tone 4, currency sprite 1
    const ground = { ...makeDrop({ owner: 0, autoPickup: false }), blocked: true };
    expect(flagsOf(ground)).toBe(4 | (1 << 3));
  });

  it('stamps version 10 and rejects older snapshots, so a stale bundle reloads instead of limping on', () => {
    // v10: map events wave 2 (u16 ailments, eventSlow, a second boss bar, zone n / marker w); older decoders must reload.
    expect(SNAPSHOT_VERSION).toBe(10);
    const v = richWorld();
    const buf = new Uint8Array(createSnapshotEncoder().encode(v, 1, 1));
    expect(buf[0]).toBe(10);
    for (const version of [3, 4, 5, 6, 7, 8, 9]) {
      const old = buf.slice();
      old[0] = version;
      expect(() => decodeSnapshot(old)).toThrow(SnapshotDecodeError);
      expect(() => decodeSnapshot(old)).toThrow(`snapshot version ${version} != 10`);
    }
  });

  it('writes the viewer\'s own drops before public ones, so a floor full of dumped items never hides her loot', () => {
    const v = makeView();
    v.players.push(makePlayer(1, { x: 0, y: 0 }));
    for (let i = 0; i < 300; i++) v.drops.push(makeDrop({ id: 1000 + i, owner: 0, x: (i % 20) * 10 - 100, y: Math.floor(i / 20) * 10 - 70, autoPickup: false }));
    for (let i = 0; i < 5; i++) v.drops.push(makeDrop({ id: 50 + i, owner: 1, x: i * 3, y: 1 }));
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 1, 0));
    expect(s.dropCount).toBe(5 + MAX_WIRE_PUBLIC_DROPS);
    const list = s.drops.slice(0, s.dropCount);
    expect(list.slice(0, 5).map((d) => d.id)).toEqual([50, 51, 52, 53, 54]);
    expect(list.slice(5).every((d) => d.spec.owner === 0)).toBe(true);
    expect(new Set(list.map((d) => d.id)).size).toBe(5 + MAX_WIRE_PUBLIC_DROPS);
  });

  it('sends only the nearest MAX_WIRE_PUBLIC_DROPS public drops, in view order, so a dumped stash tab stays cheap', () => {
    expect(MAX_WIRE_PUBLIC_DROPS).toBe(64);
    const v = makeView();
    v.players.push(makePlayer(1, { x: 200, y: -100 }), makePlayer(2, { x: -300, y: 150 }));
    // 180 public drops scattered over both viewers' AOIs (deterministic LCG), plus one a friend just dropped at
    // player 1's feet: the NEWEST drop in the list, which the old oldest-first cut left out.
    let seed = 99;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 0x100000000;
    };
    for (let i = 0; i < 180; i++) {
      v.drops.push(makeDrop({ id: 5000 + i, owner: 0, x: -500 + rnd() * 1000, y: -350 + rnd() * 600, autoPickup: false }));
    }
    v.drops.push(makeDrop({ id: 9999, owner: 0, x: 205, y: -98, autoPickup: false, label: 'Gift Ring' }));
    v.drops.push(makeDrop({ id: 60, owner: 1, x: 190, y: -90 }));
    const enc = createSnapshotEncoder();
    const hw = AOI_HALF_WIDTH + AOI_MARGIN;
    const hh = AOI_HALF_HEIGHT + AOI_MARGIN;
    for (const viewer of [1, 2]) {
      const me = v.players.find((p) => p.id === viewer)!;
      const s = decodeSnapshot(enc.encode(v, viewer, 0));
      const list = s.drops.slice(0, s.dropCount);
      const pub = list.filter((d) => d.spec.owner === 0);
      expect(pub).toHaveLength(MAX_WIRE_PUBLIC_DROPS);
      // Brute force: every public drop in the AOI, nearest first (ties → view order), keep 64, back to view order.
      const expected = v.drops
        .map((d, index) => ({ d, index, d2: (d.x - me.x) ** 2 + (d.y - me.y) ** 2 }))
        .filter(({ d }) => d.spec.owner === 0 && Math.abs(d.x - me.x) <= hw && Math.abs(d.y - me.y) <= hh)
        .sort((a, b) => a.d2 - b.d2 || a.index - b.index)
        .slice(0, MAX_WIRE_PUBLIC_DROPS)
        .sort((a, b) => a.index - b.index)
        .map(({ d }) => d.id);
      expect(pub.map((d) => d.id)).toEqual(expected);
      if (viewer === 1) {
        expect(list[0].id).toBe(60); // own loot first
        expect(pub.some((d) => d.id === 9999)).toBe(true);
      } else {
        expect(list.some((d) => d.spec.owner !== 0)).toBe(false);
      }
    }
    // Bandwidth: 64 public records instead of every public drop in the AOI.
    enc.encode(v, 1, 0);
    expect(enc.lastByteLength).toBeLessThan(200 + (MAX_WIRE_PUBLIC_DROPS + 1) * 60);
  });

  it('keeps the nearest drops when the viewer\'s own loot alone exceeds MAX_WIRE_DROPS (and then sends no public ones)', () => {
    const v = makeView();
    v.players.push(makePlayer(1, { x: 0, y: 0 }));
    // 400 own drops on a spiral (farther with every index), stored in REVERSE distance order, plus public ones.
    for (let i = 399; i >= 0; i--) {
      const r = 5 + i * 0.8;
      v.drops.push(makeDrop({ id: 20000 + i, owner: 1, x: Math.cos(i) * r, y: Math.sin(i) * r })); // r ≤ 324: all in the AOI
    }
    v.drops.push(makeDrop({ id: 7, owner: 0, x: 1, y: 1, autoPickup: false }));
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 1, 0));
    expect(s.dropCount).toBe(MAX_WIRE_DROPS);
    const ids = s.drops.slice(0, s.dropCount).map((d) => d.id);
    // The 255 nearest are indices 0..254 of the spiral, written in view order (= descending spiral index).
    expect(ids).toEqual(Array.from({ length: MAX_WIRE_DROPS }, (_, k) => 20000 + MAX_WIRE_DROPS - 1 - k));
  });

  it('selects the nearest drops exactly, including ties and repeated encodes with the reused buffers', () => {
    const enc = createSnapshotEncoder();
    let seed = 4242;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let round = 0; round < 40; round++) {
      const v = makeView();
      v.players.push(makePlayer(1, { x: 0, y: 0 }));
      const count = 1 + Math.floor(rnd() * 600);
      for (let i = 0; i < count; i++) {
        // A coarse grid makes many exact distance ties; ties must resolve to the lower view index.
        const x = Math.round((rnd() * 2 - 1) * 12) * 40;
        const y = Math.round((rnd() * 2 - 1) * 8) * 40;
        v.drops.push(makeDrop({ id: i + 1, owner: rnd() < 0.3 ? 1 : 0, x, y, autoPickup: false }));
      }
      const s = decodeSnapshot(enc.encode(v, 1, 0));
      const got = s.drops.slice(0, s.dropCount).map((d) => d.id);
      const pick = (owner: number, room: number) =>
        v.drops
          .map((d, index) => ({ d, index, d2: d.x * d.x + d.y * d.y }))
          .filter(({ d }) => d.spec.owner === owner)
          .sort((a, b) => a.d2 - b.d2 || a.index - b.index)
          .slice(0, room)
          .sort((a, b) => a.index - b.index)
          .map(({ d }) => d.id);
      const own = pick(1, MAX_WIRE_DROPS);
      const expected = [...own, ...pick(0, Math.min(MAX_WIRE_PUBLIC_DROPS, MAX_WIRE_DROPS - own.length))];
      expect(got).toEqual(expected);
    }
  });

  it('culls AOI entities around the viewer with a margin', () => {
    const v = makeView();
    v.players.push(makePlayer(1, { x: 1000, y: -400 }));
    const edgeX = AOI_HALF_WIDTH + AOI_MARGIN;
    const edgeY = AOI_HALF_HEIGHT + AOI_MARGIN;
    putMonster(v, { slot: 1, x: 1000 + edgeX - 1, y: -400, radius: 6 }); // inside
    putMonster(v, { slot: 2, x: 1000 + edgeX + 5, y: -400, radius: 6 }); // radius reaches in
    putMonster(v, { slot: 3, x: 1000 + edgeX + 7, y: -400, radius: 6 }); // out
    putMonster(v, { slot: 4, x: 1000, y: -400 - edgeY - 20, radius: 6 }); // out (north)
    putMonster(v, { slot: 5, x: 1000 - edgeX + 2, y: -400 + edgeY - 2 }); // inside corner
    putProjectile(v, { slot: 1, x: 1000 - edgeX - 50, y: -400 }); // out
    putProjectile(v, { slot: 2, x: 1000 + 200, y: -400 + 100 }); // in
    putMote(v, 1, 1000, -400 + edgeY + 1); // out
    putMote(v, 2, 1000, -400 + edgeY - 1); // in
    v.areas.push(makeArea({ id: 1, x: 1000 + edgeX + 50, y: -400, radius: 70 })); // big radius reaches in
    v.areas.push(makeArea({ id: 2, x: 1000 + edgeX + 50, y: -400, radius: 20 })); // out
    v.drops.push(makeDrop({ id: 1, owner: 1, x: 1000 - edgeX - 10, y: -400 })); // out
    v.drops.push(makeDrop({ id: 2, owner: 1, x: 1000 + 30, y: -400 })); // in
    v.drops.push(makeDrop({ id: 3, owner: 0, x: 1000, y: -400 - edgeY - 1, autoPickup: false })); // public, out
    v.drops.push(makeDrop({ id: 4, owner: 0, x: 1000 + edgeX, y: -400 + edgeY, autoPickup: false })); // public, corner in
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 1, 0));
    const slots = Array.from(s.monsters.id.subarray(0, s.monsters.n)).map((id) => id & 0xffff).sort();
    expect(slots).toEqual([1, 2, 5]);
    expect(Array.from(s.projectiles.id.subarray(0, s.projectiles.n))).toEqual([2]);
    expect(Array.from(s.motes.slot.subarray(0, s.motes.n))).toEqual([2]);
    expect(s.areas.slice(0, s.areaCount).map((a) => a.id)).toEqual([1]);
    expect(s.drops.slice(0, s.dropCount).map((d) => d.id)).toEqual([2, 4]);
    // Positions survive the origin-relative quantisation far from the world origin.
    const i5 = Array.from(s.monsters.id.subarray(0, s.monsters.n)).indexOf(5);
    expect(s.monsters.x[i5]).toBeCloseTo(1000 - edgeX + 2, 1);
    expect(s.monsters.y[i5]).toBeCloseTo(-400 + edgeY - 2, 1);
  });

  it('keeps 200 monsters in the AOI within ~4 KB (13 B each)', () => {
    const v = makeView();
    const me = makePlayer(1, { x: 0, y: 0 });
    fillSlots(me, ['emberLance', 'emberNova', 'rimeShards', 'riftStep', 'cinderWard', 'arcChain']);
    me.flasks[0] = { flaskId: 'lifeFlask', count: 3, resource: 'life', active: 0, duration: 3 };
    me.flasks[1] = { flaskId: 'lifeFlask', count: 3, resource: 'life', active: 0, duration: 3 };
    me.flasks[2] = { flaskId: 'focusFlask', count: 3, resource: 'focus', active: 0, duration: 3 };
    v.players.push(me);
    for (let i = 0; i < 200; i++) {
      const a = i * 2.39996;
      const r = 20 + i * 2;
      putMonster(v, { slot: i, gen: i, kind: i % 5, rarity: i % 17 === 0 ? 1 : 0, x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6, animTime: i * 0.1, life: 10 });
    }
    const enc = createSnapshotEncoder();
    const empty = makeView();
    empty.players.push(me);
    const base = enc.encode(empty, 1, 0).byteLength;
    const buf = enc.encode(v, 1, 0);
    expect(decodeSnapshot(buf).monsters.n).toBe(200);
    expect((buf.byteLength - base) / 200).toBeLessThanOrEqual(13);
    expect(buf.byteLength).toBeLessThanOrEqual(4096);
  });

  it('returns standalone buffers and grows for huge worlds', () => {
    const enc = createSnapshotEncoder();
    const small = makeView();
    small.players.push(makePlayer(1));
    putMonster(small, { slot: 1, x: 10, y: 10 });
    const first = enc.encode(small, 1, 5);
    const firstCopy = new Uint8Array(first.slice(0));

    const big = makeView();
    big.players.push(makePlayer(1));
    for (let i = 0; i < 2000; i++) putMonster(big, { slot: i, x: (i % 50) * 10 - 250, y: Math.floor(i / 50) * 8 - 160, rarity: i % 3 === 0 ? 2 : 0, maxLife: 100 });
    for (let i = 0; i < 1500; i++) putProjectile(big, { slot: i, x: (i % 40) * 12 - 240, y: Math.floor(i / 40) * 8 - 150 });
    const second = enc.encode(big, 1, 6);
    expect(second.byteLength).toBeGreaterThan(40_000);
    expect(new Uint8Array(first)).toEqual(firstCopy); // not clobbered by buffer reuse / growth
    const s = decodeSnapshot(second);
    expect(s.monsters.n).toBe(2000);
    expect(s.projectiles.n).toBe(1500);
    expect(decodeSnapshot(first).monsters.n).toBe(1);
  });

  it('truncates overlong strings on a character boundary', () => {
    const v = makeView();
    v.players.push(makePlayer(1, { name: 'é'.repeat(200) })); // 400 UTF-8 bytes
    v.drops.push(makeDrop({ owner: 1, label: 'x'.repeat(300) }));
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 1, 0));
    expect(s.player(1)!.name).toBe('é'.repeat(127));
    expect(s.drops[0].spec.label).toBe('x'.repeat(255));
  });

  it('handles a viewer that has not joined yet (AOI around the arena centre)', () => {
    const v = makeView();
    putMonster(v, { slot: 1, x: 100, y: 0 });
    putMonster(v, { slot: 2, x: 3000, y: 0 });
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 4, 0));
    expect(s.viewer()).toBeNull();
    expect(s.monsters.n).toBe(1);
  });

  it('sanitises non-finite and out-of-range values instead of corrupting the stream', () => {
    const v = makeView();
    v.players.push(makePlayer(1, { x: 5, y: 5, life: Number.NaN, animTime: Number.POSITIVE_INFINITY, level: 999 }));
    putMonster(v, { slot: 1, x: 10, y: 10, life: -5, maxLife: 0, radius: 500, hitFlash: 9 });
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 1, 0));
    expect(s.player(1)!.life).toBe(0);
    expect(s.player(1)!.animTime).toBe(0);
    expect(s.player(1)!.level).toBe(255);
    expect(s.monsters.radius[0]).toBeCloseTo(63.75, 2);
    expect(s.monsters.hitFlash[0]).toBe(1);
  });

  it('keeps long-lived projectile ages exact past the u8 range (wide age flag)', () => {
    const v = makeView();
    setTick(v, 600);
    v.players.push(makePlayer(1));
    // A Matriarch spiral orb lives ~4.7 s: 282 ticks does not fit a u8.
    putProjectile(v, { slot: 1, kind: 6, hostile: true, x: 10, y: 0, vx: 110, vy: 0, age: 282 / 60 });
    putProjectile(v, { slot: 2, kind: 0, x: 20, y: 0, age: 255 / 60 });
    putProjectile(v, { slot: 3, kind: 0, x: 30, y: 0, age: 7 / 60 });
    const enc = createSnapshotEncoder();
    const buf = enc.encode(v, 1, 0);
    const s = decodeSnapshot(buf);
    const ages = new Map<number, number>();
    for (let i = 0; i < s.projectiles.n; i++) ages.set(s.projectiles.id[i] & 0xffff, s.projectiles.age[i]);
    expect(ages.get(1)).toBeCloseTo(282 / 60, 5);
    expect(ages.get(2)).toBeCloseTo(255 / 60, 5);
    expect(ages.get(3)).toBeCloseTo(7 / 60, 5);
    // Only the long-lived one pays the extra byte.
    putProjectile(v, { slot: 1, kind: 6, hostile: true, x: 10, y: 0, vx: 110, vy: 0, age: 200 / 60 });
    expect(enc.encode(v, 1, 0).byteLength).toBe(buf.byteLength - 1);
  });

  it('sends cast progress with 16-bit precision (the client derives cast times from it)', () => {
    const v = makeView();
    setTick(v, 10);
    v.players.push(makePlayer(1, { anim: 'cast', castSkill: 'rimeShards', castProgress: 7 / 20.4 }), makePlayer(2, { castSkill: 'emberNova', castProgress: 0.123456 }));
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 1, 0));
    expect(Math.abs(s.player(1)!.castProgress - 7 / 20.4)).toBeLessThanOrEqual(0.5 / 65535 + 1e-9);
    expect(Math.abs(s.player(2)!.castProgress - 0.123456)).toBeLessThanOrEqual(0.5 / 65535 + 1e-9);
    expect(s.player(2)!.castSkill).toBe('emberNova');
  });

  it('rejects garbage, truncated and foreign snapshots', () => {
    const v = richWorld();
    const buf = createSnapshotEncoder().encode(v, 1, 1);
    expect(() => decodeSnapshot(buf.slice(0, buf.byteLength - 1))).toThrow(SnapshotDecodeError);
    expect(() => decodeSnapshot(buf.slice(0, 7))).toThrow(SnapshotDecodeError);
    const bad = new Uint8Array(buf.slice(0));
    bad[0] = 99; // version
    expect(() => decodeSnapshot(bad)).toThrow(/version/);
    const trailing = new Uint8Array(buf.byteLength + 3);
    trailing.set(new Uint8Array(buf));
    expect(() => decodeSnapshot(trailing)).toThrow(/trailing/);
    const badTheme = new Uint8Array(buf.slice(0));
    badTheme[10] = 200; // theme code
    expect(() => decodeSnapshot(badTheme)).toThrow(SnapshotDecodeError);
    expect(() => decodeSnapshot(new ArrayBuffer(0))).toThrow(SnapshotDecodeError);
    // Random noise never escapes as anything but a SnapshotDecodeError.
    let seed = 12345;
    for (let t = 0; t < 300; t++) {
      const n = (t * 37) % 400;
      const noise = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        noise[k] = seed >>> 24;
      }
      if (n > 0) noise[0] = SNAPSHOT_VERSION; // valid version so the decoder goes deeper
      try {
        decodeSnapshot(noise);
      } catch (e) {
        expect(e).toBeInstanceOf(SnapshotDecodeError);
      }
    }
  });
});

describe('snapshot codec: bestiary rosters and player debuffs', () => {
  it('keeps every enum table inside its wire field, with room to grow', () => {
    expect(MONSTER_KINDS.length).toBe(22);
    expect(MONSTER_KINDS.length).toBeLessThanOrEqual(MAX_WIRE_KINDS);
    expect(PROJECTILE_KINDS.length).toBeLessThanOrEqual(MAX_WIRE_KINDS);
    expect(AREA_KINDS.length).toBeLessThanOrEqual(256); // u8
    expect(PLAYER_DEBUFFS.length).toBeLessThanOrEqual(16); // 4 bits
    expect(ROOT_SOURCE_CODES.length + 1).toBeLessThanOrEqual(16); // 4 bits, 0 = none
    // Every slot the ClientWorld can show fits the 12-bit wire slot (and the sim's 2048-slot stores do too).
    expect(CLIENT_MONSTER_CAPACITY).toBe(MAX_WIRE_SLOT + 1);
    expect(CLIENT_PROJECTILE_CAPACITY).toBe(MAX_WIRE_SLOT + 1);
    // The new ids were appended: the old wire indices did not move.
    expect(MONSTER_KINDS.indexOf('trainingDummy')).toBe(7);
    expect(MONSTER_KINDS.slice(8)).toEqual([...NEW_MONSTER_KINDS]);
    expect(PROJECTILE_KINDS.slice(7, 7 + NEW_PROJECTILE_KINDS.length)).toEqual([...NEW_PROJECTILE_KINDS]);
    // Roster batch 1 (power rework SK2), appended after the rosters.
    expect(PROJECTILE_KINDS.slice(7 + NEW_PROJECTILE_KINDS.length)).toEqual(['spark', 'cinderShell', 'umbralBolt', 'kineticLance', 'frostOrb']);
    expect(AREA_KINDS.slice(7, 7 + NEW_AREA_KINDS.length)).toEqual([...NEW_AREA_KINDS]);
    expect(AREA_KINDS.slice(7 + NEW_AREA_KINDS.length)).toEqual([
      'stormStrike', 'rendStrike', 'echoMark', 'faultWedge', 'voidTide', 'stormCall', 'frostSpike',
      // Roster batch 2 (power rework SK3)
      'gravityWell', 'entropyHex', 'witherField', 'immolationSigil',
      // Flagship augments (power rework SK5)
      'frostGround', 'staticField',
      // Roster batch 3 (power rework SK4)
      'meteorRain', 'blizzardStorm', 'eventHorizon',
    ]);
  });

  it('round-trips every monster kind, rarity and facing, and every projectile kind with each flag', () => {
    const v = makeView({ theme: 'rimedOssuary', monsters: makeMonsterStore(MAX_WIRE_SLOT + 1) });
    setTick(v, 777);
    v.players.push(makePlayer(1));
    MONSTER_KINDS.forEach((_, kind) => {
      putMonster(v, {
        slot: 100 + kind, gen: 200 + kind, kind, rarity: kind % 5, x: kind * 7 - 70, y: kind * -3,
        facing: kind % 2 ? 1 : -1, anim: kind % 6, animTime: kind / 60, life: 30 + kind, maxLife: 60 + kind,
        hitFlash: (kind % 16) / 15, ailments: kind % 3 === 0 ? AILMENT_BIT.chilled : 0, mods: kind % 4 === 0 ? ELITE_BIT.warded : 0,
      });
    });
    // Extremes of the packed head: the last wire slot and a full generation byte.
    putMonster(v, { slot: MAX_WIRE_SLOT, gen: 0xff, kind: MONSTER_KINDS.length - 1, rarity: RARITY_CODE.boss, x: 1, y: 1, life: 900, maxLife: 9000 });
    PROJECTILE_KINDS.forEach((_, kind) => {
      for (const variant of [0, 1, 2]) {
        putProjectile(v, {
          slot: 10 + kind * 3 + variant, gen: kind * 3 + variant, kind, hostile: variant !== 0, x: kind * 5, y: variant * 9,
          vx: -300 + kind * 40, vy: 55, radius: 2 + variant, age: variant === 2 ? 300 / 60 : (kind + 1) / 60,
          life: variant === 1 ? 1.25 : 0,
        });
      }
    });
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 1, 0));
    expect(s.theme).toBe('rimedOssuary');

    const m = s.monsters;
    expect(m.n).toBe(MONSTER_KINDS.length + 1);
    const byId = new Map<number, number>();
    for (let i = 0; i < m.n; i++) byId.set(m.id[i], i);
    MONSTER_KINDS.forEach((_, kind) => {
      const j = byId.get((((200 + kind) & 0xff) << 16) | (100 + kind))!;
      expect(j).toBeDefined();
      expect(m.kind[j]).toBe(kind);
      expect(m.rarity[j]).toBe(kind % 5);
      expect(m.facing[j]).toBe(kind % 2 ? 1 : -1);
      expect(m.anim[j]).toBe(kind % 6);
      expect(m.animTime[j]).toBeCloseTo(kind / 60, 5);
      expect(m.hitFlash[j]).toBeCloseTo((kind % 16) / 15, 5);
      expect(m.ailments[j]).toBe(kind % 3 === 0 ? AILMENT_BIT.chilled : 0);
      expect(m.mods[j]).toBe(kind % 4 === 0 ? ELITE_BIT.warded : 0);
      if (kind % 5 >= RARITY_CODE.rare) {
        expect(m.maxLife[j]).toBe(60 + kind);
        expect(m.life[j]).toBe(30 + kind);
      } else {
        expect(m.maxLife[j]).toBe(1);
        expect(m.life[j]).toBeCloseTo((30 + kind) / (60 + kind), 2);
      }
      expect(m.x[j]).toBeCloseTo(kind * 7 - 70, 3);
    });
    const edge = byId.get((0xff << 16) | MAX_WIRE_SLOT)!;
    expect(edge).toBeDefined();
    expect(m.kind[edge]).toBe(MONSTER_KINDS.indexOf('varkus'));
    expect(m.rarity[edge]).toBe(RARITY_CODE.boss);
    expect(m.maxLife[edge]).toBe(9000);

    const p = s.projectiles;
    expect(p.n).toBe(PROJECTILE_KINDS.length * 3);
    for (let i = 0; i < p.n; i++) {
      const slot = p.id[i] & 0xffff;
      const kind = Math.floor((slot - 10) / 3);
      const variant = (slot - 10) % 3;
      expect(p.id[i] >>> 16).toBe(kind * 3 + variant);
      expect(p.kind[i]).toBe(kind);
      expect(p.hostile[i]).toBe(variant !== 0 ? 1 : 0);
      expect(p.life[i]).toBeCloseTo(variant === 1 ? 1.25 : 0, 5);
      expect(p.age[i]).toBeCloseTo(variant === 2 ? 5 : (kind + 1) / 60, 5);
      expect(p.vx[i]).toBeCloseTo(-300 + kind * 40, 1);
      expect(p.radius[i]).toBe(2 + variant);
    }
  });

  it('round-trips every area kind of the new rosters (telegraphs, pools, marks)', () => {
    const v = makeView({ theme: 'ironColiseum' });
    v.players.push(makePlayer(1));
    AREA_KINDS.forEach((kind, k) => v.areas.push(makeArea({ id: 5000 + k, kind, x: k * 10 - 90, y: 20, radius: 12 + k, age: k * 0.05, duration: 3 })));
    // A charge line telegraph is long (radius = length): it stays in the AOI while any of it can be.
    v.areas.push(makeArea({ id: 9, kind: 'chargeLine', x: AOI_HALF_WIDTH + AOI_MARGIN + 300, y: 0, radius: 420, age: 0.1, duration: 0.6 }));
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 1, 0));
    const got = s.areas.slice(0, s.areaCount);
    expect(got.map((a) => a.kind)).toEqual([...AREA_KINDS, 'chargeLine']);
    expect(got[AREA_KINDS.indexOf('icePrison')]).toMatchObject({ id: 5000 + AREA_KINDS.indexOf('icePrison'), radius: 12 + AREA_KINDS.indexOf('icePrison') });
    expect(got[got.length - 1]).toMatchObject({ id: 9, radius: 420 });
  });

  it('never lets a carpet of tar pools crowd out a telegraph: telegraphs first, then the nearest ground', () => {
    // The sim's area list is oldest-first: hundreds of persistent pools, then the fresh telegraphs at the end.
    const v = makeView({ theme: 'ironColiseum' });
    v.players.push(makePlayer(1, { x: 40, y: -30 }));
    // The oldest area of all: the pool she stands in (it slows her; her prediction needs it).
    v.areas.push(makeArea({ id: 1, kind: 'tarPool', x: 41, y: -29, radius: 26, age: 5.5, duration: 6 }));
    let id = 2;
    for (let k = 0; k < 300; k++) {
      // A 20 × 15 grid of pools across the whole AOI (nearest ones around the viewer).
      const gx = (k % 20) - 9.5;
      const gy = Math.floor(k / 20) - 7;
      v.areas.push(makeArea({ id: id++, kind: 'tarPool', x: 40 + gx * 52, y: -30 + gy * 44, radius: 26, age: 1, duration: 6 }));
    }
    for (let k = 0; k < 40; k++) v.areas.push(makeArea({ id: id++, kind: 'fireTrail', x: 40 + k, y: -30, radius: 14, age: 0.5, duration: 2 }));
    v.areas.push(makeArea({ id: 70001, kind: 'chargeLine', x: 300, y: 200, radius: 380, age: 0.05, duration: 0.8 }));
    v.areas.push(makeArea({ id: 70002, kind: 'executionMark', x: 40, y: -30, radius: 36, age: 0.1, duration: 3 }));
    v.areas.push(makeArea({ id: 70003, kind: 'slamWarning', x: -400, y: 300, radius: 48, age: 0.2, duration: 1 }));
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 1, 0));
    const got = s.areas.slice(0, s.areaCount);
    // Every telegraph arrives (they were created last) …
    for (const tid of [70001, 70002, 70003]) expect(got.some((a) => a.id === tid)).toBe(true);
    // … the ground fills its own budget, nearest first: every chosen pool is at least as near as every dropped one.
    const ground = got.filter((a) => a.kind === 'tarPool' || a.kind === 'fireTrail');
    expect(ground).toHaveLength(MAX_WIRE_GROUND_AREAS);
    expect(got).toHaveLength(MAX_WIRE_GROUND_AREAS + 3);
    // Hazardous ground (tar) outranks the players' own fire trails: 256 of the 301 pools fill it.
    expect(ground.every((a) => a.kind === 'tarPool')).toBe(true);
    const d2 = (a: Pick<AreaView, 'x' | 'y'>) => (a.x - 40) ** 2 + (a.y + 30) ** 2;
    const sentIds = new Set(got.map((a) => a.id));
    const sentFar = Math.max(...v.areas.filter((a) => a.kind === 'tarPool' && sentIds.has(a.id)).map(d2));
    const droppedNear = Math.min(...v.areas.filter((a) => a.kind === 'tarPool' && !sentIds.has(a.id)).map(d2));
    expect(sentFar).toBeLessThanOrEqual(droppedNear);
    // The pool under her feet is always among them, and the chosen areas keep the sim's order.
    expect(got[0].id).toBe(1);
    expect(got.map((a) => a.id)).toEqual([...got.map((a) => a.id)].sort((a, b) => a - b));
  });

  it('sends every area when they fit, and caps a pathological telegraph flood at MAX_WIRE_AREAS (nearest kept)', () => {
    const v = makeView();
    v.players.push(makePlayer(1));
    // Under both caps: all of them, including more than the old u8 limit of 255.
    for (let k = 0; k < 400; k++) v.areas.push(makeArea({ id: 1 + k, kind: 'slamWarning', x: (k % 40) * 20 - 400, y: Math.floor(k / 40) * 30 - 150, radius: 20 }));
    for (let k = 0; k < 100; k++) v.areas.push(makeArea({ id: 1000 + k, kind: 'firePool', x: k * 5 - 250, y: 60, radius: 30 }));
    const enc = createSnapshotEncoder();
    let s = decodeSnapshot(enc.encode(v, 1, 0));
    expect(s.areaCount).toBe(500);
    expect(s.areas.slice(0, s.areaCount).map((a) => a.id)).toEqual(v.areas.map((a) => a.id));
    // More telegraphs than the whole budget: the nearest MAX_WIRE_AREAS, no ground at all.
    v.areas.length = 0;
    for (let k = 0; k < MAX_WIRE_AREAS + 76; k++) v.areas.push(makeArea({ id: 1 + k, kind: 'glacialSpike', x: 0.5 * k, y: 0, radius: 10 }));
    v.areas.push(makeArea({ id: 99999, kind: 'tarPool', x: 1, y: 1, radius: 30 }));
    s = decodeSnapshot(enc.encode(v, 1, 0));
    expect(s.areaCount).toBe(MAX_WIRE_AREAS);
    const ids = s.areas.slice(0, s.areaCount).map((a) => a.id);
    expect(ids).toEqual(Array.from({ length: MAX_WIRE_AREAS }, (_, k) => 1 + k));
    // Tier table: pools and trails are ground, every telegraph / moving hazard is tier 0.
    const tierOf = (kind: (typeof AREA_KINDS)[number]) => AREA_TIER[AREA_KINDS.indexOf(kind)];
    expect([tierOf('tarPool'), tierOf('firePool'), tierOf('fireTrail')]).toEqual([1, 1, 2]);
    for (const kind of AREA_KINDS) if (!['tarPool', 'firePool', 'fireTrail'].includes(kind)) expect(tierOf(kind)).toBe(0);
  });

  it('never writes an entity the wire cannot address (slot past 12 bits); the client could not show it anyway', () => {
    const v = makeView({ monsters: makeMonsterStore(8192), projectiles: makeProjectileStore(8192) });
    v.players.push(makePlayer(1));
    putMonster(v, { slot: MAX_WIRE_SLOT, x: 1, y: 1 });
    putMonster(v, { slot: MAX_WIRE_SLOT + 1, x: 2, y: 2 });
    putProjectile(v, { slot: MAX_WIRE_SLOT, x: 1, y: 1 });
    putProjectile(v, { slot: 6000, x: 1, y: 1 });
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 1, 0));
    expect(Array.from(s.monsters.id.subarray(0, s.monsters.n))).toEqual([MAX_WIRE_SLOT]);
    expect(Array.from(s.projectiles.id.subarray(0, s.projectiles.n))).toEqual([MAX_WIRE_SLOT]);
  });

  it('round-trips every player\'s debuffs: ids, stacks, root sources and millisecond timers', () => {
    const v = makeView();
    const sources: RootSource[] = ['bone', 'web', 'chain', 'tar'];
    const all: PlayerDebuffView[] = PLAYER_DEBUFFS.map((id, k) => ({
      id, remaining: 0.25 + k * 0.4567, duration: 0.8 + k, stacks: id === 'bleeding' || id === 'withered' ? 3 : 1,
      source: id === 'rooted' ? 'tar' : null,
    }));
    const me = makePlayer(1, { debuffs: all });
    const ally = makePlayer(2, { x: 40, debuffs: sources.map((source, k) => ({ id: 'rooted', remaining: 1.4 - k * 0.1, duration: 1.4, stacks: 1, source })) });
    const clean = makePlayer(3, { x: -40 });
    const deadAlly = makePlayer(4, { x: 80, dead: true, anim: 'death' });
    v.players.push(me, ally, clean, deadAlly);
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 1, 0));
    const got = s.player(1)!.debuffs;
    expect(got).toHaveLength(PLAYER_DEBUFFS.length);
    got.forEach((d, k) => {
      expect(d.id).toBe(PLAYER_DEBUFFS[k]);
      expect(Math.abs(d.remaining - all[k].remaining)).toBeLessThanOrEqual(0.0005 + 1e-9);
      expect(Math.abs(d.duration - all[k].duration)).toBeLessThanOrEqual(0.0005 + 1e-9);
      expect(d.stacks).toBe(all[k].stacks);
      expect(d.source).toBe(all[k].source);
    });
    // Allies carry theirs too (overlays), in the sim's order.
    expect(s.player(2)!.full).toBe(false);
    expect(s.player(2)!.debuffs.map((d) => d.source)).toEqual(sources);
    expect(s.player(2)!.debuffs[3].remaining).toBeCloseTo(1.1, 3);
    expect(s.player(3)!.debuffs).toEqual([]);
    expect(s.player(4)!.debuffs).toEqual([]);
  });

  it('pays one byte per player plus 6 bytes per debuff, and clamps or skips what does not fit', () => {
    const enc = createSnapshotEncoder();
    const v = makeView();
    const me = makePlayer(1);
    v.players.push(me);
    const base = enc.encode(v, 1, 0).byteLength;
    me.debuffs.push(
      { id: 'burning', remaining: 2.5, duration: 3, stacks: 1, source: null },
      { id: 'bleeding', remaining: 3.9, duration: 4, stacks: 2, source: null },
    );
    expect(enc.encode(v, 1, 0).byteLength).toBe(base + 12);
    // Out-of-range timers clamp; an id outside the contract table is dropped instead of corrupting the stream.
    me.debuffs.length = 0;
    me.debuffs.push(
      { id: 'shocked', remaining: 99999, duration: -3, stacks: 700, source: null },
      { id: 'mystery' as PlayerDebuffView['id'], remaining: 1, duration: 1, stacks: 1, source: null },
      { id: 'withered', remaining: Number.NaN, duration: 4, stacks: 2, source: null },
    );
    const s = decodeSnapshot(enc.encode(v, 1, 0));
    expect(s.player(1)!.debuffs.map((d) => d.id)).toEqual(['shocked', 'withered']);
    expect(s.player(1)!.debuffs[0]).toMatchObject({ remaining: 65.535, duration: 0, stacks: 255 });
    expect(s.player(1)!.debuffs[1].remaining).toBe(0);
  });

  it('never rounds a running debuff timer down to 0 ms (the sim still applies it on its next tick)', () => {
    // 2 s minus 120 float ticks leaves ~2e-15 s: the sim's chill still slows the 121st tick.
    let residue = 2;
    for (let k = 0; k < 120; k++) residue -= 1 / 60;
    expect(residue).toBeGreaterThan(0);
    const v = makeView();
    v.players.push(makePlayer(1, { debuffs: [{ id: 'chilled', remaining: residue, duration: 2, stacks: 1, source: null }] }));
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 1, 0));
    expect(s.player(1)!.debuffs[0].remaining).toBe(0.001);
  });

  it('decodes debuffs into pooled objects: lists shrink and grow without new allocations', () => {
    const enc = createSnapshotEncoder();
    const v = makeView();
    const me = makePlayer(1);
    v.players.push(me);
    const snap = new Snapshot();
    const reader = new ByteReader();
    const interner = new StringInterner();
    const decode = () => {
      snap.decode(enc.encode(v, 1, 0), reader, interner);
      return snap.player(1)!.debuffs;
    };
    me.debuffs = [
      { id: 'chilled', remaining: 1, duration: 2, stacks: 1, source: null },
      { id: 'rooted', remaining: 1, duration: 1.4, stacks: 1, source: 'web' },
    ];
    const list = decode();
    const [a, b] = list;
    me.debuffs = [];
    expect(decode()).toBe(list);
    expect(list).toHaveLength(0);
    me.debuffs = [
      { id: 'frozen', remaining: 0.5, duration: 0.8, stacks: 1, source: null },
      { id: 'rooted', remaining: 0.9, duration: 1.4, stacks: 1, source: 'chain' },
    ];
    decode();
    expect(list[0]).toBe(a);
    expect(list[1]).toBe(b);
    expect(list[0]).toMatchObject({ id: 'frozen', source: null });
    expect(list[1]).toMatchObject({ id: 'rooted', source: 'chain' });
  });

  it('rejects out-of-table monster kinds, projectile kinds, debuff ids and root sources', () => {
    const enc = createSnapshotEncoder();
    // Find a field's byte by encoding two worlds that differ only in it.
    const diffAt = (a: Uint8Array, b: Uint8Array) => {
      expect(a.length).toBe(b.length);
      const at: number[] = [];
      for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) at.push(k);
      return at;
    };
    const monsterWorld = (kind: number) => {
      const v = makeView();
      putMonster(v, { slot: 1, kind, x: 0, y: 0 });
      return new Uint8Array(enc.encode(v, 1, 0));
    };
    const m0 = monsterWorld(0);
    // Kind = head bits 20–25: the low 4 in byte 2 (bits 4–7), the top 2 in byte 3 (bits 0–1).
    const [kindByte] = diffAt(m0, monsterWorld(1));
    const badMonster = m0.slice();
    badMonster[kindByte + 1] |= 0x03; // kind 48: past the 22-entry table
    expect(() => decodeSnapshot(badMonster)).toThrow('monster kind 48');

    const projectileWorld = (kind: number) => {
      const v = makeView();
      putProjectile(v, { slot: 1, kind, x: 0, y: 0 });
      return new Uint8Array(enc.encode(v, 1, 0));
    };
    const p0 = projectileWorld(0);
    const [pKindByte] = diffAt(p0, projectileWorld(1));
    const badProjectile = p0.slice();
    badProjectile[pKindByte + 1] |= 0x03;
    expect(() => decodeSnapshot(badProjectile)).toThrow('projectile kind 48');

    const debuffWorld = (id: PlayerDebuffView['id'], source: RootSource | null) => {
      const v = makeView();
      v.players.push(makePlayer(1, { debuffs: [{ id, remaining: 1, duration: 1, stacks: 1, source }] }));
      return new Uint8Array(enc.encode(v, 1, 0));
    };
    const d0 = debuffWorld('chilled', null);
    const [debuffByte] = diffAt(d0, debuffWorld('frozen', null));
    expect(diffAt(d0, debuffWorld('chilled', 'web'))).toEqual([debuffByte]);
    const badId = d0.slice();
    badId[debuffByte] = 0x0f;
    expect(() => decodeSnapshot(badId)).toThrow(/bad debuff code 15/);
    const badSource = d0.slice();
    badSource[debuffByte] = 0x90; // chilled | source code 9
    expect(() => decodeSnapshot(badSource)).toThrow(/root source/);
  });
});
