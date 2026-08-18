import { ACTIVE_SKILLS } from "../game/combat";
import type { ActiveSkillId, CharacterProgress } from "../game/domain";
import { resolveSkillDefinition, type ResolvedSkillDefinition } from "../game/skills";

interface SkillTreePanelProps {
  progress: CharacterProgress;
  onAllocate: (skill: ActiveSkillId) => void;
}

interface SkillBranchProps {
  id: ActiveSkillId;
  current: ResolvedSkillDefinition;
  next: ResolvedSkillDefinition;
  points: number;
  onAllocate: (skill: ActiveSkillId) => void;
}

function skillMetrics(id: ActiveSkillId, skill: ResolvedSkillDefinition): readonly [string, string][] {
  if (id === "nova") return [
    ["Damage", `${Math.round(skill.damage!.effectiveness * 100)}%`],
    ["Projectiles", String(skill.projectileCount)],
    ["Pierce", String(skill.piercing)],
    ["Focus", String(skill.focusCost)],
  ];
  return [
    ["Recharge", `${skill.recharge.toFixed(2)}s`],
    ["Charges", String(skill.maxCharges)],
    ["Focus", String(skill.focusCost)],
    ["Travel", "Instant"],
  ];
}

function nextLevelSummary(id: ActiveSkillId, current: ResolvedSkillDefinition, next: ResolvedSkillDefinition): string {
  if (current.level >= current.maxLevel) return "This skill has reached its maximum level.";
  if (id === "nova") {
    const effects = [`+${Math.round((next.damage!.effectiveness - current.damage!.effectiveness) * 100)}% damage`, `+${next.projectileCount - current.projectileCount} projectile`];
    if (next.piercing > current.piercing) effects.push("+1 piercing");
    return effects.join(" · ");
  }
  const effects = [`${(current.recharge - next.recharge).toFixed(2)}s faster recharge`];
  if (next.maxCharges > current.maxCharges) effects.push("+1 charge");
  return effects.join(" · ");
}

function SkillBranch({ id, current, next, points, onAllocate }: SkillBranchProps) {
  const canAllocate = points > 0 && current.level < current.maxLevel;
  return (
    <article className={`skill-branch skill-${id}`}>
      <header>
        <div className="skill-glyph"><span>{current.key}</span><i /></div>
        <div><span>{id === "nova" ? "Destruction branch" : "Mobility branch"}</span><h3>{current.name}</h3><small>Level {current.level} / {current.maxLevel}</small></div>
        <strong>{current.level >= current.maxLevel ? "Mastered" : `Next: ${current.level + 1}`}</strong>
      </header>
      <div className="skill-metric-grid">
        {skillMetrics(id, current).map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}
      </div>
      <div className="skill-node-track" aria-label={`${current.name} level path`}>
        {Array.from({ length: current.maxLevel }, (_, index) => {
          const level = index + 1;
          const active = level <= current.level;
          const nextNode = level === current.level + 1;
          const milestone = level % 5 === 0;
          return <i className={`${active ? "active" : ""} ${nextNode ? "next" : ""} ${milestone ? "milestone" : ""}`} title={`Level ${level}${milestone ? " milestone" : ""}`} key={level}><b>{milestone ? level : ""}</b></i>;
        })}
      </div>
      <div className="skill-next-level"><span>Next level</span><strong>{nextLevelSummary(id, current, next)}</strong></div>
      <div className="skill-milestones">
        {[5, 10, 15, 20].map((level) => <span className={current.level >= level ? "earned" : ""} key={level}><b>{level}</b><small>{id === "nova" ? "+1 pierce" : "+1 charge"}</small></span>)}
      </div>
      <button type="button" disabled={!canAllocate} onClick={() => onAllocate(id)}>
        <span>{current.level >= current.maxLevel ? "Skill mastered" : `Raise to level ${current.level + 1}`}</span><small>{canAllocate ? "Spend 1 skill point" : points <= 0 ? "Earn a level for another point" : "Maximum level"}</small>
      </button>
    </article>
  );
}

export function SkillTreePanel({ progress, onAllocate }: SkillTreePanelProps) {
  const nova = resolveSkillDefinition(ACTIVE_SKILLS.nova, progress.skillLevels.nova);
  const dash = resolveSkillDefinition(ACTIVE_SKILLS.dash, progress.skillLevels.dash);
  const nextNova = resolveSkillDefinition(ACTIVE_SKILLS.nova, nova.level + 1);
  const nextDash = resolveSkillDefinition(ACTIVE_SKILLS.dash, dash.level + 1);

  return (
    <div className="skill-tree-interface">
      <section className="skill-tree-header">
        <div><span>Active discipline</span><h3>Emberweave</h3><p>Invest skill points into permanent active-skill levels. Milestone nodes transform how each skill plays.</p></div>
        <div className="skill-point-orb"><strong>{progress.unspentSkillPoints}</strong><span>Skill points</span><small>1 gained per character level</small></div>
      </section>
      <div className="skill-tree-root"><i /><span>Core</span><strong>Choose a branch</strong></div>
      <section className="skill-branch-grid">
        <SkillBranch id="nova" current={nova} next={nextNova} points={progress.unspentSkillPoints} onAllocate={onAllocate} />
        <SkillBranch id="dash" current={dash} next={nextDash} points={progress.unspentSkillPoints} onAllocate={onAllocate} />
      </section>
    </div>
  );
}
