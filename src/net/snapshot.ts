// Decoded snapshot structures (pooled, reused across messages) and the binary decoder.
//
// Wire layout (little-endian; see encoder.ts for the writer). Positions of AOI entities are i16 offsets from the
// origin (the viewer's server position) in 1/16 units; players, props and the origin itself are f32.
//
//   header   u8 version · u32 tick · u32 ackSeq · u8 viewerId · u8 theme · f32 arenaRadius · f32 originX · f32 originY
//   run      u8 phase · u8 wave · u8 waveCount · f32 waveTime · f32 waveDuration · f32 elapsed · u32 kills
//            · u16 monstersAlive · u8 playersAlive · u8 flags(boss|lieutenant<<1|portalOpen<<2|event<<3|boss2<<4)
//            · [boss: str name · f32 life · f32 maxLife · u8 phase] · [boss2: the same] · [lieutenant: str name · f32 life · f32 maxLife]
//            · [event: u8 kind · u8 phase · f32 x · f32 y · u8 remaining · u8 total · u8 seconds(255=none)]
//   players  u8 n · n × { u8 id · u8 bits(facing:2|anim:3|dead|full|casting) · u8 level · str name · f32 x · f32 y
//            · f32 vx · f32 vy · i16 aimDx·8 · i16 aimDy·8 · f32 animTime · [u8 skill · u16 progress·65535]
//            · f32 life · f32 maxLife · u16 wardTime ms · u16 wardDuration ms · u16 invuln ms · u8 hitFlash·255 · u8 eventSlow·100
//            · u8 nDebuffs × {u8 debuff:4|rootSource+1:4 · u8 stacks · u16 remaining ms · u16 duration ms}
//            · full: f32 focus · f32 maxFocus · u8 nSlots × {u8 skill+1 · u8 usable · u16 cd ms · u16 cdTotal ms
//              · u8 charges · u8 maxCharges · f32 focusCost} · u8 nFlasks × {u8 flask+1 · [u8 count · u8 resource
//              · u16 active ms · u16 duration ms]} }
//   monsters u16 n · n × 13 B { u32 slot:12|gen:8|kind:6|rarity:3|east:1|spare:2 · i16 x · i16 y
//            · u8 anim:3|hasExtras|hitFlash:4 · u16 animTime ticks · u8 life/maxLife·255 · u8 radius·4
//            · [hasExtras: u16 ailments · u16 mods] · [rarity ≥ rare: f32 maxLife · f32 life] }
//   projs    u16 n · n × 14 B { u32 slot:12|gen:8|kind:6|hostile|lobbed|wideAge|spare:3 · i16 x · i16 y · i16 vx·8
//            · i16 vy·8 · u8 radius·4 · (wideAge ? u16 : u8) age ticks · [u8 life ticks] }
//   motes    u16 n · n × 7 B { u16 slot · u8 size · i16 x · i16 y }
//   areas    u16 n · n × 19 B { u32 id · u8 kind · i16 x · i16 y · u16 radius·8 · f32 age · f32 duration }   (every
//            telegraph / moving hazard in the AOI first, then the nearest persistent ground up to its own cap —
//            protocol.ts AREA_TIER — written in the sim's order)
//   drops    u8 n · n × { u32 id · u32 token · u8 owner (0 = public) · u8 tone:3|sprite:2|blocked|autoPickup
//            · str label · str iconId · i16 x · i16 y · u16 z·16 · f32 age }   (the viewer's own drops first, then
//            at most MAX_WIRE_PUBLIC_DROPS public ones; each pass keeps the nearest when over its cap; `blocked` is
//            only ever set on the viewer's own)
//   props    u8 n · n × { u32 id · u8 kind · f32 x · f32 y · f32 radius · u16 state · u8 variant · u8 interactive }
//
// Enum fields are indices into the append-only tables of protocol.ts (MONSTER_KINDS, PROJECTILE_KINDS, AREA_KINDS,
// PLAYER_DEBUFFS, …); the decoder rejects any index past the end of its table.
import type { SkillId, Theme } from '../contracts/content';
import { BELT_SLOTS, LOADOUT_SLOTS } from '../contracts/items';
import type {
  AreaView, DropView, FlaskSlotView, PlayerDebuffView, PlayerView, PropView, RunView, SlotView,
} from '../contracts/sim';
import { ByteReader, SnapshotDecodeError, StringInterner } from './bytes';
import { readMapEvents } from './map-event-codec';
import {
  AIM_SCALE, ANIM_TIME_SCALE, AREA_KINDS, AREA_RADIUS_SCALE, DEBUFF_CODES, DIR4_CODES, DROP_AUTO_PICKUP_BIT,
  DROP_BLOCKED_BIT, DROP_SPRITE_CODES, DROP_TONE_CODES, FLASK_IDS, MAX_WIRE_SLOT, MONSTER_KINDS, PLAYER_ANIM_CODES,
  POS_SCALE, PROJ_VEL_SCALE, PROJECTILE_KINDS, PROP_KIND_CODES, RADIUS_SCALE, ROOT_SOURCE_CODES, RUN_PHASE_CODES,
  SKILL_IDS, SNAPSHOT_VERSION, THEMES, WIRE_KIND_BITS, WIRE_SLOT_BITS,
} from './protocol';

