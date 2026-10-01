// Browser events → InputState (input.ts) and the few direct world interactions (hideout prop clicks, disarming a
// currency with a right-click on the world, Alt, T). The UI (src/ui) owns I / C / K / P, Enter and Esc; this layer
// owns movement, skills, flasks, T and Alt, and never handles a key while a text field has focus or chat is open.
import { AUTO_ATTACK_CODE, InputState } from './input';

export interface DomInputHooks {
  /** Chat is open (movement keys belong to the chat field). */
  chatOpen(): boolean;
  /** Game input is meaningful right now (in game, zone loaded). */
  active(): boolean;
  /** Left click on the world at css (x, y). Return true to consume it (a prop was clicked; no attack). */
  worldClick(x: number, y: number): boolean;
  /** Right click on the world. Return true when consumed (e.g. cancelling crafting), otherwise cast RMB. */
  worldRightClick(): boolean;
  setAlt(held: boolean): void;
  toggleAutoAttack(): void;
  /** Every key and button was released at once (focus left the page): the server must hear it now. */
  released(): void;
  /** Any user gesture (audio unlock). */
  gesture(): void;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return type !== 'range' && type !== 'checkbox' && type !== 'button' && type !== 'radio' && type !== 'submit';
}

export class DomInput {
  readonly state = new InputState();
  /** Last pointer position in CSS px (viewport). */
  cursorX: number;
  cursorY: number;
  /** The pointer is over a UI surface (not the world canvas). */
  overUi = false;
  private readonly off: (() => void)[] = [];
  private chatWasOpen = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: DomInputHooks,
  ) {
    this.cursorX = window.innerWidth / 2;
    this.cursorY = window.innerHeight / 2;
    type Events = WindowEventMap & DocumentEventMap;
    const on = <K extends keyof Events>(target: Window | Document | HTMLElement, type: K, fn: (e: Events[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    on(window, 'keydown', (e) => this.keyDown(e));
    on(window, 'keyup', (e) => this.keyUp(e));
    on(window, 'blur', () => this.releaseAll());
    on(document, 'visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    on(window, 'pointermove', (e) => {
      this.cursorX = e.clientX;
      this.cursorY = e.clientY;
      this.overUi = e.target !== this.canvas;
    }, { passive: true });
    // Mouse events report every button transition. Pointer down/up only report the first press and last
    // release, which would lose RMB while LMB is held (and leave LMB held after releasing it first).
    on(canvas, 'mousedown', (e) => this.mouseDown(e));
    on(window, 'mouseup', (e) => {
      this.state.mouseUp(e.button);
    });
    on(window, 'pointercancel', () => this.releaseAll());
    on(window, 'dragstart', () => this.releaseAll());
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    // Any first gesture unlocks audio (capture phase: runs even when the UI stops propagation).
    const gesture = (): void => this.hooks.gesture();
    on(window, 'pointerdown', gesture, { capture: true });
    on(window, 'keydown', gesture, { capture: true });
  }

  /** Per frame: chat opening drops held movement keys (they would keep walking while typing). */
  poll(): void {
    const open = this.hooks.chatOpen();
    if (open && !this.chatWasOpen) this.state.blockKeys();
    this.chatWasOpen = open;
  }

  releaseAll(): void {
    this.state.clear();
    this.hooks.setAlt(false);
    this.hooks.released();
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.key === 'Alt') {
      // Alt shows affix tiers; without preventDefault the browser menu bar takes focus.
      e.preventDefault();
      if (!e.repeat) this.hooks.setAlt(true);
      return;
    }
    // Ctrl/⌘ combinations stay browser shortcuts; Alt is the game's own modifier (affix details), so WASD and
    // skills keep working while it is held.
    if (!this.hooks.active() || e.ctrlKey || e.metaKey) return;
    if (isTyping(e.target) || this.hooks.chatOpen()) return;
    if (e.code === AUTO_ATTACK_CODE) {
      e.preventDefault();
      if (!e.repeat) this.hooks.toggleAutoAttack();
      return;
    }
    if (this.state.keyDown(e.code, e.repeat)) e.preventDefault();
  }

  private keyUp(e: KeyboardEvent): void {
    if (e.key === 'Alt') {
      e.preventDefault();
      this.hooks.setAlt(false);
      return;
    }
    if (e.key === 'Meta') {
      // macOS fires no key-up for keys released while ⌘ is held (⌘-click is the quick-move gesture), so a
      // movement key let go meanwhile would walk on forever. Forget the keyboard; a key still held comes back
      // with its next auto-repeat.
      this.state.blockKeys();
      return;
    }
    // Releases always count (a key pressed before the chat opened must not stay held).
    this.state.keyUp(e.code);
  }

  private mouseDown(e: MouseEvent): void {
    this.cursorX = e.clientX;
    this.cursorY = e.clientY;
    this.overUi = false;
    if (!this.hooks.active()) return;
    // Clicking the world takes keyboard focus away from any UI control (game keys must not activate the old control).
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body && !isTyping(focused)) focused.blur();
    if (e.button === 2) {
      e.preventDefault();
      if (!this.hooks.worldRightClick()) this.state.mouseDown(2);
      return;
    }
    if (e.button !== 0) return;
    if (this.hooks.worldClick(e.clientX, e.clientY)) return;
    this.state.mouseDown();
  }
}
