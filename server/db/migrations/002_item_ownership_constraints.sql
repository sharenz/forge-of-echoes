CREATE UNIQUE INDEX IF NOT EXISTS item_instances_id_owner_unique
  ON item_instances (id, owner_character_id);

ALTER TABLE item_locations
  DROP CONSTRAINT IF EXISTS item_locations_item_id_fkey;
ALTER TABLE item_locations
  DROP CONSTRAINT IF EXISTS item_locations_owner_fkey;
ALTER TABLE item_locations
  ADD CONSTRAINT item_locations_owner_fkey
  FOREIGN KEY (item_id, character_id)
  REFERENCES item_instances (id, owner_character_id)
  ON DELETE CASCADE;

ALTER TABLE trade_offers
  DROP CONSTRAINT IF EXISTS trade_offers_item_id_fkey;
ALTER TABLE trade_offers
  DROP CONSTRAINT IF EXISTS trade_offers_item_owner_fkey;
ALTER TABLE trade_offers
  ADD CONSTRAINT trade_offers_item_owner_fkey
  FOREIGN KEY (item_id, offered_by)
  REFERENCES item_instances (id, owner_character_id)
  ON DELETE RESTRICT;
