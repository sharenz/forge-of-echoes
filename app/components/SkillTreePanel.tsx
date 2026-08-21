import { useState, type CSSProperties } from "react";
import { ACTIVE_SKILLS, BASIC_ATTACK, SKILL_TREE_BRANCHES } from "../game/config/skills";
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

interface SkillNodeProps {
  id: ActiveSkillId;
  current: ResolvedSkillDefinition;
  castSpeed: number;
  cooldownMultiplier: number;
  points: number;
  onAllocate: (skill: ActiveSkillId) => void;
}

const ACTIVE_SKILL_ENTRIES = Object.entries(ACTIVE_SKILLS) as [ActiveSkillId, (typeof ACTIVE_SKILLS)[ActiveSkillId]][];
const SKILL_OPTIONS: readonly [SkillBarSkillId, typeof BASIC_ATTACK | (typeof ACTIVE_SKILLS)[ActiveSkillId]][] = [
  ["basic", BASIC_ATTACK],
  ...ACTIVE_SKILL_ENTRIES,
];

function skillSlotClass(skill: SkillBarSkillId | null): string {
  if (skill === "basic") return "lance-slot";
  if (skill === "nova") return "nova-slot";
  if (skill === "dash") return "rift-slot";
  if (skill === "ward") return "ward-slot";
  if (skill === "flameWave") return "flame-wave-slot";
  return "empty-skill-slot";
}

function formatNumber(value: number, decimals = 1): string {
  return value.toFixed(decimals).replace(/\.0+$/, "");
}

function skillMetrics(skill: ResolvedSkillDefinition): readonly [string, string][] {
  const metrics: [string, string][] = [];
  if (skill.damage) metrics.push(["Damage", `${Math.round(skill.damage.effectiveness * 100)}%`]);
  if (skill.projectileCount > 0) metrics.push(["Projectiles", String(skill.projectileCount)]);
  if (skill.piercing > 0 || skill.damage) metrics.push(["Pierce", String(skill.piercing)]);
  if (skill.maxCharges > 0) metrics.push(["Charges", String(skill.maxCharges)]);
  if (skill.recharge > 0) metrics.push(["Recharge", `${formatNumber(skill.recharge, 2)}s`]);
  if (skill.damageReduction > 0) metrics.push(["Guard", `${formatNumber(skill.damageReduction)}%`]);
  if (skill.duration > 0) metrics.push(["Duration", `${formatNumber(skill.duration)}s`]);
  if (skill.castTime > 0) metrics.push(["Cast time", `${formatNumber(skill.castTime, 2)}s`]);
  if (skill.cooldown > 0) metrics.push(["Cooldown", `${formatNumber(skill.cooldown, 2)}s`]);
  metrics.push(["Focus", String(skill.focusCost)]);
  return metrics.slice(0, 4);
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
  return changes.length > 0 ? changes.join(" · ") : "Improves this discipline";
}

function milestoneSummary(id: ActiveSkillId, level: number, cooldownMultiplier = 1, castSpeed = 1): string {
  const definition = ACTIVE_SKILLS[id];
  return skillChangeSummary(
    resolveSkillDefinition(definition, level - 1, cooldownMultiplier, castSpeed),
    resolveSkillDefinition(definition, level, cooldownMultiplier, castSpeed),
  );
}

function SkillNode({ id, current, castSpeed, cooldownMultiplier, points, onAllocate }: SkillNodeProps) {
  const next = resolveSkillDefinition(ACTIVE_SKILLS[id], current.level + 1, cooldownMultiplier, castSpeed);
  const canAllocate = points > 0 && current.level < current.maxLevel;
  const progress = current.level / current.maxLevel * 100;

  return (
    <article className={`skill-node skill-${id}`} style={{ "--skill-accent": current.tree.accent } as CSSProperties}>
      <header>
        <div className="skill-glyph"><span>{current.key}</span><i /></div>
        <div className="skill-node-identity">
          <span>{current.tree.role}</span>
          <h4>{current.name}</h4>
          <small>{current.tree.description}</small>
        </div>
        <div className="skill-level-medallion"><small>Level</small><strong>{current.level}</strong><em>/ {current.maxLevel}</em></div>
      </header>

      <div className="skill-metric-grid">
        {skillMetrics(current).map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}
      </div>

      <div className="skill-level-path">
        <div className="skill-level-progress"><i style={{ width: `${progress}%` }} /></div>
        <div className="skill-node-track" aria-label={`${current.name} level path`}>
          {Array.from({ length: current.maxLevel }, (_, index) => {
            const level = index + 1;
            const active = level <= current.level;
            const nextNode = level === current.level + 1;
            const milestone = level % 5 === 0;
            return <i className={`${active ? "active" : ""} ${nextNode ? "next" : ""} ${milestone ? "milestone" : ""}`} title={`Level ${level}${milestone ? `: ${milestoneSummary(id, level, cooldownMultiplier, castSpeed)}` : ""}`} key={level}><b>{milestone ? level : ""}</b></i>;
          })}
        </div>
      </div>

      <div className="skill-next-level">
        <span>{current.level >= current.maxLevel ? "Mastery complete" : `Level ${current.level + 1}`}</span>
        <strong>{current.level >= current.maxLevel ? "Maximum power reached" : skillChangeSummary(current, next)}</strong>
      </div>

      <div className="skill-milestones">
        {[5, 10, 15, 20].map((level) => (
          <span className={current.level >= level ? "earned" : ""} key={level}>
            <b>{level}</b><small>{milestoneSummary(id, level, cooldownMultiplier, castSpeed)}</small>
          </span>
        ))}
      </div>

      <button type="button" disabled={!canAllocate} onClick={() => onAllocate(id)}>
        <span>{current.level >= current.maxLevel ? "Skill mastered" : `Raise ${current.name}`}</span>
        <small>{canAllocate ? "Spend 1 skill point" : points <= 0 ? "Earn a level for another point" : "Maximum level"}</small>
      </button>
    </article>
  );
}

