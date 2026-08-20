CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_handle text NOT NULL UNIQUE CHECK (local_handle = lower(local_handle)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 24),
  class_id text NOT NULL CHECK (class_id IN ('amazon', 'barbarian', 'sorceress')),
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 99),
  experience bigint NOT NULL DEFAULT 0 CHECK (experience >= 0),
  allocated_strength integer NOT NULL DEFAULT 0 CHECK (allocated_strength >= 0),
  allocated_dexterity integer NOT NULL DEFAULT 0 CHECK (allocated_dexterity >= 0),
  allocated_intelligence integer NOT NULL DEFAULT 0 CHECK (allocated_intelligence >= 0),
  unspent_attribute_points integer NOT NULL DEFAULT 0 CHECK (unspent_attribute_points >= 0),
  skill_levels jsonb NOT NULL DEFAULT '{"nova":1,"dash":1,"ward":1,"flameWave":1}'::jsonb,
  unspent_skill_points integer NOT NULL DEFAULT 0 CHECK (unspent_skill_points >= 0),
  profile_version bigint NOT NULL DEFAULT 1 CHECK (profile_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS characters_name_unique ON characters (lower(name));

CREATE TABLE IF NOT EXISTS item_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('equipment', 'map', 'currency', 'flask')),
  item_data jsonb NOT NULL,
  item_version bigint NOT NULL DEFAULT 1 CHECK (item_version > 0),
  locked_trade_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS item_locations (
  item_id uuid PRIMARY KEY REFERENCES item_instances(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  location text NOT NULL CHECK (location IN ('backpack', 'stash', 'equipment', 'flask_belt', 'map_device', 'ground', 'trade_escrow')),
  container_id text,
  position_x integer,
  position_y integer,
  equipment_slot text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((location IN ('backpack', 'stash') AND position_x IS NOT NULL AND position_y IS NOT NULL) OR location NOT IN ('backpack', 'stash'))
);

CREATE UNIQUE INDEX IF NOT EXISTS one_equipment_per_slot
  ON item_locations (character_id, equipment_slot)
  WHERE location = 'equipment';

CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'locked', 'completed', 'cancelled')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE item_instances
  DROP CONSTRAINT IF EXISTS item_instances_locked_trade_id_fkey;
ALTER TABLE item_instances
  ADD CONSTRAINT item_instances_locked_trade_id_fkey
  FOREIGN KEY (locked_trade_id) REFERENCES trades(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS trade_participants (
  trade_id uuid NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  accepted_revision bigint,
  PRIMARY KEY (trade_id, character_id)
);

CREATE TABLE IF NOT EXISTS trade_offers (
  trade_id uuid NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  item_id uuid NOT NULL UNIQUE REFERENCES item_instances(id) ON DELETE RESTRICT,
  offered_by uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  PRIMARY KEY (trade_id, item_id)
);

CREATE TABLE IF NOT EXISTS economy_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  character_id uuid REFERENCES characters(id) ON DELETE SET NULL,
  item_id uuid REFERENCES item_instances(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS item_instances_owner_idx ON item_instances (owner_character_id);
CREATE INDEX IF NOT EXISTS item_locations_character_idx ON item_locations (character_id, location);
CREATE INDEX IF NOT EXISTS economy_events_character_idx ON economy_events (character_id, created_at DESC);
