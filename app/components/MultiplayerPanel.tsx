"use client";

import { useState } from "react";
import type { InventoryItem } from "../game/domain";
import { CURRENCY_DEFINITIONS } from "../game/config/currencies";
import { FLASK_DEFINITIONS } from "../game/config/flasks";
import { isCurrencyItem, isEquipmentItem, isFlaskItem, isMapItem } from "../game/inventory";
import { ItemIcon } from "./ItemIcon";
import type { MultiplayerHideoutController } from "../multiplayer/useMultiplayerHideout";

interface MultiplayerPanelProps {
  controller: MultiplayerHideoutController;
  onOpenMapDevice: () => void;
  onPartyEntered: () => void;
}

export function MultiplayerPanel({ controller, onOpenMapDevice, onPartyEntered }: MultiplayerPanelProps) {
  const isSolo = controller.party?.visibility === "solo";
  const isLeader = controller.party?.leaderCharacterId === controller.session?.player.characterId;
  const inRoom = controller.connectedPlayers.some((player) => player.characterId === controller.session?.player.characterId);
  const inMap = Boolean(controller.mapAdapter);
  const listedParty = controller.publicParties.find((candidate) => candidate.id === controller.party?.id);
  const connectedLeader = controller.connectedPlayers.find((player) => player.characterId === controller.party?.leaderCharacterId);
  const leaderName = isLeader ? controller.session?.player.characterName : connectedLeader?.name ?? listedParty?.leader.characterName ?? "Party leader";

  const createAndEnter = async () => {
    if (await controller.createParty()) onPartyEntered();
  };

  const joinAndEnter = async (partyId: string) => {
    if (await controller.joinParty(partyId)) onPartyEntered();
  };

  return (
    <div className={`multiplayer-console ${controller.trades.length > 0 ? "trading" : ""}`}>
      {controller.trades.length === 0 && <section className="multiplayer-intro">
        <span>Public co-op realm</span>
        <h3>{isSolo ? "Party Finder" : controller.party ? "Your Party" : "Party Finder"}</h3>
        <p>{isSolo ? "You are in a private server hideout. Create a public party or join another player without giving up solo play." : controller.party ? "Fight together, trade safely, and open maps from the shared hideout." : "Create a public party or join another player. You will enter the party leader’s hideout automatically."}</p>
      </section>}

      {controller.session && (
        <>
          {controller.trades.length === 0 && <div className="multiplayer-identity">
            <i className={`class-crest ${controller.session.player.classId}`}>{controller.session.player.classId[0].toUpperCase()}</i>
            <div><strong>{controller.session.player.characterName}</strong><span>{controller.session.player.classId} · authenticated</span></div>
            <em>{inMap ? "In map" : inRoom ? "In hideout" : controller.party ? "Party ready" : "Online"}</em>
          </div>}

          {!controller.party || isSolo ? (
            <section className="party-finder" aria-label="Public parties">
              <header>
                <div><span>Open groups</span><strong>{controller.publicParties.length} public {controller.publicParties.length === 1 ? "party" : "parties"}</strong></div>
                <div className="party-finder-actions">
                  <button type="button" className="quiet" onClick={() => void controller.refreshParties()} disabled={controller.busy}>Refresh</button>
                  <button type="button" onClick={() => void createAndEnter()} disabled={controller.busy}>Create public party</button>
                </div>
              </header>
              <div className="public-party-list">
                {controller.publicParties.map((candidate) => {
                  const full = candidate.memberCount >= candidate.maximumMembers;
                  return <article key={candidate.id} className={full ? "full" : ""}>
                    <i className={`class-crest ${candidate.leader.classId}`}>{candidate.leader.classId[0].toUpperCase()}</i>
                    <div className="public-party-name"><strong>{candidate.name}</strong><span>{candidate.leader.classId} · level {candidate.leader.level}</span></div>
                    <div className={`public-party-activity ${candidate.activity}`}><span>{candidate.activity === "map" ? "Mapping" : "In hideout"}</span><small>{candidate.activeMap ? `${candidate.activeMap.name} · Tier ${candidate.activeMap.tier}` : "Ready for adventure"}</small></div>
                    <b>{candidate.memberCount}/{candidate.maximumMembers}</b>
                    <button type="button" onClick={() => void joinAndEnter(candidate.id)} disabled={controller.busy || full}>{full ? "Full" : "Join"}</button>
                  </article>;
                })}
                {controller.publicParties.length === 0 && <div className="public-party-empty"><i>✦</i><strong>No public parties yet</strong><span>Be the first to open your hideout to other players.</span><button type="button" onClick={() => void createAndEnter()} disabled={controller.busy}>Create the first party</button></div>}
              </div>
              <footer><span>All parties are public</span><small>The list updates automatically every two seconds.</small></footer>
            </section>
          ) : controller.trades.length > 0 ? (
            <TradeConsole controller={controller} />
          ) : (
            <div className="party-room-card">
              <header><div><span>Public party</span><strong>{`${leaderName}'s Party`}</strong></div><small>{controller.party.memberCharacterIds.length}/4 players</small></header>
              <div className="party-roster">
                {controller.party.memberCharacterIds.map((characterId, index) => {
                  const online = controller.connectedPlayers.find((player) => player.characterId === characterId);
                  const isSelf = characterId === controller.session?.player.characterId;
                  return <div key={characterId} className={online ? "online" : ""}><i>{index + 1}</i><span>{online?.name ?? (isSelf ? controller.session?.player.characterName : "Party member")}</span><em>{online ? "Hideout" : characterId === controller.party?.leaderCharacterId ? "Leader" : "Ready"}</em>{!isSelf && <button type="button" onClick={() => void controller.startTrade(characterId)} disabled={controller.busy}>Trade</button>}</div>;
                })}
                {Array.from({ length: 4 - controller.party.memberCharacterIds.length }, (_, index) => <div className="empty" key={`empty-${index}`}><i>+</i><span>Public slot</span><em>Open to players</em></div>)}
              </div>
              <footer>
                {!inRoom && !inMap && <button type="button" onClick={() => void controller.enterHideout()} disabled={controller.busy}>Reconnect to shared hideout</button>}
                {!inMap && <button type="button" onClick={onOpenMapDevice} disabled={controller.busy || (!isLeader && !controller.activeMap)}>{controller.activeMap ? `View ${controller.activeMap.map.baseName} portals` : isLeader ? "Use map device" : "Waiting for map"}</button>}
                {inMap && <button type="button" onClick={() => void controller.leaveMap()} disabled={controller.busy}>Return to shared hideout</button>}
                <button type="button" className="quiet" onClick={() => void controller.leaveParty()} disabled={controller.busy}>Leave party</button>
              </footer>
              {!isLeader && !controller.activeMap && <small className="party-hint">The leader opens the map; it then appears here for every party member.</small>}
            </div>
          )}
        </>
      )}
      {controller.error && <div className="multiplayer-error" role="alert">{controller.error}</div>}
    </div>
  );
}

