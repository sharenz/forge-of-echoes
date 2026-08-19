"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import { ACTIVE_SKILLS, BASIC_ATTACK, type ArenaBalance, type ArenaSummary, type MapDrop } from "../game/combat";
import { ARENA_RULES } from "../game/config/arena";
import { FLASK_DEFINITIONS, type FlaskDefinition } from "../game/config/flasks";
import { MAP_MODIFIERS } from "../game/config/maps";
import { MAX_CHARACTER_LEVEL, XP_BY_LEVEL } from "../game/config/progression";
import type { CharacterClassId, CharacterProgress, CharacterStats, FlaskBelt, InventoryItem, MapItem, StatKey, StatModifier } from "../game/domain";
import { mapModifierDescription, mapModifierRewardDescription } from "../game/maps";
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
  activeMap?: MapItem;
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
  onFlaskLoad?: (itemId: string, slotIndex: number) => void;
  children?: React.ReactNode;
}

export interface PhaserWorldHandle {
  dropItem: (item: InventoryItem) => boolean;
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

const EMPTY_FLASK_BELT: FlaskBelt = [null, null, null, null, null];

export const PhaserWorld = forwardRef<PhaserWorldHandle, PhaserWorldProps>(function PhaserWorld({ mode, classId, portalActive = false, paused = false, arenaBalance, activeMap, characterStats, characterProgress, characterStatBreakdown, flaskBelt = EMPTY_FLASK_BELT, onStation, onLootPickup, onExperienceGain, onArenaComplete, onPlayerDeath, onFlaskUse, onFlaskLoad, children }, ref) {
  const runtimeClassId = mode === "class-select" ? "amazon" : classId;
  const novaLevel = characterProgress?.skillLevels.nova ?? 1;
  const dashLevel = characterProgress?.skillLevels.dash ?? 1;
  const wardLevel = characterProgress?.skillLevels.ward ?? 1;
  const flameWaveLevel = characterProgress?.skillLevels.flameWave ?? 1;
  const parentRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<PhaserRuntime | null>(null);
  const stationCallbackRef = useRef(onStation);
  const lootCallbackRef = useRef(onLootPickup);
  const completionCallbackRef = useRef(onArenaComplete);
  const deathCallbackRef = useRef(onPlayerDeath);
  const experienceCallbackRef = useRef(onExperienceGain);
  const flaskUseCallbackRef = useRef(onFlaskUse);
  const flaskBeltRef = useRef(flaskBelt);
  const skillLevelsRef = useRef({ nova: novaLevel, dash: dashLevel, ward: wardLevel, flameWave: flameWaveLevel });
  const pausedRef = useRef(paused);
  const arenaBalanceRef = useRef(arenaBalance);
  const [hud, setHud] = useState<WorldHudState | null>(null);
  const [flaskDropSlot, setFlaskDropSlot] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [rendererError, setRendererError] = useState(false);

  useImperativeHandle(ref, () => ({
    dropItem: (item) => runtimeRef.current?.dropInventoryItem(item) ?? false,
  }), []);

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
    const skillLevels = { nova: novaLevel, dash: dashLevel, ward: wardLevel, flameWave: flameWaveLevel };
    skillLevelsRef.current = skillLevels;
    runtimeRef.current?.updateSkillLevels(skillLevels);
  }, [novaLevel, dashLevel, wardLevel, flameWaveLevel]);

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
  const resolvedWard = resolveSkillDefinition(ACTIVE_SKILLS.ward, wardLevel);
  const resolvedFlameWave = resolveSkillDefinition(ACTIVE_SKILLS.flameWave, flameWaveLevel);
  const novaReady = Boolean(hud && hud.novaCooldown <= 0.05 && hud.focus >= resolvedNova.focusCost);
  const riftReady = Boolean(hud && hud.riftCharges > 0 && hud.focus >= resolvedDash.focusCost);
  const wardReady = Boolean(hud && hud.wardCooldown <= 0.05 && hud.focus >= resolvedWard.focusCost);
  const flameWaveReady = Boolean(hud && hud.flameWaveCooldown <= 0.05 && hud.focus >= resolvedFlameWave.focusCost);
  const novaProgress = hud ? Math.min(100, (hud.novaCooldown / resolvedNova.cooldown) * 100) : 0;
  const riftProgress = hud ? Math.min(100, (hud.riftRecharge / resolvedDash.recharge) * 100) : 0;
  const wardProgress = hud ? Math.min(100, (hud.wardCooldown / resolvedWard.cooldown) * 100) : 0;
  const flameWaveProgress = hud ? Math.min(100, (hud.flameWaveCooldown / resolvedFlameWave.cooldown) * 100) : 0;
  const xpRequired = characterProgress ? XP_BY_LEVEL(characterProgress.level) : 1;
  const xpPercent = characterProgress?.level === MAX_CHARACTER_LEVEL ? 100 : Math.min(100, ((characterProgress?.xp ?? 0) / xpRequired) * 100);
  const displayedLife = mode === "arena" && hud ? hud.life : characterStats?.maxLife ?? 0;
  const displayedMaxLife = mode === "arena" && hud ? hud.maxLife : characterStats?.maxLife ?? 0;
  const displayedMana = mode === "arena" && hud ? hud.focus : characterStats?.maxFocus ?? 0;
  const displayedMaxMana = mode === "arena" && hud ? hud.maxFocus : characterStats?.maxFocus ?? 0;
  const currentWaveBalance = arenaBalance?.waveStats[Math.max(0, Math.min(arenaBalance.waveStats.length - 1, (hud?.wave ?? 1) - 1))];
  const finalRageProgress = hud?.finalRageIn !== null && hud?.finalRageIn !== undefined
    ? Math.max(0, Math.min(100, ((ARENA_RULES.finalWaveRageDelaySeconds - hud.finalRageIn) / ARENA_RULES.finalWaveRageDelaySeconds) * 100))
    : 100;

