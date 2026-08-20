import { MAP_MERCHANT } from "./config/merchants";
import type { FlaskItem, MapItem, PlayerProfile } from "./domain";
import { createFlaskStack } from "./flasks";
import { consumeProfileCurrency } from "./inventory";
import { insertItem } from "./item-container";
import { createMap } from "./maps";

export interface MapPurchase {
  profile: PlayerProfile;
  map: MapItem;
  paid: number;
}

export interface FlaskPurchase {
  profile: PlayerProfile;
  flask: FlaskItem;
  paid: number;
}

export function purchaseFlask(profile: PlayerProfile, offerId: string, position?: { x: number; y: number }): FlaskPurchase | null {
  const offer = MAP_MERCHANT.flaskOffers.find((candidate) => candidate.id === offerId);
  if (!offer) return null;
  const paidProfile = consumeProfileCurrency(profile, offer.price.currency, offer.price.amount);
  if (!paidProfile) return null;
  const flask = createFlaskStack(offer.flaskId, offer.amount);
  const inserted = insertItem(paidProfile.inventory, flask, position);
  if (inserted.unplaced.length > 0) return null;
  return { profile: { ...paidProfile, inventory: inserted.container }, flask, paid: offer.price.amount };
}

export function purchaseMap(profile: PlayerProfile, offerId: string, position?: { x: number; y: number }): MapPurchase | null {
  const offer = MAP_MERCHANT.offers.find((candidate) => candidate.id === offerId);
  if (!offer) return null;
  const paidProfile = offer.price.amount > 0
    ? consumeProfileCurrency(profile, offer.price.currency, offer.price.amount)
    : profile;
  if (!paidProfile) return null;
  const map = createMap(offer.tier, offer.mapBaseId);
  const inserted = insertItem(paidProfile.inventory, map, position);
  if (inserted.unplaced.length > 0) return null;
  return {
    profile: { ...paidProfile, inventory: inserted.container },
    map,
    paid: offer.price.amount,
  };
}
