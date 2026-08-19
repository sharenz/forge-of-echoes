import { MAP_MERCHANT } from "../game/config/merchants";
import { FLASK_DEFINITIONS } from "../game/config/flasks";

interface MapMerchantProps {
  scrap: number;
  onBuy: (offerId: string) => void;
  onBuyFlask: (offerId: string) => void;
}

export function MapMerchant({ scrap, onBuy, onBuyFlask }: MapMerchantProps) {
  return (
    <section className="merchant-layout" aria-label="Merchant">
      <aside className="merchant-portrait panel">
        <span className="merchant-rune" aria-hidden="true">R</span>
        <div><span className="eyebrow">Merchant</span><h2>{MAP_MERCHANT.name}</h2><small>{MAP_MERCHANT.title}</small></div>
        <blockquote>{MAP_MERCHANT.greeting}</blockquote>
        <div className="merchant-wallet"><span>Scrap available</span><strong>{scrap}</strong></div>
      </aside>
      <div className="merchant-stock panel">
        <header><div><span className="eyebrow">Current stock</span><h2>Maps &amp; supplies</h2></div><small>Unlimited prototype stock</small></header>
        <div className="merchant-offers">
          {MAP_MERCHANT.offers.map((offer) => {
            const affordable = offer.price.amount === 0 || scrap >= offer.price.amount;
            return (
              <article className="merchant-offer" key={offer.id}>
                <div className="merchant-map-seal"><span>T{offer.tier}</span></div>
                <div><span>{offer.name}</span><strong>{offer.mapBaseId === "ashen-crucible" ? "Ashen Crucible" : "Iron Coliseum"}</strong><small>{offer.description}</small></div>
                <button type="button" disabled={!affordable} onClick={() => onBuy(offer.id)}>
                  {offer.price.amount === 0 ? <><strong>Free</strong><small>Take map</small></> : <><strong>{offer.price.amount} Scrap</strong><small>{affordable ? "Purchase" : "Not enough"}</small></>}
                </button>
              </article>
            );
          })}
          <div className="merchant-section-title"><span>Flask supplies</span><small>Consumables stack to 20 in your backpack</small></div>
          {MAP_MERCHANT.flaskOffers.map((offer) => {
            const definition = FLASK_DEFINITIONS[offer.flaskId];
            const affordable = scrap >= offer.price.amount;
            return (
              <article className={`merchant-offer merchant-flask-offer flask-${definition.resource}`} key={offer.id}>
                <div className="merchant-flask-icon" style={{ backgroundImage: `url(${definition.icon})` }} />
                <div><span>Weak flask</span><strong>{definition.name}</strong><small>Restores {definition.recovery} {definition.resource === "life" ? "Life" : "Mana"} over {definition.durationSeconds}s.</small></div>
                <button type="button" disabled={!affordable} onClick={() => onBuyFlask(offer.id)}>
                  <strong>{offer.price.amount} Scrap</strong><small>{affordable ? "Purchase" : "Not enough"}</small>
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