const KIND_MASK = (1 << WIRE_KIND_BITS) - 1;
const GEN_SHIFT = WIRE_SLOT_BITS;
const KIND_SHIFT = WIRE_SLOT_BITS + 8;
const FLAG_SHIFT = KIND_SHIFT + WIRE_KIND_BITS;

// ---------------------------------------------------------------------------
// Pooled record stores
// ---------------------------------------------------------------------------

export class MonsterRecords {
  n = 0;
  cap = 0;
  id = new Uint32Array(0);
  kind = new Uint8Array(0);
  rarity = new Uint8Array(0);
  x = new Float32Array(0);
  y = new Float32Array(0);
  radius = new Float32Array(0);
  facing = new Int8Array(0);
  anim = new Uint8Array(0);
  animTime = new Float32Array(0);
  life = new Float32Array(0);
  maxLife = new Float32Array(0);
  hitFlash = new Float32Array(0);
  ailments = new Uint16Array(0);
  mods = new Uint16Array(0);

  constructor(cap = 128) {
    this.reserve(cap);
  }

  /** Make room for n records. Contents are NOT preserved (callers reserve before filling). */
  reserve(n: number): void {
    if (n <= this.cap) return;
    const cap = Math.max(n, this.cap * 2, 16);
    this.cap = cap;
    this.id = new Uint32Array(cap);
    this.kind = new Uint8Array(cap);
    this.rarity = new Uint8Array(cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.radius = new Float32Array(cap);
    this.facing = new Int8Array(cap);
    this.anim = new Uint8Array(cap);
    this.animTime = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.hitFlash = new Float32Array(cap);
    this.ailments = new Uint16Array(cap);
    this.mods = new Uint16Array(cap);
  }
}

export class ProjectileRecords {
  n = 0;
  cap = 0;
  id = new Uint32Array(0);
  kind = new Uint8Array(0);
  hostile = new Uint8Array(0);
  x = new Float32Array(0);
  y = new Float32Array(0);
  vx = new Float32Array(0);
  vy = new Float32Array(0);
  radius = new Float32Array(0);
  age = new Float32Array(0);
  life = new Float32Array(0);

  constructor(cap = 128) {
    this.reserve(cap);
  }

  reserve(n: number): void {
    if (n <= this.cap) return;
    const cap = Math.max(n, this.cap * 2, 16);
    this.cap = cap;
    this.id = new Uint32Array(cap);
    this.kind = new Uint8Array(cap);
    this.hostile = new Uint8Array(cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.radius = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
  }
}

export class MoteRecords {
  n = 0;
  cap = 0;
  /** Server store slot (motes have no generation id in the WorldView). */
  slot = new Uint16Array(0);
  size = new Uint8Array(0);
  x = new Float32Array(0);
  y = new Float32Array(0);

