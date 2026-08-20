export function formatError(error: unknown): string {
  if (!(error instanceof Error)) return `Non-Error rejection (${typeof error})`;
  const primary = error.stack ?? `${error.name}: ${error.message}`;
  const cause = error.cause;
  if (!(cause instanceof Error) || cause === error) return primary;
  return `${primary}\nCaused by: ${cause.stack ?? `${cause.name}: ${cause.message}`}`;
}
