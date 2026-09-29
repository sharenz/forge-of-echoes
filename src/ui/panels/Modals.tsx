// Centred modals: the Esc menu (settings and session actions), controls help, and the run summary.
import type { ComponentChildren } from 'preact';
import type { MonsterKind } from '../../contracts/content';
import type { Settings } from '../../contracts/items';
import type { RunSummaryInfo } from '../../contracts/net';
import { Button, Frame, Keycap, PanelHead, Slider, Switch, cx } from '../components/common';
import { TONE_LABEL, rosterFor } from '../lib/content';
import { formatDuration, formatInt } from '../lib/format';
import { useLocal } from '../local';
import { useStore, useUi } from '../store';

function closeMenu(store: ReturnType<typeof useStore>): void {
  store.actions.uiSound('close');
  store.actions.closePanel('menu');
  store.actions.setPaused(false);
}

function Row({ label, children, hint }: { label: string; children: ComponentChildren; hint?: string }) {
  return (
    <label class="fe-setting">
      <span class="fe-setting__label">
        {label}
        {hint && <span class="fe-setting__hint">{hint}</span>}
      </span>
      <span class="fe-setting__control">{children}</span>
    </label>
  );
}

export function MenuModal() {
  const store = useStore();
  const local = useLocal();
  const settings = useUi((s) => s.settings);
  const zone = useUi((s) => s.zone);
  const set = (patch: Partial<Settings>): void => store.actions.updateSettings(patch);
  return (
    <div class="fe-backdrop fe-solid" onPointerDown={(e) => e.target === e.currentTarget && closeMenu(store)}>
      <Frame class="fe-modal fe-menu" role="dialog" aria-modal="true" aria-label="Menu">
        <PanelHead title="Menu" onClose={() => closeMenu(store)} />
        <div class="fe-menu__online">
          <span class="fe-dot fe-dot--on" /> Online: the world keeps running while this menu is open.
        </div>
        <div class="fe-menu__body">
          <div class="fe-menu__col">
            <div class="fe-section-title">Sound</div>
            <Row label="Master">
              <Slider label="Master volume" value={settings.masterVolume} onInput={(v) => set({ masterVolume: v })} />
            </Row>
            <Row label="Music">
              <Slider label="Music volume" value={settings.musicVolume} onInput={(v) => set({ musicVolume: v })} />
            </Row>
            <Row label="Effects">
              <Slider label="Effects volume" value={settings.sfxVolume} onInput={(v) => set({ sfxVolume: v })} />
            </Row>
            <div class="fe-section-title">Gameplay</div>
            <Row label="Screen shake">
              <Slider label="Screen shake" value={settings.screenShake} onInput={(v) => set({ screenShake: v })} />
            </Row>
            <Row label="Auto-attack" hint="T toggles it in game">
              <Switch label="Auto-attack" checked={settings.autoAttack} onChange={(v) => set({ autoAttack: v })} />
            </Row>
            <Row label="Show frame rate">
              <Switch label="Show frame rate" checked={settings.showFps} onChange={(v) => set({ showFps: v })} />
            </Row>
          </div>
          <div class="fe-menu__col fe-menu__actions">
            <Button variant="ember" size="large" onClick={() => closeMenu(store)}>
              Resume
            </Button>
            <Button
              onClick={() => {
                store.actions.closePanel('menu');
                store.actions.openPanel('help');
              }}
            >
              Controls
            </Button>
            {zone === 'map' && (
              <Button
                onClick={() =>
                  local.dialog.set({
                    title: 'Leave map',
                    body: 'Return to your hideout? Coming back costs one of the map’s portals.',
                    confirmLabel: 'Leave map',
                    onConfirm: () => {
                      closeMenu(store);
                      store.actions.leaveMap();
                    },
                  })
                }
              >
                Leave map
              </Button>
            )}
            <Button
              onClick={() => {
                closeMenu(store);
                store.actions.toCharacterSelect();
              }}
            >
              Character select
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                closeMenu(store);
                store.actions.logout();
              }}
            >
              Log out
            </Button>
          </div>
        </div>
      </Frame>
    </div>
  );
}

const HELP: { title: string; rows: [string[], string][] }[] = [
  {
    title: 'Combat',
    rows: [
      [['W', 'A', 'S', 'D'], 'Move'],
      [['LMB'], 'Basic attack (hold)'],
      [['Space', 'Q', 'E', 'R', 'F'], 'Skills (hold to cast when ready)'],
      [['1', '2', '3', '4'], 'Drink a flask'],
      [['T'], 'Toggle auto-attack'],
    ],
  },
  {
    title: 'Interface',
    rows: [
      [['I'], 'Inventory'],
      [['C'], 'Character'],
      [['K'], 'Skills'],
      [['Esc'], 'Close the top panel, or open the menu'],
      [['Alt'], 'Hold: affix tiers, ranges and comparison; point at a debuff for its counter'],
    ],
  },
  {
    title: 'Party and chat',
    rows: [
      [['P'], 'Party: invite, visit hideouts, trade'],
      [['Enter'], 'Open chat, send a message'],
      [['/trade'], 'In chat: /trade name asks a player to trade'],
      [['Esc'], 'Close chat'],
    ],
  },
  {
    title: 'Items and crafting',
    rows: [
      [['Ctrl', 'Click'], 'Move between inventory, stash, gear, map device, bench and trade'],
      [['Ctrl', 'Shift', 'Click'], 'In the stash: put gear or a map on the crafting bench'],
      [['Ctrl', 'Shift', 'Click'], 'On a Crafting Stash slot: take exactly one'],
      [['Ctrl', 'F'], 'Search the stash while it is open'],
      [['RMB'], 'Arm a currency, also a Crafting Stash slot (hideout only)'],
      [['LMB'], 'Apply the armed currency to an item'],
      [['Drag'], 'Move an item; drop it on the world to put it on the floor'],
    ],
  },
];