  constructor(cap = 64) {
    this.reserve(cap);
  }

  reserve(n: number): void {
    if (n <= this.cap) return;
    const cap = Math.max(n, this.cap * 2, 16);
    this.cap = cap;
    this.slot = new Uint16Array(cap);
    this.size = new Uint8Array(cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
  }
}

/** A replicated player. `full` = the receiving player's own record (focus, slots and flasks are valid). */
export interface PlayerRecord extends PlayerView {
  full: boolean;
  /** Every debuff object this record ever decoded into (`debuffs` holds the first n of them). */
  readonly debuffPool: PlayerDebuffView[];
}

export function createDebuffView(): PlayerDebuffView {
  return { id: 'chilled', remaining: 0, duration: 0, stacks: 1, source: null };
}

export function createPlayerView(id = 0): PlayerView {
  const slots: SlotView[] = [];
  for (let k = 0; k < LOADOUT_SLOTS; k++) {
    slots.push({ skillId: null, cooldown: 0, cooldownTotal: 0, charges: 0, maxCharges: 0, focusCost: 0, usable: false });
  }
  const flasks: (FlaskSlotView | null)[] = [];
  for (let k = 0; k < BELT_SLOTS; k++) flasks.push(null);
  return {
    id, name: '', level: 1,
    x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, facing: 'south', aimX: 0, aimY: 0, anim: 'idle', animTime: 0,
    castSkill: null, castProgress: 0, life: 0, maxLife: 0, focus: 0, maxFocus: 0, wardTime: 0, wardDuration: 0,
    invulnTime: 0, hitFlash: 0, dead: false, eventSlow: 0, debuffs: [], slots, flasks,
  };
}

function createPlayerRecord(): PlayerRecord {
  const debuffPool: PlayerDebuffView[] = [];
  return Object.assign(createPlayerView(), { full: false, debuffPool });
}

function createAreaView(): AreaView {
  return { id: 0, kind: 'slamWarning', x: 0, y: 0, radius: 0, age: 0, duration: 0 };
}

export function createDropView(): DropView {
  return {
    id: 0,
    spec: { token: 0, owner: 0, autoPickup: false, label: '', tone: 'normal', sprite: 'equipment', iconId: '' },
    x: 0, y: 0, prevX: 0, prevY: 0, z: 0, age: 0, blocked: false,
  };
}

export function createPropView(): PropView {
  return { id: 0, kind: 'pillar', x: 0, y: 0, radius: 0, state: 0, variant: 0, interactive: false };
}

export function createRunView(): RunView {
  return {
    phase: 'hideout', wave: 0, waveCount: 0, waveTime: 0, waveDuration: 0, elapsed: 0, kills: 0, monstersAlive: 0,
    boss: null, boss2: null, lieutenant: null, portalOpen: false, playersAlive: 0, events: [],
  };
}

/** Grow-only object pool backed by an array; `items[0..count)` are the live entries. */
class Pool<T> {
  readonly items: T[] = [];
  count = 0;
  constructor(private readonly make: () => T) {}
  next(): T {
    if (this.count === this.items.length) this.items.push(this.make());
    return this.items[this.count++];
  }
}

/** One decoded world snapshot (for one receiving player). Reused: decode() overwrites everything. */
export class Snapshot {
  version = SNAPSHOT_VERSION;
  tick = 0;
  ackSeq = 0;
  viewerId = 0;
  theme: Theme = 'hideout';
  arenaRadius = 0;
  originX = 0;
  originY = 0;
  /** Client ms at arrival (set by the ClientWorld). */
  receivedAt = 0;
  /** Unique per decode inside one ClientWorld (pooled objects are reused; caches key on this). */
  serial = 0;

