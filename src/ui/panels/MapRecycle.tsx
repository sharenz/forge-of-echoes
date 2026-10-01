// Recycle (brief D 5.3), a Crafting Bench Scrap service for surplus maps: three maps of one tier become ONE Normal map of an area you
// choose (the area of one of the three or a chart neighbour), at quality min(20, mean + 2), for Scrap equal to the tier. Recycling never
// raises the tier. Inventory first: drag the maps from your backpack into the three recycle slots (they stay where they are until you
// press Recycle, which the server does atomically: Scrap, the three maps and the new one in a single step). The rules and the price
// come from rules.recycleQuote, the very function the server runs.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AtlasAreaId } from '../../contracts/atlas';
import { iconIdForCurrency } from '../../contracts/content';
import type { MapItem } from '../../contracts/items';
import { RECYCLE } from '../../data/items/bench';
import { findAtlasArea } from '../../data/progression/atlas';
import { recycleInputError } from '../../game/progression/map-services';
import { benchCurrency } from '../../game/items';
import { Button, PixelIcon, cx } from '../components/common';
import { safe } from '../items/hooks';
import { itemIconId } from '../lib/items';
import { useLocal } from '../local';
import { useSignal, useStore, useUi } from '../store';

const SLOTS = RECYCLE.inputs;