export function HelpModal() {
  const store = useStore();
  const close = (): void => {
    store.actions.uiSound('close');
    store.actions.closePanel('help');
  };
  return (
    <div class="fe-backdrop fe-solid" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <Frame class="fe-modal fe-help" role="dialog" aria-modal="true" aria-label="Controls">
        <PanelHead title="Controls" onClose={close} />
        <div class="fe-help__grid">
          {HELP.map((g) => (
            <section key={g.title} class="fe-help__group">
              <div class="fe-section-title">{g.title}</div>
              {g.rows.map(([keys, what], i) => (
                <div class="fe-help__row" key={i}>
                  <span class="fe-help__keys">
                    {keys.map((k) => (
                      <Keycap key={k}>{k}</Keycap>
                    ))}
                  </span>
                  <span class="fe-help__what">{what}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
        <p class="fe-help__foot fe-muted">
          Click the map device, stash, anvil or Rook in a hideout to use them, and a portal to enter it. There is no pause online: your
          party keeps playing.
        </p>
      </Frame>
    </div>
  );
}

const RESULT_TEXT: Record<RunSummaryInfo['result'], { title: string; line: string }> = {
  cleared: { title: 'Map cleared', line: 'Your spoils are safe in your inventory.' },
  failed: { title: 'Map lost', line: 'The portals are spent. Everything you picked up is still yours.' },
  abandoned: { title: 'Map left', line: 'You walked away. Everything you picked up is still yours.' },
};

/** How each map's boss ends (GAME_SPEC §14), for the cleared summary. */
const BOSS_FALLS: Partial<Record<MonsterKind, string>> = {
  cinderMatriarch: 'The Matriarch is ash.',
  hollowWarden: "The Warden's lantern has gone dark.",
  varkus: 'Varkus has fallen, and the crowd is silent.',
};

export function RunSummaryModal() {
  const store = useStore();
  const summary = useUi((s) => s.runSummary);
  // state.run stays set while the summary shows: it names the map's boss.
  const baseId = useUi((s) => s.run?.map.baseId ?? null);
  if (!summary) return null;
  const base = RESULT_TEXT[summary.result];
  const boss = BOSS_FALLS[rosterFor(baseId).boss];
  const t = summary.result === 'cleared' && boss ? { ...base, line: `${boss} ${base.line}` } : base;
  return (
    <div class="fe-backdrop fe-solid" onPointerDown={(e) => e.target === e.currentTarget && store.actions.dismissRunSummary()}>
      <Frame class={cx('fe-modal fe-summary', `fe-summary--${summary.result}`)} role="dialog" aria-modal="true" aria-label={t.title}>
        <div class="fe-summary__banner">
          <div class="fe-summary__sigil" />
          <div class="fe-summary__title">{t.title}</div>
          <div class="fe-summary__map">
            {summary.mapName} · Tier {summary.tier}
          </div>
        </div>
        <p class="fe-summary__line">{t.line}</p>
        <div class="fe-summary__stats">
          <div class="fe-stat">
            <span class="fe-stat__v">{formatDuration(summary.seconds)}</span>
            <span class="fe-stat__l">Time</span>
          </div>
          <div class="fe-stat">
            <span class="fe-stat__v">{formatInt(summary.kills)}</span>
            <span class="fe-stat__l">Kills</span>
          </div>
          <div class="fe-stat">
            <span class="fe-stat__v">{formatInt(summary.xpGained)}</span>
            <span class="fe-stat__l">Experience</span>
          </div>
          <div class="fe-stat">
            <span class="fe-stat__v">{summary.levelsGained > 0 ? `+${summary.levelsGained}` : '0'}</span>
            <span class="fe-stat__l">Levels</span>
          </div>
        </div>
        <div class="fe-summary__loot">
          <div class="fe-section-title">Found ({summary.itemsFound.length})</div>
          {summary.itemsFound.length === 0 ? (
            <div class="fe-muted">Nothing worth carrying this time.</div>
          ) : (
            <ul class="fe-summary__items">
              {summary.itemsFound.map((it, i) => (
                <li key={i} class={cx('fe-summary__item', `fe-tone-${it.tone}`)} title={TONE_LABEL[it.tone]}>
                  {it.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div class="fe-dialog__actions">
          <Button variant="ember" size="large" autoFocus onClick={() => store.actions.dismissRunSummary()}>
            Continue
          </Button>
        </div>
      </Frame>
    </div>
  );
}
