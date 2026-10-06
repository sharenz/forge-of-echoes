// Centred modals: the Esc menu (settings and session actions), controls help, and the run summary.
import type { ComponentChildren } from 'preact';
import type { MonsterKind } from '../../contracts/content';
import type { Settings } from '../../contracts/items';
import type { RunSummaryInfo } from '../../contracts/net';
import { Button, Frame, Keycap, PanelHead, Slider, Switch, cx } from '../components/common';
import { TONE_LABEL, rosterFor } from '../lib/content';
import { formatDuration, formatInt } from '../lib/format';
import { gt } from '../../data/guide/strings';
import { gearToEquipOf } from '../guide/snapshot';
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
            <Row label="Show tips" hint="First-time coach cards">
              <Switch label="Show tips" checked={settings.hints !== false} onChange={(v) => set({ hints: v })} />
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
              Help and controls
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

const RESULT_TEXT: Record<RunSummaryInfo['result'], { title: string; line: string }> = {
  cleared: { title: 'Map cleared', line: 'Your spoils are safe in your inventory.' },
  failed: { title: gt('summary.lostTitle'), line: gt('summary.lostLine') },
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
  // The portals the map still has: a fall costs one entry, so "Map lost" is only true when none are left.
  const portals = useUi((s) => s.hud?.portal?.remaining ?? null);
  const unspent = useUi((s) => (s.character?.unspentAttributePoints ?? 0) + (s.character?.unspentSkillPoints ?? 0));
  const gear = useUi((s) => (s.runSummary ? gearToEquipOf(s.character, store.rules) : 0));
  if (!summary) return null;
  const fell = summary.result === 'failed' && portals !== null && portals > 0;
  const base = fell
    ? { title: gt('summary.fellTitle'), line: gt('summary.fellLine', { portals, portalWord: portals === 1 ? 'portal' : 'portals' }) }
    : RESULT_TEXT[summary.result];
  const boss = BOSS_FALLS[rosterFor(baseId).boss];
  const t = summary.result === 'cleared' && boss ? { ...base, line: `${boss} ${base.line}` } : base;
  const cleared = summary.result === 'cleared';
  const act = (panel: 'character' | 'inventory' | 'mapDevice'): void => {
    store.actions.uiSound('open');
    store.actions.dismissRunSummary();
    store.actions.openPanel(panel);
  };
  return (
    <div class="fe-backdrop fe-solid" onPointerDown={(e) => e.target === e.currentTarget && store.actions.dismissRunSummary()}>
      <Frame class={cx('fe-modal fe-summary', `fe-summary--${fell ? 'abandoned' : summary.result}`)} role="dialog" aria-modal="true" aria-label={t.title}>
        <div class="fe-summary__banner">
          <div class="fe-summary__sigil" />
          <div class="fe-summary__title">{t.title}</div>
          <div class="fe-summary__map">
            {summary.mapName} · Tier {summary.tier}
          </div>
        </div>
        <p class="fe-summary__line">{t.line}</p>
        {summary.result === 'failed' && summary.kills === 0 && <p class="fe-summary__line fe-summary__coach ui-type-secondary">{gt('summary.zeroKills')}</p>}
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
            <ul class="fe-summary__items fe-summary__items--fade" tabIndex={0} aria-label={`Found (${summary.itemsFound.length}). ${gt('summary.scroll')}`}>
              {summary.itemsFound.map((it, i) => (
                <li key={i} class={cx('fe-summary__item', `fe-tone-${it.tone}`)} title={TONE_LABEL[it.tone]}>
                  {it.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div class="fe-dialog__actions fe-summary__next">
          {unspent > 0 && <Button data-summary-points onClick={() => act('character')}>{gt('summary.next.points')}</Button>}
          {gear > 0 && <Button data-summary-equip onClick={() => act('inventory')}>{gt('summary.next.equip')}</Button>}
          {cleared && <Button data-summary-atlas onClick={() => act('mapDevice')}>{gt('summary.next.atlas')}</Button>}
          <Button variant="ember" size="large" autoFocus onClick={() => store.actions.dismissRunSummary()}>
            Continue
          </Button>
        </div>
      </Frame>
    </div>
  );
}
