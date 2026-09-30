// Crafting Bench (the anvil in any hideout; GAME_SPEC §12): deterministic "scaffolding". An item is placed on the
// bench by dragging it onto the socket or Ctrl-clicking it while the bench is open (a UI selection: it stays where
// it is). The panel shows the item in full (tiers, ranges, stability, crafted marker, its story), the bench recipes
// the rules offer for it (rules.benchRecipes, grouped prefix / suffix, with costs and why a recipe is unavailable),
// the free "Clear crafted affix", and a palette of every currency you carry: one click applies it to the bench item
// exactly like right-click → left-click, with the odds preview on hover and the affix choice where needed.
// An item in your trade offer stays on the bench but is locked: no recipe, clear or currency until the trade closes.
// Short screens (< 800 px high) fold the modifier list to a tally so the recipes stay in view; the choice sticks.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CURRENCY_IDS, iconIdForCurrency, type CurrencyId } from '../../contracts/content';
import type { BenchRecipe, BenchService } from '../../contracts/game';
import { currencyStashUid, type CharacterSave, type Item, type ItemDescription, type ItemLocation, type TooltipLine } from '../../contracts/items';
import { Button, PixelIcon, cx } from '../components/common';
import { AnvilGlyph } from '../items/ItemTooltip';
import { CRAFT_PENDING_MS } from '../lib/crafting';
import { SLOT_LABELS, TONE_LABEL } from '../lib/content';
import { formatInt } from '../lib/format';
import { stashCount } from '../lib/stash';
import { itemIconId, itemTone } from '../lib/items';
import { useLocal } from '../local';
import {
  LOCKED_REASON,
  applyCurrencyOnce,
  benchAccepts,
  craftInFlight,
  isTradeLocked,
  itemClick,
  noteCraftSent,
  safe,
} from '../items/hooks';
import { useSignal, useStore, useUi } from '../store';
import { PanelShell } from './PanelShell';

function whereText(loc: ItemLocation, ch: CharacterSave): string {
  switch (loc.kind) {
    case 'backpack':
      return 'In your backpack';
    case 'stash':
      return `In your stash, ${ch.stash[loc.tab]?.name ?? `tab ${loc.tab + 1}`}`;
    case 'equipment':
      return `Equipped: ${SLOT_LABELS[loc.slot]}`;
    case 'belt':
      return 'On your flask belt';
    case 'mapDevice':
      return 'In the map device';
    case 'scarabSlot':
      return 'In a scarab socket';
    case 'currencyStash':
      return 'In your Crafting Stash';
    case 'mapStash':
      return 'In your Map Stash';
  }
}

function StabilityBar({ current, max }: { current: number; max: number }) {
  const pips = Math.max(0, Math.min(16, max));
  const finished = current <= 0;
  return (
    <div class={cx('fe-bench__stab', finished && 'fe-bench__stab--finished')} title="Every craft costs stability. At 0 the item is Finished. Repair Stability at the bench to continue.">
      <PixelIcon id="icon/ui/stability" width={16} height={16} />
      <span class="fe-bench__stab-pips">
        {Array.from({ length: pips }, (_, i) => (
          <i key={i} class={cx('fe-bench__pip', i < current && 'fe-bench__pip--on', i < current && current <= 2 && 'fe-bench__pip--low')} />
        ))}
      </span>
      <span class="fe-bench__stab-text">{finished ? 'Finished' : `${current}/${max} Stability`}</span>
    </div>
  );
}

