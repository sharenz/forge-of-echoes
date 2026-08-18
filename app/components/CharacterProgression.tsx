import { ACTIVE_SKILLS } from "../game/combat";
import { MAX_CHARACTER_LEVEL, XP_BY_LEVEL } from "../game/config/progression";
import type { ActiveSkillId, AttributeKey, CharacterProgress } from "../game/domain";
import { resolveSkillDefinition } from "../game/skills";

interface CharacterProgressionProps {
  progress: CharacterProgress;
  onAllocateAttribute: (attribute: AttributeKey) => void;
  onAllocateSkill: (skill: ActiveSkillId) => void;
}

const ATTRIBUTES: readonly { id: AttributeKey; label: string; short: string }[] = [
  { id: "strength", label: "Strength", short: "STR" },
  { id: "dexterity", label: "Dexterity", short: "DEX" },
  { id: "intelligence", label: "Intelligence", short: "INT" },
];

export function CharacterProgression({ progress, onAllocateAttribute, onAllocateSkill }: CharacterProgressionProps) {
  const xpRequired = XP_BY_LEVEL(progress.level);
  const xpPercent = progress.level === MAX_CHARACTER_LEVEL ? 100 : Math.min(100, progress.xp / xpRequired * 100);
  const nova = resolveSkillDefinition(ACTIVE_SKILLS.nova, progress.skillLevels.nova);
  const dash = resolveSkillDefinition(ACTIVE_SKILLS.dash, progress.skillLevels.dash);

  return (
    <section className="character-progression" aria-label="Character progression">
      <header>
        <div><span>Character progression</span><strong>Level {progress.level}</strong></div>
        <small>{progress.level === MAX_CHARACTER_LEVEL ? "Maximum level" : `${progress.xp} / ${xpRequired} XP`}</small>
      </header>
      <div className="progression-xp"><i style={{ width: `${xpPercent}%` }} /></div>
      <div className="progression-columns">
        <div>
          <h3>Attributes <em>{progress.unspentAttributePoints} points</em></h3>
          {ATTRIBUTES.map((attribute) => (
            <div className="progression-row" key={attribute.id}>
              <span><b>{attribute.short}</b><span><strong>{attribute.label}</strong><small>{progress.allocatedAttributes[attribute.id]} allocated</small></span></span>
              <button type="button" disabled={progress.unspentAttributePoints <= 0} onClick={() => onAllocateAttribute(attribute.id)} aria-label={`Add one ${attribute.label}`}>+</button>
            </div>
          ))}
        </div>
        <div>
          <h3>Active skills <em>{progress.unspentSkillPoints} points</em></h3>
          <div className="progression-row skill-level-row">
            <span><b>Q</b><span><strong>{nova.name} · {nova.level}/{nova.maxLevel}</strong><small>{Math.round(nova.damage!.effectiveness * 100)}% damage · {nova.projectileCount} projectiles · {nova.piercing} pierce</small></span></span>
            <button type="button" disabled={progress.unspentSkillPoints <= 0 || nova.level >= nova.maxLevel} onClick={() => onAllocateSkill("nova")} aria-label="Level Ember Nova">+</button>
          </div>
          <div className="progression-row skill-level-row">
            <span><b>E</b><span><strong>{dash.name} · {dash.level}/{dash.maxLevel}</strong><small>{dash.recharge.toFixed(2)}s recharge · {dash.maxCharges} charges</small></span></span>
            <button type="button" disabled={progress.unspentSkillPoints <= 0 || dash.level >= dash.maxLevel} onClick={() => onAllocateSkill("dash")} aria-label="Level Rift Step">+</button>
          </div>
        </div>
      </div>
    </section>
  );
}
