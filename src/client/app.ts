// The browser client: boots art / renderer / audio / presenter / UI, runs the account flow over the HTTP API,
// owns the WebSocket connection and the in-game GameSession, implements the UiStore (contracts/ui.ts), and
// drives everything from one requestAnimationFrame loop:
//
//   input ticks (60 Hz accumulator) → session.inputTick → prediction + wire
//   alpha = world.update(now) → events due at the render tick → presenter.frame(...)
//   HUD (debuffs included) → UiState at ~15 Hz; music by zone / boss, coloured by the map's theme on every zone
//   change (src/audio setMusicTheme); intensity from wave pressure
//
// World clicks (world-pick.ts resolveWorldClick): a ground item under the cursor (Presenter.dropAt) is picked up —
// walking there first when out of reach — before anything else; then open portals (usePortal) and hideout objects
// (map device, stash, merchant, the anvil's Crafting Bench); only a click on none of them is the basic attack.
//
// Lifecycle rules: while the tab is hidden no cosmetic events are queued (and a stalled frame loop discards what
// is due), so coming back never replays a backlog; a page restored from the back/forward cache reloads (its
// socket is gone); a protocol mismatch or a stream of unreadable snapshots (a newer world format after a deploy)
// reloads once and, if that did not help, explains instead of looping (reload-guard.ts); WebGL failures are retried
// on "Try again". A client-initiated reload comes back into the character it was playing. A server update (close
// 4004) shows a calm "Server updating — reconnecting…" screen at once and keeps retrying (connection.ts) until the
// restarted server puts the character back into its party, hideout or restored map — always as a fresh zone entry
// (the restarted server's instance and player ids are new, even when they happen to repeat). Nothing is drawn
// behind the disconnected screen.
import type { ArtBundle } from '../contracts/art';
import type { AudioEngine, MusicId, SfxId } from '../contracts/audio';
import type { Theme } from '../contracts/content';
import type { GameRulesApi } from '../contracts/game';
import type { CharacterSave, Settings } from '../contracts/items';
import type { ServerMessage, TradeInfo, ZoneInfo } from '../contracts/net';
import type { Presenter } from '../contracts/present';
import type { Renderer } from '../contracts/render';
import { SIM_DT } from '../contracts/sim';
import type { SimEvent } from '../contracts/sim';
import type { UiActions, UiState, UiStore } from '../contracts/ui';
import { generateArt } from '../art';
import { createAudio, setMusicTheme } from '../audio';
import { rules as sharedRules, withItemLocks } from '../game';
import { createPresenter, pickInteractiveProp } from '../present';
import { createRenderer } from '../render';
import { mountUi } from '../ui';
import { ApiError, createApi, type ApiClient } from './api';
import type { Autopilot } from './bot';
import { GameConnection, socketUrl, type SocketLike } from './connection';
import type { ClientStats, DebugTarget } from './debug';
import { DomInput } from './dom-input';
import { MAX_FRAME_EVENTS, capEvents } from './event-budget';
import { loadoutKeyLabels, localPlayer } from './hud';
import { approach, intensityFor, musicFor, musicThemeFor } from './music';
import { ReloadGuard } from './reload-guard';
import { GameSession } from './session';
import {
  RESUME_CHARACTER_KEY, SETTINGS_KEY, TOKEN_KEY, browserStorage, parseSettings, readKey, tabStorage, writeKey,
} from './settings';
import {
  clampStashTab, closePanel, dismissToast, initialUiState, leaveGameState, openPanel, togglePanel, withServerUpdating,
  withoutRunSummary,
} from './state';
import { createStateBox, type StateBox } from './store';
import { findDrop } from './autowalk';
import { pickClickableProp, resolveWorldClick, type HoverSnapshot } from './world-pick';

/** Input ticks per frame at most (a long frame never floods the server's input queue). */
const MAX_TICKS_PER_FRAME = 6;
/** Without a rendered frame for this long, a timer keeps the input ticks running (ms). */
const INPUT_WATCHDOG_MS = 50;
/** The HUD reaches the UI at this interval (ms). */
const HUD_INTERVAL_MS = 1000 / 15;
/** A reconnect shorter than this keeps the game on screen with a "Reconnecting" badge (ms). */
const RECONNECT_GRACE_MS = 2500;
/** Zone fade: black hold before revealing the new zone (ms), and the longest wait for its first snapshot. */
const FADE_HOLD_MS = 140;
const FADE_MAX_MS = 1500;
/** No frame for this long (throttled window, GPU hang): cosmetic events that are due get discarded (ms). */
const STALL_DISCARD_MS = 250;
/** Settings reach localStorage this long after the last change (a dragged volume slider writes once). */
const SETTINGS_WRITE_DELAY_MS = 250;

const NO_LOCKS: ReadonlySet<string> = new Set();

type KeyboardLayoutMap = { get(code: string): string | undefined };
type NavigatorWithKeyboard = Navigator & { keyboard?: { getLayoutMap?: () => Promise<KeyboardLayoutMap> } };

/**
 * window.__foe (debug hooks + the autopilot) only in dev builds or builds made with VITE_FOE_DEBUG=1. Both are
 * static at build time, so a production bundle contains neither the hooks nor the bot.
 */
const DEBUG_HOOKS = import.meta.env.DEV || import.meta.env.VITE_FOE_DEBUG === '1';

const GRAPHICS_ERROR =
  'Your browser could not start WebGL2 graphics. Try a current Chrome, Edge or Firefox with hardware acceleration on.';
