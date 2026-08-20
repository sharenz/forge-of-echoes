-- Accounts own a roster of characters. Character names are global,
-- case-insensitive identities for the local realm.
ALTER TABLE characters
  DROP CONSTRAINT IF EXISTS characters_account_id_key;

-- Migration 004 temporarily allowed duplicate display names. Preserve every
-- legacy character by suffixing duplicates with a stable fragment of its UUID.
WITH duplicate_names AS (
  SELECT id,
         row_number() OVER (PARTITION BY lower(name) ORDER BY created_at, id) AS duplicate_number
  FROM characters
), renamed AS (
  SELECT characters.id,
         left(characters.name, 15) || '-' || left(characters.id::text, 8) AS unique_name
  FROM characters
  INNER JOIN duplicate_names ON duplicate_names.id = characters.id
  WHERE duplicate_names.duplicate_number > 1
)
UPDATE characters
SET name = renamed.unique_name,
    updated_at = now()
FROM renamed
WHERE characters.id = renamed.id;

CREATE UNIQUE INDEX IF NOT EXISTS characters_name_unique
  ON characters (lower(name));

CREATE INDEX IF NOT EXISTS characters_account_idx
  ON characters (account_id, created_at, id);
