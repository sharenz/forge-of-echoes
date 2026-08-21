ALTER TABLE map_portals
  DROP CONSTRAINT IF EXISTS map_portals_check;

ALTER TABLE map_portals
  ADD CONSTRAINT map_portals_usage_consistency
  CHECK (used_by_character_id IS NULL OR used_at IS NOT NULL);

