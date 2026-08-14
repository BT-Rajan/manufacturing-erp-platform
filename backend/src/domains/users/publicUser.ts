/** The one place a user row gets stripped of password_hash before
 * crossing the API boundary. Both commands.ts (create/update/delete/
 * restore) and queries.ts (get/list) go through this -- a user row
 * should never reach a route handler with password_hash still on it. */
export function toPublicUser<T extends { password_hash: string }>(row: T): Omit<T, "password_hash"> {
  const { password_hash: _passwordHash, ...rest } = row;
  return rest;
}
