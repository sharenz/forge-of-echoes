"use client";

import { useEffect, useRef, useState } from "react";
import type { ArenaBalance, ArenaSummary, MapDrop } from "../game/combat";
import type { CharacterClassId } from "../game/domain";
import type { PhaserRuntime } from "../game2d/PhaserRuntime";
import type { WorldHudState, WorldMode, WorldStation } from "../game2d/types";

interface PhaserWorldProps {
  mode: WorldMode;
  classId: CharacterClassId;
  portalActive?: boolean;
  arenaBalance?: ArenaBalance;
  onStation?: (station: WorldStation) => void;
  onLootPickup?: (drop: MapDrop) => void;
  onArenaComplete?: (summary: ArenaSummary) => void;
  children?: React.ReactNode;
}

export function PhaserWorld({ mode, classId, portalActive = false, arenaBalance, onStation, onLootPickup, onArenaComplete, children }: PhaserWorldProps) {
  const runtimeClassId = mode === "class-select" ? "amazon" : classId;
  const parentRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<PhaserRuntime | null>(null);
  const stationCallbackRef = useRef(onStation);
  const lootCallbackRef = useRef(onLootPickup);
  const completionCallbackRef = useRef(onArenaComplete);
  const [hud, setHud] = useState<WorldHudState | null>(null);
  const [loading, setLoading] = useState(true);
  const [rendererError, setRendererError] = useState(false);

  useEffect(() => {
    stationCallbackRef.current = onStation;
    lootCallbackRef.current = onLootPickup;
    completionCallbackRef.current = onArenaComplete;
  }, [onArenaComplete, onLootPickup, onStation]);

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    let active = true;
    let runtime: PhaserRuntime | null = null;
    setLoading(true);
    setRendererError(false);
    void import("../game2d/PhaserRuntime").then(({ PhaserRuntime: Runtime }) => {
      if (!active) return;
      runtime = new Runtime({
        parent,
        mode,
        classId: runtimeClassId,
        portalActive,
        arenaBalance,
        onStation: (station) => stationCallbackRef.current?.(station),
        onHud: setHud,
        onLootPickup: (drop) => lootCallbackRef.current?.(drop),
        onArenaComplete: (summary) => completionCallbackRef.current?.(summary),
      });
      runtimeRef.current = runtime;
      runtime.initialize();
      window.setTimeout(() => { if (active) setLoading(false); }, 350);
    }).catch(() => {
      if (!active) return;
      setLoading(false);
      setRendererError(true);
    });
    const resize = () => runtime?.resize();
    window.addEventListener("resize", resize);
    return () => {
      active = false;
      window.removeEventListener("resize", resize);
      runtime?.dispose();
      runtimeRef.current = null;
      parent.replaceChildren();
    };
  }, [arenaBalance, mode, portalActive, runtimeClassId]);

  return (
    <main className={`pixel-shell mode-${mode}`}>
      <div ref={parentRef} className="phaser-stage" aria-label={`${mode} pixel-art game world`} />
      {loading && <div className="world-loader"><span /><strong>Opening the wild forge</strong><small>Preparing the pixel world</small></div>}
      {rendererError && <div className="world-loader world-error"><strong>The game renderer could not start</strong><small>Enable WebGL or Canvas support, then reload.</small></div>}
      {mode === "arena" && hud && (
        <>
          <div className="world-wave"><span>Wave</span><strong>{hud.wave}<em>/{arenaBalance?.waves ?? 6}</em></strong><small>{hud.enemies} remain</small></div>
          <div className="world-loot"><span>{hud.lootCollected} collected</span><strong>{hud.groundDrops}</strong><small>drops on ground</small></div>
          <div className="world-vitals">
            <div><span>Life</span><i><b style={{ width: `${(hud.life / hud.maxLife) * 100}%` }} /></i><strong>{Math.ceil(hud.life)}</strong></div>
            <div><span>Focus</span><i><b style={{ width: `${(hud.focus / hud.maxFocus) * 100}%` }} /></i><strong>{Math.floor(hud.focus)}</strong></div>
          </div>
          <div className="world-skills">
            <span><kbd>Mouse</kbd> Ember Lance</span>
            <button type="button" onClick={() => runtimeRef.current?.useSkill("nova")}><kbd>Q</kbd> Ember Nova</button>
            <button type="button" onClick={() => runtimeRef.current?.useSkill("dash")}><kbd>E</kbd> Rift Step</button>
          </div>
        </>
      )}
      {hud && <div className="world-fps">{hud.fps} FPS · WebGL sprites</div>}
      {children}
    </main>
  );
}
