import { FLASK_DEFINITIONS } from "./config/flasks";
import { ITEM_BASES_BY_ID } from "./config/item-bases";
import { MAP_BASES_BY_ID } from "./config/maps";
import { MERCHANTS, type MerchantId, type MerchantOffer } from "./config/merchants";
import type { InventoryItem, PlayerProfile } from "./domain";
import { createFlaskStack } from "./flasks";
import { consumeProfileCurrency } from "./inventory";
import { insertItem } from "./item-container";
import { createFixedMerchantEquipment } from "./items";
import { createMap } from "./maps";

export interface MerchantPurchase {
  profile: PlayerProfile;
  item: InventoryItem;
  paid: number;
}

export function findMerchantOffer(merchantId: MerchantId, offerId: string): MerchantOffer | null {
  return MERCHANTS[merchantId].offers.find((candidate) => candidate.id === offerId) ?? null;
}

export function createMerchantOfferItem(merchantId: MerchantId, offerId: string, itemId?: string): InventoryItem | null {
  const offer = findMerchantOffer(merchantId, offerId);
  if (!offer) return null;
  if (offer.kind === "map") {
    const item = createMap(offer.tier, offer.mapBaseId);
    return itemId ? { ...item, id: itemId } : item;
  }
  if (offer.kind === "flask") {
    const item = createFlaskStack(offer.flaskId, offer.amount);
    return itemId ? { ...item, id: itemId } : item;
  }
  return createFixedMerchantEquipment(offer, itemId);
}

export function merchantOfferIcon(offer: MerchantOffer): string {
  if (offer.kind === "map") return MAP_BASES_BY_ID[offer.mapBaseId].icon;
  if (offer.kind === "flask") return FLASK_DEFINITIONS[offer.flaskId].icon;
  return ITEM_BASES_BY_ID[offer.baseId].icon;
}

export function merchantOfferBadge(offer: MerchantOffer): string {
  if (offer.kind === "map") return `T${offer.tier}`;
  if (offer.kind === "flask") return `×${offer.amount}`;
  return offer.rarity === "unique" ? "★" : offer.rarity.toUpperCase();
}

export function purchaseMerchantOffer(
  profile: PlayerProfile,
  merchantId: MerchantId,
  offerId: string,
  position?: { x: number; y: number },
): MerchantPurchase | null {
  const offer = findMerchantOffer(merchantId, offerId);
  if (!offer) return null;
  const paidProfile = offer.price.amount > 0
    ? consumeProfileCurrency(profile, offer.price.currency, offer.price.amount)
    : profile;
  if (!paidProfile) return null;
  const item = createMerchantOfferItem(merchantId, offerId);
  if (!item) return null;
  const inserted = insertItem(paidProfile.inventory, item, position);
  if (inserted.unplaced.length > 0) return null;
  return {
    profile: { ...paidProfile, inventory: inserted.container },
    item,
    paid: offer.price.amount,
  };
}
