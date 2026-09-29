// Top of the screen, laid out as one grid over the part of the screen no docked panel covers (see
// `.fe-hudarea` in hud.css):
//   left   party frames, party invites, trade requests and the open-trade chip
//   centre one column that stacks the crafting strip, the wave card, the compact zone chip, lieutenant and boss
//          bars, the Tell banner and the zone entry banner, so they can never overlap each other
//   right  map / hideout info with luck, map mods and portals
// When the free area gets narrow (a panel is docked on a small screen), a container query drops the right column
// and the compact zone chip in the centre stack takes over.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { HudAlly, HudRun, UiState } from '../../contracts/ui';
import { Bar, Button, PixelIcon, cx } from '../components/common';
import { CraftStrip } from '../items/Crafting';
import { safe } from '../items/hooks';
import { useLocal } from '../local';
import { BOSS_WAVE, LIEUTENANT_WAVE, MONSTER_NAMES, eliteDisplayName, monsterTitle, rosterFor } from '../lib/content';
import { DEBUFF_INFO, waveDebuffs } from '../lib/debuffs';
import { formatDuration, formatLuck, fraction, possessive } from '../lib/format';
import { visiblePanels } from '../lib/panels';
import { zoneLabel } from '../lib/zone';
import { shallowEqual, useStore, useUi } from '../store';

