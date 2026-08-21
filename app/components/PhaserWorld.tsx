"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ACTIVE_SKILLS, BASIC_ATTACK, type ArenaBalance } from "../game/combat";
import { ARENA_RULES } from "../game/config/arena";
import { FLASK_DEFINITIONS } from "../game/config/flasks";
import { MAP_MODIFIERS } from "../game/config/maps";
import type { MerchantId } from "../game/config/merchants";
import { MAX_CHARACTER_LEVEL, XP_BY_LEVEL } from "../game/config/progression";
import type { CharacterClassId, CharacterProgress, CharacterStats, FlaskBelt, MapItem, SkillBarSkillId, SkillLoadout, StatKey, StatModifier } from "../game/domain";
import { mapModifierDescription, mapModifierRewardDescription } from "../game/maps";
import { grantCharacterProgressExperience } from "../game/progression";
import { resolveSkillDefinition, type ResolvedSkillDefinition } from "../game/skills";
import { DEFAULT_SKILL_LOADOUT, SKILL_BAR_SLOTS } from "../game/skill-loadout";
import type { CharacterStatCalculation, StatResolution } from "../game/stats";
import type { PhaserRuntime } from "../game2d/PhaserRuntime";
import type { MultiplayerWorldAdapter, WorldHudState, WorldMode, WorldStation } from "../game2d/types";

interface PhaserWorldProps {
  mode: WorldMode;
  classId: CharacterClassId;
  portalIndexes?: readonly number[];
  merchantIds?: readonly MerchantId[];
  paused?: boolean;
  controlsBlocked?: boolean;
  arenaBalance?: ArenaBalance;
  activeMap?: MapItem;
  characterStats?: CharacterStats;
  characterProgress?: CharacterProgress;
  characterStatBreakdown?: CharacterStatCalculation["breakdown"];
  flaskBelt?: FlaskBelt;
  onStation?: (station: WorldStation, portalIndex?: number) => void;
  onReturnToHideout?: () => void;
  onFlaskLoad?: (itemId: string, slotIndex: number) => void;
  onItemDropToGround?: (itemId: string) => void;
  onFinalRageChange?: (active: boolean) => void;
  multiplayer?: MultiplayerWorldAdapter;
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
  const value = compactNumber(Math.abs(modifier.value));
  if (modifier.mode === "flat") return `${modifier.value >= 0 ? "+" : "-"}${value}`;
  if (modifier.mode === "increased") return `${value}% ${modifier.value >= 0 ? "increased" : "reduced"}`;
  return `${value}% ${modifier.value >= 0 ? "more" : "less"}`;
}

interface ResourceGlobeProps {
  kind: "life" | "mana";
  label: string;
  current: number;
  maximum: number;
}

type ResolvedSkillBar = Record<SkillBarSkillId, ResolvedSkillDefinition>;

function skillActionView(
  skill: SkillBarSkillId,
  definitions: ResolvedSkillBar,
  hud: WorldHudState | null,
  readiness: { novaReady: boolean; riftReady: boolean; wardReady: boolean; flameWaveReady: boolean },
  progress: { novaProgress: number; riftProgress: number; wardProgress: number; flameWaveProgress: number },
) {
  const definition = definitions[skill];
  if (skill === "basic") return {
    className: "lance-slot", ready: true, progress: 0, cooldown: 0, active: false,
    tooltip: `${definition.name} · Basic fire attack`,
  };
  if (skill === "nova") return {
    className: "nova-slot", ready: readiness.novaReady, progress: progress.novaProgress,
    cooldown: hud?.novaCooldown ?? 0, active: false,
    tooltip: `${definition.name} · Level ${definition.level} · ${definition.castTime.toFixed(2)}s cast`,
  };
  if (skill === "dash") return {
    className: "rift-slot", ready: readiness.riftReady, progress: progress.riftProgress,
    cooldown: 0, active: false, tooltip: `${definition.name} · Level ${definition.level}`,
  };
  if (skill === "ward") return {
    className: "ward-slot", ready: readiness.wardReady, progress: progress.wardProgress,
    cooldown: hud?.wardCooldown ?? 0, active: Boolean(hud && hud.wardRemaining > 0),
    tooltip: `${definition.name} · Level ${definition.level} · ${definition.castTime.toFixed(2)}s cast · ${Math.round(definition.damageReduction)}% less damage for ${definition.duration.toFixed(1)}s`,
  };
  return {
    className: "flame-wave-slot", ready: readiness.flameWaveReady, progress: progress.flameWaveProgress,
    cooldown: hud?.flameWaveCooldown ?? 0, active: false,
    tooltip: `${definition.name} · Level ${definition.level} · ${definition.castTime.toFixed(2)}s cast · ${definition.projectileCount} piercing projectiles`,
  };
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
            <span>{compactNumber(Math.abs(resolution.increased))}% {resolution.increased >= 0 ? "increased" : "reduced"}</span>
            {resolution.more.length > 0 && <span>{resolution.more.map((value) => `${compactNumber(Math.abs(value))}% ${value >= 0 ? "more" : "less"}`).join(" × ")}</span>}
          </footer>
        </div>
      )}
    </details>
  );
}

