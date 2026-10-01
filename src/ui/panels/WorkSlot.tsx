// Crafting Stash work slot (GAME_SPEC §12): the dedicated place a piece of gear or a map sits while you craft on it,
// like the work slot at the top of a PoE currency tab. The item physically lives in the account's storage
// (CharacterSave.craftSlot), so it stays put across tab switches, sessions, restarts and alts. The slot shows the item
// in full (name, Stability, every modifier, what the last craft did, its recent crafts) and is the target of every
// currency tile next to it: one click applies the currency (the store, the rules and the server do the rest), the
// added or changed modifier lights up in place. Dragging in or out, Ctrl/⌘-click (from the backpack or your worn gear
// while a Crafting Stash tab is open, and on the slot's own item to give it back), "Equip", "Return" and "Bench" move it;
// nothing here ever copies an item: the slot is one container of the rules.
//
// Keyboard: the game hands keys to the world, and a focused <button> is blurred on keydown (src/ui/App.tsx), so this
// region's controls are role="button" elements that handle their own keys (Enter / Space) and stop the ones they use.
// They take focus from Tab only (a mouse press never focuses them), so a click never leaves a hotkey armed.
import type { JSX } from 'preact';
import { useMemo, useRef } from 'preact/hooks';
import { iconIdForCurrency, type CurrencyId } from '../../contracts/content';
import { currencyStashUid, type CraftSlotItem, type TooltipLine } from '../../contracts/items';
import type { UiStore } from '../../contracts/ui';
import { PixelIcon, cx } from '../components/common';
import { beginPointerDrag } from '../items/dnd';
import { applyCurrencyOnce, clickSuppressed, itemClick, itemContextMenu, placeOnBench, safe } from '../items/hooks';
import { AnvilGlyph } from '../items/ItemTooltip';
import { readCellPx } from '../items/ItemView';
import { itemIconId, itemTone } from '../lib/items';
import { stashCount } from '../lib/stash';
import {
  CONFIRM_CURRENCIES,
  craftLog,
  equipTarget,
  freshLineIndices,
  linesSignature,
  modLines,
  needsConfirm,
  removedLines,
} from '../lib/workslot';
import type { Local } from '../local';
import { useLocal } from '../local';
import { useSignal, useStore, useUi } from '../store';

const CRAFT_SLOT = { kind: 'craftSlot' } as const;

// ---------------------------------------------------------------------------------------------------------------
// Applying a currency to the work slot
// ---------------------------------------------------------------------------------------------------------------

/** Where a click happened (for hints); keyboard activations pass the tile's centre. */
export interface At {
  clientX: number;
  clientY: number;
}

/**
 * One click (or Enter) on a Crafting Stash tile: apply that currency to the work slot's item, drawing from the slot
 * `cstash:<id>`. Refusals say why at the pointer; permanent currencies (src/ui/lib/workslot.ts) ask once first.
 * Seal / Catalyst / Fracture Core open the affix choice next to the item.
 */
export function craftInWorkSlot(store: UiStore, local: Local, at: At, id: CurrencyId): void {
  const s = store.get();
  const ch = s.character;
  if (!ch) return;
  const item = ch.craftSlot;
  const hint = (text: string): void => {
    store.actions.uiSound('error');
    local.flashHint(text, at.clientX, at.clientY);
  };
  if (!item) return hint('Put gear or a map in the work slot first.');
  if (stashCount(ch, id) <= 0) return hint(`No ${store.rules.content.currencies[id]?.name ?? 'currency'} in the Crafting Stash.`);
  const uid = currencyStashUid(id);
  // Ask before a permanent change, but only when the craft can actually happen (otherwise say why, nothing to confirm).
  const why = s.craftingAllowed ? safe(() => store.rules.craftingTargetError(ch, uid, item.uid), null) : null;
  const confirm = CONFIRM_CURRENCIES[id];
  if (needsConfirm(id) && confirm && s.craftingAllowed && !why) {
    local.hideTooltip();
    local.dialog.set({
      title: confirm.title,
      body: confirm.body,
      confirmLabel: confirm.confirm,
      danger: true,
      onConfirm: () => {
        const now = store.get().character?.craftSlot;
        if (now && now.uid === item.uid) applyCurrencyOnce(store, local, at, uid, item.uid);
      },
    });
    return;
  }
  applyCurrencyOnce(store, local, at, uid, item.uid);
}

