import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Pool, type PoolClient } from "pg";
import type { ActiveSkillId, CharacterClassId, CharacterEquipmentSlot, InventoryItem, PlayerProfile, StashTab } from "../../app/game/domain";
import { createAuthoritativeProfile } from "../domain/profile";
import { AccountNotFoundError, CharacterNameTakenError, CharacterNotFoundError, ItemLockedError, ProfileRevisionConflict } from "./errors";
import type { AccountIdentity, AuthoritativeProfile, CharacterRosterEntry, CharacterSummary, CreatePlayerInput, PlayerIdentity, PlayerRepository } from "./PlayerRepository";

interface AccountRow {
  id: string;
  handle: string;
}

interface PlayerRow {
  account_id: string;
  character_id: string;
  character_name: string;
  class_id: CharacterClassId;
}

interface CharacterRosterRow extends PlayerRow {
  level: number;
}

interface CharacterProfileRow extends PlayerRow {
  level: number;
  experience: string;
  allocated_strength: number;
  allocated_dexterity: number;
  allocated_intelligence: number;
  unspent_attribute_points: number;
  skill_levels: Record<ActiveSkillId, number>;
  unspent_skill_points: number;
  maps_completed: number;
  highest_wave: number;
  active_stash_tab_id: string;
  profile_version: string;
  profile_initialized: boolean;
}

interface StoredItemRow {
  id: string;
  item_data: InventoryItem;
  location: "backpack" | "stash" | "equipment" | "flask_belt" | "map_device" | "ground" | "trade_escrow";
  container_id: string | null;
  position_x: number | null;
  position_y: number | null;
  equipment_slot: CharacterEquipmentSlot | null;
}

interface ExistingItemRow extends StoredItemRow {
  locked_trade_id: string | null;
}

interface StoredStashTabRow {
  tab_id: string;
  name: string;
  sort_order: number;
}

interface ProfileItemLocation {
  item: InventoryItem;
  location: StoredItemRow["location"];
  containerId?: string;
  x?: number;
  y?: number;
  equipmentSlot?: CharacterEquipmentSlot;
}

function identity(row: PlayerRow): PlayerIdentity {
  return {
    accountId: row.account_id,
    characterId: row.character_id,
    characterName: row.character_name,
    classId: row.class_id,
  };
}

function rosterEntry(row: CharacterRosterRow): CharacterRosterEntry {
  return { ...identity(row), level: row.level };
}

