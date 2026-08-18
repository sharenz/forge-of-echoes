"use client";

import { useEffect, useRef, useState } from "react";
import { ACTIVE_SKILLS, BASIC_ATTACK, type ArenaBalance, type ArenaSummary, type MapDrop } from "../game/combat";
import { ARENA_RULES } from "../game/config/arena";
import { DAMAGE_TYPE_DEFINITIONS } from "../game/config/damage";
import { MAX_CHARACTER_LEVEL, XP_BY_LEVEL } from "../game/config/progression";
import type { SkillDefinition } from "../game/config/schema";
import type { CharacterClassId, CharacterProgress, CharacterStats, StatKey, StatModifier } from "../game/domain";
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
  onStation?: (station: WorldStation) => void;
  onLootPickup?: (drop: MapDrop) => boolean;
  onExperienceGain?: (amount: number) => void;
  onArenaComplete?: (summary: ArenaSummary) => void;
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

function damageSummary(damage: NonNullable<SkillDefinition["damage"]>): string {
  const minimum = Math.round(damage.effectiveness * damage.range.minMultiplier * 100);
  const maximum = Math.round(damage.effectiveness * damage.range.maxMultiplier * 100);
  return `${minimum}–${maximum}% ${DAMAGE_TYPE_DEFINITIONS[damage.type].label} damage`;
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

export function PhaserWorld({ mode, classId, portalActive = false, paused = false, arenaBalance, characterStats, characterProgress, characterStatBreakdown, onStation, onLootPickup, onExperienceGain, onArenaComplete, children }: PhaserWorldProps) {
  const runtimeClassId = mode === "class-select" ? "amazon" : classId;
  const novaLevel = characterProgress?.skillLevels.nova ?? 1;
  const dashLevel = characterProgress?.skillLevels.dash ?? 1;
  const parentRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<PhaserRuntime | null>(null);
  const stationCallbackRef = useRef(onStation);
  const lootCallbackRef = useRef(onLootPickup);
  const completionCallbackRef = useRef(onArenaComplete);
  const experienceCallbackRef = useRef(onExperienceGain);
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
    experienceCallbackRef.current = onExperienceGain;
  }, [onArenaComplete, onExperienceGain, onLootPickup, onStation]);

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
        arenaBalance: arenaBalanceRef.current,
        onStation: (station) => stationCallbackRef.current?.(station),
        onHud: setHud,
        onLootPickup: (drop) => lootCallbackRef.current?.(drop) ?? false,
        onExperienceGain: (amount) => experienceCallbackRef.current?.(amount),
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

  const resolvedNova = resolveSkillDefinition(ACTIVE_SKILLS.nova, novaLevel);
  const resolvedDash = resolveSkillDefinition(ACTIVE_SKILLS.dash, dashLevel);
  const novaReady = Boolean(hud && hud.novaCooldown <= 0.05 && hud.focus >= resolvedNova.focusCost);
  const riftReady = Boolean(hud && hud.riftCharges > 0 && hud.focus >= resolvedDash.focusCost);
  const novaProgress = hud ? Math.min(100, (hud.novaCooldown / resolvedNova.cooldown) * 100) : 0;
  const riftProgress = hud ? Math.min(100, (hud.riftRecharge / resolvedDash.recharge) * 100) : 0;
  const xpRequired = characterProgress ? XP_BY_LEVEL(characterProgress.level) : 1;
  const xpPercent = characterProgress?.level === MAX_CHARACTER_LEVEL ? 100 : Math.min(100, ((characterProgress?.xp ?? 0) / xpRequired) * 100);

  return (
    <main className={`pixel-shell mode-${mode} ${paused ? "world-input-paused" : ""}`}>
      <div ref={parentRef} className="phaser-stage" aria-label={`${mode} pixel-art game world`} />
      {loading && <div className="world-loader"><span /><strong>Opening the wild forge</strong><small>Preparing the pixel world</small></div>}
      {rendererError && <div className="world-loader world-error"><strong>The game renderer could not start</strong><small>Enable WebGL or Canvas support, then reload.</small></div>}
      {mode === "arena" && hud && (
        <>
          <div className="world-wave"><span>Wave</span><strong>{hud.wave}<em>/{arenaBalance?.waves ?? ARENA_RULES.totalWaves}</em></strong><small>{hud.enemies} remain{hud.nextWaveIn !== null ? ` · next in ${Math.ceil(hud.nextWaveIn)}s` : " · final wave"}</small></div>
          <div className="world-loot"><span>{hud.lootCollected} collected</span><strong>{hud.groundDrops}</strong><small>drops on ground</small></div>
          <div className="world-vitals">
            <div><span>Life</span><i><b style={{ width: `${(hud.life / hud.maxLife) * 100}%` }} /></i><strong>{Math.ceil(hud.life)}</strong></div>
            <div><span>Focus</span><i><b style={{ width: `${(hud.focus / hud.maxFocus) * 100}%` }} /></i><strong>{Math.floor(hud.focus)}</strong></div>
          </div>
          <div className="world-skills">
            <span className="basic-skill"><kbd>{BASIC_ATTACK.key}</kbd><span><strong>{BASIC_ATTACK.name}</strong><small>{damageSummary(BASIC_ATTACK.damage)}</small></span></span>
            <button type="button" className="active-skill" disabled={!novaReady} onClick={() => runtimeRef.current?.useSkill("nova")}>
              <i className="skill-recharge" style={{ width: `${novaProgress}%` }} />
              <kbd>{ACTIVE_SKILLS.nova.key}</kbd>
              <span><strong>{resolvedNova.name} · Lv {resolvedNova.level}</strong><small>{hud.novaCooldown > 0.05 ? `${hud.novaCooldown.toFixed(1)}s recharge` : hud.focus < resolvedNova.focusCost ? `Needs ${resolvedNova.focusCost} Focus` : `Ready · ${damageSummary(resolvedNova.damage!)} · ${resolvedNova.projectileCount} bolts · ${resolvedNova.piercing} pierce`}</small></span>
            </button>
            <button type="button" className="active-skill rift-skill" disabled={!riftReady} onClick={() => runtimeRef.current?.useSkill("dash")}>
              <i className="skill-recharge" style={{ width: `${riftProgress}%` }} />
              <kbd>{ACTIVE_SKILLS.dash.key}</kbd>
              <span><strong>{resolvedDash.name} · Lv {resolvedDash.level}</strong><small>{hud.riftCharges}/{hud.riftMaxCharges} charges{hud.riftCharges < hud.riftMaxCharges ? ` · +1 in ${hud.riftRecharge.toFixed(1)}s` : ` · ${resolvedDash.focusCost} Focus`}</small></span>
              <span className="skill-charges" aria-label={`${hud.riftCharges} of ${hud.riftMaxCharges} Rift Step charges`}>
                {Array.from({ length: hud.riftMaxCharges }, (_, index) => <i className={index < hud.riftCharges ? "ready" : ""} key={index} />)}
              </span>
            </button>
          </div>
          {hud.arenaComplete && (
            <div className="arena-complete-banner" role="status" aria-live="polite">
              <span>Map Cleared</span>
              <strong>Return portal opened</strong>
              <small>Collect any remaining loot, then enter the portal to return to your hideout.</small>
            </div>
          )}
        </>
      )}
      {mode !== "class-select" && characterProgress && (
        <div className="world-experience" aria-label={`Level ${characterProgress.level} experience`}>
          <span><strong>Level {characterProgress.level}</strong><small>{characterProgress.level === MAX_CHARACTER_LEVEL ? "Maximum level" : `${characterProgress.xp} / ${xpRequired} XP`}</small></span>
          <i><b style={{ width: `${xpPercent}%` }} /></i>
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
