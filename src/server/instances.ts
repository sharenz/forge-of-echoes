// Registry of live instances: one hideout per owner character (created on demand) and at most one active
// map per owner (the one its hideout portal leads to). Maps also carry a persistent key (restart safety).
import type { RunSetup } from '../contracts/game';
import { HideoutInstance, MapInstance } from './instance';
import type { Instance, InstanceHost } from './instance';

export class InstanceManager {
  private readonly all = new Map<string, Instance>();
  private readonly hideouts = new Map<string, HideoutInstance>();
  private readonly maps = new Map<string, MapInstance>();
  private nextId = 1;

  constructor(private readonly host: InstanceHost) {}

  hideoutOf(ownerId: string): HideoutInstance | null {
    return this.hideouts.get(ownerId) ?? null;
  }

  /** The owner's hideout, created on first use. */
  ensureHideout(ownerId: string, ownerName: string, now: number): { hideout: HideoutInstance; created: boolean } {
    const existing = this.hideouts.get(ownerId);
    if (existing && !existing.disposed) return { hideout: existing, created: false };
    const hideout = new HideoutInstance(this.host, `h${this.nextId++}`, ownerId, ownerName, now);
    this.hideouts.set(ownerId, hideout);
    this.all.set(hideout.id, hideout);
    return { hideout, created: true };
  }

  /** The owner's open map (the one their hideout portal leads to), if any. */
  activeMapOf(ownerId: string): MapInstance | null {
    const m = this.maps.get(ownerId);
    return m && !m.disposed ? m : null;
  }

  /** A new map instance; `mapKey` is its persistent id (kept when a restart recreates it). */
  createMap(ownerId: string, ownerName: string, setup: RunSetup, now: number, mapKey: string): MapInstance {
    if (this.activeMapOf(ownerId)) throw new Error('owner already has an active map');
    const map = new MapInstance(this.host, `m${this.nextId++}`, ownerId, ownerName, setup, now, mapKey);
    this.maps.set(ownerId, map);
    this.all.set(map.id, map);
    return map;
  }

  /** The live map with this persistent id, if any. */
  mapByKey(mapKey: string): MapInstance | null {
    for (const m of this.maps.values()) if (m.mapKey === mapKey && !m.disposed) return m;
    return null;
  }

  /** Every live map. */
  mapList(): MapInstance[] {
    return [...this.maps.values()].filter((m) => !m.disposed);
  }

  /** Forget a disposed instance. */
  remove(inst: Instance): void {
    this.all.delete(inst.id);
    if (inst instanceof HideoutInstance && this.hideouts.get(inst.ownerId) === inst) this.hideouts.delete(inst.ownerId);
    if (inst instanceof MapInstance && this.maps.get(inst.ownerId) === inst) this.maps.delete(inst.ownerId);
  }

  get(id: string): Instance | null {
    return this.all.get(id) ?? null;
  }

  /** Snapshot of every live instance (safe to iterate while instances are created or removed). */
  list(): Instance[] {
    return [...this.all.values()];
  }

  get size(): number {
    return this.all.size;
  }
}
