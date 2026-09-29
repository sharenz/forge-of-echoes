// Stash (docked left, opens with the inventory): a search box over every tab, named tabs (add / rename) with their
// match counts, and the 12x8 grid of the active tab. Matching items glow and the rest dim, in the stash and in the
// backpack alike (ItemView reads the same search state).
import { useState } from 'preact/hooks';
import { MAX_STASH_TABS } from '../../contracts/items';
import { Keycap, cx } from '../components/common';
import { ItemGrid } from '../items/Containers';
import { useSearch } from '../items/search';
import { useLocal } from '../local';
import { useSignal, useStore, useUi } from '../store';
import { PanelShell } from './PanelShell';

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
  const tabs = search.tabCounts.reduce((a, b) => a + b, 0);
  const total = tabs + search.backpackCount;
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

export function StashPanel() {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const active = useUi((s) => s.stashTab);
  const search = useSearch();
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  if (!ch) return null;
  const tabIndex = Math.min(Math.max(0, active), ch.stash.length - 1);
  const tab = ch.stash[tabIndex];

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
      {tab && <ItemGrid grid={tab.grid} kind="stash" tab={tabIndex} />}
      <div class="fe-panel__note ui-type-caption">
        Ctrl-click: to your inventory. Ctrl+Shift-click: onto the crafting bench. Your stash is yours alone, even in a
        friend's hideout.
      </div>
    </PanelShell>
  );
}
