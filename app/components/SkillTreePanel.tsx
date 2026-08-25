"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ACTIVE_SKILLS, BASIC_ATTACK, SKILL_TREE_BRANCHES } from "../game/config/skills";
import type { SkillDefinition } from "../game/config/schema";
import type { ActiveSkillId, CharacterProgress, SkillBarSkillId } from "../game/domain";
import { SKILL_BAR_SLOTS } from "../game/skill-loadout";
import { resolveSkillDefinition, type ResolvedSkillDefinition } from "../game/skills";

interface SkillTreePanelProps {
  progress: CharacterProgress;
  castSpeed: number;
  cooldownMultiplier: number;
  onAllocate: (skill: ActiveSkillId) => void;
  onSetSlot: (slot: number, skill: SkillBarSkillId | null) => void;
}

const ACTIVE_SKILL_ENTRIES = Object.entries(ACTIVE_SKILLS) as [ActiveSkillId, (typeof ACTIVE_SKILLS)[ActiveSkillId]][];
const ALL_SKILL_OPTIONS: readonly (readonly [SkillBarSkillId, string, string])[] = [
  ["basic", BASIC_ATTACK.name, BASIC_ATTACK.tree.accent],
  ...ACTIVE_SKILL_ENTRIES.map(([id, definition]) => [id, definition.name, definition.tree.accent] as const),
];

function formatNumber(value: number, decimals = 1): string {
  return value.toFixed(decimals).replace(/\.0+$/, "");
}

function skillMetrics(skill: ResolvedSkillDefinition): readonly [string, string][] {
  const metrics: [string, string][] = [];
  if (skill.damage) metrics.push(["Damage", `${Math.round(skill.damage.effectiveness * 100)}%`]);
  if (skill.projectileCount > 0 && skill.damage) metrics.push(["Projectiles", String(skill.projectileCount)]);
  if (skill.piercing > 0 && skill.damage) metrics.push(["Pierce", String(skill.piercing)]);
  if (skill.maxCharges > 0) metrics.push(["Charges", String(skill.maxCharges)]);
  if (skill.recharge > 0) metrics.push(["Recharge", `${formatNumber(skill.recharge, 2)}s`]);
  if (skill.damageReduction > 0) metrics.push(["Guard", `${formatNumber(skill.damageReduction)}%`]);
  if (skill.recoveryAmount > 0) metrics.push(["Restores", `~${Math.round(skill.recoveryAmount)} life`]);
  if (skill.duration > 0 && (skill.damageReduction > 0 || skill.recoveryAmount > 0)) metrics.push(["Duration", `${formatNumber(skill.duration)}s`]);
  if (skill.castTime > 0 && skill.presentation.animation === "cast") metrics.push(["Cast", `${formatNumber(skill.castTime, 2)}s`]);
  if (skill.cooldown > 0) metrics.push(["Cooldown", `${formatNumber(skill.cooldown, 2)}s`]);
  metrics.push(["Focus", String(skill.focusCost)]);
  return metrics;
}

function skillChangeSummary(current: ResolvedSkillDefinition, next: ResolvedSkillDefinition): string {
  const changes: string[] = [];
  const effectiveness = (next.damage?.effectiveness ?? 0) - (current.damage?.effectiveness ?? 0);
  if (effectiveness > 0.0001) changes.push(`+${Math.round(effectiveness * 100)}% damage`);
  if (next.projectileCount > current.projectileCount) changes.push(`+${next.projectileCount - current.projectileCount} projectile${next.projectileCount - current.projectileCount === 1 ? "" : "s"}`);
  if (next.piercing > current.piercing) changes.push(`+${next.piercing - current.piercing} pierce`);
  if (next.maxCharges > current.maxCharges) changes.push(`+${next.maxCharges - current.maxCharges} charge`);
  if (next.cooldown < current.cooldown) changes.push(`${formatNumber(current.cooldown - next.cooldown, 2)}s faster cooldown`);
  if (next.recharge < current.recharge) changes.push(`${formatNumber(current.recharge - next.recharge, 2)}s faster recharge`);
  if (next.duration > current.duration) changes.push(`+${formatNumber(next.duration - current.duration, 2)}s duration`);
  if (next.damageReduction > current.damageReduction) changes.push(`+${formatNumber(next.damageReduction - current.damageReduction)}% guard`);
  if (next.recoveryAmount > current.recoveryAmount) changes.push(`+${Math.round(next.recoveryAmount - current.recoveryAmount)} life restored`);
  return changes.length > 0 ? changes.join(" · ") : "Deepens this art";
}

