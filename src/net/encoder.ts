// Server-side snapshot encoder: WorldView (+ viewer id + acked input seq) → one compact binary message.
// Layout: see the table at the top of snapshot.ts. One encoder may serve any number of viewers and instances;
// it only keeps a reusable output buffer between calls.
import { AOI_HALF_HEIGHT, AOI_HALF_WIDTH } from '../contracts/net';
import type { SnapshotEncoder } from '../contracts/net';
import type { DropView, PlayerView, WorldView } from '../contracts/sim';
import { ByteWriter } from './bytes';
import {
  AIM_SCALE, ANIM_TIME_SCALE, AOI_MARGIN, AREA_KIND_CODE, AREA_RADIUS_SCALE, DIR4_CODE, DROP_AUTO_PICKUP_BIT,
  DROP_BLOCKED_BIT, DROP_SPRITE_CODE, DROP_TONE_CODE, DYNAMIC_PROP_KINDS, FLASK_CODE, MAX_WIRE_AREAS,
  MAX_WIRE_DROPS, MAX_WIRE_ENTITIES, MAX_WIRE_PLAYERS, MAX_WIRE_PROPS, MAX_WIRE_PUBLIC_DROPS, MONSTER_KINDS,
  PLAYER_ANIM_CODE, POS_SCALE, PROJ_VEL_SCALE, PROJECTILE_KINDS, PROP_KIND_CODE, RADIUS_SCALE, RUN_PHASE_CODE,
  SKILL_CODE, SNAPSHOT_VERSION, THEME_CODE,
} from './protocol';

// Bit-packed fields need these tables to stay small.
if (MONSTER_KINDS.length > 8 || PROJECTILE_KINDS.length > 8) throw new Error('net: kind tables outgrew their 3-bit fields');

const I16_MIN = -32768;
const I16_MAX = 32767;

function clampInt(v: number, lo: number, hi: number): number {
  if (!(v > lo)) return lo; // also maps NaN to lo
  return v < hi ? Math.round(v) : hi;
}

function q16(v: number): number {
  const r = Math.round(v);
  return r < I16_MIN ? I16_MIN : r > I16_MAX ? I16_MAX : r || 0;
}

function ms16(seconds: number): number {
  return clampInt(seconds * 1000, 0, 0xffff);
}

/** Candidate a comes before b: nearer, ties broken by the lower view.drops index (keeps the choice deterministic). */
function nearer(da: number, ia: number, db: number, ib: number): boolean {
  return da < db || (da === db && ia < ib);
}

/**
 * Partial selection (Hoare quickselect, median-of-three pivot): afterwards idx[0..k) hold the k nearest of the c
 * candidates, in no particular order. Keys are unique (index tie-break), so every partition step shrinks the range.
 */
function selectNearest(idx: Int32Array, dist: Float64Array, c: number, k: number): void {
  let lo = 0;
  let hi = c - 1;
  const target = k - 1;
  while (lo < hi) {
    const p = median3(idx, dist, lo, (lo + hi) >>> 1, hi);
    const pd = dist[p];
    const pi = idx[p];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (nearer(dist[i], idx[i], pd, pi)) i++;
      while (nearer(pd, pi, dist[j], idx[j])) j--;
      if (i <= j) {
        const ti = idx[i];
        idx[i] = idx[j];
        idx[j] = ti;
        const td = dist[i];
        dist[i] = dist[j];
        dist[j] = td;
        i++;
        j--;
      }
    }
    if (target <= j) hi = j;
    else if (target >= i) lo = i;
    else return;
  }
}

/** Position of the median key among positions a, b, c. */
function median3(idx: Int32Array, dist: Float64Array, a: number, b: number, c: number): number {
  const ab = nearer(dist[a], idx[a], dist[b], idx[b]);
  const bc = nearer(dist[b], idx[b], dist[c], idx[c]);
  if (ab === bc) return b; // a < b < c or c < b < a
  const ac = nearer(dist[a], idx[a], dist[c], idx[c]);
  // ab: b is the largest → the larger of a and c. Otherwise b is the smallest → the smaller of a and c.
  return ab ? (ac ? c : a) : ac ? a : c;
}

