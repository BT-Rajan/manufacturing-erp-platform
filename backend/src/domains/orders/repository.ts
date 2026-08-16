import { sql } from "kysely";

import { getDb } from "../../infrastructure/database/connection.js";
import { toListResult, type ListParams, type ListResult } from "../../infrastructure/database/listParams.js";
import type { OrderLineInput } from "./schema.js";

export async function findById(id: number, includeDeleted = false) {
  const db = getDb();
  let query = db
    .selectFrom("orders")
    .leftJoin("customers", "customers.id", "orders.customer_id")
    .leftJoin("deals", "deals.id", "orders.deal_id")
    .select([
      "orders.id",
      "orders.order_number",
      "orders.customer_id",
      "customers.name as customer_name",
      "customers.email as customer_email",
      "orders.deal_id",
      "deals.deal_number",
      "orders.order_date",
      "orders.requested_delivery_date",
      "orders.confirmed_delivery_date",
      "orders.status",
      "orders.subtotal_amount",
      "orders.discount_percent",
      "orders.discount_amount",
      "orders.tax_rate",
      "orders.tax_amount",
      "orders.total_amount",
      "orders.notes",
      "orders.close_reason",
      "orders.approved_at",
      "orders.admin_review_required",
      "orders.admin_reviewed_at",
      "orders.admin_review_notes",
      "orders.created_at",
      "orders.created_by",
      "orders.updated_at",
      "orders.updated_by",
      "orders.deleted_at",
    ])
    .where("orders.id", "=", id);
  if (!includeDeleted) query = query.where("orders.deleted_at", "is", null);
  return query.executeTakeFirst();
}

export async function getLines(orderId: number) {
  const db = getDb();
  return db
    .selectFrom("order_lines")
    .leftJoin("products", "products.id", "order_lines.product_id")
    .select([
      "order_lines.id",
      "order_lines.product_id",
      "products.code as product_code",
      "products.name as product_name",
      "products.unit",
      "order_lines.quantity",
      "order_lines.unit_price",
      "order_lines.discount_percent",
      "order_lines.line_total",
    ])
    .where("order_lines.order_id", "=", orderId)
    .orderBy("order_lines.id", "asc")
    .execute();
}

export interface OrderListItem {
  id: number;
  order_number: string | null;
  customer_id: number;
  customer_name: string | null;
  status: string;
  order_date: Date;
  total_amount: string;
  created_at: Date;
}

export async function list(
  params: ListParams & { customerId?: number; adminReviewRequired?: boolean },
): Promise<ListResult<OrderListItem>> {
  const db = getDb();
  let base = db
    .selectFrom("orders")
    .leftJoin("customers", "customers.id", "orders.customer_id")
    .where("orders.deleted_at", "is", null);

  if (params.status) base = base.where("orders.status", "=", params.status as never);
  if (params.customerId) base = base.where("orders.customer_id", "=", params.customerId);
  if (params.adminReviewRequired !== undefined) {
    base = base.where("orders.admin_review_required", "=", params.adminReviewRequired);
  }
  if (params.search) {
    const term = `%${params.search}%`;
    base = base.where((eb) => eb.or([eb("orders.order_number", "like", term), eb("customers.name", "like", term)]));
  }

  const totalRow = await base.select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirst();
  const total = Number(totalRow?.count ?? 0);

  const allowedSort = ["id", "order_number", "order_date", "total_amount", "status", "created_at"];
  const sortColumn = allowedSort.includes(params.sort ?? "") ? `orders.${params.sort}` : "orders.id";

  const items = await base
    .select([
      "orders.id",
      "orders.order_number",
      "orders.customer_id",
      "customers.name as customer_name",
      "orders.status",
      "orders.order_date",
      "orders.total_amount",
      "orders.created_at",
    ])
    .orderBy(sql.ref(sortColumn), "desc")
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize)
    .execute();

  return toListResult(items, total, params);
}

export interface CreateOrderValues {
  customer_id: number;
  deal_id: number | null;
  order_date: string;
  requested_delivery_date: string | null;
  notes: string | null;
  tax_rate: number;
  discount_percent: number;
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
}

export async function create(
  orderNumber: string,
  values: CreateOrderValues,
  lines: (OrderLineInput & { line_total: number })[],
  performedBy: number | null,
) {
  const db = getDb();
  return db.transaction().execute(async (trx) => {
    const result = await trx
      .insertInto("orders")
      .values({
        order_number: orderNumber,
        status: "draft",
        ...values,
        created_by: performedBy,
        updated_by: performedBy,
      })
      .executeTakeFirstOrThrow();
    const id = Number(result.insertId);

    await trx
      .insertInto("order_lines")
      .values(lines.map((line) => ({ order_id: id, ...line })))
      .execute();

    return id;
  });
}

export async function replaceLines(orderId: number, lines: (OrderLineInput & { line_total: number })[]): Promise<void> {
  const db = getDb();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("order_lines").where("order_id", "=", orderId).execute();
    if (lines.length > 0) {
      await trx
        .insertInto("order_lines")
        .values(lines.map((line) => ({ order_id: orderId, ...line })))
        .execute();
    }
  });
}

export async function update(
  id: number,
  values: Partial<{
    customer_id: number;
    order_date: string;
    requested_delivery_date: string | null;
    confirmed_delivery_date: string | null;
    notes: string | null;
    tax_rate: number;
    discount_percent: number;
    subtotal_amount: number;
    discount_amount: number;
    tax_amount: number;
    total_amount: number;
    approved_at: Date | null;
    approved_by: number | null;
  }>,
  performedBy: number | null,
): Promise<void> {
  const db = getDb();
  await db
    .updateTable("orders")
    .set({ ...values, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function updateStatus(
  id: number,
  values: Partial<{
    status: string;
    close_reason: string | null;
    approved_at: Date | null;
    approved_by: number | null;
    admin_review_required: boolean;
    admin_reviewed_at: Date | null;
    admin_reviewed_by: number | null;
    admin_review_notes: string | null;
  }>,
  performedBy: number | null,
): Promise<void> {
  const db = getDb();
  const setValues = { ...values, updated_by: performedBy };
  await db
    .updateTable("orders")
    .set(setValues as never)
    .where("id", "=", id)
    .execute();
}

export async function softDelete(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("orders")
    .set({ deleted_at: sql`CURRENT_TIMESTAMP`, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function restore(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("orders")
    .set({ deleted_at: null, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function findOverdueCandidates() {
  const db = getDb();
  return db
    .selectFrom("orders")
    .selectAll()
    .where("deleted_at", "is", null)
    .where("status", "in", ["draft", "confirmed", "in_production", "ready_to_ship"])
    .where("close_reason", "is", null)
    .where("admin_review_required", "=", false)
    .execute();
}
