CREATE TABLE IF NOT EXISTS parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visibility text NOT NULL CHECK (visibility IN ('public', 'solo')),
  leader_character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  current_expedition_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS party_members (
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  character_id uuid NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (party_id, character_id)
);

CREATE TABLE IF NOT EXISTS party_connections (
  connection_id text PRIMARY KEY,
  party_id uuid NOT NULL,
  character_id uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (party_id, character_id)
    REFERENCES party_members (party_id, character_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS map_expeditions (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL UNIQUE,
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  owner_character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  map_item_id uuid NOT NULL,
  map_data jsonb NOT NULL,
  map_ticket text NOT NULL,
  tier integer NOT NULL CHECK (tier > 0),
  seed integer NOT NULL CHECK (seed >= 0),
  allowed_character_ids uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'interrupted', 'superseded', 'closed')),
  room_id text,
  room_lease_expires_at timestamptz,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE parties
  DROP CONSTRAINT IF EXISTS parties_current_expedition_id_fkey;
ALTER TABLE parties
  ADD CONSTRAINT parties_current_expedition_id_fkey
  FOREIGN KEY (current_expedition_id) REFERENCES map_expeditions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS map_portals (
  expedition_id uuid NOT NULL REFERENCES map_expeditions(id) ON DELETE CASCADE,
  portal_index integer NOT NULL CHECK (portal_index >= 0),
  used_by_character_id uuid REFERENCES characters(id) ON DELETE SET NULL,
  used_at timestamptz,
  PRIMARY KEY (expedition_id, portal_index),
  CHECK ((used_by_character_id IS NULL) = (used_at IS NULL))
);

CREATE INDEX IF NOT EXISTS parties_visibility_idx ON parties (visibility, created_at);
CREATE INDEX IF NOT EXISTS party_connections_expiry_idx ON party_connections (lease_expires_at);
CREATE INDEX IF NOT EXISTS map_expeditions_party_idx ON map_expeditions (party_id, created_at DESC);
CREATE INDEX IF NOT EXISTS map_expeditions_room_lease_idx ON map_expeditions (room_lease_expires_at) WHERE status = 'active';

