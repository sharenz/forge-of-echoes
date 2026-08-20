"use client";

import { useRef, type MouseEvent } from "react";

const DUPLICATE_GESTURE_WINDOW_MS = 250;

type QuickActionEvent = MouseEvent<HTMLElement>;

/**
 * Normalizes Ctrl/Command-click across browsers. On macOS, Control-click can
 * arrive as both a click and a contextmenu event, so matching events are
 * coalesced into one authoritative action.
 */
export function useQuickAction() {
  const lastAction = useRef<{ key: string; at: number } | null>(null);

  const invoke = (event: QuickActionEvent, key: string, action: () => void): boolean => {
    event.preventDefault();
    event.stopPropagation();

    const previous = lastAction.current;
    if (previous?.key === key && event.timeStamp - previous.at < DUPLICATE_GESTURE_WINDOW_MS) return true;

    lastAction.current = { key, at: event.timeStamp };
    action();
    return true;
  };

  return {
    fromClick(event: QuickActionEvent, key: string, action: () => void): boolean {
      if (!event.ctrlKey && !event.metaKey) return false;
      return invoke(event, key, action);
    },
    fromContextMenu(event: QuickActionEvent, key: string, action: () => void): boolean {
      if (!event.ctrlKey) return false;
      return invoke(event, key, action);
    },
  };
}
