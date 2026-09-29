// Presenter sandbox (dev/present.html): the REAL multiplayer sim running in the browser, driven by 1–4 bot
// players (tests/sim/bot.ts), with real rules (src/game) for the run config, player runtimes and instanced loot,
// rendered through the presenter with the real renderer, art and audio. Player 1 is the local player.
//
// Query params:
//   ?theme=ashenForge|rimedOssuary|ironColiseum|hideout   zone look (hideout = your courtyard with its portal)
//   ?players=1..4        party size (bots)
//   ?wave=N              fast-forward (with short waves) until wave N has started
//   ?boss=1              fast-forward to the boss wave
//   ?until=cleared       fast-forward until the map is cleared (boss dead, chest + return portal up)
//   ?t=SECONDS           then fast-forward this much more sim time
//   ?tier=N              map tier (default 4) · ?level=L character level (default 26) · ?luck=K loot quantity/rarity ×K
//   ?seed=N              map seed · ?manual=1 drive player 1 (WASD + mouse, Space/Q/E/R/F, 1–4 flasks)
//   ?freeze=1            stop the sim after the fast-forward (effects keep animating)
//   ?kill=1              the local player dies after the fast-forward (death grading)
//   ?hover=<kind>        force the hover highlight on a prop kind (mapDevice/stash/merchant/anvil/portal/returnPortal)
//   ?drops=demo          after the fast-forward, put a spread of loot around the local player: own equipment
//                        (click-to-pick-up), own currency/maps, and public drops (spec.owner 0) as if a player had
//                        dropped them — a stacked pile included, to show label stacking
//   ?hoverDrop=first|public|N  force the drop hover highlight (first own drop, first public drop, or visible drop N);
//                        otherwise the drop under the mouse (once it moved) is hovered. In ?manual=1 a left click on a
//                        drop label/sprite asks the sim to pick it up (run.requestPickup) instead of attacking.
//   ?portals=N           hideout: open the map portal with N uses (default 8)
//   ?shake=0..1          screen shake setting (default 1) · ?stats=0 hide the overlay
//   ?fragile=1           keep the rules' real life totals (default: bots get extra life so fast-forwards survive)
//   ?at=X,Y              spawn the local player here · ?idle=1 the local player stands still (composition shots)
//   ?zoom=Z              camera zoom for close-up inspection (the game itself always uses 1)
//   ?local=N             which party member this client is (camera, name plates, own loot); default 1
//   ?net=1               render through the real network path: every 2nd tick the sim view is encoded for the local
//                        player (AOI culling, instanced drops), delivered after ?lat=MS (default 40) one-way latency
//                        to a ClientWorld (interpolation + local prediction) and the EventTimeline, exactly like the
//                        game client. Default: the presenter reads SimRun.view directly.
import type { Theme } from '../../contracts/content';
import { SNAPSHOT_EVERY, type ZoneInfo } from '../../contracts/net';
import type { RunSetup } from '../../contracts/game';
import type { CharacterSave, Item, MapItem } from '../../contracts/items';
import type { Rng } from '../../contracts/rng';
import {
  SIM_DT, type DropSpec, type KillLootContext, type PlayerIntent, type PlayerRuntime, type RunConfig, type RunHooks, type SimEvent,
  type SimRun, type WorldView,
} from '../../contracts/sim';
import { generateArt } from '../../art';
import { createAudio } from '../../audio';
import { rules } from '../../game';
import { createRenderer } from '../../render';
import {
  createClientWorld, createEventTimeline, createSnapshotEncoder, inputFromIntent, type NetClientWorld,
} from '../../net';
import { createRun, type SimPlayerUpdate } from '../../sim';
import { createBot, type Bot } from '../../../tests/sim/bot';
import { createRng } from '../../core/rng';
import { createPresenter, isDropVisible, pickInteractiveProp } from '../index';

