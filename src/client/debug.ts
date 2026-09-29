// Debug / e2e hooks: window.__foe. Loaded lazily and only in dev builds (or builds made with VITE_FOE_DEBUG=1), so
// a production bundle carries neither these hooks nor the autopilot (bot.ts), which could otherwise farm maps
// from one console line.
import type { Command, ServerMessage } from '../contracts/net';
import type { ConnectionStatus, UiStore } from '../contracts/ui';
import { SNAPSHOT_VERSION, type NetClientWorld } from '../net';
import { Autopilot, type BotOptions } from './bot';
import type { CommandResult } from './commands';
import type { GameSession } from './session';

export interface ClientStats {
  fps: number;
  frames: number;
  inputsSent: number;
  rtt: number;
  interpDelayMs: number;
  bytesIn: number;
  bytesOut: number;
  /** Zone entries with the full cut (fade + presenter reset) and seamless resumes after a reconnect. */
  zoneEntries: number;
  zoneResumes: number;
  /** Cosmetic events thrown away while frames stalled, and trimmed by the per-frame budget. */
  eventsDiscarded: number;
  eventsCapped: number;
}

/** What the app lends the hooks (closures over its private state). */
export interface DebugTarget {
  store: UiStore;
  session(): GameSession | null;
  connectionStatus(): ConnectionStatus;
  /** Act as if the network dropped (see GameConnection.simulateDrop). */
  dropConnection(): void;
  getBot(): Autopilot | null;
  setBot(bot: Autopilot | null): void;
  worldToScreen(x: number, y: number): { x: number; y: number } | null;
  stats(): ClientStats;
  /** Observe every parsed server message (before the session handles it). */
  setMessageTap(tap: ((msg: ServerMessage) => void) | null): void;
  /** Rewrite every binary snapshot before the session sees it (null = off). */
  setSnapshotTap(tap: ((data: ArrayBuffer) => ArrayBuffer) | null): void;
}

/**
 * Version skew for skewSnapshots: 'once' = this page only; 'always' = also after the page reloads (a sessionStorage
 * flag re-applies it when the hooks load again), i.e. a reload that does not help.
 */
export type SnapshotSkew = 'off' | 'once' | 'always';
const SKEW_KEY = 'foe.debug.skewSnapshots';

export interface DropEventReport {
  /** 'dropSpawn' / 'pickup' events addressed to the local player. */
  own: number;
  /** Such events of public drops (owner 0: items players dropped on the floor, visible to everyone nearby). */
  public: number;
  /** Such events of another player's instanced loot (instanced loot says: never). */
  foreign: number;
  foreignLabels: string[];
}

export interface FoeDebug {
  store: UiStore;
  readonly world: NetClientWorld | null;
  readonly session: GameSession | null;
  readonly connection: ConnectionStatus;
  send(cmd: Command): Promise<CommandResult>;
  bot: { enable(opts?: Partial<BotOptions>): void; disable(): void; readonly enabled: boolean };
  /** World → CSS pixel position with the current camera (e2e clicks on props). */
  worldToScreen(x: number, y: number): { x: number; y: number } | null;
  stats(): ClientStats;
  /** Simulate a network drop: the client reconnects and the server resumes the character in place. */
  dropConnection(): void;
  /** Drop events received so far, by owner (e2e: instanced loot on the event stream, not only in snapshots). */
  dropEvents(): DropEventReport;
  /** CSS position of a drop in the replica (its sprite, a little above the ground), or null (e2e click pickups). */
  dropOnScreen(dropId: number): { x: number; y: number } | null;
  /**
   * Act like a stale bundle after a deploy: every snapshot arrives with a newer format byte (SNAPSHOT_VERSION + 1),
   * so the replica cannot decode it — the client must reload once and, if that does not help, explain.
   */
  skewSnapshots(mode: SnapshotSkew): void;
}

function readSkew(): SnapshotSkew {
  try {
    return sessionStorage.getItem(SKEW_KEY) === 'always' ? 'always' : 'off';
  } catch {
    return 'off';
  }
}

function writeSkew(mode: SnapshotSkew): void {
  try {
    if (mode === 'always') sessionStorage.setItem(SKEW_KEY, 'always');
    else sessionStorage.removeItem(SKEW_KEY);
  } catch {
    // no storage: 'always' acts like 'once'
  }
}

/** A copy of the snapshot with the next format's version byte. */
function skewed(data: ArrayBuffer): ArrayBuffer {
  const copy = data.slice(0);
  if (copy.byteLength > 0) new Uint8Array(copy)[0] = (SNAPSHOT_VERSION + 1) & 0xff;
  return copy;
}

declare global {
  interface Window {
    __foe?: FoeDebug;
  }
}

export function installDebugHooks(t: DebugTarget): FoeDebug {
  const drops: DropEventReport = { own: 0, public: 0, foreign: 0, foreignLabels: [] };
  t.setMessageTap((msg) => {
    if (msg.t !== 'events') return;
    const local = t.session()?.zone?.localPlayerId;
    if (local === undefined) return;
    for (const e of msg.events) {
      if (e.t !== 'dropSpawn' && e.t !== 'pickup') continue;
      if (e.owner === local) drops.own++;
      else if (e.owner === 0) drops.public++;
      else {
        drops.foreign++;
        if (drops.foreignLabels.length < 20) drops.foreignLabels.push(`${e.t} ${e.label} (owner ${e.owner}, me ${local})`);
      }
    }
  });
  const applySkew = (mode: SnapshotSkew): void => {
    writeSkew(mode);
    t.setSnapshotTap(mode === 'off' ? null : skewed);
  };
  if (readSkew() === 'always') applySkew('always');
  const foe: FoeDebug = {
    store: t.store,
    get world() {
      return t.session()?.world ?? null;
    },
    get session() {
      return t.session();
    },
    get connection() {
      return t.connectionStatus();
    },
    send(cmd) {
      const s = t.session();
      if (!s) return Promise.resolve({ ok: false, error: 'Not in game.' });
      return s.command(cmd, { quiet: true, onOk: () => undefined });
    },
    bot: {
      enable(opts) {
        const bot = t.getBot();
        if (bot) bot.opts = { ...bot.opts, ...opts };
        else t.setBot(new Autopilot(opts));
      },
      disable() {
        t.setBot(null);
      },
      get enabled() {
        return t.getBot() !== null;
      },
    },
    worldToScreen: (x, y) => t.worldToScreen(x, y),
    stats: () => t.stats(),
    dropConnection: () => t.dropConnection(),
    dropEvents: () => ({ ...drops, foreignLabels: [...drops.foreignLabels] }),
    dropOnScreen: (dropId) => {
      const d = t.session()?.world.view.drops.find((q) => q.id === dropId);
      return d ? t.worldToScreen(d.x, d.y - d.z - 4) : null;
    },
    skewSnapshots: (mode) => applySkew(mode),
  };
  window.__foe = foe;
  return foe;
}
