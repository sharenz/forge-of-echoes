"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ACTIVE_SKILLS, BASIC_ATTACK, type ArenaBalance, type ArenaSummary, type MapDrop } from "../game/combat";
import { ARENA_RULES } from "../game/config/arena";
import { FLASK_DEFINITIONS, type FlaskDefinition } from "../game/config/flasks";
import { MAX_CHARACTER_LEVEL, XP_BY_LEVEL } from "../game/config/progression";
import type { CharacterClassId, CharacterProgress, CharacterStats, FlaskBelt, StatKey, StatModifier } from "../game/domain";
import { resolveSkillDefinition } from "../game/skills";
import type { CharacterStatCalculation, StatResolution } from "../game/stats";
import type { PhaserRuntime } from "../game2d/PhaserRuntime";
import type { WorldHudState, WorldMode, WorldStation } from "../game2d/types";

interface PhaserWorldProps {
  mode: WorldMode;
  classId: CharacterClassId;
  portalActive?: boolean;
  paused?: boolean;
  arenaBalance?: ArenaBalance;
  characterStats?: CharacterStats;
  characterProgress?: CharacterProgress;
  characterStatBreakdown?: CharacterStatCalculation["breakdown"];
  flaskBelt?: FlaskBelt;
  onStation?: (station: WorldStation) => void;
  onLootPickup?: (drop: MapDrop) => boolean;
  onExperienceGain?: (amount: number) => void;
  onArenaComplete?: (summary: ArenaSummary) => void;
  onPlayerDeath?: () => void;
  onFlaskUse?: (slotIndex: number) => FlaskDefinition | null;
  children?: React.ReactNode;
}

interface CharacterStatRowProps {
  stat: StatKey;
  label: string;
  hint?: string;
  value: string;
  resolution?: StatResolution;
}

function compactNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function contributionAmount(modifier: StatModifier): string {
  const value = compactNumber(modifier.value);
  if (modifier.mode === "flat") return `${modifier.value >= 0 ? "+" : ""}${value}`;
  return `${modifier.value >= 0 ? "+" : ""}${value}% ${modifier.mode}`;
}

interface ResourceGlobeProps {
  kind: "life" | "mana";
  label: string;
  current: number;
  maximum: number;
}

function ResourceGlobe({ kind, label, current, maximum }: ResourceGlobeProps) {
  const percentage = maximum > 0 ? Math.max(0, Math.min(100, (current / maximum) * 100)) : 0;
  const displayedCurrent = kind === "life" ? Math.ceil(current) : Math.floor(current);
  const displayedMaximum = kind === "life" ? Math.ceil(maximum) : Math.floor(maximum);
  return (
    <div className={`resource-tank ${kind}-tank`} aria-label={`${label}: ${displayedCurrent} of ${displayedMaximum}`}>
      <div className="globe-reservoir" style={{ "--resource-level": `${percentage}%` } as CSSProperties}>
        <i className="globe-liquid" />
        <strong><span>{label}</span>{displayedCurrent}<small>/{displayedMaximum}</small></strong>
      </div>
    </div>
  );
}

function CharacterStatRow({ stat, label, hint, value, resolution }: CharacterStatRowProps) {
  const contributions = resolution?.contributions.filter((modifier) => Math.abs(modifier.value) > 0.0001) ?? [];
  return (
    <details className="character-stat-row" data-stat={stat}>
      <summary><span>{label}{hint && <small>{hint}</small>}</span><strong>{value}</strong></summary>
      {resolution && (
        <div className="character-stat-breakdown">
          <header><span>{label}</span><strong>{compactNumber(resolution.value)}</strong></header>
          <div className="stat-contributions">
            {contributions.map((modifier, index) => (
              <div key={`${modifier.source}-${index}`}>
                <span>{modifier.label ?? modifier.source}</span>
                <strong>{contributionAmount(modifier)}</strong>
              </div>
            ))}
          </div>
          <footer>
            <span>{compactNumber(resolution.flat)} flat</span>
            <span>{compactNumber(resolution.increased)}% increased</span>
            {resolution.more.length > 0 && <span>{resolution.more.map((value) => `${compactNumber(value)}% more`).join(" × ")}</span>}
          </footer>
        </div>
      )}
    </details>
  );
}

const EMPTY_FLASK_BELT: FlaskBelt = [null, null, null, null];

