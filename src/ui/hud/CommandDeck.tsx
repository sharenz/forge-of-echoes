// The command deck: life globe (with ward), flask belt, skill bar, focus globe and the experience bar.
// Everything here reads hud slices so the ~15 Hz updates only touch what changed.
import type { JSX } from 'preact';
import { BELT_SLOTS, LOADOUT_SLOTS } from '../../contracts/items';
import type { HudFlask, HudSlot } from '../../contracts/ui';
import { PixelIcon, cx } from '../components/common';
import { useLocal } from '../local';
import { counterplay } from '../lib/debuffs';
import { allowSkillDrop, beginSkillDrag, droppedSkill } from '../lib/loadout';
import { safe } from '../items/hooks';
import { formatCooldown, formatInt, fraction } from '../lib/format';
import { shallowEqual, useStore, useUi } from '../store';

function Globe({ kind }: { kind: 'life' | 'focus' }) {
  const local = useLocal();
  const v = useUi(
    (s) =>
      s.hud
        ? kind === 'life'
          ? { cur: s.hud.life, max: s.hud.maxLife, ward: s.hud.wardFraction }
          : { cur: s.hud.focus, max: s.hud.maxFocus, ward: 0 }
        : { cur: 0, max: 0, ward: 0 },
    shallowEqual,
  );
  const fill = fraction(v.cur, v.max);
  const low = kind === 'life' && fill < 0.3 && v.max > 0;
  return (
    <div
      class={cx('fe-globe', `fe-globe--${kind}`, low && 'fe-globe--low', v.ward > 0 && 'fe-globe--warded')}
      style={{ '--fill': `${(fill * 100).toFixed(1)}%`, '--ward': v.ward.toFixed(3) } as unknown as JSX.CSSProperties}
      onPointerEnter={(e) =>
        local.showTooltip(
          {
            kind: 'text',
            title: kind === 'life' ? 'Life' : 'Focus',
            lines: [
              `${formatInt(v.cur)} / ${formatInt(v.max)}`,
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
        <div class="fe-globe__liquid" />
        <div class="fe-globe__void" />
        <div class="fe-globe__void fe-globe__void--b" />
        <div class="fe-globe__shine" />
      </div>
      {kind === 'life' && <div class="fe-globe__ward" />}
      <div class="fe-globe__text">
        {formatInt(v.cur)}
        <span class="fe-globe__max">/{formatInt(v.max)}</span>
      </div>
    </div>
  );
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
  return (
    <div
      class={cx(
        'fe-flask',
        `fe-flask--${f.resource}`,
        f.active > 0 && 'fe-flask--active',
        f.count === 0 && 'fe-flask--dry',
        counter && 'fe-flask--counter',
      )}
    >
      <div class="fe-flask__fill" style={{ height: `${(f.active * 100).toFixed(1)}%` }} />
      <PixelIcon id={`icon/flask/${f.flaskId}`} class="fe-flask__icon" width="var(--slot-icon)" height="var(--slot-icon)" />
      <span class="fe-flask__count">{f.count}</span>
      <span class="fe-flask__key">{f.key}</span>
    </div>
  );
}

function XpBar() {
  const local = useLocal();
  const x = useUi((s) => (s.hud ? { level: s.hud.level, xp: s.hud.xp, next: s.hud.xpToNext } : null), shallowEqual);
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
      <div class="fe-xp__level">{x.level}</div>
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
