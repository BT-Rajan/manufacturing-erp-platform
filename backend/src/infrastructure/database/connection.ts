import { Kysely, MysqlDialect, type MysqlPool } from "kysely";
import { createPool, type TypeCast } from "mysql2";

import { getSettings } from "../../core/config/settings.js";
import type { Database } from "./schema.js";

let instance: Kysely<Database> | undefined;

/** mysql2 returns TINYINT(1) as a JS number (0/1) by default, but every
 * boolean column in schema.ts is typed as ColumnType<boolean, ...>. Cast
 * at the driver level so the mismatch can't resurface in a new domain
 * later -- this was caught by the Pass 1 test suite (users.is_active,
 * field_config.is_required/is_searchable/is_filterable all came back
 * as 0/1 instead of false/true). */
const typeCast: TypeCast = (field, next) => {
  if (field.type === "TINY" && field.length === 1) {
    const value = field.string();
    return value === null ? null : value === "1";
  }
  return next();
};

export function getDb(): Kysely<Database> {
  if (instance) return instance;

  const settings = getSettings();
  const dialect = new MysqlDialect({
    // mysql2's shipped types don't structurally match Kysely's MysqlPool
    // interface across every mysql2 minor version (overload shape drift
    // on Pool#query) -- functionally compatible, confirmed against real
    // MySQL by the Pass 0 test suite. Kysely's own docs use this exact
    // createPool() call.
    pool: createPool({
      host: settings.db.host,
      port: settings.db.port,
      user: settings.db.user,
      password: settings.db.password,
      database: settings.db.database,
      supportBigNumbers: true,
      typeCast,
    }) as unknown as MysqlPool,
  });

  instance = new Kysely<Database>({ dialect });
  return instance;
}

/** Test-only: allows a fresh pool per test run against a clean settings cache. */
export async function resetDbConnection(): Promise<void> {
  if (instance) {
    await instance.destroy();
    instance = undefined;
  }
}
