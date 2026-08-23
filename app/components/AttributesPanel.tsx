import type { CSSProperties } from "react";
import { CHARACTER_CLASSES } from "../game/config/classes";
import { MAX_CHARACTER_LEVEL, XP_BY_LEVEL } from "../game/config/progression";
import { DERIVED_STAT_RULES } from "../game/config/stat-rules";
import type { AttributeKey, CharacterProgress, CharacterStats, DerivedStatKey } from "../game/domain";
import type { CharacterStatCalculation } from "../game/stats";

interface AttributesPanelProps {
  progress: CharacterProgress;
  stats: CharacterStats;
  breakdown: CharacterStatCalculation["breakdown"];
  onAllocate: (attribute: AttributeKey) => void;
}

const ATTRIBUTES: readonly { id: AttributeKey; glyph: string; label: string; color: string }[] = [
  { id: "strength", glyph: "STR", label: "Strength", color: "#d9684b" },
  { id: "dexterity", glyph: "DEX", label: "Dexterity", color: "#73b982" },
  { id: "intelligence", glyph: "INT", label: "Intelligence", color: "#8d8ee4" },
];

const DERIVED_STATS: readonly { id: DerivedStatKey; label: string; suffix?: string; decimals?: number }[] = [
  { id: "maxLife", label: "Maximum Life" },
  { id: "maxFocus", label: "Maximum Focus" },
  { id: "attackDamage", label: "Attack Damage", decimals: 1 },
  { id: "attackSpeed", label: "Attacks / second", decimals: 2 },
  { id: "castSpeed", label: "Cast speed", suffix: "%", decimals: 0 },
  { id: "focusRegen", label: "Focus recovery / second", decimals: 1 },
  { id: "skillCooldown", label: "Skill cooldown duration", suffix: "×", decimals: 2 },
  { id: "armor", label: "Armor" },
  { id: "evadeChance", label: "Evade chance", suffix: "%", decimals: 1 },
  { id: "moveSpeed", label: "Movement speed" },
];

function number(value: number, decimals = 0): string {
  return value.toFixed(decimals).replace(/\.0+$/, "");
}

export function AttributesPanel({ progress, stats, breakdown, onAllocate }: AttributesPanelProps) {
  const classDefinition = CHARACTER_CLASSES[progress.classId];
  const xpRequired = XP_BY_LEVEL(progress.level);
  const xpPercent = progress.level === MAX_CHARACTER_LEVEL ? 100 : Math.min(100, progress.xp / xpRequired * 100);

  return (
    <div className="attributes-interface">
      <section className={`character-sheet-identity identity-${progress.classId}`}>
        <div className="character-sheet-portrait" aria-hidden="true"><i /></div>
        <div className="character-sheet-name">
          <span>{classDefinition.title}</span>
          <h3>{progress.name}</h3>
          <small>Level {progress.level} {classDefinition.name}</small>
        </div>
        <div className="character-sheet-experience">
          <span>{progress.level === MAX_CHARACTER_LEVEL ? "Mastered" : `Level ${progress.level}`}</span>
          <div className="character-xp-track" title={progress.level === MAX_CHARACTER_LEVEL ? "Maximum level reached" : `${progress.xp} / ${xpRequired} experience`}><i style={{ width: `${xpPercent}%` }} /></div>
        </div>
        <div className={`character-sheet-points ${progress.unspentAttributePoints > 0 ? "available" : ""}`}><strong>{progress.unspentAttributePoints}</strong><span>points</span></div>
      </section>

      <div className="character-sheet-body">
        <section className="attribute-ledger" aria-label="Core attributes">
          <header><span>Core</span><h3>Attributes</h3><small>Spend points to shape your build</small></header>
          {ATTRIBUTES.map((attribute) => {
            const benefits = DERIVED_STAT_RULES.filter((rule) => rule.kind === "perAttribute" && rule.attribute === attribute.id);
            const classGrowth = classDefinition.attributesPerLevel[attribute.id];
            return (
              <article className={`attribute-ledger-row attribute-${attribute.id}`} style={{ "--attribute-color": attribute.color } as CSSProperties} key={attribute.id}>
                <i>{attribute.glyph}</i>
                <div><h4>{attribute.label}</h4><small>{benefits.map((benefit) => benefit.label).join(" · ")}</small><em>{progress.allocatedAttributes[attribute.id]} allocated · +{classGrowth}/level</em></div>
                <strong>{stats[attribute.id]}</strong>
                <button type="button" disabled={progress.unspentAttributePoints <= 0} onClick={() => onAllocate(attribute.id)} aria-label={`Add one ${attribute.label}`}>+</button>
              </article>
            );
          })}
          <footer><kbd>C</kbd><span>Close character sheet</span></footer>
        </section>

        <section className="combat-ledger">
          <header><span>Resolved</span><h3>Combat</h3><small>Equipment and modifiers included</small></header>
          <div className="combat-ledger-columns">
            {DERIVED_STATS.map((stat) => {
              const sources = breakdown[stat.id].contributions.filter((modifier) => Math.abs(modifier.value) > 0.0001);
              return (
                <div className="combat-ledger-row" title={sources.map((source) => source.label ?? source.source).join(" · ")} key={stat.id}>
                  <span>{stat.label}</span>
                  <strong>{number(stat.id === "castSpeed" ? stats[stat.id] * 100 : stats[stat.id], stat.decimals)}{stat.suffix}</strong>
                  <small>{sources.length} source{sources.length === 1 ? "" : "s"}</small>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
