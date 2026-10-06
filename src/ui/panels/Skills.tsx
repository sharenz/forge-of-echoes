// Skills panel v2 (docs/power-rework/skills.md 10), docked left, K:
//  - left rail: the skill book grouped by element with a search box; learned skills show rank and augments, locked ones their
//    unlock level, skills whose behaviour has not shipped stay hidden (one line says how many are coming); "+" spends a point;
//  - centre: the selected skill: rank pips, a rank-up button with its "if you rank up" deltas, the current numbers, and the
//    augment graph (tiers at ranks 2/5/8, slots, exclusions, T3 costs 2, before/after numbers on hover, refunds with their price);
//  - bottom: the loadout bar (8 slots) and the 3 presets (load, save, rename).
// Assign by dragging a skill onto a slot, by clicking a skill then a slot (or a slot then a skill), Ctrl/Cmd-click = first free
// slot, right-click (or Delete) clears a slot. Keyboard: arrows move through the book, + ranks up, 1-8 put the skill on a slot.
// Everything is read from SkillInfo, so new skills appear on their own when their data turns `available`.
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { SkillId } from '../../contracts/content';
import type { AugmentInfo } from '../../contracts/game';
import type { CharacterSave } from '../../contracts/items';
import { LOADOUT_KEYS, LOADOUT_PRESETS, LOADOUT_SLOTS } from '../../contracts/items';
import { RESPEC } from '../../data/progression';
import { currencyOnHand } from '../../game/progression/merchant';
import { normalizePresets } from '../../game/progression/skills';
import { Keycap, PixelIcon, cx } from '../components/common';
import { safe } from '../items/hooks';
import { useLocal, type Local } from '../local';
import { allowSkillDrop, beginSkillDrag, droppedSkill, firstFreeSlot, matchingPreset, presetEmpty } from '../lib/loadout';
import {
  augmentGraph,
  refundSummary,
  sheetDeltas,
  skillBook,
  stepBook,
  withAugment,
  withoutAugment,
  type AugmentNode,
  type BookEntry,
  type Delta,
} from '../lib/skilltree';
import { shallowEqual, useStore, useUi } from '../store';
import type { UiStore } from '../../contracts/ui';
import { PanelShell } from './PanelShell';

type Pick = { skill: SkillId } | { slot: number } | null;

