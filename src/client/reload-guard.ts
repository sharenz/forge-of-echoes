// The automatic-reload guard. After a deploy, a tab still running the old bundle is fixed by one reload (index.html
// is served no-cache): the server refused its protocol (close 4002), or its world snapshots could not be decoded
// MAX_SNAPSHOT_FAILURES times in a row (a newer snapshot format under the same protocol version). When a reload
// does not help (a cache keeps serving the old bundle, a server-side encoding bug), reloading again would loop
// forever — and resuming the character after each reload would trap the player in it. So a tab reloads by itself
// at most once until it has shown that it can read the world again; a failure before that explains instead.
//
// State: sessionStorage (per tab, survives reloads) PROTOCOL_RELOAD_KEY = wall-clock ms of the last automatic
// reload. confirm() clears it once the page has read the world cleanly for a while (the next deploy may reload
// again). A mark older than RELOAD_GUARD_TTL_MS no longer counts: the reloaded page never got back into the game
// (character select), and a much later deploy must still be able to reload it. Storage that cannot keep the mark
// (blocked, private mode) means no automatic reload at all: without the mark nothing could stop a loop.
import { PROTOCOL_RELOAD_KEY, readKey, writeKey, type KeyValueStore } from './settings';

/** A reload mark counts for this long (ms) unless the page confirms a readable world first. */
export const RELOAD_GUARD_TTL_MS = 10 * 60_000;
/** Marks below this are not timestamps: an older bundle stored '1' right before the reload that loaded this one. */
const LEGACY_MARK_MAX = 1e12;

export class ReloadGuard {
  /** Cached: the frame loop asks every frame, storage is read only at start and on request(). */
  private marked: boolean;

  constructor(
    private readonly store: KeyValueStore | null,
    private readonly wallNow: () => number,
  ) {
    this.marked = this.recentMark();
  }

  /** This tab reloaded itself recently and has not read the world cleanly since. */
  get armed(): boolean {
    return this.marked;
  }

  private recentMark(): boolean {
    const v = readKey(this.store, PROTOCOL_RELOAD_KEY);
    if (v === null) return false;
    const at = Number(v);
    if (!Number.isFinite(at) || at < LEGACY_MARK_MAX) return true;
    // A clock that jumped backwards keeps the mark (never risk a loop); it still clears on confirm().
    return this.wallNow() - at < RELOAD_GUARD_TTL_MS;
  }

  /**
   * A reload is wanted (protocol mismatch, unreadable snapshots). True: reload now (the mark is stored). False: this
   * tab already reloaded for it and that did not help, or the mark cannot be stored — explain instead of reloading.
   */
  request(): boolean {
    if (this.recentMark()) {
      this.marked = true;
      return false;
    }
    const mark = String(Math.round(this.wallNow()));
    writeKey(this.store, PROTOCOL_RELOAD_KEY, mark);
    this.marked = true;
    return readKey(this.store, PROTOCOL_RELOAD_KEY) === mark;
  }

  /** The page read the world cleanly: the next mismatch (a later deploy) may reload automatically again. */
  confirm(): void {
    if (!this.marked) return;
    this.marked = false;
    writeKey(this.store, PROTOCOL_RELOAD_KEY, null);
  }
}
