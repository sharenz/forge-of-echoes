// The command deck: life globe (with ward), flask belt, skill bar, focus globe and the experience bar.
// Everything here reads hud slices so the ~15 Hz updates only touch what changed.
import type { JSX } from 'preact';
import { BELT_SLOTS, LOADOUT_SLOTS } from '../../contracts/items';
import type { HudFlask, HudSlot, HudState, UiState } from '../../contracts/ui';
import { useEffect, useRef, useState } from 'preact/hooks';
import { mapTreeFreePoints } from '../../game/progression/map-tree';
import { gainedKinds, pointEntries, totalPoints, type PointEntry, type PointKind, type PointsInput } from '../lib/points';
import { useMotion } from '../atlas/motion';
import { EMPTY_FOCUS, LOW_LIFE } from '../lib/globe-fx';
import { GlobeCanvas } from '../lib/globe-render';
import { PixelIcon, cx } from '../components/common';
import { useLocal } from '../local';
import { counterplay } from '../lib/debuffs';
import { allowSkillDrop, beginSkillDrag, droppedSkill } from '../lib/loadout';
import { safe } from '../items/hooks';
import { formatCooldown, formatInt, fraction } from '../lib/format';
import { gt } from '../../data/guide/strings';
import { shallowEqual, useStore, useUi } from '../store';

function Globe({ kind }: { kind: 'life' | 'focus' }) {
  const local = useLocal();
  const { calm } = useMotion();
  const v = useUi(
    (s) =>
      s.hud
        ? kind === 'life'
          ? { cur: s.hud.life, max: s.hud.maxLife, ward: s.hud.wardFraction }
          : { cur: s.hud.focus, max: s.hud.maxFocus, ward: 0 }
        : { cur: 0, max: 0, ward: 0 },
    shallowEqual,
  );
  const debuffs = useUi((s) => s.hud?.debuffs, debuffsEq);
  const fill = fraction(v.cur, v.max);
  const low = kind === 'life' && fill < LOW_LIFE && v.max > 0 && v.cur > 0;
  const empty = kind === 'focus' && v.max > 0 && fill <= EMPTY_FOCUS;
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<GlobeCanvas | null>(null);

  // One painter per globe: sized from the CSS box (the height tiers change --globe), paused while the tab is hidden.
  useEffect(() => {
    const el = canvas.current;
    const host = root.current;
    if (!el || !host) return;
    const g = new GlobeCanvas(el, kind, (glow) => host.style.setProperty('--glow', glow.toFixed(2)));
    engine.current = g;
    g.resize(host.clientWidth || 108);
    g.setInput(fillRef.current, debuffsRef.current, calmRef.current);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { g.resize(host.clientWidth || 108); g.wake(); }) : null;
    ro?.observe(host);
    const vis = (): void => (document.hidden ? g.stop() : g.wake());
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      ro?.disconnect();
      g.stop();
      engine.current = null;
    };
  }, [kind]);
  const fillRef = useRef(fill);
  const debuffsRef = useRef(debuffs);
  const calmRef = useRef(calm);
  fillRef.current = fill;
  debuffsRef.current = debuffs;
  calmRef.current = calm;
  useEffect(() => engine.current?.setInput(fill, debuffs, calm), [fill, debuffs, calm]);

  const label = kind === 'life' ? 'Life' : 'Focus';
  return (
    <div
      ref={root}
      class={cx('fe-globe', `fe-globe--${kind}`, low && 'fe-globe--low', empty && 'fe-globe--empty', v.ward > 0 && 'fe-globe--warded', calm && 'fe-globe--calm')}
      style={{ '--fill': `${(fill * 100).toFixed(1)}%`, '--ward': v.ward.toFixed(3) } as unknown as JSX.CSSProperties}
      role="img"
      aria-label={`${label} ${formatInt(v.cur)} of ${formatInt(v.max)}${low ? ', low' : empty ? ', empty' : ''}`}
      onPointerEnter={(e) =>
        local.showTooltip(
          {
            kind: 'text',
            title: label,
            lines: [
              `${formatInt(v.cur)} / ${formatInt(v.max)}`,
              gt(kind === 'life' ? 'deck.life' : 'deck.focus'),
              ...(v.ward > 0 ? [`Cinder Ward: ${Math.round(v.ward * 100)}% remaining`] : []),
            ],
          },
          e.currentTarget,
          'above',
        )
      }
      onPointerLeave={() => local.hideTooltip()}
    >
      <div class="fe-globe__rim" />
      <div class="fe-globe__glass">
        <canvas ref={canvas} class="fe-globe__canvas" width={36} height={36} aria-hidden="true" />
      </div>
      {kind === 'life' && <div class="fe-globe__ward" />}
      <div class="fe-globe__text">
        {formatInt(v.cur)}
        <span class="fe-globe__max">/{formatInt(v.max)}</span>
      </div>
    </div>
  );
}

