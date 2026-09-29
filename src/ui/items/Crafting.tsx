// The Workbench interaction layer: the armed-currency cursor, the help strip, and the affix-choice popover
// for Binding Seal / Tempering Catalyst / Fracture Core.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import type { CurrencyId } from '../../contracts/content';
import type { UiState } from '../../contracts/ui';
import { Button, Frame, Keycap, PixelIcon, cx } from '../components/common';
import { placeFloating } from '../components/Overlays';
import { useLocal } from '../local';
import { shallowEqual, useStore, useUi } from '../store';
import { safe } from './hooks';
import { keepArmedAfterApply } from '../lib/crafting';
import { formatInt } from '../lib/format';
import { parseCurrencyStashUid, stashCount } from '../lib/stash';

const armedSel = (s: UiState) => ({ armed: s.armed, allowed: s.craftingAllowed, choice: s.affixChoice });

export function ArmedCursor() {
  const store = useStore();
  const local = useLocal();
  const { armed } = useUi(armedSel, shallowEqual);
  const ref = useRef<HTMLImageElement>(null);
  // A Crafting Stash slot armed for crafting (`cstash:<id>`) that has run dry disarms, like a used-up stack.
  const slotEmpty = useUi((s) => {
    const id = s.armed ? parseCurrencyStashUid(s.armed.uid) : null;
    return !!id && !!s.character && stashCount(s.character, id) <= 0;
  });
  useEffect(() => {
    if (slotEmpty && !store.get().affixChoice) store.actions.disarm();
  }, [slotEmpty, store]);
  useEffect(() => {
    if (!armed) return;
    const move = (e: PointerEvent): void => {
      local.pointer.x = e.clientX;
      local.pointer.y = e.clientY;
      if (ref.current) ref.current.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 12}px)`;
    };
    if (ref.current) ref.current.style.transform = `translate(${local.pointer.x + 10}px, ${local.pointer.y + 12}px)`;
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [armed?.uid]);
  if (!armed) return null;
  const src = store.art.icon(`icon/currency/${armed.currencyId}`, 32);
  return <img ref={ref} class="fe-armed-cursor fe-px" src={src} alt="" draggable={false} />;
}

export function CraftStrip() {
  const store = useStore();
  const { armed, allowed, choice } = useUi(armedSel, shallowEqual);
  const count = useCount(armed?.uid ?? null);
  if (!armed || choice) return null;
  const info = store.rules.content.currencies[armed.currencyId];
  return (
    <div class={cx('fe-craft-strip', !allowed && 'fe-craft-strip--blocked')} role="status">
      <PixelIcon id={`icon/currency/${armed.currencyId}`} width={32} height={32} />
      <div class="fe-craft-strip__text">
        <div class="fe-craft-strip__name">
          {info?.name ?? 'Currency'}
          {count !== null && (
            <span class="fe-muted"> ({count.stash ? `${formatInt(count.count)} in the stash` : `${count.count} left`})</span>
          )}
        </div>
        <div class="fe-craft-strip__help">
          {allowed ? (
            <>
              <span class="fe-craft-strip__hint">Choose an item</span>
              <span class="fe-craft-strip__hint">
                <Keycap>Shift</Keycap> keeps it armed
              </span>
              <span class="fe-craft-strip__hint">
                <Keycap>Esc</Keycap> cancels
              </span>
            </>
          ) : (
            'Crafting only works in a hideout'
          )}
        </div>
      </div>
    </div>
  );
}

/** Uses left of the armed currency: the stack's count, or a Crafting Stash slot's count (`cstash:<id>`). */
function useCount(uid: string | null): { count: number; stash: boolean } | null {
  const store = useStore();
  const ch = useUi((s) => s.character);
  return useMemo(() => {
    if (!ch || !uid) return null;
    const slot = parseCurrencyStashUid(uid);
    if (slot) return { count: stashCount(ch, slot), stash: true };
    const f = safe(() => store.rules.findItem(ch, uid), null);
    return f && f.item.kind === 'currency' ? { count: f.item.count, stash: false } : null;
  }, [ch, uid, store]);
}

const VERB: Partial<Record<CurrencyId, string>> = {
  seal: 'Choose an affix to seal',
  catalyst: 'Choose an affix to temper',
  fractureCore: 'Choose an affix to fracture',
};

export function AffixChoicePopover() {
  const store = useStore();
  const local = useLocal();
  const choice = useUi((s) => s.affixChoice);
  const ch = useUi((s) => s.character);
  const ref = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    if (!choice || !ch) return null;
    const found = safe(() => store.rules.findItem(ch, choice.targetUid), null);
    if (!found) return null;
    const desc = safe(() => store.rules.describeItem(found.item, ch), null);
    if (!desc) return null;
    return {
      desc,
      lines: desc.affixes.map((line, i) => {
        const res = safe(() => store.rules.applyCurrency(ch, choice.currencyUid, choice.targetUid, i), {
          ok: false as const,
          error: 'Not possible.',
        });
        return { line, index: i, error: res.ok ? null : res.error };
      }),
    };
  }, [choice, ch, store]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !choice) return;
    // The crafting bench shows the item it crafts: anchor there first (the same uid also sits in its grid).
    const uid = CSS.escape(choice.targetUid);
    const target = document.querySelector(`[data-bench-uid="${uid}"]`) ?? document.querySelector(`[data-uid="${uid}"]`);
    const r = el.getBoundingClientRect();
    const a = target?.getBoundingClientRect() ?? {
      left: window.innerWidth / 2,
      right: window.innerWidth / 2,
      top: window.innerHeight / 3,
      bottom: window.innerHeight / 3,
    };
    const pos = placeFloating(a, r.width, r.height, window.innerWidth, window.innerHeight, 'side');
    el.style.transform = `translate(${Math.round(pos.left)}px, ${Math.round(pos.top)}px)`;
    el.style.visibility = 'visible';
  });

  if (!choice || !rows) return null;
  const info = store.rules.content.currencies[choice.currencyId];
  return (
    <div ref={ref} class="fe-affix-choice fe-solid" style={{ visibility: 'hidden' }} role="dialog" aria-label="Choose an affix">
      <Frame class="fe-affix-choice__frame">
        <div class="fe-affix-choice__head">
          <PixelIcon id={`icon/currency/${choice.currencyId}`} width={32} height={32} />
          <div>
            <div class="fe-affix-choice__title">{VERB[choice.currencyId] ?? 'Choose an affix'}</div>
            <div class="fe-affix-choice__sub">{info?.description}</div>
          </div>
        </div>
        <div class={cx('fe-affix-choice__item', `fe-tt--${rows.desc.tone}`)}>{rows.desc.title}</div>
        <div class="fe-affix-choice__list">
          {rows.lines.map(({ line, index, error }) => (
            <button
              key={index}
              class={cx(
                'fe-affix-row',
                error && 'fe-affix-row--off',
                line.sealed && 'fe-affix-row--sealed',
                line.fractured && 'fe-affix-row--fractured',
              )}
              disabled={!!error}
              title={error ?? undefined}
              onPointerEnter={() => store.actions.uiSound('hover')}
              onClick={(e) => {
                local.hideTooltip();
                store.actions.chooseAffix(index);
                // Same rule as a direct craft: one use per click unless Shift is held.
                if (!keepArmedAfterApply(e.shiftKey, false)) store.actions.disarm();
              }}
            >
              <span class="fe-affix-row__kind">{line.kind === 'prefix' ? 'P' : line.kind === 'suffix' ? 'S' : ''}</span>
              <span class="fe-affix-row__text">
                {line.text}
                {error && <span class="fe-affix-row__why">{error}</span>}
              </span>
              {line.tier !== undefined && <span class="fe-affix-row__tier">T{line.tier}</span>}
            </button>
          ))}
          {rows.lines.length === 0 && <div class="fe-muted">This item has no affixes.</div>}
        </div>
        <div class="fe-affix-choice__foot">
          <Button size="small" onClick={() => store.actions.cancelAffixChoice()}>
            Cancel
          </Button>
          <span class="fe-muted ui-type-caption">
            <Keycap>Esc</Keycap> cancels
          </span>
        </div>
      </Frame>
    </div>
  );
}
