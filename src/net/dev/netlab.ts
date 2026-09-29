// Net Lab — a sandbox for the online replication layer.
//
// A real sim instance runs in this page as the "server". Inputs and snapshots cross a simulated TCP link (one-way
// latency, jitter, and occasional retransmit stalls — ordered and never lost, like a WebSocket). A ClientWorld
// interpolates and predicts exactly as the game client does.
//   Left: server truth.  Right: what the client draws (ring = newest authoritative position of the local player,
//   cross = raw prediction).  Bottom: traces of the local player (server / predicted / on screen) and of one
//   tracked monster (server / interpolated), so delay and smoothness are visible at a glance.
//
// Loot: currency is auto-collected by walking over it; equipment (and anything thrown on the floor) waits for a click.
// Every few seconds the ally tosses an item onto the floor next to you — a PUBLIC drop (owner 0, dashed ring) both
// players see; it expires after 30 s. P = click-pick-up the nearest drop in reach (sent over the same link; the
// result comes back over the link too). F = your backpack is full: pickups fail with 'full' (own loot shows
// `blocked`) and the drop stays clickable, like in the game after an unsuccessful pickup.
//
// Controls: WASD move · mouse aim · LMB Ember Lance · Space Ember Nova · P pick up · F backpack full on/off ·
//           1/2/3 one-way latency 10/40/90 ms · J jitter on/off · L stalls on/off.  Until a movement key is pressed,
//           an autopilot walks a figure eight.
// URL: ?lat=40&jit=25&stall=0.02&hints=1&full=0   (hints=0: the client learns speed and cast times from snapshots
//      alone; full=1 starts with a full backpack)
import type { InputMessage } from '../../contracts/net';
import { SNAPSHOT_EVERY } from '../../contracts/net';
import type {
  DropSpec, PickupResult, PlayerCombatStats, PlayerIntent, PlayerRuntime, PlayerView, RunConfig, SimEvent,
  SkillRuntimeDef, WorldView,
} from '../../contracts/sim';
import { PICKUP_REACH, RARITY_CODE, SIM_DT } from '../../contracts/sim';
import { createRun } from '../../sim';
import { createClientWorld, createEventTimeline, createInputQueue, createSnapshotEncoder, decodeSnapshot, heldToMask } from '..';

type RGB = string;

const params = new URLSearchParams(location.search);
const net = {
  latency: Number(params.get('lat') ?? 40),
  jitter: Number(params.get('jit') ?? 25),
  stall: Number(params.get('stall') ?? 0.02),
};
const useHints = params.get('hints') !== '0';
/** Simulated full backpack of the local player (player 1): the sim's tryPickup hook refuses her pickups. */
let backpackFull = params.get('full') === '1';
const TICK_MS = 1000 / 60;
const VIEW_UNITS = 560; // world units across one panel

// ---------------------------------------------------------------------------
// Simulated link: ordered delivery with head-of-line blocking (TCP semantics)
// ---------------------------------------------------------------------------

class Link<T> {
  private readonly queue: { at: number; msg: T }[] = [];
  private last = 0;

  send(now: number, msg: T): void {
    let at = now + net.latency + Math.random() * net.jitter;
    // A lost segment is retransmitted after roughly an RTO; everything behind it waits.
    if (Math.random() < net.stall) at += 2 * net.latency + 120;
    at = Math.max(at, this.last);
    this.last = at;
    this.queue.push({ at, msg });
  }

  receive(now: number, deliver: (msg: T) => void): void {
    while (this.queue.length && this.queue[0].at <= now) deliver(this.queue.shift()!.msg);
  }
}

// ---------------------------------------------------------------------------
// Server: a map instance with two players (you + a wandering ally)
// ---------------------------------------------------------------------------

function stats(): PlayerCombatStats {
  return {
    maxLife: 4000, lifeRegen: 400, maxFocus: 300, focusRegen: 60, armor: 400, evasion: 0.4,
    resist: { physical: 0, fire: 0.6, cold: 0.6, lightning: 0.6, void: 0.4 }, damageTaken: 1, moveSpeed: 125,
    pickupRadius: 50, lifeOnKill: 0, focusOnKill: 0, flaskEffect: 1, flags: [],
  };
}

