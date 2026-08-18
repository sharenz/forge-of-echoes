"use client";

import { useEffect, useRef } from "react";

type CursorMode = "default" | "interactive" | "combat";

export function GameCursor() {
  const ringRef = useRef<HTMLSpanElement>(null);
  const pointRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)");
    if (!finePointer.matches) return;

    const ring = ringRef.current;
    const point = pointRef.current;
    if (!ring || !point) return;

    document.documentElement.classList.add("cursor-enhanced");

    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;
    let ringX = pointerX;
    let ringY = pointerY;
    let frame = 0;

    const setMode = (mode: CursorMode) => {
      ring.dataset.mode = mode;
      point.dataset.mode = mode;
    };

    const render = () => {
      ringX += (pointerX - ringX) * 0.24;
      ringY += (pointerY - ringY) * 0.24;
      ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;
      frame = window.requestAnimationFrame(render);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      point.style.transform = `translate3d(${pointerX}px, ${pointerY}px, 0)`;
      ring.dataset.visible = "true";
      point.dataset.visible = "true";

      const target = event.target instanceof Element ? event.target : null;
      const disabled = target?.closest("button:disabled, [aria-disabled='true']");
      const mode: CursorMode = target?.closest(".arena-shell .game-canvas")
        ? "combat"
        : !disabled && target?.closest("button, a, input, select, textarea, [role='button']")
          ? "interactive"
          : "default";
      setMode(mode);
    };

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

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerdown", press, { passive: true });
    window.addEventListener("pointerup", release, { passive: true });
    document.documentElement.addEventListener("mouseleave", hide);
    frame = window.requestAnimationFrame(render);

    return () => {
      document.documentElement.classList.remove("cursor-enhanced");
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
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