function debuffsEq(a: HudState['debuffs'] | undefined, b: HudState['debuffs'] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((d, i) => d.id === b[i].id);
}

function SkillSlot({ index }: { index: number }) {
  const local = useLocal();
  const store = useStore();
  const slot = useUi((s) => s.hud?.slots[index] ?? null, slotEq);
  const auto = useUi((s) => s.hud?.slots[index]?.skillId === 'emberLance' && s.settings.autoAttack);
  // The skill that answers an active debuff (Rift Step breaks a root) glows while it lasts and is ready.
  const counter = useUi((s) => {
    const id = s.hud?.slots[index]?.skillId;
    return !!id && !!s.hud?.debuffs?.length && counterplay(s.hud.debuffs).skills.includes(id);
  });
  if (!slot) return null;
  const frac = slot.cooldownTotal > 0 ? fraction(slot.cooldown, slot.cooldownTotal) : 0;
  const cooling = slot.cooldown > 0.05 && (slot.maxCharges <= 1 || slot.charges === 0);
  const starved = !slot.usable && !cooling && !!slot.skillId;
  return (
    <div
      aria-label={`${slot.key}: ${slot.skillId ? store.rules.content.skills[slot.skillId].name : 'Empty slot'}`}
      draggable={!!slot.skillId}
      onDragStart={(e) => {
        local.hideTooltip();
        beginSkillDrag(e, slot.skillId);
      }}
      onDragOver={allowSkillDrop}
      onDrop={(e) => {
        const skill = droppedSkill(e);
        const character = store.get().character;
        if (!skill || !character) return;
        const result = safe(() => store.rules.setLoadoutSlot(character, index, skill), { ok: false as const, error: 'That skill cannot go there.' });
        if (!result.ok) {
          store.actions.uiSound('error');
          local.flashHint(result.error);
          return;
        }
        store.actions.setLoadoutSlot(index, skill);
        store.actions.uiSound('equip');
      }}
      class={cx(
        'fe-skill',
        !slot.skillId && 'fe-skill--empty',
        cooling && 'fe-skill--cooling',
        starved && 'fe-skill--starved',
        slot.skillId === 'emberLance' && 'fe-skill--basic',
        // Only a skill you can use right now says "use me"; on cooldown or short of Focus it keeps a quiet ring.
        counter && (cooling || !slot.usable ? 'fe-skill--counter-wait' : 'fe-skill--counter'),
      )}
      onPointerEnter={(e) => slot.skillId && local.showTooltip({ kind: 'skill', skillId: slot.skillId }, e.currentTarget, 'above')}
      onPointerLeave={() => local.hideTooltip()}
    >
      {slot.skillId ? (
        <PixelIcon id={`icon/skill/${slot.skillId}`} class="fe-skill__icon" width="var(--slot-icon)" height="var(--slot-icon)" />
      ) : (
        <span class="fe-skill__blank" />
      )}
      {slot.cooldown > 0.05 && <div class="fe-skill__cd" style={{ '--cd': frac.toFixed(3) } as unknown as JSX.CSSProperties} />}
      {cooling && <span class="fe-skill__cdtext">{formatCooldown(slot.cooldown)}</span>}
      {slot.maxCharges > 1 && <span class={cx('fe-skill__charges', slot.charges === 0 && 'fe-skill__charges--out')}>{slot.charges}</span>}
      <span class="fe-skill__key">{slot.key}</span>
      {auto && <span class="fe-skill__auto">Auto</span>}
    </div>
  );
}

function slotEq(a: HudSlot | null, b: HudSlot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.skillId === b.skillId &&
    a.usable === b.usable &&
    a.charges === b.charges &&
    a.maxCharges === b.maxCharges &&
    a.key === b.key &&
    Math.abs(a.cooldown - b.cooldown) < 0.05 &&
    a.cooldownTotal === b.cooldownTotal
  );
}