const STALE_BUNDLE_ERROR =
  'A new version of Forge of Echoes is out, but this page is still the old one. Reload it with Ctrl+Shift+R (⌘+Shift+R on a Mac).';

const IDLE_SAMPLE = Object.freeze({ moveX: 0, moveY: 0, held: 0, flask: -1 });

const UI_SOUNDS: Record<Parameters<UiActions['uiSound']>[0], SfxId> = {
  click: 'uiClick',
  hover: 'uiHover',
  open: 'uiOpen',
  close: 'uiClose',
  error: 'uiError',
  equip: 'equip',
};

export interface ClientElements {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  /** Full-screen black overlay between canvas and UI (zone transitions). */
  fade: HTMLElement;
}

export class ClientApp {
  readonly box: StateBox;
  readonly store: UiStore;
  /**
   * The display rules: the shared rules with your trade offer's items locked, exactly like the server handles
   * commands (src/game/online.ts withItemLocks), so move previews, predictions, bench recipes, craft previews and
   * merchant affordability agree with what the server will allow.
   */
  readonly rules: GameRulesApi;
  private locks: { trade: TradeInfo | null; uids: ReadonlySet<string> } = { trade: null, uids: NO_LOCKS };
  readonly audio: AudioEngine;
  private readonly api: ApiClient;
  private readonly connection: GameConnection;
  private readonly storage = browserStorage();
  private readonly tabStore = tabStorage();
  /** At most one automatic reload until the page has read the world again (no reload loops). */
  private readonly reloadGuard = new ReloadGuard(this.tabStore, () => Date.now());
  private readonly input: DomInput;
  private art: ArtBundle | null = null;
  private renderer: Renderer | null = null;
  private presenter: Presenter | null = null;
  private graphicsFailed = false;
  private loopStarted = false;
  private session: GameSession | null = null;
  /** The e2e autopilot (dev builds only; always null in production). */
  private bot: Autopilot | null = null;
  /** Debug hook: sees every server message first (dev builds only). */
  private messageTap: ((msg: ServerMessage) => void) | null = null;
  /** Debug hook: rewrites binary snapshots before the session sees them (e2e version skew; dev builds only). */
  private snapshotTap: ((data: ArrayBuffer) => ArrayBuffer) | null = null;
  /** The server refused this page's protocol again right after the automatic reload: it is an old bundle. */
  private staleBundle = false;
  private token: string | null;
  /** Character we are playing (connected or reconnecting). */
  private playing: string | null = null;
  /** The session reached the game once (a failure before that belongs on the character screen). */
  private reachedGame = false;
  private reconnectingSince = 0;
  private unmountUi: (() => void) | null = null;
  private raf = 0;
  private last = 0;
  private lastInput = 0;
  private acc = 0;
  private watchdog = 0;
  private lastHud = 0;
  private alpha = 1;
  private readonly events: SimEvent[] = [];
  private readonly cursorWorld = { x: 0, y: 0 };
  /** Clickable prop (hideout object or open portal) and ground item under the cursor in the last drawn frame. */
  private readonly hover: HoverSnapshot = { x: -1, y: -1, dropId: -1, propId: -1 };
  private cursorStyle = '';
  /** Between a reconnect's 'welcome' and its 'zone': the disconnected screen keeps saying "reconnecting". */
  private awaitingZone = false;
  private settingsTimer = 0;
  /** Loadout keycap labels from the keyboard layout (null = the default Q E R F). */
  private keyLabels: readonly string[] | null = null;
  private music: MusicId | null | undefined = undefined;
  /** The map theme colouring the 'map' / 'boss' music (undefined = never set). */
  private musicTheme: Theme | null | undefined = undefined;
  private intensity = 0;
  private fadeSince = 0;
  private fading = false;
  /** Resumed the same instance after a reconnect: keep the last picture until the local player is back. */
  private holding = false;
  private holdSince = 0;
  private zoneEntries = 0;
  private zoneResumes = 0;
  private eventsDiscarded = 0;
  private eventsCapped = 0;
  private fps = 60;
  private fpsFrames = 0;
  private fpsTime = 0;
  private frames = 0;
  private inputsSent = 0;
  private unlocked = false;

  constructor(private readonly el: ClientElements) {
    const settings = parseSettings(readKey(this.storage, SETTINGS_KEY));
    this.box = createStateBox(initialUiState(settings));
    this.rules = withItemLocks(sharedRules, (ch) => this.tradeLocks(ch));
    this.token = readKey(this.storage, TOKEN_KEY);
    this.api = createApi(() => this.token);
    this.audio = createAudio();
    this.applyVolumes(settings);
    this.connection = new GameConnection(
      {
        message: (msg) => {
          this.messageTap?.(msg);
          this.box.batch(() => this.session?.handle(msg));
        },
        snapshot: (data, at) => this.session?.snapshot(this.snapshotTap ? this.snapshotTap(data) : data, at),
        status: (s) => this.onConnectionStatus(s),
        rtt: (ms) => this.session?.setRtt(ms),
        // During a server update (a 4004 in this streak) nothing can be resumed in place: see connectionOpened.
        opened: () => this.session?.connectionOpened(!this.connection.updating),
        ended: (action, reason) => this.onConnectionEnded(action, reason),
        dropped: (_code, _reason, updating) => this.onConnectionDropped(updating),
        malformed: (error) => console.warn('[foe] ignored a malformed server message:', error),
      },
      {
        createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
        now: () => performance.now(),
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (h) => window.clearTimeout(h as number),
        setInterval: (fn, ms) => window.setInterval(fn, ms),
        clearInterval: (h) => window.clearInterval(h as number),
        random: () => Math.random(),
      },
    );
    this.store = {
      get: () => this.box.get(),
      subscribe: (l) => this.box.subscribe(l),
      actions: this.createActions(),
      rules: this.rules,
      art: {
        icon: (id, size) => (this.art ? this.art.icon(id, size) : ''),
        portrait: (size) => (this.art ? this.art.portrait(size) : ''),
      },
    };
    this.input = new DomInput(el.canvas, {
      chatOpen: () => this.box.get().chatOpen,
      active: () => !!this.session?.zone && this.box.get().screen === 'game',
      worldClick: (x, y) => this.worldClick(x, y),
      worldRightClick: () => {
        if (!this.box.get().armed) return false;
        this.session?.disarm();
        return true;
      },
      setAlt: (held) => this.box.update((s) => (s.altHeld === held ? s : { ...s, altHeld: held })),
      toggleAutoAttack: () => {
        const on = !this.box.get().settings.autoAttack;
        this.updateSettings({ autoAttack: on });
        this.session?.toast(on ? 'Auto-attack on (T)' : 'Auto-attack off (T)', 'info');
        this.audio.play('uiClick');
      },
      gesture: () => this.unlockAudio(),
      released: () => this.sendIdleNow(),
    });
  }

