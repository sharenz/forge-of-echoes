// Inventory (docked right): paperdoll, flask belt and the 12x5 backpack.
import { useEffect, useMemo } from 'preact/hooks';
import { BELT_SLOTS } from '../../contracts/items';
import { EQUIP_SLOTS, iconIdForCurrency } from '../../contracts/content';
import { Keycap, PixelIcon } from '../components/common';
import { BeltSlotView, EquipSlotView, ItemGrid } from '../items/Containers';
import { PAPERDOLL_SIZE } from '../lib/content';
import { formatInt } from '../lib/format';
import { useStore, useUi } from '../store';
import { PanelShell } from './PanelShell';

const cells = (n: number): string => `calc(var(--cell) * ${n})`;

export function InventoryPanel() {
  const store = useStore();
  const ch = useUi((s) => s.character);
  const craftingAllowed = useUi((s) => s.craftingAllowed);

  // "New" badges last until the inventory is closed once.
  useEffect(
    () => () => {
      const c = store.get().character;
      if (!c) return;
      const anyNew = c.backpack.entries.some((e) => e.item.isNew) || c.stash.some((t) => t.grid.entries.some((e) => e.item.isNew));
      if (anyNew) store.actions.clearNewFlags();
    },
    [store],
  );

  const scrap = useMemo(() => {
    if (!ch) return 0;
    let n = 0;
    for (const e of ch.backpack.entries) if (e.item.kind === 'currency' && e.item.currencyId === 'scrap') n += e.item.count;
    return n;
  }, [ch]);

  if (!ch) return null;
  return (
    <PanelShell panel="inventory" title="Inventory" class="fe-inv">
      <div class="fe-inv__doll" style={{ width: cells(PAPERDOLL_SIZE.w), height: cells(PAPERDOLL_SIZE.h) }}>
        {EQUIP_SLOTS.map((slot) => (
          <EquipSlotView key={slot} slot={slot} />
        ))}
      </div>
      <div class="fe-inv__belt">
        {Array.from({ length: BELT_SLOTS }, (_, i) => (
          <BeltSlotView key={i} index={i} />
        ))}
      </div>
      <div class="fe-inv__pack">
        <ItemGrid grid={ch.backpack} kind="backpack" />
      </div>
      <div class="fe-inv__foot">
        <span class="fe-inv__wallet" title="Forge Scrap is also the merchant's coin">
          <PixelIcon id={iconIdForCurrency('scrap')} width={20} height={20} />
          <span class="fe-inv__wallet-n">{formatInt(scrap)}</span>
          <span class="fe-muted">Forge Scrap</span>
        </span>
        <span class="fe-inv__hints ui-type-caption">
          <Keycap>Ctrl</Keycap> click moves
          {craftingAllowed ? (
            <>
              <span class="fe-inv__sep" />
              right-click currency to craft
            </>
          ) : (
            <>
              <span class="fe-inv__sep" />
              crafting in hideout only
            </>
          )}
        </span>
      </div>
    </PanelShell>
  );
}
