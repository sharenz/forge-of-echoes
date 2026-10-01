// Item tooltip cards built from rules.describeItem. Alt reveals affix names, tiers, roll ranges and the item's
// crafting history, and (for gear that is not equipped) side-by-side cards of what it would replace. A bench-crafted
// affix carries the anvil glyph and a "Crafted" caption in every tooltip.
import { Fragment, type ComponentChildren } from 'preact';
import type { EquipSlot } from '../../contracts/content';
import type { CharacterSave, Item, ItemDescription, TooltipLine } from '../../contracts/items';
import type { UiStore } from '../../contracts/ui';
import { PixelIcon, cx } from '../components/common';
import { SLOT_LABELS } from '../lib/content';
import { safe } from './hooks';

export interface CraftPreviewInfo {
  currencyName: string;
  iconId: string;
  lines: string[];
  error: string | null;
}

export interface CompareInfo {
  slot: EquipSlot;
  lines: { label: string; from: string; to: string; delta: number }[];
}

/** The Alt caption above a mod line: kind, affix name, tier and tags ("Prefix · “Blazing” · Tier 4 · Fire"). */
export function kindCaption(line: TooltipLine): string | null {
  const parts: string[] = [];
  if (line.kind === 'prefix') parts.push(line.crafted ? 'Crafted prefix' : 'Prefix');
  else if (line.kind === 'suffix') parts.push(line.crafted ? 'Crafted suffix' : 'Suffix');
  else if (line.kind === 'implicit') parts.push('Implicit');
  else if (line.kind === 'corrupted') parts.push('Corrupted');
  else if (line.kind === 'unique') parts.push('Unique');
  else if (line.kind === 'scar') parts.push('Scar');
  if (line.affixName) parts.push(`“${line.affixName}”`);
  if (line.tier !== undefined) parts.push(`Tier ${line.tier}`);
  if (line.tags?.length) parts.push(line.tags.join(', '));
  return parts.length > 1 || (line.kind === 'mapMod' && parts.length > 0) || line.tier !== undefined ? parts.join(' · ') : null;
}

/** Map mods describe one mod over several lines (danger, then reward): caption only the first of each group. */
function startsGroup(lines: readonly TooltipLine[], i: number): boolean {
  if (i === 0) return true;
  const a = lines[i - 1];
  const b = lines[i];
  return !(b.kind === 'mapMod' && a.kind === 'mapMod' && !!b.affixName && a.affixName === b.affixName);
}

function Line({ line, alt, caption: showCaption = true }: { line: TooltipLine; alt: boolean; caption?: boolean }) {
  const caption = alt && showCaption ? kindCaption(line) : null;
  return (
    <div
      class={cx(
        'fe-tt__line',
        `fe-tt__line--${line.kind}`,
        line.negative && 'fe-tt__line--neg',
        line.sealed && 'fe-tt__line--sealed',
        line.fractured && 'fe-tt__line--fractured',
        line.crafted && 'fe-tt__line--crafted',
      )}
    >
      {caption && <div class="fe-tt__cap">{caption}</div>}
      <div class="fe-tt__text">
        {line.crafted && <AnvilGlyph />}
        {line.sealed && <PixelIcon id="icon/ui/seal" class="fe-tt__glyph" width={16} height={16} />}
        {line.fractured && <PixelIcon id="icon/ui/fracture" class="fe-tt__glyph" width={16} height={16} />}
        <span>{line.text}</span>
        {alt && line.range && <span class="fe-tt__range">{line.range}</span>}
      </div>
      {(line.sealed || line.fractured) && (
        <div class="fe-tt__cap fe-tt__cap--state">{line.sealed ? 'Sealed for the next craft' : 'Fractured: immune to crafting'}</div>
      )}
      {line.crafted && !line.sealed && !line.fractured && (
        <div class="fe-tt__cap fe-tt__cap--crafted">Crafted at the bench</div>
      )}
    </div>
  );
}

/** The bench-crafted marker: a small bronze anvil (CSS silhouette; there is no pixel icon for it). */
export function AnvilGlyph({ class: klass }: { class?: string }) {
  return <i class={cx('fe-anvil', klass)} aria-label="Crafted" role="img" />;
}

function Stability({ current, max }: { current: number; max: number }) {
  const pips = Math.max(0, Math.min(16, max));
  const finished = current <= 0;
  return (
    <div class={cx('fe-tt__stab', finished && 'fe-tt__stab--finished')}>
      <PixelIcon id="icon/ui/stability" class="fe-tt__glyph" width={16} height={16} />
      <span class="fe-tt__stab-label">{finished ? 'Finished' : 'Stability'}</span>
      <span class="fe-tt__pips">
        {Array.from({ length: pips }, (_, i) => (
          <i key={i} class={cx('fe-tt__pip', i < current && 'fe-tt__pip--on', i < current && current <= 2 && 'fe-tt__pip--low')} />
        ))}
      </span>
      <span class="fe-tt__stab-val">
        {current}/{max}
      </span>
    </div>
  );
}

