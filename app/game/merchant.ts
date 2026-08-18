import { MAP_MERCHANT } from "./config/merchants";
import type { MapItem, PlayerProfile } from "./domain";
import { addItemsToInventory, consumeProfileCurrency } from "./inventory";
import { createMap } from "./maps";

export interface MapPurchase {
  profile: PlayerProfile;
  map: MapItem;
  paid: number;
}

export function purchaseMap(profile: PlayerProfile, offerId: string): MapPurchase | null {
  const offer = MAP_MERCHANT.offers.find((candidate) => candidate.id === offerId);
  if (!offer) return null;
  const paidProfile = offer.price.amount > 0
    ? consumeProfileCurrency(profile, offer.price.currency, offer.price.amount)
    : profile;
  if (!paidProfile) return null;
  const map = createMap(offer.tier, offer.mapBaseId);
  return {
    profile: { ...paidProfile, inventory: addItemsToInventory(paidProfile.inventory, [map]) },
    map,
    paid: offer.price.amount,
  };
}