declare global {
  interface Window {
    __present?: {
      run: SimRun;
      /** Advance n sim ticks, showing their events. */
      step(n: number): void;
      /** Advance n sim ticks silently (like the fast-forward: events are dropped). */
      skip(n: number): void;
      frames: number;
      ready: boolean;
      kill(id?: number): void;
      /** Presenter.dropAt at a CSS point (automation). */
      dropAt(cssX: number, cssY: number): number;
      /** World → CSS point under the presenter's camera (automation). */
      toScreen(x: number, y: number): { x: number; y: number };
      /** Last click-pickup result shown in the overlay. */
      readonly pickup: string;
    };
  }
}

const qs = new URLSearchParams(location.search);
const THEMES: Theme[] = ['hideout', 'ashenForge', 'rimedOssuary', 'ironColiseum'];
const theme = (THEMES.includes(qs.get('theme') as Theme) ? qs.get('theme') : 'ashenForge') as Theme;
const hideout = theme === 'hideout';
const partySize = Math.max(1, Math.min(4, Number(qs.get('players') ?? 1) || 1));
const targetWave = qs.get('boss') === '1' ? -1 : Number(qs.get('wave') ?? 0);
const extraSeconds = Number(qs.get('t') ?? 0);
const tier = Math.max(1, Math.min(15, Number(qs.get('tier') ?? 4)));
const level = Math.max(1, Math.min(60, Number(qs.get('level') ?? 26)));
const luck = Math.max(0.1, Number(qs.get('luck') ?? 1));
const seed = Number(qs.get('seed') ?? 1337);
const manual = qs.get('manual') === '1';
const freeze = qs.get('freeze') === '1';
const fragile = qs.get('fragile') === '1';
const shake = Number(qs.get('shake') ?? 1);
const hoverKind = qs.get('hover');
const portals = Number(qs.get('portals') ?? 8);
const idle = qs.get('idle') === '1';
const spawnAt = qs.get('at')?.split(',').map(Number) ?? null;
const localId = Math.max(1, Math.min(partySize, Number(qs.get('local') ?? 1) || 1));
const dropsDemo = qs.get('drops') === 'demo';
const hoverDropArg = qs.get('hoverDrop');
const netMode = qs.get('net') === '1';
const latencyMs = Math.max(0, Number(qs.get('lat') ?? 40) || 0);
const NAMES = ['Ysolde', 'Maren', 'Ashka', 'Veyla'];
const LOADOUTS: (string | null)[][] = [
  ['emberLance', 'riftStep', 'emberNova', 'arcChain', 'flameWave', 'cinderWard'],
  ['emberLance', 'riftStep', 'rimeShards', 'arcChain', 'emberNova', 'cinderWard'],
  ['emberLance', 'riftStep', 'flameWave', 'emberNova', 'rimeShards', 'cinderWard'],
  ['emberLance', 'riftStep', 'arcChain', 'rimeShards', 'flameWave', 'cinderWard'],
];
const SKILL_PLAN = [
  'emberNova', 'emberNova', 'emberNova', 'rimeShards', 'rimeShards', 'rimeShards', 'rimeShards', 'rimeShards', 'arcChain',
  'riftStep', 'cinderWard', 'flameWave', 'arcChain', 'arcChain', 'flameWave', 'emberNova', 'emberNova', 'riftStep',
  'cinderWard', 'flameWave', 'arcChain', 'emberLance', 'emberLance', 'emberLance', 'emberLance', 'emberNova', 'rimeShards',
] as const;

// ---------------------------------------------------------------------------------------------------------------
// Characters (real rules) and the run
// ---------------------------------------------------------------------------------------------------------------

function makeCharacter(index: number): CharacterSave {
  let ch = rules.createCharacter(NAMES[index], seed * 7 + index);
  while (ch.level < level) {
    const g = rules.grantXp(ch, rules.xpToNext(ch.level) - ch.xp);
    if (g.levelsGained === 0) break;
    ch = g.character;
  }
  for (const s of SKILL_PLAN) {
    if (ch.unspentSkillPoints <= 0) break;
    const r = rules.rankUpSkill(ch, s);
    if (r.ok) ch = r.value;
  }
  const loadout = LOADOUTS[index % LOADOUTS.length];
  for (let slot = 1; slot < loadout.length; slot++) {
    const r = rules.setLoadoutSlot(ch, slot, loadout[slot] as never);
    if (r.ok) ch = r.value;
  }
  return ch;
}