function itemName(item: InventoryItem): string {
  if (isEquipmentItem(item)) return item.baseName;
  if (isMapItem(item)) return `${item.baseName} · T${item.tier}`;
  if (isFlaskItem(item)) return `${FLASK_DEFINITIONS[item.baseId].name} ×${item.stackSize}`;
  if (isCurrencyItem(item)) return `${CURRENCY_DEFINITIONS[item.baseId].name} ×${item.stackSize}`;
  return "Item";
}

function TradeConsole({ controller }: { controller: MultiplayerHideoutController }) {
  const trade = controller.trades.find((candidate) => candidate.id === controller.activeTradeId) ?? controller.trades[0];
  const selfId = controller.session?.player.characterId ?? "";
  if (!trade || !controller.authoritativeProfile) return null;
  const ownOffer = trade?.offers.find((offer) => offer.characterId === selfId);
  return <TradeEditor key={`${trade.id}:${ownOffer?.itemIds.join("|") ?? ""}`} controller={controller} trade={trade} selfId={selfId} />;
}

function TradeEditor({ controller, trade, selfId }: {
  controller: MultiplayerHideoutController;
  trade: NonNullable<MultiplayerHideoutController["trades"][number]>;
  selfId: string;
}) {
  const ownOffer = trade.offers.find((offer) => offer.characterId === selfId);
  const otherOffer = trade?.offers.find((offer) => offer.characterId !== selfId);
  const other = trade?.participantDetails.find((participant) => participant.characterId !== selfId);
  const offeredSignature = ownOffer?.itemIds.join("|") ?? "";
  const [draftItemIds, setDraftItemIds] = useState<string[]>(ownOffer?.itemIds ?? []);

  const profile = controller.authoritativeProfile!.profile;
  const eligibleItems = [
    ...profile.inventory.entries.map((entry) => entry.item),
    ...profile.stash.tabs.flatMap((tab) => tab.container.entries.map((entry) => entry.item)),
  ];
  const toggle = (itemId: string) => setDraftItemIds((current) => current.includes(itemId)
    ? current.filter((candidate) => candidate !== itemId)
    : [...current, itemId]);
  const changed = offeredSignature !== draftItemIds.join("|");

  return (
    <section className="trade-console" aria-label="Secure item trade">
      <header>
        <div><span>Atomic escrow trade</span><h4>Trade with {other?.characterName ?? "party member"}</h4></div>
        {controller.trades.length > 1 && <nav>{controller.trades.map((candidate) => <button type="button" className={candidate.id === trade.id ? "active" : ""} key={candidate.id} onClick={() => controller.selectTrade(candidate.id)}>{candidate.participantDetails.find((participant) => participant.characterId !== selfId)?.characterName ?? "Trade"}</button>)}</nav>}
      </header>
      <div className="trade-columns">
        <div className={ownOffer?.accepted ? "trade-offer accepted" : "trade-offer"}>
          <div className="trade-offer-title"><strong>Your offer</strong><span>{ownOffer?.accepted ? "Accepted" : changed ? "Unconfirmed changes" : "Offer locked"}</span></div>
          <div className="trade-item-picker">
            {eligibleItems.map((item) => <label className={draftItemIds.includes(item.id) ? "selected" : ""} key={item.id}><input type="checkbox" checked={draftItemIds.includes(item.id)} onChange={() => toggle(item.id)} /><ItemIcon item={item} /><span>{itemName(item)}</span></label>)}
            {eligibleItems.length === 0 && <p>No tradable items in your backpack or stash.</p>}
          </div>
          <button type="button" disabled={controller.busy || !changed} onClick={() => void controller.updateTradeOffer(trade.id, draftItemIds)}>Lock this offer</button>
        </div>
        <div className={otherOffer?.accepted ? "trade-offer accepted" : "trade-offer"}>
          <div className="trade-offer-title"><strong>{other?.characterName ?? "Their"} offer</strong><span>{otherOffer?.accepted ? "Accepted" : "Reviewing"}</span></div>
          <div className="trade-receive-list">
            {otherOffer?.items.map((item) => <div key={item.id}><ItemIcon item={item} /><span>{itemName(item)}</span></div>)}
            {!otherOffer?.items.length && <p>No items offered yet.</p>}
          </div>
        </div>
      </div>
      <footer>
        <small>Offer changes clear both acceptances. The server verifies ownership and capacity, then swaps every item atomically.</small>
        <button type="button" className="quiet" disabled={controller.busy} onClick={() => void controller.cancelTrade(trade.id)}>Cancel</button>
        <button type="button" className="accept" disabled={controller.busy || changed || ownOffer?.accepted} onClick={() => void controller.acceptTrade(trade.id)}>{ownOffer?.accepted ? "Waiting for other player" : "Accept exact trade"}</button>
      </footer>
    </section>
  );
}