/** The socket (drop target) and the item's name plate. */
function Altar({ item, uid, desc, where }: { item: Item | null; uid: string | null; desc: ItemDescription | null; where: string | null }) {
  const store = useStore();
  const local = useLocal();
  const drag = useSignal(local.drag);
  const locked = useUi((s) => (uid ? isTradeLocked(s, uid) : false));
  const size = item ? safe(() => store.rules.itemSize(item), { w: 1, h: 1 }) : null;
  const accepts = !!drag && benchAccepts(drag.item, drag.uid);
  const hovered = drag?.target?.bench ? (drag.target.valid || drag.target.noop ? 'ok' : 'bad') : null;

  return (
    <div class="fe-bench__altar">
      <div
        class={cx(
          'fe-bench__socket fe-solid',
          item && `fe-bench__socket--${itemTone(item)}`,
          accepts && 'fe-slot--accepts',
          hovered && `fe-slot--${hovered}`,
        )}
        data-drop="bench"
        data-bench-uid={uid ?? undefined}
        onPointerEnter={(e) => uid && item && !drag && local.showTooltip({ kind: 'item', uid }, e.currentTarget)}
        onPointerLeave={() => local.hideTooltip()}
        onClick={(e) => {
          if (!uid || !item || !store.get().armed) return;
          const found = safe(() => (store.get().character ? store.rules.findItem(store.get().character!, uid) : null), null);
          if (found) itemClick(store, local, e as unknown as MouseEvent, uid, item, found.location);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (store.get().armed) store.actions.disarm();
        }}
      >
        <span class="fe-bench__socket-ring" aria-hidden="true" />
        {item && size ? (
          <PixelIcon
            id={itemIconId(item)}
            class="fe-bench__icon"
            width={`calc(var(--icon-cell) * ${size.w})`}
            height={`calc(var(--icon-cell) * ${size.h})`}
          />
        ) : (
          <span class="fe-bench__empty">
            <AnvilGlyph class="fe-anvil--large" />
            <span>Drop an item here</span>
          </span>
        )}
        {locked && <PixelIcon id="icon/ui/locked" class="fe-item__lock" width={16} height={16} />}
      </div>
      <div class="fe-bench__plate">
        {item && desc ? (
          <>
            <div class={cx('fe-bench__name', `fe-tone-${desc.tone}`)}>{desc.title}</div>
            {desc.subtitle && <div class={cx('fe-bench__base', `fe-tone-${desc.tone}`)}>{desc.subtitle}</div>}
            <div class="fe-bench__meta">{[TONE_LABEL[desc.tone] === desc.classLabel ? null : TONE_LABEL[desc.tone], desc.classLabel, ...desc.headerLines].filter(Boolean).join(' · ')}</div>
            {desc.stability && <StabilityBar current={desc.stability.current} max={desc.stability.max} />}
            <div class="fe-bench__where">
              <span>{where}</span>
              <button
                type="button"
                class="fe-bench__unplace"
                onClick={() => {
                  store.actions.uiSound('close');
                  local.hideTooltip();
                  store.actions.setBenchItem(null);
                }}
              >
                Take off the bench
              </button>
            </div>
          </>
        ) : (
          <>
            <div class="fe-bench__name fe-bench__name--empty">The bench is empty</div>
            <p class="fe-bench__intro">
              Drag a piece of gear or a map onto the socket, or <b>Ctrl-click</b> it in your inventory or equipment. From the
              stash: <b>Ctrl+Shift-click</b>. It stays where it is.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function kindChip(line: TooltipLine): string {
  switch (line.kind) {
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

function ModRow({ line }: { line: TooltipLine }) {
  const chip = kindChip(line);
  const title = [line.affixName && `“${line.affixName}”`, line.tags?.length ? line.tags.join(', ') : null].filter(Boolean).join(' · ');
  return (
    <div
      class={cx(
        'fe-mod',
        `fe-mod--${line.kind}`,
        (line.negative || line.kind === 'scar') && 'fe-mod--neg',
        line.crafted && 'fe-mod--crafted',
        line.sealed && 'fe-mod--sealed',
        line.fractured && 'fe-mod--fractured',
      )}
      title={title || undefined}
    >
      {chip ? <span class="fe-mod__kind">{chip}</span> : <span class="fe-mod__kind fe-mod__kind--none" />}
      <span class={cx('fe-mod__tier', line.tier === undefined && 'fe-mod__tier--none')}>{line.tier !== undefined ? `T${line.tier}` : ''}</span>
      <span class="fe-mod__text">
        {line.crafted && <AnvilGlyph />}
        {line.sealed && <PixelIcon id="icon/ui/seal" class="fe-mod__glyph" width={16} height={16} />}
        {line.fractured && <PixelIcon id="icon/ui/fracture" class="fe-mod__glyph" width={16} height={16} />}
        <span>{line.text}</span>
        {line.crafted && <span class="fe-mod__tag">Crafted</span>}
      </span>
      <span class="fe-mod__range">{line.range ?? ''}</span>
    </div>
  );
}

/** Viewports under 800 px high (1280x720, 1366x768): the bench folds the modifier list by default. */
const SHORT_SCREEN = '(max-height: 799px)';

function useShortScreen(): boolean {
  const [short, setShort] = useState(() => window.matchMedia(SHORT_SCREEN).matches);
  useEffect(() => {
    const mq = window.matchMedia(SHORT_SCREEN);
    const sync = (): void => setShort(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return short;
}

/**
 * The player's own fold choice for the modifier list of gear with bench recipes (kept while the page lives);
 * null = follow the screen size.
 */
let modsOpenChoice: boolean | null = null;

/** `withRecipes`: the recipe list competes for the space (gear); maps and uniques show their modifiers open. */
function useModsOpen(withRecipes: boolean): [boolean, () => void] {
  const short = useShortScreen();
  const [choice, setChoice] = useState<boolean | null>(withRecipes ? modsOpenChoice : null);
  const open = choice ?? (withRecipes ? !short : true);
  const toggle = (): void => {
    if (withRecipes) modsOpenChoice = !open;
    setChoice(!open);
  };
  return [open, toggle];
}

/** Folded modifier list: the same kind chips as the rows, with how many of each the item has. */
function ModTally({ lines }: { lines: TooltipLine[] }) {
  const kinds: { kind: TooltipLine['kind']; chip: string; label: string }[] = [
    { kind: 'implicit', chip: 'I', label: 'implicit' },
    { kind: 'prefix', chip: 'P', label: 'prefixes' },
    { kind: 'suffix', chip: 'S', label: 'suffixes' },
    { kind: 'mapMod', chip: 'M', label: 'map modifiers' },
    { kind: 'unique', chip: 'U', label: 'unique modifiers' },
    { kind: 'scar', chip: '!', label: 'scars' },
  ];
  const counts = kinds.map((k) => ({ ...k, n: lines.filter((l) => l.kind === k.kind).length })).filter((k) => k.n > 0);
  if (!counts.length) return <span class="fe-bench__tally fe-bench__tally--none">none yet</span>;
  return (
    <span class="fe-bench__tally">
      {counts.map((k) => (
        <span key={k.kind} class={cx('fe-bench__tally-item', k.kind === 'scar' && 'fe-bench__tally-item--neg')} title={`${k.label}: ${k.n}`}>
          <span class="fe-mod__kind">{k.chip}</span>
          {k.n}
        </span>
      ))}
      {lines.some((l) => l.crafted) && <AnvilGlyph />}
    </span>
  );
}

function Mods({
  desc,
  withRecipes,
  hasCrafted,
  onClear,
  busy,
}: {
  desc: ItemDescription;
  withRecipes: boolean;
  hasCrafted: boolean;
  onClear: () => void;
  busy: boolean;
}) {
  const [open, toggle] = useModsOpen(withRecipes);
  const lines = [...desc.implicits, ...desc.affixes, ...desc.scars.map((l) => ({ ...l, negative: true }))];
  return (
    <section class={cx('fe-bench__section', !open && 'fe-bench__section--folded')}>
      <div class="fe-bench__section-head">
        <button type="button" class="fe-section-title fe-bench__fold" aria-expanded={open} onClick={toggle}>
          <i class="fe-bench__chev" aria-hidden="true" />
          Modifiers
          {!open && <ModTally lines={lines} />}
        </button>
        {hasCrafted && (
          <Button size="small" class="fe-bench__clear" disabled={busy} onClick={onClear}>
            <AnvilGlyph />
            Clear crafted affix
          </Button>
        )}
      </div>
      {open && desc.properties.length > 0 && (
        <div class="fe-bench__props">
          {desc.properties.map((p) => (
            <span key={p.label} class="fe-bench__prop">
              {p.label} <b>{p.value}</b>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div class="fe-mods">
          {lines.map((l, i) => (
            <ModRow key={i} line={l} />
          ))}
          {lines.length === 0 && <div class="fe-muted fe-bench__none">No modifiers yet: a clean base for the bench.</div>}
        </div>
      )}
    </section>
  );
}

interface Carried {
  /** The stack a palette click applies: the largest backpack stack, else the Crafting Stash slot (`cstash:<id>`). */
  uid: string;
  /** Everything the bench can spend: backpack + Crafting Stash (the rules pay in that order). */
  count: number;
  largest: number;
  /** Of which in the Crafting Stash. */
  stash: number;
}

function useCarried(ch: CharacterSave | null, lockedUids: ReadonlySet<string>) {
  return useMemo(() => {
    const out = new Map<CurrencyId, Carried>();
    if (!ch) return out;
    for (const e of ch.backpack.entries) {
      const it = e.item;
      if (it.kind !== 'currency' || lockedUids.has(it.uid)) continue;
      const cur = out.get(it.currencyId);
      if (!cur) out.set(it.currencyId, { uid: it.uid, count: it.count, largest: it.count, stash: 0 });
      else {
        // The palette shows the total and applies from the largest stack.
        cur.count += it.count;
        if (it.count > cur.largest) {
          cur.largest = it.count;
          cur.uid = it.uid;
        }
      }
    }
    // Crafting straight from the Crafting Stash (GAME_SPEC §12): its slot counts too, and is used once the bags are empty.
    for (const id of CURRENCY_IDS) {
      const n = stashCount(ch, id);
      if (n <= 0) continue;
      const cur = out.get(id);
      if (cur) {
        cur.count += n;
        cur.stash = n;
      } else out.set(id, { uid: currencyStashUid(id), count: n, largest: 0, stash: n });
    }
    return out;
  }, [ch, lockedUids]);
}

function CostChips({ cost, carried }: { cost: BenchRecipe['cost']; carried: Map<CurrencyId, { count: number }> }) {
  const store = useStore();
  return (
    <span class="fe-recipe__cost">
      {cost.map((c) => {
        const have = carried.get(c.currencyId)?.count ?? 0;
        return (
          <span
            key={c.currencyId}
            class={cx('fe-recipe__price', have < c.count && 'fe-recipe__price--short')}
            title={`${c.count} ${store.rules.content.currencies[c.currencyId]?.name ?? c.currencyId} (you have ${formatInt(have)}, with the Crafting Stash)`}
          >
            <PixelIcon id={iconIdForCurrency(c.currencyId)} width={20} height={20} />
            {c.count}
          </span>
        );
      })}
    </span>
  );
}

function Recipes({
  recipes,
  item,
  carried,
  blocked,
  busy,
  onCraft,
}: {
  recipes: BenchRecipe[];
  item: Item;
  carried: Map<CurrencyId, { count: number }>;
  /** The whole bench refuses right now (not a hideout, the item is offered in the trade): said once above. */
  blocked: boolean;
  busy: boolean;
  onCraft: (r: BenchRecipe, e: MouseEvent) => void;
}) {
  const local = useLocal();
  if (item.kind !== 'equipment') {
    return (
      <section class="fe-bench__section">
        <div class="fe-section-title">Bench recipes</div>
        <p class="fe-bench__note">The bench's recipes are for gear. Use the currency below to craft this map.</p>
      </section>
    );
  }
  if (item.rarity === 'unique') {
    return (
      <section class="fe-bench__section">
        <div class="fe-section-title">Bench recipes</div>
        <p class="fe-bench__note">Unique items cannot use bench recipes. A Crown Fragment can reroll their numeric modifiers.</p>
      </section>
    );
  }
  const stab = recipes[0]?.stabilityCost ?? 1;
  const groups: { kind: BenchRecipe['kind']; title: string }[] = [
    { kind: 'prefix', title: 'Prefixes' },
    { kind: 'suffix', title: 'Suffixes' },
  ];
  const availableCount = blocked ? 0 : recipes.filter((r) => r.available).length;
  // One reason shared by every recipe (a crafted affix already there, a Finished item): say it once. A blocked
  // bench already said why above.
  const reasons = new Set(recipes.map((r) => (r.available ? null : (r.reason ?? null))));
  const shared = !blocked && availableCount === 0 && reasons.size === 1 ? [...reasons][0] : null;
  const rule = `Adds the chosen affix at a fixed tier. Costs ${stab} Stability, with no scar risk. One crafted affix per item.`;
  return (
    <section class="fe-bench__section">
      <div class="fe-bench__section-head">
        <div
          class="fe-section-title fe-bench__recipes-title"
          onPointerEnter={(e) => local.showTooltip({ kind: 'text', title: 'Bench recipes', lines: [rule] }, e.currentTarget, 'side')}
          onPointerLeave={() => local.hideTooltip()}
        >
          Bench recipes
        </div>
        <span class="fe-bench__count">{recipes.length ? `${availableCount} of ${recipes.length} available` : ''}</span>
      </div>
      <p class="fe-bench__note fe-bench__rule">{rule}</p>
      {recipes.length === 0 && <p class="fe-bench__note">No bench recipe fits this item.</p>}
      {shared && <p class="fe-bench__blocked">{shared}</p>}
      {groups.map((g) => {
        const list = recipes.filter((r) => r.kind === g.kind);
        if (!list.length) return null;
        return (
          <div key={g.kind} class="fe-recipes">
            <div class="fe-recipes__title">{g.title}</div>
            {list.map((r) => {
              const off = !r.available || blocked;
              return (
                <div
                  key={r.id}
                  class={cx('fe-recipe', off && 'fe-recipe--off')}
                  onPointerEnter={(e) =>
                    r.tags.length &&
                    local.showTooltip(
                      {
                        kind: 'text',
                        title: r.label,
                        lines: [
                          `${r.kind === 'prefix' ? 'Prefix' : 'Suffix'} · Tier ${r.tier}${r.tags.length ? ` · ${r.tags.join(', ')}` : ''}`,
                          ...(r.reason && !blocked ? [r.reason] : []),
                        ],
                        tone: r.available && !blocked ? undefined : 'bad',
                      },
                      e.currentTarget,
                      'side',
                    )
                  }
                  onPointerLeave={() => local.hideTooltip()}
                >
                  <span class="fe-mod__kind">{r.kind === 'prefix' ? 'P' : 'S'}</span>
                  <span class="fe-recipe__main">
                    <span class="fe-recipe__label">{r.label}</span>
                    {!r.available && r.reason && !shared && !blocked && <span class="fe-recipe__why">{r.reason}</span>}
                  </span>
                  <span class="fe-mod__tier">T{r.tier}</span>
                  <CostChips cost={r.cost} carried={carried} />
                  <Button size="small" variant={off ? 'default' : 'ember'} class="fe-recipe__go" disabled={off || busy} onClick={(e) => onCraft(r, e as unknown as MouseEvent)}>
                    Craft
                  </Button>
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

function Story({ history }: { history: string[] }) {
  if (!history.length) return null;
  return (
    <section class="fe-bench__section">
      <div class="fe-section-title">Its story</div>
      <ol class="fe-story">
        {history.map((h, i) => (
          <li key={i} class={cx('fe-story__step', i === history.length - 1 && 'fe-story__step--last')}>
            {h}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Palette({
  ch,
  uid,
  carried,
  allowed,
  locked,
  onApplied,
}: {
  ch: CharacterSave;
  uid: string | null;
  carried: Map<CurrencyId, Carried>;
  allowed: boolean;
  /** The bench item is offered in the trade. */
  locked: boolean;
  /** After a click was applied (it may have opened the affix choice). */
  onApplied: () => void;
}) {
  const store = useStore();
  const local = useLocal();
  const ids = CURRENCY_IDS.filter((id) => carried.has(id));
  const carriedRef = useRef(carried);
  carriedRef.current = carried;
  const gridRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  // The one-row palette (short screens) fades out at an edge with more currency beyond it.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const sync = (): void => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, [ids.length]);

  const errorFor = (c: CharacterSave, currencyUid: string): string | null => {
    if (!allowed) return 'Crafting only works in a hideout.';
    if (!uid) return 'Place an item on the bench first.';
    if (locked) return LOCKED_REASON;
    return safe(() => store.rules.craftingTargetError(c, currencyUid, uid), 'This item cannot be crafted.');
  };

  /** The tooltip reads the character live, so the odds follow each craft while the pointer stays on the button. */
  const showTip = (id: CurrencyId, el: Element): void => {
    const info = store.rules.content.currencies[id];
    local.showTooltip(
      {
        kind: 'custom',
        render: () => {
          const now = store.get().character;
          const stack = carriedRef.current.get(id);
          if (!now || !stack) return null;
          const error = errorFor(now, stack.uid);
          const lines = !error && uid ? safe(() => store.rules.craftPreview(now, stack.uid, uid), []) : [];
          return (
            <div class="fe-tt fe-tt--currency fe-curtip">
              <div class="fe-curtip__head">
                <PixelIcon id={iconIdForCurrency(id)} width={32} height={32} />
                <div>
                  <div class="fe-curtip__name">{info?.name ?? id}</div>
                  <div class="fe-curtip__meta">
                    {stack.stash > 0
                      ? `${formatInt(stack.count - stack.stash)} carried, ${formatInt(stack.stash)} in the Crafting Stash`
                      : `${stack.count} carried`}
                    {info && info.stabilityCost > 0 ? ` · costs ${info.stabilityCost} Stability` : ''}
                  </div>
                </div>
              </div>
              {info?.description && <div class="fe-curtip__desc">{info.description}</div>}
              <div class={cx('fe-tt__craft', error && 'fe-tt__craft--bad')}>
                {error ? (
                  <div class="fe-tt__craft-line">{error}</div>
                ) : (
                  <>
                    {lines.map((l, i) => (
                      <div class="fe-tt__craft-line" key={i}>
                        {l}
                      </div>
                    ))}
                    <div class="fe-tt__craft-cta">
                      {info?.needsAffixChoice ? 'Click, then choose the affix' : 'Click to apply one to the bench item'}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        },
      },
      el,
      'side',
    );
  };

  return (
    <div class="fe-palette">
      <div class="fe-palette__head">
        <span class="fe-section-title">Currency</span>
        <span class="fe-palette__hint">{uid ? 'Click to apply to the bench item' : 'Place an item to use your currency'}</span>
      </div>
      {ids.length === 0 ? (
        <p class="fe-bench__note">You have no currency in your backpack or Crafting Stash.</p>
      ) : (
        <div
          ref={gridRef}
          class={cx('fe-palette__grid', more.left && 'fe-palette__grid--more-l', more.right && 'fe-palette__grid--more-r')}
          onWheel={(e) => {
            // Short screens show the palette as one row that scrolls sideways: let the wheel scroll it.
            const el = e.currentTarget;
            if (el.scrollWidth <= el.clientWidth + 1 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
            el.scrollLeft += e.deltaY;
            e.preventDefault();
          }}
        >
          {ids.map((id) => {
            const stack = carried.get(id)!;
            const off = !!errorFor(ch, stack.uid);
            return (
              <button
                key={id}
                type="button"
                class={cx('fe-cur', off && 'fe-cur--off')}
                aria-label={store.rules.content.currencies[id]?.name ?? id}
                onPointerEnter={(e) => showTip(id, e.currentTarget)}
                onPointerLeave={() => local.hideTooltip()}
                onClick={(e) => {
                  if (!uid) {
                    store.actions.uiSound('error');
                    local.flashHint('Place an item on the bench first.', e.clientX, e.clientY);
                    return;
                  }
                  applyCurrencyOnce(store, local, e as unknown as MouseEvent, stack.uid, uid);
                  onApplied();
                }}
              >
                <PixelIcon id={iconIdForCurrency(id)} class="fe-cur__icon" width="72%" height="72%" />
                <span class="fe-cur__count">{stack.count >= 10000 ? `${Math.floor(stack.count / 1000)}k` : formatInt(stack.count)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Services({ services, carried, disabled, onCraft }: {
  services: BenchService[]; carried: Map<CurrencyId, Carried>; disabled: boolean;
  onCraft: (r: Pick<BenchRecipe, 'id'>, e?: MouseEvent) => void;
}) {
  if (!services.length) return null;
  return <section class="fe-bench__section fe-bench-services">
    <div class="fe-section-title">Scrap services</div>
    {services.map(service => <div key={service.id} class="fe-bench-service">
      <div class="fe-bench-service__row">
        <span class="ui-type-secondary">{service.label}</span>
        <CostChips cost={service.cost} carried={carried} />
        <Button disabled={disabled || !service.available} onClick={e => onCraft(service, e as unknown as MouseEvent)}
          class="fe-bench-service__apply" data-service={service.id}>Apply</Button>
      </div>
      <details class="ui-type-caption"><summary>Effects and price</summary>
        {service.lines.map(line => <p key={line}>{line}</p>)}
      </details>
      {service.reason && <p class="fe-bench__note">{service.reason}</p>}
    </div>)}
  </section>;
}

export function CraftingBenchPanel() {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const uid = useUi((s) => s.benchItemUid);
  const allowed = useUi((s) => s.craftingAllowed);
  const affixChoice = useUi((s) => s.affixChoice);
  const trade = useUi((s) => s.trade);
  const lockedUids = useMemo(() => new Set(trade?.yourItems.map((i) => i.uid) ?? []), [trade]);
  const benchLocked = !!uid && lockedUids.has(uid);
  const carried = useCarried(ch, lockedUids);
  const [busyAt, setBusyAt] = useState<number | null>(null);
  const choiceFromPalette = useRef(false);

  const found = useMemo(() => (ch && uid ? safe(() => store.rules.findItem(ch, uid), null) : null), [ch, uid, store]);
  const item = found && benchAccepts(found.item, uid ?? '') ? found.item : null;
  const desc = useMemo(() => (ch && item ? safe(() => store.rules.describeItem(item, ch), null) : null), [ch, item, store]);
  const recipes = useMemo(
    () => (ch && uid && item?.kind === 'equipment' ? safe(() => store.rules.benchRecipes(ch, uid), [] as BenchRecipe[]) : []),
    [ch, uid, item, store],
  );
  const services = ch && uid ? safe(() => store.rules.benchServices(ch, uid), []) : [];
  const hasCrafted = item?.kind === 'equipment' && item.affixes.some((a) => a.crafted);
  const withRecipes = item?.kind === 'equipment' && item.rarity !== 'unique';

  // The item left (traded, dropped, destroyed): clear the stale selection.
  useEffect(() => {
    if (uid && ch && !item) store.actions.setBenchItem(null);
  }, [uid, ch, item, store]);

  // A bench craft is in flight until the character changes (the server answered) or the hold times out.
  useEffect(() => setBusyAt(null), [ch]);
  useEffect(() => {
    if (busyAt === null) return;
    const t = setTimeout(() => setBusyAt(null), CRAFT_PENDING_MS);
    return () => clearTimeout(t);
  }, [busyAt]);

  // A palette click that opened the affix choice keeps the currency armed; cancelling the choice disarms it again.
  useEffect(() => {
    if (affixChoice || !choiceFromPalette.current) return;
    choiceFromPalette.current = false;
    if (store.get().armed) store.actions.disarm();
  }, [affixChoice, store]);

  if (!ch) return null;
  const busy = busyAt !== null;

  /** Offered in the trade since it was placed: refuse with the reason (the server would too). */
  const refuseLocked = (target: string, e?: MouseEvent): boolean => {
    if (!isTradeLocked(store.get(), target)) return false;
    store.actions.uiSound('error');
    local.flashHint(LOCKED_REASON, e?.clientX, e?.clientY);
    return true;
  };

  const craft = (r: Pick<BenchRecipe, 'id'>, e?: MouseEvent): void => {
    if (!uid || craftInFlight(store, uid) || refuseLocked(uid, e)) return;
    noteCraftSent(store, uid);
    setBusyAt(performance.now());
    local.hideTooltip();
    store.actions.benchCraft(r.id);
  };

  const clearCrafted = (): void => {
    if (!uid || !desc || refuseLocked(uid)) return;
    const line = desc.affixes.find((l) => l.crafted);
    local.dialog.set({
      title: 'Clear crafted affix',
      body: `Remove ${line ? `“${line.text}”` : 'the crafted affix'} from ${desc.title}? It is free, but the Stability it cost is not refunded.`,
      confirmLabel: 'Clear it',
      onConfirm: () => {
        if (craftInFlight(store, uid) || refuseLocked(uid)) return;
        noteCraftSent(store, uid);
        setBusyAt(performance.now());
        store.actions.benchClear();
      },
    });
  };

  return (
    <PanelShell panel="craftingBench" title="Crafting Bench" class="fe-bench">
      <Altar item={item} uid={item ? uid : null} desc={desc} where={found && item ? whereText(found.location, ch) : null} />
      <div class="fe-bench__scroll fe-scrollfade">
        {!allowed && <p class="fe-bench__blocked">The bench works in any hideout. You cannot craft here.</p>}
        {allowed && benchLocked && <p class="fe-bench__blocked">{LOCKED_REASON}</p>}
        {item && desc ? (
          <>
            <Services services={services} carried={carried} disabled={busy || !allowed || benchLocked} onCraft={craft} />
            <Mods
              key={withRecipes ? 'gear' : 'plain'}
              desc={desc}
              withRecipes={withRecipes}
              hasCrafted={hasCrafted}
              onClear={clearCrafted}
              busy={busy || !allowed || benchLocked}
            />
            <Recipes recipes={recipes} item={item} carried={carried} blocked={!allowed || benchLocked} busy={busy} onCraft={craft} />
            <Story history={desc.history ?? []} />
          </>
        ) : (
          <section class="fe-bench__section fe-bench__explain">
            <div class="fe-section-title">How the bench works</div>
            <ul class="fe-bench__rules">
              <li>
                Choose exactly which affix to add. It comes at a fixed, modest tier for Forge Scrap, plus an essence for tagged affixes.
              </li>
              <li>Each recipe costs 1 Stability with no scar risk. A normal item becomes magic.</li>
              <li>
                One crafted affix per item, marked with <AnvilGlyph /> in tooltips. Clearing it is free.
              </li>
              <li>Your currency below applies to the bench item with one click, odds shown on hover.</li>
            </ul>
          </section>
        )}
      </div>
      <Palette
        ch={ch}
        uid={item ? uid : null}
        carried={carried}
        allowed={allowed}
        locked={benchLocked}
        onApplied={() => {
          choiceFromPalette.current = !!store.get().affixChoice;
        }}
      />
    </PanelShell>
  );
}
