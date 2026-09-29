// DomInput with a fake window/document: focus handling (text fields, chat), T, Alt, and the macOS ⌘ quirk
// (no key-up for keys released while ⌘ is held).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomInput, type DomInputHooks } from '../../src/client/dom-input';

type Listener = (e: unknown) => void;

class FakeTarget {
  private readonly listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string, e: unknown): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
  }
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

interface KeyInit {
  code?: string;
  key?: string;
  repeat?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  target?: unknown;
}

function key(init: KeyInit) {
  const e = {
    code: init.code ?? '',
    key: init.key ?? '',
    repeat: init.repeat ?? false,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    target: init.target ?? null,
    defaultPrevented: false,
    preventDefault() {
      e.defaultPrevented = true;
    },
  };
  return e;
}

let win: FakeTarget & { innerWidth: number; innerHeight: number };
let doc: FakeTarget & { hidden: boolean; activeElement: unknown };
let chat = false;
let toggles = 0;
let alt: boolean[] = [];
let input: DomInput;
let canvas: FakeTarget;
let cancelCraft = false;

beforeEach(() => {
  win = Object.assign(new FakeTarget(), { innerWidth: 800, innerHeight: 600 });
  doc = Object.assign(new FakeTarget(), { hidden: false, activeElement: null });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('HTMLElement', FakeTarget);
  canvas = new FakeTarget();
  cancelCraft = false;
  chat = false;
  toggles = 0;
  alt = [];
  const hooks: DomInputHooks = {
    chatOpen: () => chat,
    active: () => true,
    worldClick: () => false,
    worldRightClick: () => cancelCraft,
    setAlt: (held) => alt.push(held),
    toggleAutoAttack: () => toggles++,
    released: () => undefined,
    gesture: () => undefined,
  };
  input = new DomInput(canvas as unknown as HTMLCanvasElement, hooks);
});

afterEach(() => {
  input.dispose();
  vi.unstubAllGlobals();
});

const down = (init: KeyInit) => win.fire('keydown', key(init));
const up = (init: KeyInit) => win.fire('keyup', key(init));

describe('DomInput', () => {
  const pointer = (button: number) => ({ button, clientX: 100, clientY: 100, preventDefault() {} });

  it('casts with RMB, releases outside the canvas and consumes crafting cancellation', () => {
    canvas.fire('mousedown', pointer(2));
    expect(input.state.sample().held).toBe(2);
    win.fire('mouseup', pointer(2));
    expect(input.state.sample().held).toBe(0);
    cancelCraft = true;
    canvas.fire('mousedown', pointer(2));
    expect(input.state.sample().held).toBe(0);
  });

  it('releases mouse inputs on cancellation, dragging and blur', () => {
    for (const event of ['pointercancel', 'dragstart', 'blur']) {
      canvas.fire('mousedown', pointer(0));
      canvas.fire('mousedown', pointer(2));
      expect(input.state.sample().held).toBe(3);
      win.fire(event, {});
      expect(input.state.sample().held).toBe(0);
    }
  });
  it('tracks both mouse buttons independently when their presses and releases overlap', () => {
    canvas.fire('mousedown', pointer(0));
    canvas.fire('mousedown', pointer(2));
    expect(input.state.sample().held).toBe(3);
    win.fire('mouseup', pointer(0));
    expect(input.state.sample().held).toBe(2);
    win.fire('mouseup', pointer(2));
    expect(input.state.sample().held).toBe(0);
  });
  it('forgets keys released while ⌘ was held (macOS sends no key-up) and restores a still-held key on repeat', () => {
    down({ code: 'KeyD', key: 'd' });
    expect(input.state.sample().moveX).toBe(1);
    down({ code: 'MetaLeft', key: 'Meta', metaKey: true });
    // D is let go while ⌘ is down: macOS swallows that key-up. Then ⌘ comes up.
    up({ code: 'MetaLeft', key: 'Meta' });
    expect(input.state.sample().moveX).toBe(0);
    // Had D still been held, its auto-repeat brings it back.
    down({ code: 'KeyD', key: 'd', repeat: true });
    expect(input.state.sample().moveX).toBe(1);
  });

  it('ignores game keys typed into a text field or while chat is open; releases always count', () => {
    down({ code: 'KeyW', key: 'w', target: { tagName: 'INPUT', type: 'text', isContentEditable: false } });
    expect(input.state.sample().moveY).toBe(0);
    down({ code: 'KeyW', key: 'w' });
    expect(input.state.sample().moveY).toBe(-1);
    chat = true;
    down({ code: 'KeyA', key: 'a' });
    expect(input.state.sample().moveX).toBe(0);
    up({ code: 'KeyW', key: 'w' });
    expect(input.state.sample().moveY).toBe(0);
  });

  it('leaves Ctrl/⌘ shortcuts to the browser but prevents the defaults of game keys', () => {
    const q = key({ code: 'KeyQ', key: 'q' });
    win.fire('keydown', q);
    expect(q.defaultPrevented).toBe(true);
    const copy = key({ code: 'KeyE', key: 'e', ctrlKey: true });
    win.fire('keydown', copy);
    expect(copy.defaultPrevented).toBe(false);
    expect(input.state.sample().held).toBe(0b100); // Q only
  });

  it('T toggles auto-attack once per press; Alt is tracked', () => {
    down({ code: 'KeyT', key: 't' });
    down({ code: 'KeyT', key: 't', repeat: true });
    expect(toggles).toBe(1);
    down({ code: 'AltLeft', key: 'Alt' });
    up({ code: 'AltLeft', key: 'Alt' });
    expect(alt).toEqual([true, false]);
  });

  it('releases everything when the window loses focus, and unhooks on dispose', () => {
    down({ code: 'KeyS', key: 's' });
    win.fire('blur', {});
    expect(input.state.sample().moveY).toBe(0);
    expect(alt).toEqual([false]);
    input.dispose();
    expect(win.count('keydown')).toBe(0);
    expect(doc.count('visibilitychange')).toBe(0);
  });
});
