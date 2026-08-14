import { sql } from "kysely";

import { getDb } from "../../infrastructure/database/connection.js";
import { toListResult, type ListParams, type ListResult } from "../../infrastructure/database/listParams.js";
import type { ProductCreateInput, ProductUpdateInput } from "./schema.js";

const SEARCHABLE_COLUMNS = ["code", "name"] as const;
const SORTABLE_COLUMNS = ["id", "name", "code", "created_at"] as const;

export async function create(input: ProductCreateInput, performedBy: number | null) {
  const db = getDb();
  const result = await db
    .insertInto("products")
    .values({ ...input, created_by: performedBy, updated_by: performedBy })
    .executeTakeFirstOrThrow();
  return findById(Number(result.insertId));
}

export async function findById(id: number, includeDeleted = false) {
  const db = getDb();
  let query = db.selectFrom("products").selectAll().where("id", "=", id);
  if (!includeDeleted) query = query.where("deleted_at", "is", null);
  return query.executeTakeFirst();
}

export async function codeExists(code: string, excludeId?: number): Promise<boolean> {
  const db = getDb();
  let query = db.selectFrom("products").select("id").where("code", "=", code);
  if (excludeId !== undefined) query = query.where("id", "!=", excludeId);
  return (await query.executeTakeFirst()) !== undefined;
}

export async function list(params: ListParams): Promise<ListResult<Awaited<ReturnType<typeof findById>>>> {
  const db = getDb();
  let base = db.selectFrom("products").where("deleted_at", "is", null);

  if (params.search) {
    const term = `%${params.search}%`;
    base = base.where((eb) => eb.or(SEARCHABLE_COLUMNS.map((col) => eb(col, "like", term))));
  }
  if (params.status) {
    base = base.where("status", "=", params.status as "active" | "inactive");
  }

  const totalRow = await base.select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirst();
  const total = Number(totalRow?.count ?? 0);

  const sortColumn = (SORTABLE_COLUMNS as readonly string[]).includes(params.sort ?? "")
    ? (params.sort as (typeof SORTABLE_COLUMNS)[number])
    : "id";

  const items = await base
    .selectAll()
    .orderBy(sortColumn, "desc")
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize)
    .execute();

  return toListResult(items, total, params);
}

export async function update(id: number, input: ProductUpdateInput, performedBy: number | null) {
  const db = getDb();
  await db
    .updateTable("products")
    .set({ ...input, updated_by: performedBy })
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .execute();
  return findById(id);
}

export async function softDelete(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("products")
    .set({ deleted_at: sql`CURRENT_TIMESTAMP`, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function restore(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("products")
    .set({ deleted_at: null, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}
