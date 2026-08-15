import { sql } from "kysely";

import { AppError } from "../../core/errors/index.js";
import { getDb } from "../../infrastructure/database/connection.js";

/** Atomically claims the next number for a document type, e.g.
 * 'FSB-00001'. Uses SELECT ... FOR UPDATE inside a transaction so
 * concurrent requests never receive the same number. */
export async function nextNumber(docType: string): Promise<string> {
  const db = getDb();

  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom("number_series")
      .select(["prefix", "next_number", "padding"])
      .where("doc_type", "=", docType)
      .forUpdate()
      .executeTakeFirst();

    if (!row) {
      throw new AppError(`No number series configured for '${docType}'.`);
    }

    await trx
      .updateTable("number_series")
      .set({ next_number: sql`next_number + 1` })
      .where("doc_type", "=", docType)
      .execute();

    return `${row.prefix}-${String(row.next_number).padStart(row.padding, "0")}`;
  });
}
