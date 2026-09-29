// The debuff bar (GAME_SPEC §13): one icon per active debuff, centred just above the command deck. Each icon shows a
// radial sweep of the time already gone, the seconds left and its stacks; it pops when the debuff is (re)applied, and
// hard control (Frozen, Rooted) burns brighter. The tooltip says what it does and how to answer it; the deck slot that
// answers it (Rift Step for a root, the Life flask for burns and bleeds, the Focus flask for wither) glows meanwhile
// (see CommandDeck.tsx).
//
// The bar floats in the play field, right under the character, so it never takes the pointer while you fight: a
// click there reaches the world (an attack aimed south). It only becomes hoverable while you inspect: Alt held
// (like item details) or a side panel open.
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { PlayerDebuff } from '../../contracts/bestiary';
import { PixelIcon, cx } from '../components/common';
import { useLocal, type Local } from '../local';
import {
  DEBUFF_INFO,
  debuffElapsed,
  debuffEnding,
  debuffReapplied,
  debuffTimeText,
  debuffsEqual,
  sortDebuffs,
  type HudDebuff,
} from '../lib/debuffs';
import { visiblePanels } from '../lib/panels';
import { useUi } from '../store';

const EMPTY: HudDebuff[] = [];

/** Tooltip owner tag of the debuff bar: `debuff:<id>` (so the bar can move or close its own card). */
const TIP_PREFIX = 'debuff:';

/** The debuff whose card is showing, if the tooltip is the bar's. */
function tooltipDebuff(local: Local): string | null {
  const t = local.tooltip.get();
  return t && t.spec.kind === 'custom' && t.spec.owner?.startsWith(TIP_PREFIX) ? t.spec.owner.slice(TIP_PREFIX.length) : null;
}

function hideOwnTooltip(local: Local): void {
  if (tooltipDebuff(local) !== null) local.hideTooltip();
}

/**
 * Tooltip body: name, effect, duration / stacks and the counterplay. Reads the debuff live from the HUD, so stacks
 * and timer stay current while hovered; renders nothing once the debuff has run out.
 */
export function DebuffCard({ id }: { id: PlayerDebuff }) {
  const d = useUi((s) => s.hud?.debuffs?.find((x) => x.id === id) ?? null, sameCardDebuff);
  const info = DEBUFF_INFO[id];
  if (!d || !info) return null;
  const facts = [`Lasts ${d.duration.toFixed(1)} s`];
  if (info.maxStacks > 1) facts.push(`${d.stacks} of ${info.maxStacks} stacks`);
  return (
    <div class={cx('fe-tt fe-tt--plain fe-debufftip', `fe-debufftip--${info.tone}`)}>
      <div class="fe-debufftip__head">
        <PixelIcon id={`icon/debuff/${id}`} width={32} height={32} />
        <div>
          <div class="fe-debufftip__name">{info.name}</div>
          <div class="fe-debufftip__facts">{facts.join(' · ')}</div>
        </div>
      </div>
      <div class="fe-debufftip__effect">{info.effect}</div>
      <div class="fe-debufftip__counter">
        <span class="fe-debufftip__label">Counter</span>
        {info.counter}
      </div>
      <div class="fe-debufftip__note">Cinder Ward halves every debuff&rsquo;s duration.</div>
    </div>
  );
}

/** The card only changes with the stacks or a new application (the full duration), not with the ticking timer. */
function sameCardDebuff(a: HudDebuff | null, b: HudDebuff | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.stacks === b.stacks && a.duration === b.duration;
}

function DebuffIcon({ d, pops }: { d: HudDebuff; pops: number }) {
  const local = useLocal();
  const info = DEBUFF_INFO[d.id];
  const time = debuffTimeText(d.remaining);
  return (
    <div
      class={cx(
        'fe-debuff',
        `fe-debuff--${d.id}`,
        `fe-debuff--${info.tone}`,
        info.control && 'fe-debuff--control',
        debuffEnding(d) && 'fe-debuff--ending',
      )}
      style={{ '--elapsed': debuffElapsed(d.remaining, d.duration).toFixed(3) } as unknown as JSX.CSSProperties}
      data-debuff={d.id}
      aria-label={`${info.name}${d.stacks > 1 ? `, ${d.stacks} stacks` : ''}${time ? `, ${time} left` : ''}`}
      onPointerEnter={(e) =>
        local.showTooltip(
          { kind: 'custom', owner: `${TIP_PREFIX}${d.id}`, render: () => <DebuffCard id={d.id} /> },
          e.currentTarget,
          'above',
        )
      }
      onPointerLeave={() => hideOwnTooltip(local)}
    >
      <span class="fe-debuff__plate">
        {/* Re-mounted on every (re)application, so the pop animation plays again. */}
        <span key={pops} class="fe-debuff__pop">
          <PixelIcon id={`icon/debuff/${d.id}`} class="fe-debuff__icon" width="var(--debuff-icon)" height="var(--debuff-icon)" />
        </span>
        <span class="fe-debuff__sweep" />
        {d.stacks > 1 && <span class="fe-debuff__stacks">{d.stacks}</span>}
      </span>
      <span class="fe-debuff__time">{time}</span>
    </div>
  );
}

export function DebuffBar() {
  const local = useLocal();
  const list = useUi((s) => (s.hud && !s.hud.dead ? (s.hud.debuffs ?? EMPTY) : EMPTY), debuffsEqual);
  // Hoverable only while inspecting (Alt, or a side panel open); otherwise clicks go through to the world.
  const inspect = useUi((s) => {
    if (s.altHeld) return true;
    const vis = visiblePanels(s.openPanels);
    return !!vis.left || !!vis.right;
  });
  const bar = useRef<HTMLDivElement>(null);
  const prev = useRef(new Map<PlayerDebuff, HudDebuff>());
  const pops = useRef(new Map<PlayerDebuff, number>());
  const sorted = sortDebuffs(list);
  const ids = sorted.map((d) => d.id).join(',');
  // Count (re)applications between HUD updates; a debuff that ran out forgets its count.
  const seen = new Map<PlayerDebuff, HudDebuff>();
  for (const d of sorted) {
    if (debuffReapplied(prev.current.get(d.id), d)) pops.current.set(d.id, (pops.current.get(d.id) ?? 0) + 1);
    seen.set(d.id, d);
  }
  for (const id of [...pops.current.keys()]) if (!seen.has(id)) pops.current.delete(id);
  prev.current = seen;
  // Leaving inspect mode drops the card (the bar no longer sees the pointer leave).
  useEffect(() => {
    if (!inspect) hideOwnTooltip(local);
  }, [inspect, local]);
  // Debuffs coming and going shift the icons: the open card follows its icon, and goes when its debuff has run out.
  useLayoutEffect(() => {
    const id = tooltipDebuff(local);
    if (id === null) return;
    const el = bar.current?.querySelector(`[data-debuff="${id}"]`);
    const t = local.tooltip.get();
    if (!el || !t) local.hideTooltip();
    else local.showTooltip(t.spec, el, 'above');
  }, [ids, local]);
  useEffect(() => () => hideOwnTooltip(local), [local]);
  if (!sorted.length) return null;
  return (
    <div ref={bar} class={cx('fe-debuffs', inspect && 'fe-debuffs--inspect fe-solid')} role="group" aria-label="Debuffs">
      {sorted.map((d) => (
        <DebuffIcon key={d.id} d={d} pops={pops.current.get(d.id) ?? 0} />
      ))}
    </div>
  );
}
