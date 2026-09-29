// Map Device (own hideout only): the map slot, the rules' map readout with breakdowns, the player's
// personal luck (map + own gear, via rules.lootLuck on a preview of the run setup), portal status and the
// ember "Activate" button, then a picker over the Map Stash (tier tiles and map rows: click, Ctrl-click or drag a
// map into the device; drag the device's map back onto the picker to file it). In a party member's hideout it
// shows THEIR open portal instead (read-only).
import { useMemo, useState } from 'preact/hooks';
import { PORTALS_PER_MAP } from '../../contracts/net';
import type { PortalInfo } from '../../contracts/net';
import { Button, cx } from '../components/common';
import { MapDeviceSlotView } from '../items/Containers';
import { safe } from '../items/hooks';
import { useLocal } from '../local';
import { formatLuck, possessive } from '../lib/format';
import { useStore, useUi } from '../store';
import { PanelShell } from './PanelShell';
import { MapStashView } from './StashSpecial';
import { AtlasView } from './Atlas';
import type { AtlasAreaId } from '../../contracts/atlas';
import { ATLAS_START, atlasTierCeiling, findAtlasArea } from '../../data/progression/atlas';
import { newAtlas } from '../../game/progression/atlas';

function PortalNote({ portal, own }: { portal: PortalInfo; own: boolean }) {
  const spent = portal.remaining === 0;
  return (
    <div class={cx('fe-device__portal', spent && 'fe-device__portal--spent')}>
      <span class="fe-device__portal-dot" />
      <span>
        <b class="fe-device__portal-map">
          {portal.mapName} T{portal.tier}
        </b>
        {' · '}
        {portal.remaining}/{portal.total} portals left{portal.cleared ? ', cleared' : ''}.{' '}
        <span class="fe-muted">
          {own
            ? spent || portal.cleared
              ? 'Activating a new map replaces it.'
              : 'Click the portal to enter. Activating a new map closes it once nobody is inside.'
            : spent
              ? 'No portals are left in it.'
              : 'Click the portal to enter; each entry uses one.'}
        </span>
      </span>
    </div>
  );
}

