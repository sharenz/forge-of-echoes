"use client";

import { useEffect, useRef, useState } from "react";
import { ACTIVE_SKILLS, type ArenaBalance, type ArenaSummary, type MapDrop } from "../game/combat";
import type { CharacterClassId } from "../game/domain";
import type { PhaserRuntime } from "../game2d/PhaserRuntime";
import type { WorldHudState, WorldMode, WorldStation } from "../game2d/types";

interface PhaserWorldProps {
  mode: WorldMode;
  classId: CharacterClassId;
  portalActive?: boolean;
  paused?: boolean;
  arenaBalance?: ArenaBalance;
  onStation?: (station: WorldStation) => void;
  onLootPickup?: (drop: MapDrop) => void;
  onArenaComplete?: (summary: ArenaSummary) => void;
  children?: React.ReactNode;
}

export function PhaserWorld({ mode, classId, portalActive = false, paused = false, arenaBalance, onStation, onLootPickup, onArenaComplete, children }: PhaserWorldProps) {
  const runtimeClassId = mode === "class-select" ? "amazon" : classId;
  const parentRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<PhaserRuntime | null>(null);
  const stationCallbackRef = useRef(onStation);
  const lootCallbackRef = useRef(onLootPickup);
  const completionCallbackRef = useRef(onArenaComplete);
  const pausedRef = useRef(paused);
  const arenaBalanceRef = useRef(arenaBalance);
  const [hud, setHud] = useState<WorldHudState | null>(null);
  const [loading, setLoading] = useState(true);
  const [rendererError, setRendererError] = useState(false);

  useEffect(() => {
    stationCallbackRef.current = onStation;
    lootCallbackRef.current = onLootPickup;
    completionCallbackRef.current = onArenaComplete;
  }, [onArenaComplete, onLootPickup, onStation]);

  useEffect(() => {
    pausedRef.current = paused;
    runtimeRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    arenaBalanceRef.current = arenaBalance;
    if (arenaBalance) runtimeRef.current?.updateArenaBalance(arenaBalance);
  }, [arenaBalance]);

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
        paused: pausedRef.current,
        arenaBalance: arenaBalanceRef.current,
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
  }, [mode, portalActive, runtimeClassId]);

  const novaReady = Boolean(hud && hud.novaCooldown <= 0.05 && hud.focus >= ACTIVE_SKILLS.nova.focusCost);
  const riftReady = Boolean(hud && hud.riftCharges > 0 && hud.focus >= ACTIVE_SKILLS.dash.focusCost);
  const novaProgress = hud ? Math.min(100, (hud.novaCooldown / ACTIVE_SKILLS.nova.cooldown) * 100) : 0;
  const riftProgress = hud ? Math.min(100, (hud.riftRecharge / ACTIVE_SKILLS.dash.recharge) * 100) : 0;

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
            <span className="basic-skill"><kbd>Mouse</kbd><span><strong>Ember Lance</strong><small>Basic attack</small></span></span>
            <button type="button" className="active-skill" disabled={!novaReady} onClick={() => runtimeRef.current?.useSkill("nova")}>
              <i className="skill-recharge" style={{ width: `${novaProgress}%` }} />
              <kbd>{ACTIVE_SKILLS.nova.key}</kbd>
              <span><strong>{ACTIVE_SKILLS.nova.name}</strong><small>{hud.novaCooldown > 0.05 ? `${hud.novaCooldown.toFixed(1)}s recharge` : hud.focus < ACTIVE_SKILLS.nova.focusCost ? `Needs ${ACTIVE_SKILLS.nova.focusCost} Focus` : `Ready · ${ACTIVE_SKILLS.nova.focusCost} Focus`}</small></span>
            </button>
            <button type="button" className="active-skill rift-skill" disabled={!riftReady} onClick={() => runtimeRef.current?.useSkill("dash")}>
              <i className="skill-recharge" style={{ width: `${riftProgress}%` }} />
              <kbd>{ACTIVE_SKILLS.dash.key}</kbd>
              <span><strong>{ACTIVE_SKILLS.dash.name}</strong><small>{hud.riftCharges}/{hud.riftMaxCharges} charges{hud.riftCharges < hud.riftMaxCharges ? ` · +1 in ${hud.riftRecharge.toFixed(1)}s` : ` · ${ACTIVE_SKILLS.dash.focusCost} Focus`}</small></span>
              <span className="skill-charges" aria-label={`${hud.riftCharges} of ${hud.riftMaxCharges} Rift Step charges`}>
                {Array.from({ length: hud.riftMaxCharges }, (_, index) => <i className={index < hud.riftCharges ? "ready" : ""} key={index} />)}
              </span>
            </button>
          </div>
        </>
      )}
      {hud && <div className="world-fps">{hud.fps} FPS · WebGL sprites</div>}
      {children}
    </main>
  );
}