// ---------------------------------------------------------------------------------------------------------------
// What the last craft changed (kept across tab switches; the slot itself is on the server)
// ---------------------------------------------------------------------------------------------------------------

interface Tracker {
  uid: string | null;
  sig: string;
  lines: TooltipLine[];
  /** Indices of the lines the newest craft added or changed. */
  fresh: Set<number>;
  removed: TooltipLine[];
  /** Counts the changes seen on this item: restarts the flash animation. */
  tick: number;
}

let tracker: Tracker = { uid: null, sig: '', lines: [], fresh: new Set(), removed: [], tick: 0 };

/**
 * Compare the item's modifier list with the one last seen. A new item starts clean; the same item with different lines
 * marks exactly the lines that are new or changed, until the next change or another item takes the slot. Safe to
 * call on every render: an unchanged list returns the same result.
 */
function trackChanges(uid: string | null, lines: TooltipLine[]): Tracker {
  const sig = linesSignature(lines);
  const t = tracker;
  if (t.uid !== uid) tracker = { uid, sig, lines, fresh: new Set(), removed: [], tick: t.tick };
  else if (t.sig !== sig && uid) {
    tracker = { uid, sig, lines, fresh: freshLineIndices(t.lines, lines), removed: removedLines(t.lines, lines), tick: t.tick + 1 };
  }
  return tracker;
}

// ---------------------------------------------------------------------------------------------------------------
// Keyboard-operable control
// ---------------------------------------------------------------------------------------------------------------

function ActionButton({
  label,
  disabled,
  title,
  onActivate,
  class: klass,
  children,
}: {
  label: string;
  disabled?: boolean;
  title?: string;
  onActivate: () => void;
  class?: string;
  children: JSX.Element | (JSX.Element | string | false)[] | string;
}) {
  const store = useStore();
  const run = (): void => {
    if (disabled) {
      store.actions.uiSound('error');
      return;
    }
    store.actions.uiSound('click');
    onActivate();
  };
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled ? 'true' : undefined}
      title={title}
      class={cx('fe-btn fe-btn--small fe-wbtn', disabled && 'fe-wbtn--off', klass)}
      // Keyboard only takes focus here (see the header): a click must not leave a live hotkey behind.
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        run();
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The work slot
// ---------------------------------------------------------------------------------------------------------------

/** Live Stability readout: pips and the number on one line (the bench's bar, compact). */
function WorkStability({ current, max }: { current: number; max: number }) {
  const pips = Math.max(0, Math.min(16, max));
  const finished = current <= 0;
  return (
    <div
      class={cx('fe-wslot__stab', finished && 'fe-wslot__stab--finished')}
      title="Every craft costs Stability. At 0 the item is Finished; repair Stability at the bench."
      aria-label={finished ? 'Finished: no Stability left' : `${current} of ${max} Stability`}
    >
      <PixelIcon id="icon/ui/stability" width={16} height={16} />
      <span class="fe-wslot__stab-pips" aria-hidden="true">
        {Array.from({ length: pips }, (_, i) => (
          <i key={i} class={cx('fe-bench__pip', i < current && 'fe-bench__pip--on', i < current && current <= 2 && 'fe-bench__pip--low')} />
        ))}
      </span>
      <span class="fe-wslot__stab-n" aria-hidden="true">
        {finished ? 'Finished' : `${current}/${max}`}
      </span>
    </div>
  );
}

function kindChip(kind: TooltipLine['kind']): string {
  switch (kind) {
    case 'prefix':
      return 'P';
    case 'suffix':
      return 'S';
    case 'implicit':
      return 'I';
    case 'scar':
      return '!';
    case 'mapMod':
      return 'M';
    case 'unique':
      return 'U';
    default:
      return '';
  }
}

function ModLine({ line, fresh }: { line: TooltipLine; fresh: boolean }) {
  const chip = kindChip(line.kind);
  return (
    <li
      class={cx(
        'fe-wmod',
        `fe-mod--${line.kind}`,
        (line.negative || line.kind === 'scar') && 'fe-mod--neg',
        line.crafted && 'fe-mod--crafted',
        line.sealed && 'fe-mod--sealed',
        line.fractured && 'fe-mod--fractured',
        fresh && 'fe-wmod--fresh',
      )}
      title={[line.affixName && `“${line.affixName}”`, line.tier !== undefined ? `Tier ${line.tier}` : null, line.tags?.length ? line.tags.join(', ') : null].filter(Boolean).join(' · ') || undefined}
    >
      <span class="fe-wmod__tier" aria-hidden="true">
        {chip}
        {line.tier !== undefined ? line.tier : ''}
      </span>
      <span class="fe-wmod__text">
        {line.crafted && <AnvilGlyph />}
        {line.sealed && <PixelIcon id="icon/ui/seal" class="fe-mod__glyph" width={16} height={16} />}
        {line.fractured && <PixelIcon id="icon/ui/fracture" class="fe-mod__glyph" width={16} height={16} />}
        <span>{line.text}</span>
      </span>
      {fresh && (
        <span class="fe-wmod__new" title="Added or changed by the last craft">
          <span class="fe-wslot__sr">new</span>
        </span>
      )}
    </li>
  );
}

