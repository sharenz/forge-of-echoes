export type TradeState = "open" | "completed" | "cancelled";

import type { InventoryItem } from "../../app/game/domain";

export interface TradeOfferSnapshot {
  characterId: string;
  itemIds: string[];
  items: InventoryItem[];
  accepted: boolean;
}

export interface TradeParticipantSnapshot {
  characterId: string;
  characterName: string;
}

export interface TradeSnapshot {
  id: string;
  state: TradeState;
  revision: number;
  participants: [string, string];
  participantDetails: [TradeParticipantSnapshot, TradeParticipantSnapshot];
  offers: TradeOfferSnapshot[];
}

export class TradeError extends Error {
  constructor(public readonly code:
    | "not_found"
    | "unauthorized"
    | "invalid_state"
    | "revision_conflict"
    | "invalid_item"
    | "item_locked"
    | "recipient_inventory_full") {
    super(code);
  }
}

export interface TradeRepository {
  createTrade(initiatorCharacterId: string, targetCharacterId: string): Promise<TradeSnapshot>;
  listOpenTrades(characterId: string): Promise<TradeSnapshot[]>;
  getTrade(tradeId: string, characterId: string): Promise<TradeSnapshot>;
  setOffer(tradeId: string, characterId: string, expectedRevision: number, itemIds: string[]): Promise<TradeSnapshot>;
  acceptTrade(tradeId: string, characterId: string, expectedRevision: number): Promise<TradeSnapshot>;
  cancelTrade(tradeId: string, characterId: string): Promise<TradeSnapshot>;
  close(): Promise<void>;
}