  readonly run: RunView = createRunView();
  private readonly bossSlot = { name: '', life: 0, maxLife: 0, phase: 1 };
  private readonly boss2Slot = { name: '', life: 0, maxLife: 0, phase: 1 };
  private readonly lieutenantSlot = { name: '', life: 0, maxLife: 0 };

  readonly playerPool = new Pool<PlayerRecord>(createPlayerRecord);
  readonly monsters = new MonsterRecords();
  readonly projectiles = new ProjectileRecords();
  readonly motes = new MoteRecords();
  readonly areaPool = new Pool<AreaView>(createAreaView);
  readonly dropPool = new Pool<DropView>(createDropView);
  readonly propPool = new Pool<PropView>(createPropView);

  get players(): readonly PlayerRecord[] {
    return this.playerPool.items;
  }
  get playerCount(): number {
    return this.playerPool.count;
  }
  get areas(): readonly AreaView[] {
    return this.areaPool.items;
  }
  get areaCount(): number {
    return this.areaPool.count;
  }
  get drops(): readonly DropView[] {
    return this.dropPool.items;
  }
  get dropCount(): number {
    return this.dropPool.count;
  }
  get props(): readonly PropView[] {
    return this.propPool.items;
  }
  get propCount(): number {
    return this.propPool.count;
  }

  /** The record of player `id` in this snapshot, or null. */
  player(id: number): PlayerRecord | null {
    const list = this.playerPool.items;
    for (let k = 0; k < this.playerPool.count; k++) if (list[k].id === id) return list[k];
    return null;
  }

  /** The receiving player's own record, or null (not in the instance yet). */
  viewer(): PlayerRecord | null {
    return this.player(this.viewerId);
  }

  /** Decode a binary snapshot into this object. Throws SnapshotDecodeError on malformed input. */
  decode(data: ArrayBuffer | ArrayBufferView, reader: ByteReader, interner: StringInterner): void {
    reader.reset(data);
    const version = reader.u8();
    if (version !== SNAPSHOT_VERSION) throw new SnapshotDecodeError(`snapshot version ${version} != ${SNAPSHOT_VERSION}`);
    this.version = version;
    this.tick = reader.u32();
    this.ackSeq = reader.u32();
    this.viewerId = reader.u8();
    this.theme = enumAt(THEMES, reader.u8(), 'theme');
    this.arenaRadius = reader.f32();
    const ox = reader.f32();
    const oy = reader.f32();
    this.originX = ox;
    this.originY = oy;
    this.decodeRun(reader, interner);
    this.decodePlayers(reader, interner);
    this.decodeMonsters(reader, ox, oy);
    this.decodeProjectiles(reader, ox, oy);
    this.decodeMotes(reader, ox, oy);
    this.decodeAreas(reader, ox, oy);
    this.decodeDrops(reader, interner, ox, oy);
    this.decodeProps(reader);
    if (reader.remaining !== 0) throw new SnapshotDecodeError(`${reader.remaining} trailing bytes`);
  }

  private decodeRun(r: ByteReader, interner: StringInterner): void {
    const run = this.run;
    run.phase = enumAt(RUN_PHASE_CODES, r.u8(), 'phase');
    run.wave = r.u8();
    run.waveCount = r.u8();
    run.waveTime = r.f32();
    run.waveDuration = r.f32();
    run.elapsed = r.f32();
    run.kills = r.u32();
    run.monstersAlive = r.u16();
    run.playersAlive = r.u8();
    const flags = r.u8();
    run.portalOpen = (flags & 4) !== 0;
    if (flags & 1) {
      const b = this.bossSlot;
      b.name = r.str(interner);
      b.life = r.f32();
      b.maxLife = r.f32();
      b.phase = r.u8();
      run.boss = b;
    } else run.boss = null;
    if (flags & 16) {
      const b = this.boss2Slot;
      b.name = r.str(interner);
      b.life = r.f32();
      b.maxLife = r.f32();
      b.phase = r.u8();
      run.boss2 = b;
    } else run.boss2 = null;
    if (flags & 2) {
      const l = this.lieutenantSlot;
      l.name = r.str(interner);
      l.life = r.f32();
      l.maxLife = r.f32();
      run.lieutenant = l;
    } else run.lieutenant = null;
    if (flags & 8) readMapEvents(r, run.events, enumAt);
    else run.events.length = 0;
  }

