"use client";

import { useEffect, useRef, useState } from "react";
import type { CharacterStats, MapItem, RunResult } from "../game/domain";
import { GameEngine, type EngineSnapshot } from "../game/engine";

interface ArenaProps {
  map: MapItem;
  stats: CharacterStats;
  onReturn: (result: RunResult) => void;
}

export function Arena({ map, stats, onReturn }: ArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const engine = new GameEngine({ map, stats, onSnapshot: setSnapshot, onFinished: setResult });
    engineRef.current = engine;
    let frame = 0;
    let previous = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * pixelRatio);
      canvas.height = Math.round(rect.height * pixelRatio);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const loop = (now: number) => {
      engine.tick((now - previous) / 1000);
      previous = now;
      engine.draw(context, canvas.width, canvas.height);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
        event.preventDefault();
        engine.setKey(event.code, true);
      }
      if (!event.repeat && event.code === "KeyQ") engine.useAbility("nova");
      if (!event.repeat && event.code === "KeyE") engine.useAbility("dash");
    };
    const handleKeyUp = (event: KeyboardEvent) => engine.setKey(event.code, false);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      engineRef.current = null;
    };
  }, [map, stats]);

  const updatePointer = (event: React.PointerEvent<HTMLCanvasElement>, firing: boolean) => {
    const engine = engineRef.current;
    if (!engine) return;
    const point = engine.toWorld(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    engine.setPointer(point, firing);
  };

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

  return (
    <main className="arena-shell">
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label="Ashen Crucible combat arena"
        onPointerMove={(event) => updatePointer(event, event.buttons === 1)}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updatePointer(event, true); }}
        onPointerUp={(event) => updatePointer(event, false)}
        onPointerLeave={(event) => updatePointer(event, false)}
      />

      {snapshot && <>
        <header className="arena-header">
          <div className="arena-map-name"><span>Tier {map.tier} map</span><strong>{map.baseName}</strong></div>
          <div className="wave-counter"><span>Wave</span><strong>{snapshot.wave}<em>/{snapshot.totalWaves}</em></strong></div>
          <div className="arena-run-stats"><span>{snapshot.enemiesSlain} slain</span><span>{formatTime(snapshot.elapsedSeconds)}</span><span>x{snapshot.rewardMultiplier.toFixed(2)} reward</span></div>
        </header>

        <div className="player-bars">
          <div className="bar-row"><span>Life</span><div className="bar-track"><i className="life-fill" style={{ width: `${(snapshot.life / snapshot.maxLife) * 100}%` }} /></div><strong>{Math.ceil(snapshot.life)}/{Math.ceil(snapshot.maxLife)}</strong></div>
          <div className="bar-row"><span>Focus</span><div className="bar-track"><i className="focus-fill" style={{ width: `${(snapshot.focus / snapshot.maxFocus) * 100}%` }} /></div><strong>{Math.floor(snapshot.focus)}/{snapshot.maxFocus}</strong></div>
        </div>

        <div className="arena-objective">
          <span>{snapshot.enemiesAlive + snapshot.enemiesRemaining}</span>
          <small>enemies remain</small>
        </div>

        <div className="skill-bar" aria-label="Combat skills">
          <div className="skill-slot basic"><kbd>Mouse</kbd><strong>Ember Lance</strong><small>Basic attack</small></div>
          <button type="button" className="skill-slot" onClick={() => engineRef.current?.useAbility("nova")}>
            <kbd>Q</kbd><strong>Ember Nova</strong><small>{snapshot.novaCooldown > 0 ? `${snapshot.novaCooldown.toFixed(1)}s` : "30 Focus"}</small>
          </button>
          <button type="button" className="skill-slot" onClick={() => engineRef.current?.useAbility("dash")}>
            <kbd>E</kbd><strong>Rift Step</strong><small>{snapshot.dashCooldown > 0 ? `${snapshot.dashCooldown.toFixed(1)}s` : "15 Focus"}</small>
          </button>
          <div className="lives-counter"><span>{"◆".repeat(snapshot.lives)}{"◇".repeat(3 - snapshot.lives)}</span><small>Lives</small></div>
        </div>

        {snapshot.phase === "bargain" && (
          <div className="decision-overlay">
            <div className="decision-card">
              <span className="eyebrow">Wave {snapshot.wave} cleared</span>
              <h2>The Crucible demands a bargain</h2>
              <p>Choose how the remaining waves will change. Bargains stack until the map ends.</p>
              <div className="bargain-grid">
                {snapshot.bargains.map((bargain) => (
                  <button type="button" key={bargain.id} onClick={() => engineRef.current?.chooseBargain(bargain.id)}>
                    <span className="bargain-mark">{bargain.name.charAt(0)}</span>
                    <strong>{bargain.name}</strong>
                    <small>{bargain.danger}</small>
                    <em>{bargain.reward}</em>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="decision-overlay result-overlay">
            <div className="decision-card result-card">
              <span className="eyebrow">{result.completed ? "Map complete" : "The Crucible closes"}</span>
              <h2>{result.completed ? "The forge remembers your name." : "Your map is lost."}</h2>
              <div className="result-metrics">
                <div><strong>{result.enemiesSlain}</strong><span>Enemies slain</span></div>
                <div><strong>{result.loot.xp}</strong><span>Experience</span></div>
                <div><strong>{result.loot.items.length}</strong><span>Items recovered</span></div>
                <div><strong>{Object.values(result.loot.materials).reduce((sum, value) => sum + (value ?? 0), 0)}</strong><span>Materials</span></div>
              </div>
              <button type="button" className="primary-action" onClick={() => onReturn(result)}><span>Return to the Forge</span><small>Bank rewards and inspect your haul</small></button>
            </div>
          </div>
        )}
      </>}
      <button type="button" className="abandon-run" onClick={() => engineRef.current?.abandon()}>Abandon map</button>
    </main>
  );
}

