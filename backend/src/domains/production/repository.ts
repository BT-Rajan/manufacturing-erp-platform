import { sql } from "kysely";

import { getDb } from "../../infrastructure/database/connection.js";
import { toListResult, type ListParams, type ListResult } from "../../infrastructure/database/listParams.js";

export async function findById(id: number, includeDeleted = false) {
  const db = getDb();
  let query = db
    .selectFrom("production_schedules")
    .leftJoin("products", "products.id", "production_schedules.product_id")
    .leftJoin("machines", "machines.id", "production_schedules.machine_id")
    .leftJoin("orders", "orders.id", "production_schedules.order_id")
    .select([
      "production_schedules.id",
      "production_schedules.batch_number",
      "production_schedules.product_id",
      "products.code as product_code",
      "products.name as product_name",
      "products.unit",
      "production_schedules.machine_id",
      "machines.name as machine_name",
      "production_schedules.order_id",
      "orders.order_number",
      "production_schedules.planned_quantity",
      "production_schedules.produced_quantity",
      "production_schedules.scheduled_start",
      "production_schedules.scheduled_end",
      "production_schedules.actual_start",
      "production_schedules.actual_end",
      "production_schedules.status",
      "production_schedules.auto_scheduled",
      "production_schedules.cancel_reason",
      "production_schedules.notes",
      "production_schedules.created_at",
      "production_schedules.created_by",
      "production_schedules.updated_at",
      "production_schedules.updated_by",
      "production_schedules.deleted_at",
    ])
    .where("production_schedules.id", "=", id);
  if (!includeDeleted) query = query.where("production_schedules.deleted_at", "is", null);
  return query.executeTakeFirst();
}

/** Bare row, no joins -- used internally (e.g. _startBatch reading
 * order.status without needing the full display projection). */
export async function findRawById(id: number) {
  const db = getDb();
  return db.selectFrom("production_schedules").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function findActiveByOrderId(orderId: number) {
  const db = getDb();
  return db
    .selectFrom("production_schedules")
    .selectAll()
    .where("order_id", "=", orderId)
    .where("deleted_at", "is", null)
    .execute();
}

export interface ProductionListItem {
  id: number;
  batch_number: string | null;
  product_id: number;
  product_name: string | null;
  status: string;
  scheduled_start: Date;
  scheduled_end: Date;
  created_at: Date;
}

export async function list(
  params: ListParams & { productId?: number; orderId?: number },
): Promise<ListResult<ProductionListItem>> {
  const db = getDb();
  let base = db
    .selectFrom("production_schedules")
    .leftJoin("products", "products.id", "production_schedules.product_id")
    .where("production_schedules.deleted_at", "is", null);

  if (params.status) base = base.where("production_schedules.status", "=", params.status as never);
  if (params.productId) base = base.where("production_schedules.product_id", "=", params.productId);
  if (params.orderId) base = base.where("production_schedules.order_id", "=", params.orderId);
  if (params.search) {
    base = base.where("production_schedules.batch_number", "like", `%${params.search}%`);
  }

  const totalRow = await base.select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirst();
  const total = Number(totalRow?.count ?? 0);

  const allowedSort = ["id", "batch_number", "scheduled_start", "scheduled_end", "status", "created_at"];
  const sortColumn = allowedSort.includes(params.sort ?? "") ? `production_schedules.${params.sort}` : "production_schedules.id";

  const items = await base
    .select([
      "production_schedules.id",
      "production_schedules.batch_number",
      "production_schedules.product_id",
      "products.name as product_name",
      "production_schedules.status",
      "production_schedules.scheduled_start",
      "production_schedules.scheduled_end",
      "production_schedules.created_at",
    ])
    .orderBy(sql.ref(sortColumn), "desc")
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize)
    .execute();

  return toListResult(items, total, params);
}

export interface CreateBatchValues {
  product_id: number;
  machine_id: number | null;
  order_id: number | null;
  planned_quantity: number;
  scheduled_start: string;
  scheduled_end: string;
  notes: string | null;
  auto_scheduled?: boolean;
}

export async function create(batchNumber: string, values: CreateBatchValues, performedBy: number | null) {
  const db = getDb();
  const result = await db
    .insertInto("production_schedules")
    .values({
      batch_number: batchNumber,
      status: "planned",
      produced_quantity: 0,
      auto_scheduled: false,
      ...values,
      created_by: performedBy,
      updated_by: performedBy,
    })
    .executeTakeFirstOrThrow();
  return Number(result.insertId);
}

export async function update(
  id: number,
  values: Partial<{
    order_id: number | null;
    machine_id: number | null;
    planned_quantity: number;
    scheduled_start: string;
    scheduled_end: string;
    notes: string | null;
  }>,
  performedBy: number | null,
): Promise<void> {
  const db = getDb();
  await db
    .updateTable("production_schedules")
    .set({ ...values, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function updateStatus(
  id: number,
  values: Partial<{
    status: string;
    produced_quantity: number;
    actual_start: Date | null;
    actual_end: Date | null;
    cancel_reason: string | null;
  }>,
  performedBy: number | null,
): Promise<void> {
  const db = getDb();
  const setValues = { ...values, updated_by: performedBy };
  await db
    .updateTable("production_schedules")
    .set(setValues as never)
    .where("id", "=", id)
    .execute();
}

export async function softDelete(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("production_schedules")
    .set({ deleted_at: sql`CURRENT_TIMESTAMP`, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function restore(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("production_schedules")
    .set({ deleted_at: null, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}
