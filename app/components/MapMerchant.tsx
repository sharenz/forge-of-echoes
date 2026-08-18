import { MAP_MERCHANT } from "../game/config/merchants";

interface MapMerchantProps {
  scrap: number;
  onBuy: (offerId: string) => void;
}

export function MapMerchant({ scrap, onBuy }: MapMerchantProps) {
  return (
    <section className="merchant-layout" aria-label="Map merchant">
      <aside className="merchant-portrait panel">
        <span className="merchant-rune" aria-hidden="true">R</span>
        <div><span className="eyebrow">Map merchant</span><h2>{MAP_MERCHANT.name}</h2><small>{MAP_MERCHANT.title}</small></div>
        <blockquote>{MAP_MERCHANT.greeting}</blockquote>
        <div className="merchant-wallet"><span>Scrap available</span><strong>{scrap}</strong></div>
      </aside>
      <div className="merchant-stock panel">
        <header><div><span className="eyebrow">Current stock</span><h2>Maps for sale</h2></div><small>Unlimited prototype stock</small></header>
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
        </div>
      </div>
    </section>
  );
}
