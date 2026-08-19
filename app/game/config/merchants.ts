import type { CurrencyId, FlaskId } from "../domain";
import type { MapBaseId } from "./maps";

export interface MapMerchantOffer {
  id: string;
  name: string;
  description: string;
  mapBaseId: MapBaseId;
  tier: number;
  price: { currency: CurrencyId; amount: number };
}

export interface FlaskMerchantOffer {
  id: string;
  flaskId: FlaskId;
  amount: number;
  price: { currency: CurrencyId; amount: number };
}

export const MAP_MERCHANT = {
  id: "cartographer-rook",
  name: "Rook",
  title: "Wayfinder of the Crucible",
  greeting: "No exile should be trapped in the hideout—or enter a map without supplies. Take a foothold for free and stock your belt before you go.",
  offers: [
    { id: "free-ashen-t1", name: "Ashen Foothold", description: "A reliable entry map with modest rewards.", mapBaseId: "ashen-crucible", tier: 1, price: { currency: "scrap", amount: 0 } },
    { id: "iron-trial-t2", name: "Iron Trial", description: "Denser opposition and stronger item levels.", mapBaseId: "iron-coliseum", tier: 2, price: { currency: "scrap", amount: 6 } },
    { id: "ashen-descent-t4", name: "Ashen Descent", description: "A dangerous map intended for established characters.", mapBaseId: "ashen-crucible", tier: 4, price: { currency: "scrap", amount: 14 } },
  ] as const satisfies readonly MapMerchantOffer[],
  flaskOffers: [
    { id: "weak-health-supply", flaskId: "weak-health-flask", amount: 1, price: { currency: "scrap", amount: 1 } },
    { id: "weak-mana-supply", flaskId: "weak-mana-flask", amount: 1, price: { currency: "scrap", amount: 1 } },
  ] as const satisfies readonly FlaskMerchantOffer[],
} as const;