export function MapRecycle({ allowed }: { allowed: boolean }) {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const drag = useSignal(local.drag);
  const [uids, setUids] = useState<(string | null)[]>(() => Array(SLOTS).fill(null));
  const [area, setArea] = useState<AtlasAreaId | null>(null);
  const [busy, setBusy] = useState(false);

  /** The maps in the slots that still exist where a recycle can take them (a map moved into the device or traded away drops out). */
  const maps = useMemo(() => uids.map((uid) => {
    const f = ch && uid ? safe(() => store.rules.findItem(ch, uid), null) : null;
    return f && f.item.kind === 'map' && f.location.kind !== 'mapDevice' ? (f.item as MapItem) : null;
  }), [uids, ch, store]);
  useEffect(() => { setUids((cur) => (cur.some((u, i) => u && !maps[i]) ? cur.map((u, i) => (maps[i] ? u : null)) : cur)); }, [maps]);
  const filled = maps.filter((m): m is MapItem => !!m);
  const ready = filled.length === SLOTS;
  const quote = useMemo(() => (ch && ready ? safe(() => store.rules.recycleQuote(ch, filled.map((m) => m.uid)), null) : null), [ch, ready, filled.map((m) => m.uid).join()]);
  const targets = quote?.targets ?? [];
  const target = area && targets.includes(area) ? area : targets[0] ?? null;
  const finalQuote = useMemo(() => (ch && ready && target ? safe(() => store.rules.recycleQuote(ch, filled.map((m) => m.uid), target), null) : null), [ch, ready, target, filled.map((m) => m.uid).join()]);
  const scrap = ch ? benchCurrency(ch, 'scrap') : 0;

  // The slots accept maps from anywhere in the inventory, subject to the rules' own conditions.
  useEffect(() => {
    const refusal = (d: { uid: string; item: { kind: string }; from: { kind: string } }, at: number | null): string | null => {
      if (d.item.kind !== 'map') return 'Only maps can be recycled.';
      if (d.from.kind === 'mapDevice') return 'Take the map out of the Map Device first.';
      const m = d.item as unknown as MapItem;
      const bad = recycleInputError(m);
      if (bad) return bad;
      const others = maps.filter((x, i) => x && i !== at) as MapItem[];
      if (others.some((x) => x.uid === m.uid)) return 'That map is already in a slot.';
      if (others.length && others[0].tier !== m.tier) return `Recycling takes maps of one tier: these are Tier ${others[0].tier}.`;
      if (at === null && maps.every(Boolean)) return 'All three slots are full.';
      return null;
    };
    for (let i = 0; i < SLOTS; i++) {
      local.slots.set(`recycle:${i}`, {
        tag: 'Recycle this map',
        accepts: (d) => refusal(d, i),
        onDrop: (d) => setUids((cur) => cur.map((u, k) => (k === i ? d.uid : u === d.uid ? null : u))),
      });
    }
    return () => { for (let i = 0; i < SLOTS; i++) local.slots.delete(`recycle:${i}`); };
  }, [local, maps]);

  const give = async (): Promise<void> => {
    if (!ready || !target || busy) return;
    setBusy(true);
    store.actions.uiSound('click');
    const ok = await store.actions.recycleMaps(filled.map((m) => m.uid), target);
    setBusy(false);
    if (ok) { setUids(Array(SLOTS).fill(null)); setArea(null); }
  };
  const tier = filled[0]?.tier ?? null;
  const cantPay = !!finalQuote && scrap < finalQuote.scrap;
  const why = !allowed ? 'The bench works in any hideout. You cannot craft here.' : finalQuote?.error ?? quote?.error ?? null;
  return (
    <section class="fe-bench__section fe-recycle" aria-label="Recycle maps" data-recycle>
      <div class="fe-section-title">Recycle maps</div>
      <p class="ui-type-caption fe-recycle__intro" title={`Quality is the average plus ${RECYCLE.qualityBonus}, the price is the tier in Forge Scrap. Bounty, Charted and corrupted maps cannot be recycled.`}>
        Drag three maps of one tier from your backpack into the slots: one new Normal map of an area you choose, for Scrap equal to the tier.
      </p>
      <div class="fe-recycle__slots">
        {Array.from({ length: SLOTS }, (_, i) => {
          const m = maps[i];
          const area0 = m ? findAtlasArea(m.areaId) : null;
          const hovered = drag?.target?.slot === `recycle:${i}` ? (drag.target.valid ? 'ok' : 'bad') : null;
          const accepts = drag?.item.kind === 'map';
          return (
            <div key={i} class="fe-recycle__cell">
              <div class={cx('fe-device-slot fe-solid fe-recycle__slot', m && 'fe-device-slot--filled', accepts && 'fe-slot--accepts', hovered && `fe-slot--${hovered}`)} data-drop="slot" data-slot={`recycle:${i}`}
                aria-label={`Recycle slot ${i + 1}`} title={m ? `${area0?.name ?? 'Map'} Tier ${m.tier}` : `Recycle slot ${i + 1}: drag a map here`}
                onPointerEnter={(e) => { if (m && !local.drag.get()) local.showTooltip({ kind: 'item', uid: m.uid }, e.currentTarget); }} onPointerLeave={() => local.hideTooltip()}>
                {m ? <PixelIcon id={itemIconId(m)} width={32} height={32} /> : <span class="fe-device-slot__hint">Map<br />{i + 1}</span>}
              </div>
              {m && <button type="button" class="fe-scarab-remove ui-type-caption" aria-label={`Take map ${i + 1} out of the recycler`} onClick={() => setUids((cur) => cur.map((u, k) => (k === i ? null : u)))}>×</button>}
              <span class="ui-type-caption fe-recycle__cap">{m ? `T${m.tier} ${area0?.name ?? ''}` : ''}</span>
            </div>
          );
        })}
      </div>
      {ready && targets.length > 0 && (
        <div class="fe-recycle__targets" role="group" aria-label="New map's area">
          <span class="ui-type-caption fe-recycle__label">Becomes a map of</span>
          {targets.map((id) => {
            const a = findAtlasArea(id)!;
            return <button key={id} type="button" class="fe-stockchip ui-type-caption" aria-pressed={target === id} data-recycle-area={id} onClick={() => { store.actions.uiSound('click'); setArea(id); }}>{a.name}</button>;
          })}
        </div>
      )}
      <div class="fe-recycle__go">
        <span class="ui-type-secondary fe-recycle__result">
          {finalQuote && target ? `A Normal Tier ${finalQuote.tier} ${findAtlasArea(target)?.name} map, +${finalQuote.quality}% quality.` : 'Fill all three slots.'}
        </span>
        <span class={cx('fe-price', cantPay && 'fe-price--short')} title={`Forge Scrap (you carry ${scrap})`}>
          <PixelIcon id={iconIdForCurrency('scrap')} width={20} height={20} />{finalQuote?.scrap ?? tier ?? '–'}
        </span>
        <Button variant="ember" disabled={!ready || !target || !!why || busy} onClick={give} data-recycle-go>Recycle</Button>
      </div>
      {why && ready && <p class="fe-bench__note">{why}</p>}
    </section>
  );
}
