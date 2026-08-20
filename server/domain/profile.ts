import { randomUUID } from "node:crypto";
import type { InventoryItem, PlayerProfile } from "../../app/game/domain";
import { createInitialProfile } from "../../app/game/profile";
import type { CreatePlayerInput } from "../persistence/PlayerRepository";

function authoritativeItem(item: InventoryItem): InventoryItem {
  return { ...item, id: randomUUID() };
}

/** Creates server-owned starter state. Every persisted item receives an opaque UUID. */
export function createAuthoritativeProfile(input: CreatePlayerInput): PlayerProfile {
  const created = createInitialProfile(input.characterName, input.classId);
  return {
    ...created,
    inventory: {
      ...created.inventory,
      entries: created.inventory.entries.map((entry) => ({ ...entry, item: authoritativeItem(entry.item) })),
    },
    stash: {
      ...created.stash,
      tabs: created.stash.tabs.map((tab) => ({
        ...tab,
        container: {
          ...tab.container,
          entries: tab.container.entries.map((entry) => ({ ...entry, item: authoritativeItem(entry.item) })),
        },
      })),
    },
    equipped: Object.fromEntries(Object.entries(created.equipped).map(([slot, item]) => [slot, item ? authoritativeItem(item) : item])),
    flaskBelt: created.flaskBelt.map((item) => item ? authoritativeItem(item) : null) as PlayerProfile["flaskBelt"],
    mapDevice: created.mapDevice ? authoritativeItem(created.mapDevice) as PlayerProfile["mapDevice"] : null,
  };
}