  private decodePlayers(r: ByteReader, interner: StringInterner): void {
    const pool = this.playerPool;
    pool.count = 0;
    const n = r.u8();
    for (let k = 0; k < n; k++) {
      const p = pool.next();
      p.id = r.u8();
      const bits = r.u8();
      p.facing = DIR4_CODES[bits & 3];
      p.anim = enumAt(PLAYER_ANIM_CODES, (bits >> 2) & 7, 'player anim');
      p.dead = (bits & 32) !== 0;
      p.full = (bits & 64) !== 0;
      const casting = (bits & 128) !== 0;
      p.level = r.u8();
      p.name = r.str(interner);
      p.x = p.prevX = r.f32();
      p.y = p.prevY = r.f32();
      p.vx = r.f32();
      p.vy = r.f32();
      p.aimX = p.x + r.i16() / AIM_SCALE;
      p.aimY = p.y + r.i16() / AIM_SCALE;
      p.animTime = r.f32();
      if (casting) {
        p.castSkill = enumAt(SKILL_IDS, r.u8(), 'cast skill');
        p.castProgress = r.u16() / 65535;
      } else {
        p.castSkill = null;
        p.castProgress = 0;
      }
      p.life = r.f32();
      p.maxLife = r.f32();
      p.wardTime = r.u16() / 1000;
      p.wardDuration = r.u16() / 1000;
      p.invulnTime = r.u16() / 1000;
      p.hitFlash = r.u8() / 255;
      p.eventSlow = r.u8() / 100;
      decodeDebuffs(r, p);
      if (p.full) {
        p.focus = r.f32();
        p.maxFocus = r.f32();
        const nSlots = r.u8();
        for (let s = 0; s < nSlots; s++) {
          const code = r.u8();
          const usable = r.u8();
          const cooldown = r.u16() / 1000;
          const cooldownTotal = r.u16() / 1000;
          const charges = r.u8();
          const maxCharges = r.u8();
          const focusCost = r.f32();
          if (s >= p.slots.length) continue; // more slots than this client knows: ignore the extras
          const sv = p.slots[s];
          sv.skillId = code === 0 ? null : (enumAt(SKILL_IDS, code - 1, 'slot skill') as SkillId);
          sv.usable = (usable & 1) !== 0;
          sv.cooldown = cooldown;
          sv.cooldownTotal = cooldownTotal;
          sv.charges = charges;
          sv.maxCharges = maxCharges;
          sv.focusCost = focusCost;
        }
        for (let s = nSlots; s < p.slots.length; s++) clearSlot(p.slots[s]);
        const nFlasks = r.u8();
        for (let f = 0; f < nFlasks; f++) {
          const code = r.u8();
          if (code === 0) {
            if (f < p.flasks.length) p.flasks[f] = null;
            continue;
          }
          const flaskId = enumAt(FLASK_IDS, code - 1, 'flask');
          const count = r.u8();
          const resource = r.u8() === 1 ? 'focus' : 'life';
          const active = r.u16() / 1000;
          const duration = r.u16() / 1000;
          if (f >= p.flasks.length) continue;
          let fv = p.flasks[f];
          if (!fv) {
            fv = { flaskId, count, resource, active, duration };
            p.flasks[f] = fv;
          } else {
            fv.flaskId = flaskId;
            fv.count = count;
            fv.resource = resource;
            fv.active = active;
            fv.duration = duration;
          }
        }
        for (let f = nFlasks; f < p.flasks.length; f++) p.flasks[f] = null;
      } else {
        p.focus = 0;
        p.maxFocus = 0;
        for (const sv of p.slots) clearSlot(sv);
        for (let f = 0; f < p.flasks.length; f++) p.flasks[f] = null;
      }
    }
  }

