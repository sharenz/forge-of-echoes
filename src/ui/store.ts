// Store plumbing: the UiStore travels through context; components subscribe to slices with `useUi(selector)`
// so the 15 Hz HUD updates only re-render the widgets whose data changed.
import { createContext } from 'preact';
import { useContext, useEffect, useReducer, useRef } from 'preact/hooks';
import type { UiState, UiStore } from '../contracts/ui';

export const StoreContext = createContext<UiStore | null>(null);

export function useStore(): UiStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('UiStore missing: render inside <StoreContext.Provider>.');
  return s;
}

/** Shallow equality for arrays and plain objects (one level). */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * Subscribe to a slice of UiState. Re-renders only when `eq(prev, next)` is false.
 * Selectors may close over props; the latest selector is always used.
 */
export function useUi<T>(selector: (s: UiState) => T, eq: (a: T, b: T) => boolean = Object.is): T {
  const store = useStore();
  const [, force] = useReducer((n: number) => n + 1, 0);
  const selRef = useRef(selector);
  const eqRef = useRef(eq);
  selRef.current = selector;
  eqRef.current = eq;
  const value = selector(store.get());
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const check = (): void => {
      const next = selRef.current(store.get());
      if (!eqRef.current(valueRef.current, next)) force(0);
    };
    const unsub = store.subscribe(check);
    check(); // the state may have changed between render and subscribe
    return unsub;
  }, [store]);
  return value;
}

/** Tiny observable for UI-local state (tooltips, drag, dialogs) that must not live in the game store. */
export interface Signal<T> {
  get(): T;
  set(v: T): void;
  update(fn: (v: T) => T): void;
  subscribe(fn: () => void): () => void;
}

export function signal<T>(initial: T): Signal<T> {
  let v = initial;
  const subs = new Set<() => void>();
  return {
    get: () => v,
    set(next) {
      if (Object.is(next, v)) return;
      v = next;
      for (const s of [...subs]) s();
    },
    update(fn) {
      this.set(fn(v));
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useSignal<T>(sig: Signal<T>): T {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const ref = useRef(sig.get());
  ref.current = sig.get();
  useEffect(() => {
    const check = (): void => {
      if (!Object.is(ref.current, sig.get())) force(0);
    };
    const unsub = sig.subscribe(check);
    check();
    return unsub;
  }, [sig]);
  return sig.get();
}
