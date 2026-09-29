// Stash (docked left, opens with the inventory): a search box over every tab, named tabs (add / rename) with their
// match counts, then the three special tabs (Map Stash, Crafting Stash for equipment and for map currency; see
// StashSpecial.tsx), and the page of the active tab: the 12x8 grid, or a special tab's page in the same footprint.
// Matching items glow and the rest dim, in the stash, the special tabs and the backpack alike (ItemView and the
// special pages read the same search state).
import { useMemo, useState } from 'preact/hooks';
import { CURRENCY_STASH_MAX, MAP_STASH_CAPACITY, MAX_STASH_TABS, type SpecialStashTab } from '../../contracts/items';
import { Button, Keycap, cx } from '../components/common';
import { ItemGrid } from '../items/Containers';
import { stashMatchCount, useSearch } from '../items/search';
import { formatInt } from '../lib/format';
import { SPECIAL_TABS, depositPlan, isSpecialTab, normalTabIndex } from '../lib/stash';
import { useLocal } from '../local';
import { useSignal, useStore, useUi } from '../store';
import { PanelShell } from './PanelShell';
import { CurrencyStashView, MapStashView, SpecialTabButton } from './StashSpecial';

const SEARCH_HELP = [
  'Space-separated terms must all match: life fire',
  '"Quotes" match a whole phrase: "fire damage"',
  'a|b matches either: ring|amulet',
  '!term excludes: !normal',
  'Rarity words match the rarity: normal, magic, rare, unique',
];