  private decodeMonsters(r: ByteReader, ox: number, oy: number): void {
    const n = r.u16();
    const m = this.monsters;
    m.reserve(n);
    m.n = n;
    const kinds = MONSTER_KINDS.length;
    for (let i = 0; i < n; i++) {
      const head = r.u32();
      const slot = head & MAX_WIRE_SLOT;
      const gen = (head >>> GEN_SHIFT) & 0xff;
      m.id[i] = ((gen << 16) | slot) >>> 0;
      const kind = (head >>> KIND_SHIFT) & KIND_MASK;
      if (kind >= kinds) throw new SnapshotDecodeError(`monster kind ${kind}`);
      m.kind[i] = kind;
      const rarity = (head >>> FLAG_SHIFT) & 7;
      m.rarity[i] = rarity;
      m.facing[i] = (head >>> (FLAG_SHIFT + 3)) & 1 ? 1 : -1;
      // Rares, lieutenants and bosses carry their exact life (RARITY_CODE.rare = 2).
      const hasMax = rarity >= 2;
      m.x[i] = ox + r.i16() / POS_SCALE;
      m.y[i] = oy + r.i16() / POS_SCALE;
      const a = r.u8();
      m.anim[i] = a & 7;
      const extras = (a & 8) !== 0;
      m.hitFlash[i] = (a >> 4) / 15;
      m.animTime[i] = r.u16() / ANIM_TIME_SCALE;
      const lifeQ = r.u8();
      m.radius[i] = r.u8() / RADIUS_SCALE;
      if (extras) {
        m.ailments[i] = r.u16();
        m.mods[i] = r.u16();
      } else {
        m.ailments[i] = 0;
        m.mods[i] = 0;
      }
      if (hasMax) {
        m.maxLife[i] = r.f32();
        m.life[i] = r.f32();
      } else {
        m.maxLife[i] = 1;
        m.life[i] = lifeQ / 255;
      }
    }
  }

  private decodeProjectiles(r: ByteReader, ox: number, oy: number): void {
    const n = r.u16();
    const p = this.projectiles;
    p.reserve(n);
    p.n = n;
    const kinds = PROJECTILE_KINDS.length;
    for (let i = 0; i < n; i++) {
      const head = r.u32();
      const slot = head & MAX_WIRE_SLOT;
      const gen = (head >>> GEN_SHIFT) & 0xff;
      p.id[i] = ((gen << 16) | slot) >>> 0;
      const kind = (head >>> KIND_SHIFT) & KIND_MASK;
      if (kind >= kinds) throw new SnapshotDecodeError(`projectile kind ${kind}`);
      p.kind[i] = kind;
      const flags = head >>> FLAG_SHIFT;
      p.hostile[i] = flags & 1;
      const lobbed = (flags & 2) !== 0;
      const wideAge = (flags & 4) !== 0;
      p.x[i] = ox + r.i16() / POS_SCALE;
      p.y[i] = oy + r.i16() / POS_SCALE;
      p.vx[i] = r.i16() / PROJ_VEL_SCALE;
      p.vy[i] = r.i16() / PROJ_VEL_SCALE;
      p.radius[i] = r.u8() / RADIUS_SCALE;
      p.age[i] = (wideAge ? r.u16() : r.u8()) / ANIM_TIME_SCALE;
      p.life[i] = lobbed ? r.u8() / ANIM_TIME_SCALE : 0;
    }
  }

  private decodeMotes(r: ByteReader, ox: number, oy: number): void {
    const n = r.u16();
    const m = this.motes;
    m.reserve(n);
    m.n = n;
    for (let i = 0; i < n; i++) {
      m.slot[i] = r.u16();
      const size = r.u8();
      m.size[i] = size > 2 ? 2 : size;
      m.x[i] = ox + r.i16() / POS_SCALE;
      m.y[i] = oy + r.i16() / POS_SCALE;
    }
  }