export class PostgresPlayerRepository implements PlayerRepository {
  private readonly pool: Pool;
  private readonly writeTails = new Map<string, Promise<void>>();

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 8 });
  }

  async initialize(): Promise<void> {
    const migrationsDirectory = fileURLToPath(new URL("../db/migrations/", import.meta.url));
    await this.pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const migrations = (await readdir(migrationsDirectory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
    for (const filename of migrations) {
      const alreadyApplied = await this.pool.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [filename]);
      if (alreadyApplied.rowCount) continue;
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(await readFile(`${migrationsDirectory}/${filename}`, "utf8"));
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  }

  async createOrLoadAccount(rawHandle: string): Promise<AccountIdentity> {
    const result = await this.pool.query<AccountRow>(
      `INSERT INTO accounts (handle)
       VALUES ($1)
       ON CONFLICT (handle) DO UPDATE SET updated_at = now()
       RETURNING id, handle`,
      [rawHandle.trim().toLowerCase()],
    );
    return { accountId: result.rows[0].id, handle: result.rows[0].handle };
  }

  async listCharacters(accountId: string): Promise<CharacterRosterEntry[]> {
    const result = await this.pool.query<CharacterRosterRow>(
      `SELECT account_id, id AS character_id, name AS character_name, class_id, level
       FROM characters
       WHERE account_id = $1 AND profile_initialized = true
       ORDER BY created_at, id`,
      [accountId],
    );
    return result.rows.map(rosterEntry);
  }

  async createCharacter(accountId: string, input: Omit<CreatePlayerInput, "handle">): Promise<PlayerIdentity> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [accountId]);
      if (!account.rowCount) throw new AccountNotFoundError(accountId);
      const result = await client.query<PlayerRow>(
        `INSERT INTO characters (account_id, name, class_id)
         VALUES ($1, $2, $3)
         RETURNING account_id, id AS character_id, name AS character_name, class_id`,
        [accountId, input.characterName.trim(), input.classId],
      );
      const character = identity(result.rows[0]);
      await this.ensureInitialProfile(client, character.characterId, { ...input, handle: "server" });
      await client.query("COMMIT");
      return character;
    } catch (error) {
      await client.query("ROLLBACK");
      if (typeof error === "object" && error && "code" in error && error.code === "23505") {
        throw new CharacterNameTakenError();
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findAccountCharacter(accountId: string, characterId: string): Promise<PlayerIdentity | null> {
    const result = await this.pool.query<PlayerRow>(
      `SELECT account_id, id AS character_id, name AS character_name, class_id
       FROM characters WHERE account_id = $1 AND id = $2 AND profile_initialized = true`,
      [accountId, characterId],
    );
    return result.rows[0] ? identity(result.rows[0]) : null;
  }

  async findCharacter(characterId: string): Promise<CharacterSummary | null> {
    const result = await this.pool.query<CharacterRosterRow>(
      `SELECT account_id, id AS character_id, name AS character_name, class_id, level
       FROM characters WHERE id = $1 AND profile_initialized = true`,
      [characterId],
    );
    return result.rows[0] ? rosterEntry(result.rows[0]) : null;
  }

  async loadProfile(characterId: string): Promise<AuthoritativeProfile | null> {
    const client = await this.pool.connect();
    try {
      const character = await this.selectProfileCharacter(client, characterId);
      if (!character?.profile_initialized) return null;
      return await this.hydrateProfile(client, character);
    } finally {
      client.release();
    }
  }

  async saveProfile(characterId: string, expectedRevision: number, profile: PlayerProfile): Promise<AuthoritativeProfile> {
    return this.enqueueCharacterWrite(characterId, () => this.saveProfileNow(characterId, expectedRevision, profile));
  }

  private async saveProfileNow(characterId: string, expectedRevision: number, profile: PlayerProfile): Promise<AuthoritativeProfile> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await this.updateCharacterProgress(client, characterId, profile, expectedRevision + 1, expectedRevision);
      if (!updated) {
        const character = await this.selectProfileCharacter(client, characterId);
        if (!character?.profile_initialized) throw new CharacterNotFoundError(characterId);
        throw new ProfileRevisionConflict();
      }
      await this.persistProfile(client, characterId, profile, expectedRevision + 1, true);
      await client.query("COMMIT");
      return { profile: structuredClone(profile), revision: expectedRevision + 1 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async enqueueCharacterWrite<T>(characterId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeTails.get(characterId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    this.writeTails.set(characterId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.writeTails.get(characterId) === tail) this.writeTails.delete(characterId);
    }
  }

  private async ensureInitialProfile(client: PoolClient, characterId: string, input: CreatePlayerInput): Promise<void> {
    const result = await client.query<{ profile_initialized: boolean }>(
      "SELECT profile_initialized FROM characters WHERE id = $1 FOR UPDATE",
      [characterId],
    );
    if (result.rows[0]?.profile_initialized) return;
    await this.persistProfile(client, characterId, createAuthoritativeProfile(input), 1);
  }

  private async selectProfileCharacter(client: PoolClient, characterId: string, lock = false): Promise<CharacterProfileRow | null> {
    const result = await client.query<CharacterProfileRow>(
      `SELECT account_id, id AS character_id, name AS character_name, class_id,
              level, experience, allocated_strength, allocated_dexterity, allocated_intelligence,
              unspent_attribute_points, skill_levels, unspent_skill_points,
              maps_completed, highest_wave, active_stash_tab_id, profile_version, profile_initialized
       FROM characters WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
      [characterId],
    );
    return result.rows[0] ?? null;
  }

  private async hydrateProfile(client: PoolClient, character: CharacterProfileRow): Promise<AuthoritativeProfile> {
    const [itemsResult, tabsResult] = await Promise.all([
      client.query<StoredItemRow>(
        `SELECT item_instances.id, item_instances.item_data, item_locations.location,
                item_locations.container_id, item_locations.position_x, item_locations.position_y,
                item_locations.equipment_slot
         FROM item_instances
         INNER JOIN item_locations ON item_locations.item_id = item_instances.id
         WHERE item_instances.owner_character_id = $1
           AND item_locations.location <> 'trade_escrow'`,
        [character.character_id],
      ),
      client.query<StoredStashTabRow>(
        "SELECT tab_id, name, sort_order FROM stash_tabs WHERE character_id = $1 ORDER BY sort_order",
        [character.character_id],
      ),
    ]);
    const inventory: PlayerProfile["inventory"] = { id: "backpack", entries: [] };
    const tabs: StashTab[] = tabsResult.rows.map((tab) => ({ id: tab.tab_id, name: tab.name, container: { id: "stash", entries: [] } }));
    const equipped: PlayerProfile["equipped"] = {};
    const flaskBelt: PlayerProfile["flaskBelt"] = [null, null, null, null, null];
    let mapDevice: PlayerProfile["mapDevice"] = null;
    for (const row of itemsResult.rows) {
      const item = { ...row.item_data, id: row.id } as InventoryItem;
      if (row.location === "backpack" && row.position_x !== null && row.position_y !== null) {
        inventory.entries.push({ item, x: row.position_x, y: row.position_y });
      } else if (row.location === "stash" && row.position_x !== null && row.position_y !== null) {
        const tab = tabs.find((candidate) => candidate.id === row.container_id);
        if (tab) tab.container.entries.push({ item, x: row.position_x, y: row.position_y });
      } else if (row.location === "equipment" && row.equipment_slot && item.kind === "equipment") {
        equipped[row.equipment_slot] = item;
      } else if (row.location === "flask_belt" && item.kind === "flask") {
        const index = Number(row.container_id);
        if (Number.isInteger(index) && index >= 0 && index < flaskBelt.length) flaskBelt[index] = item;
      } else if (row.location === "map_device" && item.kind === "map") {
        mapDevice = item;
      }
    }
    const activeTabId = tabs.some((tab) => tab.id === character.active_stash_tab_id)
      ? character.active_stash_tab_id
      : tabs[0]?.id ?? "stash-tab-1";
    const profile: PlayerProfile = {
      version: 9,
      character: {
        name: character.character_name,
        classId: character.class_id,
        level: character.level,
        xp: Number(character.experience),
        allocatedAttributes: {
          strength: character.allocated_strength,
          dexterity: character.allocated_dexterity,
          intelligence: character.allocated_intelligence,
        },
        unspentAttributePoints: character.unspent_attribute_points,
        skillLevels: character.skill_levels,
        unspentSkillPoints: character.unspent_skill_points,
        mapsCompleted: character.maps_completed,
        highestWave: character.highest_wave,
      },
      inventory,
      stash: { activeTabId, tabs },
      equipped,
      flaskBelt,
      mapDevice,
    };
    return { profile, revision: Number(character.profile_version) };
  }

  private profileItems(profile: PlayerProfile): ProfileItemLocation[] {
    const locations: ProfileItemLocation[] = [];
    for (const entry of profile.inventory.entries) locations.push({ item: entry.item, location: "backpack", x: entry.x, y: entry.y });
    for (const tab of profile.stash.tabs) {
      for (const entry of tab.container.entries) locations.push({ item: entry.item, location: "stash", containerId: tab.id, x: entry.x, y: entry.y });
    }
    for (const [slot, item] of Object.entries(profile.equipped) as [CharacterEquipmentSlot, PlayerProfile["equipped"][CharacterEquipmentSlot]][]) {
      if (item) locations.push({ item, location: "equipment", equipmentSlot: slot });
    }
    profile.flaskBelt.forEach((item, index) => {
      if (item) locations.push({ item, location: "flask_belt", containerId: String(index) });
    });
    if (profile.mapDevice) locations.push({ item: profile.mapDevice, location: "map_device" });
    return locations;
  }

  private async persistProfile(
    client: PoolClient,
    characterId: string,
    profile: PlayerProfile,
    revision: number,
    characterAlreadyUpdated = false,
  ): Promise<void> {
    const locations = this.profileItems(profile);
    const itemIds = locations.map(({ item }) => item.id);
    if (new Set(itemIds).size !== itemIds.length) throw new Error("duplicate_item_location");
    if (profile.stash.tabs.length === 0) throw new Error("stash_requires_a_tab");
    const existing = await client.query<ExistingItemRow>(
      `SELECT items.id, items.item_data, items.locked_trade_id,
              locations.location, locations.container_id, locations.position_x,
              locations.position_y, locations.equipment_slot
       FROM item_instances AS items
       LEFT JOIN item_locations AS locations ON locations.item_id = items.id
       WHERE items.owner_character_id = $1
       FOR UPDATE OF items`,
      [characterId],
    );
    const desiredById = new Map(locations.map((location) => [location.item.id, location]));
    const lockedIds: string[] = [];
    for (const row of existing.rows) {
      if (!row.locked_trade_id) continue;
      lockedIds.push(row.id);
      const desired = desiredById.get(row.id);
      const locationUnchanged = desired
        && desired.location === row.location
        && (desired.containerId ?? null) === row.container_id
        && (desired.x ?? null) === row.position_x
        && (desired.y ?? null) === row.position_y
        && (desired.equipmentSlot ?? null) === row.equipment_slot;
      if (!desired || !locationUnchanged || !isDeepStrictEqual(desired.item, { ...row.item_data, id: row.id })) {
        throw new ItemLockedError(row.id);
      }
    }

    const existingById = new Map(existing.rows.map((row) => [row.id, row]));
    const locationMatches = (desired: ProfileItemLocation, row: ExistingItemRow): boolean => desired.location === row.location
      && (desired.containerId ?? null) === row.container_id
      && (desired.x ?? null) === row.position_x
      && (desired.y ?? null) === row.position_y
      && (desired.equipmentSlot ?? null) === row.equipment_slot;
    const writableLocations = locations.filter(({ item }) => !lockedIds.includes(item.id));
    const removedIds = existing.rows
      .filter((row) => !row.locked_trade_id && !desiredById.has(row.id))
      .map((row) => row.id);
    const changedItems = writableLocations.filter(({ item }) => {
      const row = existingById.get(item.id);
      return !row || !isDeepStrictEqual(item, { ...row.item_data, id: row.id });
    });
    const changedLocations = writableLocations.filter((location) => {
      const row = existingById.get(location.item.id);
      return !row || !locationMatches(location, row);
    });

    if (removedIds.length) {
      await client.query(
        "DELETE FROM item_instances WHERE owner_character_id = $1 AND locked_trade_id IS NULL AND id = ANY($2::uuid[])",
        [characterId, removedIds],
      );
    }
    if (changedItems.length) {
      await client.query(
        `INSERT INTO item_instances (id, owner_character_id, kind, item_data)
         SELECT payload.id, $1, payload.kind, payload.item_data
         FROM jsonb_to_recordset($2::jsonb) AS payload(id uuid, kind text, item_data jsonb)
         ON CONFLICT (id) DO UPDATE SET
           kind = EXCLUDED.kind,
           item_data = EXCLUDED.item_data,
           item_version = item_instances.item_version + 1,
           updated_at = now()
         WHERE item_instances.owner_character_id = $1 AND item_instances.locked_trade_id IS NULL`,
        [characterId, JSON.stringify(changedItems.map(({ item }) => ({ id: item.id, kind: item.kind, item_data: item })))],
      );
    }
    if (changedLocations.length) {
      const changedLocationIds = changedLocations.map(({ item }) => item.id);
      await client.query(
        "DELETE FROM item_locations WHERE character_id = $1 AND item_id = ANY($2::uuid[])",
        [characterId, changedLocationIds],
      );
      await client.query(
        `INSERT INTO item_locations
           (item_id, character_id, location, container_id, position_x, position_y, equipment_slot)
         SELECT payload.item_id, $1, payload.location, payload.container_id,
                payload.position_x, payload.position_y, payload.equipment_slot
         FROM jsonb_to_recordset($2::jsonb) AS payload(
           item_id uuid, location text, container_id text, position_x integer,
           position_y integer, equipment_slot text
         )`,
        [characterId, JSON.stringify(changedLocations.map((location) => ({
          item_id: location.item.id,
          location: location.location,
          container_id: location.containerId ?? null,
          position_x: location.x ?? null,
          position_y: location.y ?? null,
          equipment_slot: location.equipmentSlot ?? null,
        })))],
      );
    }
    await client.query("DELETE FROM stash_tabs WHERE character_id = $1", [characterId]);
    await client.query(
      `INSERT INTO stash_tabs (character_id, tab_id, name, sort_order)
       SELECT $1, payload.tab_id, payload.name, payload.sort_order
       FROM jsonb_to_recordset($2::jsonb) AS payload(tab_id text, name text, sort_order integer)`,
      [characterId, JSON.stringify(profile.stash.tabs.map((tab, sortOrder) => ({
        tab_id: tab.id,
        name: tab.name,
        sort_order: sortOrder,
      })))],
    );
    if (!characterAlreadyUpdated) await this.updateCharacterProgress(client, characterId, profile, revision);
  }

  private async updateCharacterProgress(
    client: PoolClient,
    characterId: string,
    profile: PlayerProfile,
    revision: number,
    expectedRevision?: number,
  ): Promise<boolean> {
    const progress = profile.character;
    const result = await client.query(
      `UPDATE characters SET
         level = $2, experience = $3, allocated_strength = $4, allocated_dexterity = $5,
         allocated_intelligence = $6, unspent_attribute_points = $7, skill_levels = $8,
         unspent_skill_points = $9, maps_completed = $10, highest_wave = $11,
         active_stash_tab_id = $12, profile_version = $13, profile_initialized = true, updated_at = now()
       WHERE id = $1${expectedRevision === undefined ? "" : " AND profile_initialized = true AND profile_version = $14"}
       RETURNING id`,
      [characterId, progress.level, progress.xp, progress.allocatedAttributes.strength,
        progress.allocatedAttributes.dexterity, progress.allocatedAttributes.intelligence,
        progress.unspentAttributePoints, progress.skillLevels, progress.unspentSkillPoints,
        progress.mapsCompleted, progress.highestWave, profile.stash.activeTabId, revision,
        ...(expectedRevision === undefined ? [] : [expectedRevision])],
    );
    return Boolean(result.rowCount);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