const chars = new Map<number, CharacterSave>();
for (let i = 0; i < partySize; i++) chars.set(i + 1, makeCharacter(i));

let setup: RunSetup | null = null;
if (!hideout) {
  const owner = chars.get(1)!;
  const entry = owner.backpack.entries.find((e) => e.item.kind === 'map');
  if (!entry) throw new Error('sandbox: the starting kit has no map');
  const map: MapItem = { ...(entry.item as MapItem), baseId: theme as MapItem['baseId'], tier };
  const opened = rules.openMap({ ...owner, mapDevice: map });
  if (!opened.ok) throw new Error(`sandbox: ${opened.error}`);
  setup = { ...opened.value.setup, seed, itemQuantity: opened.value.setup.itemQuantity * luck, itemRarity: opened.value.setup.itemRarity * luck };
}

const loot = new Map<number, Item>();
let nextToken = 1;
function specsFor(items: Item[], owner: number): DropSpec[] {
  const out: DropSpec[] = [];
  for (const item of items) {
    const token = nextToken++;
    loot.set(token, item);
    out.push({ ...rules.dropSpec(item, token, owner), owner });
  }
  return out;
}
const hooks: RunHooks = {
  rollKillLoot(ctx: KillLootContext, ids: readonly number[], rng: Rng): DropSpec[] {
    if (!setup) return [];
    const out: DropSpec[] = [];
    for (const id of ids) {
      const ch = chars.get(id);
      if (ch) out.push(...specsFor(rules.rollKillLoot(setup, ctx, rng, ch), id));
    }
    return out;
  },
  rollChestLoot(ids: readonly number[], rng: Rng): DropSpec[] {
    if (!setup) return [];
    const out: DropSpec[] = [];
    for (const id of ids) {
      const ch = chars.get(id);
      if (ch) out.push(...specsFor(rules.rollChestLoot(setup, rng, ch), id));
    }
    return out;
  },
  tryPickup(id: number, token: number): boolean {
    const ch = chars.get(id);
    const item = loot.get(token);
    if (!ch || !item) return false;
    let r = rules.addToBackpack(ch, item);
    if (!r.ok && qs.get('full') !== '1') {
      // Dev convenience: empty the backpack when it fills (?full=1 keeps it full to show refused drops).
      r = rules.addToBackpack({ ...ch, backpack: { ...ch.backpack, entries: [] } }, item);
    }
    if (!r.ok) return false;
    chars.set(id, r.value);
    loot.delete(token);
    return true;
  },
};

const config: RunConfig = rules.buildRunConfig(setup, hooks);
const run = createRun(config);

function runtimeFor(ch: CharacterSave): PlayerRuntime {
  const rt = rules.playerRuntime(ch, setup);
  if (fragile) return rt;
  // Sandbox bots are sturdier than real characters so long fast-forwards reach the late waves.
  return { ...rt, stats: { ...rt.stats, maxLife: rt.stats.maxLife * 6, lifeRegen: rt.stats.lifeRegen + rt.stats.maxLife * 0.08 } };
}

const bots = new Map<number, Bot>();
function join(id: number): void {
  const ch = chars.get(id)!;
  const at = id === localId && spawnAt && spawnAt.length === 2 ? { x: spawnAt[0], y: spawnAt[1] } : {};
  run.addPlayer({ id, name: ch.name, level: ch.level, runtime: runtimeFor(ch), ...at });
  bots.set(id, createBot());
}
for (const id of chars.keys()) join(id);
if (hideout && portals > 0) run.setPortal(portals);

// ---------------------------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------------------------