  private decodeAreas(r: ByteReader, ox: number, oy: number): void {
    const pool = this.areaPool;
    pool.count = 0;
    const n = r.u16();
    for (let k = 0; k < n; k++) {
      const a = pool.next();
      a.id = r.u32();
      a.kind = enumAt(AREA_KINDS, r.u8(), 'area kind');
      a.x = ox + r.i16() / POS_SCALE;
      a.y = oy + r.i16() / POS_SCALE;
      a.radius = r.u16() / AREA_RADIUS_SCALE;
      a.age = r.f32();
      a.duration = r.f32();
    }
  }

  private decodeDrops(r: ByteReader, interner: StringInterner, ox: number, oy: number): void {
    const pool = this.dropPool;
    pool.count = 0;
    const n = r.u8();
    for (let k = 0; k < n; k++) {
      const d = pool.next();
      d.id = r.u32();
      const spec = d.spec;
      spec.token = r.u32();
      spec.owner = r.u8();
      const b = r.u8();
      spec.tone = enumAt(DROP_TONE_CODES, b & 7, 'drop tone');
      spec.sprite = enumAt(DROP_SPRITE_CODES, (b >> 3) & 3, 'drop sprite');
      d.blocked = (b & DROP_BLOCKED_BIT) !== 0;
      spec.autoPickup = (b & DROP_AUTO_PICKUP_BIT) !== 0;
      spec.label = r.str(interner);
      spec.iconId = r.str(interner);
      d.x = d.prevX = ox + r.i16() / POS_SCALE;
      d.y = d.prevY = oy + r.i16() / POS_SCALE;
      d.z = r.u16() / POS_SCALE;
      d.age = r.f32();
    }
  }

  private decodeProps(r: ByteReader): void {
    const pool = this.propPool;
    pool.count = 0;
    const n = r.u8();
    for (let k = 0; k < n; k++) {
      const p = pool.next();
      p.id = r.u32();
      p.kind = enumAt(PROP_KIND_CODES, r.u8(), 'prop kind');
      p.x = r.f32();
      p.y = r.f32();
      p.radius = r.f32();
      p.state = r.u16();
      p.variant = r.u8();
      p.interactive = r.u8() !== 0;
    }
  }
}

/** u8 n × {u8 debuff:4|source+1:4 · u8 stacks · u16 remaining ms · u16 duration ms} into p.debuffs (pooled). */
function decodeDebuffs(r: ByteReader, p: PlayerRecord): void {
  const n = r.u8();
  const list = p.debuffs;
  const pool = p.debuffPool;
  for (let k = 0; k < n; k++) {
    const b = r.u8();
    const id = enumAt(DEBUFF_CODES, b & 15, 'debuff');
    const src = b >> 4;
    const source = src === 0 ? null : enumAt(ROOT_SOURCE_CODES, src - 1, 'root source');
    let d = pool[k];
    if (!d) {
      d = createDebuffView();
      pool.push(d);
    }
    d.id = id;
    d.source = source;
    d.stacks = r.u8();
    d.remaining = r.u16() / 1000;
    d.duration = r.u16() / 1000;
    list[k] = d;
  }
  list.length = n;
}

function clearSlot(sv: SlotView): void {
  sv.skillId = null;
  sv.cooldown = 0;
  sv.cooldownTotal = 0;
  sv.charges = 0;
  sv.maxCharges = 0;
  sv.focusCost = 0;
  sv.usable = false;
}

function enumAt<T>(table: readonly T[], code: number, what: string): T {
  if (code >= table.length) throw new SnapshotDecodeError(`bad ${what} code ${code}`);
  return table[code];
}

const sharedReader = new ByteReader();
const sharedInterner = new StringInterner(256);

/** Decode a snapshot into a fresh object (tests / debugging; the ClientWorld decodes into pooled snapshots). */
export function decodeSnapshot(data: ArrayBuffer | ArrayBufferView): Snapshot {
  const s = new Snapshot();
  s.decode(data, sharedReader, sharedInterner);
  return s;
}
