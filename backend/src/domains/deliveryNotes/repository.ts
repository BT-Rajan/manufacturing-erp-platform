import { sql } from "kysely";

import { getDb } from "../../infrastructure/database/connection.js";
import { toListResult, type ListParams, type ListResult } from "../../infrastructure/database/listParams.js";

export async function findById(id: number, includeDeleted = false) {
  const db = getDb();
  let query = db
    .selectFrom("delivery_notes")
    .leftJoin("orders", "orders.id", "delivery_notes.order_id")
    .leftJoin("customers", "customers.id", "orders.customer_id")
    .select([
      "delivery_notes.id",
      "delivery_notes.delivery_note_number",
      "delivery_notes.order_id",
      "orders.order_number",
      "customers.name as customer_name",
      "customers.email as customer_email",
      "delivery_notes.delivery_date",
      "delivery_notes.status",
      "delivery_notes.auto_created",
      "delivery_notes.cancel_reason",
      "delivery_notes.notes",
      "delivery_notes.created_at",
      "delivery_notes.created_by",
      "delivery_notes.updated_at",
      "delivery_notes.updated_by",
      "delivery_notes.deleted_at",
    ])
    .where("delivery_notes.id", "=", id);
  if (!includeDeleted) query = query.where("delivery_notes.deleted_at", "is", null);
  return query.executeTakeFirst();
}

export async function findActiveByOrderId(orderId: number) {
  const db = getDb();
  return db
    .selectFrom("delivery_notes")
    .selectAll()
    .where("order_id", "=", orderId)
    .where("deleted_at", "is", null)
    .where("status", "!=", "cancelled")
    .executeTakeFirst();
}

export async function getLines(noteId: number) {
  const db = getDb();
  return db
    .selectFrom("delivery_note_lines")
    .leftJoin("products", "products.id", "delivery_note_lines.product_id")
    .select([
      "delivery_note_lines.id",
      "delivery_note_lines.product_id",
      "products.code as product_code",
      "products.name as product_name",
      "products.unit",
      "delivery_note_lines.quantity_delivered",
    ])
    .where("delivery_note_lines.delivery_note_id", "=", noteId)
    .orderBy("delivery_note_lines.id", "asc")
    .execute();
}

export interface DeliveryNoteListItem {
  id: number;
  delivery_note_number: string;
  order_id: number;
  order_number: string | null;
  status: string;
  delivery_date: Date;
  created_at: Date;
}

export async function list(params: ListParams & { orderId?: number }): Promise<ListResult<DeliveryNoteListItem>> {
  const db = getDb();
  let base = db
    .selectFrom("delivery_notes")
    .leftJoin("orders", "orders.id", "delivery_notes.order_id")
    .where("delivery_notes.deleted_at", "is", null);

  if (params.status) base = base.where("delivery_notes.status", "=", params.status as never);
  if (params.orderId) base = base.where("delivery_notes.order_id", "=", params.orderId);
  if (params.search) base = base.where("delivery_notes.delivery_note_number", "like", `%${params.search}%`);

  const totalRow = await base.select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirst();
  const total = Number(totalRow?.count ?? 0);

  const allowedSort = ["id", "delivery_note_number", "delivery_date", "status", "created_at"];
  const sortColumn = allowedSort.includes(params.sort ?? "") ? `delivery_notes.${params.sort}` : "delivery_notes.id";

  const items = await base
    .select([
      "delivery_notes.id",
      "delivery_notes.delivery_note_number",
      "delivery_notes.order_id",
      "orders.order_number",
      "delivery_notes.status",
      "delivery_notes.delivery_date",
      "delivery_notes.created_at",
    ])
    .orderBy(sql.ref(sortColumn), "desc")
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize)
    .execute();

  return toListResult(items, total, params);
}

export interface CreateNoteValues {
  order_id: number;
  delivery_date: string;
  notes: string | null;
  auto_created: boolean;
}

export async function create(
  noteNumber: string,
  values: CreateNoteValues,
  lines: { product_id: number; quantity_delivered: number }[],
  performedBy: number | null,
) {
  const db = getDb();
  return db.transaction().execute(async (trx) => {
    const result = await trx
      .insertInto("delivery_notes")
      .values({ delivery_note_number: noteNumber, status: "draft", ...values, created_by: performedBy, updated_by: performedBy })
      .executeTakeFirstOrThrow();
    const id = Number(result.insertId);

    await trx
      .insertInto("delivery_note_lines")
      .values(lines.map((line) => ({ delivery_note_id: id, ...line })))
      .execute();

    return id;
  });
}

export async function replaceLines(
  noteId: number,
  lines: { product_id: number; quantity_delivered: number }[],
): Promise<void> {
  const db = getDb();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("delivery_note_lines").where("delivery_note_id", "=", noteId).execute();
    if (lines.length > 0) {
      await trx
        .insertInto("delivery_note_lines")
        .values(lines.map((line) => ({ delivery_note_id: noteId, ...line })))
        .execute();
    }
  });
}

export async function update(
  id: number,
  values: Partial<{ delivery_date: string; notes: string | null }>,
  performedBy: number | null,
): Promise<void> {
  const db = getDb();
  await db
    .updateTable("delivery_notes")
    .set({ ...values, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function updateStatus(
  id: number,
  values: Partial<{ status: string; cancel_reason: string | null }>,
  performedBy: number | null,
): Promise<void> {
  const db = getDb();
  const setValues = { ...values, updated_by: performedBy };
  await db
    .updateTable("delivery_notes")
    .set(setValues as never)
    .where("id", "=", id)
    .execute();
}

export async function softDelete(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("delivery_notes")
    .set({ deleted_at: sql`CURRENT_TIMESTAMP`, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function restore(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("delivery_notes")
    .set({ deleted_at: null, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}