const AUG_STATE_LABEL: Record<AugmentNode['state'], string> = {
  picked: 'Chosen',
  open: '',
  needsRank: '',
  excluded: '',
  noSlot: 'No free slot',
  noPoints: 'Not enough points',
  coming: 'Coming later',
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Ask before a refund: the dialog states the points back and the exact Scrap price, which is sent as `expectedScrap`. */
export function confirmRefund(
  store: UiStore,
  local: Local,
  ch: CharacterSave,
  inHideout: boolean,
  what: { title: string; target: { skillId: SkillId; augmentId?: string } | { all: true } },
  run: (scrap: number) => void,
): void {
  local.hideTooltip();
  if (!inHideout) {
    store.actions.uiSound('error');
    local.flashHint('Skills and augments are refunded in a hideout.');
    return;
  }
  const price = safe(() => store.rules.respecPrice(ch, what.target), { points: 0, freePoints: 0, scrap: 0 });
  if (price.points <= 0) {
    store.actions.uiSound('error');
    local.flashHint('There is nothing to refund.');
    return;
  }
  const scrap = safe(() => currencyOnHand(ch, 'scrap'), 0);
  const sum = refundSummary(price, ch.level, scrap, RESPEC.freeBelowLevel);
  if (!sum.affordable) {
    store.actions.uiSound('error');
    local.flashHint(`The refund costs ${price.scrap} Forge Scrap. You have ${scrap}.`);
    return;
  }
  local.dialog.set({
    title: what.title,
    confirmLabel: sum.confirm,
    danger: price.scrap > 0,
    // The dialog wraps the body in a <p>: lines are block spans.
    body: (
      <>
        {sum.lines.map((l, i) => (
          <span key={i} class="fe-sk-refund">
            {l}
          </span>
        ))}
      </>
    ),
    onConfirm: () => run(price.scrap),
  });
}

function DeltaList({ deltas, empty }: { deltas: Delta[]; empty?: string }) {
  if (!deltas.length) return empty ? <div class="fe-sk-delta fe-muted">{empty}</div> : null;
  return (
    <ul class="fe-sk-deltas">
      {deltas.map((d) => (
        <li key={d.label} class={cx('fe-sk-delta', d.better ? 'fe-sk-delta--up' : 'fe-sk-delta--down')}>
          <span class="fe-sk-delta__label">{d.label}</span>
          <span class="fe-sk-delta__from">{d.from}</span>
          <span class="fe-sk-delta__arrow" aria-hidden="true">
            →
          </span>
          <span class="fe-sk-delta__to">{d.to}</span>
        </li>
      ))}
    </ul>
  );
}

/** Augment hover card: full text, cost, why it cannot be picked, and the numbers before and after (or after a refund). */
function AugmentTip({ store, ch, skillId, node }: { store: UiStore; ch: CharacterSave; skillId: SkillId; node: AugmentNode }) {
  const a = node.info;
  const picked = node.state === 'picked';
  const now = safe(() => store.rules.skillSheet(ch, skillId), null);
  const other = safe(
    () => store.rules.skillSheet(picked ? withoutAugment(ch, skillId, a.id) : withAugment(ch, skillId, a.id), skillId),
    null,
  );
  const deltas = now && other ? (picked ? sheetDeltas(other, now) : sheetDeltas(now, other)) : [];
  const can = picked ? null : safe(() => store.rules.canPickAugment(ch, skillId, a.id), { ok: false, reason: 'Unavailable' });
  const price = picked ? safe(() => store.rules.respecPrice(ch, { skillId, augmentId: a.id }), null) : null;
  return (
    <div class="fe-tt fe-tt--skill fe-tt--aug">
      <div class="fe-tt__title">{a.name}</div>
      <div class="fe-tt__subtitle">
        Tier {a.tier} · needs rank {a.rankRequired} · costs {plural(a.cost, 'point')}
      </div>
      <div class="fe-tt__body fe-tt__body--left">
        <div class="fe-tt__desc">{a.text}</div>
        {node.excludes.length > 0 && <div class="fe-tt__skillline fe-muted">Cannot be combined with {node.excludes.join(', ')}.</div>}
        {node.state !== 'coming' && (
          <>
            <div class="fe-tt__sep" />
            <div class="fe-tt__cap">{picked ? 'What it adds now' : 'If you pick it'}</div>
            <DeltaList deltas={deltas} empty="Changes how the skill behaves; its numbers stay the same." />
          </>
        )}
        {picked && price && (
          <div class="fe-tt__hint">
            Click to refund: {price.scrap > 0 ? `${price.scrap} Forge Scrap` : 'free'}, {plural(price.points, 'point')} back.
          </div>
        )}
        {!picked && can && !can.ok && can.reason && <div class="fe-tt__req fe-tt__req--unmet">{can.reason}</div>}
        {!picked && can?.ok && <div class="fe-tt__hint">Click to spend {plural(a.cost, 'skill point')}.</div>}
      </div>
    </div>
  );
}

export function SkillsPanel() {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const inHideout = useUi((s) => s.zone === 'hideout');
  const keyLabels = useUi((s) => s.hud?.slots.map((slot) => slot.key) ?? LOADOUT_KEYS, shallowEqual);
  const [pick, setPick] = useState<Pick>(null);
  const [selected, setSelected] = useState<SkillId | null>(null);
  const [query, setQuery] = useState('');
  const [preset, setPresetSel] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const skills = store.rules.content.skills;
  const all = useMemo(() => Object.values(skills), [skills]);
  const book = useMemo(
    () => (ch ? skillBook(all, ch, query) : { groups: [], order: [], coming: 0 }),
    [all, ch?.level, ch?.skillRanks, ch?.loadout, ch?.augments, query],
  );

  // Arrow keys move the selection; keep the focused row in view.
  const focusRow = (id: SkillId): void => {
    const el = railRef.current?.querySelector<HTMLElement>(`[data-skill-row="${id}"]`);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest' });
  };
  useEffect(() => setRenaming(null), [ch?.id]);

  if (!ch) return null;
  const points = ch.unspentSkillPoints ?? 0;
  const rank = (id: SkillId): number => ch.skillRanks[id] ?? 0;
  // Default selection: the first skill a point can go into, else the basic attack.
  const canRank = (id: SkillId) => safe(() => store.rules.canRankUpSkill(ch, id), { ok: false as boolean, reason: 'Unavailable' as string | undefined });
  const sel: SkillId =
    selected && skills[selected] ? selected : (book.order.find((id) => canRank(id).ok && rank(id) === 0) ?? book.order[0] ?? 'emberLance');
  const info = skills[sel];
  const loadout = ch.loadout;
  const presets = normalizePresets(ch.loadoutPresets);
  const active = matchingPreset(presets, loadout, LOADOUT_SLOTS);
  const presetIdx = preset ?? (active >= 0 ? active : 0);
  const pickedSkill = pick && 'skill' in pick ? pick.skill : null;
  const pickedSlot = pick && 'slot' in pick ? pick.slot : null;

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

  const rankUp = (id: SkillId): void => {
    const can = canRank(id);
    if (!can.ok) {
      store.actions.uiSound('error');
      local.flashHint(can.reason ?? 'That skill cannot be ranked up.');
      return;
    }
    store.actions.uiSound('click');
    store.actions.rankUpSkill(id);
  };

  const quickSlot = (id: SkillId): void => {
    if (rank(id) < 1) {
      store.actions.uiSound('error');
      local.flashHint(`Learn ${skills[id].name} first: spend a skill point on it.`);
      return;
    }
    const free = firstFreeSlot(loadout, id, LOADOUT_SLOTS);
    if (free < 0) {
      store.actions.uiSound('error');
      local.flashHint(loadout.includes(id) ? `${skills[id].name} is already on your bar.` : 'Every slot is taken: drag it onto a slot to swap.');
      return;
    }
    assign(free, id);
  };

  const choose = (id: SkillId, e?: { ctrlKey?: boolean; metaKey?: boolean }): void => {
    setSelected(id);
    if (e && (e.ctrlKey || e.metaKey)) {
      quickSlot(id);
      return;
    }
    if (rank(id) < 1) {
      setPick(null);
      store.actions.uiSound('click');
      return;
    }
    if (pickedSlot !== null) {
      assign(pickedSlot, id);
      return;
    }
    store.actions.uiSound('click');
    setPick(pickedSkill === id ? null : { skill: id });
  };

  const rowKeys = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>, id: SkillId): void => {
    let handled = true;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = stepBook(book.order, id, e.key === 'ArrowDown' ? 1 : -1);
      if (next) {
        setSelected(next);
        focusRow(next);
      }
    } else if (e.key === 'Enter' || e.key === ' ') choose(id, e);
    else if (e.key === '+' || e.key === '=') rankUp(id);
    else if (/^[1-8]$/.test(e.key) && Number(e.key) <= LOADOUT_SLOTS) {
      if (rank(id) < 1) {
        store.actions.uiSound('error');
        local.flashHint(`Learn ${skills[id].name} first: spend a skill point on it.`);
      } else assign(Number(e.key) - 1, id);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const row = (en: BookEntry) => {
    const can = canRank(en.id);
    const tipCompare = sel !== en.id && rank(sel) > 0 ? sel : null;
    return (
      <div
        key={en.id}
        class={cx(
          'fe-sk-row',
          `fe-sk-row--${en.state}`,
          sel === en.id && 'fe-sk-row--sel',
          pickedSkill === en.id && 'fe-sk-row--picked',
          pickedSlot !== null && en.state === 'learned' && 'fe-sk-row--target',
          can.ok && 'fe-sk-row--ready',
        )}
      >
        <button
          class="fe-sk-row__main"
          data-skill-row={en.id}
          aria-label={`${en.name}, rank ${en.rank} of ${en.maxRank}`}
          aria-pressed={sel === en.id}
          draggable={en.state === 'learned'}
          onDragStart={(e) => {
            local.hideTooltip();
            beginSkillDrag(e, en.state === 'learned' ? en.id : null);
          }}
          onPointerEnter={(e) => local.showTooltip({ kind: 'skill', skillId: en.id, compareTo: tipCompare }, e.currentTarget)}
          onPointerLeave={() => local.hideTooltip()}
          onClick={(e) => choose(en.id, e)}
          onKeyDown={(e) => rowKeys(e, en.id)}
        >
          <span class="fe-sk-row__icon">
            <PixelIcon id={`icon/skill/${en.id}`} width={32} height={32} />
            {en.slot >= 0 && (
              <span class="fe-sk-row__slot">
                <Keycap>{keyLabels[en.slot]}</Keycap>
              </span>
            )}
          </span>
          <span class="fe-sk-row__text">
            <span class="fe-sk-row__name ui-type-secondary">{en.name}</span>
            <span class="fe-sk-row__sub ui-type-caption">
              {en.state === 'learned' ? (
                <>
                  Rank {en.rank}/{en.maxRank}
                  {en.augments > 0 && (
                    <span class="fe-sk-row__augs" title={plural(en.augments, 'augment')}>
                      {Array.from({ length: en.augments }, (_, k) => (
                        <i key={k} />
                      ))}
                    </span>
                  )}
                </>
              ) : en.state === 'learnable'
                  ? 'Not learned · 1 point'
                  : `Level ${en.unlockLevel}`}
            </span>
          </span>
        </button>
        {can.ok && (
          <button
            class="fe-sk-row__plus"
            aria-label={`Rank up ${en.name}`}
            onPointerEnter={(e) =>
              local.showTooltip(
                { kind: 'text', lines: [en.rank > 0 ? `Spend 1 point: rank ${en.rank + 1}` : `Spend 1 point: learn ${en.name}`], tone: 'good' },
                e.currentTarget,
                'above',
              )
            }
            onPointerLeave={() => local.hideTooltip()}
            onClick={() => {
              setSelected(en.id);
              rankUp(en.id);
            }}
          >
            +
          </button>
        )}
      </div>
    );
  };

  // --- the selected skill ---------------------------------------------------------------------------------------------
  const r = rank(sel);
  const picked = ch.augments?.[sel] ?? [];
  const graph = augmentGraph(info, r, picked, points);
  const sheet = safe(() => store.rules.skillSheet(ch, sel), null);
  const nextSheet = r > 0 && r < info.maxRank ? safe(() => store.rules.skillSheet(ch, sel, r + 1), null) : null;
  const rankDeltas = sheet && nextSheet ? sheetDeltas(sheet, nextSheet) : [];
  const can = canRank(sel);
  const inSkill = safe(() => store.rules.respecPrice(ch, { skillId: sel }), { points: 0, freePoints: 0, scrap: 0 });
  const augLines = sheet?.augmentLines ?? [];
  const baseLines = sheet ? (augLines.length ? sheet.lines.slice(0, Math.max(0, sheet.lines.length - augLines.length)) : sheet.lines) : [];

  const pickAug = (node: AugmentNode): void => {
    const a = node.info;
    if (node.state === 'picked') {
      confirmRefund(store, local, ch, inHideout, { title: `Refund ${a.name}?`, target: { skillId: sel, augmentId: a.id } }, (scrap) =>
        store.actions.refundAugment(sel, a.id, scrap),
      );
      return;
    }
    const ok = safe(() => store.rules.canPickAugment(ch, sel, a.id), { ok: false, reason: 'Unavailable' });
    if (!ok.ok) {
      store.actions.uiSound('error');
      local.flashHint(ok.reason ?? 'That augment cannot be chosen.');
      return;
    }
    local.hideTooltip();
    store.actions.uiSound('equip');
    store.actions.pickAugment(sel, a.id);
  };

  const plate = (node: AugmentNode) => {
    const a: AugmentInfo = node.info;
    const status =
      node.state === 'needsRank'
        ? `Needs rank ${a.rankRequired}`
        : node.state === 'excluded'
          ? `Not with ${node.excludedBy}`
          : AUG_STATE_LABEL[node.state];
    return (
      <button
        key={a.id}
        class={cx('fe-aug', `fe-aug--${node.state}`, a.tier === 3 && 'fe-aug--t3')}
        data-augment={a.id}
        aria-label={`${a.name}, tier ${a.tier}, ${plural(a.cost, 'point')}${status ? `, ${status}` : ''}`}
        aria-pressed={node.state === 'picked'}
        onPointerEnter={(e) =>
          local.showTooltip({ kind: 'custom', render: () => <AugmentTip store={store} ch={ch} skillId={sel} node={node} />, owner: 'aug' }, e.currentTarget)
        }
        onPointerLeave={() => local.hideTooltip()}
        onClick={() => pickAug(node)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          e.stopPropagation();
          pickAug(node);
        }}
      >
        <span class="fe-aug__head">
          <span class="fe-aug__name ui-type-secondary">{a.name}</span>
          <span class="fe-aug__cost ui-type-caption" aria-hidden="true">
            {a.cost}
          </span>
        </span>
        <span class="fe-aug__text ui-type-caption">{a.text}</span>
        {(status || node.excludes.length > 0) && (
          <span class="fe-aug__foot ui-type-caption">
            {status && <span class="fe-aug__status">{status}</span>}
            {node.excludes.length > 0 && node.state !== 'excluded' && (
              <span class="fe-aug__chain" title={`Cannot be combined with ${node.excludes.join(', ')}`}>
                ⛓ {node.excludes.join(', ')}
              </span>
            )}
          </span>
        )}
      </button>
    );
  };

  // --- presets ----------------------------------------------------------------------------------------------------------
  const presetAction = (op: 'save' | 'load'): void => {
    const p = presets[presetIdx];
    if (op === 'load') {
      if (!inHideout) {
        store.actions.uiSound('error');
        local.flashHint('Loadout presets are switched in a hideout.');
        return;
      }
      if (presetEmpty(p)) {
        store.actions.uiSound('error');
        local.flashHint(`${p.name} is empty: save your bar into it first.`);
        return;
      }
    }
    store.actions.uiSound(op === 'load' ? 'equip' : 'click');
    store.actions.setPreset(presetIdx, op);
    if (op === 'save') local.flashHint(`Saved your bar as ${p.name}.`);
  };
  const commitRename = (): void => {
    if (renaming === null) return;
    store.actions.setPreset(presetIdx, 'rename', renaming);
    setRenaming(null);
  };

  return (
    <PanelShell
      panel="skills"
      title="Skills"
      class="fe-skills"
      aside={
        <span class={cx('fe-points', points > 0 && 'fe-points--has')} data-skill-points={points}>
          {plural(points, 'skill point')}
        </span>
      }
    >
      <div class="fe-sk" onClick={(e) => e.target === e.currentTarget && setPick(null)}>
        <div class="fe-sk-rail">
          <input
            class="fe-input fe-sk-rail__search ui-type-secondary"
            type="search"
            placeholder="Search skills"
            aria-label="Search skills"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && book.order[0]) {
                e.preventDefault();
                setSelected(book.order[0]);
                focusRow(book.order[0]);
              }
            }}
          />
          <div class="fe-sk-rail__list fe-scrollfade" ref={railRef} role="group" aria-label="Skill book">
            {book.groups.map((g) => (
              <div class="fe-sk-group" key={g.element}>
                <div class={cx('fe-sk-group__title ui-type-caption', `fe-sk-group__title--${g.element}`)}>{g.label}</div>
                {g.entries.map(row)}
              </div>
            ))}
            {!book.groups.length && <div class="fe-muted ui-type-caption">No skill matches “{query}”.</div>}
            {book.coming > 0 && !query && (
              <div class="fe-sk-rail__coming ui-type-caption">{plural(book.coming, 'more skill')} arrive in later updates.</div>
            )}
          </div>
        </div>

        <div class="fe-sk-detail fe-scrollfade" data-skill-detail={sel}>
          <div class="fe-sk-head">
            <span class={cx('fe-sk-head__icon', r > 0 && 'fe-sk-head__icon--learned')}>
              <PixelIcon id={`icon/skill/${sel}`} width={44} height={44} />
            </span>
            <div class="fe-sk-head__id">
              <div class="fe-sk-head__name ui-type-body">{info.name}</div>
              <div class="fe-sk-head__tags ui-type-caption">{[info.tags.join(', '), r > 0 ? `Rank ${r} of ${info.maxRank}` : `Unlocks at level ${info.unlockLevel}`].filter(Boolean).join(' · ')}</div>
              <div class="fe-sk-pips" aria-hidden="true">
                {Array.from({ length: info.maxRank }, (_, i) => (
                  <i key={i} class={cx(i < r && 'on', [2, 5, 8].includes(i + 1) && 'tier')} />
                ))}
              </div>
            </div>
          </div>

          <div class="fe-sk-actions">
            {r < info.maxRank && (
              <button
                class={cx('fe-btn fe-btn--small', can.ok && 'fe-btn--ember')}
                disabled={!can.ok}
                aria-label={`Rank up ${info.name} to rank ${r + 1}`}
                onClick={() => rankUp(sel)}
              >
                {r > 0 ? `Rank up · 1 point` : `Learn · 1 point`}
              </button>
            )}
            {inSkill.points > 0 && (
              <button
                class="fe-btn fe-btn--small fe-btn--ghost"
                disabled={!inHideout}
                title={inHideout ? undefined : 'Skills are refunded in a hideout.'}
                onClick={() =>
                  confirmRefund(
                    store,
                    local,
                    ch,
                    inHideout,
                    { title: `Refund ${info.name}?`, target: { skillId: sel } },
                    (scrap) => store.actions.respec(sel, false, scrap),
                  )
                }
              >
                Refund skill
              </button>
            )}
          </div>
          {r >= info.maxRank && <div class="fe-sk-note ui-type-caption">Mastered: the highest rank.</div>}
          {r < info.maxRank && !can.ok && can.reason && <div class="fe-sk-note fe-sk-note--bad ui-type-caption">{can.reason}</div>}
          {r > 0 && r < info.maxRank && (
            <div class="fe-sk-box">
              <div class="fe-sk-box__cap ui-type-caption">If you rank up</div>
              <DeltaList deltas={rankDeltas} />
              {(sheet?.nextRankLines ?? [])
                .filter((l) => /augment/i.test(l))
                .map((l) => (
                  <div class="fe-sk-delta fe-sk-delta--up" key={l}>
                    {l}
                  </div>
                ))}
            </div>
          )}

          <div class="fe-sk-desc ui-type-caption">{info.description}</div>

          {graph.tiers.length > 0 && (
            <div class="fe-augs" role="group" aria-label={`${info.name} augments`}>
              <div class="fe-augs__head">
                <span class="fe-augs__title ui-type-secondary">Augments</span>
                <span class="fe-augs__slots ui-type-caption" data-aug-slots={`${graph.used}/${graph.slots}`}>
                  {graph.slots > 0 ? `${graph.used} of ${graph.slots} slots used` : 'Slots open at rank 2'}
                  {graph.nextSlotRank !== null && graph.slots > 0 && ` · next slot at rank ${graph.nextSlotRank}`}
                </span>
              </div>
              {graph.tiers.map((t) => (
                <div key={t.tier} class={cx('fe-augs__tier', !t.unlocked && 'fe-augs__tier--locked')}>
                  <div class="fe-augs__tierlabel ui-type-caption">
                    Tier {t.tier} · rank {t.rankRequired}
                    {t.tier === 3 ? ' · 2 points each' : ''}
                  </div>
                  <div class="fe-augs__plates">{t.nodes.map(plate)}</div>
                </div>
              ))}
              {augLines.length > 0 && (
                <ul class="fe-sk-lines fe-sk-lines--aug ui-type-caption">
                  {augLines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {baseLines.length > 0 && (
            <div class="fe-sk-numbers">
              <div class="fe-sk-box__cap ui-type-caption">{r > 0 ? `At rank ${r}` : 'At rank 1'}</div>
              <ul class="fe-sk-lines ui-type-caption">
                {baseLines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
                {sheet?.dps ? <li class="fe-sk-lines__dps">{Math.round(sheet.dps).toLocaleString('en-US')} damage per second (single target)</li> : null}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div class="fe-loadout">
        <div class="fe-presets" role="group" aria-label="Loadout presets">
          {Array.from({ length: LOADOUT_PRESETS }, (_, i) =>
            renaming !== null && i === presetIdx ? (
              <input
                key={i}
                class="fe-input fe-presets__rename ui-type-caption"
                aria-label={`Name of preset ${i + 1}`}
                maxLength={24}
                value={renaming}
                ref={(el) => el?.focus()}
                onInput={(e) => setRenaming(e.currentTarget.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    commitRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setRenaming(null);
                  }
                }}
              />
            ) : (
              <button
                key={i}
                class={cx('fe-presets__tab ui-type-caption', i === presetIdx && 'fe-presets__tab--sel', i === active && 'fe-presets__tab--active')}
                aria-pressed={i === presetIdx}
                aria-label={`${presets[i].name}${i === active ? ' (on your bar)' : ''}${presetEmpty(presets[i]) ? ', empty' : ''}`}
                onClick={() => {
                  store.actions.uiSound('click');
                  setPresetSel(i);
                }}
                onDblClick={() => {
                  setPresetSel(i);
                  setRenaming(presets[i].name);
                }}
              >
                {presets[i].name}
              </button>
            ),
          )}
          <span class="fe-presets__ops">
            <button
              class="fe-btn fe-btn--small"
              disabled={!inHideout || presetEmpty(presets[presetIdx]) || presetIdx === active}
              title={!inHideout ? 'Presets are switched in a hideout.' : presetEmpty(presets[presetIdx]) ? 'Nothing saved in it yet.' : undefined}
              onClick={() => presetAction('load')}
            >
              Load
            </button>
            <button class="fe-btn fe-btn--small" onClick={() => presetAction('save')}>
              Save
            </button>
            <button
              class="fe-btn fe-btn--small fe-btn--ghost"
              onClick={() => {
                store.actions.uiSound('click');
                setRenaming(presets[presetIdx].name);
              }}
            >
              Rename
            </button>
          </span>
        </div>
        <div class={cx('fe-loadout__label ui-type-caption', !pick && 'fe-loadout__label--idle')}>
          {pickedSkill
            ? `Choose a slot for ${skills[pickedSkill].name}`
            : pickedSlot !== null
              ? 'Choose a learned skill for this slot'
              : 'Drag a skill to a slot, or click a skill then a slot. Ctrl-click: first free slot. Right-click clears.'}
        </div>
        <div class="fe-loadout__slots">
          {Array.from({ length: LOADOUT_SLOTS }, (_, i) => {
            const id = loadout[i] ?? null;
            const valid = pickedSkill ? safe(() => store.rules.setLoadoutSlot(ch, i, pickedSkill).ok, false) : false;
            const augs = id ? (ch.augments?.[id]?.length ?? 0) : 0;
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
                onKeyDown={(e) => {
                  if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (id) assign(i, null);
                  } else if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.click();
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (id) assign(i, null);
                }}
                onPointerEnter={(e) => id && local.showTooltip({ kind: 'skill', skillId: id, compareTo: pickedSkill ?? (sel !== id ? sel : null) }, e.currentTarget, 'above')}
                onPointerLeave={() => local.hideTooltip()}
              >
                {id ? <PixelIcon id={`icon/skill/${id}`} width={34} height={34} /> : <span class="fe-lslot__empty" />}
                {augs > 0 && (
                  <span class="fe-augpips" aria-hidden="true">
                    {Array.from({ length: augs }, (_, k) => (
                      <i key={k} />
                    ))}
                  </span>
                )}
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