function flaskEq(a: HudFlask | null, b: HudFlask | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.flaskId === b.flaskId && a.count === b.count && a.key === b.key && Math.abs(a.active - b.active) < 0.02;
}

function FlaskSlot({ index }: { index: number }) {
  const store = useStore();
  const local = useLocal();
  const f = useUi((s) => s.hud?.flasks[index] ?? null, flaskEq);
  // A flask that removes an active debuff (Life: burning, bleeding; Focus: withered) glows while it has charges.
  const counter = useUi((s) => {
    const fl = s.hud?.flasks[index];
    return !!fl && fl.count > 0 && !!s.hud?.debuffs?.length && counterplay(s.hud.debuffs).flasks.includes(fl.resource);
  });
  if (!f) {
    return (
      <div class="fe-flask fe-flask--none">
        <span class="fe-flask__key">{index + 1}</span>
      </div>
    );
  }
  const info = store.rules.content.flasks[f.flaskId as keyof typeof store.rules.content.flasks];
  return (
    <div
      class={cx(
        'fe-flask',
        `fe-flask--${f.resource}`,
        f.active > 0 && 'fe-flask--active',
        f.count === 0 && 'fe-flask--dry',
        counter && 'fe-flask--counter',
      )}
      data-flask={index}
      aria-label={`${info?.name ?? 'Flask'}, key ${f.key}, ${f.count} ${f.count === 1 ? 'charge' : 'charges'}${f.count === 0 ? ', empty' : ''}`}
      onPointerEnter={(e) =>
        local.showTooltip(
          {
            kind: 'text',
            title: `${info?.name ?? 'Flask'} (${f.key})`,
            lines: [
              `${f.count} ${f.count === 1 ? 'charge' : 'charges'}`,
              ...(info ? [info.description] : []),
              ...(f.count === 0 ? [gt('deck.flaskEmpty'), gt('deck.flaskEmptyHome')] : [gt('deck.flaskReady', { key: f.key })]),
            ],
          },
          e.currentTarget,
          'above',
        )
      }
      onPointerLeave={() => local.hideTooltip()}
    >
      <div class="fe-flask__fill" style={{ height: `${(f.active * 100).toFixed(1)}%` }} />
      <PixelIcon id={`icon/flask/${f.flaskId}`} class="fe-flask__icon" width="var(--slot-icon)" height="var(--slot-icon)" />
      <span class="fe-flask__count">{f.count}</span>
      <span class="fe-flask__key">{f.key}</span>
    </div>
  );
}

/** What the HUD needs to know about unspent points; recomputed from the character (so it is right after a level-up, a spend, a reconnect and a character load). */
function pointsOf(s: UiState): PointsInput {
  const ch = s.character;
  if (!ch) return { attribute: 0, skill: 0, atlas: 0, inHideout: false };
  return {
    attribute: ch.unspentAttributePoints ?? 0,
    skill: ch.unspentSkillPoints ?? 0,
    atlas: mapTreeFreePoints(ch.atlas),
    inHideout: s.zone !== 'map',
  };
}

const POINT_TITLE: Record<PointKind, string> = { attribute: 'Attribute points', skill: 'Skill points', atlas: 'Atlas tree points' };

