import { MAP_MERCHANT } from "./config/merchants";
import type { MapItem, PlayerProfile } from "./domain";
import { consumeProfileCurrency } from "./inventory";
import { insertItem } from "./item-container";
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
  const inserted = insertItem(paidProfile.inventory, map);
  if (inserted.unplaced.length > 0) return null;
  return {
    profile: { ...paidProfile, inventory: inserted.container },
    map,
    paid: offer.price.amount,
  };
}
