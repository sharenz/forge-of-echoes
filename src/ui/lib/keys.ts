// Keyboard mapping for the in-game UI. Pure; covered by tests/ui/helpers.test.ts.
// The UI owns only panel keys, Esc, Enter and Ctrl/⌘+F (stash search). Movement, skills, flasks and T
// (auto-attack) belong to the client's input layer.
import type { Panel } from '../../contracts/ui';

export type KeyCommand =
  | { kind: 'toggle'; panel: Panel }
  | { kind: 'escape' }
  | { kind: 'chat' }
  /** Ctrl/⌘+F: focus the stash search (also from inside a text field). */
  | { kind: 'search' }
  | null;

export const PANEL_KEYS: Readonly<Record<string, Panel>> = {
  i: 'inventory',
  c: 'character',
  k: 'skills',
  p: 'party',
};

export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
}

/** `typing` = focus is in a text field: only Escape and Ctrl/⌘+F are handled then. */
export function keyCommand(e: KeyInput, typing: boolean): KeyCommand {
  if (e.key === 'Escape') return { kind: 'escape' };
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') return { kind: 'search' };
  if (typing || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === 'Enter') return { kind: 'chat' };
  const panel = PANEL_KEYS[e.key.toLowerCase()];
  return panel ? { kind: 'toggle', panel } : null;
}

/** Whether an event target is a text entry (keys then belong to the field). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return type !== 'range' && type !== 'checkbox' && type !== 'button' && type !== 'radio';
  }
  return el.isContentEditable === true;
}

/**
 * Whether an event target is a clickable control (button, switch, checkbox, slider). In game such a control
 * must not keep keyboard focus after a mouse click: Space is a skill key and would press it again.
 */
export function isControlTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  if (el.tagName === 'BUTTON') return true;
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return type === 'range' || type === 'checkbox' || type === 'button' || type === 'radio' || type === 'submit';
  }
  return false;
}

/** Keys that activate a focused control: prevented when a control still holds focus in game. */
export function isActivationKey(key: string): boolean {
  return key === ' ' || key === 'Enter';
}

/**
 * While a modal owns the screen (menu, help, run summary, a confirmation dialog, the affix choice), only Esc
 * reaches the game UI: panel keys and chat would otherwise open things underneath it.
 */
export function keyAllowedWhile(cmd: KeyCommand, blocked: boolean): boolean {
  return !!cmd && (!blocked || cmd.kind === 'escape');
}

export type EscapeStep =
  | { kind: 'cancelDrag' }
  | { kind: 'closeDialog' }
  | { kind: 'cancelAffix' }
  | { kind: 'disarm' }
  | { kind: 'closeChat' }
  | { kind: 'dismissSummary' }
  | { kind: 'closePanel'; panel: Panel }
  | { kind: 'openMenu' };

export interface EscapeContext {
  dragging: boolean;
  dialog: boolean;
  affixChoice: boolean;
  armed: boolean;
  chatOpen: boolean;
  runSummary: boolean;
  topPanel: Panel | null;
}

/** What one press of Esc does, most transient state first; with nothing open it opens the menu. */
export function escapeStep(c: EscapeContext): EscapeStep {
  if (c.dragging) return { kind: 'cancelDrag' };
  if (c.dialog) return { kind: 'closeDialog' };
  if (c.affixChoice) return { kind: 'cancelAffix' };
  if (c.armed) return { kind: 'disarm' };
  if (c.chatOpen) return { kind: 'closeChat' };
  if (c.runSummary) return { kind: 'dismissSummary' };
  if (c.topPanel) return { kind: 'closePanel', panel: c.topPanel };
  return { kind: 'openMenu' };
}
