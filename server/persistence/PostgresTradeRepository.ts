import { Pool, type PoolClient } from "pg";
import type { InventoryItem, ItemContainer } from "../../app/game/domain";
import { insertItems } from "../../app/game/item-container";
import { TradeError, type TradeOfferSnapshot, type TradeRepository, type TradeSnapshot, type TradeState } from "./TradeRepository";

interface TradeRow { id: string; state: TradeState; revision: string }
interface ParticipantRow { character_id: string; character_name: string; accepted_revision: string | null }
interface OfferRow { item_id: string; offered_by: string; item_data: InventoryItem }
interface BackpackRow { id: string; item_data: InventoryItem; position_x: number; position_y: number }

export class PostgresTradeRepository implements TradeRepository {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 6 });
  }

  async createTrade(initiatorCharacterId: string, targetCharacterId: string): Promise<TradeSnapshot> {
    if (initiatorCharacterId === targetCharacterId) throw new TradeError("unauthorized");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const characters = await client.query<{ id: string }>(
        "SELECT id FROM characters WHERE id = ANY($1::uuid[]) FOR SHARE",
        [[initiatorCharacterId, targetCharacterId]],
      );
      if (characters.rowCount !== 2) throw new TradeError("not_found");
      const trade = await client.query<TradeRow>("INSERT INTO trades DEFAULT VALUES RETURNING id, state, revision");
      await client.query(
        "INSERT INTO trade_participants (trade_id, character_id) VALUES ($1, $2), ($1, $3)",
        [trade.rows[0].id, initiatorCharacterId, targetCharacterId],
      );
      await client.query("COMMIT");
      return await this.getTrade(trade.rows[0].id, initiatorCharacterId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getTrade(tradeId: string, characterId: string): Promise<TradeSnapshot> {
    const client = await this.pool.connect();
    try {
      return await this.snapshot(client, tradeId, characterId);
    } finally {
      client.release();
    }
  }

  async listOpenTrades(characterId: string): Promise<TradeSnapshot[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ id: string }>(
        `SELECT trades.id
         FROM trades
         INNER JOIN trade_participants ON trade_participants.trade_id = trades.id
         WHERE trade_participants.character_id = $1 AND trades.state = 'open'
         ORDER BY trades.updated_at DESC`,
        [characterId],
      );
      return await Promise.all(result.rows.map((row) => this.snapshot(client, row.id, characterId)));
    } finally {
      client.release();
    }
  }

  async setOffer(tradeId: string, characterId: string, expectedRevision: number, itemIds: string[]): Promise<TradeSnapshot> {
    if (new Set(itemIds).size !== itemIds.length || itemIds.length > 24) throw new TradeError("invalid_item");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const trade = await this.lockTrade(client, tradeId, characterId, expectedRevision);
      if (trade.state !== "open") throw new TradeError("invalid_state");
      const previous = await client.query<{ item_id: string }>(
        "DELETE FROM trade_offers WHERE trade_id = $1 AND offered_by = $2 RETURNING item_id",
        [tradeId, characterId],
      );
      if (previous.rows.length) {
        await client.query(
          "UPDATE item_instances SET locked_trade_id = NULL WHERE id = ANY($1::uuid[]) AND locked_trade_id = $2",
          [previous.rows.map((row) => row.item_id), tradeId],
        );
      }
      if (itemIds.length) {
        const eligible = await client.query<{ id: string; locked_trade_id: string | null }>(
          `SELECT item_instances.id, item_instances.locked_trade_id
           FROM item_instances
           INNER JOIN item_locations ON item_locations.item_id = item_instances.id
           WHERE item_instances.id = ANY($1::uuid[])
             AND item_instances.owner_character_id = $2
             AND item_locations.character_id = $2
             AND item_locations.location IN ('backpack', 'stash')
           FOR UPDATE OF item_instances`,
          [itemIds, characterId],
        );
        if (eligible.rows.length !== itemIds.length) throw new TradeError("invalid_item");
        if (eligible.rows.some((item) => item.locked_trade_id && item.locked_trade_id !== tradeId)) throw new TradeError("item_locked");
        await client.query(
          "UPDATE item_instances SET locked_trade_id = $2 WHERE id = ANY($1::uuid[]) AND owner_character_id = $3",
          [itemIds, tradeId, characterId],
        );
        for (const itemId of itemIds) {
          await client.query(
            "INSERT INTO trade_offers (trade_id, item_id, offered_by) VALUES ($1, $2, $3)",
            [tradeId, itemId, characterId],
          );
        }
      }
      const nextRevision = Number(trade.revision) + 1;
      await client.query("UPDATE trade_participants SET accepted_revision = NULL WHERE trade_id = $1", [tradeId]);
      await client.query("UPDATE trades SET revision = $2, updated_at = now() WHERE id = $1", [tradeId, nextRevision]);
      await client.query("COMMIT");
      return await this.getTrade(tradeId, characterId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async acceptTrade(tradeId: string, characterId: string, expectedRevision: number): Promise<TradeSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const trade = await this.lockTrade(client, tradeId, characterId, expectedRevision);
      if (trade.state !== "open") throw new TradeError("invalid_state");
      await client.query(
        "UPDATE trade_participants SET accepted_revision = $3 WHERE trade_id = $1 AND character_id = $2",
        [tradeId, characterId, expectedRevision],
      );
      const participants = await client.query<ParticipantRow>(
        "SELECT character_id, accepted_revision FROM trade_participants WHERE trade_id = $1 ORDER BY character_id FOR UPDATE",
        [tradeId],
      );
      if (participants.rows.every((participant) => Number(participant.accepted_revision) === expectedRevision)) {
        await this.complete(client, tradeId, participants.rows.map((participant) => participant.character_id) as [string, string]);
        await client.query(
          "UPDATE trades SET state = 'completed', revision = revision + 1, updated_at = now() WHERE id = $1",
          [tradeId],
        );
      }
      await client.query("COMMIT");
      return await this.getTrade(tradeId, characterId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelTrade(tradeId: string, characterId: string): Promise<TradeSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const trade = await this.lockTrade(client, tradeId, characterId);
      if (trade.state !== "open") throw new TradeError("invalid_state");
      const offers = await client.query<{ item_id: string }>("DELETE FROM trade_offers WHERE trade_id = $1 RETURNING item_id", [tradeId]);
      if (offers.rows.length) {
        await client.query(
          "UPDATE item_instances SET locked_trade_id = NULL WHERE id = ANY($1::uuid[]) AND locked_trade_id = $2",
          [offers.rows.map((row) => row.item_id), tradeId],
        );
      }
      await client.query("UPDATE trades SET state = 'cancelled', revision = revision + 1, updated_at = now() WHERE id = $1", [tradeId]);
      await client.query("COMMIT");
      return await this.getTrade(tradeId, characterId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async complete(client: PoolClient, tradeId: string, participants: [string, string]): Promise<void> {
    // Profile saves lock characters before item rows. Keep the same global lock
    // order here so a trade completion cannot deadlock against an inventory save.
    await client.query(
      "SELECT id FROM characters WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [participants],
    );
    const offers = await client.query<OfferRow>(
      `SELECT trade_offers.item_id, trade_offers.offered_by, item_instances.item_data
       FROM trade_offers
       INNER JOIN item_instances ON item_instances.id = trade_offers.item_id
       WHERE trade_offers.trade_id = $1
       ORDER BY trade_offers.item_id FOR UPDATE OF item_instances`,
      [tradeId],
    );
    const offerByOwner = new Map(participants.map((id) => [id, offers.rows.filter((offer) => offer.offered_by === id)]));
    const placements = new Map<string, ItemContainer>();
    for (const recipient of participants) {
      const outgoingIds = new Set((offerByOwner.get(recipient) ?? []).map((offer) => offer.item_id));
      const backpack = await client.query<BackpackRow>(
        `SELECT item_instances.id, item_instances.item_data, item_locations.position_x, item_locations.position_y
         FROM item_instances INNER JOIN item_locations ON item_locations.item_id = item_instances.id
         WHERE item_instances.owner_character_id = $1 AND item_locations.location = 'backpack'
         FOR UPDATE OF item_instances`,
        [recipient],
      );
      const container: ItemContainer = {
        id: "backpack",
        entries: backpack.rows.filter((row) => !outgoingIds.has(row.id)).map((row) => ({
          item: { ...row.item_data, id: row.id } as InventoryItem,
          x: row.position_x,
          y: row.position_y,
        })),
      };
      const sender = participants.find((id) => id !== recipient)!;
      const incoming = (offerByOwner.get(sender) ?? []).map((offer) => ({ ...offer.item_data, id: offer.item_id } as InventoryItem));
      const inserted = insertItems(container, incoming);
      if (inserted.unplaced.length) throw new TradeError("recipient_inventory_full");
      placements.set(recipient, inserted.container);
    }
    const itemIds = offers.rows.map((offer) => offer.item_id);
    if (itemIds.length) {
      await client.query("DELETE FROM item_locations WHERE item_id = ANY($1::uuid[])", [itemIds]);
      await client.query("DELETE FROM trade_offers WHERE trade_id = $1", [tradeId]);
      for (const offer of offers.rows) {
        const recipient = participants.find((id) => id !== offer.offered_by)!;
        await client.query(
          "UPDATE item_instances SET owner_character_id = $2, locked_trade_id = NULL, item_version = item_version + 1, updated_at = now() WHERE id = $1",
          [offer.item_id, recipient],
        );
      }
      for (const recipient of participants) {
        const incomingIds = new Set(offers.rows.filter((offer) => offer.offered_by !== recipient).map((offer) => offer.item_id));
        for (const entry of placements.get(recipient)!.entries.filter((entry) => incomingIds.has(entry.item.id))) {
          await client.query(
            `INSERT INTO item_locations (item_id, character_id, location, position_x, position_y)
             VALUES ($1, $2, 'backpack', $3, $4)`,
            [entry.item.id, recipient, entry.x, entry.y],
          );
          await client.query(
            "INSERT INTO economy_events (character_id, item_id, event_type, event_data) VALUES ($1, $2, 'trade_received', $3)",
            [recipient, entry.item.id, { tradeId }],
          );
        }
      }
    }
    await client.query(
      "UPDATE characters SET profile_version = profile_version + 1, updated_at = now() WHERE id = ANY($1::uuid[])",
      [participants],
    );
  }

  private async lockTrade(client: PoolClient, tradeId: string, characterId: string, expectedRevision?: number): Promise<TradeRow> {
    const result = await client.query<TradeRow>(
      `SELECT trades.id, trades.state, trades.revision
       FROM trades INNER JOIN trade_participants ON trade_participants.trade_id = trades.id
       WHERE trades.id = $1 AND trade_participants.character_id = $2
       FOR UPDATE OF trades`,
      [tradeId, characterId],
    );
    const trade = result.rows[0];
    if (!trade) throw new TradeError("not_found");
    if (expectedRevision !== undefined && Number(trade.revision) !== expectedRevision) throw new TradeError("revision_conflict");
    return trade;
  }

  private async snapshot(client: PoolClient, tradeId: string, characterId: string): Promise<TradeSnapshot> {
    const trade = await client.query<TradeRow>(
      `SELECT trades.id, trades.state, trades.revision
       FROM trades INNER JOIN trade_participants ON trade_participants.trade_id = trades.id
       WHERE trades.id = $1 AND trade_participants.character_id = $2`,
      [tradeId, characterId],
    );
    if (!trade.rows[0]) throw new TradeError("not_found");
    const revision = Number(trade.rows[0].revision);
    const [participantsResult, offersResult] = await Promise.all([
      client.query<ParticipantRow>(
        `SELECT trade_participants.character_id, characters.name AS character_name, trade_participants.accepted_revision
         FROM trade_participants
         INNER JOIN characters ON characters.id = trade_participants.character_id
         WHERE trade_participants.trade_id = $1
         ORDER BY trade_participants.character_id`,
        [tradeId],
      ),
      client.query<{ item_id: string; offered_by: string; item_data: InventoryItem }>(
        `SELECT trade_offers.item_id, trade_offers.offered_by, item_instances.item_data
         FROM trade_offers
         INNER JOIN item_instances ON item_instances.id = trade_offers.item_id
         WHERE trade_offers.trade_id = $1
         ORDER BY trade_offers.item_id`,
        [tradeId],
      ),
    ]);
    const participants = participantsResult.rows.map((row) => row.character_id) as [string, string];
    const offers: TradeOfferSnapshot[] = participantsResult.rows.map((participant) => ({
      characterId: participant.character_id,
      itemIds: offersResult.rows.filter((offer) => offer.offered_by === participant.character_id).map((offer) => offer.item_id),
      items: offersResult.rows
        .filter((offer) => offer.offered_by === participant.character_id)
        .map((offer) => ({ ...offer.item_data, id: offer.item_id } as InventoryItem)),
      accepted: Number(participant.accepted_revision) === revision,
    }));
    const participantDetails = participantsResult.rows.map((participant) => ({
      characterId: participant.character_id,
      characterName: participant.character_name,
    })) as TradeSnapshot["participantDetails"];
    return { id: tradeId, state: trade.rows[0].state, revision, participants, participantDetails, offers };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