/** Badges on the plate for everything you can spend: they pulse, open the right panel and vanish at zero. */
function PointBadges() {
  const store = useStore();
  const local = useLocal();
  const { calm } = useMotion();
  const id = useUi((s) => s.character?.id ?? null);
  const pts = useUi(pointsOf, shallowEqual);
  const open = useUi((s) => s.openPanels, shallowEqual);
  const prev = useRef<{ id: string | null; pts: PointsInput } | null>(null);
  const [gain, setGain] = useState<{ kinds: PointKind[]; n: number } | null>(null);

  // A rise in a count after the first look (a level-up, an Atlas point earned) plays the flourish once.
  useEffect(() => {
    const before = prev.current && prev.current.id === id ? prev.current.pts : null;
    prev.current = { id, pts };
    const kinds = gainedKinds(before, pts);
    if (!kinds.length) return;
    setGain((g) => ({ kinds, n: (g?.n ?? 0) + 1 }));
    const t = setTimeout(() => setGain(null), 1900);
    return () => clearTimeout(t);
  }, [id, pts.attribute, pts.skill, pts.atlas]);

  const entries = pointEntries(pts);
  if (!entries.length) return null;
  const chip = (e: PointEntry) => (
    <button
      key={e.kind}
      type="button"
      class={cx('fe-pbadge__chip', `fe-pbadge__chip--${e.kind}`, gain?.kinds.includes(e.kind) && 'fe-pbadge__chip--gain', calm && 'fe-pbadge__chip--calm')}
      data-gain={gain?.kinds.includes(e.kind) ? gain.n : undefined}
      aria-label={`${e.label}. Opens the ${e.panel === 'character' ? 'Character' : e.panel === 'skills' ? 'Skills' : 'Atlas'} panel`}
      onPointerEnter={(ev) => local.showTooltip({ kind: 'text', title: POINT_TITLE[e.kind], lines: [e.label], tone: 'good' }, ev.currentTarget, 'above')}
      onPointerLeave={() => local.hideTooltip()}
      onClick={() => {
        local.hideTooltip();
        store.actions.uiSound(open.includes(e.panel) ? 'close' : 'open');
        store.actions.togglePanel(e.panel);
      }}
    >
      <span class="fe-pbadge__icon" aria-hidden="true" />
      <span class="fe-pbadge__count ui-type-caption">{e.count}</span>
      {e.key && <span class="fe-pbadge__key ui-type-caption" aria-hidden="true">{e.key}</span>}
      <span class="fe-pbadge__spark fe-pbadge__spark--a" aria-hidden="true" />
      <span class="fe-pbadge__spark fe-pbadge__spark--b" aria-hidden="true" />
      <span class="fe-pbadge__spark fe-pbadge__spark--c" aria-hidden="true" />
    </button>
  );
  return (
    <div class="fe-pbadge" role="group" aria-label="Points to spend">
      <div class="fe-pbadge__side fe-pbadge__side--l">{entries.filter((e) => e.kind === 'attribute').map(chip)}</div>
      <div class="fe-pbadge__gap" />
      <div class="fe-pbadge__side fe-pbadge__side--r">{entries.filter((e) => e.kind !== 'attribute').map(chip)}</div>
    </div>
  );
}

function XpBar() {
  const local = useLocal();
  const x = useUi((s) => (s.hud ? { level: s.hud.level, xp: s.hud.xp, next: s.hud.xpToNext } : null), shallowEqual);
  const spend = useUi((s) => totalPoints(pointsOf(s)) > 0);
  const { calm } = useMotion();
  if (!x) return null;
  const f = fraction(x.xp, x.next);
  return (
    <div
      class="fe-xp"
      onPointerEnter={(e) =>
        local.showTooltip(
          {
            kind: 'text',
            title: `Level ${x.level}`,
            lines: [`${formatInt(x.xp)} / ${formatInt(x.next)} experience (${Math.floor(f * 100)}%)`],
          },
          e.currentTarget,
          'above',
        )
      }
      onPointerLeave={() => local.hideTooltip()}
    >
      <div class="fe-xp__track">
        <div class="fe-xp__fill" style={{ width: `${(f * 100).toFixed(2)}%` }} />
        <div class="fe-xp__ticks" />
      </div>
      <div class="fe-xp__level">
        {x.level}
        {spend && <span class={cx('fe-xp__plus', calm && 'fe-xp__plus--calm')} aria-hidden="true">+</span>}
      </div>
    </div>
  );
}

export function CommandDeck() {
  const has = useUi((s) => !!s.hud);
  if (!has) return null;
  return (
    <div class="fe-deck fe-solid">
      <Globe kind="life" />
      <div class="fe-deck__plate">
        <PointBadges />
        <XpBar />
        <div class="fe-deck__row">
          <div class="fe-deck__flasks">
            {Array.from({ length: BELT_SLOTS }, (_, i) => (
              <FlaskSlot key={i} index={i} />
            ))}
          </div>
          <div class="fe-deck__sep" />
          <div class="fe-deck__skills">
            {Array.from({ length: LOADOUT_SLOTS }, (_, i) => (
              <SkillSlot key={i} index={i} />
            ))}
          </div>
        </div>
      </div>
      <Globe kind="focus" />
    </div>
  );
}
