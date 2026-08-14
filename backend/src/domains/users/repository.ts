import { sql } from "kysely";

import { hashPassword } from "../../core/security/security.js";
import { getDb } from "../../infrastructure/database/connection.js";
import { toListResult, type ListParams, type ListResult } from "../../infrastructure/database/listParams.js";
import type { UserCreateInput, UserUpdateInput } from "./schema.js";

const SEARCHABLE_COLUMNS = ["username", "email", "full_name"] as const;
const SORTABLE_COLUMNS = ["id", "username", "full_name", "created_at"] as const;

export async function create(input: UserCreateInput, performedBy: number | null) {
  const db = getDb();
  const { password, ...rest } = input;
  const result = await db
    .insertInto("users")
    .values({
      ...rest,
      password_hash: await hashPassword(password),
      created_by: performedBy,
      updated_by: performedBy,
    })
    .executeTakeFirstOrThrow();
  return findById(Number(result.insertId));
}

export async function findById(id: number, includeDeleted = false) {
  const db = getDb();
  let query = db.selectFrom("users").selectAll().where("id", "=", id);
  if (!includeDeleted) query = query.where("deleted_at", "is", null);
  return query.executeTakeFirst();
}

export async function usernameOrEmailExists(username: string, email: string, excludeId?: number): Promise<boolean> {
  const db = getDb();
  let query = db
    .selectFrom("users")
    .select("id")
    .where((eb) => eb.or([eb("username", "=", username), eb("email", "=", email)]));
  if (excludeId !== undefined) query = query.where("id", "!=", excludeId);
  return (await query.executeTakeFirst()) !== undefined;
}

export async function list(params: ListParams): Promise<ListResult<Awaited<ReturnType<typeof findById>>>> {
  const db = getDb();
  let base = db.selectFrom("users").where("deleted_at", "is", null);

  if (params.search) {
    const term = `%${params.search}%`;
    base = base.where((eb) => eb.or(SEARCHABLE_COLUMNS.map((col) => eb(col, "like", term))));
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

export async function update(id: number, input: UserUpdateInput, performedBy: number | null) {
  const db = getDb();
  const { password, ...rest } = input;
  const values: Record<string, unknown> = { ...rest, updated_by: performedBy };
  if (password) {
    values["password_hash"] = await hashPassword(password);
  }
  await db
    .updateTable("users")
    .set(values as never)
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .execute();
  return findById(id);
}

export async function softDelete(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("users")
    .set({ deleted_at: sql`CURRENT_TIMESTAMP`, is_active: false, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function restore(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("users")
    .set({ deleted_at: null, is_active: true, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}