function skill(id: SkillRuntimeDef['id'], over: Partial<SkillRuntimeDef>): SkillRuntimeDef {
  return {
    id, rank: 5, focusCost: 0, castTime: 0.34, cooldown: 0, charges: 1, damage: 55, damageType: 'fire', critChance: 0.08,
    critMultiplier: 1.5, ailmentChance: 0.15, projectiles: 1, pierce: 1, projectileSpeed: 420, range: 320, spread: 0,
    radius: 0, duration: 0, chains: 0, distance: 0, damageReduction: 0, flags: [], ...over,
  };
}

function runtime(): PlayerRuntime {
  return {
    stats: stats(),
    skills: [
      skill('emberLance', {}),
      skill('emberNova', { focusCost: 10, castTime: 0.45, cooldown: 1.2, projectiles: 18, projectileSpeed: 260, range: 170, damage: 40 }),
    ],
    loadout: ['emberLance', 'emberNova', null, null, null, null],
    flasks: [null, null, null, null],
  };
}

let dropToken = 1;
const config: RunConfig = {
  mode: 'map', seed: 0x5eed, theme: 'ashenForge', mapName: 'Ashen Forge', tier: 3, arenaRadius: 900,
  monsters: {
    level: 20, lifeMultiplier: 1, damageMultiplier: 0.1, speedMultiplier: 1, countMultiplier: 1.6, magicPackChance: 0.25,
    rarePackChance: 0.1, resistBonus: 0, xpMultiplier: 1, extraProjectiles: 0, hazards: true,
  },
  waves: { count: 6, baseMonsters: 40, monstersPerWave: 18, waveDuration: 40, tellDuration: 2, lieutenantWave: 3, bossWave: 6 },
  hooks: {
    rollKillLoot(ctx, playerIds, rng) {
      const out: DropSpec[] = [];
      for (const owner of playerIds) {
        const roll = rng.next();
        if (roll < 0.08) out.push({ token: dropToken++, owner, autoPickup: true, label: 'Forge Scrap', tone: 'currency', sprite: 'currency', iconId: 'icon/currency/scrap' });
        else if (roll < 0.1 || ctx.rarity !== 'normal') out.push({ token: dropToken++, owner, autoPickup: false, label: 'Ember Bite', tone: 'rare', sprite: 'equipment', iconId: 'icon/base/ashwoodWand' });
      }
      return out;
    },
    rollChestLoot: (playerIds) => playerIds.map((owner): DropSpec => ({ token: dropToken++, owner, autoPickup: true, label: 'Ashen Forge (T4)', tone: 'map', sprite: 'map', iconId: 'icon/map/ashenForge' })),
    tryPickup: (playerId) => !(backpackFull && playerId === 1),
  },
};

const run = createRun(config);
run.addPlayer({ id: 1, name: 'You', level: 20, runtime: runtime() });
run.addPlayer({ id: 2, name: 'Brann', level: 18, runtime: runtime() });
const encoder = createSnapshotEncoder();
const toServer = new Link<InputMessage>();
/** Click-to-pick-up commands travel the same (simulated) link as inputs; the command result comes back like one. */
const toServerPickup = new Link<number>();
const toClientPickupResult = new Link<{ dropId: number; result: PickupResult }>();
/**
 * Drops with a request in flight (a real client doesn't resend meanwhile). An id leaves the set when its result
 * arrives unsuccessful ('tooFar', 'full', … → clickable again) or when the drop leaves the client's view.
 */