export function MapDevicePanel() {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const derived = useUi((s) => s.derived);
  const own = useUi((s) => s.isOwnHideout);
  const zone = useUi((s) => s.zone);
  const owner = useUi((s) => s.hud?.zoneOwnerName ?? '');
  const portal = useUi((s) => s.hud?.portal ?? null);
  const zoneIsOwn = useUi((s) => s.hud?.zoneIsOwn ?? true);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [areaId, selectArea] = useState<AtlasAreaId>(ch?.atlas?.completed.at(-1) ?? ATLAS_START);
  const [showAtlas, setShowAtlas] = useState(false);
  const area = findAtlasArea(areaId)!;
  const map = ch?.mapDevice ?? null;
  const stashed = ch?.mapStash?.length ?? 0;
  // An empty device with maps in the stash: the picker is the way in, so it gets the room.
  const picking = !map && stashed > 0;

  const readout = useMemo(() => {
    if (!ch || !map) return null;
    const effective = { ...map, baseId: area.baseId };
    const desc = safe(() => store.rules.describeItem(effective, ch), null);
    const summary = safe(() => store.rules.mapSummary(ch, effective), []);
    // openMap is pure: preview the run setup to compute this player's personal luck exactly.
    const preview = safe(() => store.rules.openMap(ch, areaId), null);
    const luck = preview && preview.ok ? safe(() => store.rules.lootLuck(preview.value.setup, ch), null) : null;
    const mapLuck = preview && preview.ok ? { q: preview.value.setup.itemQuantity, r: preview.value.setup.itemRarity } : null;
    return { desc, summary, luck, mapLuck, error: preview && !preview.ok ? preview.error : null };
  }, [ch, map, store, areaId]);

  if (!ch) return null;
  const disabled = !own || zone !== 'hideout';
  const ownPortal = portal && zoneIsOwn ? portal : null;
  const hostPortal = portal && !zoneIsOwn && zone === 'hideout' ? portal : null;
  // Gear share of the personal luck: the character sheet's % increased from gear (DerivedStats).
  const gear = derived ? { q: 100 + derived.itemQuantity, r: 100 + derived.itemRarity } : null;

  const activate = (): void => {
    store.actions.uiSound('open');
    store.actions.activateMapDevice(areaId);
  };
  const confirmActivate = (): void => {
    const next = area.name;
    if (ownPortal && ownPortal.remaining > 0 && !ownPortal.cleared) {
      local.dialog.set({
        title: 'Open a new map',
        body: `Open ${next}? Your ${ownPortal.mapName} portal (${ownPortal.remaining} left) closes once nobody is inside.`,
        confirmLabel: 'Activate',
        onConfirm: activate,
      });
      return;
    }
    activate();
  };

  return (
    <PanelShell panel="mapDevice" title={showAtlas ? 'Atlas' : 'Map Device'} class={cx('fe-device', showAtlas && 'fe-device--atlas')}>
      {showAtlas && !disabled ? <AtlasView progress={ch.atlas ?? newAtlas()} selected={areaId} tier={map?.tier ?? null}
        onBack={() => setShowAtlas(false)} onSelect={(id) => { selectArea(id); setShowAtlas(false); }} /> : disabled ? (
        <div class="fe-device__locked">
          <div
            class={cx(
              'fe-device__circle',
              hostPortal && hostPortal.remaining > 0 ? 'fe-device__circle--charged' : 'fe-device__circle--cold',
            )}
          >
            <span class="fe-device__socket" aria-hidden="true" />
          </div>
          {hostPortal && <PortalNote portal={hostPortal} own={false} />}
          <p class="fe-device__locked-text">
            {zone === 'hideout'
              ? `This is ${possessive(owner)} device. Only its owner can open maps here${hostPortal ? '' : '; no portal is open right now'}.`
              : 'The map device can only be used in your own hideout.'}
          </p>
          {zone === 'hideout' && (
            <Button
              onClick={() => {
                store.actions.goHome();
                store.actions.closePanel('mapDevice');
              }}
            >
              Go to your hideout
            </Button>
          )}
        </div>
      ) : (
        <>
          <button class="fe-device__destination" onClick={() => setShowAtlas(true)}>
            <span class="ui-type-caption">Atlas destination · up to Tier {atlasTierCeiling(area)}</span>
            <strong class="ui-type-body">{area.name}</strong>
            <span class="ui-type-caption">Choose area →</span>
          </button>
          <div class={cx('fe-device__scroll', !picking && 'fe-scrollfade', picking && 'fe-device__scroll--picking')}>
            <p class="fe-panel__note ui-type-caption">Your map supplies tier, quality and mods. The area supplies enemies and rewards.</p>
            <div class={cx('fe-device__circle', map && 'fe-device__circle--charged', picking && 'fe-device__circle--compact')}>
              <MapDeviceSlotView disabled={false} />
            </div>
            {!map && !picking && (
              <p class="fe-device__empty">
                Drag a map onto the device, or Ctrl-click one in your inventory. Activating it opens {PORTALS_PER_MAP} portals here; every
                entry, by anyone in your party, uses one.
              </p>
            )}
            {map && readout?.desc && (
              <div class="fe-device__readout">
                <div class={cx('fe-device__mapname', `fe-tone-${readout.desc.tone}`)}>{readout.desc.title}</div>
                <div class="fe-device__maptier">{readout.desc.headerLines.join(' · ')}</div>
                {readout.desc.affixes.length > 0 && (
                  <ul class="fe-device__mods">
                    {readout.desc.affixes.map((l, i) => (
                      <li
                        key={i}
                        class={cx(
                          l.negative ? 'fe-device__mod--danger' : 'fe-device__mod--reward',
                          l.kind === 'corrupted' && 'fe-device__mod--corrupt',
                        )}
                      >
                        {l.text}
                      </li>
                    ))}
                  </ul>
                )}
                {readout.luck && (
                  <div class="fe-device__luck">
                    <div class="fe-device__luck-cell">
                      <span class="fe-device__luck-label">Your item quantity</span>
                      <span class="fe-device__luck-value">{formatLuck(readout.luck.itemQuantity)}</span>
                      {readout.mapLuck && (
                        <span class="fe-device__luck-src">
                          map {formatLuck(readout.mapLuck.q)}
                          {gear && `, your gear ${formatLuck(gear.q)}`}
                        </span>
                      )}
                    </div>
                    <div class="fe-device__luck-cell">
                      <span class="fe-device__luck-label">Your item rarity</span>
                      <span class="fe-device__luck-value">{formatLuck(readout.luck.itemRarity)}</span>
                      {readout.mapLuck && (
                        <span class="fe-device__luck-src">
                          map {formatLuck(readout.mapLuck.r)}
                          {gear && `, your gear ${formatLuck(gear.r)}`}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <div class="fe-device__summary">
                  {readout.summary.map((l) => {
                    const isOpen = openLine === l.label;
                    return (
                      <div key={l.label} class={cx('fe-sheet__line', isOpen && 'fe-sheet__line--open')}>
                        <button
                          class="fe-sheet__row"
                          aria-expanded={isOpen}
                          disabled={!l.breakdown.length}
                          onClick={() => setOpenLine(isOpen ? null : l.label)}
                        >
                          <span class="fe-sheet__chev" />
                          <span class="fe-sheet__label">{l.label}</span>
                          <span class="fe-sheet__dots" />
                          <span class="fe-sheet__value">{l.value}</span>
                        </button>
                        {isOpen && (
                          <ul class="fe-sheet__breakdown">
                            {l.breakdown.map((b, i) => (
                              <li key={i}>{b}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {stashed > 0 && (
              <section class={cx('fe-device__stash', picking && 'fe-device__stash--grow')} aria-label="Map Stash">
                <div class="fe-section-title">
                  From your Map Stash
                  <span class="fe-device__stash-hint">
                    {map ? 'Click a map to swap it in' : `Click a map to load it · opens ${PORTALS_PER_MAP} portals`}
                  </span>
                </div>
                <MapStashView mode="device" />
              </section>
            )}
          </div>
          {/* Outside the scroll area: the open portal is what Activate would replace, so it stays in view. */}
          {ownPortal && <PortalNote portal={ownPortal} own />}
          <div class="fe-device__actions">
            {readout?.error && <span class="fe-atlas__error ui-type-secondary" role="status">{readout.error}</span>}
            <Button variant="ember" size="large" class="fe-device__activate" disabled={!map || !!readout?.error} onClick={confirmActivate}>
              Activate
            </Button>
            <span class="fe-device__cost ui-type-caption">
              {map ? `Consumes the map${area.sealed ? ' and one Reliquary Key' : ''}; opens ${PORTALS_PER_MAP} portals` : 'Place a map to activate'}
            </span>
          </div>
        </>
      )}
    </PanelShell>
  );
}
