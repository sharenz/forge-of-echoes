// Character sheet (docked left): portrait, level and experience, attributes with allocation, and every
// derived stat section from the rules with expandable breakdowns.
import { attributeRuleText } from '../../game/progression/model';
import { SORCERESS } from '../../data/progression';
import { useState } from 'preact/hooks';
import { ATTRIBUTES } from '../../contracts/content';
import { Bar, PixelIcon, cx, usePortrait } from '../components/common';
import { useLocal } from '../local';
import { ATTRIBUTE_INFO } from '../lib/content';
import { formatInt, fraction } from '../lib/format';
import { useStore, useUi } from '../store';
import { PanelShell } from './PanelShell';
import { confirmRefund } from './Skills';

export function CharacterPanel() {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const derived = useUi((s) => s.derived);
  const inHideout = useUi((s) => s.zone === 'hideout');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const portrait = usePortrait(128);
  if (!ch) return null;
  const xpNext = store.rules.xpToNext(ch.level);
  const points = ch.unspentAttributePoints;
  const sections = (derived?.sections ?? []).filter((s) => s.title !== 'Attributes');
  const attrSection = derived?.sections.find((s) => s.title === 'Attributes');
  const skillPoints = ch.unspentSkillPoints ?? 0;
  const spent = Math.max(0, store.rules.skillPointsTotal(ch.level) - skillPoints);
  const tokens = Math.max(0, Math.floor(ch.respecTokens ?? 0));

  return (
    <PanelShell panel="character" title="Character" class="fe-char">
      <div class="fe-char__hero">
        <div class="fe-char__portrait">
          <img class="fe-px" src={portrait} alt="" draggable={false} />
        </div>
        <div class="fe-char__id">
          <div class="fe-char__name">{ch.name}</div>
          <div class="fe-char__class">Level {ch.level} Sorceress</div>
          <div
            class="fe-char__xp"
            onPointerEnter={(e) =>
              local.showTooltip(
                {
                  kind: 'text',
                  title: 'Experience',
                  lines: [
                    `${formatInt(ch.xp)} / ${formatInt(xpNext)}`,
                    `${formatInt(Math.max(0, xpNext - ch.xp))} to level ${ch.level + 1}`,
                  ],
                },
                e.currentTarget,
                'above',
              )
            }
            onPointerLeave={() => local.hideTooltip()}
          >
            <Bar value={fraction(ch.xp, xpNext)} kind="xp" />
            <span class="fe-char__xp-text ui-type-caption">
              {formatInt(ch.xp)} / {formatInt(xpNext)} experience
            </span>
          </div>
        </div>
      </div>

      <div class="fe-char__attrs">
        {ATTRIBUTES.map((a) => {
          const value = derived?.attributes[a] ?? 0;
          const line = attrSection?.lines.find((l) => l.label === ATTRIBUTE_INFO[a].label);
          return (
            <div
              class="fe-attr"
              key={a}
              onPointerEnter={(e) =>
                line && local.showTooltip({ kind: 'text', title: ATTRIBUTE_INFO[a].label, lines: line.breakdown }, e.currentTarget, 'above')
              }
              onPointerLeave={() => local.hideTooltip()}
            >
              <PixelIcon id={ATTRIBUTE_INFO[a].icon} width={28} height={28} />
              <span class="fe-attr__label">{ATTRIBUTE_INFO[a].label}</span>
              <span class="fe-attr__value">{Math.floor(value)}</span>
              <button
                class="fe-attr__plus"
                disabled={points <= 0}
                aria-label={`Allocate a point to ${ATTRIBUTE_INFO[a].label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  store.actions.uiSound('click');
                  store.actions.allocateAttribute(a);
                }}
              >
                +
              </button>
            </div>
          );
        })}
        <div class={cx('fe-char__points', points > 0 && 'fe-char__points--has')}>
          {points > 0 ? `${points} attribute point${points === 1 ? '' : 's'} to spend` : 'No attribute points to spend'}
        </div>
        <div class="fe-char__wants ui-type-caption" data-class-wants>
          {SORCERESS.name}: {SORCERESS.perAttribute.map(attributeRuleText).join(' · ')}.
        </div>
      </div>

      <div class="fe-char__skills" data-char-skills>
        <span class={cx('fe-char__skillpts ui-type-caption', skillPoints > 0 && 'fe-char__points--has')}>
          {skillPoints > 0 ? `${skillPoints} skill point${skillPoints === 1 ? '' : 's'} to spend` : `${spent} skill points spent`}
        </span>
        <button
          class={cx('fe-btn fe-btn--small', skillPoints > 0 && 'fe-btn--ember')}
          onClick={() => {
            store.actions.uiSound('open');
            store.actions.openPanel('skills');
          }}
        >
          Skills (K)
        </button>
        {tokens > 0 && (
          <button
            class="fe-btn fe-btn--small"
            disabled={!inHideout}
            title={inHideout ? undefined : 'Respec in a hideout.'}
            onClick={() => {
              local.dialog.set({
                title: 'Use a free respec?',
                confirmLabel: 'Respec for free',
                body: `Every skill, augment and attribute point comes back to spend again (Ember Lance keeps rank 1). You have ${tokens} free respec${tokens === 1 ? '' : 's'}.`,
                onConfirm: () => store.actions.respec(null, true, 0),
              });
            }}
          >
            Free respec ({tokens})
          </button>
        )}
        <button
          class="fe-btn fe-btn--small fe-btn--ghost"
          disabled={!inHideout || spent <= 0}
          title={!inHideout ? 'Skills are refunded in a hideout.' : spent <= 0 ? 'No skill points are spent.' : undefined}
          onClick={() =>
            confirmRefund(store, local, ch, inHideout, { title: 'Refund every skill?', target: { all: true } }, (scrap) =>
              store.actions.respec(null, false, scrap),
            )
          }
        >
          Refund all skills
        </button>
      </div>

      <div class="fe-char__sheet fe-scrollfade">
        {sections.map((sec) => (
          <div class="fe-sheet" key={sec.title}>
            <div class="fe-section-title">{sec.title}</div>
            {sec.lines.map((l) => {
              const key = `${sec.title}/${l.label}`;
              const isOpen = !!open[key];
              return (
                <div class={cx('fe-sheet__line', isOpen && 'fe-sheet__line--open')} key={key}>
                  <button
                    class="fe-sheet__row"
                    aria-expanded={isOpen}
                    disabled={l.breakdown.length === 0}
                    onClick={() => {
                      store.actions.uiSound('click');
                      setOpen({ ...open, [key]: !isOpen });
                    }}
                  >
                    <span class="fe-sheet__chev" />
                    <span class="fe-sheet__label">{l.label}</span>
                    <span class="fe-sheet__dots" />
                    <span class="fe-sheet__value">{l.value}</span>
                  </button>
                  {isOpen && (
                    <ul class="fe-sheet__breakdown">
                      {l.breakdown.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {!derived && <div class="fe-muted">Stats are on their way from the server.</div>}
      </div>
    </PanelShell>
  );
}
