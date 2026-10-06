// Skill tooltip from rules.skillSheet: current rank numbers, the active augments (picked and item-granted), what the next
// rank adds, the lock reason, and with Alt held a comparison against another skill (`compareTo`, the Skills panel's selection).
import type { SkillId } from '../../contracts/content';
import type { CharacterSave } from '../../contracts/items';
import { PixelIcon, cx } from '../components/common';
import { safe } from '../items/hooks';
import { formatInt } from '../lib/format';
import { ELEMENT_LABEL, sheetDeltas } from '../lib/skilltree';
import { useStore } from '../store';

export function SkillTooltip({
  ch,
  skillId,
  compareTo = null,
  alt = false,
}: {
  ch: CharacterSave;
  skillId: SkillId;
  compareTo?: SkillId | null;
  alt?: boolean;
}) {
  const store = useStore();
  const info = store.rules.content.skills[skillId];
  const rank = ch.skillRanks[skillId] ?? 0;
  const sheet = safe(() => store.rules.skillSheet(ch, skillId), null);
  const can = safe(() => store.rules.canRankUpSkill(ch, skillId), { ok: false, reason: 'Unavailable' });
  if (!info) return null;
  const maxed = rank >= info.maxRank;
  // `lines` ends with the augment lines; they get their own section here.
  const aug = sheet?.augmentLines ?? [];
  const base = sheet ? (aug.length && sheet.lines.slice(-aug.length).join('\n') === aug.join('\n') ? sheet.lines.slice(0, -aug.length) : sheet.lines) : [];
  const other = compareTo && compareTo !== skillId ? store.rules.content.skills[compareTo] : null;
  const otherSheet = other ? safe(() => store.rules.skillSheet(ch, other.id), null) : null;
  const compare = alt && sheet && otherSheet ? sheetDeltas(otherSheet, sheet) : null;
  return (
    <div class={cx('fe-tt fe-tt--skill', info.damageType && `fe-tt--dmg-${info.damageType}`)}>
      <div class="fe-tt__skillhead">
        <PixelIcon id={`icon/skill/${skillId}`} width={40} height={40} class="fe-tt__skillicon" />
        <div>
          <div class="fe-tt__title">{info.name}</div>
          <div class="fe-tt__subtitle">
            {rank > 0 ? `Rank ${rank} of ${info.maxRank}` : `Not learned · unlocks at level ${info.unlockLevel}`}
            {` · ${ELEMENT_LABEL[info.element] ?? info.element}`}
            {info.tags.length > 0 && ` · ${info.tags.join(', ')}`}
          </div>
        </div>
      </div>
      <div class="fe-tt__body fe-tt__body--left">
        <div class="fe-tt__desc">{info.description}</div>
        {compare && other && (
          <>
            <div class="fe-tt__sep" />
            <div class="fe-tt__cap">Compared with {other.name}</div>
            {compare.length === 0 && <div class="fe-tt__skillline fe-muted">The same numbers.</div>}
            {compare.map((d) => (
              <div class={cx('fe-tt__skillline', d.better ? 'fe-good' : 'fe-bad')} key={d.label}>
                {d.label}: {d.to} <span class="fe-muted">(vs {d.from})</span>
              </div>
            ))}
          </>
        )}
        {!compare && sheet && base.length > 0 && (
          <>
            <div class="fe-tt__sep" />
            <div class="fe-tt__cap">{rank > 0 ? 'Current rank' : 'At rank 1'}</div>
            {base.map((l, i) => (
              <div class="fe-tt__skillline" key={i}>
                {l}
              </div>
            ))}
            {sheet.dps !== null && sheet.dps > 0 && (
              <div class="fe-tt__skillline fe-tt__dps">
                {formatInt(sheet.dps)} damage per second <span class="fe-muted">(single target)</span>
              </div>
            )}
          </>
        )}
        {!compare && aug.length > 0 && (
          <>
            <div class="fe-tt__sep" />
            <div class="fe-tt__cap">Augments</div>
            {aug.map((l, i) => (
              <div class="fe-tt__skillline fe-tt__augline" key={i}>
                {l}
              </div>
            ))}
          </>
        )}
        {!compare && !maxed && sheet && sheet.nextRankLines.length > 0 && (
          <>
            <div class="fe-tt__sep" />
            <div class="fe-tt__cap">{rank > 0 ? `Rank ${rank + 1}` : 'Learning it'}</div>
            {sheet.nextRankLines.map((l, i) => (
              <div class="fe-tt__skillline fe-good" key={i}>
                {l}
              </div>
            ))}
          </>
        )}
        {maxed && <div class="fe-tt__hint">Mastered: this skill is at its highest rank.</div>}
        {!maxed && !can.ok && can.reason && <div class="fe-tt__req fe-tt__req--unmet">{can.reason}</div>}
        {!maxed && can.ok && <div class="fe-tt__hint">Spend a skill point with + to {rank > 0 ? 'rank it up' : 'learn it'}.</div>}
        {other && !alt && <div class="fe-tt__hint">Hold Alt to compare with {other.name}.</div>}
      </div>
    </div>
  );
}
