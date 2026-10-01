// Skill tree (docked left): branches in columns, tiers in rows, prerequisite connectors, rank pips and
// rank-up, plus the loadout bar. Click a learned skill then a slot (or a slot then a skill) to assign it.
import { useMemo, useState } from 'preact/hooks';
import type { SkillId } from '../../contracts/content';
import { LOADOUT_KEYS, LOADOUT_SLOTS } from '../../contracts/items';
import { Keycap, PixelIcon, cx } from '../components/common';
import { safe } from '../items/hooks';
import { useLocal } from '../local';
import { BRANCH_LABEL, layoutSkillTree } from '../lib/skilltree';
import { allowSkillDrop, beginSkillDrag, droppedSkill } from '../lib/loadout';
import { shallowEqual, useStore, useUi } from '../store';
import { PanelShell } from './PanelShell';

const ROW_H = 138;
const ICON_TOP = 22;
const ICON = 52;
/** Bottom of a node's label block (icon, name, pips, rank) relative to its row: connectors start below it. */
const NODE_BOTTOM = 124;

type Pick = { skill: SkillId } | { slot: number } | null;

export function SkillsPanel() {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const keyLabels = useUi((s) => s.hud?.slots.map((slot) => slot.key) ?? LOADOUT_KEYS, shallowEqual);
  const [pick, setPick] = useState<Pick>(null);
  const skills = store.rules.content.skills;
  const layout = useMemo(() => layoutSkillTree(Object.values(skills)), [skills]);
  if (!ch) return null;
  const points = ch.unspentSkillPoints;
  const rank = (id: SkillId): number => ch.skillRanks[id] ?? 0;
  const slotOf = (id: SkillId): number => ch.loadout.indexOf(id);

  const assign = (slot: number, skill: SkillId | null): void => {
    const res = safe(() => store.rules.setLoadoutSlot(ch, slot, skill), { ok: false as const, error: 'That skill cannot go there.' });
    setPick(null);
    if (!res.ok) {
      store.actions.uiSound('error');
      local.flashHint(res.error);
      return;
    }
    store.actions.uiSound('equip');
    store.actions.setLoadoutSlot(slot, skill);
  };

  const pickedSkill = pick && 'skill' in pick ? pick.skill : null;
  const pickedSlot = pick && 'slot' in pick ? pick.slot : null;
  const height = layout.rows * ROW_H;
  const colPct = (x: number): string => `${(x / layout.columns) * 100}%`;

  return (
    <PanelShell
      panel="skills"
      title="Skills"
      class="fe-skills"
      aside={
        <span class={cx('fe-points', points > 0 && 'fe-points--has')}>
          {points} skill point{points === 1 ? '' : 's'}
        </span>
      }
    >
      {/* The tree scrolls when the screen is short; the loadout bar below stays pinned. */}
      <div class="fe-skills__scroll fe-scrollfade">
        <div class="fe-tree__branches">
          {layout.branches.map((b) => (
            <div key={b.branch} class="fe-tree__branch" style={{ left: colPct(b.start), width: colPct(b.width) }}>
              {BRANCH_LABEL[b.branch]}
            </div>
          ))}
        </div>
        <div class="fe-tree" style={{ height }} onClick={(e) => e.target === e.currentTarget && setPick(null)}>
          {layout.branches.slice(1).map((b) => (
            <div key={b.branch} class="fe-tree__divider" style={{ left: colPct(b.start) }} />
          ))}
          <svg class="fe-tree__edges" width="100%" height={height} aria-hidden="true">
            {layout.edges.map((e) => {
              const a = layout.nodes.find((n) => n.id === e.from)!;
              const b = layout.nodes.find((n) => n.id === e.to)!;
              const lit = rank(e.from) >= e.rank;
              return (
                <g key={`${e.from}-${e.to}`} class={cx('fe-edge', lit && 'fe-edge--lit')}>
                  <line x1={colPct(a.x)} y1={a.y * ROW_H + NODE_BOTTOM} x2={colPct(b.x)} y2={b.y * ROW_H + ICON_TOP - 3} />
                </g>
              );
            })}
          </svg>
          {layout.edges.map((e) => {
            const a = layout.nodes.find((n) => n.id === e.from)!;
            const b = layout.nodes.find((n) => n.id === e.to)!;
            const lit = rank(e.from) >= e.rank;
            const midY = (a.y * ROW_H + NODE_BOTTOM + b.y * ROW_H + ICON_TOP) / 2;
            return (
              <span
                key={`r-${e.from}-${e.to}`}
                class={cx('fe-edge__req', lit && 'fe-edge__req--lit')}
                style={{ left: colPct((a.x + b.x) / 2), top: midY }}
                title={`Needs ${skills[e.from].name} rank ${e.rank}`}
              >
                {e.rank}
              </span>
            );
          })}
          {layout.nodes.map((n) => {
            const info = skills[n.id];
            const r = rank(n.id);
            const can = safe(() => store.rules.canRankUpSkill(ch, n.id), { ok: false });
            const learned = r > 0;
            const locked = !learned && !can.ok;
            const slot = slotOf(n.id);
            return (
              <div
                key={n.id}
                class={cx(
                  'fe-node',
                  learned && 'fe-node--learned',
                  locked && 'fe-node--locked',
                  !learned && can.ok && 'fe-node--ready',
                  r >= info.maxRank && 'fe-node--max',
                  pickedSkill === n.id && 'fe-node--picked',
                  pickedSlot !== null && learned && 'fe-node--target',
                )}
                style={{ left: colPct(n.x), top: n.y * ROW_H }}
              >
                <button
                  class="fe-node__icon"
                  aria-label={`${info.name}, rank ${r} of ${info.maxRank}`}
                  draggable={learned}
                  onDragStart={(e) => {
                    local.hideTooltip();
                    beginSkillDrag(e, learned ? n.id : null);
                  }}
                  onPointerEnter={(e) => local.showTooltip({ kind: 'skill', skillId: n.id }, e.currentTarget)}
                  onPointerLeave={() => local.hideTooltip()}
                  onClick={() => {
                    if (!learned) {
                      store.actions.uiSound('error');
                      local.flashHint(can.ok ? 'Spend a skill point to learn it first.' : (can.reason ?? 'Locked.'));
                      return;
                    }
                    if (pickedSlot !== null) assign(pickedSlot, n.id);
                    else {
                      store.actions.uiSound('click');
                      setPick(pickedSkill === n.id ? null : { skill: n.id });
                    }
                  }}
                >
                  <PixelIcon id={`icon/skill/${n.id}`} width={ICON - 8} height={ICON - 8} />
                  {locked && <PixelIcon id="icon/ui/locked" class="fe-node__lock" width={20} height={20} />}
                  {slot >= 0 && (
                    <span class="fe-node__slot">
                      <Keycap>{keyLabels[slot]}</Keycap>
                    </span>
                  )}
                </button>
                {r < info.maxRank && (
                  <button
                    class={cx('fe-node__rank', can.ok && 'fe-node__rank--on')}
                    disabled={!can.ok}
                    aria-label={`Rank up ${info.name}`}
                    onPointerEnter={(e) =>
                      local.showTooltip(
                        {
                          kind: 'text',
                          lines: [can.ok ? `Spend 1 point: rank ${r + 1}` : (can.reason ?? 'Unavailable')],
                          tone: can.ok ? 'good' : 'bad',
                        },
                        e.currentTarget,
                        'above',
                      )
                    }
                    onPointerLeave={() => local.hideTooltip()}
                    onClick={() => {
                      store.actions.uiSound('click');
                      store.actions.rankUpSkill(n.id);
                    }}
                  >
                    +
                  </button>
                )}
                <div class="fe-node__name">{info.name}</div>
                <div class="fe-node__pips" aria-hidden="true">
                  {Array.from({ length: info.maxRank }, (_, i) => (
                    <i key={i} class={cx(i < r && 'on')} />
                  ))}
                </div>
                <div class="fe-node__rankval">
                  {r}/{info.maxRank}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div class="fe-loadout">
        <div class="fe-loadout__label">
          {pickedSkill
            ? `Choose a slot for ${skills[pickedSkill].name}`
            : pickedSlot !== null
              ? 'Choose a learned skill for this slot'
              : 'Drag skills to any slot, or click a skill then a slot. Right-click to clear.'}
        </div>
        <div class="fe-loadout__slots">
          {Array.from({ length: LOADOUT_SLOTS }, (_, i) => {
            const id = ch.loadout[i] ?? null;
            const valid = pickedSkill ? safe(() => store.rules.setLoadoutSlot(ch, i, pickedSkill).ok, false) : false;
            return (
              <button
                key={i}
                aria-label={`${keyLabels[i]}: ${id ? skills[id].name : 'Empty slot'}`}
                class={cx('fe-lslot', pickedSkill && (valid ? 'fe-lslot--ok' : 'fe-lslot--no'), pickedSlot === i && 'fe-lslot--picked')}
                draggable={!!id}
                onDragStart={(e) => {
                  setPick(null);
                  local.hideTooltip();
                  beginSkillDrag(e, id);
                }}
                onDragOver={allowSkillDrop}
                onDrop={(e) => {
                  const skill = droppedSkill(e);
                  if (skill) assign(i, skill);
                }}
                onClick={() => {
                  if (pickedSkill) assign(i, pickedSkill);
                  else {
                    store.actions.uiSound('click');
                    setPick(pickedSlot === i ? null : { slot: i });
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (id) assign(i, null);
                }}
                onPointerEnter={(e) => id && local.showTooltip({ kind: 'skill', skillId: id }, e.currentTarget, 'above')}
                onPointerLeave={() => local.hideTooltip()}
              >
                {id ? <PixelIcon id={`icon/skill/${id}`} width={36} height={36} /> : <span class="fe-lslot__empty" />}
                <span class="fe-lslot__key">
                  <Keycap>{keyLabels[i]}</Keycap>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </PanelShell>
  );
}
