// Client settings (contracts/items.ts Settings): defaults, validation of whatever localStorage returns, and the
// storage keys. Pure apart from the tiny storage wrappers, which never throw (private windows, blocked storage).
import type { Settings } from '../contracts/items';

/** localStorage key of the session token (the only secret the browser keeps). */
export const TOKEN_KEY = 'foe.token';
/** localStorage key of the client settings (JSON). */
export const SETTINGS_KEY = 'foe.settings';

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.85,
  screenShake: 0.7,
  showFps: false,
  autoAttack: false,
});

function unit(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function flag(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Any stored value (possibly garbage from an older build) → a complete, in-range Settings object. */
export function normalizeSettings(raw: unknown): Settings {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    masterVolume: unit(o.masterVolume, DEFAULT_SETTINGS.masterVolume),
    musicVolume: unit(o.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: unit(o.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    screenShake: unit(o.screenShake, DEFAULT_SETTINGS.screenShake),
    showFps: flag(o.showFps, DEFAULT_SETTINGS.showFps),
    autoAttack: flag(o.autoAttack, DEFAULT_SETTINGS.autoAttack),
  };
}

/** Parse the stored JSON (null / malformed → defaults). */
export function parseSettings(json: string | null): Settings {
  if (!json) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(json));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Minimal Storage surface (window.localStorage, or a fake in tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage when it is usable, otherwise null (every accessor below then degrades to "nothing stored"). */
export function browserStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** sessionStorage (per tab, survives reloads) when usable, otherwise null. */
export function tabStorage(): KeyValueStore | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * sessionStorage key: wall-clock ms of the automatic reload that a protocol mismatch (close 4002) or a stream of
 * unreadable snapshots triggered (reload-guard.ts). If the reloaded page fails the same way before it has read the
 * world (a cache served the old bundle), the client explains instead of reloading forever.
 */
export const PROTOCOL_RELOAD_KEY = 'foe.reloadedForProtocol';

/**
 * sessionStorage key with the character id to play again after a reload the client made itself (protocol mismatch,
 * unreadable snapshots, a page restored from the back/forward cache): the next boot goes straight back into it.
 */
export const RESUME_CHARACTER_KEY = 'foe.resumeCharacter';

export function readKey(store: KeyValueStore | null, key: string): string | null {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

export function writeKey(store: KeyValueStore | null, key: string, value: string | null): void {
  if (!store) return;
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    // Quota or privacy mode: settings simply do not persist.
  }
}