  return (
    <main className={`pixel-shell mode-${mode} ${paused ? "world-input-paused" : ""}`}>
      <div ref={parentRef} className="phaser-stage" aria-label={`${mode} pixel-art game world`} />
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
          <div className="world-loot"><span>{hud.lootCollected} collected</span><strong>{hud.groundDrops}</strong><small>drops on ground</small></div>
          {hud.arenaComplete && (
            <div className="arena-complete-banner" role="status" aria-live="polite">
              <span>Map Cleared</span>
              <strong>Victory cache manifested</strong>
              <small>Open your reward chest, collect its loot, then enter the portal to return to your hideout.</small>
            </div>
          )}
        </>
      )}
      {mode !== "class-select" && characterProgress && characterStats && (
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
                          const itemId = event.dataTransfer.getData("application/x-crafty-item") || event.dataTransfer.getData("text/plain");
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
                  <button type="button" className={`action-slot ward-slot ${hud && hud.wardRemaining > 0 ? "is-active" : ""}`} disabled={mode !== "arena" || !wardReady} data-tooltip={`${resolvedWard.name} · Level ${resolvedWard.level} · ${Math.round(resolvedWard.damageReduction)}% less damage for ${resolvedWard.duration.toFixed(1)}s`} onClick={() => runtimeRef.current?.useSkill("ward")}>
                    <span className="skill-cooldown" style={{ height: `${wardProgress}%` }} />
                    <span className="skill-icon"><i /></span><kbd>{ACTIVE_SKILLS.ward.key}</kbd>
                    {hud && hud.wardCooldown > 0.05 && <strong>{hud.wardCooldown.toFixed(1)}</strong>}
                  </button>
                  <button type="button" className="action-slot flame-wave-slot" disabled={mode !== "arena" || !flameWaveReady} data-tooltip={`${resolvedFlameWave.name} · Level ${resolvedFlameWave.level} · ${resolvedFlameWave.projectileCount} piercing projectiles`} onClick={() => runtimeRef.current?.useSkill("flameWave")}>
                    <span className="skill-cooldown" style={{ height: `${flameWaveProgress}%` }} />
                    <span className="skill-icon"><i /></span><kbd>{ACTIVE_SKILLS.flameWave.key}</kbd>
                    {hud && hud.flameWaveCooldown > 0.05 && <strong>{hud.flameWaveCooldown.toFixed(1)}</strong>}
                  </button>
                </div>
              </div>
              <div
                className="world-experience"
                aria-label={`Level ${characterProgress.level} experience`}
                aria-valuemin={0}
                aria-valuemax={characterProgress.level === MAX_CHARACTER_LEVEL ? 100 : xpRequired}
                aria-valuenow={characterProgress.level === MAX_CHARACTER_LEVEL ? 100 : characterProgress.xp}
                data-tooltip={characterProgress.level === MAX_CHARACTER_LEVEL ? `Level ${characterProgress.level} · Maximum level` : `Level ${characterProgress.level} · ${characterProgress.xp} / ${xpRequired} XP`}
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
      {mode !== "class-select" && characterStats && (
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
});
