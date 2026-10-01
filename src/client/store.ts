// The observable UiState container behind the UiStore (contracts/ui.ts). State is immutable: every change
// produces a new object and notifies subscribers synchronously; `batch` coalesces several changes into one
// notification (message bursts, per-frame HUD + character updates).
import type { UiState } from '../contracts/ui';

export interface StateBox {
  get(): UiState;
  /** Replace the state (no-op when `next` is the current object). */
  set(next: UiState): void;
  /** Apply a reducer. */
  update(fn: (s: UiState) => UiState): void;
  subscribe(listener: () => void): () => void;
  /** Run `fn`, notifying once at the end if anything changed. */
  batch(fn: () => void): void;
}

export function createStateBox(initial: UiState): StateBox {
  let state = initial;
  const listeners = new Set<() => void>();
  let depth = 0;
  let dirty = false;

  const notify = (): void => {
    for (const l of [...listeners]) {
      try {
        l();
      } catch (err) {
        // A broken subscriber must not starve the others (or the game loop that triggered the update).
        console.error('[foe] UI subscriber failed', err);
      }
    }
  };

  const box: StateBox = {
    get: () => state,
    set(next) {
      if (next === state) return;
      state = next;
      if (depth > 0) dirty = true;
      else notify();
    },
    update(fn) {
      box.set(fn(state));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    batch(fn) {
      depth++;
      try {
        fn();
      } finally {
        depth--;
        if (depth === 0 && dirty) {
          dirty = false;
          notify();
        }
      }
    },
  };
  return box;
}