function Socket({ item, tick }: { item: CraftSlotItem | null; tick: number }) {
  const store = useStore();
  const local = useLocal();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useSignal(local.drag);
  const size = useMemo(() => (item ? safe(() => store.rules.itemSize(item), { w: 1, h: 1 }) : { w: 1, h: 1 }), [store, item]);
  const accepts = !!drag && (drag.item.kind === 'equipment' || drag.item.kind === 'map') && drag.from.kind !== 'craftSlot';
  const hovered = drag?.target?.key === 'craftSlot' && !drag.target.noop ? (drag.target.valid ? 'ok' : 'bad') : null;
  const lifted = !!item && drag?.uid === item.uid;
  const tone = item ? itemTone(item) : null;

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (!el || !item) return;
    const cell = readCellPx(el);
    const r = el.getBoundingClientRect();
    beginPointerDrag(e as unknown as PointerEvent, store, local, {
      uid: item.uid,
      item,
      from: CRAFT_SLOT,
      size,
      el,
      cellPx: cell,
      offsetX: (r.width - size.w * cell) / 2,
      offsetY: (r.height - size.h * cell) / 2,
    });
  };

  return (
    <div
      ref={ref}
      class={cx(
        'fe-wslot__socket fe-solid',
        tone && `fe-wslot__socket--${tone}`,
        !item && 'fe-wslot__socket--empty',
        accepts && 'fe-slot--accepts',
        hovered && `fe-slot--${hovered}`,
        lifted && 'fe-wslot__socket--lifted',
      )}
      data-drop="craftSlot"
      data-uid={item?.uid}
      data-work-slot="socket"
      tabIndex={item ? 0 : -1}
      role={item ? 'button' : undefined}
      aria-label={item ? 'Work slot. Press Delete to return the item to your backpack.' : undefined}
      onMouseDown={(e) => {
        // Keep keyboard focus off a mouse press (see the header); the drag starts on pointerdown regardless.
        if (item && (e as MouseEvent).button === 0) e.preventDefault();
      }}
      onPointerDown={onPointerDown}
      onClick={(e) => item && itemClick(store, local, e as unknown as MouseEvent, item.uid, item, CRAFT_SLOT)}
      onContextMenu={(e) => item && itemContextMenu(store, local, e as unknown as MouseEvent, item.uid, item, CRAFT_SLOT)}
      onKeyDown={(e) => {
        if (!item || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
        e.preventDefault();
        e.stopPropagation();
        store.actions.uiSound('close');
        local.hideTooltip();
        store.actions.quickMove(item.uid);
      }}
      onPointerEnter={(e) => {
        if (item && !local.drag.get()) local.showTooltip({ kind: 'item', uid: item.uid }, e.currentTarget);
      }}
      onPointerLeave={() => local.hideTooltip()}
    >
      <span class="fe-wslot__ring" aria-hidden="true" />
      {item ? (
        <>
          <PixelIcon
            id={itemIconId(item)}
            class="fe-wslot__icon"
            width={`calc(var(--icon-cell) * ${size.w})`}
            height={`calc(var(--icon-cell) * ${size.h})`}
          />
          {tick > 0 && <i key={tick} class="fe-wslot__flash" aria-hidden="true" />}
        </>
      ) : (
        <span class="fe-wslot__hole" aria-hidden="true">
          <AnvilGlyph class="fe-anvil--large" />
        </span>
      )}
    </div>
  );
}

