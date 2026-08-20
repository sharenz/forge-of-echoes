import { FLASK_BELT_SLOT_COUNT, FLASK_DEFINITIONS, type FlaskDefinition } from "./config/flasks";
import type { FlaskBelt, FlaskId, FlaskItem, PlayerProfile } from "./domain";
import { findContainerEntry, insertItem, removeItem } from "./item-container";
import { createId } from "./random";

export function createFlaskStack(baseId: FlaskId, stackSize: number, preferredId?: string): FlaskItem {
  const maximum = FLASK_DEFINITIONS[baseId].maxInventoryStack;
  if (!Number.isInteger(stackSize) || stackSize < 1 || stackSize > maximum) {
    throw new Error(`Invalid ${baseId} stack size ${stackSize}; expected 1-${maximum}`);
  }
  return { kind: "flask", id: preferredId ?? createId("flask"), baseId, stackSize };
}

export function loadFlaskIntoBelt(profile: PlayerProfile, itemId: string, slotIndex: number): PlayerProfile | null {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= FLASK_BELT_SLOT_COUNT) return null;
  const entry = findContainerEntry(profile.inventory, itemId);
  if (!entry || entry.item.kind !== "flask") return null;
  const sourceFlask = entry.item;
  const target = profile.flaskBelt[slotIndex];
  if (target && target.baseId !== sourceFlask.baseId) return null;
  const maximum = FLASK_DEFINITIONS[sourceFlask.baseId].maxBeltStack;
  const moved = Math.min(sourceFlask.stackSize, maximum - (target?.stackSize ?? 0));
  if (moved <= 0) return null;

  const inventory = sourceFlask.stackSize === moved
    ? removeItem(profile.inventory, itemId)?.container
    : {
        ...profile.inventory,
        entries: profile.inventory.entries.map((candidate) => candidate.item.id === itemId
          ? { ...candidate, item: { ...sourceFlask, stackSize: sourceFlask.stackSize - moved } }
          : candidate),
      };
  if (!inventory) return null;
  const flaskBelt = [...profile.flaskBelt] as FlaskBelt;
  flaskBelt[slotIndex] = target
    ? { ...target, stackSize: target.stackSize + moved }
    : { ...sourceFlask, stackSize: moved };
  return { ...profile, inventory, flaskBelt };
}

export function unloadFlaskFromBelt(profile: PlayerProfile, slotIndex: number): PlayerProfile | null {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= FLASK_BELT_SLOT_COUNT) return null;
  const flask = profile.flaskBelt[slotIndex];
  if (!flask) return null;
  if (flask.stackSize <= 0) {
    const flaskBelt = [...profile.flaskBelt] as FlaskBelt;
    flaskBelt[slotIndex] = null;
    return { ...profile, flaskBelt };
  }
  const inserted = insertItem(profile.inventory, flask);
  if (inserted.unplaced.length > 0) return null;
  const flaskBelt = [...profile.flaskBelt] as FlaskBelt;
  flaskBelt[slotIndex] = null;
  return { ...profile, inventory: inserted.container, flaskBelt };
}

export interface ConsumedFlask {
  profile: PlayerProfile;
  definition: FlaskDefinition;
}

export function consumeFlaskFromBelt(profile: PlayerProfile, slotIndex: number): ConsumedFlask | null {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= FLASK_BELT_SLOT_COUNT) return null;
  const flask = profile.flaskBelt[slotIndex];
  if (!flask || flask.stackSize <= 0) return null;
  const flaskBelt = [...profile.flaskBelt] as FlaskBelt;
  flaskBelt[slotIndex] = { ...flask, stackSize: flask.stackSize - 1 };
  return { profile: { ...profile, flaskBelt }, definition: FLASK_DEFINITIONS[flask.baseId] };
}

export function firstCompatibleFlaskSlot(profile: PlayerProfile, flaskId: FlaskId): number | null {
  const nonFull = profile.flaskBelt.findIndex((slot) => slot?.baseId === flaskId && slot.stackSize < FLASK_DEFINITIONS[flaskId].maxBeltStack);
  if (nonFull >= 0) return nonFull;
  const empty = profile.flaskBelt.findIndex((slot) => slot === null);
  return empty >= 0 ? empty : null;
}

export interface StorePickedUpFlaskResult {
  profile: PlayerProfile;
  beltAdded: number;
  inventoryAdded: number;
}

/**
 * Refills existing matching belt stacks, including depleted assigned slots,
 * before sending overflow to the backpack.
 * Empty belt slots are deliberately not auto-filled: belt layout remains a
 * player choice, while a configured flask slot behaves like a pickup reserve.
 */
export function storePickedUpFlask(profile: PlayerProfile, flask: FlaskItem): StorePickedUpFlaskResult | null {
  const maximum = FLASK_DEFINITIONS[flask.baseId].maxBeltStack;
  const flaskBelt = [...profile.flaskBelt] as FlaskBelt;
  let remaining = flask.stackSize;

  for (let index = 0; index < flaskBelt.length && remaining > 0; index += 1) {
    const slot = flaskBelt[index];
    if (!slot || slot.baseId !== flask.baseId || slot.stackSize >= maximum) continue;
    const moved = Math.min(maximum - slot.stackSize, remaining);
    flaskBelt[index] = { ...slot, stackSize: slot.stackSize + moved };
    remaining -= moved;
  }

  if (remaining === 0) {
    return {
      profile: { ...profile, flaskBelt },
      beltAdded: flask.stackSize,
      inventoryAdded: 0,
    };
  }

  const inserted = insertItem(profile.inventory, { ...flask, stackSize: remaining });
  if (inserted.unplaced.length > 0) return null;
  return {
    profile: { ...profile, flaskBelt, inventory: inserted.container },
    beltAdded: flask.stackSize - remaining,
    inventoryAdded: remaining,
  };
}
