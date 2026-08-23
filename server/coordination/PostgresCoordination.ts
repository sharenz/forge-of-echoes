import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { MapItem } from "../../app/game/domain";
import { MULTIPLAYER_LIMITS } from "../../multiplayer/protocol";
import type { PlayerRepository } from "../persistence/PlayerRepository";
import { ExpeditionError, type ExpeditionCoordinator, type OpenExpeditionInput, type OpenedExpedition } from "./ExpeditionCoordinator";
import { PartyError, type ActivePartyMap, type PartyCoordinator, type PartySnapshot } from "./PartyCoordinator";
import type { SocialEventBus } from "../social/SocialEventBus";

interface PartyRow {
  id: string;
  visibility: PartySnapshot["visibility"];
  leader_character_id: string;
  revision: string;
  current_expedition_id: string | null;
}

interface PartySnapshotRow extends PartyRow {
  member_character_ids: string[];
  active_map: ActivePartyMap | null;
}

export class PostgresCoordination implements PartyCoordinator, ExpeditionCoordinator {
  private readonly pool: Pool;
  private readonly leasePool: Pool;
  private readonly initialReap: Promise<void>;
  private readonly reapTimer: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    connectionString: string,
    private readonly players: PlayerRepository,
    private readonly presenceGraceMilliseconds: number = MULTIPLAYER_LIMITS.partyPresenceGraceMilliseconds,
    private readonly roomLeaseMilliseconds: number = 45_000,
    private readonly social?: SocialEventBus,
  ) {
    this.pool = new Pool({ connectionString, max: 8 });
    // Lease renewals must never queue behind profile/social reads. This small
    // dedicated pool protects presence and live map ownership under load.
    this.leasePool = new Pool({ connectionString, max: 2 });
    this.initialReap = this.reapExpired().catch((error) => {
      console.error("[coordination] initial expiry reap failed", error);
    });
    this.reapTimer = setInterval(() => {
      void this.reapExpired().catch((error) => console.error("[coordination] expiry reap failed", error));
    }, 5_000);
    this.reapTimer.unref();
  }

  async create(leaderCharacterId: string): Promise<PartySnapshot> {
    return this.createFor(leaderCharacterId, "public");
  }

  async createSolo(leaderCharacterId: string): Promise<PartySnapshot> {
    return this.createFor(leaderCharacterId, "solo");
  }

  async join(characterId: string, partyId: string): Promise<PartySnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const targetResult = await client.query<PartyRow>(
        "SELECT id, visibility, leader_character_id, revision, current_expedition_id FROM parties WHERE id = $1 FOR UPDATE",
        [partyId],
      );
      const target = targetResult.rows[0];
      if (!target || target.visibility !== "public") throw new PartyError("not_found");
      const existing = await client.query<{ party_id: string; visibility: PartySnapshot["visibility"]; current_expedition_id: string | null }>(
        `SELECT members.party_id, parties.visibility, parties.current_expedition_id
         FROM party_members AS members
         INNER JOIN parties ON parties.id = members.party_id
         WHERE members.character_id = $1 FOR UPDATE OF parties`,
        [characterId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].visibility === "solo" && !existing.rows[0].current_expedition_id) {
          await this.removeMember(client, characterId, existing.rows[0].party_id);
        } else {
          throw new PartyError("already_in_party");
        }
      }
      const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM party_members WHERE party_id = $1", [partyId]);
      if (Number(count.rows[0].count) >= MULTIPLAYER_LIMITS.playersPerRoom) throw new PartyError("party_full");
      await client.query("INSERT INTO party_members (party_id, character_id) VALUES ($1, $2)", [partyId, characterId]);
      await this.insertPendingLease(client, partyId, characterId);
      await client.query("UPDATE parties SET revision = revision + 1, updated_at = now() WHERE id = $1", [partyId]);
      await client.query("COMMIT");
      const party = await this.get(partyId);
      if (!party) throw new PartyError("not_found");
      return party;
    } catch (error) {
      await client.query("ROLLBACK");
      if (this.isUniqueViolation(error)) throw new PartyError("already_in_party");
      throw error;
    } finally {
      client.release();
    }
  }

  async leave(characterId: string): Promise<PartySnapshot | null> {
    const client = await this.pool.connect();
    let partyId: string | null = null;
    try {
      await client.query("BEGIN");
      const membership = await client.query<{ party_id: string }>(
        "SELECT party_id FROM party_members WHERE character_id = $1 FOR UPDATE",
        [characterId],
      );
      partyId = membership.rows[0]?.party_id ?? null;
      if (!partyId) {
        await client.query("COMMIT");
        return null;
      }
      await client.query("SELECT id FROM parties WHERE id = $1 FOR UPDATE", [partyId]);
      await this.removeMember(client, characterId, partyId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return partyId ? this.get(partyId) : null;
  }

  async getForMember(characterId: string): Promise<PartySnapshot | null> {
    await this.initialReap;
    return (await this.getSnapshots(
      `WHERE EXISTS (
         SELECT 1 FROM party_members AS membership
         WHERE membership.party_id = parties.id AND membership.character_id = $1
       )`,
      [characterId],
    ))[0] ?? null;
  }

  async get(partyId: string): Promise<PartySnapshot | null> {
    await this.initialReap;
    return this.getSnapshot(partyId);
  }

  async listPublic(): Promise<PartySnapshot[]> {
    await this.initialReap;
    return this.getSnapshots("WHERE parties.visibility = 'public' ORDER BY parties.created_at, parties.id", []);
  }

  async isMember(partyId: string, characterId: string): Promise<boolean> {
    await this.initialReap;
    const result = await this.pool.query("SELECT 1 FROM party_members WHERE party_id = $1 AND character_id = $2", [partyId, characterId]);
    return Boolean(result.rowCount);
  }

  async connect(partyId: string, characterId: string, connectionId: string): Promise<void> {
    await this.leasePool.query(
      `INSERT INTO party_connections (connection_id, party_id, character_id, lease_expires_at)
       SELECT $3, $1, $2, now() + ($4 * interval '1 millisecond')
       WHERE EXISTS (SELECT 1 FROM party_members WHERE party_id = $1 AND character_id = $2)
       ON CONFLICT (connection_id) DO UPDATE SET
         party_id = EXCLUDED.party_id, character_id = EXCLUDED.character_id,
         lease_expires_at = EXCLUDED.lease_expires_at, updated_at = now()`,
      [partyId, characterId, connectionId, this.presenceGraceMilliseconds],
    );
  }

  async renewConnection(partyId: string, characterId: string, connectionId: string): Promise<void> {
    await this.connect(partyId, characterId, connectionId);
  }

  async disconnect(partyId: string, characterId: string, connectionId: string): Promise<void> {
    await this.leasePool.query(
      `UPDATE party_connections
       SET lease_expires_at = now() + ($4 * interval '1 millisecond'), updated_at = now()
       WHERE connection_id = $3 AND party_id = $1 AND character_id = $2`,
      [partyId, characterId, connectionId, this.presenceGraceMilliseconds],
    );
  }

  async open(input: OpenExpeditionInput): Promise<OpenedExpedition> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const partyResult = await client.query<PartyRow>(
        "SELECT id, visibility, leader_character_id, revision, current_expedition_id FROM parties WHERE id = $1 FOR UPDATE",
        [input.partyId],
      );
      const party = partyResult.rows[0];
      if (!party) throw new ExpeditionError("not_found");
      if (party.leader_character_id !== input.leaderCharacterId) throw new ExpeditionError("not_leader");
      if (Number(party.revision) !== input.partyRevision) throw new ExpeditionError("party_revision_conflict");
      const members = await client.query<{ character_id: string }>(
        "SELECT character_id FROM party_members WHERE party_id = $1 ORDER BY joined_at, character_id FOR SHARE",
        [input.partyId],
      );
      const memberIds = members.rows.map((row) => row.character_id);
      if (!this.sameMembers(memberIds, input.ticketClaims.allowedCharacterIds)) throw new ExpeditionError("party_revision_conflict");
      const character = await client.query<{ profile_version: string }>(
        "SELECT profile_version FROM characters WHERE id = $1 AND profile_initialized = true FOR UPDATE",
        [input.leaderCharacterId],
      );
      if (!character.rows[0]) throw new ExpeditionError("not_found");
      if (Number(character.rows[0].profile_version) !== input.expectedProfileRevision) {
        throw new ExpeditionError("profile_revision_conflict");
      }
      const mapResult = await client.query<{ item_data: MapItem }>(
        `SELECT items.item_data
         FROM item_instances AS items
         INNER JOIN item_locations AS locations ON locations.item_id = items.id
         WHERE items.id = $1 AND items.owner_character_id = $2 AND items.kind = 'map'
           AND items.locked_trade_id IS NULL AND locations.character_id = $2 AND locations.location = 'map_device'
         FOR UPDATE OF items, locations`,
        [input.map.id, input.leaderCharacterId],
      );
      const map = mapResult.rows[0]?.item_data;
      if (!map) throw new ExpeditionError("no_map");
      if (party.current_expedition_id) {
        await client.query(
          "UPDATE map_expeditions SET status = 'superseded', updated_at = now() WHERE id = $1 AND status = 'active'",
          [party.current_expedition_id],
        );
      }
      await client.query("DELETE FROM item_instances WHERE id = $1 AND owner_character_id = $2", [input.map.id, input.leaderCharacterId]);
      const updated = await client.query(
        `UPDATE characters SET profile_version = profile_version + 1, updated_at = now()
         WHERE id = $1 AND profile_version = $2 RETURNING profile_version`,
        [input.leaderCharacterId, input.expectedProfileRevision],
      );
      if (!updated.rowCount) throw new ExpeditionError("profile_revision_conflict");
      await client.query(
        `INSERT INTO map_expeditions
           (id, ticket_id, party_id, owner_character_id, map_item_id, map_data, map_ticket,
            tier, seed, allowed_character_ids, expires_at)
         VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[], to_timestamp($10 / 1000.0))`,
        [input.ticketClaims.ticketId, input.partyId, input.leaderCharacterId, input.map.id,
          JSON.stringify(map), input.mapTicket, input.ticketClaims.tier, input.ticketClaims.seed,
          memberIds, input.ticketClaims.expiresAt],
      );
      await client.query(
        `INSERT INTO map_portals (expedition_id, portal_index)
         SELECT $1, generate_series(0, $2 - 1)`,
        [input.ticketClaims.ticketId, MULTIPLAYER_LIMITS.portalsPerMap],
      );
      await client.query(
        `UPDATE parties SET current_expedition_id = $2, revision = revision + 1, updated_at = now()
         WHERE id = $1`,
        [input.partyId, input.ticketClaims.ticketId],
      );
      await client.query("COMMIT");
      const [authoritativeProfile, updatedParty] = await Promise.all([
        this.players.loadProfile(input.leaderCharacterId),
        this.getSnapshot(input.partyId),
      ]);
      if (!authoritativeProfile || !updatedParty) throw new ExpeditionError("not_found");
      return { map, mapTicket: input.mapTicket, ticketClaims: input.ticketClaims, authoritativeProfile, party: updatedParty };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimRoom(ticketId: string, roomId: string): Promise<boolean> {
    const result = await this.leasePool.query(
      `UPDATE map_expeditions
       SET room_id = $2,
           room_lease_expires_at = now() + ($3 * interval '1 millisecond'),
           updated_at = now()
       WHERE ticket_id = $1 AND status = 'active' AND expires_at > now()
         AND (room_id IS NULL OR room_lease_expires_at <= now())
       RETURNING id`,
      [ticketId, roomId, this.roomLeaseMilliseconds],
    );
    return Boolean(result.rowCount);
  }

  async renewRoom(ticketId: string, roomId: string): Promise<boolean> {
    const result = await this.leasePool.query(
      `UPDATE map_expeditions
       SET room_lease_expires_at = now() + ($3 * interval '1 millisecond'), updated_at = now()
       WHERE ticket_id = $1 AND room_id = $2 AND status = 'active' AND expires_at > now()
       RETURNING id`,
      [ticketId, roomId, this.roomLeaseMilliseconds],
    );
    return Boolean(result.rowCount);
  }

  async clear(ownerCharacterId: string, ticketId: string, roomId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const expedition = await client.query<{ id: string; party_id: string }>(
        `UPDATE map_expeditions SET status = 'closed', room_lease_expires_at = NULL, updated_at = now()
         WHERE ticket_id = $1 AND owner_character_id = $2 AND room_id = $3 AND status = 'active'
         RETURNING id, party_id`,
        [ticketId, ownerCharacterId, roomId],
      );
      if (expedition.rows[0]) {
        await client.query(
          `UPDATE parties SET current_expedition_id = NULL, revision = revision + 1, updated_at = now()
           WHERE id = $1 AND current_expedition_id = $2`,
          [expedition.rows[0].party_id, expedition.rows[0].id],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async consumePortal(characterId: string, ticketId: string, portalIndex: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE map_portals AS portals
       SET used_by_character_id = $1, used_at = now()
       FROM map_expeditions AS expeditions, parties
       WHERE portals.expedition_id = expeditions.id
         AND expeditions.ticket_id = $2 AND expeditions.status = 'active' AND expeditions.expires_at > now()
         AND parties.id = expeditions.party_id AND parties.current_expedition_id = expeditions.id
         AND portals.portal_index = $3
         -- A portal is consumed by its first character, but that same
         -- character may reconnect through it after a socket or worker
         -- restart. It remains unavailable to every other character.
         AND (portals.used_at IS NULL OR portals.used_by_character_id = $1)
         AND EXISTS (
           SELECT 1 FROM party_members
           WHERE party_members.party_id = expeditions.party_id AND party_members.character_id = $1
         )
       RETURNING portals.portal_index`,
      [characterId, ticketId, portalIndex],
    );
    return Boolean(result.rowCount);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.reapTimer);
    await this.initialReap;
    await Promise.all([this.pool.end(), this.leasePool.end()]);
  }

  private async createFor(characterId: string, visibility: PartySnapshot["visibility"], retryConcurrentCreate = true): Promise<PartySnapshot> {
    const client = await this.pool.connect();
    let partyId = "";
    let shouldRetry = false;
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ party_id: string; visibility: PartySnapshot["visibility"] }>(
        `SELECT members.party_id, parties.visibility
         FROM party_members AS members INNER JOIN parties ON parties.id = members.party_id
         WHERE members.character_id = $1 FOR UPDATE OF parties`,
        [characterId],
      );
      if (existing.rows[0]) {
        partyId = existing.rows[0].party_id;
        if (visibility === "public" && existing.rows[0].visibility === "solo") {
          await client.query("UPDATE parties SET visibility = 'public', revision = revision + 1, updated_at = now() WHERE id = $1", [partyId]);
        }
      } else {
        partyId = randomUUID();
        await client.query(
          "INSERT INTO parties (id, visibility, leader_character_id) VALUES ($1, $2, $3)",
          [partyId, visibility, characterId],
        );
        await client.query("INSERT INTO party_members (party_id, character_id) VALUES ($1, $2)", [partyId, characterId]);
        await this.insertPendingLease(client, partyId, characterId);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (retryConcurrentCreate && this.isUniqueViolation(error)) shouldRetry = true;
      else throw error;
    } finally {
      client.release();
    }
    if (shouldRetry) return this.createFor(characterId, visibility, false);
    const party = await this.get(partyId);
    if (!party) throw new PartyError("not_found");
    return party;
  }

  private async getSnapshot(partyId: string): Promise<PartySnapshot | null> {
    return (await this.getSnapshots("WHERE parties.id = $1", [partyId]))[0] ?? null;
  }

  private async getSnapshots(whereClause: string, parameters: unknown[]): Promise<PartySnapshot[]> {
    const result = await this.pool.query<PartySnapshotRow>(
      `SELECT parties.id, parties.visibility, parties.leader_character_id, parties.revision,
              parties.current_expedition_id,
              COALESCE(members.character_ids, ARRAY[]::uuid[]) AS member_character_ids,
              CASE WHEN expeditions.id IS NULL THEN NULL ELSE jsonb_build_object(
                'ticketId', expeditions.ticket_id,
                'mapTicket', expeditions.map_ticket,
                'map', expeditions.map_data,
                'expiresAt', (extract(epoch FROM expeditions.expires_at) * 1000)::bigint,
                'roomId', CASE WHEN expeditions.room_lease_expires_at > now() THEN expeditions.room_id ELSE NULL END,
                'portals', COALESCE(portals.entries, '[]'::jsonb)
              ) END AS active_map
       FROM parties
       LEFT JOIN LATERAL (
         SELECT array_agg(party_members.character_id ORDER BY party_members.joined_at, party_members.character_id) AS character_ids
         FROM party_members WHERE party_members.party_id = parties.id
       ) AS members ON true
       LEFT JOIN map_expeditions AS expeditions
         ON expeditions.id = parties.current_expedition_id
        AND expeditions.status = 'active' AND expeditions.expires_at > now()
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('index', map_portals.portal_index, 'used', map_portals.used_at IS NOT NULL)
                          ORDER BY map_portals.portal_index) AS entries
         FROM map_portals WHERE map_portals.expedition_id = expeditions.id
       ) AS portals ON true
       ${whereClause}`,
      parameters,
    );
    return result.rows.map((row) => ({
      id: row.id,
      visibility: row.visibility,
      leaderCharacterId: row.leader_character_id,
      memberCharacterIds: row.member_character_ids,
      revision: Number(row.revision),
      activeMap: row.active_map,
    }));
  }

  private async reapExpired(existingClient?: PoolClient): Promise<void> {
    const client = existingClient ?? await this.pool.connect();
    const ownsTransaction = !existingClient;
    try {
      if (ownsTransaction) await client.query("BEGIN");
      await client.query("DELETE FROM party_connections WHERE lease_expires_at <= now()");
      const affected = await client.query<{ party_id: string }>(
        `WITH removed AS (
           DELETE FROM party_members AS members
           WHERE NOT EXISTS (
             SELECT 1 FROM party_connections AS connections
             WHERE connections.party_id = members.party_id
               AND connections.character_id = members.character_id
               AND connections.lease_expires_at > now()
           )
           AND NOT EXISTS (
             SELECT 1 FROM parties
             INNER JOIN map_expeditions ON map_expeditions.id = parties.current_expedition_id
             WHERE parties.id = members.party_id
               AND map_expeditions.status = 'active' AND map_expeditions.expires_at > now()
           )
           RETURNING members.party_id
         ) SELECT DISTINCT party_id FROM removed`,
      );
      for (const { party_id: partyId } of affected.rows) {
        const leader = await client.query<{ character_id: string }>(
          "SELECT character_id FROM party_members WHERE party_id = $1 ORDER BY joined_at, character_id LIMIT 1",
          [partyId],
        );
        if (!leader.rows[0]) await client.query("DELETE FROM parties WHERE id = $1", [partyId]);
        else await client.query(
          "UPDATE parties SET leader_character_id = $2, revision = revision + 1, updated_at = now() WHERE id = $1",
          [partyId, leader.rows[0].character_id],
        );
      }
      if (ownsTransaction) await client.query("COMMIT");
      if (affected.rows.length > 0) {
        await this.social?.publish({
          scope: "party",
          partyIds: affected.rows.map((row) => row.party_id),
          publicPartiesChanged: true,
        }).catch((error) => console.error("[coordination] expiry invalidation failed", error));
      }
    } catch (error) {
      if (ownsTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (ownsTransaction) client.release();
    }
  }

  private async removeMember(client: PoolClient, characterId: string, partyId: string): Promise<void> {
    await client.query("DELETE FROM party_members WHERE party_id = $1 AND character_id = $2", [partyId, characterId]);
    const nextLeader = await client.query<{ character_id: string }>(
      "SELECT character_id FROM party_members WHERE party_id = $1 ORDER BY joined_at, character_id LIMIT 1",
      [partyId],
    );
    if (!nextLeader.rows[0]) await client.query("DELETE FROM parties WHERE id = $1", [partyId]);
    else await client.query(
      `UPDATE parties SET
         leader_character_id = CASE WHEN leader_character_id = $2 THEN $3 ELSE leader_character_id END,
         revision = revision + 1, updated_at = now()
       WHERE id = $1`,
      [partyId, characterId, nextLeader.rows[0].character_id],
    );
  }

  private async insertPendingLease(client: PoolClient, partyId: string, characterId: string): Promise<void> {
    await client.query(
      `INSERT INTO party_connections (connection_id, party_id, character_id, lease_expires_at)
       VALUES ($1, $2, $3, now() + ($4 * interval '1 millisecond'))`,
      [`pending:${randomUUID()}`, partyId, characterId, this.presenceGraceMilliseconds],
    );
  }

  private sameMembers(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.every((member, index) => member === sortedRight[index]);
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
  }
}
