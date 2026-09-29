import { describe, expect, it } from 'vitest';
import { AOI_HALF_HEIGHT, AOI_HALF_WIDTH } from '../../src/contracts/net';
import { AILMENT_BIT, ELITE_BIT, MONSTER_ANIM, RARITY_CODE } from '../../src/contracts/sim';
import {
  AOI_MARGIN, MAX_WIRE_DROPS, MAX_WIRE_PUBLIC_DROPS, SNAPSHOT_VERSION, SnapshotDecodeError, createSnapshotEncoder,
  decodeSnapshot,
} from '../../src/net';
import {
  fillSlots, makeArea, makeDrop, makePlayer, makeProp, makeView, putMonster, putMote, putProjectile, setTick,
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
    expect(me.slots.map((sl) => sl.skillId)).toEqual(['emberLance', 'emberNova', 'riftStep', null, 'cinderWard', null]);
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
    // header 23 B · run 23 B · players 1 · monsters 2 · projectiles 2 · motes 2 · areas 1 · drop count 1 → record at 55.
    const flagsOf = (drop: ReturnType<typeof makeDrop>) => {
      const v = makeView();
      v.drops.push(drop);
      const bytes = new Uint8Array(createSnapshotEncoder().encode(v, 1, 0));
      expect(bytes[0]).toBe(SNAPSHOT_VERSION);
      expect(bytes[54]).toBe(1); // one drop
      expect(bytes[55 + 8]).toBe(drop.spec.owner);
      return bytes[55 + 9];
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

  it('stamps version 3 and rejects version-2 snapshots, so a stale pre-pickup bundle reloads instead of limping on', () => {
    // Version 3 = public drops (owner 0) + the autoPickup bit. A version-2 client has no click pickup: if it kept
    // decoding it could never pick up equipment. Its decoder rejects every v3 snapshot, and after
    // MAX_SNAPSHOT_FAILURES the client reloads into the new bundle.
    expect(SNAPSHOT_VERSION).toBe(3);
    const v = richWorld();
    const buf = new Uint8Array(createSnapshotEncoder().encode(v, 1, 1));
    expect(buf[0]).toBe(3);
    const old = buf.slice();
    old[0] = 2;
    expect(() => decodeSnapshot(old)).toThrow(SnapshotDecodeError);
    expect(() => decodeSnapshot(old)).toThrow('snapshot version 2 != 3');
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
