// Global overlays rendered once at the root: the tooltip host, confirmation dialogs, cursor hints and the
// drag ghost.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { UiState } from '../../contracts/ui';
import { DetachedItemTooltip, OwnedItemTooltip } from '../items/ItemTooltip';
import { useLocal, type AnchorRect } from '../local';
import { itemIconId } from '../lib/items';
import { MAP_BRIEF_LINGER_MS } from '../lib/map-brief';
import { shallowEqual, useSignal, useStore, useUi } from '../store';
import { SkillTooltip } from '../panels/SkillTooltip';
import { Button, Frame, PanelHead, PixelIcon, cx } from './common';

const MARGIN = 8;
const GAP = 12;

/** Position a floating box next to an anchor, flipping sides and clamping to the viewport. */
export function placeFloating(
  anchor: AnchorRect,
  w: number,
  h: number,
  vw: number,
  vh: number,
  placement: 'side' | 'above',
): { left: number; top: number } {
  let left: number;
  let top: number;
  if (placement === 'side') {
    left = anchor.right + GAP;
    if (left + w > vw - MARGIN) left = anchor.left - GAP - w;
    if (left < MARGIN) left = Math.max(MARGIN, Math.min(vw - MARGIN - w, anchor.left + (anchor.right - anchor.left) / 2 - w / 2));
    top = anchor.top;
  } else {
    left = anchor.left + (anchor.right - anchor.left) / 2 - w / 2;
    top = anchor.top - GAP - h;
    if (top < MARGIN) top = anchor.bottom + GAP;
  }
  left = Math.max(MARGIN, Math.min(left, vw - MARGIN - w));
  top = Math.max(MARGIN, Math.min(top, vh - MARGIN - h));
  return { left, top };
}

const tooltipSel = (s: UiState) => ({ ch: s.character, alt: s.altHeld, armed: s.armed });

export function TooltipHost() {
  const store = useStore();
  const local = useLocal();
  const tip = useSignal(local.tooltip);
  const drag = useSignal(local.drag);
  const { ch, alt, armed } = useUi(tooltipSel, shallowEqual);
  const ref = useRef<HTMLDivElement>(null);
  // A map tooltip opens short and grows into its full card after a short hover (F-28). Keyed by the hovered item, so moving to
  // another item starts short again, and a re-shown tooltip of the same item keeps its state.
  const key = tip ? (tip.spec.kind === 'item' ? `item:${tip.spec.uid}` : tip.spec.kind === 'preview' ? `preview:${tip.spec.item.uid}` : null) : null;
  const [lingered, setLingered] = useState<string | null>(null);
  useEffect(() => {
    if (!key) { setLingered(null); return; }
    const t = setTimeout(() => setLingered(key), MAP_BRIEF_LINGER_MS);
    return () => clearTimeout(t);
  }, [key]);
  const full = key !== null && lingered === key;

  // Measure after every render (content changes with Alt / crafting) and place without a state round trip.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const r = el.getBoundingClientRect();
    const pos = placeFloating(tip.anchor, r.width, r.height, window.innerWidth, window.innerHeight, tip.placement);
    el.style.transform = `translate(${Math.round(pos.left)}px, ${Math.round(pos.top)}px)`;
    el.style.visibility = 'visible';
  });

  // The anchor may vanish without a pointerleave (a panel closes under the cursor, an item moves away):
  // hide as soon as the pointer is no longer over the anchor's box.
  useEffect(() => {
    if (!tip) return;
    const a = tip.anchor;
    const onMove = (e: PointerEvent): void => {
      const pad = 2;
      if (e.clientX < a.left - pad || e.clientX > a.right + pad || e.clientY < a.top - pad || e.clientY > a.bottom + pad)
        local.hideTooltip();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [tip, local]);

  if (!tip || drag) return null;
  let content = null;
  const spec = tip.spec;
  if (spec.kind === 'item') {
    if (ch) content = <OwnedItemTooltip store={store} ch={ch} uid={spec.uid} alt={alt} armed={armed} full={full} />;
  } else if (spec.kind === 'preview') {
    if (ch)
      content = (
        <DetachedItemTooltip
          store={store}
          ch={ch}
          item={spec.item}
          alt={alt}
          note={spec.note}
          label={spec.label}
          compare={spec.compare}
          price={spec.price}
          appraisal={spec.appraisal}
          full={full}
        />
      );
  } else if (spec.kind === 'skill') {
    if (ch) content = <SkillTooltip ch={ch} skillId={spec.skillId} />;
  } else if (spec.kind === 'text') {
    content = (
      <div class={cx('fe-tt fe-tt--plain', spec.tone && `fe-tt--${spec.tone}`)}>
        {spec.title && <div class="fe-tt__plain-title">{spec.title}</div>}
        <div class="fe-tt__plain-body">
          {spec.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
    );
  } else {
    content = spec.render();
  }
  if (!content) return null;
  return (
    <div ref={ref} class="fe-tooltip-layer" style={{ visibility: 'hidden' }}>
      {content}
    </div>
  );
}

export function DialogHost() {
  const local = useLocal();
  const dialog = useSignal(local.dialog);
  const [text, setText] = useState('');
  useLayoutEffect(() => setText(''), [dialog]);
  if (!dialog) return null;
  const close = (): void => local.dialog.set(null);
  const locked = !!dialog.requireText && text.trim().toLowerCase() !== dialog.requireText.toLowerCase();
  return (
    <div class="fe-backdrop fe-solid fe-dialog-layer" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <Frame class="fe-dialog" role="dialog" aria-modal="true" aria-label={dialog.title}>
        <PanelHead title={dialog.title} onClose={close} />
        <div class="fe-dialog__body">
          <p>{dialog.body}</p>
          {dialog.requireText && (
            <input
              class="fe-input"
              autoFocus
              placeholder={`Type ${dialog.requireText} to confirm`}
              value={text}
              onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !locked) {
                  dialog.onConfirm();
                  close();
                }
              }}
            />
          )}
        </div>
        <div class="fe-dialog__actions">
          <Button onClick={close}>{dialog.cancelLabel ?? 'Cancel'}</Button>
          <Button
            variant={dialog.danger ? 'danger' : 'ember'}
            disabled={locked}
            onClick={() => {
              dialog.onConfirm();
              close();
            }}
          >
            {dialog.confirmLabel}
          </Button>
        </div>
      </Frame>
    </div>
  );
}

