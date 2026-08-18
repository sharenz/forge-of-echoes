"use client";

import { useEffect, useRef, useState } from "react";
import type { CharacterClassId } from "../game/domain";
import type { ArenaBalance, ArenaSummary } from "../game/combat";
import type { BabylonRuntime } from "../game3d/BabylonRuntime";
import type { WorldHudState, WorldMode, WorldStation } from "../game3d/types";

interface BabylonWorldProps {
  mode: WorldMode;
  classId: CharacterClassId;
  portalActive?: boolean;
  arenaBalance?: ArenaBalance;
  onStation?: (station: WorldStation) => void;
  onArenaComplete?: (summary: ArenaSummary) => void;
  children?: React.ReactNode;
}

export function BabylonWorld({ mode, classId, portalActive = false, arenaBalance, onStation, onArenaComplete, children }: BabylonWorldProps) {
  const runtimeClassId = mode === "class-select" ? "amazon" : classId;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<BabylonRuntime | null>(null);
  const stationCallbackRef = useRef(onStation);
  const completionCallbackRef = useRef(onArenaComplete);
  const [hud, setHud] = useState<WorldHudState | null>(null);
  const [loading, setLoading] = useState(true);
  const [rendererError, setRendererError] = useState(false);

  useEffect(() => {
    stationCallbackRef.current = onStation;
    completionCallbackRef.current = onArenaComplete;
  }, [onArenaComplete, onStation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    let runtime: BabylonRuntime | null = null;
    setLoading(true);
    setRendererError(false);
    void import("../game3d/BabylonRuntime").then(async ({ BabylonRuntime: Runtime }) => {
      if (!active) return;
      runtime = new Runtime({
        canvas,
        mode,
        classId: runtimeClassId,
        portalActive,
        arenaBalance,
        onStation: (station) => stationCallbackRef.current?.(station),
        onHud: setHud,
        onArenaComplete: (summary) => completionCallbackRef.current?.(summary),
      });
      runtimeRef.current = runtime;
      await runtime.initialize();
      if (active) setLoading(false);
    }).catch(() => {
      if (!active) return;
      setLoading(false);
      setRendererError(true);
    });

    const keyDown = (event: KeyboardEvent) => {
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
        event.preventDefault();
        const aliases: Record<string, string> = { ArrowUp: "KeyW", ArrowLeft: "KeyA", ArrowDown: "KeyS", ArrowRight: "KeyD" };
        runtime?.setKey(aliases[event.code] ?? event.code, true);
      }
      if (!event.repeat && event.code === "KeyQ") runtime?.useSkill("nova");
      if (!event.repeat && event.code === "KeyE") runtime?.useSkill("dash");
    };
    const keyUp = (event: KeyboardEvent) => {
      const aliases: Record<string, string> = { ArrowUp: "KeyW", ArrowLeft: "KeyA", ArrowDown: "KeyS", ArrowRight: "KeyD" };
      runtime?.setKey(aliases[event.code] ?? event.code, false);
    };
    const resize = () => runtime?.resize();
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("resize", resize);
    return () => {
      active = false;
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("resize", resize);
      runtime?.dispose();
      runtimeRef.current = null;
    };
  }, [arenaBalance, mode, portalActive, runtimeClassId]);

  return (
    <main className={`babylon-shell mode-${mode}`}>
      <canvas
        ref={canvasRef}
        className="babylon-canvas"
        aria-label={`${mode} 3D game world`}
        onPointerDown={() => { runtimeRef.current?.setPointerHeld(true); }}
        onPointerUp={() => runtimeRef.current?.setPointerHeld(false)}
        onPointerLeave={() => runtimeRef.current?.setPointerHeld(false)}
      />
      {loading && <div className="world-loader"><span /><strong>Forging the world</strong><small>Preparing the 3D renderer</small></div>}
      {rendererError && <div className="world-loader world-error"><strong>The 3D renderer could not start</strong><small>Enable WebGL2 or WebGPU, then reload the page.</small></div>}
      {mode === "arena" && hud && (
        <>
          <div className="world-wave"><span>Wave</span><strong>{hud.wave}<em>/{arenaBalance?.waves ?? 6}</em></strong><small>{hud.enemies} remain</small></div>
          <div className="world-vitals">
            <div><span>Life</span><i><b style={{ width: `${(hud.life / hud.maxLife) * 100}%` }} /></i><strong>{Math.ceil(hud.life)}</strong></div>
            <div><span>Focus</span><i><b style={{ width: `${(hud.focus / hud.maxFocus) * 100}%` }} /></i><strong>{Math.floor(hud.focus)}</strong></div>
          </div>
          <div className="world-skills">
            <span><kbd>Mouse</kbd> Ember Lance</span><button type="button" onClick={() => runtimeRef.current?.useSkill("nova")}><kbd>Q</kbd> Ember Nova</button><button type="button" onClick={() => runtimeRef.current?.useSkill("dash")}><kbd>E</kbd> Rift Step</button>
          </div>
        </>
      )}
      {hud && <div className="world-fps">{hud.fps} FPS · {"gpu" in navigator ? "WebGPU" : "WebGL2"}</div>}
      {children}
    </main>
  );
}
