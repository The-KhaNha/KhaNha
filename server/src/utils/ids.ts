const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every id in the database is a UUID; anything else cannot match a row (and would make Postgres reject the query). */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
