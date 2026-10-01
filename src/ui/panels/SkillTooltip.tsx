// Skill tooltip from rules.skillSheet: current rank numbers, what the next rank adds, and the lock reason.
import type { SkillId } from '../../contracts/content';
import type { CharacterSave } from '../../contracts/items';
import { PixelIcon, cx } from '../components/common';
import { safe } from '../items/hooks';
import { formatInt } from '../lib/format';
import { useStore } from '../store';

export function SkillTooltip({ ch, skillId }: { ch: CharacterSave; skillId: SkillId }) {
  const store = useStore();
  const info = store.rules.content.skills[skillId];
  const rank = ch.skillRanks[skillId] ?? 0;
  const sheet = safe(() => store.rules.skillSheet(ch, skillId), null);
  const can = safe(() => store.rules.canRankUpSkill(ch, skillId), { ok: false, reason: 'Unavailable' });
  if (!info) return null;
  const maxed = rank >= info.maxRank;
  return (
    <div class={cx('fe-tt fe-tt--skill', info.damageType && `fe-tt--dmg-${info.damageType}`)}>
      <div class="fe-tt__skillhead">
        <PixelIcon id={`icon/skill/${skillId}`} width={40} height={40} class="fe-tt__skillicon" />
        <div>
          <div class="fe-tt__title">{info.name}</div>
          <div class="fe-tt__subtitle">
            {rank > 0 ? `Rank ${rank} of ${info.maxRank}` : 'Not learned'}
            {info.tags.length > 0 && ` · ${info.tags.join(', ')}`}
          </div>
        </div>
      </div>
      <div class="fe-tt__body fe-tt__body--left">
        <div class="fe-tt__desc">{info.description}</div>
        {sheet && sheet.lines.length > 0 && (
          <>
            <div class="fe-tt__sep" />
            <div class="fe-tt__cap">{rank > 0 ? 'Current rank' : 'At rank 1'}</div>
            {sheet.lines.map((l, i) => (
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
        {!maxed && sheet && sheet.nextRankLines.length > 0 && (
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
        {!maxed && can.ok && <div class="fe-tt__hint">Click the rank button to spend a skill point.</div>}
      </div>
    </div>
  );
}
