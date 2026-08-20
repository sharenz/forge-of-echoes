/**
 * Colyseus exposes a room before its first schema snapshot has necessarily
 * hydrated every collection. Treat that short-lived state as an empty
 * collection instead of making every consumer know about the transport race.
 */
export function schemaValues<T>(collection: { values(): Iterable<T> } | null | undefined): T[] {
  return collection ? [...collection.values()] : [];
}