function StashSearch() {
  const local = useLocal();
  const query = useSignal(local.search);
  const search = useSearch();
  const total = stashMatchCount(search) + search.backpackCount;
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

  return (
    <div class={cx('fe-search', search.active && 'fe-search--active', search.active && total === 0 && 'fe-search--none')} role="search">
      <span class="fe-search__glass" aria-hidden="true" />
      <input
        class="fe-search__input"
        type="text"
        value={query}
        maxLength={80}
        placeholder="Search the stash"
        aria-label="Search the stash"
        autoComplete="off"
        spellcheck={false}
        onInput={(e) => local.search.set((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            // First Esc clears the query; the next one leaves the field (App blurs text fields on Esc).
            e.preventDefault();
            e.stopPropagation();
            local.search.set('');
          } else if (e.key === 'Enter') {
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
      {search.active ? (
        <span class="fe-search__count" aria-live="polite">
          {total === 0 ? 'No matches' : `${total} ${total === 1 ? 'match' : 'matches'}`}
          {search.backpackCount > 0 && <span class="fe-search__where"> · {search.backpackCount} in backpack</span>}
        </span>
      ) : (
        <span class="fe-search__keys" aria-hidden="true">
          <Keycap>{mac ? '⌘' : 'Ctrl'}</Keycap>
          <Keycap>F</Keycap>
        </span>
      )}
      {query && (
        <button
          type="button"
          class="fe-btn fe-btn--icon fe-btn--ghost fe-search__clear"
          aria-label="Clear the search"
          onClick={() => local.search.set('')}
        >
          <span class="fe-x" />
        </button>
      )}
      <span
        class="fe-search__help"
        aria-label="Search syntax"
        onPointerEnter={(e) => local.showTooltip({ kind: 'text', title: 'Search syntax', lines: SEARCH_HELP }, e.currentTarget, 'side')}
        onPointerLeave={() => local.hideTooltip()}
      >
        ?
      </span>
    </div>
  );
}

/** Currency "Deposit all" leaves in the backpack because its slot is full: "Forge Scrap stays: its slot is full". */
function fullSlotsNote(names: string[]): string {
  const max = formatInt(CURRENCY_STASH_MAX);
  if (names.length === 1) return `${names[0]} stays: its slot is full (${max}).`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} stay: their slots are full (${max} each).`;
}

/**
 * The line under the page: what the active tab's clicks do, and "Deposit all" on the Crafting Stash tabs. Every
 * variant keeps the same height, so switching tabs never moves the panel.
 */
function StashFooter({ special }: { special: SpecialStashTab | null }) {
  const store = useStore();
  const ch = useUi((s) => s.character);
  const trade = useUi((s) => s.trade);
  const locked = useMemo(() => new Set(trade?.yourItems.map((i) => i.uid) ?? []), [trade]);
  const plan = useMemo(() => (ch && special && special !== 'maps' ? depositPlan(ch, locked) : null), [ch, special, locked]);
  if (special === 'maps') {
    return (
      <div class="fe-stash__foot">
        <span class="fe-panel__note ui-type-caption">
          Ctrl-click a map: to your inventory · Ctrl+Shift-click: onto the crafting bench
        </span>
        <span class="fe-stash__cap ui-type-caption">
          {formatInt(ch?.mapStash?.length ?? 0)} / {formatInt(MAP_STASH_CAPACITY)}
        </span>
      </div>
    );
  }
  if (special) {
    const stacks = plan?.stacks ?? 0;
    const names = (plan?.full ?? []).map((id) => store.rules.content.currencies[id]?.name ?? id);
    const move =
      stacks === 0
        ? names.length
          ? ''
          : 'No currency in your backpack.'
        : stacks === 1
          ? 'Move a currency stack from your backpack into its slot.'
          : `Move ${stacks} currency stacks from your backpack into their slots.`;
    const title = [move, names.length ? fullSlotsNote(names) : ''].filter(Boolean).join(' ');
    return (
      <div class="fe-stash__foot">
        <span class="fe-panel__note ui-type-caption">Ctrl-click: a stack · Shift+Ctrl-click: one · Right-click: craft</span>
        <Button
          size="small"
          class="fe-stash__deposit"
          disabled={stacks === 0}
          title={title}
          onClick={() => {
            store.actions.uiSound('click');
            store.actions.depositAllCurrency();
          }}
        >
          Deposit all{stacks > 0 ? ` (${stacks})` : ''}
        </Button>
      </div>
    );
  }
  return (
    <div class="fe-stash__foot">
      <span class="fe-panel__note ui-type-caption">
        Ctrl-click: to your inventory · Ctrl+Shift-click: onto the crafting bench · Yours alone, even in a friend's
        hideout
      </span>
    </div>
  );
}

export function StashPanel() {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const active = useUi((s) => s.stashTab);
  const search = useSearch();
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  if (!ch) return null;
  const special = isSpecialTab(active) ? active : null;
  const tabIndex = normalTabIndex(active, ch.stash.length);
  const tab = tabIndex === null ? null : ch.stash[tabIndex];

  const commitRename = (): void => {
    if (renaming === null) return;
    const name = draft.trim();
    if (name && name !== ch.stash[renaming]?.name) store.actions.renameStashTab(renaming, name.slice(0, 16));
    setRenaming(null);
  };

  return (
    <PanelShell panel="stash" title="Stash" class="fe-stash">
      <StashSearch />
      <div class="fe-tabs" role="tablist">
        <div class="fe-tabs__normal">
          {ch.stash.map((t, i) => {
            const hits = search.active ? (search.tabCounts[i] ?? 0) : null;
            return renaming === i ? (
              <input
                key={i}
                class="fe-input fe-tabs__rename"
                value={draft}
                maxLength={16}
                autoFocus
                onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setRenaming(null);
                  }
                }}
              />
            ) : (
              <button
                key={i}
                role="tab"
                aria-selected={i === tabIndex}
                class={cx('fe-tab', i === tabIndex && 'fe-tab--on', hits === 0 && 'fe-tab--nohits')}
                onClick={() => {
                  store.actions.uiSound('click');
                  store.actions.setStashTab(i);
                }}
                onDblClick={() => {
                  setDraft(t.name);
                  setRenaming(i);
                }}
                onPointerEnter={(e) =>
                  local.showTooltip(
                    {
                      kind: 'text',
                      lines: [
                        hits === null ? `${t.grid.entries.length} items` : `${hits} of ${t.grid.entries.length} items match`,
                        'Double-click to rename',
                      ],
                    },
                    e.currentTarget,
                    'above',
                  )
                }
                onPointerLeave={() => local.hideTooltip()}
              >
                {t.name}
                {hits !== null && <span class={cx('fe-tab__hits', hits > 0 && 'fe-tab__hits--on')}>{hits}</span>}
              </button>
            );
          })}
          {ch.stash.length < MAX_STASH_TABS && (
            <button
              class="fe-tab fe-tab--add"
              aria-label="Add a stash tab"
              onClick={() => {
                store.actions.uiSound('click');
                store.actions.addStashTab();
              }}
              onPointerEnter={(e) =>
                local.showTooltip({ kind: 'text', lines: [`Add a tab (${ch.stash.length}/${MAX_STASH_TABS})`] }, e.currentTarget, 'above')
              }
              onPointerLeave={() => local.hideTooltip()}
            >
              +
            </button>
          )}
        </div>
        <div class="fe-tabs__special">
          {SPECIAL_TABS.map((t) => (
            <SpecialTabButton key={t} tab={t} on={special === t} hits={search.active ? search.special[t] : null} />
          ))}
        </div>
      </div>
      {special === 'maps' ? (
        <MapStashView mode="stash" />
      ) : special ? (
        <CurrencyStashView tab={special} />
      ) : (
        tab && tabIndex !== null && <ItemGrid grid={tab.grid} kind="stash" tab={tabIndex} />
      )}
      <StashFooter special={special} />
    </PanelShell>
  );
}
