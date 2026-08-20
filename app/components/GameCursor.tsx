"use client";

import { useEffect, useRef } from "react";

type CursorMode = "default" | "interactive" | "combat";

export function GameCursor() {
  const ringRef = useRef<HTMLSpanElement>(null);
  const pointRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const preventBrowserContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", preventBrowserContextMenu);
    return () => document.removeEventListener("contextmenu", preventBrowserContextMenu);
  }, []);

  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)");
    if (!finePointer.matches) return;

    const ring = ringRef.current;
    const point = pointRef.current;
    if (!ring || !point) return;

    document.documentElement.classList.add("cursor-enhanced");

    const setMode = (mode: CursorMode) => {
      ring.dataset.mode = mode;
      point.dataset.mode = mode;
    };

    const moveCursor = (clientX: number, clientY: number, target: EventTarget | null) => {
      const transform = `translate3d(${clientX}px, ${clientY}px, 0)`;
      ring.style.transform = transform;
      point.style.transform = transform;
      ring.dataset.visible = "true";
      point.dataset.visible = "true";

      const element = target instanceof Element ? target : null;
      const disabled = element?.closest("button:disabled, [aria-disabled='true']");
      const mode: CursorMode = element?.closest(".arena-shell .game-canvas")
        ? "combat"
        : !disabled && element?.closest("button, a, input, select, textarea, [role='button']")
          ? "interactive"
          : "default";
      setMode(mode);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      moveCursor(event.clientX, event.clientY, event.target);
    };
    const handleDragMove = (event: DragEvent) => moveCursor(event.clientX, event.clientY, event.target);

    const hide = () => {
      ring.dataset.visible = "false";
      point.dataset.visible = "false";
    };
    const press = () => {
      ring.dataset.pressed = "true";
      point.dataset.pressed = "true";
    };
    const release = () => {
      ring.dataset.pressed = "false";
      point.dataset.pressed = "false";
    };
    const reset = () => {
      release();
      hide();
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("dragover", handleDragMove, { passive: true });
    window.addEventListener("pointerdown", press, { passive: true });
    window.addEventListener("pointerup", release, { passive: true });
    window.addEventListener("pointercancel", release, { passive: true });
    window.addEventListener("dragend", release, { passive: true });
    window.addEventListener("blur", reset);
    document.documentElement.addEventListener("mouseleave", hide);

    return () => {
      document.documentElement.classList.remove("cursor-enhanced");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("dragover", handleDragMove);
      window.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("dragend", release);
      window.removeEventListener("blur", reset);
      document.documentElement.removeEventListener("mouseleave", hide);
    };
  }, []);

  return (
    <div className="game-cursor" aria-hidden="true">
      <span ref={ringRef} className="game-cursor-ring-wrap" data-mode="default" data-visible="false">
        <i className="game-cursor-ring" />
      </span>
      <span ref={pointRef} className="game-cursor-point-wrap" data-mode="default" data-visible="false">
        <i className="game-cursor-point" />
      </span>
    </div>
  );
}