  private get state(): UiState {
    return this.box.get();
  }

  /** The uids of your current trade offer (locked while the trade is open), for the display rules. */
  private tradeLocks(ch: CharacterSave): ReadonlySet<string> | null {
    const s = this.box.get();
    const trade = s.trade;
    if (!trade || trade.yourItems.length === 0) return null;
    if (s.character && ch.id !== s.character.id) return null;
    if (this.locks.trade !== trade) this.locks = { trade, uids: new Set(trade.yourItems.map((i) => i.uid)) };
    return this.locks.uids;
  }

  // ===========================================================================================
  // Boot
  // ===========================================================================================

  async start(): Promise<void> {
    this.unmountUi = mountUi(this.el.uiRoot, this.store);
    if (DEBUG_HOOKS) {
      // The dynamic import sits inside the statically-false branch of production builds, so the debug module and
      // the bot are not even emitted as chunks there.
      void import('./debug')
        .then(({ installDebugHooks }) => installDebugHooks(this.debugTarget()))
        .catch((err: unknown) => console.error('[foe] debug hooks failed to load', err));
    }
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.loadKeyLabels();
    // Let the loading screen paint before the (synchronous) art generation.
    await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    if (!this.initGraphics()) return;
    await this.refreshAccount();
  }

  /**
   * Art, renderer and presenter, then the frame loop. False (with the error screen up) when WebGL2 is unavailable;
   * "Try again" and "Play" call it again, so a browser that gets its GPU back does not need a page reload.
   */
  private initGraphics(): boolean {
    if (this.presenter) return true;
    try {
      this.art ??= generateArt();
      this.renderer ??= createRenderer(this.el.canvas);
      this.onResize();
      this.presenter = createPresenter(this.renderer, this.art, this.audio);
    } catch (err) {
      console.error('[foe] graphics failed to start', err);
      this.graphicsFailed = true;
      this.box.update((s) => ({ ...s, screen: 'disconnected', connection: 'offline', busy: false, error: GRAPHICS_ERROR }));
      return false;
    }
    this.graphicsFailed = false;
    if (!this.loopStarted) {
      this.loopStarted = true;
      this.last = performance.now();
      this.lastInput = this.last;
      this.raf = requestAnimationFrame(this.frame);
      this.watchdog = window.setInterval(this.inputWatchdog, INPUT_WATCHDOG_MS / 2);
    }
    return true;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.watchdog);
    this.flushSettings();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.connection.close('dispose');
    this.input.dispose();
    this.unmountUi?.();
    this.renderer?.dispose();
    this.audio.dispose();
  }

  private readonly onResize = (): void => {
    this.renderer?.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  };

  private readonly onPageHide = (): void => {
    this.flushSettings();
    this.connection.close('page closed');
  };

  /** Restored from the back/forward cache: the socket was closed on pagehide and the game state is stale. */
  private readonly onPageShow = (e: PageTransitionEvent): void => {
    if (e.persisted) this.reloadIntoGame();
  };

  /** Reload the page and come back into the character being played (the next boot resumes it). */
  private reloadIntoGame(): void {
    if (this.playing) writeKey(this.tabStore, RESUME_CHARACTER_KEY, this.playing);
    location.reload();
  }

  /**
   * Keycaps for the loadout from the keyboard layout (Chromium): input uses physical key positions, so on AZERTY
   * the "Q" slot is the key labelled A and the HUD should say so.
   */
  private loadKeyLabels(): void {
    const kb = (navigator as NavigatorWithKeyboard).keyboard;
    if (!kb?.getLayoutMap) return;
    kb.getLayoutMap().then(
      (layout) => {
        this.keyLabels = loadoutKeyLabels(layout);
        if (this.session) this.session.keyLabels = this.keyLabels;
      },
      () => undefined,
    );
  }

  /** Hidden tabs draw nothing: stop queueing cosmetic events there (see GameSession.setEventsSuspended). */
  private readonly onVisibility = (): void => {
    this.session?.setEventsSuspended(document.hidden);
  };

  private unlockAudio(): void {
    if (this.unlocked) return;
    this.audio.unlock().then(
      () => (this.unlocked = this.audio.unlocked),
      () => undefined,
    );
  }

  private applyVolumes(s: Settings): void {
    this.audio.setVolumes({ master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume });
  }

  private updateSettings(patch: Partial<Settings>): void {
    const settings = { ...this.state.settings, ...patch };
    this.box.update((s) => ({ ...s, settings }));
    this.applyVolumes(settings);
    // A dragged slider changes the settings every few pixels: write once it rests.
    window.clearTimeout(this.settingsTimer);
    this.settingsTimer = window.setTimeout(() => this.flushSettings(), SETTINGS_WRITE_DELAY_MS);
  }

  private flushSettings(): void {
    if (!this.settingsTimer) return;
    window.clearTimeout(this.settingsTimer);
    this.settingsTimer = 0;
    writeKey(this.storage, SETTINGS_KEY, JSON.stringify(this.state.settings));
  }

  private setToken(token: string | null): void {
    this.token = token;
    writeKey(this.storage, TOKEN_KEY, token);
  }

  // ===========================================================================================
  // Account flow
  // ===========================================================================================

  /** Token → /api/me → character select; no/invalid token → login; server down → disconnected with retry. */
  private async refreshAccount(): Promise<void> {
    if (!this.token) {
      this.box.update((s) => ({ ...s, screen: 'auth', busy: false }));
      return;
    }
    this.box.update((s) => ({ ...s, busy: true }));
    try {
      const me = await this.api.me();
      this.box.update((s) => ({ ...s, screen: 'characters', account: me.account, characters: me.characters, busy: false, error: null, connection: 'offline' }));
      // Back from a reload the client itself made (a new protocol, back/forward cache): straight into the game.
      const resume = readKey(this.tabStore, RESUME_CHARACTER_KEY);
      if (resume) {
        writeKey(this.tabStore, RESUME_CHARACTER_KEY, null);
        if (!this.session && me.characters.some((c) => c.id === resume)) this.playCharacter(resume);
      }
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(0, String(err));
      if (e.unauthorized) {
        this.setToken(null);
        this.box.update((s) => ({ ...s, screen: 'auth', busy: false, account: null, characters: [] }));
      } else {
        this.box.update((s) => ({ ...s, screen: 'disconnected', connection: 'offline', busy: false, error: e.message }));
      }
    }
  }

  private async authenticate(kind: 'login' | 'register', username: string, password: string): Promise<void> {
    if (this.state.busy) return;
    this.box.update((s) => ({ ...s, busy: true, error: null }));
    try {
      const auth = kind === 'login' ? await this.api.login(username, password) : await this.api.register(username, password);
      this.setToken(auth.token);
      const me = await this.api.me();
      this.box.update((s) => ({ ...s, screen: 'characters', account: me.account, characters: me.characters, busy: false, error: null }));
      this.audio.play('uiOpen');
    } catch (err) {
      this.box.update((s) => ({ ...s, busy: false, error: err instanceof Error ? err.message : String(err) }));
      this.audio.play('uiError');
    }
  }

  private async createCharacter(name: string): Promise<void> {
    if (this.state.busy) return;
    this.box.update((s) => ({ ...s, busy: true, error: null }));
    try {
      const c = await this.api.createCharacter(name);
      this.box.update((s) => ({ ...s, busy: false, characters: [...s.characters.filter((x) => x.id !== c.id), c] }));
      this.audio.play('levelUp');
    } catch (err) {
      this.handleAccountError(err);
    }
  }

  private async deleteCharacter(id: string): Promise<void> {
    if (this.state.busy) return;
    this.box.update((s) => ({ ...s, busy: true, error: null }));
    try {
      await this.api.deleteCharacter(id);
      this.box.update((s) => ({ ...s, busy: false, characters: s.characters.filter((c) => c.id !== id) }));
    } catch (err) {
      this.handleAccountError(err);
    }
  }

  private handleAccountError(err: unknown): void {
    if (err instanceof ApiError && err.unauthorized) {
      this.setToken(null);
      this.box.update((s) => ({ ...s, screen: 'auth', busy: false, account: null, characters: [], error: err.message }));
      return;
    }
    this.box.update((s) => ({ ...s, busy: false, error: err instanceof Error ? err.message : String(err) }));
    this.audio.play('uiError');
  }

  private async logout(): Promise<void> {
    writeKey(this.tabStore, RESUME_CHARACTER_KEY, null);
    this.endGame();
    const had = this.token;
    this.setToken(null);
    this.box.update((s) => ({ ...s, screen: 'auth', account: null, characters: [], busy: false, error: null, connection: 'offline' }));
    if (had) {
      // Best effort: the server revokes the token; the client already forgot it.
      const api = createApi(() => had);
      api.logout().catch(() => undefined);
    }
  }

  // ===========================================================================================
  // Game session & connection
  // ===========================================================================================

  private playCharacter(id: string): void {
    if (!this.token) {
      this.box.update((s) => ({ ...s, screen: 'auth' }));
      return;
    }
    if (this.state.busy && this.playing === id) return;
    if (!this.initGraphics()) return;
    this.endGame();
    this.playing = id;
    this.reachedGame = false;
    this.bot?.reset();
    this.awaitingZone = false;
    this.session = new GameSession({
      box: this.box,
      rules: this.rules,
      send: (m) => {
        const ok = this.connection.send(m);
        if (ok && m.t === 'input') this.inputsSent++;
        return ok;
      },
      now: () => performance.now(),
      wallNow: () => Date.now(),
      sound: (sfx) => this.audio.play(sfx),
      zoneEntered: (zone, resumed) => this.onZoneEntered(zone, resumed),
    });
    this.session.setEventsSuspended(document.hidden);
    this.session.keyLabels = this.keyLabels;
    this.box.update((s) => ({ ...leaveGameState(s), busy: true, error: null }));
    this.connection.connect(socketUrl(location, this.token, id));
  }

  /** Leave the game (socket closed on purpose); UI state back to out-of-game. */
  private endGame(): void {
    this.connection.close('leaving');
    this.session?.dispose();
    this.session = null;
    this.playing = null;
    this.reachedGame = false;
    this.reconnectingSince = 0;
    this.awaitingZone = false;
    this.input.releaseAll();
    this.applyMusicTheme(null);
    // The last world frame stays on the canvas: cover it until the next zone fades in.
    this.fading = false;
    this.el.fade.classList.add('foe-fade--on');
    this.box.update((s) => leaveGameState(s));
  }

  /** Colour the map / boss music for a map base (src/audio setMusicTheme); null = the plain forge tracks. */
  private applyMusicTheme(theme: Theme | null): void {
    if (theme === this.musicTheme) return;
    this.musicTheme = theme;
    setMusicTheme(this.audio, theme);
  }

  private toCharacterSelect(): void {
    writeKey(this.tabStore, RESUME_CHARACTER_KEY, null);
    this.endGame();
    this.box.update((s) => ({ ...s, screen: 'characters', connection: 'offline', error: null }));
    void this.refreshAccount();
  }

  private retryConnection(): void {
    if (this.staleBundle) {
      // Only a fresh bundle helps; if the cache serves the old one again, the same explanation comes back.
      location.reload();
      return;
    }
    if (this.graphicsFailed) {
      if (!this.initGraphics()) return;
      if (!this.session) {
        void this.refreshAccount();
        return;
      }
    }
    if (this.playing && this.token && this.session) {
      this.box.update((s) => ({ ...s, connection: 'connecting', error: null }));
      this.connection.connect(socketUrl(location, this.token, this.playing));
      return;
    }
    void this.refreshAccount();
  }

  private onConnectionStatus(status: UiState['connection']): void {
    if (status === 'reconnecting') {
      this.session?.connectionLost();
      this.input.releaseAll();
      // A server update refuses logins with 4004 while it drains: keep trying (onConnectionDropped explains).
      if (!this.reachedGame && !this.connection.updating) {
        // Never got in: say so on the character screen instead of retrying behind a spinner.
        this.connection.close('failed');
        this.session?.dispose();
        this.session = null;
        this.playing = null;
        this.box.update((s) => ({ ...s, busy: false, connection: 'offline', error: 'Could not reach the game server. Please try again.' }));
        return;
      }
      if (this.reconnectingSince === 0) this.reconnectingSince = performance.now();
    }
    if (status === 'online') {
      this.reachedGame = true;
      this.reconnectingSince = 0;
      // The reload guard stays armed: snapshots this bundle cannot read only fail after the welcome (step() releases
      // it once the world has been read).
      // Back after a drop that put up the disconnected screen: it keeps saying "reconnecting" until the zone
      // arrives right behind the welcome (not "Connection lost" for the moment in between).
      if (this.state.screen === 'disconnected') {
        this.awaitingZone = true;
        this.box.update((s) => (s.connection === 'connecting' ? s : { ...s, connection: 'connecting' }));
        return;
      }
    }
    this.awaitingZone = false;
    this.box.update((s) => (s.connection === status ? s : { ...s, connection: status }));
  }

  /**
   * A socket closed and a reconnect is scheduled. A server update (4004) is not a broken link: show the calm
   * "Server updating — reconnecting…" screen at once (a restart takes seconds, the grace period is for blips).
   */
  private onConnectionDropped(updating: boolean): void {
    if (!updating || !this.session) return;
    this.box.update(withServerUpdating);
  }

  private onConnectionEnded(action: 'auth' | 'reload' | 'replaced' | 'fatal', reason: string): void {
    this.session?.connectionLost();
    this.input.releaseAll();
    this.reconnectingSince = 0;
    if (action === 'reload') {
      if (this.reloadGuard.request()) {
        this.reloadIntoGame();
        return;
      }
      // Reloaded once already and still refused (or unreadable): a cache keeps serving the old bundle. Explain instead
      // of looping; the hard reload the text asks for comes straight back into this character.
      if (this.playing) writeKey(this.tabStore, RESUME_CHARACTER_KEY, this.playing);
      this.staleBundle = true;
      this.endGame();
      this.box.update((s) => ({ ...s, screen: 'disconnected', connection: 'offline', busy: false, error: STALE_BUNDLE_ERROR }));
      return;
    }
    if (action === 'auth') {
      this.endGame();
      this.setToken(null);
      this.box.update((s) => ({
        ...s, screen: 'auth', account: null, characters: [], busy: false, error: reason || 'Your session has expired. Please log in again.',
      }));
      return;
    }
    const text =
      action === 'replaced'
        ? 'This character was logged in from another window or device.'
        : reason || 'The server closed the connection.';
    if (!this.reachedGame) {
      this.session?.dispose();
      this.session = null;
      this.playing = null;
      this.box.update((s) => ({ ...s, screen: 'characters', busy: false, connection: 'offline', error: text }));
      return;
    }
    // The session stays: "Try again" reconnects as this character (taking it back from the other window).
    this.box.update((s) => ({ ...leaveGameState(s), screen: 'disconnected', connection: 'offline', busy: false, error: text }));
  }

  private onZoneEntered(zone: ZoneInfo, resumed: boolean): void {
    this.reachedGame = true;
    this.reconnectingSince = 0;
    // Before the frame loop switches the track: the map music starts in the new map's colour.
    this.applyMusicTheme(musicThemeFor(zone));
    if (this.awaitingZone) {
      this.awaitingZone = false;
      const status = this.connection.status;
      this.box.update((s) => (s.connection === status ? s : { ...s, connection: status }));
    }
    if (resumed) {
      // Back in the same instance after a short drop: no cut to black, no presenter reset (corpses, particles and
      // the camera stay). The replica restarts empty, so the last picture is held until the first snapshot.
      this.zoneResumes++;
      this.holding = true;
      this.holdSince = performance.now();
      return;
    }
    this.zoneEntries++;
    this.holding = false;
    if (this.presenter && this.session) this.presenter.reset(this.session.world.view, zone.localPlayerId);
    this.bot?.reset();
    this.hover.dropId = -1;
    this.hover.propId = -1;
    this.fading = true;
    this.fadeSince = performance.now();
    this.el.fade.classList.add('foe-fade--on');
  }

  // ===========================================================================================
  // World interaction
  // ===========================================================================================

  /**
   * A left click on the world (true = consumed: no basic attack until the button is released). Priority: a ground
   * item under the cursor (picked up, walking there first when out of reach), then an open portal (usePortal), then
   * a hideout object (its panel). Anything else is an attack — and ends a walk to an item. The decision is
   * world-pick.ts resolveWorldClick (the last frame's highlight counts only for a click near where it was shown).
   */
  private worldClick(x: number, y: number): boolean {
    const session = this.session;
    const zone = session?.zone;
    const renderer = this.renderer;
    const presenter = this.presenter;
    if (!session || !zone || !renderer || !presenter) return false;
    const view = session.world.view;
    const click = resolveWorldClick({
      x,
      y,
      zone: zone.kind,
      props: view.props,
      // The presenter answers from the last drawn frame's label layout: exactly the plate the player sees.
      dropAt: presenter.dropAt(x, y),
      hover: this.hover,
      hasDrop: (id) => findDrop(view.drops, id) !== null,
      propAt: () => {
        const w = renderer.screenToWorld(x, y, presenter.camera);
        return pickClickableProp(view.props, w.x, w.y, zone.kind, pickInteractiveProp);
      },
    });
    if (click.kind === 'pickup' && session.clickDrop(click.dropId)) return true;
    session.cancelWalk();
    if (click.kind === 'portal') {
      session.usePortal(click.propId);
      return true;
    }
    if (click.kind === 'panel') {
      this.audio.play('uiOpen');
      this.box.update((s) => openPanel(s, click.panel));
      return true;
    }
    return false;
  }

  // ===========================================================================================
  // Frame loop
  // ===========================================================================================

  private readonly frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    try {
      // performance.now(), not the rAF timestamp: snapshots are stamped with it on arrival, and the rAF time (the
      // frame's vsync) can be older than a snapshot handled earlier in this same frame.
      this.step(performance.now());
    } catch (err) {
      // One bad frame must not kill the loop; log it (the e2e test fails on console errors).
      console.error('[foe] frame failed', err);
    }
  };

  /**
   * Run the 60 Hz input ticks due by `now`. Called from every frame and, while frames stall (GPU hiccup, shader
   * compilation, a heavy UI render), from the input watchdog, so the server keeps getting a steady input stream.
   */
  private pumpInput(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.lastInput) / 1000));
    this.lastInput = now;
    const s = this.state;
    const session = this.session;
    if (!session?.zone || !this.connection.isOpen || s.screen !== 'game') {
      this.acc = 0;
      return;
    }
    this.acc += dt;
    let n = 0;
    const opts = { blocked: s.paused, autoAttack: s.settings.autoAttack, bot: this.bot, alpha: this.alpha };
    while (this.acc >= SIM_DT && n < MAX_TICKS_PER_FRAME) {
      session.inputTick(this.input.state.sample(), this.cursorWorld, opts);
      this.acc -= SIM_DT;
      n++;
    }
    if (n === MAX_TICKS_PER_FRAME) this.acc = 0;
  }

  private readonly inputWatchdog = (): void => {
    const now = performance.now();
    if (now - this.last <= INPUT_WATCHDOG_MS) return;
    this.pumpInput(now);
    // Frames stalled for real (throttled window, GPU hang): drop the cosmetic events that are due so the next
    // frame does not play them all at once.
    if (now - this.last > STALL_DISCARD_MS && this.session) this.eventsDiscarded += this.session.discardDueEvents();
  };

  private step(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.frames++;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.input.poll();
    const s = this.state;
    const session = this.session;

    if (s.screen === 'game' && this.connection.status === 'reconnecting' && this.reconnectingSince > 0 && now - this.reconnectingSince > RECONNECT_GRACE_MS) {
      this.box.update((st) => ({ ...st, screen: 'disconnected' }));
    }

    if (session) {
      session.tick(now);
      // This bundle reads the server's world: a later mismatch (the next deploy) may reload automatically again.
      if (this.reloadGuard.armed && session.worldReadable) this.reloadGuard.confirm();
    }
    const zone = session?.zone ?? null;
    const renderer = this.renderer;
    const presenter = this.presenter;
    // Only the game screen shows the world (the short-drop grace keeps it, with the "Reconnecting" badge). The
    // disconnected screen is opaque: drawing behind it for minutes of update retries would only burn GPU and battery.
    // An in-place resume still finds its last picture on the canvas.
    const drawing = s.screen === 'game';
    if (session && zone && renderer && presenter && drawing) {
      const view = session.world.view;
      const cw = renderer.screenToWorld(this.input.cursorX, this.input.cursorY, presenter.camera);
      this.cursorWorld.x = cw.x;
      this.cursorWorld.y = cw.y;

      // 1. Input ticks at 60 Hz (before the world update, so prediction includes this frame's input).
      this.pumpInput(now);

      // 2. Interpolation clock.
      this.alpha = session.world.update(now);

      // After a resume the replica is empty until its first snapshot: keep showing the last frame meanwhile.
      if (this.holding && (!!localPlayer(view, zone.localPlayerId) || now - this.holdSince > FADE_MAX_MS)) this.holding = false;

      if (!this.holding) {
        // 3. The cosmetic events due at the render tick (the local player's own at once), within the frame budget.
        session.drainEvents(this.events);
        if (this.events.length > MAX_FRAME_EVENTS) {
          const before = this.events.length;
          capEvents(this.events, MAX_FRAME_EVENTS, zone.localPlayerId);
          this.eventsCapped += before - this.events.length;
        }

        // 4. Hover (never through the UI): a ground item's label first (it also wins the click), else a clickable
        //    prop (hideout objects, open portals). Both get the presenter's highlight and the hand cursor. The item
        //    being walked to stays highlighted.
        const overWorld = !this.input.overUi;
        const hoverDrop = overWorld ? presenter.dropAt(this.input.cursorX, this.input.cursorY) : -1;
        const hover = overWorld && hoverDrop < 0 ? pickClickableProp(view.props, cw.x, cw.y, zone.kind, pickInteractiveProp) : -1;
        this.hover.dropId = hoverDrop;
        this.hover.propId = hover;
        this.hover.x = this.input.cursorX;
        this.hover.y = this.input.cursorY;
        this.setCursor(hoverDrop >= 0 || hover >= 0 ? 'pointer' : '');

        presenter.frame({
          world: view,
          localPlayerId: zone.localPlayerId,
          alpha: this.alpha,
          dt,
          events: this.events,
          cursorWorld: this.cursorWorld,
          hoverPropId: hover,
          hoverDropId: hoverDrop >= 0 ? hoverDrop : session.walk.dropId,
          settings: { screenShake: s.settings.screenShake },
          paused: s.paused,
        });
        this.events.length = 0;
      }

      // 5. Zone fade-in once the local player is on screen.
      if (this.fading) {
        const present = !!localPlayer(view, zone.localPlayerId);
        if ((present && now - this.fadeSince > FADE_HOLD_MS) || now - this.fadeSince > FADE_MAX_MS) {
          this.fading = false;
          this.el.fade.classList.remove('foe-fade--on');
        }
      }

      // 6. HUD at ~15 Hz.
      if (now - this.lastHud >= HUD_INTERVAL_MS) {
        this.lastHud = now;
        // Null until the local player is replicated: the provisional HUD from the zone change stays meanwhile.
        const hud = session.hud(now, this.fps, this.input.overUi || this.hover.dropId >= 0 || this.holding ? null : this.cursorWorld, this.alpha);
        if (hud) this.box.update((st) => ({ ...st, hud }));
      }
    }

    // Music follows the screen / zone / boss (a reconnect keeps the zone's track); energy follows wave pressure.
    const inWorld = s.screen === 'game' || (s.screen === 'disconnected' && s.connection !== 'offline');
    const runView = session && zone?.kind === 'map' ? session.world.view.run : null;
    const track = musicFor(inWorld && session?.zone ? 'game' : s.screen, zone?.kind ?? null, runView);
    if (track !== this.music) {
      this.music = track;
      this.audio.setMusic(track);
    }
    const next = approach(this.intensity, intensityFor(zone?.kind ?? null, runView), 0.35, dt);
    if (next !== this.intensity) {
      this.intensity = next;
      this.audio.setIntensity(next);
    }
  }

  /**
   * Put an idle input on the wire at once. Used when focus leaves the page: requestAnimationFrame stops in a
   * hidden tab, and the server would otherwise keep repeating the last held skill until we come back.
   */
  private sendIdleNow(): void {
    const session = this.session;
    if (!session?.zone || !this.connection.isOpen) return;
    session.inputTick(IDLE_SAMPLE, this.cursorWorld, { blocked: true, autoAttack: false, bot: null, alpha: this.alpha });
  }

  private setCursor(kind: string): void {
    if (kind === this.cursorStyle) return;
    this.cursorStyle = kind;
    this.el.canvas.classList.toggle('foe-world--pointer', kind === 'pointer');
  }

  // ===========================================================================================
  // UiActions
  // ===========================================================================================

  private createActions(): UiActions {
    const inGame = <T>(fn: (s: GameSession) => T, fallback: T): T => (this.session ? fn(this.session) : fallback);
    return {
      register: (u, p) => void this.authenticate('register', u, p),
      login: (u, p) => void this.authenticate('login', u, p),
      logout: () => void this.logout(),
      createCharacter: (name) => void this.createCharacter(name),
      playCharacter: (id) => this.playCharacter(id),
      deleteCharacter: (id) => void this.deleteCharacter(id),
      toCharacterSelect: () => this.toCharacterSelect(),
      retryConnection: () => this.retryConnection(),

      togglePanel: (p) => this.box.update((s) => togglePanel(s, p)),
      openPanel: (p) => this.box.update((s) => openPanel(s, p)),
      closePanel: (p) => this.box.update((s) => closePanel(s, p)),
      closeAllPanels: () => this.box.update((s) => (s.openPanels.length ? { ...s, openPanels: [] } : s)),
      setStashTab: (tab) =>
        this.box.update((s) => {
          // A special tab, or a normal tab the displayed character has (addStashTab shows the new tab at once).
          const next = clampStashTab(tab, s.character ? s.character.stash.length : Number.MAX_SAFE_INTEGER);
          return s.stashTab === next ? s : { ...s, stashTab: next };
        }),
      depositAllCurrency: () => inGame((g) => g.depositAllCurrency(), undefined),

      moveItem: (uid, to, count) => inGame((g) => g.moveItem(uid, to, count), false),
      quickMove: (uid, count) => inGame((g) => g.quickMove(uid, count), undefined),
      discardItem: (uid) => inGame((g) => g.discardItem(uid), undefined),
      armCurrency: (uid) => inGame((g) => g.armCurrency(uid), undefined),
      disarm: () => inGame((g) => g.disarm(), undefined),
      applyArmed: (uid) => inGame((g) => g.applyArmed(uid), undefined),
      chooseAffix: (i) => inGame((g) => g.chooseAffix(i), undefined),
      cancelAffixChoice: () => inGame((g) => g.cancelAffixChoice(), undefined),
      addStashTab: () => inGame((g) => g.addStashTab(), undefined),
      renameStashTab: (tab, name) => inGame((g) => g.renameStashTab(tab, name), undefined),
      clearNewFlags: () => inGame((g) => g.clearNewFlags(), undefined),
      dropItem: (uid) => inGame((g) => g.dropItem(uid), undefined),

      setBenchItem: (uid) => this.box.update((s) => (s.benchItemUid === uid ? s : { ...s, benchItemUid: uid })),
      benchCraft: (recipeId) => inGame((g) => g.benchCraft(recipeId), undefined),
      benchClear: () => inGame((g) => g.benchClear(), undefined),

      tradeRequest: (name) => inGame((g) => g.tradeRequest(name), undefined),
      tradeRespond: (id, accept) => inGame((g) => g.tradeRespond(id, accept), undefined),
      tradeOffer: (uids) => inGame((g) => g.tradeOffer(uids), undefined),
      tradeAccept: (accept) => inGame((g) => g.tradeAccept(accept), undefined),
      tradeCancel: () => inGame((g) => g.tradeCancel(), undefined),

      allocateAttribute: (attr) => inGame((g) => g.allocateAttribute(attr), undefined),
      rankUpSkill: (id) => inGame((g) => g.rankUpSkill(id), undefined),
      setLoadoutSlot: (slot, id) => inGame((g) => g.setLoadoutSlot(slot, id), undefined),

      activateMapDevice: () => inGame((g) => g.activateMapDevice(), undefined),
      merchantOffers: () => inGame((g) => g.merchantOffers(), []),
      buyOffer: (id) => inGame((g) => g.buyOffer(id), undefined),

      partyInvite: (name) => inGame((g) => g.partyInvite(name), undefined),
      partyRespond: (id, accept) => inGame((g) => g.partyRespond(id, accept), undefined),
      partyLeave: () => inGame((g) => g.partyLeave(), undefined),
      partyKick: (id) => inGame((g) => g.partyKick(id), undefined),
      partyPromote: (id) => inGame((g) => g.partyPromote(id), undefined),
      visitHideout: (id) => inGame((g) => g.visitHideout(id), undefined),
      goHome: () => inGame((g) => g.goHome(), undefined),
      setChatOpen: (open) => this.box.update((s) => (s.chatOpen === open ? s : { ...s, chatOpen: open })),
      sendChat: (text, channel) => inGame((g) => g.sendChat(text, channel), undefined),

      leaveMap: () => inGame((g) => g.leaveMap(), undefined),
      respawn: () => inGame((g) => g.respawn(), undefined),
      dismissRunSummary: () => this.box.update((s) => (s.runSummary ? withoutRunSummary(s) : s)),

      setPaused: (paused) => {
        if (paused) this.input.state.clear();
        this.box.update((s) => (s.paused === paused ? s : { ...s, paused }));
      },
      updateSettings: (patch) => this.updateSettings(patch),
      dismissToast: (id) => this.box.update((s) => dismissToast(s, id)),
      uiSound: (id) => this.audio.play(UI_SOUNDS[id] ?? 'uiClick'),
    };
  }

  // ===========================================================================================
  // Debug / e2e hooks
  // ===========================================================================================

  /** What window.__foe may touch (e2e runs and screenshots; dev builds only, see DEBUG_HOOKS). */
  private debugTarget(): DebugTarget {
    return {
      store: this.store,
      session: () => this.session,
      connectionStatus: () => this.connection.status,
      dropConnection: () => this.connection.simulateDrop(),
      getBot: () => this.bot,
      setBot: (bot) => {
        this.bot = bot;
      },
      worldToScreen: (x, y) => (this.renderer && this.presenter ? this.renderer.worldToScreen(x, y, this.presenter.camera) : null),
      stats: () => this.stats(),
      setMessageTap: (tap) => {
        this.messageTap = tap;
      },
      setSnapshotTap: (tap) => {
        this.snapshotTap = tap;
      },
    };
  }

  private stats(): ClientStats {
    const w = this.session?.world;
    return {
      fps: this.fps,
      frames: this.frames,
      inputsSent: this.inputsSent,
      rtt: this.session?.rttMs ?? 0,
      interpDelayMs: w ? w.interpDelayMs : 0,
      bytesIn: this.connection.bytesIn,
      bytesOut: this.connection.bytesOut,
      zoneEntries: this.zoneEntries,
      zoneResumes: this.zoneResumes,
      eventsDiscarded: this.eventsDiscarded,
      eventsCapped: this.eventsCapped,
    };
  }
}
