// The layout registry: areaId -> hand-crafted layout. An area without an entry keeps the procedural generator
// (src/sim/props.ts layoutMap), so this table can grow one theme pack at a time (docs/atlas-rework/D-territory.md 13).
//
// Layout packs add their areas here (L1: src/data/layouts/ashen/*, chapel/*; L2: ossuary/*, crypt/*; L3: chainworks/*,
// coliseum/*). The two files under ./fixtures are test fixtures and sample art for dev/layouts.html: they are NOT
// registered, so no real area changes until a pack lands.
import type { AtlasAreaId } from '../../contracts/atlas';
import type { AreaLayout } from './schema';
import { ASHEN_CHAPEL_LAYOUTS } from './packs/ashenChapel';
import { OSSUARY_CRYPT_LAYOUTS } from './packs/ossuaryCrypt';
import { CHAINWORKS_COLISEUM_LAYOUTS } from './packs/chainworksColiseum';

export * from './schema';
export { compileLayout, type CompiledLayout } from './compile';

/** Shipped layouts. Packs add `areaId: layout` entries here. */
export const AREA_LAYOUTS: Partial<Record<AtlasAreaId, AreaLayout>> = {
  ...ASHEN_CHAPEL_LAYOUTS,
  ...OSSUARY_CRYPT_LAYOUTS,
  ...CHAINWORKS_COLISEUM_LAYOUTS,
};

/** Test/viewer overrides (never set in production code): areaId -> layout, or null to force the old generator. */
const overrides = new Map<AtlasAreaId, AreaLayout | null>();

/** The layout of an area, or undefined (the area keeps the procedural generator). */
export function layoutFor(areaId: AtlasAreaId | undefined | null): AreaLayout | undefined {
  if (!areaId) return undefined;
  if (overrides.has(areaId)) return overrides.get(areaId) ?? undefined;
  return AREA_LAYOUTS[areaId];
}

/** Every shipped layout (the validator test runs on exactly these, plus the fixtures). */
export function registeredLayouts(): AreaLayout[] {
  return Object.values(AREA_LAYOUTS).filter((l): l is AreaLayout => !!l);
}

/** Tests and dev tools only: use `layout` for `layout.areaId` until the returned function is called. */
export function overrideLayout(layout: AreaLayout | null, areaId?: AtlasAreaId): () => void {
  const id = areaId ?? layout?.areaId;
  if (!id) return () => undefined;
  const had = overrides.has(id);
  const prev = overrides.get(id) ?? null;
  overrides.set(id, layout);
  return () => {
    if (had) overrides.set(id, prev);
    else overrides.delete(id);
  };
}