function Sep() {
  return <div class="fe-tt__sep" />;
}

export function ItemCard({
  desc,
  alt,
  label,
  craft,
  footer,
}: {
  desc: ItemDescription;
  alt: boolean;
  label?: string;
  craft?: CraftPreviewInfo | null;
  footer?: ComponentChildren;
}) {
  const hasMods = desc.implicits.length + desc.affixes.length + desc.scars.length > 0;
  const blocks: ComponentChildren[] = [];
  if (desc.properties.length || desc.requirements) {
    blocks.push(
      <div class="fe-tt__block" key="props">
        {desc.properties.map((p) => (
          <div class="fe-tt__prop" key={p.label}>
            <span class="fe-tt__prop-label">{p.label}: </span>
            <span class="fe-tt__prop-value">{p.value}</span>
          </div>
        ))}
        {desc.requirements && (
          <div class={cx('fe-tt__req', /you are/.test(desc.requirements) && 'fe-tt__req--unmet')}>{desc.requirements}</div>
        )}
      </div>,
    );
  }
  if (desc.implicits.length) {
    blocks.push(
      <div class="fe-tt__block" key="impl">
        {desc.implicits.map((l, i) => (
          <Line key={i} line={l} alt={alt} />
        ))}
      </div>,
    );
  }
  if (desc.affixes.length) {
    blocks.push(
      <div class="fe-tt__block" key="affix">
        {desc.affixes.map((l, i) => (
          <Line key={i} line={l} alt={alt} caption={startsGroup(desc.affixes, i)} />
        ))}
      </div>,
    );
  }
  if (desc.scars.length) {
    blocks.push(
      <div class="fe-tt__block" key="scars">
        {desc.scars.map((l, i) => (
          <Line key={i} line={{ ...l, negative: true }} alt={alt} />
        ))}
      </div>,
    );
  }
  if (desc.stability || desc.corrupted) {
    blocks.push(
      <div class="fe-tt__block" key="stab">
        {desc.stability && <Stability current={desc.stability.current} max={desc.stability.max} />}
        {desc.corrupted && <div class="fe-tt__corrupted">Corrupted</div>}
      </div>,
    );
  }
  if (desc.description || desc.flavor) {
    blocks.push(
      <div class="fe-tt__block" key="desc">
        {desc.description && <div class="fe-tt__desc">{desc.description}</div>}
        {desc.flavor && <div class="fe-tt__flavor">{desc.flavor}</div>}
      </div>,
    );
  }
  if (alt && desc.history?.length) {
    blocks.push(
      <div class="fe-tt__block fe-tt__history" key="hist">
        <div class="fe-tt__cap">Forge history</div>
        {desc.history.map((h, i) => (
          <div class="fe-tt__hist" key={i}>
            {h}
          </div>
        ))}
      </div>,
    );
  }

  return (
    <div class={cx('fe-tt', `fe-tt--${desc.tone}`)}>
      {label && <div class="fe-tt__label">{label}</div>}
      {craft && (
        <div class={cx('fe-tt__craft', craft.error && 'fe-tt__craft--bad')}>
          <div class="fe-tt__craft-head">
            <PixelIcon id={craft.iconId} width={24} height={24} />
            <span>{craft.error ? `${craft.currencyName} cannot be used here` : `${craft.currencyName} will`}</span>
          </div>
          {craft.error ? (
            <div class="fe-tt__craft-line">{craft.error}</div>
          ) : (
            craft.lines.map((l, i) => (
              <div class="fe-tt__craft-line" key={i}>
                {l}
              </div>
            ))
          )}
          {!craft.error && <div class="fe-tt__craft-cta">Left-click to apply, Shift-click to keep it armed</div>}
        </div>
      )}
      <div class="fe-tt__header">
        <div class="fe-tt__title">{desc.title}</div>
        {desc.subtitle && <div class="fe-tt__subtitle">{desc.subtitle}</div>}
      </div>
      <div class="fe-tt__body">
        <div class="fe-tt__meta">{[desc.classLabel, ...desc.headerLines].join(' · ')}</div>
        {blocks.map((b, i) => (
          <Fragment key={i}>
            <Sep />
            {b}
          </Fragment>
        ))}
        {desc.hint && <div class="fe-tt__hint">{desc.hint}</div>}
        {!alt && hasMods && desc.tone !== 'map' && <div class="fe-tt__alt">Hold Alt for tiers, ranges and history</div>}
        {!alt && desc.tone === 'map' && hasMods && <div class="fe-tt__alt">Hold Alt for mod details</div>}
        {footer}
      </div>
    </div>
  );
}