export function CursorHintHost() {
  const local = useLocal();
  const hint = useSignal(local.hint);
  if (!hint) return null;
  const left = Math.min(Math.max(12, hint.x + 16), window.innerWidth - 300);
  const top = Math.min(Math.max(12, hint.y + 18), window.innerHeight - 60);
  return (
    <div key={hint.id} class="fe-cursor-hint" style={{ left, top }} role="status">
      {hint.text}
    </div>
  );
}

export function DragGhost() {
  const local = useLocal();
  const drag = useSignal(local.drag);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!drag) return;
    const el = ref.current;
    const place = (x: number, y: number): void => {
      if (!el) return;
      const dx = x - (drag.grab.x + 0.5) * drag.cellPx;
      const dy = y - (drag.grab.y + 0.5) * drag.cellPx;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      // Keep the status tags (centred under the ghost) inside the window: a drag near an edge shifts them inward.
      const centre = dx + el.offsetWidth / 2;
      for (const tag of el.querySelectorAll<HTMLElement>('.fe-drag-ghost__tag')) {
        const half = tag.offsetWidth / 2;
        const shift = Math.max(0, centre + half - (window.innerWidth - 8)) * -1 + Math.max(0, 8 - (centre - half));
        tag.style.marginLeft = `${shift}px`;
      }
    };
    place(local.pointer.x, local.pointer.y);
    const move = (e: PointerEvent): void => place(e.clientX, e.clientY);
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [drag?.uid, drag?.target?.key, drag?.target?.valid]);

  if (!drag) return null;
  const t = drag.target;
  const state = !t ? 'none' : t.world && t.valid ? 'world' : t.valid || t.noop ? 'ok' : 'bad';
  const filing = state === 'ok' && !t?.noop ? t?.loc?.kind : null;
  const tag =
    t?.tag && state === 'ok' && !t.noop
      ? t.tag
      : t?.bench && state === 'ok'
      ? 'Place on the bench'
      : t?.offer && state === 'ok' && !t.noop
        ? 'Add to your offer'
        : filing === 'currencyStash'
          ? 'File in the Crafting Stash'
          : filing === 'mapStash'
            ? 'File in the Map Stash'
            : filing === 'mapDevice'
              ? 'Load into the device'
              : filing === 'scarabSlot'
                ? 'Socket the scarab'
                : null;
  return (
    <div
      ref={ref}
      class={cx('fe-drag-ghost', `fe-drag-ghost--${state}`)}
      style={{ width: drag.size.w * drag.cellPx, height: drag.size.h * drag.cellPx }}
    >
      <PixelIcon
        id={itemIconId(drag.item)}
        width={`calc(var(--icon-cell) * ${drag.size.w})`}
        height={`calc(var(--icon-cell) * ${drag.size.h})`}
      />
      {state === 'world' && <span class="fe-drag-ghost__tag fe-drag-ghost__tag--floor">Drop on the floor</span>}
      {tag && <span class="fe-drag-ghost__tag fe-drag-ghost__tag--ok">{tag}</span>}
      {state === 'bad' && t?.reason && <span class="fe-drag-ghost__tag fe-drag-ghost__tag--bad">{t.reason}</span>}
    </div>
  );
}
