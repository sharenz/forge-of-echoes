export const ENTITY_SLOT_BITS = 16;
export const ENTITY_SLOT_MASK = 0xffff;

export function entityId(slot: number, generation: number): number {
  return (((generation & ENTITY_SLOT_MASK) << ENTITY_SLOT_BITS) | (slot & ENTITY_SLOT_MASK)) >>> 0;
}

export function entitySlot(id: number): number {
  return id & ENTITY_SLOT_MASK;
}

export function entityGeneration(id: number): number {
  return (id >>> ENTITY_SLOT_BITS) & ENTITY_SLOT_MASK;
}