/** Alt comparison: what changes if the hovered item replaces each equipped item it could go into. */
export function CompareCard({ compare, names }: { compare: CompareInfo[]; names: Partial<Record<EquipSlot, string>> }) {
  return (
    <div class="fe-tt fe-tt--compare">
      <div class="fe-tt__plain-title">If you equip it</div>
      {compare.map((c) => (
        <div class="fe-tt__cmp" key={c.slot}>
          <div class="fe-tt__cap">
            {SLOT_LABELS[c.slot]}
            {names[c.slot] ? `, replacing ${names[c.slot]}` : ', empty slot'}
          </div>
          {c.lines.length === 0 && <div class="fe-tt__cmp-line fe-muted">No stat changes</div>}
          {c.lines.map((l) => (
            <div class={cx('fe-tt__cmp-line', l.delta > 0 ? 'fe-good' : l.delta < 0 ? 'fe-bad' : 'fe-muted')} key={l.label}>
              <span class="fe-tt__cmp-label">{l.label}</span>
              <span class="fe-tt__cmp-vals">
                {l.from}
                <i class="fe-arrow" />
                {l.to}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Alt comparison cards (what the item would replace) for gear that is not equipped. */
function compareCards(store: UiStore, ch: CharacterSave, item: Item, alt: boolean): ComponentChildren[] {
  const compare: CompareInfo[] = safe(() => store.rules.compareWithEquipped(ch, item), []);
  const equipped: { slot: EquipSlot; desc: ItemDescription }[] = [];
  const names: Partial<Record<EquipSlot, string>> = {};
  for (const c of compare) {
    const eq = ch.equipment[c.slot];
    const d = eq ? safe(() => store.rules.describeItem(eq, ch), null) : null;
    if (eq && d) {
      equipped.push({ slot: c.slot, desc: d });
      names[c.slot] = d.title;
    }
  }
  const out: ComponentChildren[] = [];
  if (compare.length > 0) out.push(<CompareCard key="cmp" compare={compare} names={names} />);
  for (const e of equipped) out.push(<ItemCard key={e.slot} desc={e.desc} alt={alt} label={`Equipped \u00b7 ${SLOT_LABELS[e.slot]}`} />);
  return out;
}

/** The full hover tooltip for an owned item: crafting preview, the card, and with Alt the comparison and equipped cards. */
export function OwnedItemTooltip({
  store,
  ch,
  uid,
  alt,
  armed,
}: {
  store: UiStore;
  ch: CharacterSave;
  uid: string;
  alt: boolean;
  armed: { uid: string; currencyId: string } | null;
}) {
  const found = safe(() => store.rules.findItem(ch, uid), null);
  if (!found) return null;
  const { item, location } = found;
  const desc = safe(() => store.rules.describeItem(item, ch), null);
  if (!desc) return null;

  let craft: CraftPreviewInfo | null = null;
  if (armed && armed.uid !== uid) {
    const info = store.rules.content.currencies[armed.currencyId as keyof typeof store.rules.content.currencies];
    const error = safe(() => store.rules.craftingTargetError(ch, armed.uid, uid), 'This item cannot be crafted.');
    craft = {
      currencyName: info?.name ?? 'Currency',
      iconId: `icon/currency/${armed.currencyId}`,
      error,
      lines: error ? [] : safe(() => store.rules.craftPreview(ch, armed.uid, uid), []),
    };
  }

  const compareMode = alt && item.kind === 'equipment' && location.kind !== 'equipment' && !armed;
  return (
    <div class="fe-tt-row">
      {compareMode && compareCards(store, ch, item, alt)}
      <ItemCard desc={desc} alt={alt} craft={craft} />
    </div>
  );
}

/** A detached item (merchant preview, a trade partner's offer); `compare` adds the Alt comparison with your gear. */
export function DetachedItemTooltip({
  store,
  ch,
  item,
  alt,
  note,
  label,
  compare,
}: {
  store: UiStore;
  ch: CharacterSave;
  item: Item;
  alt: boolean;
  note?: string;
  label?: string;
  compare?: boolean;
}) {
  const desc = safe(() => store.rules.describeItem(item, ch), null);
  if (!desc) return null;
  const compareMode = !!compare && alt && item.kind === 'equipment';
  return (
    <div class="fe-tt-row">
      {compareMode && compareCards(store, ch, item, alt)}
      <ItemCard desc={desc} alt={alt} label={label} footer={note ? <div class="fe-tt__hint">{note}</div> : undefined} />
    </div>
  );
}