export function WorkSlot() {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const allowed = useUi((s) => s.craftingAllowed);
  const item = ch?.craftSlot ?? null;
  const desc = useMemo(() => (ch && item ? safe(() => store.rules.describeItem(item, ch), null) : null), [ch?.level, item, store]);
  const lines = useMemo(() => (desc ? modLines(desc) : []), [desc]);
  const seen = trackChanges(item?.uid ?? null, lines);
  if (!ch) return null;

  const slot = item ? equipTarget(ch, item, (b) => store.rules.content.bases[b as keyof typeof store.rules.content.bases]?.slots) : null;
  const equipCheck = item && slot ? safe(() => store.rules.canEquip(ch, item, slot), { ok: false, reason: 'This item cannot be equipped.' }) : null;
  const equipOff = !slot || !equipCheck?.ok;
  const log = craftLog(desc?.history);
  const last = log[0];

  const equip = (): void => {
    if (!item || !slot) return;
    local.hideTooltip();
    if (!store.actions.moveItem(item.uid, { kind: 'equipment', slot })) store.actions.uiSound('error');
    else store.actions.uiSound('equip');
  };
  const giveBack = (): void => {
    if (!item) return;
    local.hideTooltip();
    store.actions.quickMove(item.uid);
  };
  const toBench = (): void => {
    if (!item) return;
    if (placeOnBench(store, local, item.uid, item)) {
      store.actions.uiSound('open');
      store.actions.openPanel('craftingBench');
    }
  };

  return (
    <section class="fe-wslot" aria-label="Crafting work slot" data-work-slot="panel">
      <div class="fe-wslot__top">
        <Socket item={item} tick={seen.tick} />
        <div class="fe-wslot__plate">
          {item && desc ? (
            <>
              <div class={cx('fe-wslot__name', `fe-tone-${desc.tone}`)}>{desc.title}</div>
              <div class={cx('fe-wslot__base', `fe-tone-${desc.tone}`)}>
                {[desc.subtitle, ...desc.headerLines.map((h) => h.replace(/^Item Level /, 'iLvl '))].filter(Boolean).join(' · ')}
              </div>
              {desc.stability ? <WorkStability current={desc.stability.current} max={desc.stability.max} /> : null}
              <div class={cx('fe-wslot__last', seen.fresh.size > 0 && 'fe-wslot__last--fresh')} aria-live="polite" title={last ?? undefined}>
                {last ? (
                  <>
                    <span class="fe-wslot__last-k">Last</span>
                    <span class="fe-wslot__last-t">{last}</span>
                  </>
                ) : (
                  <span class="fe-wslot__last-none">Nothing crafted on it yet.</span>
                )}
                {seen.removed.length > 0 && (
                  <span class="fe-wslot__gone" title={`Removed: ${seen.removed.map((l) => l.text).join('; ')}`}>
                    − {seen.removed.length}
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <div class="fe-wslot__name fe-wslot__name--empty">Work slot</div>
              <p class="fe-wslot__intro">
                Drop gear or a map here, or <b>Ctrl-click</b> it in your inventory or on your body. It stays here between visits.
              </p>
            </>
          )}
        </div>
      </div>

      {item && desc ? (
        <>
          <ul class="fe-wslot__mods" aria-label="Modifiers">
            {lines.map((l, i) => (
              <ModLine key={`${i}:${seen.tick}`} line={l} fresh={seen.fresh.has(i)} />
            ))}
            {lines.length === 0 && <li class="fe-wslot__none">No modifiers yet: a clean base.</li>}
            {log.length > 1 && (
              <li class="fe-wslot__log" aria-label="Recent crafts">
                {log.slice(1).map((h, i) => (
                  <span key={i} title={h}>
                    {h}
                  </span>
                ))}
              </li>
            )}
          </ul>
          {!allowed && <p class="fe-wslot__warn">Crafting only works in a hideout.</p>}
          <div class="fe-wslot__actions">
            <ActionButton
              label="Equip the work slot item"
              disabled={equipOff}
              title={equipOff ? (equipCheck && !equipCheck.ok ? equipCheck.reason : 'Only gear can be worn.') : 'Wear it (the piece it replaces takes its place in the work slot)'}
              onActivate={equip}
            >
              Equip
            </ActionButton>
            <ActionButton label="Return the item to your backpack" title="Ctrl-click the item works too" onActivate={giveBack}>
              Return
            </ActionButton>
            <ActionButton label="Open the crafting bench for this item" title="Bench recipes and Stability repair" onActivate={toBench}>
              <AnvilGlyph />
              Bench
            </ActionButton>
          </div>
        </>
      ) : (
        <div class="fe-wslot__empty-note">
          Then click a currency on the right to craft on it. The item never leaves this slot until you take it out.
        </div>
      )}
    </section>
  );
}