const pickupRequested = new Set<number>();
const pickupLog: string[] = [];
function logPickup(line: string): void {
  if (pickupLog[0] === line) return;
  pickupLog.unshift(line);
  pickupLog.length = Math.min(pickupLog.length, 2);
}
/** Public drops the ally threw on the floor → server tick at which they expire. */
const publicExpiry = new Map<number, number>();
const THROW_EVERY_TICKS = 60 * 5;
const THROW_FIRST_TICK = 90;
const PUBLIC_DROP_TICKS = 60 * 30;
const THROWN: readonly Pick<DropSpec, 'label' | 'tone' | 'iconId'>[] = [
  { label: 'Storm Loop', tone: 'magic', iconId: 'icon/base/stormLoop' },
  { label: 'Grave Coil', tone: 'rare', iconId: 'icon/base/cinderPendant' },
  { label: 'Silk Wraps', tone: 'normal', iconId: 'icon/base/silkWraps' },
];
const toClient = new Link<{ buf: ArrayBuffer; tick: number; events: SimEvent[] }>();
// The game server's input policy: one input per tick, bursts coalesced, movement stops when starved.
const inputs = createInputQueue();
const intent1: PlayerIntent = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, held: [], flask: -1 };
let pendingEvents: SimEvent[] = [];
let bytesWindow = 0;
let snapshotsWindow = 0;
let kbps = 0;
let avgBytes = 0;

function serverTick(now: number): void {
  toServer.receive(now, (m) => inputs.push(m));
  toServerPickup.receive(now, (dropId) => {
    toClientPickupResult.send(now, { dropId, result: run.requestPickup(1, dropId) });
  });
  // The ally tosses something onto the floor now and then (the game's 'dropItem' command → a public drop), next to
  // the local player so it shows up in both panels.
  const you = run.view.players.find((p) => p.id === 1);
  if (you && run.view.tick % THROW_EVERY_TICKS === THROW_FIRST_TICK) {
    const t = THROWN[Math.floor(run.view.tick / THROW_EVERY_TICKS) % THROWN.length];
    const id = run.spawnDrop({ ...t, token: dropToken++, owner: 0, autoPickup: false, sprite: 'equipment' }, you.x + 36, you.y + 12);
    publicExpiry.set(id, run.view.tick + PUBLIC_DROP_TICKS);
  }
  for (const [id, until] of publicExpiry) {
    if (!run.view.drops.some((d) => d.id === id)) publicExpiry.delete(id); // picked up
    else if (run.view.tick >= until) {
      run.removeDrop(id);
      publicExpiry.delete(id);
    }
  }
  run.setIntent(1, inputs.next(intent1));
  const t = run.view.tick * SIM_DT;
  const ally = run.view.players.find((p) => p.id === 2);
  const heading = t * 0.6;
  run.setIntent(2, {
    moveX: Math.cos(heading), moveY: Math.sin(heading) * 0.8,
    aimX: (ally?.x ?? 0) + Math.cos(heading) * 80, aimY: (ally?.y ?? 0) + Math.sin(heading) * 80,
    held: [true, t % 4 < 0.5, false, false, false, false], flask: -1,
  });
  run.step();
  for (const e of run.drainEvents()) pendingEvents.push(e);
  run.drainOutcomes();
  if (run.view.tick % SNAPSHOT_EVERY === 0) {
    const buf = encoder.encode(run.view, 1, inputs.ackSeq);
    bytesWindow += buf.byteLength;
    snapshotsWindow++;
    toClient.send(now, { buf, tick: run.view.tick, events: pendingEvents });
    pendingEvents = [];
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const client = createClientWorld();
client.setZone({
  instanceId: 'lab', kind: 'map', ownerCharacterId: 'c1', ownerName: 'You', theme: run.view.theme,
  arenaRadius: run.view.arenaRadius, mapName: 'Ashen Forge', tier: 3, localPlayerId: 1,
  props: run.view.props.map((p) => ({ ...p })), setup: null, portal: null,
});
if (useHints) client.setPredictionHints({ moveSpeed: stats().moveSpeed, castTimes: { emberLance: 0.34, emberNova: 0.45 } });
const timeline = createEventTimeline();
timeline.setLocalPlayer(1);
let eventsShown = 0;
const authPos = { x: 0, y: 0, have: false };

const keys = new Set<string>();
let autopilot = true;
const mouse = { x: -1, y: -1, lmb: false };
let seq = 0;

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys.add(k === ' ' ? 'space' : k);
  if ('wasd'.includes(k)) autopilot = false;
  if (k === '1') net.latency = 10;
  if (k === '2') net.latency = 40;
  if (k === '3') net.latency = 90;
  if (k === 'j') net.jitter = net.jitter > 0 ? 0 : 25;
  if (k === 'l') net.stall = net.stall > 0 ? 0 : 0.02;
  if (k === 'p') requestPickupNearest();
  if (k === 'f') backpackFull = !backpackFull;
  if (k === ' ') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.key === ' ' ? 'space' : e.key.toLowerCase()));
addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
addEventListener('mousedown', (e) => {
  if (e.button === 0) mouse.lmb = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.lmb = false;
});

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let W = 0;
let H = 0;
function resize(): void {
  const dpr = devicePixelRatio || 1;
  W = innerWidth;
  H = innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

interface Panel {
  x: number;
  y: number;
  w: number;
  h: number;
}

function layout(): { server: Panel; client: Panel; plotA: Panel; plotB: Panel; stats: Panel } {
  const pad = 10;
  // The bottom row needs ~280 px for the stats rows; on short windows the world panels give up the difference.
  const topH = Math.min(Math.floor(H * 0.64), H - Math.min(280, Math.floor(H * 0.45)));
  const half = Math.floor((W - pad * 3) / 2);
  const server = { x: pad, y: pad, w: half, h: topH - pad };
  const client = { x: pad * 2 + half, y: pad, w: half, h: topH - pad };
  const bottomY = topH + pad;
  const bottomH = H - bottomY - pad;
  // The stats panel gets the widest column: its status lines are long, the traces read fine narrower.
  const inner = W - pad * 4;
  const statsW = Math.floor(inner * 0.38);
  const plotW = Math.floor((inner - statsW) / 2);
  return {
    server,
    client,
    plotA: { x: pad, y: bottomY, w: plotW, h: bottomH },
    plotB: { x: pad * 2 + plotW, y: bottomY, w: plotW, h: bottomH },
    stats: { x: pad * 3 + plotW * 2, y: bottomY, w: W - pad - (pad * 3 + plotW * 2), h: bottomH },
  };
}

const KIND_COLOR: RGB[] = ['#b8862f', '#ff9a3c', '#7a3b24', '#7b3fa0', '#5a5057', '#e0b04a', '#e8662a', '#cbbfa8'];
const TONE_COLOR: Record<string, RGB> = {
  normal: '#d8d2c4', magic: '#7aa2ff', rare: '#f2d15c', unique: '#e8772e', currency: '#c9b58a', map: '#d0d0dc', flask: '#d86a6a',
};

function frameRect(p: Panel, title: string): void {
  ctx.fillStyle = '#141114';
  ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.strokeStyle = '#3b3438';
  ctx.lineWidth = 1;
  ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
  ctx.fillStyle = '#8d8375';
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(title, p.x + 8, p.y + 16);
}

function drawWorld(p: Panel, view: WorldView, alpha: number, cam: { x: number; y: number }, title: string, isClient: boolean): void {
  frameRect(p, title);
  ctx.save();
  ctx.beginPath();
  ctx.rect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
  ctx.clip();
  const s = p.w / VIEW_UNITS;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const X = (x: number) => cx + (x - cam.x) * s;
  const Y = (y: number) => cy + (y - cam.y) * s;
  const lerp = (a: number, b: number) => a + (b - a) * alpha;

  // Arena edge.
  ctx.strokeStyle = '#3b3438';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(X(0), Y(0), view.arenaRadius * s, 0, Math.PI * 2);
  ctx.stroke();

  for (const pr of view.props) {
    if (pr.radius <= 0 && pr.kind !== 'portal' && pr.kind !== 'returnPortal' && pr.kind !== 'chest') continue;
    ctx.fillStyle = pr.kind === 'chest' ? '#b8862f' : pr.kind.includes('ortal') ? '#7b3fa0' : '#2a2326';
    ctx.beginPath();
    ctx.arc(X(pr.x), Y(pr.y), Math.max(3, pr.radius) * s, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const a of view.areas) {
    const f = a.duration > 0 ? Math.min(1, a.age / a.duration) : 1;
    ctx.strokeStyle = a.kind === 'heraldAura' ? 'rgba(224,176,74,0.5)' : 'rgba(232,102,42,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(X(a.x), Y(a.y), a.radius * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(232,102,42,${0.08 + 0.22 * f})`;
    ctx.beginPath();
    ctx.arc(X(a.x), Y(a.y), a.radius * s * f, 0, Math.PI * 2);
    ctx.fill();
  }

  const mo = view.motes;
  ctx.fillStyle = '#7fc6e8';
  for (let i = 0; i < mo.capacity; i++) {
    if (!mo.alive[i]) continue;
    ctx.fillRect(X(lerp(mo.prevX[i], mo.x[i])) - 1.5, Y(lerp(mo.prevY[i], mo.y[i])) - 1.5, 3 + mo.size[i], 3 + mo.size[i]);
  }

  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  for (const d of view.drops) {
    // Server panel: show what the local player can see (her own loot + public drops).
    if (!isClient && d.spec.owner !== 1 && d.spec.owner !== 0) continue;
    const x = X(lerp(d.prevX, d.x));
    const y = Y(lerp(d.prevY, d.y)) - d.z * s;
    ctx.fillStyle = TONE_COLOR[d.spec.tone] ?? '#fff';
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x + 4, y);
    ctx.lineTo(x, y + 4);
    ctx.lineTo(x - 4, y);
    ctx.fill();
    if (d.spec.owner === 0) {
      // Public "ground" drop: dashed ring, anyone may click it.
      ctx.strokeStyle = '#9d948a';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const tag = d.spec.owner === 0 ? ' (ground)' : d.spec.autoPickup ? '' : ' (click)';
    ctx.fillText(d.spec.label + tag, x, y - 10);
  }

  const m = view.monsters;
  for (let i = 0; i < m.capacity; i++) {
    if (!m.alive[i]) continue;
    const x = X(lerp(m.prevX[i], m.x[i]));
    const y = Y(lerp(m.prevY[i], m.y[i]));
    const r = Math.max(2, m.radius[i] * s);
    ctx.fillStyle = m.hitFlash[i] > 0.4 ? '#ffe7a8' : KIND_COLOR[m.kind[i]] ?? '#888';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    const rarity = m.rarity[i];
    if (rarity > 0) {
      ctx.strokeStyle = rarity === RARITY_CODE.magic ? '#7aa2ff' : rarity === RARITY_CODE.rare ? '#f2d15c' : '#e8772e';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Facing tick.
    ctx.strokeStyle = '#0d0b0e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + m.facing[i] * r, y);
    ctx.stroke();
  }

  const pj = view.projectiles;
  for (let i = 0; i < pj.capacity; i++) {
    if (!pj.alive[i]) continue;
    const x = X(lerp(pj.prevX[i], pj.x[i]));
    const y = Y(lerp(pj.prevY[i], pj.y[i]));
    const sp = Math.hypot(pj.vx[i], pj.vy[i]) || 1;
    ctx.strokeStyle = pj.hostile[i] ? '#d05050' : '#ff9a3c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - (pj.vx[i] / sp) * 10 * s, y - (pj.vy[i] / sp) * 10 * s);
    ctx.stroke();
    ctx.fillStyle = pj.hostile[i] ? '#ff7070' : '#ffe7a8';
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }

  for (const pl of view.players) drawPlayer(pl, X(lerp(pl.prevX, pl.x)), Y(lerp(pl.prevY, pl.y)), s, pl.id === 1);

  if (isClient) {
    if (authPos.have) {
      ctx.strokeStyle = 'rgba(122,162,255,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(X(authPos.x), Y(authPos.y), 7 * s, 0, Math.PI * 2);
      ctx.stroke();
    }
    const pp = client.predictedPosition();
    if (pp) {
      ctx.strokeStyle = '#efe9ff';
      ctx.beginPath();
      ctx.moveTo(X(pp.x) - 4, Y(pp.y));
      ctx.lineTo(X(pp.x) + 4, Y(pp.y));
      ctx.moveTo(X(pp.x), Y(pp.y) - 4);
      ctx.lineTo(X(pp.x), Y(pp.y) + 4);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPlayer(pl: PlayerView, x: number, y: number, s: number, local: boolean): void {
  const r = 7 * s;
  ctx.fillStyle = pl.dead ? '#5a5057' : local ? '#cbbfa8' : '#4a7bd6';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  const f = pl.facing === 'east' ? [1, 0] : pl.facing === 'west' ? [-1, 0] : pl.facing === 'north' ? [0, -1] : [0, 1];
  ctx.strokeStyle = '#e8662a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + f[0] * r * 1.6, y + f[1] * r * 1.6);
  ctx.stroke();
  ctx.fillStyle = '#e8dcc0';
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${pl.name} ${pl.anim}`, x, y - r - 6);
}

// Trace buffers (last ~2.5 s).
interface Trace {
  t: number[];
  series: number[][];
}
const localTrace: Trace = { t: [], series: [[], [], []] };
const monsterTrace: Trace = { t: [], series: [[], []] };
let trackedId = -1;

function pushTrace(tr: Trace, t: number, values: number[]): void {
  tr.t.push(t);
  values.forEach((v, i) => tr.series[i].push(v));
  while (tr.t.length && tr.t[0] < t - 2500) {
    tr.t.shift();
    for (const s of tr.series) s.shift();
  }
}

function drawTrace(p: Panel, tr: Trace, title: string, names: string[], colors: RGB[], now: number): void {
  frameRect(p, title);
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of tr.series) for (const v of s) if (Number.isFinite(v)) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo)) return;
  if (hi - lo < 20) {
    const mid = (hi + lo) / 2;
    lo = mid - 10;
    hi = mid + 10;
  }
  const top = p.y + 26;
  const h = p.h - 44;
  const X = (t: number) => p.x + 8 + ((t - (now - 2500)) / 2500) * (p.w - 16);
  const Y = (v: number) => top + h - ((v - lo) / (hi - lo)) * h;
  tr.series.forEach((s, k) => {
    ctx.strokeStyle = colors[k];
    ctx.lineWidth = k === tr.series.length - 1 ? 2 : 1.25;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < s.length; i++) {
      if (!Number.isFinite(s[i])) {
        started = false;
        continue;
      }
      if (!started) ctx.moveTo(X(tr.t[i]), Y(s[i]));
      else ctx.lineTo(X(tr.t[i]), Y(s[i]));
      started = true;
    }
    ctx.stroke();
  });
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  let lx = p.x + 8;
  names.forEach((n, k) => {
    ctx.fillStyle = colors[k];
    ctx.fillText(`■ ${n}`, lx, p.y + p.h - 8);
    lx += ctx.measureText(`■ ${n}`).width + 14;
  });
}

function drawStats(p: Panel): void {
  frameRect(p, 'Link & replication');
  const st = client.stats();
  const status = [
    `one-way latency ${net.latency} ms · jitter ${net.jitter} ms · stalls ${(net.stall * 100).toFixed(0)}%`,
    `snapshot ${(avgBytes / 1024).toFixed(2)} KB avg · ${kbps.toFixed(0)} KB/s`,
    `interp delay ${st.interpDelayMs.toFixed(0)} ms · jitter p95 ${st.jitterMs.toFixed(0)} ms · late ${st.lateMs.toFixed(0)} ms`,
    `drift ${(st.drift * 100).toFixed(2)}% · rebases ${st.rebases} · holds ${st.holds} · extrapolating ${st.extrapolating ? 'YES' : 'no'}`,
    `buffered ${st.bufferedSnapshots} · late ${st.late} · server inputs skipped ${inputs.skipped} · starved ${inputs.starved}`,
    `prediction${useHints ? ' (rules hints)' : ' (learned)'}: pending ${st.pendingInputs} · speed ${st.moveSpeed.toFixed(0)}`,
    `corrections ${st.corrections} (last ${st.lastCorrection.toFixed(2)}) · snaps ${st.snaps}`,
    `monsters shown ${client.view.monsters.count} / server ${run.view.monsters.count}`,
    `render tick ${client.renderTick.toFixed(1)} · latest ${client.latestTick} · server ${run.view.tick}`,
    `phase ${run.view.run.phase} · wave ${run.view.run.wave}/${run.view.run.waveCount} · events shown ${eventsShown}`,
    `drops shown: own ${countDrops(1)} · public ${countDrops(0)}`,
    `click pickups: ${pickupLog.length ? pickupLog.join(' · ') : '—'}${backpackFull ? ' · BACKPACK FULL' : ''}`,
  ];
  const help = [
    'WASD move · mouse aim · LMB lance · Space nova · P pick up',
    'F backpack full · 1/2/3 latency · J jitter · L stalls',
  ];
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  const maxW = p.w - 20;
  const rows: { text: string; dim: boolean }[] = [];
  for (const l of status) for (const r of wrapAtDots(l, maxW)) rows.push({ text: r, dim: false });
  for (const l of help) for (const r of wrapAtDots(l, maxW)) rows.push({ text: r, dim: true });
  // Squeeze the line height (17 → 13 px) so every row fits the panel; anything beyond that is clipped, never drawn
  // over the neighbouring panel.
  const first = p.y + 36;
  const lastMax = p.y + p.h - 8;
  const lineH = rows.length > 1 ? Math.max(13, Math.min(17, (lastMax - first) / (rows.length - 1))) : 17;
  ctx.save();
  ctx.beginPath();
  ctx.rect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
  ctx.clip();
  rows.forEach((row, i) => {
    ctx.fillStyle = row.dim ? '#7d7278' : '#cbbfa8';
    ctx.fillText(row.text, p.x + 10, first + i * lineH);
  });
  ctx.restore();
}

/** Split a status line at its ' · ' separators into rows no wider than maxW (continuation rows are indented). */
function wrapAtDots(line: string, maxW: number): string[] {
  if (ctx.measureText(line).width <= maxW) return [line];
  const parts = line.split(' · ');
  const out: string[] = [];
  let cur = '';
  for (const part of parts) {
    const next = cur ? `${cur} · ${part}` : out.length ? `  ${part}` : part;
    if (cur && ctx.measureText(next).width > maxW) {
      out.push(cur);
      cur = `  ${part}`;
    } else {
      cur = next;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Forget requests for drops that left the client's view (picked up — by us or anyone — or expired). */
function prunePickupRequests(): void {
  for (const id of pickupRequested) if (!client.view.drops.some((d) => d.id === id)) pickupRequested.delete(id);
}

function countDrops(owner: number): number {
  let n = 0;
  for (const d of client.view.drops) if (d.spec.owner === owner) n++;
  return n;
}

/** The client's side of click-to-pick-up: the nearest drop it shows within PICKUP_REACH of the predicted player. */
function requestPickupNearest(): void {
  const me = client.predictedPosition();
  if (!me) return;
  let best = -1;
  let bestD = PICKUP_REACH;
  for (const d of client.view.drops) {
    if (pickupRequested.has(d.id)) continue;
    const dist = Math.hypot(d.x - me.x, d.y - me.y);
    if (dist <= bestD) {
      bestD = dist;
      best = d.id;
    }
  }
  if (best < 0) {
    logPickup('none in reach');
    return;
  }
  pickupRequested.add(best);
  toServerPickup.send(performance.now(), best);
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

let serverAcc = 0;
let inputAcc = 0;
let last = performance.now();
let statsAt = last;
const drained: SimEvent[] = [];

function sampleInput(now: number, clientPanel: Panel): InputMessage {
  const me = client.view.players.find((p) => p.id === 1);
  const cam = me ?? { x: 0, y: 0 };
  let moveX = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  let moveY = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
  let aimX = cam.x + 60;
  let aimY = cam.y;
  let lmb = mouse.lmb;
  if (autopilot) {
    const t = now / 1000;
    moveX = Math.cos(t * 0.9);
    moveY = Math.sin(t * 1.8) * 0.9;
    aimX = cam.x + Math.cos(t * 2.3) * 80;
    aimY = cam.y + Math.sin(t * 2.3) * 80;
    lmb = true;
  } else if (mouse.x >= clientPanel.x && mouse.x <= clientPanel.x + clientPanel.w) {
    const s = clientPanel.w / VIEW_UNITS;
    aimX = cam.x + (mouse.x - (clientPanel.x + clientPanel.w / 2)) / s;
    aimY = cam.y + (mouse.y - (clientPanel.y + clientPanel.h / 2)) / s;
  }
  return {
    t: 'input', seq: ++seq, moveX, moveY, aimX, aimY,
    held: heldToMask([lmb, keys.has('space') || (autopilot && now % 3000 < 200), false, false, false, false]), flask: -1,
  };
}

function frame(): void {
  const now = performance.now();
  const dt = Math.min(now - last, 250);
  last = now;
  const L = layout();

  // Server at 60 Hz (≤ 5 catch-up steps, like the real server).
  serverAcc += dt;
  let steps = 0;
  while (serverAcc >= TICK_MS && steps < 5) {
    serverTick(now);
    serverAcc -= TICK_MS;
    steps++;
  }
  if (steps === 5) serverAcc = 0;

  // Network → client.
  toClientPickupResult.receive(now, ({ dropId, result }) => {
    logPickup(`pickup #${dropId} ${result}`);
    if (result !== 'ok') pickupRequested.delete(dropId);
  });
  toClient.receive(now, (msg) => {
    client.pushSnapshot(msg.buf, now);
    timeline.push(msg.tick, msg.events);
    const me = decodeSnapshot(msg.buf).viewer();
    if (me) {
      authPos.x = me.x;
      authPos.y = me.y;
      authPos.have = true;
    }
  });

  // Client input ticks at 60 Hz, then the frame.
  inputAcc += dt;
  let inputs = 0;
  while (inputAcc >= TICK_MS && inputs < 5) {
    const input = sampleInput(now, L.client);
    toServer.send(now, input);
    client.predict(input);
    inputAcc -= TICK_MS;
    inputs++;
  }
  if (inputs === 5) inputAcc = 0;
  const alpha = client.update(now);
  prunePickupRequests();
  drained.length = 0;
  timeline.drain(client.renderTick, drained);
  eventsShown += drained.length;

  if (now - statsAt >= 1000) {
    kbps = bytesWindow / 1024 / ((now - statsAt) / 1000);
    avgBytes = snapshotsWindow ? bytesWindow / snapshotsWindow : 0;
    bytesWindow = 0;
    snapshotsWindow = 0;
    statsAt = now;
  }

  // Traces.
  const meC = client.view.players.find((p) => p.id === 1);
  const meS = run.view.players.find((p) => p.id === 1);
  const pp = client.predictedPosition();
  if (meC && meS) pushTrace(localTrace, now, [meS.x, pp ? pp.x : Number.NaN, meC.x]);
  const cm = client.view.monsters;
  if (trackedId < 0 || !cm.alive[trackedId & 0xffff] || cm.id[trackedId & 0xffff] !== trackedId) {
    trackedId = -1;
    let best = Infinity;
    for (let i = 0; i < cm.capacity; i++) {
      if (!cm.alive[i] || !meC) continue;
      const d = Math.hypot(cm.x[i] - meC.x, cm.y[i] - meC.y);
      if (d < best) {
        best = d;
        trackedId = cm.id[i];
      }
    }
  }
  if (trackedId >= 0) {
    const slot = trackedId & 0xffff;
    const sm = run.view.monsters;
    const serverX = sm.alive[slot] && (sm.id[slot] & 0xff0000) === (trackedId & 0xff0000) ? sm.x[slot] : Number.NaN;
    pushTrace(monsterTrace, now, [serverX, cm.prevX[slot] + (cm.x[slot] - cm.prevX[slot]) * alpha]);
  }

  // Draw.
  ctx.fillStyle = '#0d0b0e';
  ctx.fillRect(0, 0, W, H);
  const cam = meC ? { x: meC.x, y: meC.y } : { x: 0, y: 0 };
  drawWorld(L.server, run.view, 1, cam, 'SERVER (truth, now)', false);
  drawWorld(L.client, client.view, alpha, cam, `CLIENT (interpolated ${client.interpDelayMs.toFixed(0)} ms behind + predicted self)`, true);
  drawTrace(L.plotA, localTrace, 'Local player x', ['server', 'predicted', 'on screen'], ['#7aa2ff', '#efe9ff', '#e8662a'], now);
  drawTrace(L.plotB, monsterTrace, 'Nearest monster x', ['server', 'interpolated'], ['#7aa2ff', '#e8662a'], now);
  drawStats(L.stats);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
