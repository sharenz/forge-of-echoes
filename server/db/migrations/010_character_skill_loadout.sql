ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS skill_loadout jsonb NOT NULL
  DEFAULT '["basic","nova","dash","ward","flameWave"]'::jsonb;

ALTER TABLE characters
  DROP CONSTRAINT IF EXISTS characters_skill_loadout_shape;

ALTER TABLE characters
  ADD CONSTRAINT characters_skill_loadout_shape CHECK (
    jsonb_typeof(skill_loadout) = 'array'
    AND jsonb_array_length(skill_loadout) = 5
  );
