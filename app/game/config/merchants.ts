import type { AffixTag, CurrencyId, FlaskId, ModifierMode, Rarity, StatKey } from "../domain";
import type { ItemBaseId } from "./item-bases";
import type { MapBaseId } from "./maps";

export interface MerchantPrice {
  currency: CurrencyId;
  amount: number;
}

interface MerchantOfferBase {
  id: string;
  name: string;
  description: string;
  price: MerchantPrice;
}

export interface MapMerchantOffer extends MerchantOfferBase {
  kind: "map";
  mapBaseId: MapBaseId;
  tier: number;
}

export interface FlaskMerchantOffer extends MerchantOfferBase {
  kind: "flask";
  flaskId: FlaskId;
  amount: number;
}

export interface FixedMerchantAffixDefinition {
  id: string;
  name: string;
  tag: AffixTag;
  group: string;
  tier: number;
  rolls: readonly {
    stat: StatKey;
    mode: ModifierMode;
    value: number;
  }[];
}

export interface EquipmentMerchantOffer extends MerchantOfferBase {
  kind: "equipment";
  baseId: ItemBaseId;
  displayName: string;
  itemLevel: number;
  rarity: Rarity;
  affixes: readonly FixedMerchantAffixDefinition[];
}

export type MerchantOffer = MapMerchantOffer | FlaskMerchantOffer | EquipmentMerchantOffer;

export interface MerchantDefinition {
  id: string;
  name: string;
  title: string;
  greeting: string;
  availability: { kind: "always" } | { kind: "account-entitlement" };
  station: {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    tint: number;
  };
  offers: readonly MerchantOffer[];
}

export const MERCHANTS = {
  "cartographer-rook": {
    id: "cartographer-rook",
    name: "Rook",
    title: "Wayfinder of Echoes",
    greeting: "No exile should be trapped in the hideout—or enter a map without supplies.",
    availability: { kind: "always" },
    station: { x: 248, y: 592, width: 125, height: 105, label: "MERCHANT", tint: 0xd9ad76 },
    offers: [
      { kind: "map", id: "free-ashen-t1", name: "Ashen Foothold", description: "A reliable entry map with modest rewards.", mapBaseId: "ashen-crucible", tier: 1, price: { currency: "scrap", amount: 0 } },
      { kind: "map", id: "iron-trial-t2", name: "Iron Trial", description: "Denser opposition and stronger item levels.", mapBaseId: "iron-coliseum", tier: 2, price: { currency: "scrap", amount: 6 } },
      { kind: "map", id: "ashen-descent-t4", name: "Ashen Descent", description: "A dangerous map intended for established characters.", mapBaseId: "ashen-crucible", tier: 4, price: { currency: "scrap", amount: 14 } },
      { kind: "flask", id: "weak-health-supply", name: "Weak Health Flask", description: "A weak life restorative.", flaskId: "weak-health-flask", amount: 1, price: { currency: "scrap", amount: 1 } },
      { kind: "flask", id: "weak-mana-supply", name: "Weak Mana Flask", description: "A weak mana restorative.", flaskId: "weak-mana-flask", amount: 1, price: { currency: "scrap", amount: 1 } },
    ],
  },
  "debug-artificer": {
    id: "debug-artificer",
    name: "Veyra",
    title: "Artificer Beyond Reason",
    greeting: "These instruments are not balanced. That is precisely the point.",
    availability: { kind: "account-entitlement" },
    station: { x: 710, y: 610, width: 125, height: 105, label: "TEST FORGE", tint: 0xb779ff },
    offers: [
      {
        kind: "equipment",
        id: "impossible-haste-ring",
        name: "Impossible Haste Ring",
        description: "A testing ring that makes attack timing limits immediately visible.",
        baseId: "ember-ring",
        displayName: "Impossible Haste Ring",
        itemLevel: 99,
        rarity: "unique",
        price: { currency: "scrap", amount: 0 },
        affixes: [{
          id: "debug-impossible-haste",
          name: "of Impossible Haste",
          tag: "speed",
          group: "attack-speed",
          tier: 1,
          rolls: [{ stat: "attackSpeed", mode: "increased", value: 10_000 }],
        }],
      },
      {
        kind: "equipment",
        id: "impossible-incantation-ring",
        name: "Impossible Incantation Ring",
        description: "A testing ring that compresses spell casts to the engine's safe timing floor.",
        baseId: "ember-ring",
        displayName: "Impossible Incantation Ring",
        itemLevel: 99,
        rarity: "unique",
        price: { currency: "scrap", amount: 0 },
        affixes: [{
          id: "debug-impossible-incantation",
          name: "of Impossible Incantation",
          tag: "speed",
          group: "cast-speed",
          tier: 1,
          rolls: [{ stat: "castSpeed", mode: "increased", value: 10_000 }],
        }],
      },
      {
        kind: "equipment",
        id: "impossible-velocity-boots",
        name: "Impossible Velocity Boots",
        description: "A testing pair of boots for movement, camera, and replication stress.",
        baseId: "pathfinder-boots",
        displayName: "Impossible Velocity Boots",
        itemLevel: 99,
        rarity: "unique",
        price: { currency: "scrap", amount: 0 },
        affixes: [{
          id: "debug-impossible-velocity",
          name: "Impossible Velocity",
          tag: "speed",
          group: "movement-speed",
          tier: 1,
          rolls: [{ stat: "moveSpeed", mode: "increased", value: 1_000 }],
        }],
      },
      {
        kind: "equipment",
        id: "impossible-celerity-amulet",
        name: "Impossible Celerity Amulet",
        description: "A testing amulet that drives every active-skill cooldown to the safe simulation floor.",
        baseId: "cinder-pendant",
        displayName: "Impossible Celerity Amulet",
        itemLevel: 99,
        rarity: "unique",
        price: { currency: "scrap", amount: 0 },
        affixes: [{
          id: "debug-impossible-celerity",
          name: "of Impossible Celerity",
          tag: "speed",
          group: "skill-cooldown",
          tier: 1,
          rolls: [{ stat: "skillCooldown", mode: "increased", value: -10_000 }],
        }],
      },
      {
        kind: "equipment",
        id: "impossible-font-belt",
        name: "Impossible Font Belt",
        description: "A testing belt that makes Focus recovery effectively inexhaustible.",
        baseId: "chain-belt",
        displayName: "Impossible Font Belt",
        itemLevel: 99,
        rarity: "unique",
        price: { currency: "scrap", amount: 0 },
        affixes: [{
          id: "debug-impossible-font",
          name: "of the Impossible Font",
          tag: "speed",
          group: "focus-recovery",
          tier: 1,
          rolls: [{ stat: "focusRegen", mode: "increased", value: 10_000 }],
        }],
      },
    ],
  },
} as const satisfies Record<string, MerchantDefinition>;

export type MerchantId = keyof typeof MERCHANTS;

export const MAP_MERCHANT = MERCHANTS["cartographer-rook"];
export const DEBUG_MERCHANT_ID: MerchantId = "debug-artificer";

export function isMerchantId(value: string): value is MerchantId {
  return value in MERCHANTS;
}

export function availableMerchantIds(entitlements: readonly string[]): MerchantId[] {
  const enabled = new Set(entitlements);
  return (Object.keys(MERCHANTS) as MerchantId[]).filter((merchantId) => {
    const availability = MERCHANTS[merchantId].availability;
    return availability.kind === "always" || enabled.has(merchantId);
  });
}

export function merchantIsAvailable(merchantId: MerchantId, entitlements: readonly string[]): boolean {
  return availableMerchantIds(entitlements).includes(merchantId);
}