const canvas = document.getElementById('view') as HTMLCanvasElement;
const statsEl = document.getElementById('stats') as HTMLElement;
if (qs.get('stats') === '0') statsEl.classList.add('hidden');
const renderer = createRenderer(canvas);
const art = generateArt();
renderer.registerSprites(art.sprites);
const audio = createAudio();
const unlock = (): void => void audio.unlock();
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);
function fit(): void {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
}
addEventListener('resize', fit);
fit();
const presenter = createPresenter(renderer, art, audio);
if (qs.has('zoom')) presenter.camera.zoom = Math.max(0.5, Number(qs.get('zoom')) || 1);

// ---------------------------------------------------------------------------------------------------------------
// Input (manual mode) and intents
// ---------------------------------------------------------------------------------------------------------------

const keys = new Set<string>();
const mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false, moved: false };
let pickupNote = '';
let flaskPress = -1;
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys.add(k === ' ' ? 'space' : k);
  if (k >= '1' && k <= '4') flaskPress = Number(k) - 1;
  if (k === ' ') e.preventDefault();
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k === ' ' ? 'space' : k);
});
canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.moved = true;
});
canvas.addEventListener('mousedown', (e) => {
  // Like the game client: a click on a drop picks it up and never starts the basic attack.
  const id = manual ? presenter.dropAt(e.clientX, e.clientY) : -1;
  if (id >= 0) {
    pickupNote = `pickup #${id}: ${run.requestPickup(localId, id)}`;
    return;
  }
  mouse.down = true;
});
addEventListener('mouseup', () => (mouse.down = false));

const lastIntent = new Map<number, PlayerIntent>();
/** Player being killed by kill(): stands still so the horde reaches them. */
let dying = 0;
function manualIntent(): PlayerIntent {
  const aim = renderer.screenToWorld(mouse.x, mouse.y, presenter.camera);
  const mx = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  const my = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
  const intent: PlayerIntent = {
    moveX: mx, moveY: my, aimX: aim.x, aimY: aim.y,
    held: [mouse.down, keys.has('space'), keys.has('q'), keys.has('e'), keys.has('r'), keys.has('f')],
    flask: flaskPress,
  };
  flaskPress = -1;
  return intent;
}

function idleIntent(x: number, y: number): PlayerIntent {
  return { moveX: 0, moveY: 0, aimX: x + 40, aimY: y + 30, held: [false, false, false, false, false, false], flask: -1 };
}