/** Insertion sort of idx[0..k) ascending (k ≤ MAX_WIRE_DROPS). */
function sortPrefix(idx: Int32Array, k: number): void {
  for (let i = 1; i < k; i++) {
    const v = idx[i];
    let j = i - 1;
    while (j >= 0 && idx[j] > v) {
      idx[j + 1] = idx[j];
      j--;
    }
    idx[j + 1] = v;
  }
}

/**
 * End of the live slot range of a store. The sim's stores carry a high-water mark `hwm` beyond the contract (every
 * slot at or past it is dead); other WorldView producers fall back to the full capacity.
 */
function storeEnd(store: { capacity: number }): number {
  const hwm = (store as { hwm?: unknown }).hwm;
  return typeof hwm === 'number' && hwm >= 0 && hwm < store.capacity ? hwm : store.capacity;
}

export interface NetSnapshotEncoder extends SnapshotEncoder {
  /** Byte length of the last encoded snapshot (bandwidth metrics). */
  readonly lastByteLength: number;
}

export function createSnapshotEncoder(): NetSnapshotEncoder {
  const w = new ByteWriter(16 * 1024);
  let lastByteLength = 0;

  function writePlayer(p: PlayerView, full: boolean): void {
    w.u8(p.id);
    const castCode = p.castSkill === null ? undefined : SKILL_CODE.get(p.castSkill);
    const casting = castCode !== undefined;
    const bits =
      (DIR4_CODE.get(p.facing) ?? 0) |
      ((PLAYER_ANIM_CODE.get(p.anim) ?? 0) << 2) |
      (p.dead ? 32 : 0) |
      (full ? 64 : 0) |
      (casting ? 128 : 0);
    w.u8(bits);
    w.u8(clampInt(p.level, 0, 255));
    w.str(p.name);
    w.f32(p.x);
    w.f32(p.y);
    // Exact velocity: the viewer's client recovers its base move speed from it for prediction.
    w.f32(p.vx);
    w.f32(p.vy);
    w.i16(q16((p.aimX - p.x) * AIM_SCALE));
    w.i16(q16((p.aimY - p.y) * AIM_SCALE));
    w.f32(p.animTime);
    if (castCode !== undefined) {
      w.u8(castCode);
      // 16 bits: the viewer's client derives cast times and the remaining cast from consecutive progress values.
      w.u16(clampInt(p.castProgress * 65535, 0, 65535));
    }
    w.f32(p.life);
    w.f32(p.maxLife);
    w.u16(ms16(p.wardTime));
    w.u16(ms16(p.wardDuration));
    w.u16(ms16(p.invulnTime));
    w.u8(clampInt(p.hitFlash * 255, 0, 255));
    if (!full) return;
    w.f32(p.focus);
    w.f32(p.maxFocus);
    const nSlots = Math.min(p.slots.length, 16);
    w.u8(nSlots);
    for (let s = 0; s < nSlots; s++) {
      const sv = p.slots[s];
      const code = sv.skillId === null ? undefined : SKILL_CODE.get(sv.skillId);
      w.u8(code === undefined ? 0 : code + 1);
      w.u8(sv.usable ? 1 : 0);
      w.u16(ms16(sv.cooldown));
      w.u16(ms16(sv.cooldownTotal));
      w.u8(clampInt(sv.charges, 0, 255));
      w.u8(clampInt(sv.maxCharges, 0, 255));
      w.f32(sv.focusCost);
    }
    const nFlasks = Math.min(p.flasks.length, 16);
    w.u8(nFlasks);
    for (let f = 0; f < nFlasks; f++) {
      const fv = p.flasks[f];
      const code = fv ? FLASK_CODE.get(fv.flaskId) : undefined;
      if (!fv || code === undefined) {
        w.u8(0);
        continue;
      }
      w.u8(code + 1);
      w.u8(clampInt(fv.count, 0, 255));
      w.u8(fv.resource === 'focus' ? 1 : 0);
      w.u16(ms16(fv.active));
      w.u16(ms16(fv.duration));
    }
  }

  // Drop candidates of one pass (indices into view.drops + squared distance to the viewer), reused across encodes.
  let candIdx = new Int32Array(256);
  let candDist = new Float64Array(256);

  /**
   * Write up to `room` drops owned by `owner` inside the AOI; returns how many were written. When more are in the
   * AOI than fit, the ones nearest to the viewer are kept (ties → lower index), still written in view.drops order
   * so the client's list order stays stable while the viewer walks. `blocked` ("Inventory full" under the label)
   * describes the owner's failed pickup, so it only travels on instanced loot: on a public drop it would tell every
   * onlooker about somebody else's full backpack.
   */
  function writeDrops(
    drops: readonly DropView[], owner: number, ox: number, oy: number, hw: number, hh: number, room: number,
  ): number {
    if (room <= 0) return 0;
    let c = 0;
    for (let k = 0; k < drops.length; k++) {
      const d = drops[k];
      if (d.spec.owner !== owner) continue;
      const dx = d.x - ox;
      const dy = d.y - oy;
      if (dx > hw || dx < -hw || dy > hh || dy < -hh) continue;
      if (c === candIdx.length) {
        const idx = new Int32Array(c * 2);
        idx.set(candIdx);
        candIdx = idx;
        const dist = new Float64Array(c * 2);
        dist.set(candDist);
        candDist = dist;
      }
      const d2 = dx * dx + dy * dy;
      candIdx[c] = k;
      candDist[c] = d2 === d2 ? d2 : Infinity; // a NaN position must not break the ordering
      c++;
    }
    if (c > room) {
      selectNearest(candIdx, candDist, c, room);
      sortPrefix(candIdx, room);
      c = room;
    }
    for (let q = 0; q < c; q++) {
      const d = drops[candIdx[q]];
      const spec = d.spec;
      w.u32(d.id);
      w.u32(spec.token);
      w.u8(spec.owner);
      w.u8(
        (DROP_TONE_CODE.get(spec.tone) ?? 0) |
          ((DROP_SPRITE_CODE.get(spec.sprite) ?? 0) << 3) |
          (d.blocked && owner !== 0 ? DROP_BLOCKED_BIT : 0) |
          (spec.autoPickup ? DROP_AUTO_PICKUP_BIT : 0),
      );
      w.str(spec.label);
      w.str(spec.iconId);
      w.i16(q16((d.x - ox) * POS_SCALE));
      w.i16(q16((d.y - oy) * POS_SCALE));
      w.u16(clampInt(d.z * POS_SCALE, 0, 0xffff));
      w.f32(d.age);
    }
    return c;
  }

  function encode(view: WorldView, viewerId: number, ackSeq: number): ArrayBuffer {
    w.reset();
    const players = view.players;
    let viewer: PlayerView | null = null;
    for (let k = 0; k < players.length; k++) {
      if (players[k].id === viewerId) {
        viewer = players[k];
        break;
      }
    }
    // AOI centre = the viewer's authoritative position (the hideout/map centre until they have joined).
    const ox = viewer ? Math.round(viewer.x) : 0;
    const oy = viewer ? Math.round(viewer.y) : 0;
    const hw = AOI_HALF_WIDTH + AOI_MARGIN;
    const hh = AOI_HALF_HEIGHT + AOI_MARGIN;

    // --- header -------------------------------------------------------------
    w.u8(SNAPSHOT_VERSION);
    w.u32(view.tick);
    w.u32(ackSeq);
    w.u8(viewerId);
    w.u8(THEME_CODE.get(view.theme) ?? 0);
    w.f32(view.arenaRadius);
    w.f32(ox);
    w.f32(oy);

    // --- run ----------------------------------------------------------------
    const run = view.run;
    w.u8(RUN_PHASE_CODE.get(run.phase) ?? 0);
    w.u8(clampInt(run.wave, 0, 255));
    w.u8(clampInt(run.waveCount, 0, 255));
    w.f32(run.waveTime);
    w.f32(run.waveDuration);
    w.f32(run.elapsed);
    w.u32(clampInt(run.kills, 0, 0xffffffff));
    w.u16(clampInt(run.monstersAlive, 0, 0xffff));
    w.u8(clampInt(run.playersAlive, 0, 255));
    w.u8((run.boss ? 1 : 0) | (run.lieutenant ? 2 : 0) | (run.portalOpen ? 4 : 0));
    if (run.boss) {
      w.str(run.boss.name);
      w.f32(run.boss.life);
      w.f32(run.boss.maxLife);
      w.u8(clampInt(run.boss.phase, 0, 255));
    }
    if (run.lieutenant) {
      w.str(run.lieutenant.name);
      w.f32(run.lieutenant.life);
      w.f32(run.lieutenant.maxLife);
    }

    // --- players (all of them; the viewer's own record carries the HUD data) ---
    const nPlayers = Math.min(players.length, MAX_WIRE_PLAYERS);
    w.u8(nPlayers);
    for (let k = 0; k < nPlayers; k++) writePlayer(players[k], players[k] === viewer);

    // --- monsters (AOI) -------------------------------------------------------
    const m = view.monsters;
    let at = w.pos;
    w.u16(0);
    let n = 0;
    const mEnd = storeEnd(m);
    for (let i = 0; i < mEnd && n < MAX_WIRE_ENTITIES; i++) {
      if (!m.alive[i]) continue;
      const r = m.radius[i];
      const dx = m.x[i] - ox;
      const dy = m.y[i] - oy;
      if (dx > hw + r || dx < -hw - r || dy > hh + r || dy < -hh - r) continue;
      const id = m.id[i];
      const rarity = m.rarity[i] & 7;
      const hasMax = rarity >= 2;
      w.u16(id & 0xffff);
      w.u8((id >>> 16) & 0xff);
      w.u8((m.kind[i] & 7) | (rarity << 3) | (m.facing[i] >= 0 ? 64 : 0) | (hasMax ? 128 : 0));
      w.i16(q16(dx * POS_SCALE));
      w.i16(q16(dy * POS_SCALE));
      // Most monsters carry no ailment and no elite mod: a flag bit saves those two bytes.
      const ailments = m.ailments[i];
      const mods = m.mods[i];
      const extras = ailments !== 0 || mods !== 0;
      w.u8((m.anim[i] & 7) | (extras ? 8 : 0) | (clampInt(m.hitFlash[i] * 15, 0, 15) << 4));
      // Anim time in whole ticks, wrapping (anim continuity only needs the low bits).
      w.u16(Math.round(Math.max(0, m.animTime[i]) * ANIM_TIME_SCALE) & 0xffff);
      const maxLife = m.maxLife[i];
      const life = m.life[i];
      let lifeQ: number;
      if (!(maxLife > 0) || life >= maxLife) lifeQ = 255;
      else if (!(life > 0)) lifeQ = 0;
      else lifeQ = Math.min(254, Math.max(1, Math.floor((life / maxLife) * 255)));
      w.u8(lifeQ);
      w.u8(clampInt(r * RADIUS_SCALE, 0, 255));
      if (extras) {
        w.u8(ailments);
        w.u8(mods);
      }
      if (hasMax) {
        // Rares, lieutenants and bosses are few and show real numbers: exact life.
        w.f32(maxLife);
        w.f32(life);
      }
      n++;
    }
    w.patchU16(at, n);

    // --- projectiles (AOI) ------------------------------------------------------
    const pr = view.projectiles;
    at = w.pos;
    w.u16(0);
    n = 0;
    const prEnd = storeEnd(pr);
    for (let i = 0; i < prEnd && n < MAX_WIRE_ENTITIES; i++) {
      if (!pr.alive[i]) continue;
      const r = pr.radius[i];
      const dx = pr.x[i] - ox;
      const dy = pr.y[i] - oy;
      if (dx > hw + r || dx < -hw - r || dy > hh + r || dy < -hh - r) continue;
      const id = pr.id[i];
      const lobbed = pr.life[i] > 0;
      // Ages advance in whole sim ticks: tick counts are lossless. A u8 covers 4.25 s; longer-lived projectiles
      // (the Matriarch's spiral orbs) switch to a u16.
      const ageTicks = clampInt(pr.age[i] * ANIM_TIME_SCALE, 0, 0xffff);
      const wideAge = ageTicks > 0xff;
      w.u16(id & 0xffff);
      w.u8((id >>> 16) & 0xff);
      w.u8((pr.kind[i] & 7) | (pr.hostile[i] ? 8 : 0) | (lobbed ? 16 : 0) | (wideAge ? 32 : 0));
      w.i16(q16(dx * POS_SCALE));
      w.i16(q16(dy * POS_SCALE));
      w.i16(q16(pr.vx[i] * PROJ_VEL_SCALE));
      w.i16(q16(pr.vy[i] * PROJ_VEL_SCALE));
      w.u8(clampInt(r * RADIUS_SCALE, 0, 255));
      if (wideAge) w.u16(ageTicks);
      else w.u8(ageTicks);
      if (lobbed) w.u8(clampInt(pr.life[i] * ANIM_TIME_SCALE, 1, 255));
      n++;
    }
    w.patchU16(at, n);

    // --- motes (AOI) --------------------------------------------------------------
    const mo = view.motes;
    at = w.pos;
    w.u16(0);
    n = 0;
    const moEnd = storeEnd(mo);
    for (let i = 0; i < moEnd && i <= 0xffff && n < MAX_WIRE_ENTITIES; i++) {
      if (!mo.alive[i]) continue;
      const dx = mo.x[i] - ox;
      const dy = mo.y[i] - oy;
      if (dx > hw || dx < -hw || dy > hh || dy < -hh) continue;
      w.u16(i);
      w.u8(mo.size[i]);
      w.i16(q16(dx * POS_SCALE));
      w.i16(q16(dy * POS_SCALE));
      n++;
    }
    w.patchU16(at, n);

    // --- areas (AOI) ---------------------------------------------------------------
    at = w.pos;
    w.u8(0);
    n = 0;
    const areas = view.areas;
    for (let k = 0; k < areas.length && n < MAX_WIRE_AREAS; k++) {
      const a = areas[k];
      const code = AREA_KIND_CODE.get(a.kind);
      if (code === undefined) continue;
      const dx = a.x - ox;
      const dy = a.y - oy;
      const r = a.radius;
      if (dx > hw + r || dx < -hw - r || dy > hh + r || dy < -hh - r) continue;
      w.u32(a.id);
      w.u8(code);
      w.i16(q16(dx * POS_SCALE));
      w.i16(q16(dy * POS_SCALE));
      w.u16(clampInt(r * AREA_RADIUS_SCALE, 0, 0xffff));
      w.f32(a.age);
      w.f32(a.duration);
      n++;
    }
    w.patchU8(at, n);

    // --- drops: the viewer's own (instanced loot) first, then public ones (owner 0), AOI-culled ----------
    at = w.pos;
    w.u8(0);
    // A viewer id of 0 is never a player (ids are 1..255) and owns nothing: owner 0 is the public pass.
    n = viewerId !== 0 ? writeDrops(view.drops, viewerId, ox, oy, hw, hh, MAX_WIRE_DROPS) : 0;
    n += writeDrops(view.drops, 0, ox, oy, hw, hh, Math.min(MAX_WIRE_PUBLIC_DROPS, MAX_WIRE_DROPS - n));
    w.patchU8(at, n);

    // --- dynamic props (chests, portals, anything with state) — not AOI-culled -------------
    at = w.pos;
    w.u8(0);
    n = 0;
    const props = view.props;
    for (let k = 0; k < props.length && n < MAX_WIRE_PROPS; k++) {
      const p = props[k];
      if (!DYNAMIC_PROP_KINDS.has(p.kind) && p.state === 0) continue;
      const code = PROP_KIND_CODE.get(p.kind);
      if (code === undefined) continue;
      w.u32(p.id);
      w.u8(code);
      w.f32(p.x);
      w.f32(p.y);
      w.f32(p.radius);
      w.u16(clampInt(p.state, 0, 0xffff));
      w.u8(clampInt(p.variant, 0, 255));
      w.u8(p.interactive ? 1 : 0);
      n++;
    }
    w.patchU8(at, n);

    lastByteLength = w.pos;
    return w.finish();
  }

  return {
    encode,
    get lastByteLength() {
      return lastByteLength;
    },
  };
}
