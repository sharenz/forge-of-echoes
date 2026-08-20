ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS maps_completed integer NOT NULL DEFAULT 0 CHECK (maps_completed >= 0),
  ADD COLUMN IF NOT EXISTS highest_wave integer NOT NULL DEFAULT 0 CHECK (highest_wave >= 0),
  ADD COLUMN IF NOT EXISTS active_stash_tab_id text NOT NULL DEFAULT 'stash-tab-1',
  ADD COLUMN IF NOT EXISTS profile_initialized boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS stash_tabs (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  tab_id text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 24),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  PRIMARY KEY (character_id, tab_id),
  UNIQUE (character_id, sort_order)
);

CREATE INDEX IF NOT EXISTS stash_tabs_character_idx
  ON stash_tabs (character_id, sort_order);