function prerequisiteText(requires: readonly { skill: ActiveSkillId; level: number }[]): string | null {
  if (requires.length === 0) return null;
  return requires
    .map((requirement) => `${ACTIVE_SKILLS[requirement.skill].name} ${requirement.level}`)
    .join(" + ");
}

interface NodeState {
  resolved: ResolvedSkillDefinition;
  level: number;
  unlocked: boolean;
  requirementsMet: boolean;
  requirements: readonly { skill: ActiveSkillId; level: number }[];
  canAllocate: boolean;
  isMaxed: boolean;
}

export function SkillTreePanel({ progress, castSpeed, cooldownMultiplier, onAllocate, onSetSlot }: SkillTreePanelProps) {
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [selectedSkill, setSelectedSkill] = useState<ActiveSkillId>("nova");

  const states = useMemo(() => {
    const record = {} as Record<ActiveSkillId, NodeState>;
    for (const [id, definition] of ACTIVE_SKILL_ENTRIES) {
      const level = progress.skillLevels[id];
      const requirements = (definition.tree as SkillDefinition["tree"]).requires ?? [];
      const requirementsMet = (requirements as readonly { skill: ActiveSkillId; level: number }[]).every((requirement) => progress.skillLevels[requirement.skill] >= requirement.level);
      record[id] = {
        resolved: resolveSkillDefinition(definition, Math.max(1, level), cooldownMultiplier, castSpeed),
        level,
        unlocked: level >= 1,
        requirements,
        requirementsMet,
        canAllocate: progress.unspentSkillPoints > 0 && level < definition.progression.maxLevel && requirementsMet,
        isMaxed: level >= definition.progression.maxLevel,
      };
    }
    return record;
  }, [progress.skillLevels, progress.unspentSkillPoints, cooldownMultiplier, castSpeed]);

  const selected = states[selectedSkill];
  const selectedNext = resolveSkillDefinition(ACTIVE_SKILLS[selectedSkill], Math.min(selected.resolved.maxLevel, selected.level + 1), cooldownMultiplier, castSpeed);

  const bindableSkills = ALL_SKILL_OPTIONS.filter(([id]) => id === "basic" || states[id].unlocked);
  const boundSkill = progress.skillLoadout[selectedSlot];

  return (
    <div className="skilltree">
      <header className="skilltree-masthead">
        <div className="skilltree-title">
          <span className="ui-type-caption">Sorceress · Spellweave</span>
          <h3 className="ui-type-title">Grimoire of Echoes</h3>
        </div>
        <div className={`skilltree-orb ${progress.unspentSkillPoints > 0 ? "available" : ""}`} aria-label={`${progress.unspentSkillPoints} unspent skill points`}>
          <strong className="ui-type-title">{progress.unspentSkillPoints}</strong>
          <span className="ui-type-caption">{progress.unspentSkillPoints === 1 ? "skill point" : "skill points"}</span>
        </div>
      </header>

      <div className="skilltree-grove" role="tree" aria-label="Skill tree">
        {SKILL_TREE_BRANCHES.map((branch) => {
          const branchNodes = ACTIVE_SKILL_ENTRIES
            .filter(([, definition]) => definition.tree.branch === branch.id)
            .sort(([, left], [, right]) => left.tree.tier - right.tree.tier);
          const deepestTier = Math.max(...branchNodes.map(([, definition]) => definition.tree.tier));
          return (
            <section className={`skilltree-branch branch-${branch.id}`} key={branch.id} style={{ "--branch-accent": branch.accent } as CSSProperties}>
              <header className="skilltree-branch-head">
                <i aria-hidden="true">{branch.numeral}</i>
                <div>
                  <h4 className="ui-type-body">{branch.name}</h4>
                  <small className="ui-type-caption">{branch.subtitle}</small>
                </div>
              </header>
              <div className="skilltree-ladder" style={{ "--tiers": deepestTier } as CSSProperties}>
                {[...branchNodes].reverse().map(([id], index, ladder) => {
                  const state = states[id];
                  const nodeState = !state.requirementsMet ? "locked" : state.isMaxed ? "maxed" : state.unlocked ? "learned" : "available";
                  const nextId = index < ladder.length - 1 ? ladder[index + 1][0] : null;
                  return (
                    <div className="skilltree-rung" key={id}>
                      <button
                        type="button"
                        role="treeitem"
                        aria-selected={selectedSkill === id}
                        className={`skilltree-node ${nodeState} ${selectedSkill === id ? "selected" : ""}`}
                        style={{ "--skill-accent": state.resolved.tree.accent } as CSSProperties}
                        onClick={() => setSelectedSkill(id)}
                        data-tooltip={state.unlocked ? undefined : `Locked · needs ${prerequisiteText(state.requirements)}`}
                      >
                        <span className="skilltree-node-ring" aria-hidden="true" />
                        <span className="ui-type-caption skilltree-node-level">{state.level}/{state.resolved.maxLevel}</span>
                        <strong className="ui-type-secondary">{state.resolved.name}</strong>
                        {!state.requirementsMet && <small className="ui-type-caption">Needs {prerequisiteText(state.requirements)}</small>}
                      </button>
                      {nextId && (
                        <svg className="skilltree-link" viewBox="0 0 8 44" aria-hidden="true">
                          <line x1="4" y1="2" x2="4" y2="42" data-lit={state.level >= 1 ? "true" : undefined} />
                        </svg>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        <aside className="skilltree-core" style={{ "--skill-accent": BASIC_ATTACK.tree.accent } as CSSProperties}>
          <span className="ui-type-caption">Innate</span>
          <strong className="ui-type-secondary">{BASIC_ATTACK.name}</strong>
          <kbd>Space</kbd>
        </aside>
      </div>

      <section className="skilltree-detail" aria-label={`Details for ${selected.resolved.name}`} style={{ "--skill-accent": selected.resolved.tree.accent } as CSSProperties}>
        <div className="skilltree-detail-copy">
          <span className="ui-type-caption">{selected.resolved.tree.role}</span>
          <h4 className="ui-type-body">{selected.resolved.name}{selected.level > 0 ? ` · Rank ${selected.level}` : " · Unlearned"}</h4>
          <p className="ui-type-secondary">{selected.resolved.tree.description}</p>
          {!selected.requirementsMet && (
            <p className="ui-type-caption skilltree-detail-lock">Requires {prerequisiteText(selected.requirements)}</p>
          )}
        </div>
        <dl className="skilltree-detail-stats">
          {skillMetrics(selected.resolved).map(([label, value]) => (
            <div key={label}><dt className="ui-type-caption">{label}</dt><dd className="ui-type-secondary">{value}</dd></div>
          ))}
        </dl>
        <div className="skilltree-detail-actions">
          <button
            type="button"
            className="skilltree-allocate"
            disabled={!selected.canAllocate}
            onClick={() => onAllocate(selectedSkill)}
          >
            {selected.isMaxed ? "Mastered" : selected.level === 0 ? `Learn · 1 point` : `Raise to ${selected.level + 1}`}
          </button>
          {!selected.isMaxed && selectedNext.level > selected.level && (
            <small className="ui-type-caption">{skillChangeSummary(selected.resolved, selectedNext)}</small>
          )}
        </div>
      </section>

      <section className="skilltree-bindings" aria-label="Skill bar bindings">
        <header className="ui-type-caption"><span>Skill bar</span><span>Pick a socket, then a learned art</span></header>
        <div className="skilltree-binding-row">
          {SKILL_BAR_SLOTS.map((slot) => {
            const bound = progress.skillLoadout[slot.index];
            const accent = bound ? (bound === "basic" ? BASIC_ATTACK.tree.accent : ACTIVE_SKILLS[bound].tree.accent) : undefined;
            return (
              <button
                type="button"
                className={`skilltree-slot ${selectedSlot === slot.index ? "selected" : ""}`}
                style={accent ? ({ "--skill-accent": accent } as CSSProperties) : undefined}
                onClick={() => setSelectedSlot(slot.index)}
                key={slot.index}
              >
                <kbd className="ui-type-caption">{slot.key}</kbd>
                <strong className="ui-type-caption">{bound ? (bound === "basic" ? BASIC_ATTACK.name : ACTIVE_SKILLS[bound].name) : "Empty"}</strong>
              </button>
            );
          })}
        </div>
        <div className="skilltree-picker">
          {bindableSkills.map(([id, name, accent]) => (
            <button
              type="button"
              className={`skilltree-choice ${boundSkill === id ? "assigned" : ""}`}
              style={{ "--skill-accent": accent } as CSSProperties}
              onClick={() => onSetSlot(selectedSlot, id)}
              key={id}
            >
              <span className="ui-type-caption">{name}</span>
              <small className="ui-type-caption">{id === "basic" ? "Innate" : `Rank ${progress.skillLevels[id]}`}</small>
            </button>
          ))}
          <button type="button" className="skilltree-choice clear" onClick={() => onSetSlot(selectedSlot, null)}>
            <span className="ui-type-caption">Clear socket</span>
          </button>
        </div>
      </section>
    </div>
  );
}