function allyEq(a: HudAlly[], b: HudAlly[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((x, i) => shallowEqual(x, b[i]));
}

export function PartyFrames() {
  const allies = useUi((s) => s.hud?.allies ?? [], allyEq);
  if (!allies.length) return null;
  return (
    <div class="fe-allies" aria-label="Allies">
      {allies.map((a) => (
        <div key={a.name} class={cx('fe-ally', a.dead && 'fe-ally--dead')}>
          <div class="fe-ally__lvl">{a.level}</div>
          <div class="fe-ally__main">
            <div class="fe-ally__name">
              {a.name}
              {a.dead && <span class="fe-ally__state">fallen</span>}
            </div>
            <Bar kind="life" value={a.dead ? 0 : fraction(a.life, a.maxLife)} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Party invites sit under the party frames: visible, but out of the combat area. */
export function Invites() {
  const store = useStore();
  const invites = useUi((s) => s.invites);
  if (!invites.length) return null;
  return (
    <div class="fe-invites">
      {invites.map((inv) => (
        <div key={inv.inviteId} class="fe-invite-card fe-solid" role="alertdialog" aria-label={`Party invite from ${inv.fromName}`}>
          <div class="fe-invite-card__sigil" />
          <div class="fe-invite-card__text">
            <b>{inv.fromName}</b> invites you to their party
          </div>
          <div class="fe-invite-card__actions">
            <Button size="small" variant="ember" onClick={() => store.actions.partyRespond(inv.inviteId, true)}>
              Join
            </Button>
            <Button size="small" variant="ghost" onClick={() => store.actions.partyRespond(inv.inviteId, false)}>
              Decline
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Incoming trade requests: accept opens the trade window for both players. */
export function TradeRequests() {
  const store = useStore();
  const requests = useUi((s) => s.tradeRequests);
  if (!requests.length) return null;
  return (
    <div class="fe-invites">
      {requests.map((r) => (
        <div key={r.requestId} class="fe-invite-card fe-invite-card--trade fe-solid" role="alertdialog" aria-label={`Trade request from ${r.fromName}`}>
          <div class="fe-invite-card__coins" aria-hidden="true" />
          <div class="fe-invite-card__text">
            <b>{r.fromName}</b> wants to trade with you
          </div>
          <div class="fe-invite-card__actions">
            <Button size="small" variant="ember" onClick={() => store.actions.tradeRespond(r.requestId, true)}>
              Trade
            </Button>
            <Button size="small" variant="ghost" onClick={() => store.actions.tradeRespond(r.requestId, false)}>
              Decline
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** An open trade whose window is hidden behind another panel: bring it back, or see that the partner accepted. */
function TradeChip() {
  const store = useStore();
  const t = useUi(
    (s) =>
      s.trade && visiblePanels(s.openPanels).left !== 'trade'
        ? { name: s.trade.partnerName, theyAccepted: s.trade.theyAccepted, n: s.trade.theirItems.length }
        : null,
    shallowEqual,
  );
  if (!t) return null;
  return (
    <button
      type="button"
      class={cx('fe-tradechip fe-solid', t.theyAccepted && 'fe-tradechip--accepted')}
      onClick={() => {
        store.actions.uiSound('open');
        store.actions.openPanel('trade');
      }}
    >
      <span class="fe-tradechip__glyph" aria-hidden="true" />
      <span class="fe-tradechip__text">
        Trade with <b>{t.name}</b>
        <span class="fe-tradechip__sub">
          {t.theyAccepted
            ? `${t.name} accepted`
            : t.n > 0
              ? `${t.name} offers ${t.n} ${t.n === 1 ? 'item' : 'items'}`
              : `${t.name} has offered nothing yet`}
        </span>
      </span>
      <span class="fe-tradechip__open">Open</span>
    </button>
  );
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

function BossBar({ boss }: { boss: NonNullable<HudRun['boss']> }) {
  const f = fraction(boss.life, boss.maxLife);
  const name = eliteDisplayName(boss.name);
  return (
    <div class="fe-boss" role="status" aria-label={`${name}, phase ${boss.phase}`}>
      <div class="fe-boss__name">
        <span class="fe-boss__skull" />
        {name}
        <span class="fe-boss__phase">Phase {ROMAN[boss.phase] ?? boss.phase}</span>
      </div>
      <div class="fe-boss__bar">
        <div class="fe-boss__fill" style={{ width: `${(f * 100).toFixed(2)}%` }} />
        <i class={cx('fe-boss__pip', boss.phase >= 2 && 'fe-boss__pip--past')} style={{ left: '66.667%' }} />
        <i class={cx('fe-boss__pip', boss.phase >= 3 && 'fe-boss__pip--past')} style={{ left: '33.333%' }} />
      </div>
    </div>
  );
}

function LieutenantBar({ lt }: { lt: NonNullable<HudRun['lieutenant']> }) {
  return (
    <div class="fe-lt">
      <div class="fe-lt__name">{eliteDisplayName(lt.name)}</div>
      <div class="fe-lt__bar">
        <div class="fe-lt__fill" style={{ width: `${(fraction(lt.life, lt.maxLife) * 100).toFixed(2)}%` }} />
      </div>
    </div>
  );
}

const runSel = (s: UiState) => s.hud?.run ?? null;

function WaveCard() {
  const run = useUi(runSel);
  if (!run) return null;
  const done = run.phase === 'cleared';
  const failed = run.phase === 'failed';
  return (
    <div class={cx('fe-wave', done && 'fe-wave--done', failed && 'fe-wave--failed')}>
      <div class="fe-wave__head">
        <span class="fe-wave__title">
          {done ? 'Map cleared' : failed ? 'Map lost' : `Wave ${Math.max(1, run.wave)} of ${run.waveCount}`}
        </span>
        <span class="fe-wave__time">{formatDuration(run.elapsed)}</span>
      </div>
      <div class="fe-wave__pips">
        {Array.from({ length: run.waveCount }, (_, i) => {
          const n = i + 1;
          const state = done || n < run.wave ? 'past' : n === run.wave ? 'now' : 'next';
          const special = n === BOSS_WAVE ? 'boss' : n === LIEUTENANT_WAVE ? 'lt' : n > BOSS_WAVE ? 'echo' : null;
          return <i key={n} class={cx('fe-wave__pip', `fe-wave__pip--${state}`, special && `fe-wave__pip--${special}`)} />;
        })}
      </div>
      {!done && !failed && (
        <div class="fe-wave__progress" title="Time until the next wave">
          <div class="fe-wave__progress-fill" style={{ width: `${(Math.min(1, Math.max(0, run.waveProgress)) * 100).toFixed(1)}%` }} />
        </div>
      )}
      <div class="fe-wave__meta">
        {done ? (
          'The return portal is open'
        ) : (
          <>
            <span>
              <b>{run.monstersAlive}</b> alive
            </span>
            <span>
              <b>{run.kills}</b> slain
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function RunBars() {
  const bars = useUi((s) => ({ lt: s.hud?.run?.lieutenant ?? null, boss: s.hud?.run?.boss ?? null }), shallowEqual);
  return (
    <>
      {bars.lt && <LieutenantBar lt={bars.lt} />}
      {bars.boss && <BossBar boss={bars.boss} />}
    </>
  );
}

/** "The Hollow Warden is coming", "Varkus, the Iron Champion, is coming". */
function announce(title: string, rest: string): string {
  return `${title}${title.includes(',') ? ',' : ''} ${rest}`;
}

function TellBanner() {
  const tell = useUi((s) => (s.hud?.run?.phase === 'tell' ? s.hud.run.tell : null));
  const baseId = useUi((s) => s.run?.map.baseId ?? null);
  if (!tell) return null;
  const names = tell.families.map((f) => MONSTER_NAMES[f]?.many ?? f);
  // Each map base has its own lieutenant and boss (GAME_SPEC §14).
  const roster = rosterFor(baseId, tell.families);
  const threats = waveDebuffs([
    ...tell.families,
    ...(tell.lieutenant ? [roster.lieutenant] : []),
    ...(tell.boss ? [roster.boss] : []),
  ]);
  return (
    <div class={cx('fe-tell', (tell.boss || tell.lieutenant) && 'fe-tell--danger')} role="alert">
      <div class="fe-tell__title">Wave {tell.wave} approaches</div>
      {names.length > 0 && <div class="fe-tell__families">{names.join(', ')}</div>}
      {tell.lieutenant && <div class="fe-tell__warn">{announce(monsterTitle(roster.lieutenant), 'leads this wave')}</div>}
      {tell.boss && <div class="fe-tell__warn">{announce(monsterTitle(roster.boss), 'is coming')}</div>}
      {threats.length > 0 && (
        <div class="fe-tell__brings">
          <span>Brings</span>
          {threats.map((d) => (
            <span key={d} class="fe-tell__debuff">
              <PixelIcon id={`icon/debuff/${d}`} width={16} height={16} />
              {DEBUFF_INFO[d].name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PortalPips({ remaining, total }: { remaining: number; total: number }) {
  return (
    <span class="fe-portals" aria-label={`${remaining} of ${total} portals left`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} class={cx('fe-portals__pip', i < remaining && 'fe-portals__pip--on')} />
      ))}
    </span>
  );
}

type ModTone = 'danger' | 'reward' | 'corrupt' | null;

/**
 * HudRun.modLines are plain strings; the run's map snapshot (state.run.map) described by the rules says which
 * lines are dangers and which are rewards. Lines the description does not know stay neutral.
 */
function useModLines(lines: string[]): { text: string; tone: ModTone }[] {
  const store = useStore();
  const map = useUi((s) => s.run?.map ?? null);
  const ch = useUi((s) => s.character);
  return useMemo(() => {
    const tones = new Map<string, ModTone>();
    if (map && ch) {
      const desc = safe(() => store.rules.describeItem(map, ch), null);
      for (const l of desc?.affixes ?? []) tones.set(l.text, l.kind === 'corrupted' ? 'corrupt' : l.negative ? 'danger' : 'reward');
    }
    return lines.map((text) => ({ text, tone: tones.get(text) ?? null }));
  }, [lines, map, ch, store]);
}

const zoneSel = (s: UiState) =>
  s.hud ? { zone: s.hud.zone, zoneOwnerName: s.hud.zoneOwnerName, zoneIsOwn: s.hud.zoneIsOwn, run: s.hud.run, portal: s.hud.portal } : null;

function modClass(tone: ModTone): string | false {
  return tone !== null && `fe-zoneinfo__mod--${tone}`;
}

/** The full top-right block (wide layouts). */
export function ZoneInfo() {
  const local = useLocal();
  const hud = useUi(zoneSel, shallowEqual);
  const mods = useModLines(hud?.run?.modLines ?? EMPTY);
  if (!hud) return null;
  const label = zoneLabel(hud);
  const run = hud.run;
  if (hud.zone === 'map' && run) {
    return (
      <div class="fe-zoneinfo fe-zoneinfo--map">
        <div class="fe-zoneinfo__title">{label.title}</div>
        {label.subtitle && <div class="fe-zoneinfo__sub">{label.subtitle}</div>}
        {run.monsterLevel !== null && <div class="fe-zoneinfo__sub">Monster level {run.monsterLevel}</div>}
        <div class="fe-zoneinfo__luck">
          <span
            class="fe-solid"
            onPointerEnter={(e) =>
              local.showTooltip(
                { kind: 'text', title: 'Your item quantity', lines: ['This map plus your own gear. More drops, same rarity.'] },
                e.currentTarget,
              )
            }
            onPointerLeave={() => local.hideTooltip()}
          >
            Quantity <b>{formatLuck(run.itemQuantity)}</b>
          </span>
          <span
            class="fe-solid"
            onPointerEnter={(e) =>
              local.showTooltip(
                { kind: 'text', title: 'Your item rarity', lines: ['This map plus your own gear. Better drops, same count.'] },
                e.currentTarget,
              )
            }
            onPointerLeave={() => local.hideTooltip()}
          >
            Rarity <b>{formatLuck(run.itemRarity)}</b>
          </span>
        </div>
        {mods.length > 0 && (
          <ul class="fe-zoneinfo__mods">
            {mods.map((m, i) => (
              <li key={i} class={cx(modClass(m.tone))}>
                {m.text}
              </li>
            ))}
          </ul>
        )}
        <div class={cx('fe-zoneinfo__portals', run.portalsRemaining === 0 && 'fe-zoneinfo__portals--spent')}>
          <PortalPips remaining={run.portalsRemaining} total={run.portalsTotal} />
          <span>
            {run.portalsRemaining}/{run.portalsTotal} portals left
          </span>
        </div>
      </div>
    );
  }
  const portal = hud.portal;
  return (
    <div class="fe-zoneinfo">
      <div class="fe-zoneinfo__title">{label.title}</div>
      {label.subtitle && <div class="fe-zoneinfo__sub">{label.subtitle}</div>}
      {portal && (
        <div class={cx('fe-portalcard', portal.remaining === 0 && 'fe-portalcard--spent')}>
          <div class="fe-portalcard__swirl" />
          <div class="fe-portalcard__text">
            <div class="fe-portalcard__map">
              {portal.mapName} T{portal.tier}
              {portal.cleared && <span class="fe-portalcard__cleared">cleared</span>}
            </div>
            <div class="fe-portalcard__count">
              <PortalPips remaining={portal.remaining} total={portal.total} />
              {portal.remaining}/{portal.total} portals
            </div>
            <div class="fe-portalcard__hint">
              {portal.remaining > 0
                ? `Click the portal to enter${hud.zoneIsOwn ? '' : ` ${possessive(portal.ownerName)} map`}. Each entry uses one.`
                : 'No portals left. Anyone inside can stay until they leave.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const EMPTY: string[] = [];

/**
 * One-line zone readout for narrow layouts (a docked panel covers the top-right corner): the map with its
 * portals, or the hideout with its open portal. Hover shows the details the full block would.
 */
function ZoneChip() {
  const local = useLocal();
  const hud = useUi(zoneSel, shallowEqual);
  const mods = useModLines(hud?.run?.modLines ?? EMPTY);
  if (!hud) return null;
  const label = zoneLabel(hud);
  const run = hud.zone === 'map' ? hud.run : null;
  const portal = hud.zone === 'hideout' ? hud.portal : null;

  const showDetails = (el: Element): void => {
    if (run) {
      local.showTooltip(
        {
          kind: 'custom',
          render: () => (
            <div class="fe-tt fe-tt--plain fe-zonetip">
              <div class="fe-tt__plain-title">
                {label.title}
                {label.subtitle && <span class="fe-zonetip__sub"> · {label.subtitle}</span>}
              </div>
              {run.monsterLevel !== null && <div class="fe-zonetip__sub">Monster level {run.monsterLevel}</div>}
              <div class="fe-zonetip__luck">
                Your quantity <b>{formatLuck(run.itemQuantity)}</b> · rarity <b>{formatLuck(run.itemRarity)}</b>
              </div>
              {mods.length > 0 && (
                <ul class="fe-zoneinfo__mods fe-zonetip__mods">
                  {mods.map((m, i) => (
                    <li key={i} class={cx(modClass(m.tone))}>
                      {m.text}
                    </li>
                  ))}
                </ul>
              )}
              <div class="fe-zonetip__portals">
                {run.portalsRemaining}/{run.portalsTotal} portals left
              </div>
            </div>
          ),
        },
        el,
        'side',
      );
    } else if (portal) {
      local.showTooltip(
        {
          kind: 'text',
          title: `${portal.mapName} T${portal.tier}`,
          lines: [
            `${portal.remaining}/${portal.total} portals left${portal.cleared ? ', cleared' : ''}`,
            portal.remaining > 0
              ? `Click the portal to enter${hud.zoneIsOwn ? '' : ` ${possessive(portal.ownerName)} map`}. Each entry uses one.`
              : 'No portals left. Anyone inside can stay until they leave.',
          ],
        },
        el,
        'side',
      );
    }
  };

  return (
    <div
      class={cx(
        'fe-zonechip',
        (run || portal) && 'fe-solid',
        (run?.portalsRemaining === 0 || portal?.remaining === 0) && 'fe-zonechip--spent',
      )}
      onPointerEnter={(e) => showDetails(e.currentTarget)}
      onPointerLeave={() => local.hideTooltip()}
    >
      {run ? (
        <>
          <span class="fe-zonechip__group">
            <span class="fe-zonechip__title">{label.title}</span>
            <span class="fe-zonechip__tier">T{run.tier}</span>
          </span>
          {run.monsterLevel !== null && <span class="fe-zonechip__tier">Monster level {run.monsterLevel}</span>}
          <span class="fe-zonechip__group">
            <PortalPips remaining={run.portalsRemaining} total={run.portalsTotal} />
            <span class="fe-zonechip__count">
              {run.portalsRemaining}/{run.portalsTotal}
            </span>
          </span>
        </>
      ) : portal ? (
        <>
          <span class="fe-zonechip__group">
            <span class="fe-zonechip__swirl" />
            <span class="fe-zonechip__title">{portal.mapName}</span>
            <span class="fe-zonechip__tier">T{portal.tier}</span>
          </span>
          <span class="fe-zonechip__group">
            <PortalPips remaining={portal.remaining} total={portal.total} />
            <span class="fe-zonechip__count">
              {portal.remaining}/{portal.total}
            </span>
          </span>
        </>
      ) : (
        <span class="fe-zonechip__title">{label.title}</span>
      )}
    </div>
  );
}

/** Big title when entering a zone; fades out on its own. Lives in the centre stack, under any Tell banner. */
export function ZoneBanner() {
  const hud = useUi(
    (s) =>
      s.hud
        ? {
            zone: s.hud.zone,
            zoneOwnerName: s.hud.zoneOwnerName,
            zoneIsOwn: s.hud.zoneIsOwn,
            run: s.hud.run ? { mapName: s.hud.run.mapName, tier: s.hud.run.tier } : null,
          }
        : null,
    (a, b) =>
      a && b
        ? a.zone === b.zone && a.zoneOwnerName === b.zoneOwnerName && a.run?.mapName === b.run?.mapName && a.run?.tier === b.run?.tier
        : a === b,
  );
  const label = hud ? zoneLabel(hud) : null;
  const [shown, setShown] = useState<{ key: string; title: string; subtitle: string | null; n: number } | null>(null);
  const last = useRef<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!label || label.key === last.current) return;
    last.current = label.key;
    seq.current += 1;
    setShown({ ...label, n: seq.current });
    const t = setTimeout(() => setShown(null), 3600);
    return () => clearTimeout(t);
  }, [label?.key]);
  if (!shown) return null;
  return (
    <div key={shown.n} class="fe-zonebanner" aria-live="polite">
      <div class="fe-zonebanner__rule" />
      <div class="fe-zonebanner__title">{shown.title}</div>
      {shown.subtitle && <div class="fe-zonebanner__sub">{shown.subtitle}</div>}
      <div class="fe-zonebanner__rule" />
    </div>
  );
}

/** The whole top HUD over the free (uncovered) area. */
export function TopHud() {
  return (
    <div class="fe-hudarea">
      <div class="fe-hudgrid">
        <div class="fe-leftcol">
          <PartyFrames />
          <Invites />
          <TradeRequests />
          <TradeChip />
        </div>
        <div class="fe-topstack">
          <CraftStrip />
          <WaveCard />
          <ZoneChip />
          <RunBars />
          <TellBanner />
          <ZoneBanner />
        </div>
        <ZoneInfo />
      </div>
    </div>
  );
}
