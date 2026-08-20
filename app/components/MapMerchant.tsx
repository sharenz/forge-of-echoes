"use client";

import { MAP_MERCHANT } from "../game/config/merchants";
import { FLASK_DEFINITIONS } from "../game/config/flasks";
import { useQuickAction } from "./useQuickAction";

interface MapMerchantProps {
  scrap: number;
  onBuy: (offerId: string) => void;
  onBuyFlask: (offerId: string) => void;
}

export function MapMerchant({ scrap, onBuy, onBuyFlask }: MapMerchantProps) {
  const quickAction = useQuickAction();

  return (
    <section className="merchant-layout" aria-label="Merchant">
      <aside className="merchant-portrait panel">
        <span className="merchant-rune" aria-hidden="true">R</span>
        <div><span className="eyebrow">Merchant</span><h2>{MAP_MERCHANT.name}</h2><small>{MAP_MERCHANT.title}</small></div>
        <blockquote>{MAP_MERCHANT.greeting}</blockquote>
        <div className="merchant-wallet"><span>Scrap available</span><strong>{scrap}</strong></div>
      </aside>
      <div className="merchant-stock panel">
        <header><div><span className="eyebrow">Current stock</span><h2>Maps &amp; supplies</h2></div><small>Ctrl/⌘-click an offer to quick buy</small></header>
        <div className="merchant-offers">
          {MAP_MERCHANT.offers.map((offer) => {
            const affordable = offer.price.amount === 0 || scrap >= offer.price.amount;
            return (
              <div
                className="merchant-offer"
                key={offer.id}
                role="button"
                tabIndex={affordable ? 0 : -1}
                aria-disabled={!affordable}
                onClick={(event) => {
                  if (affordable) quickAction.fromClick(event, `map:${offer.id}`, () => onBuy(offer.id));
                }}
                onContextMenu={(event) => {
                  if (affordable) quickAction.fromContextMenu(event, `map:${offer.id}`, () => onBuy(offer.id));
                }}
                onKeyDown={(event) => {
                  if (!affordable || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  onBuy(offer.id);
                }}
              >
                <div className="merchant-map-seal"><span>T{offer.tier}</span></div>
                <div><span>{offer.name}</span><strong>{offer.mapBaseId === "ashen-crucible" ? "Ashen Crucible" : "Iron Coliseum"}</strong><small>{offer.description}</small></div>
                <button type="button" disabled={!affordable} onClick={(event) => {
                  if (quickAction.fromClick(event, `map:${offer.id}`, () => onBuy(offer.id))) return;
                  event.stopPropagation();
                  onBuy(offer.id);
                }}>
                  {offer.price.amount === 0 ? <><strong>Free</strong><small>Take map</small></> : <><strong>{offer.price.amount} Scrap</strong><small>{affordable ? "Purchase" : "Not enough"}</small></>}
                </button>
              </div>
            );
          })}
          <div className="merchant-section-title"><span>Flask supplies</span><small>Consumables stack to 20 in your backpack</small></div>
          {MAP_MERCHANT.flaskOffers.map((offer) => {
            const definition = FLASK_DEFINITIONS[offer.flaskId];
            const affordable = scrap >= offer.price.amount;
            return (
              <div
                className={`merchant-offer merchant-flask-offer flask-${definition.resource}`}
                key={offer.id}
                role="button"
                tabIndex={affordable ? 0 : -1}
                aria-disabled={!affordable}
                onClick={(event) => {
                  if (affordable) quickAction.fromClick(event, `flask:${offer.id}`, () => onBuyFlask(offer.id));
                }}
                onContextMenu={(event) => {
                  if (affordable) quickAction.fromContextMenu(event, `flask:${offer.id}`, () => onBuyFlask(offer.id));
                }}
                onKeyDown={(event) => {
                  if (!affordable || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  onBuyFlask(offer.id);
                }}
              >
                <div className="merchant-flask-icon" style={{ backgroundImage: `url(${definition.icon})` }} />
                <div><span>Weak flask</span><strong>{definition.name}</strong><small>Restores {definition.recovery} {definition.resource === "life" ? "Life" : "Mana"} over {definition.durationSeconds}s.</small></div>
                <button type="button" disabled={!affordable} onClick={(event) => {
                  if (quickAction.fromClick(event, `flask:${offer.id}`, () => onBuyFlask(offer.id))) return;
                  event.stopPropagation();
                  onBuyFlask(offer.id);
                }}>
                  <strong>{offer.price.amount} Scrap</strong><small>{affordable ? "Purchase" : "Not enough"}</small>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