const EMPTY_FLASK_BELT: FlaskBelt = [null, null, null, null, null];

export function PhaserWorld({ mode, classId, portalIndexes = [], merchantIds = [], paused = false, controlsBlocked = false, arenaBalance, activeMap, characterStats, characterProgress, characterStatBreakdown, flaskBelt = EMPTY_FLASK_BELT, onStation, onReturnToHideout, onFlaskLoad, onItemDropToGround, onFinalRageChange, multiplayer, children }: PhaserWorldProps) {
  const runtimeClassId = classId;
  const novaLevel = characterProgress?.skillLevels.nova ?? 1;
  const dashLevel = characterProgress?.skillLevels.dash ?? 1;
  const wardLevel = characterProgress?.skillLevels.ward ?? 1;
  const flameWaveLevel = characterProgress?.skillLevels.flameWave ?? 1;
  const skillLoadout = characterProgress?.skillLoadout ?? DEFAULT_SKILL_LOADOUT;
  const parentRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<PhaserRuntime | null>(null);
  const stationCallbackRef = useRef(onStation);
  const returnToHideoutCallbackRef = useRef(onReturnToHideout);
  const flaskBeltRef = useRef(flaskBelt);
  const portalIndexesRef = useRef([...portalIndexes]);
  const merchantIdsKey = merchantIds.join("|");
  const skillLevelsRef = useRef({ nova: novaLevel, dash: dashLevel, ward: wardLevel, flameWave: flameWaveLevel });
  const skillLoadoutRef = useRef<SkillLoadout>([...skillLoadout]);
  const pausedRef = useRef(paused);
  const controlsBlockedRef = useRef(controlsBlocked);
  const arenaBalanceRef = useRef(arenaBalance);
  const [hud, setHud] = useState<WorldHudState | null>(null);
  const [flaskDropSlot, setFlaskDropSlot] = useState<number | null>(null);
  const [groundDropReady, setGroundDropReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rendererError, setRendererError] = useState(false);

  useEffect(() => {
    stationCallbackRef.current = onStation;
    returnToHideoutCallbackRef.current = onReturnToHideout;
  }, [onReturnToHideout, onStation]);

  useEffect(() => {
    flaskBeltRef.current = flaskBelt;
    runtimeRef.current?.updateFlaskBelt(flaskBelt);
  }, [flaskBelt]);

  useEffect(() => {
    portalIndexesRef.current = [...portalIndexes];
    runtimeRef.current?.updatePortalIndexes(portalIndexesRef.current);
  }, [portalIndexes]);

  useEffect(() => {
    pausedRef.current = paused;
    runtimeRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    controlsBlockedRef.current = controlsBlocked;
    runtimeRef.current?.setControlsBlocked(controlsBlocked);
  }, [controlsBlocked]);

  useEffect(() => {
    arenaBalanceRef.current = arenaBalance;
    if (arenaBalance) runtimeRef.current?.updateArenaBalance(arenaBalance);
  }, [arenaBalance]);

  useEffect(() => {
    onFinalRageChange?.(Boolean(hud?.finalRageActive));
  }, [hud?.finalRageActive, onFinalRageChange]);

  useEffect(() => () => onFinalRageChange?.(false), [onFinalRageChange]);

  useEffect(() => {
    const skillLevels = { nova: novaLevel, dash: dashLevel, ward: wardLevel, flameWave: flameWaveLevel };
    skillLevelsRef.current = skillLevels;
    runtimeRef.current?.updateSkillLevels(skillLevels);
  }, [novaLevel, dashLevel, wardLevel, flameWaveLevel]);

  useEffect(() => {
    skillLoadoutRef.current = [...(characterProgress?.skillLoadout ?? DEFAULT_SKILL_LOADOUT)];
    runtimeRef.current?.updateSkillLoadout(skillLoadoutRef.current);
  }, [characterProgress?.skillLoadout]);

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
        portalIndexes: portalIndexesRef.current,
        merchantIds: merchantIdsKey ? merchantIdsKey.split("|") as MerchantId[] : [],
        paused: pausedRef.current,
        controlsBlocked: controlsBlockedRef.current,
        skillLevels: skillLevelsRef.current,
        skillLoadout: skillLoadoutRef.current,
        flaskBelt: flaskBeltRef.current,
        arenaBalance: arenaBalanceRef.current,
        onStation: (station, portalIndex) => stationCallbackRef.current?.(station, portalIndex),
        onHud: setHud,
        onReturnToHideout: () => returnToHideoutCallbackRef.current?.(),
        multiplayer,
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
  }, [merchantIdsKey, mode, multiplayer, runtimeClassId]);

  const cooldownMultiplier = characterStats?.skillCooldown ?? 1;
  const castSpeedMultiplier = characterStats?.castSpeed ?? 1;
  const resolvedNova = resolveSkillDefinition(ACTIVE_SKILLS.nova, novaLevel, cooldownMultiplier, castSpeedMultiplier);
  const resolvedBasic = resolveSkillDefinition(BASIC_ATTACK, 1);
  const resolvedDash = resolveSkillDefinition(ACTIVE_SKILLS.dash, dashLevel, cooldownMultiplier, castSpeedMultiplier);
  const resolvedWard = resolveSkillDefinition(ACTIVE_SKILLS.ward, wardLevel, cooldownMultiplier, castSpeedMultiplier);
  const resolvedFlameWave = resolveSkillDefinition(ACTIVE_SKILLS.flameWave, flameWaveLevel, cooldownMultiplier, castSpeedMultiplier);
  const novaReady = Boolean(hud && hud.novaCooldown <= 0.05 && hud.focus >= resolvedNova.focusCost);
  const riftReady = Boolean(hud && hud.riftCharges > 0 && hud.focus >= resolvedDash.focusCost);
  const wardReady = Boolean(hud && hud.wardCooldown <= 0.05 && hud.focus >= resolvedWard.focusCost);
  const flameWaveReady = Boolean(hud && hud.flameWaveCooldown <= 0.05 && hud.focus >= resolvedFlameWave.focusCost);
  const novaProgress = hud ? Math.min(100, (hud.novaCooldown / resolvedNova.cooldown) * 100) : 0;
  const riftProgress = hud ? Math.min(100, (hud.riftRecharge / resolvedDash.recharge) * 100) : 0;
  const wardProgress = hud ? Math.min(100, (hud.wardCooldown / resolvedWard.cooldown) * 100) : 0;
  const flameWaveProgress = hud ? Math.min(100, (hud.flameWaveCooldown / resolvedFlameWave.cooldown) * 100) : 0;
  const displayedProgress = characterProgress
    ? grantCharacterProgressExperience(characterProgress, hud?.pendingExperience ?? 0).character
    : undefined;
  const xpRequired = displayedProgress ? XP_BY_LEVEL(displayedProgress.level) : 1;
  const xpPercent = displayedProgress?.level === MAX_CHARACTER_LEVEL ? 100 : Math.min(100, ((displayedProgress?.xp ?? 0) / xpRequired) * 100);
  const displayedLife = mode === "arena" && hud ? hud.life : characterStats?.maxLife ?? 0;
  const displayedMaxLife = mode === "arena" && hud ? hud.maxLife : characterStats?.maxLife ?? 0;
  const displayedMana = mode === "arena" && hud ? hud.focus : characterStats?.maxFocus ?? 0;
  const displayedMaxMana = mode === "arena" && hud ? hud.maxFocus : characterStats?.maxFocus ?? 0;
  const currentWaveBalance = arenaBalance?.waveStats[Math.max(0, Math.min(arenaBalance.waveStats.length - 1, (hud?.wave ?? 1) - 1))];
  const finalRageProgress = hud?.finalRageIn !== null && hud?.finalRageIn !== undefined
    ? Math.max(0, Math.min(100, ((ARENA_RULES.finalWaveRageDelaySeconds - hud.finalRageIn) / ARENA_RULES.finalWaveRageDelaySeconds) * 100))
    : 100;

  return (
    <main
      className={`pixel-shell mode-${mode} ${paused ? "world-input-paused" : ""} ${groundDropReady ? "world-ground-drop-ready" : ""}`}
      onPointerDownCapture={(event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("button, input, textarea, select, [role='button'], .world-panel")) {
          runtimeRef.current?.cancelCombatInput();
        }
      }}
      onDragOver={(event) => {
        if (!onItemDropToGround || event.defaultPrevented) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(".world-panel")) return;
        const itemDrag = Array.from(event.dataTransfer.types).some((type) => type === "application/x-forge-of-echoes-item" || type === "text/plain");
        if (!itemDrag) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setGroundDropReady(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setGroundDropReady(false);
      }}
      onDragEnd={() => setGroundDropReady(false)}
      onDrop={(event) => {
        if (!onItemDropToGround || event.defaultPrevented) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(".world-panel")) return;
        event.preventDefault();
        const itemId = event.dataTransfer.getData("application/x-forge-of-echoes-item") || event.dataTransfer.getData("text/plain");
        if (itemId) onItemDropToGround(itemId);
        setGroundDropReady(false);
      }}
    >
      <div ref={parentRef} className="phaser-stage" aria-label={`${mode} pixel-art game world`} />
      {groundDropReady && <div className="world-ground-drop-hint" role="status"><span>↓</span><strong>Release to drop beside your character</strong></div>}
      {loading && <div className="world-loader"><span /><strong>Opening the wild forge</strong><small>Preparing the pixel world</small></div>}
      {rendererError && <div className="world-loader world-error"><strong>The game renderer could not start</strong><small>Enable WebGL or Canvas support, then reload.</small></div>}
      {mode === "arena" && hud && (
        <>
          <div className={`world-wave ${hud.finalRageActive ? "is-enraged" : hud.finalRageIn !== null ? "rage-countdown" : ""}`} role="status" aria-live="polite">
            <span>{hud.finalRageActive ? "Final Rage" : "Wave"}</span>
            <strong>{hud.wave}<em>/{arenaBalance?.waves ?? ARENA_RULES.totalWaves}</em></strong>
            <small>{hud.enemies} remain{hud.nextWaveIn !== null
              ? ` · next in ${Math.ceil(hud.nextWaveIn)}s`
              : hud.finalRageActive
                ? " · all monsters are hunting"
                : hud.finalRageIn !== null
                  ? ` · rage in ${Math.ceil(hud.finalRageIn)}s`
                  : " · final wave"}</small>
            {hud.finalRageIn !== null && <i className="final-rage-meter" aria-hidden="true"><b style={{ width: `${finalRageProgress}%` }} /></i>}
          </div>
          <div className="world-loot"><strong>{hud.groundDrops}</strong><small>drops on ground</small></div>
          {hud.arenaComplete && (
            <div className="arena-complete-banner" role="status" aria-live="polite">
              <span>Map Cleared</span>
              <strong>Victory cache manifested</strong>
              <small>Open your reward chest, collect its loot, then enter the portal to return to your hideout.</small>
            </div>
          )}
        </>
      )}
      {mode !== "loading" && characterProgress && characterStats && (
        <div className="world-hud-safe-area" aria-label="Character resources">
          <div className="world-bottom-hud">
            <div className="world-command-deck">
              <ResourceGlobe kind="life" label="Life" current={displayedLife} maximum={displayedMaxLife} />
              <div className="world-command-row">
                <div className="world-flask-belt" aria-label="Flask belt">
                  <span className="hud-section-label">Flasks</span>
                  {flaskBelt.map((flask, index) => {
                    const definition = flask ? FLASK_DEFINITIONS[flask.baseId] : null;
                    const resourceFull = definition?.resource === "life"
                      ? !hud || hud.life >= hud.maxLife
                      : !hud || hud.focus >= hud.maxFocus;
                    return (
                      <div
                        className={`world-flask-slot-target ${flaskDropSlot === index ? "drop-ready" : ""}`}
                        onDragOver={(event) => { if (onFlaskLoad) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setFlaskDropSlot(index); } }}
                        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFlaskDropSlot(null); }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const itemId = event.dataTransfer.getData("application/x-forge-of-echoes-item") || event.dataTransfer.getData("text/plain");
                          if (itemId) onFlaskLoad?.(itemId, index);
                          setFlaskDropSlot(null);
                        }}
                        key={index}
                      >
                        <button
                          type="button"
                          className={`flask-hotkey ${definition ? `flask-${definition.resource}` : "empty"}`}
                          disabled={mode !== "arena" || !flask || flask.stackSize <= 0 || resourceFull}
                          data-tooltip={definition ? `${definition.name} · Restores ${definition.recovery} ${definition.resource}` : "Empty flask slot · drag a flask here"}
                          onClick={() => runtimeRef.current?.useFlask(index)}
                        >
                          {definition && <span className="flask-icon" style={{ "--flask-icon": `url(${definition.icon})` } as CSSProperties} />}
                          <kbd>{index + 1}</kbd>
                          {flask && <strong>{flask.stackSize}</strong>}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <i className="command-deck-divider" aria-hidden="true" />
                <div className="world-action-bar" aria-label="Sorceress skills">
                  <span className="hud-section-label">Skills</span>
                  {SKILL_BAR_SLOTS.map((slot) => {
                    const skill = skillLoadout[slot.index];
                    if (!skill) return (
                      <button type="button" className="action-slot empty-skill-slot" disabled data-tooltip={`Empty skill slot · ${slot.key}`} key={slot.index}>
                        <span className="skill-icon"><i /></span><kbd>{slot.key}</kbd>
                      </button>
                    );
                    const view = skillActionView(skill, {
                      basic: resolvedBasic, nova: resolvedNova, dash: resolvedDash, ward: resolvedWard, flameWave: resolvedFlameWave,
                    }, hud, { novaReady, riftReady, wardReady, flameWaveReady }, { novaProgress, riftProgress, wardProgress, flameWaveProgress });
                    return (
                      <button type="button" className={`action-slot ${view.className} ${view.active ? "is-active" : ""}`} disabled={mode !== "arena" || !view.ready} data-tooltip={view.tooltip} onClick={() => runtimeRef.current?.useSkill(skill)} key={slot.index}>
                        {view.progress > 0 && <span className="skill-cooldown" style={{ height: `${view.progress}%` }} />}
                        <span className="skill-icon"><i /></span><kbd>{slot.key}</kbd>
                        {view.cooldown > 0.05 && <strong>{view.cooldown.toFixed(1)}</strong>}
                        {skill === "dash" && hud && <span className="slot-charges" aria-label={`${hud.riftCharges} of ${hud.riftMaxCharges} charges`}>{hud.riftCharges}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div
                className="world-experience"
                aria-label={`Level ${displayedProgress?.level ?? characterProgress.level} experience`}
                aria-valuemin={0}
                aria-valuemax={characterProgress.level === MAX_CHARACTER_LEVEL ? 100 : xpRequired}
                aria-valuenow={displayedProgress?.level === MAX_CHARACTER_LEVEL ? 100 : displayedProgress?.xp ?? characterProgress.xp}
                data-tooltip={displayedProgress?.level === MAX_CHARACTER_LEVEL ? `Level ${displayedProgress.level} · Maximum level` : `Level ${displayedProgress?.level ?? characterProgress.level} · ${displayedProgress?.xp ?? characterProgress.xp} / ${xpRequired} XP`}
                role="progressbar"
                tabIndex={0}
              >
                <i><b style={{ width: `${xpPercent}%` }} /></i>
              </div>
              <ResourceGlobe kind="mana" label="Mana" current={displayedMana} maximum={displayedMaxMana} />
            </div>
          </div>
        </div>
      )}
      {hud && <div className="world-fps">{hud.fps} FPS · WebGL sprites</div>}
      {mode !== "loading" && characterStats && (
        <div className="world-stat-stack">
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
              <CharacterStatRow stat="castSpeed" label="Cast speed" value={`${(characterStats.castSpeed * 100).toFixed(0)}%`} resolution={characterStatBreakdown?.castSpeed} />
              <CharacterStatRow stat="focusRegen" label="Focus regen" hint="Mana per second" value={`${characterStats.focusRegen.toFixed(1)}/s`} resolution={characterStatBreakdown?.focusRegen} />
              <CharacterStatRow stat="skillCooldown" label="Skill cooldown" value={`${(characterStats.skillCooldown * 100).toFixed(0)}%`} resolution={characterStatBreakdown?.skillCooldown} />
              <CharacterStatRow stat="armor" label="Armor" value={`${Math.round(characterStats.armor)}`} resolution={characterStatBreakdown?.armor} />
              <CharacterStatRow stat="evadeChance" label="Evade" value={`${characterStats.evadeChance.toFixed(1)}%`} resolution={characterStatBreakdown?.evadeChance} />
              <CharacterStatRow stat="moveSpeed" label="Move speed" value={`${Math.round(characterStats.moveSpeed)}`} resolution={characterStatBreakdown?.moveSpeed} />
            </div>
          </aside>
          {mode === "arena" && activeMap && arenaBalance && currentWaveBalance && (
            <aside className={`world-map-stats rarity-${activeMap.rarity}`} aria-label="Map statistics">
              <header>
                <span>Active map · Tier {activeMap.tier}</span>
                <strong>{activeMap.baseName}</strong>
                <small>{activeMap.quality > 0 ? `+${activeMap.quality}% quality · ` : ""}{activeMap.rarity}</small>
              </header>
              <div className="map-stat-list">
                <div><span>Monster level</span><strong>{arenaBalance.monsterLevel}</strong></div>
                <div><span>Wave monsters</span><strong>{currentWaveBalance.monsterCount}</strong></div>
                <div><span>Monster life</span><strong>{Math.round(currentWaveBalance.monsterLife)}</strong></div>
                <div><span>Monster damage</span><strong>{currentWaveBalance.monsterDamage.toFixed(1)}</strong></div>
                <div><span>Item quantity</span><strong>+{Math.round(currentWaveBalance.itemQuantity - 100)}%</strong></div>
                <div><span>Item rarity</span><strong>+{Math.round(currentWaveBalance.itemRarity - 100)}%</strong></div>
                <div><span>Monster rarity</span><strong>+{Math.round(currentWaveBalance.monsterRarity - 100)}%</strong></div>
              </div>
              <div className="map-active-modifiers">
                <h3>Map modifiers</h3>
                {activeMap.modifiers.length === 0
                  ? <p>Unmodified map</p>
                  : activeMap.modifiers.map((modifierId) => (
                    <div key={modifierId}>
                      <strong>{MAP_MODIFIERS[modifierId].name}</strong>
                      <span>{mapModifierDescription(modifierId, activeMap.tier)}</span>
                      <small>{mapModifierRewardDescription(modifierId)}</small>
                    </div>
                  ))}
              </div>
            </aside>
          )}
        </div>
      )}
      {children}
    </main>
  );
}
