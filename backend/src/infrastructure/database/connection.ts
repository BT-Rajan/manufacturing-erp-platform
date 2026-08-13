import { Kysely, MysqlDialect, type MysqlPool } from "kysely";
import { createPool } from "mysql2";

import { getSettings } from "../../core/config/settings.js";
import type { Database } from "./schema.js";

let instance: Kysely<Database> | undefined;

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