export function SkillTreePanel({ progress, castSpeed, cooldownMultiplier, onAllocate, onSetSlot }: SkillTreePanelProps) {
  const investedPoints = Object.values(progress.skillLevels).reduce((total, level) => total + Math.max(0, level - 1), 0);
  const basic = resolveSkillDefinition(BASIC_ATTACK, 1);
  const [selectedSlot, setSelectedSlot] = useState(0);

  return (
    <div className="skill-tree-interface">
      <section className="skill-tree-header">
        <div>
          <span>Sorceress discipline matrix</span>
          <h3>Emberweave</h3>
          <p>Every combat skill belongs to this tree. Follow each branch from your innate Ember Lance and invest levels to sharpen damage, defense, or movement.</p>
        </div>
        <div className="skill-tree-totals">
          <div><strong>{ACTIVE_SKILL_ENTRIES.length + 1}</strong><span>Skills</span><small>Complete loadout</small></div>
          <div><strong>{investedPoints}</strong><span>Invested</span><small>Permanent levels</small></div>
          <div className="skill-point-orb"><strong>{progress.unspentSkillPoints}</strong><span>Available</span><small>Skill points</small></div>
        </div>
      </section>

      <section className="skill-loadout-editor" aria-label="Skill bar loadout">
        <header>
          <div><span>Combat bindings</span><h3>Skill Bar</h3><p>Select a socket, then choose any learned skill. Changes are saved on this character.</p></div>
          <strong>5 SLOTS</strong>
        </header>
        <div className="skill-loadout-slots">
          {SKILL_BAR_SLOTS.map((slot) => {
            const skill = progress.skillLoadout[slot.index];
            const definition = skill ? (skill === "basic" ? BASIC_ATTACK : ACTIVE_SKILLS[skill]) : null;
            return (
              <button type="button" className={`skill-loadout-slot ${skillSlotClass(skill)} ${selectedSlot === slot.index ? "selected" : ""}`} onClick={() => setSelectedSlot(slot.index)} key={slot.index}>
                <kbd>{slot.key}</kbd>
                <span className="skill-icon"><i /></span>
                <small>Slot {slot.index + 1}</small>
                <strong>{definition?.name ?? "Empty"}</strong>
              </button>
            );
          })}
        </div>
        <div className="skill-loadout-picker">
          <span>Assign to <strong>{SKILL_BAR_SLOTS[selectedSlot].key}</strong></span>
          <div>
            {SKILL_OPTIONS.map(([skill, definition]) => (
              <button type="button" className={`${skillSlotClass(skill)} ${progress.skillLoadout[selectedSlot] === skill ? "assigned" : ""}`} onClick={() => onSetSlot(selectedSlot, skill)} key={skill}>
                <span className="skill-icon"><i /></span><strong>{definition.name}</strong><small>{skill === "basic" ? "Innate" : `Level ${progress.skillLevels[skill]}`}</small>
              </button>
            ))}
            <button type="button" className="clear-loadout-choice" onClick={() => onSetSlot(selectedSlot, null)}><strong>Empty slot</strong><small>Remove binding</small></button>
          </div>
        </div>
      </section>

      <section className="skill-tree-core" style={{ "--skill-accent": basic.tree.accent } as CSSProperties}>
        <div className="skill-core-sigil"><span>{basic.key}</span><i /></div>
        <div><span>Innate core · always available</span><h4>{basic.name}</h4><p>{basic.tree.description}</p></div>
        <div className="skill-core-metrics">
          {skillMetrics(basic).map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}
        </div>
      </section>

      <div className="skill-tree-conduits" aria-hidden="true"><i /><i /><i /></div>

      <section className="skill-discipline-grid">
        {SKILL_TREE_BRANCHES.map((branch) => {
          const skills = ACTIVE_SKILL_ENTRIES.filter(([, definition]) => definition.tree.branch === branch.id);
          return (
            <section className={`skill-discipline discipline-${branch.id}`} key={branch.id}>
              <header><i>{branch.numeral}</i><div><span>Discipline</span><h3>{branch.name}</h3><small>{branch.subtitle}</small></div><strong>{skills.length}</strong></header>
              <div className="skill-discipline-nodes">
                {skills.map(([id, definition]) => (
                  <SkillNode
                    id={id}
                    current={resolveSkillDefinition(definition, progress.skillLevels[id], cooldownMultiplier, castSpeed)}
                    castSpeed={castSpeed}
                    cooldownMultiplier={cooldownMultiplier}
                    points={progress.unspentSkillPoints}
                    onAllocate={onAllocate}
                    key={id}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </section>
    </div>
  );
}