export function PhaserWorld({ mode, classId, portalActive = false, paused = false, arenaBalance, characterStats, characterProgress, characterStatBreakdown, flaskBelt = EMPTY_FLASK_BELT, onStation, onLootPickup, onExperienceGain, onArenaComplete, onPlayerDeath, onFlaskUse, children }: PhaserWorldProps) {
  const runtimeClassId = mode === "class-select" ? "amazon" : classId;
  const novaLevel = characterProgress?.skillLevels.nova ?? 1;
  const dashLevel = characterProgress?.skillLevels.dash ?? 1;
  const parentRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<PhaserRuntime | null>(null);
  const stationCallbackRef = useRef(onStation);
  const lootCallbackRef = useRef(onLootPickup);
  const completionCallbackRef = useRef(onArenaComplete);
  const deathCallbackRef = useRef(onPlayerDeath);
  const experienceCallbackRef = useRef(onExperienceGain);
  const flaskUseCallbackRef = useRef(onFlaskUse);
  const flaskBeltRef = useRef(flaskBelt);
  const skillLevelsRef = useRef({ nova: novaLevel, dash: dashLevel });
  const pausedRef = useRef(paused);
  const arenaBalanceRef = useRef(arenaBalance);
  const [hud, setHud] = useState<WorldHudState | null>(null);
  const [loading, setLoading] = useState(true);
  const [rendererError, setRendererError] = useState(false);

  useEffect(() => {
    stationCallbackRef.current = onStation;
    lootCallbackRef.current = onLootPickup;
    completionCallbackRef.current = onArenaComplete;
    deathCallbackRef.current = onPlayerDeath;
    experienceCallbackRef.current = onExperienceGain;
    flaskUseCallbackRef.current = onFlaskUse;
  }, [onArenaComplete, onExperienceGain, onFlaskUse, onLootPickup, onPlayerDeath, onStation]);

  useEffect(() => {
    flaskBeltRef.current = flaskBelt;
    runtimeRef.current?.updateFlaskBelt(flaskBelt);
  }, [flaskBelt]);

  useEffect(() => {
    pausedRef.current = paused;
    runtimeRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    arenaBalanceRef.current = arenaBalance;
    if (arenaBalance) runtimeRef.current?.updateArenaBalance(arenaBalance);
  }, [arenaBalance]);

  useEffect(() => {
    const skillLevels = { nova: novaLevel, dash: dashLevel };
    skillLevelsRef.current = skillLevels;
    runtimeRef.current?.updateSkillLevels(skillLevels);
  }, [novaLevel, dashLevel]);

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
        skillLevels: skillLevelsRef.current,
        flaskBelt: flaskBeltRef.current,
        arenaBalance: arenaBalanceRef.current,
        onStation: (station) => stationCallbackRef.current?.(station),
        onHud: setHud,
        onLootPickup: (drop) => lootCallbackRef.current?.(drop) ?? false,
        onExperienceGain: (amount) => experienceCallbackRef.current?.(amount),
        onArenaComplete: (summary) => completionCallbackRef.current?.(summary),
        onPlayerDeath: () => deathCallbackRef.current?.(),
        onFlaskUse: (slotIndex) => flaskUseCallbackRef.current?.(slotIndex) ?? null,
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

  const resolvedNova = resolveSkillDefinition(ACTIVE_SKILLS.nova, novaLevel);
  const resolvedDash = resolveSkillDefinition(ACTIVE_SKILLS.dash, dashLevel);
  const resolvedWard = resolveSkillDefinition(ACTIVE_SKILLS.ward, 1);
  const novaReady = Boolean(hud && hud.novaCooldown <= 0.05 && hud.focus >= resolvedNova.focusCost);
  const riftReady = Boolean(hud && hud.riftCharges > 0 && hud.focus >= resolvedDash.focusCost);
  const wardReady = Boolean(hud && hud.wardCooldown <= 0.05 && hud.focus >= resolvedWard.focusCost);
  const novaProgress = hud ? Math.min(100, (hud.novaCooldown / resolvedNova.cooldown) * 100) : 0;
  const riftProgress = hud ? Math.min(100, (hud.riftRecharge / resolvedDash.recharge) * 100) : 0;
  const wardProgress = hud ? Math.min(100, (hud.wardCooldown / resolvedWard.cooldown) * 100) : 0;
  const xpRequired = characterProgress ? XP_BY_LEVEL(characterProgress.level) : 1;
  const xpPercent = characterProgress?.level === MAX_CHARACTER_LEVEL ? 100 : Math.min(100, ((characterProgress?.xp ?? 0) / xpRequired) * 100);
  const displayedLife = mode === "arena" && hud ? hud.life : characterStats?.maxLife ?? 0;
  const displayedMaxLife = mode === "arena" && hud ? hud.maxLife : characterStats?.maxLife ?? 0;
  const displayedMana = mode === "arena" && hud ? hud.focus : characterStats?.maxFocus ?? 0;
  const displayedMaxMana = mode === "arena" && hud ? hud.maxFocus : characterStats?.maxFocus ?? 0;

  return (
    <main className={`pixel-shell mode-${mode} ${paused ? "world-input-paused" : ""}`}>
      <div ref={parentRef} className="phaser-stage" aria-label={`${mode} pixel-art game world`} />
      {loading && <div className="world-loader"><span /><strong>Opening the wild forge</strong><small>Preparing the pixel world</small></div>}
      {rendererError && <div className="world-loader world-error"><strong>The game renderer could not start</strong><small>Enable WebGL or Canvas support, then reload.</small></div>}
      {mode === "arena" && hud && (
        <>
          <div className="world-wave"><span>Wave</span><strong>{hud.wave}<em>/{arenaBalance?.waves ?? ARENA_RULES.totalWaves}</em></strong><small>{hud.enemies} remain{hud.nextWaveIn !== null ? ` · next in ${Math.ceil(hud.nextWaveIn)}s` : " · final wave"}</small></div>
          <div className="world-loot"><span>{hud.lootCollected} collected</span><strong>{hud.groundDrops}</strong><small>drops on ground</small></div>
          {hud.arenaComplete && (
            <div className="arena-complete-banner" role="status" aria-live="polite">
              <span>Map Cleared</span>
              <strong>Return portal opened</strong>
              <small>Collect any remaining loot, then enter the portal to return to your hideout.</small>
            </div>
          )}
        </>
      )}
      {mode !== "class-select" && characterProgress && characterStats && (
        <div className="world-hud-safe-area" aria-label="Character resources">
          <div className="world-vitals">
            <ResourceGlobe kind="life" label="Life" current={displayedLife} maximum={displayedMaxLife} />
            <ResourceGlobe kind="mana" label="Mana" current={displayedMana} maximum={displayedMaxMana} />
          </div>
          <div className="world-action-bar" aria-label="Sorceress skills">
            <button type="button" className="action-slot lance-slot" disabled={mode !== "arena"} data-tooltip={`${BASIC_ATTACK.name} · Basic fire attack`} onClick={() => runtimeRef.current?.useSkill("basic")}>
              <span className="skill-icon"><i /></span><kbd>{BASIC_ATTACK.key}</kbd>
            </button>
            <button type="button" className="action-slot nova-slot" disabled={mode !== "arena" || !novaReady} data-tooltip={`${resolvedNova.name} · Level ${resolvedNova.level}`} onClick={() => runtimeRef.current?.useSkill("nova")}>
              <span className="skill-cooldown" style={{ height: `${novaProgress}%` }} />
              <span className="skill-icon"><i /></span><kbd>{ACTIVE_SKILLS.nova.key}</kbd>
              {hud && hud.novaCooldown > 0.05 && <strong>{hud.novaCooldown.toFixed(1)}</strong>}
            </button>
            <button type="button" className="action-slot rift-slot" disabled={mode !== "arena" || !riftReady} data-tooltip={`${resolvedDash.name} · Level ${resolvedDash.level}`} onClick={() => runtimeRef.current?.useSkill("dash")}>
              <span className="skill-cooldown" style={{ height: `${riftProgress}%` }} />
              <span className="skill-icon"><i /></span><kbd>{ACTIVE_SKILLS.dash.key}</kbd>
              {hud && <span className="slot-charges" aria-label={`${hud.riftCharges} of ${hud.riftMaxCharges} charges`}>{hud.riftCharges}</span>}
            </button>
            <button type="button" className={`action-slot ward-slot ${hud && hud.wardRemaining > 0 ? "is-active" : ""}`} disabled={mode !== "arena" || !wardReady} data-tooltip={`${resolvedWard.name} · ${resolvedWard.damageReduction}% less damage for ${resolvedWard.duration}s`} onClick={() => runtimeRef.current?.useSkill("ward")}>
              <span className="skill-cooldown" style={{ height: `${wardProgress}%` }} />
              <span className="skill-icon"><i /></span><kbd>{ACTIVE_SKILLS.ward.key}</kbd>
              {hud && hud.wardCooldown > 0.05 && <strong>{hud.wardCooldown.toFixed(1)}</strong>}
            </button>
          </div>
          <div className="world-flask-belt" aria-label="Flask belt">
            {flaskBelt.map((flask, index) => {
              const definition = flask ? FLASK_DEFINITIONS[flask.baseId] : null;
              const resourceFull = definition?.resource === "life"
                ? !hud || hud.life >= hud.maxLife
                : !hud || hud.focus >= hud.maxFocus;
              return (
                <button
                  type="button"
                  className={`flask-hotkey ${definition ? `flask-${definition.resource}` : "empty"}`}
                  disabled={mode !== "arena" || !flask || resourceFull}
                  data-tooltip={definition ? `${definition.name} · Restores ${definition.recovery} ${definition.resource}` : "Empty flask slot"}
                  onClick={() => runtimeRef.current?.useFlask(index)}
                  key={index}
                >
                  {definition && <span className="flask-icon" style={{ "--flask-icon": `url(${definition.icon})` } as CSSProperties} />}
                  <kbd>{index + 1}</kbd>
                  {flask && <strong>{flask.stackSize}</strong>}
                </button>
              );
            })}
          </div>
          <div className="world-experience" aria-label={`Level ${characterProgress.level} experience`}>
            <span><strong>Level {characterProgress.level}</strong><small>{characterProgress.level === MAX_CHARACTER_LEVEL ? "Maximum level" : `${characterProgress.xp} / ${xpRequired} XP`}</small></span>
            <i><b style={{ width: `${xpPercent}%` }} /></i>
          </div>
        </div>
      )}
      {hud && <div className="world-fps">{hud.fps} FPS · WebGL sprites</div>}
      {mode !== "class-select" && characterStats && (
        <aside className="world-character-stats" aria-label="Character statistics">
          <header><span>Character · select a stat for sources</span><strong>Combat Stats</strong></header>
          <div className="character-stat-list">
            <CharacterStatRow stat="strength" label="Strength" value={`${characterStats.strength}`} resolution={characterStatBreakdown?.strength} />
            <CharacterStatRow stat="dexterity" label="Dexterity" value={`${characterStats.dexterity}`} resolution={characterStatBreakdown?.dexterity} />
            <CharacterStatRow stat="intelligence" label="Intelligence" value={`${characterStats.intelligence}`} resolution={characterStatBreakdown?.intelligence} />
            <CharacterStatRow stat="maxLife" label="Health" value={`${mode === "arena" && hud ? `${Math.ceil(hud.life)} / ` : ""}${Math.round(characterStats.maxLife)}`} resolution={characterStatBreakdown?.maxLife} />
            <CharacterStatRow stat="maxFocus" label="Focus" hint="Mana" value={`${mode === "arena" && hud ? `${Math.floor(hud.focus)} / ` : ""}${Math.round(characterStats.maxFocus)}`} resolution={characterStatBreakdown?.maxFocus} />
            <CharacterStatRow stat="attackDamage" label="Damage" value={characterStats.attackDamage.toFixed(1)} resolution={characterStatBreakdown?.attackDamage} />
            <CharacterStatRow stat="attackSpeed" label="Attack speed" value={`${characterStats.attackSpeed.toFixed(2)}/s`} resolution={characterStatBreakdown?.attackSpeed} />
            <CharacterStatRow stat="armor" label="Armor" value={`${Math.round(characterStats.armor)}`} resolution={characterStatBreakdown?.armor} />
            <CharacterStatRow stat="evadeChance" label="Evade" value={`${characterStats.evadeChance.toFixed(1)}%`} resolution={characterStatBreakdown?.evadeChance} />
            <CharacterStatRow stat="moveSpeed" label="Move speed" value={`${Math.round(characterStats.moveSpeed)}`} resolution={characterStatBreakdown?.moveSpeed} />
          </div>
        </aside>
      )}
      {children}
    </main>
  );
}
