-- Character identity is the immutable UUID. Display names are intentionally not
-- global identifiers: local accounts may choose the same class/default name,
-- while sessions, parties, maps, ownership, and trades remain UUID-bound.
DROP INDEX IF EXISTS characters_name_unique;