function setIntents(): void {
  for (const p of run.view.players) {
    const standStill = (p.id === localId && idle) || p.id === dying;
    const intent = p.id === localId && manual ? manualIntent() : standStill ? idleIntent(p.x, p.y) : bots.get(p.id)?.intent(run.view, p.id);
    if (!intent) continue;
    run.setIntent(p.id, intent);
    lastIntent.set(p.id, intent);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Outcomes: shared XP with level-ups, flask charges, re-entry after death
// ---------------------------------------------------------------------------------------------------------------

const deadSince = new Map<number, number>();
let simTime = 0;
let killLocal = qs.get('kill') === '1';
function handleOutcomes(): void {
  for (const o of run.drainOutcomes()) {
    if (o.t === 'xp') {
      for (const p of run.view.players) {
        if (p.dead) continue;
        const ch = chars.get(p.id);
        if (!ch) continue;
        const g = rules.grantXp(ch, o.amount);
        chars.set(p.id, g.character);
        if (g.levelsGained > 0) {
          const update: SimPlayerUpdate = { ...runtimeFor(g.character), restore: true, level: g.character.level };
          run.updatePlayer(p.id, update);
        }
      }
    } else if (o.t === 'flaskUsed') {
      const ch = chars.get(o.playerId);
      if (ch) {
        const next = rules.consumeFlask(ch, o.slot);
        chars.set(o.playerId, next);
        run.updatePlayer(o.playerId, { flasks: runtimeFor(next).flasks });
      }
    } else if (o.t === 'returnPortal' || o.t === 'enterPortal') {
      // A real server moves the player to another instance; the sandbox keeps everyone here.
    }
  }
  // Dead bots re-enter after a while (as if through a fresh portal), except a deliberately killed local player.
  for (const p of run.view.players) {
    if (!p.dead) {
      deadSince.delete(p.id);
      continue;
    }
    if (!deadSince.has(p.id)) deadSince.set(p.id, simTime);
    if (simTime - deadSince.get(p.id)! > 6 && !(p.id === localId && (killLocal || freeze))) {
      run.removePlayer(p.id);
      join(p.id);
      deadSince.delete(p.id);
    }
  }
}

function stepSim(collect: SimEvent[] | null, now = performance.now()): void {
  setIntents();
  if (net) net.input();
  run.step();
  simTime += SIM_DT;
  const ev = run.drainEvents();
  if (net) net.serverTick(ev, now);
  else if (collect) for (const e of ev) collect.push(e);
  handleOutcomes();
}

// ---------------------------------------------------------------------------------------------------------------
// Network path (?net=1): server-side encoder → simulated link → ClientWorld + EventTimeline (like src/client)
// ---------------------------------------------------------------------------------------------------------------

interface NetPipe {
  readonly world: NetClientWorld;
  /** Record the local player's input for this tick (sent + predicted, like the client's 60 Hz input tick). */
  input(): void;
  /** After a server step: batch events, and every SNAPSHOT_EVERY ticks encode + send a snapshot. */
  serverTick(events: SimEvent[], now: number): void;
  /** Deliver everything that has arrived by `now`; returns the render alpha and fills `out` with due events. */
  frame(now: number, out: SimEvent[]): number;
  bytes: number;
  snapshots: number;
}

function createNetPipe(): NetPipe {
  const encoder = createSnapshotEncoder();
  const world = createClientWorld();
  const timeline = createEventTimeline();
  const outbox: { at: number; buf: ArrayBuffer; tick: number; events: SimEvent[] }[] = [];
  let batch: SimEvent[] = [];
  let seq = 0;
  const zone: ZoneInfo = {
    instanceId: 'sandbox', kind: hideout ? 'hideout' : 'map', ownerCharacterId: 'c1', ownerName: NAMES[0], theme: run.view.theme,
    arenaRadius: run.view.arenaRadius, mapName: config.mapName, tier: config.tier, localPlayerId: localId,
    props: run.view.props.map((p) => ({ ...p })), setup, portal: null,
  };
  world.setZone(zone);
  timeline.setLocalPlayer(localId);
  const hint = chars.get(localId);
  if (hint) {
    const rt = runtimeFor(hint);
    world.setPredictionHints({ moveSpeed: rt.stats.moveSpeed, castTimes: Object.fromEntries(rt.skills.map((k) => [k.id, k.castTime])) });
  }
  const pipe: NetPipe = {
    world,
    bytes: 0,
    snapshots: 0,
    input() {
      const intent = lastIntent.get(localId);
      if (intent) world.predict(inputFromIntent(intent, ++seq));
    },
    serverTick(events, now) {
      for (const e of events) batch.push(e);
      if (run.view.tick % SNAPSHOT_EVERY !== 0) return;
      const buf = encoder.encode(run.view, localId, seq);
      pipe.bytes += buf.byteLength;
      pipe.snapshots++;
      outbox.push({ at: now + latencyMs, buf, tick: run.view.tick, events: batch });
      batch = [];
    },
    frame(now, out) {
      let n = 0;
      while (n < outbox.length && outbox[n].at <= now) {
        const m = outbox[n++];
        world.pushSnapshot(m.buf, now);
        timeline.push(m.tick, m.events);
      }
      if (n > 0) outbox.splice(0, n);
      const alpha = world.update(now);
      timeline.drain(world.renderTick, out);
      return alpha;
    },
  };
  return pipe;
}

let net: NetPipe | null = null;

// ---------------------------------------------------------------------------------------------------------------
// Fast-forward to the requested moment
// ---------------------------------------------------------------------------------------------------------------

function fastForward(): void {
  const waves = config.waves;
  const want = targetWave < 0 ? waves.bossWave : targetWave;
  if (!hideout && want > 0) {
    // Shorten waves (the sim reads its wave config live) until the target wave has started, then restore.
    const duration = waves.waveDuration;
    waves.waveDuration = waves.tellDuration + 7;
    let guard = 60 * 60 * 12;
    while (run.view.run.wave < want && guard-- > 0) stepSim(null);
    waves.waveDuration = duration;
    // Let the target wave's spawns arrive.
    for (let i = 0; i < 60 * (waves.tellDuration + 2); i++) stepSim(null);
  }
  if (qs.get('until') === 'cleared') {
    const duration = waves.waveDuration;
    waves.waveDuration = waves.tellDuration + 7;
    for (let guard = 60 * 60 * 15; guard > 0 && run.view.run.phase !== 'cleared'; guard--) {
      if (run.view.run.wave >= waves.bossWave) waves.waveDuration = duration;
      stepSim(null);
    }
    waves.waveDuration = duration;
  }
  for (let i = 0; i < Math.round(extraSeconds * 60); i++) stepSim(null);
}
fastForward();
if (dropsDemo) spawnDemoDrops();
if (killLocal) {
  kill(localId);
  // Let the fall play out.
  for (let i = 0; i < 90; i++) stepSim(null);
}
if (netMode) {
  net = createNetPipe();
  presenter.reset(net.world.view, localId);
}

/**
 * Loot around the local player: to the right her own loot (chest rolls: equipment waiting for a click, plus
 * currency, flasks and maps), to the left public drops (items "a player dropped": owner 0, never auto-collected),
 * and a small mixed pile just below her to show stacked labels. Spawned through SimRun.spawnDrop like the server.
 */
function spawnDemoDrops(): void {
  const me = run.view.players.find((p) => p.id === localId);
  const ch = chars.get(localId);
  if (!me || !ch) return;
  const rng = createRng(seed ^ 0x5eed);
  const own: Item[] = [];
  if (setup) {
    const rich = { ...setup, itemRarity: setup.itemRarity * 4, itemQuantity: setup.itemQuantity * 2 };
    for (let k = 0; k < 2; k++) own.push(...rules.rollChestLoot(rich, rng, ch));
  }
  const kit: Item[] = [];
  for (const item of Object.values(ch.equipment)) if (item) kit.push(item);
  for (const e of ch.backpack.entries) kit.push(e.item);
  const drop = (item: Item, owner: number, x: number, y: number): void => {
    const token = nextToken++;
    loot.set(token, item);
    run.spawnDrop(rules.dropSpec(item, token, owner, owner === 0), x, y);
  };
  own.slice(0, 8).forEach((item, k) => drop(item, localId, me.x + 60 + (k % 4) * 26, me.y - 30 + Math.floor(k / 4) * 44));
  kit.slice(0, 6).forEach((item, k) => drop(item, 0, me.x - 70 - (k % 3) * 34, me.y - 34 + Math.floor(k / 3) * 46));
  // A pile: own and public on (almost) the same spot.
  const pile = [...own.slice(8, 11), ...kit.slice(6, 8)];
  pile.forEach((item, k) => drop(item, k < 3 ? localId : 0, me.x + (k % 2) * 3 - 1, me.y + 56 + k));
  // Let them bounce and land.
  for (let i = 0; i < 50; i++) stepSim(null);
}

/** Drop id for ?hoverDrop, or −1 (then the mouse decides). */
function forcedHoverDrop(world: WorldView): number {
  if (!hoverDropArg) return -1;
  const visible = world.drops.filter((d) => isDropVisible(d.spec, localId));
  if (hoverDropArg === 'public') return visible.find((d) => d.spec.owner === 0)?.id ?? -1;
  if (hoverDropArg === 'first') return visible.find((d) => d.spec.owner === localId && !d.spec.autoPickup)?.id ?? visible[0]?.id ?? -1;
  return visible[Number(hoverDropArg) || 0]?.id ?? -1;
}

function kill(id = localId): void {
  // Sandbox-only: make the player one-hit (no sim internals touched) and let the horde finish the job. The crushing
  // stats are re-applied while waiting, because a shared-XP level-up restores the real runtime.
  const ch = chars.get(id);
  if (!ch) return;
  const rt = rules.playerRuntime(ch, setup);
  const crushed = { ...rt.stats, maxLife: 1, lifeRegen: 0, armor: 0, evasion: 0, damageTaken: 50 };
  dying = id;
  for (let i = 0; i < 60 * 60 && !run.view.players.find((p) => p.id === id)?.dead; i++) {
    // `restore` pins life to the new 1-point maximum (the melee cap is a share of max life, so it must shrink too).
    if (i % 20 === 0) run.updatePlayer(id, { stats: crushed, restore: true });
    stepSim(null);
  }
  dying = 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------------------------------------------

let acc = 0;
let last = performance.now();
let frames = 0;
let fpsTime = 0;
let fps = 0;
const pending: SimEvent[] = [];
const cursor = { x: 0, y: 0 };

function hoverProp(world: WorldView): number {
  if (hoverKind) return world.props.find((p) => p.kind === hoverKind)?.id ?? -1;
  const w = renderer.screenToWorld(mouse.x, mouse.y, presenter.camera);
  return pickInteractiveProp(world.props, w.x, w.y);
}

function tick(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!freeze) {
    acc += dt;
    let steps = 0;
    while (acc >= SIM_DT && steps < 5) {
      stepSim(pending, now);
      acc -= SIM_DT;
      steps++;
    }
    if (steps === 5) acc = 0;
  }
  let world = run.view;
  let alpha = freeze ? 1 : acc / SIM_DT;
  if (net) {
    alpha = net.frame(now, pending);
    world = net.world.view;
  }
  const me = world.players.find((p) => p.id === localId);
  const intent = lastIntent.get(localId);
  if (manual) {
    const w = renderer.screenToWorld(mouse.x, mouse.y, presenter.camera);
    cursor.x = w.x;
    cursor.y = w.y;
  } else if (intent) {
    cursor.x = intent.aimX;
    cursor.y = intent.aimY;
  } else if (me) {
    cursor.x = me.x;
    cursor.y = me.y;
  }
  const forced = forcedHoverDrop(world);
  presenter.frame({
    world,
    localPlayerId: localId,
    alpha,
    dt,
    events: pending,
    cursorWorld: cursor,
    hoverPropId: hoverProp(world),
    hoverDropId: forced >= 0 || !mouse.moved ? forced : presenter.dropAt(mouse.x, mouse.y),
    settings: { screenShake: shake },
    paused: false,
  });
  pending.length = 0;
  frames++;
  fpsTime += dt;
  if (fpsTime > 0.5) {
    fps = frames / fpsTime;
    frames = 0;
    fpsTime = 0;
    const s = renderer.stats();
    const rv = run.view.run;
    statsEl.textContent =
      `${theme} · ${rv.phase} · wave ${rv.wave}/${rv.waveCount} · ${rv.monstersAlive} monsters · ${run.view.projectiles.count} proj\n` +
      `fps ${fps.toFixed(0)} · sprites ${s.sprites} · particles ${s.particles} · lights ${s.lights} · draws ${s.drawCalls}` +
      (net
        ? `\nnet · ${latencyMs} ms · delay ${net.world.interpDelayMs.toFixed(0)} ms · ${(net.bytes / Math.max(1, net.snapshots)).toFixed(0)} B/snapshot`
        : '') +
      (pickupNote ? `\n${pickupNote}` : '');
  }
  requestAnimationFrame(tick);
}

window.__present = {
  run,
  step(n: number) {
    for (let i = 0; i < n; i++) stepSim(pending);
  },
  skip(n: number) {
    for (let i = 0; i < n; i++) stepSim(null);
  },
  get frames() {
    return frames;
  },
  ready: true,
  kill,
  dropAt: (cssX: number, cssY: number) => presenter.dropAt(cssX, cssY),
  toScreen: (x: number, y: number) => renderer.worldToScreen(x, y, presenter.camera),
  get pickup() {
    return pickupNote;
  },
};
requestAnimationFrame(tick);
