// Presenter sandbox (dev/present.html): the REAL multiplayer sim running in the browser, driven by 1–4 bot
// players (tests/sim/bot.ts), with real rules (src/game) for the run config, player runtimes and instanced loot,
// rendered through the presenter with the real renderer, art and audio. Player 1 is the local player.
//
// Query params:
//   ?theme=<map base>|hideout   zone look (all six map bases; hideout = your courtyard with its portal)
//   ?layout=slag-yard|sand-ring  build the arena from a hand-crafted layout fixture (src/data/layouts/fixtures; the area, radius and
//                        theme follow the fixture unless ?theme is given), to look at layout props, decals and light pools
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
//   ?event=<kind>[,<kind>]  force map event(s) on the first wave (hunted echoRift blackout vaultbreakers wound pactAltar orchard ring host
//                        anvil bellwatch voidBreach; secondCrown = boss wave):
//                        add ?variant=N to pick the plan variant. The Stalker with ?theme=rimedOssuary is the Hollow Wolf
//   ?near=D              with ?event=: after the event reveals, put the party D units (default 40) from its focus point so an optional
//                        site opens and the camera frames it; ?near=off leaves the party where it started. ?hold=S then steps S more
//                        sim seconds (an event mid-play)
//   ?local=N             which party member this client is (camera, name plates, own loot); default 1
//   ?net=1               render through the real network path: every 2nd tick the sim view is encoded for the local
//                        player (AOI culling, instanced drops), delivered after ?lat=MS (default 40) one-way latency
//                        to a ClientWorld (interpolation + local prediction) and the EventTimeline, exactly like the
//                        game client. Default: the presenter reads SimRun.view directly.
//   ?debuffs=SPEC        force player debuffs through the sim's own rules (src/sim/debuffs.ts applyDebuff: real
//                        'debuff' events, pops and sounds), after the fast-forward:
//                          1            cycle every debuff (and every root source / stack count) on the local player,
//                                       one at a time, ?every=S seconds each (default 2.4)
//                          a,b:n,…      keep these on the local player (re-applied before they run out), e.g.
//                                       chilled · frozen · rooted:web · bleeding:3 · withered:2 · burning · shocked
//                          party        a different set on each party member (use with ?players=4)
//                          party:A|B|…  these sets on the party members in join order (each set a,b:n,… as above)
//                        Combine with ?idle=1 (and ?freeze=1 for stills). Frozen / rooted players can't move.
//   ?stage=KIND          set a scene around the local player after the fast-forward (for stills, add ?freeze=1):
//                          kit          the 14 layout art-kit props, frame 0 / frame 1 rows (frame: ?zoom=1; ?theme= tints them)
//                          lineup       the theme's family in a row, a magic and a rare leader (frame: ?zoom=2)
//                          commanders   the theme's lieutenant and boss side by side
//                          boss         the theme's boss alone, close beside the local player (· lieutenant: the same)
//                          party        the whole party in a row beside the local player (debuff comparisons)
//                          areas        every bestiary area of the theme, part-way through its telegraph
//                          projectiles  every bestiary projectile in flight (a chain hook with its chain, a tar lob)
import { THEMES, type Theme } from '../../contracts/content';
import { SNAPSHOT_EVERY, type ZoneInfo } from '../../contracts/net';
import type { RunSetup } from '../../contracts/game';
import type { CharacterSave, Item, MapItem } from '../../contracts/items';
import type { Rng } from '../../contracts/rng';
import { MAP_EVENT_KINDS, type ChestBoons, type EventRewardContext, type MapEventKind, type MapEventPlan } from '../../contracts/map-events';
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
import { applyDebuff, writeDebuffViews } from '../../sim/debuffs';
import { worldOf } from '../../sim/run';
import { spawnMonster } from '../../sim/spawn';
import { spawnArea } from '../../sim/areas';
import { TAR_POOL_RADIUS } from '../../sim/constants';
import { PROJ, projSpec, spawnProjectile } from '../../sim/projectiles';
import { NEW_PROJECTILE_KINDS, PLAYER_DEBUFFS, THEME_ROSTER, type PlayerDebuff } from '../../contracts/bestiary';
import { ELITE_BIT } from '../../contracts/sim';
import type { RootSource } from '../../contracts/sim';
import { createBot, type Bot } from '../../../tests/sim/bot';
import { createRng } from '../../core/rng';
import { createPresenter, isDropVisible, pickInteractiveProp } from '../index';
import { overrideLayout, registeredLayouts } from '../../data/layouts';
import { FIXTURE_LAYOUTS } from '../../data/layouts/fixtures';
import { areaRadius, areaTheme } from '../../data/layouts/area';
import { LAYOUT_PROP_RADIUS } from '../../data/layouts/schema';
import { addProp } from '../../sim/props';

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
const layoutFixture = FIXTURE_LAYOUTS.find((l) => (l.areaId === 'furnaceYard' ? 'slag-yard' : 'sand-ring') === qs.get('layout')) ?? registeredLayouts().find((l) => l.areaId === qs.get('layout'));
const theme = (THEMES.includes(qs.get('theme') as Theme) ? qs.get('theme') : layoutFixture ? areaTheme(layoutFixture.areaId) : 'ashenForge') as Theme;
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
const debuffArg = qs.get('debuffs');
const debuffEvery = Math.max(0.5, Number(qs.get('every') ?? 2.4) || 2.4);
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
  const map: MapItem = entry.item as MapItem; // the starter map (Cinder Crossing, tier 1): the theme and tier are overridden on the setup below
  const opened = rules.openMap({ ...owner, mapDevice: map });
  if (!opened.ok) throw new Error(`sandbox: ${opened.error}`);
  // A layout area is not discovered in the sandbox's account: open the starter map, then run the layout's own area at ?tier.
  setup = { ...opened.value.setup, ...(layoutFixture ? { atlasAreaId: layoutFixture.areaId } : {}), map: { ...opened.value.setup.map, baseId: theme as MapItem['baseId'], tier }, seed, itemQuantity: opened.value.setup.itemQuantity * luck, itemRarity: opened.value.setup.itemRarity * luck };
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
  rollChestLoot(ids: readonly number[], rng: Rng, boons?: ChestBoons): DropSpec[] {
    if (!setup) return [];
    const out: DropSpec[] = [];
    for (const id of ids) {
      const ch = chars.get(id);
      if (ch) out.push(...specsFor(rules.rollChestLoot(setup, rng, ch, boons), id));
    }
    return out;
  },
  rollEventReward(ctx: EventRewardContext, ids: readonly number[], rng: Rng): DropSpec[] {
    if (!setup) return [];
    const out: DropSpec[] = [];
    for (const id of ids) {
      const ch = chars.get(id);
      if (ch) out.push(...specsFor(rules.rollEventReward(setup, ctx, rng, ch), id));
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
if (layoutFixture) {
  overrideLayout(layoutFixture);
  config.areaId = layoutFixture.areaId;
  config.theme = areaTheme(layoutFixture.areaId);
  if (THEMES.includes(qs.get('theme') as Theme)) config.theme = qs.get('theme') as Theme;
  config.arenaRadius = areaRadius(layoutFixture.areaId);
}
// Dev switch: force one or two concurrent event plans (a hidden plan never exists here otherwise).
const forced = (qs.get('event') ?? '').split(',').filter((k): k is MapEventKind => (MAP_EVENT_KINDS as readonly string[]).includes(k));
if (forced.length > 0) {
  const plans = forced.slice(0, 2).map((kind, k): MapEventPlan => ({ kind, wave: kind === 'secondCrown' ? 6 : 1 + k, angle: 0.9 + k * 2.2, variant: Number(qs.get('variant') ?? 0) || 0 }));
  config.event = plans.length === 2 ? { ...plans[0], also: plans[1] } : plans[0];
}
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
    ...(run.view.flowSeed !== undefined ? { flowSeed: run.view.flowSeed } : {}),
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
/** ?event= plus ?near=: step until the forced event shows itself, then stand the party beside its focus (an optional site opens). */
function nearEvent(): void {
  const w = worldOf(run);
  const arg = qs.get('near');
  if (!w || hideout || forced.length === 0 || arg === 'off' || qs.get('at')) return;
  const d = arg ? Number(arg) || 40 : 40;
  for (let i = 0; i < 60 * 40 && !(w.mapEvent && w.mapEvent.live.some((e) => !e.finished)); i++) stepSim(null);
  const e = w.mapEvent?.live[0];
  if (!e) return;
  let k = 0;
  for (const p of w.players) {
    const a = 0.8 + k++ * 1.3;
    p.x = p.prevX = p.view.x = p.view.prevX = e.view.x + Math.cos(a) * d;
    p.y = p.prevY = p.view.y = p.view.prevY = e.view.y + Math.sin(a) * d;
  }
  for (let i = 0; i < Math.round(Number(qs.get('hold') ?? 0) * 60); i++) stepSim(null);
}
nearEvent();
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

// ---------------------------------------------------------------------------------------------------------------
// Forced debuffs (?debuffs=…): applied through the sim's own debuff rules on its player state
// ---------------------------------------------------------------------------------------------------------------

interface DebuffPick {
  id: PlayerDebuff;
  stacks: number;
  source?: RootSource;
}

/** "rooted:web", "bleeding:3", "chilled" → a pick. */
function parsePick(token: string): DebuffPick | null {
  const [id, arg] = token.trim().split(':');
  if (!(PLAYER_DEBUFFS as readonly string[]).includes(id)) return null;
  const n = Number(arg);
  return {
    id: id as PlayerDebuff,
    stacks: Number.isFinite(n) && n > 0 ? Math.min(3, Math.floor(n)) : 1,
    source: id === 'rooted' && arg && !Number.isFinite(n) ? (arg as RootSource) : undefined,
  };
}

/** The showcase cycle for ?debuffs=1: every debuff, every root source, every stack count. */
const DEBUFF_CYCLE: DebuffPick[][] = [
  [{ id: 'chilled', stacks: 1 }], [{ id: 'frozen', stacks: 1 }],
  [{ id: 'rooted', stacks: 1, source: 'bone' }], [{ id: 'rooted', stacks: 1, source: 'web' }],
  [{ id: 'rooted', stacks: 1, source: 'chain' }], [{ id: 'rooted', stacks: 1, source: 'tar' }],
  [{ id: 'burning', stacks: 1 }], [{ id: 'bleeding', stacks: 1 }], [{ id: 'bleeding', stacks: 2 }], [{ id: 'bleeding', stacks: 3 }],
  [{ id: 'shocked', stacks: 1 }], [{ id: 'withered', stacks: 1 }], [{ id: 'withered', stacks: 2 }], [{ id: 'withered', stacks: 3 }],
];
/** ?debuffs=party: one set per party member (compare them side by side). */
const DEBUFF_PARTY: DebuffPick[][] = [
  [{ id: 'chilled', stacks: 1 }, { id: 'bleeding', stacks: 2 }],
  [{ id: 'rooted', stacks: 1, source: 'web' }, { id: 'burning', stacks: 1 }],
  [{ id: 'frozen', stacks: 1 }],
  [{ id: 'withered', stacks: 3 }, { id: 'shocked', stacks: 1 }],
];
/** Forced debuffs last this long (re-applied before they run out while the sim runs). */
const FORCED_DURATION = 60;

function applyPicks(id: number, picks: readonly DebuffPick[]): void {
  const w = worldOf(run);
  const p = w?.players.find((q) => q.id === id);
  if (!w || !p || p.dead) return;
  // Forced picks ignore the freeze immunity and the root grace (a dev showcase re-applies them on purpose).
  p.debuffs.freezeImmune = 0;
  p.debuffs.rootImmune = 0;
  for (const pick of picks) {
    const n = pick.id === 'bleeding' || pick.id === 'withered' ? pick.stacks : 1;
    // Burning and bleeding need a hit that dealt damage; keep it small so the bots live.
    for (let k = 0; k < n; k++) applyDebuff(w, p, pick.id, 2, pick.source, FORCED_DURATION);
  }
  writeDebuffViews(p);
}

function clearForced(id: number): void {
  // Let a new showcase entry start clean: the sim's own cleanse path (as a flask / death would).
  const w = worldOf(run);
  const p = w?.players.find((q) => q.id === id);
  if (!w || !p) return;
  const d = p.debuffs;
  d.remaining.fill(0);
  d.bleedRemaining.fill(0);
  d.freezeImmune = 0;
  d.rootImmune = 0;
  writeDebuffViews(p);
}

let statsNote = '';
let debuffClock = 0;
let debuffStep = -1;
function forceDebuffs(dt: number): void {
  if (!debuffArg) return;
  // (The first animation frame's timestamp can precede the script's own clock: never step backwards.)
  debuffClock += Math.max(0, dt);
  if (debuffArg === '1') {
    const step = Math.floor(debuffClock / debuffEvery) % DEBUFF_CYCLE.length;
    if (step !== debuffStep) {
      debuffStep = step;
      clearForced(localId);
      applyPicks(localId, DEBUFF_CYCLE[step]);
      statsNote = `debuff: ${DEBUFF_CYCLE[step].map((p) => `${p.id}${p.source ? `:${p.source}` : p.stacks > 1 ? `:${p.stacks}` : ''}`).join(', ')}`;
    }
    return;
  }
  const parseSet = (spec: string): DebuffPick[] => spec.split(',').map(parsePick).filter((x): x is DebuffPick => x !== null);
  const custom = debuffArg.startsWith('party:') ? debuffArg.slice(6).split('|').map(parseSet) : null;
  const sets: [number, DebuffPick[]][] = debuffArg === 'party'
    ? run.view.players.map((p, k) => [p.id, DEBUFF_PARTY[k % DEBUFF_PARTY.length]])
    : custom
      ? run.view.players.map((p, k) => [p.id, custom[k] ?? []])
      : [[localId, parseSet(debuffArg)]];
  for (const [id, picks] of sets) {
    const view = run.view.players.find((p) => p.id === id);
    if (!view || view.dead) continue;
    // (Re-)apply whatever is missing or about to run out.
    const due = picks.filter((pick) => {
      const d = view.debuffs.find((x) => x.id === pick.id);
      return !d || d.remaining < 1 || d.stacks < pick.stacks;
    });
    if (due.length > 0) applyPicks(id, due);
  }
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
    // `restore` pins life to the new 1-point maximum.
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
  if (!freeze) forceDebuffs(dt);
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
      (pickupNote ? `\n${pickupNote}` : '') +
      (statsNote ? `\n${statsNote}` : '');
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------------------------------------------
// Staged scenes (?stage=…) for stills
// ---------------------------------------------------------------------------------------------------------------

function stage(kind: string): void {
  const w = worldOf(run);
  const me = run.view.players.find((p) => p.id === localId);
  if (!w || !me || hideout) return;
  const roster = THEME_ROSTER[theme as keyof typeof THEME_ROSTER] ?? THEME_ROSTER.ashenForge;
  const cx = me.x;
  const cy = me.y;
  if (kind === 'lineup') {
    // Clear the floor first: only the lineup stands (and the local player keeps no debuffs from the fight).
    const m = w.monsters;
    for (let i = 0; i < m.capacity; i++) if (m.alive[i]) m.release(i);
    // Framed for ?zoom=2 (a 320×180 view): the family on a row, a magic and a rare leader below.
    const fam = roster.family;
    fam.forEach((k, n) => spawnMonster(w, k, cx - 128 + n * 62, cy - 22, { animate: false }));
    spawnMonster(w, fam[0], cx - 110, cy + 60, { animate: false, rarity: 'magic', mods: ELITE_BIT.swift });
    spawnMonster(w, fam[1], cx + 110, cy + 60, { animate: false, rarity: 'rare', mods: ELITE_BIT.juggernaut | ELITE_BIT.frenzied });
  } else if (kind === 'kit') {
    // The layout art kit (D 10.5): the fourteen props in two rows, frame 0 on top and the recolour (variant 1) below.
    // Frame with ?zoom=1 (a 640x360 view); add ?theme= to see the per-theme kit tint.
    const m = w.monsters;
    for (let i = 0; i < m.capacity; i++) if (m.alive[i]) m.release(i);
    const kit = ['vat', 'bellows', 'altar', 'sarcophagus', 'choirStall', 'ribArch', 'iceColumn', 'crate', 'chainPost', 'hoist', 'gate', 'weaponRack', 'obelisk', 'statue'] as const;
    kit.forEach((k, n) => {
      const row = Math.floor(n / 7);
      for (const variant of [0, 1]) addProp(w, k, cx - 270 + (n % 7) * 90, cy - 70 + (row * 2 + variant) * 62, LAYOUT_PROP_RADIUS[k], { variant });
    });
  } else if (kind === 'party') {
    const m = w.monsters;
    for (let i = 0; i < m.capacity; i++) if (m.alive[i]) m.release(i);
    // The camera follows the local player: put her second from the left so the whole row is in view.
    let slot = 1;
    w.players.forEach((p) => {
      const x = cx + (p.id === localId ? 0 : slot++ === 1 ? -32 : (slot - 2) * 32);
      p.x = p.prevX = p.view.x = p.view.prevX = x;
      p.y = p.prevY = p.view.y = p.view.prevY = cy;
    });
  } else if (kind === 'boss' || kind === 'lieutenant') {
    const m = w.monsters;
    for (let i = 0; i < m.capacity; i++) if (m.alive[i]) m.release(i);
    const k = kind === 'boss' ? roster.boss : roster.lieutenant;
    spawnMonster(w, k, cx + 50, cy + 20, { animate: false, boss: kind === 'boss', lieutenant: kind === 'lieutenant' });
  } else if (kind === 'commanders') {
    const m = w.monsters;
    for (let i = 0; i < m.capacity; i++) if (m.alive[i]) m.release(i);
    spawnMonster(w, roster.lieutenant, cx - 90, cy + 40, { animate: false, lieutenant: true });
    spawnMonster(w, roster.boss, cx + 80, cy + 60, { animate: false, boss: true });
  } else if (kind === 'areas') {
    const put = (k: Parameters<typeof spawnArea>[1], x: number, y: number, r: number, dur: number, age: number, opts: Parameters<typeof spawnArea>[6] = {}): void => {
      const a = spawnArea(w, k, cx + x, cy + y, r, dur, { debuff: null, ...opts });
      a.age = age;
    };
    if (theme === 'rimedOssuary') {
      put('frostNovaWarning', -200, -80, 70, 1.1, 0.7);
      put('frostNovaWarning', -80, 110, 44, 1, 0.5);
      for (let k = 0; k < 7; k++) put('glacialSpike', 60 + k * 26, -120, 17, 0.8 + k * 0.07, 0.62, { angle: 0 });
      put('icePrison', 0, 0, 46 * (1 - 0.8 * 0.55), 1.8, 1.8 * 0.55, { target: localId, endRadius: 46 * 0.2 });
      put('blizzard', 200, 70, 52, 9, 3, { angle: 0.3 });
      put('choirWave', -240, 60, 130, 3.6, 1, { variant: 1, angle: 0.4 });
      put('wispBurst', 90, 100, 40, 0.7, 0.45);
    } else {
      put('tarPool', -200, -90, TAR_POOL_RADIUS, 6, 2);
      put('tarPool', -150, -50, TAR_POOL_RADIUS, 6, 0.5);
      put('chargeLine', -260, 20, 300, 0.6, 0.35, { angle: -0.35, variant: 0 });
      // Varkus's lane mid-cast (the fill two thirds along) and one whose dash is running (full, hot, steady).
      put('chargeLine', -60, 120, 260, 1.7, 0.6, { angle: 0, variant: 2 });
      put('chargeLine', 30, -158, 240, 1.7, 1.2, { angle: 0, variant: 2 });
      put('executionMark', 0, 0, 36, 3, 2.5);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        put('arenaSpikes', 150 + Math.cos(a) * 36, -80 + Math.sin(a) * 36, 12, 1.2, 0.8);
      }
      put('whirlwind', 180, 90, 64, 0.9, 0.5, { variant: 0 });
      put('whirlwind', -120, -130, 58, 3, 1, { variant: 1 });
    }
  } else if (kind === 'projectiles') {
    const shoot = (k: (typeof NEW_PROJECTILE_KINDS)[number], x: number, y: number, angle: number, speed: number, age: number, flight = 0): void => {
      projSpec.kind = PROJ[k];
      projSpec.hostile = true;
      projSpec.x = cx + x;
      projSpec.y = cy + y;
      projSpec.angle = angle;
      projSpec.speed = speed;
      projSpec.range = 600;
      projSpec.radius = 5;
      projSpec.damage = 0;
      const i = spawnProjectile(w, projSpec, flight);
      if (i < 0) return;
      w.projectiles.age[i] = age;
      w.projectiles.prevX[i] = w.projectiles.x[i] - Math.cos(angle) * speed / 60;
      w.projectiles.prevY[i] = w.projectiles.y[i] - Math.sin(angle) * speed / 60;
    };
    // Framed for ?zoom=2 (a 320×180 view).
    shoot('webShot', -125, -60, 0.2, 120, 0.5);
    shoot('frostShard', -125, -25, 0.1, 170, 0.5);
    shoot('boneShard', -125, 10, 0, 160, 0.5);
    shoot('crossbowBolt', 60, -65, Math.PI, 460, 0.2);
    // The chain hook with its thrower standing behind the launch point (the chain hangs from his fist).
    const hookAng = Math.PI + 0.3;
    const hookAge = 0.2;
    shoot('chainHook', 40, 20, hookAng, 320, hookAge);
    const lx = 40 - Math.cos(hookAng) * 320 * hookAge;
    const ly = 20 - Math.sin(hookAng) * 320 * hookAge;
    spawnMonster(w, 'chainThrall', cx + lx - Math.cos(hookAng) * 12, cy + ly - Math.sin(hookAng) * 12, { animate: false });
    // A tar lob half-way down: its marker is the pool it will leave.
    shoot('tarGlob', -20, 60, Math.PI + 0.2, 110, 0.6, 1.2);
  }
}
if (qs.get('stage')) stage(qs.get('stage')!);

if (debuffArg) {
  forceDebuffs(0);
  // Stills (?freeze=1): the sim never steps again, so hand the pops to the first frame directly.
  if (freeze) for (const e of run.drainEvents()) pending.push(e);
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
