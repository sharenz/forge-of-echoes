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
    <article className={`skill-ledger-node skill-${id}`} style={{ "--skill-accent": current.tree.accent } as CSSProperties}>
      <div className="skill-ledger-icon"><span>{current.key}</span><i /></div>
      <div className="skill-ledger-copy">
        <span>{current.tree.role}</span>
        <h4>{current.name}</h4>
        <small>{current.tree.description}</small>
        <div className="skill-ledger-progress"><i style={{ width: `${progress}%` }} /></div>
      </div>
      <div className="skill-ledger-metrics">
        {skillMetrics(current).slice(0, 3).map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}
      </div>
      <div className="skill-ledger-level"><small>Level</small><strong>{current.level}</strong><em>/ {current.maxLevel}</em></div>
      <button type="button" disabled={!canAllocate} onClick={() => onAllocate(id)} aria-label={`Raise ${current.name}`}>
        <b>+</b><span>{current.level >= current.maxLevel ? "Mastered" : skillChangeSummary(current, next)}</span>
      </button>
      <div className="skill-ledger-milestones">
        {[5, 10, 15, 20].map((level) => <i className={current.level >= level ? "earned" : ""} title={`Level ${level}: ${milestoneSummary(id, level, cooldownMultiplier, castSpeed)}`} key={level}>{level}</i>)}
      </div>
    </article>
  );
}

export function SkillTreePanel({ progress, castSpeed, cooldownMultiplier, onAllocate, onSetSlot }: SkillTreePanelProps) {
  const basic = resolveSkillDefinition(BASIC_ATTACK, 1);
  const [selectedSlot, setSelectedSlot] = useState(0);

  return (
    <div className="skill-tree-interface">
      <section className="skill-loadout-editor" aria-label="Skill bar loadout">
        <header>
          <div><span>Combat bindings</span><h3>Skill Bar</h3></div>
          <small>Select a socket, then choose a learned skill</small>
        </header>
        <div className="skill-loadout-slots">
          {SKILL_BAR_SLOTS.map((slot) => {
            const skill = progress.skillLoadout[slot.index];
            const definition = skill ? (skill === "basic" ? BASIC_ATTACK : ACTIVE_SKILLS[skill]) : null;
            return (
              <button type="button" className={`skill-loadout-slot ${skillSlotClass(skill)} ${selectedSlot === slot.index ? "selected" : ""}`} onClick={() => setSelectedSlot(slot.index)} key={slot.index}>
                <kbd>{slot.key}</kbd>
                <span className="skill-icon"><i /></span>
                <strong>{definition?.name ?? "Empty"}</strong>
              </button>
            );
          })}
        </div>
        <div className="skill-loadout-picker">
          <span>Bind to <strong>{SKILL_BAR_SLOTS[selectedSlot].key}</strong></span>
          <div>
            {SKILL_OPTIONS.map(([skill, definition]) => (
              <button type="button" className={`${skillSlotClass(skill)} ${progress.skillLoadout[selectedSlot] === skill ? "assigned" : ""}`} onClick={() => onSetSlot(selectedSlot, skill)} key={skill}>
                <span className="skill-icon"><i /></span><strong>{definition.name}</strong><small>{skill === "basic" ? "Innate" : `Lv ${progress.skillLevels[skill]}`}</small>
              </button>
            ))}
            <button type="button" className="clear-loadout-choice" onClick={() => onSetSlot(selectedSlot, null)}><strong>Clear</strong><small>Empty socket</small></button>
          </div>
        </div>
      </section>

      <div className="skill-book-body">
        <aside className="skill-book-spine">
          <div><span>Sorceress</span><h3>Emberweave</h3><small>Every learned combat art</small></div>
          <section className="skill-tree-core" style={{ "--skill-accent": basic.tree.accent } as CSSProperties}>
            <div className="skill-core-sigil"><span>{basic.key}</span><i /></div>
            <div><span>Innate</span><h4>{basic.name}</h4><p>{basic.tree.description}</p></div>
            <div className="skill-core-metrics">{skillMetrics(basic).slice(0, 3).map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div>
          </section>
          <div className={`skill-point-orb ${progress.unspentSkillPoints > 0 ? "available" : ""}`}><strong>{progress.unspentSkillPoints}</strong><span>skill points</span></div>
          <footer><kbd>K</kbd><span>Close spellbook</span></footer>
        </aside>

        <section className="skill-discipline-grid">
          {SKILL_TREE_BRANCHES.map((branch) => {
            const skills = ACTIVE_SKILL_ENTRIES.filter(([, definition]) => definition.tree.branch === branch.id);
            return (
              <section className={`skill-discipline discipline-${branch.id}`} key={branch.id}>
                <header><i>{branch.numeral}</i><div><span>Discipline</span><h3>{branch.name}</h3><small>{branch.subtitle}</small></div></header>
                <div className="skill-discipline-nodes">
                  {skills.map(([id, definition]) => (
                    <SkillNode id={id} current={resolveSkillDefinition(definition, progress.skillLevels[id], cooldownMultiplier, castSpeed)} castSpeed={castSpeed} cooldownMultiplier={cooldownMultiplier} points={progress.unspentSkillPoints} onAllocate={onAllocate} key={id} />
                  ))}
                </div>
              </section>
            );
          })}
        </section>
      </div>
    </div>
  );
}
