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
  { id: "armor", label: "Armor" },
  { id: "evadeChance", label: "Evade chance", suffix: "%", decimals: 1 },
  { id: "moveSpeed", label: "Movement speed" },
];

function number(value: number, decimals = 0): string {
  return value.toFixed(decimals).replace(/\.0+$/, "");
}

export function AttributesPanel({ progress, stats, breakdown, onAllocate }: AttributesPanelProps) {
  const classDefinition = CHARACTER_CLASSES[progress.classId ?? "amazon"];
  const xpRequired = XP_BY_LEVEL(progress.level);
  const xpPercent = progress.level === MAX_CHARACTER_LEVEL ? 100 : Math.min(100, progress.xp / xpRequired * 100);

  return (
    <div className="attributes-interface">
      <section className="character-progression-banner">
        <div className="character-level-seal"><small>Level</small><strong>{progress.level}</strong></div>
        <div className="character-level-copy">
          <span>{classDefinition.title}</span>
          <h3>{progress.name} · {classDefinition.name}</h3>
          <p>{classDefinition.fantasy}</p>
          <div className="character-xp-track"><i style={{ width: `${xpPercent}%` }} /></div>
          <small>{progress.level === MAX_CHARACTER_LEVEL ? "Maximum level reached" : `${progress.xp} / ${xpRequired} experience`}</small>
        </div>
        <div className="unspent-point-vault"><span>Available</span><strong>{progress.unspentAttributePoints}</strong><small>Attribute points</small></div>
      </section>

      <section className="attribute-card-grid" aria-label="Core attributes">
        {ATTRIBUTES.map((attribute) => {
          const benefits = DERIVED_STAT_RULES.filter((rule) => rule.kind === "perAttribute" && rule.attribute === attribute.id);
          const classGrowth = classDefinition.attributesPerLevel[attribute.id];
          return (
            <article className={`attribute-card attribute-${attribute.id}`} style={{ "--attribute-color": attribute.color } as CSSProperties} key={attribute.id}>
              <header><i>{attribute.glyph}</i><div><span>Core attribute</span><h3>{attribute.label}</h3></div><strong>{stats[attribute.id]}</strong></header>
              <div className="attribute-allocation-line"><span>{progress.allocatedAttributes[attribute.id]} manually allocated</span><small>+{classGrowth} per character level</small></div>
              <div className="attribute-benefits">
                <span>Every point contributes</span>
                {benefits.map((benefit) => <small key={benefit.source}>{benefit.label}</small>)}
              </div>
              <button type="button" disabled={progress.unspentAttributePoints <= 0} onClick={() => onAllocate(attribute.id)}>
                <b>+</b><span>Allocate {attribute.label}</span>
              </button>
            </article>
          );
        })}
      </section>

      <section className="derived-stat-section">
        <header><div><span>Resolved character sheet</span><h3>Combat outcomes</h3></div><small>All item, class, level, and attribute modifiers included</small></header>
        <div className="derived-stat-grid">
          {DERIVED_STATS.map((stat) => {
            const sources = breakdown[stat.id].contributions.filter((modifier) => Math.abs(modifier.value) > 0.0001);
            return (
              <article key={stat.id}>
                <span>{stat.label}</span>
                <strong>{number(stats[stat.id], stat.decimals)}{stat.suffix}</strong>
                <small>{sources.length} active source{sources.length === 1 ? "" : "s"}</small>
                <div>{sources.slice(0, 2).map((source) => <em key={source.source}>{source.label ?? source.source}</em>)}</div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
