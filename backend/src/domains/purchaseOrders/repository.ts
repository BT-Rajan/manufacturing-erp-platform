import { sql } from "kysely";

import { getDb } from "../../infrastructure/database/connection.js";
import { toListResult, type ListParams, type ListResult } from "../../infrastructure/database/listParams.js";
import type { PurchaseOrderLineInput } from "./schema.js";

export async function findById(id: number, includeDeleted = false) {
  const db = getDb();
  let query = db
    .selectFrom("purchase_orders")
    .leftJoin("suppliers", "suppliers.id", "purchase_orders.supplier_id")
    .select([
      "purchase_orders.id",
      "purchase_orders.po_number",
      "purchase_orders.supplier_id",
      "suppliers.code as supplier_code",
      "suppliers.name as supplier_name",
      "suppliers.email as supplier_email",
      "purchase_orders.order_date",
      "purchase_orders.expected_delivery_date",
      "purchase_orders.status",
      "purchase_orders.subtotal_amount",
      "purchase_orders.discount_percent",
      "purchase_orders.discount_amount",
      "purchase_orders.tax_rate",
      "purchase_orders.tax_amount",
      "purchase_orders.total_amount",
      "purchase_orders.notes",
      "purchase_orders.auto_created",
      "purchase_orders.cancel_reason",
      "purchase_orders.approved_at",
      "purchase_orders.admin_review_required",
      "purchase_orders.admin_reviewed_at",
      "purchase_orders.admin_review_notes",
      "purchase_orders.created_at",
      "purchase_orders.created_by",
      "purchase_orders.updated_at",
      "purchase_orders.updated_by",
      "purchase_orders.deleted_at",
    ])
    .where("purchase_orders.id", "=", id);
  if (!includeDeleted) query = query.where("purchase_orders.deleted_at", "is", null);
  return query.executeTakeFirst();
}

export async function getLines(poId: number) {
  const db = getDb();
  return db
    .selectFrom("purchase_order_lines")
    .leftJoin("raw_materials", "raw_materials.id", "purchase_order_lines.raw_material_id")
    .select([
      "purchase_order_lines.id",
      "purchase_order_lines.raw_material_id",
      "raw_materials.code as material_code",
      "raw_materials.name as material_name",
      "raw_materials.unit",
      "purchase_order_lines.quantity",
      "purchase_order_lines.unit_price",
      "purchase_order_lines.discount_percent",
      "purchase_order_lines.line_total",
      "purchase_order_lines.received_quantity",
    ])
    .where("purchase_order_lines.purchase_order_id", "=", poId)
    .orderBy("purchase_order_lines.id", "asc")
    .execute();
}

export async function findLineById(poId: number, lineId: number) {
  const db = getDb();
  return db
    .selectFrom("purchase_order_lines")
    .leftJoin("raw_materials", "raw_materials.id", "purchase_order_lines.raw_material_id")
    .select([
      "purchase_order_lines.id",
      "purchase_order_lines.raw_material_id",
      "raw_materials.name as material_name",
      "purchase_order_lines.quantity",
      "purchase_order_lines.received_quantity",
    ])
    .where("purchase_order_lines.id", "=", lineId)
    .where("purchase_order_lines.purchase_order_id", "=", poId)
    .executeTakeFirst();
}

export interface PurchaseOrderListItem {
  id: number;
  po_number: string;
  supplier_id: number;
  supplier_name: string | null;
  status: string;
  order_date: Date;
  total_amount: string;
  created_at: Date;
}

export async function list(params: ListParams & { supplierId?: number }): Promise<ListResult<PurchaseOrderListItem>> {
  const db = getDb();
  let base = db
    .selectFrom("purchase_orders")
    .leftJoin("suppliers", "suppliers.id", "purchase_orders.supplier_id")
    .where("purchase_orders.deleted_at", "is", null);

  if (params.status) base = base.where("purchase_orders.status", "=", params.status as never);
  if (params.supplierId) base = base.where("purchase_orders.supplier_id", "=", params.supplierId);
  if (params.search) {
    const term = `%${params.search}%`;
    base = base.where((eb) => eb.or([eb("purchase_orders.po_number", "like", term), eb("suppliers.name", "like", term)]));
  }

  const totalRow = await base.select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirst();
  const total = Number(totalRow?.count ?? 0);

  const allowedSort = ["id", "po_number", "order_date", "total_amount", "status", "created_at"];
  const sortColumn = allowedSort.includes(params.sort ?? "") ? `purchase_orders.${params.sort}` : "purchase_orders.id";

  const items = await base
    .select([
      "purchase_orders.id",
      "purchase_orders.po_number",
      "purchase_orders.supplier_id",
      "suppliers.name as supplier_name",
      "purchase_orders.status",
      "purchase_orders.order_date",
      "purchase_orders.total_amount",
      "purchase_orders.created_at",
    ])
    .orderBy(sql.ref(sortColumn), "desc")
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize)
    .execute();

  return toListResult(items, total, params);
}

export interface CreatePurchaseOrderValues {
  supplier_id: number;
  order_date: string;
  expected_delivery_date: string | null;
  notes: string | null;
  tax_rate: number;
  discount_percent: number;
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  auto_created: boolean;
}

export async function create(
  poNumber: string,
  values: CreatePurchaseOrderValues,
  lines: (PurchaseOrderLineInput & { line_total: number })[],
  performedBy: number | null,
) {
  const db = getDb();
  return db.transaction().execute(async (trx) => {
    const result = await trx
      .insertInto("purchase_orders")
      .values({ po_number: poNumber, status: "draft", ...values, created_by: performedBy, updated_by: performedBy })
      .executeTakeFirstOrThrow();
    const id = Number(result.insertId);

    await trx
      .insertInto("purchase_order_lines")
      .values(lines.map((line) => ({ purchase_order_id: id, ...line, received_quantity: 0 })))
      .execute();

    return id;
  });
}

export async function replaceLines(
  poId: number,
  lines: (PurchaseOrderLineInput & { line_total: number })[],
): Promise<void> {
  const db = getDb();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("purchase_order_lines").where("purchase_order_id", "=", poId).execute();
    if (lines.length > 0) {
      await trx
        .insertInto("purchase_order_lines")
        .values(lines.map((line) => ({ purchase_order_id: poId, ...line, received_quantity: 0 })))
        .execute();
    }
  });
}

export async function update(
  id: number,
  values: Partial<{
    supplier_id: number;
    order_date: string;
    expected_delivery_date: string | null;
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
    .updateTable("purchase_orders")
    .set({ ...values, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function updateStatus(
  id: number,
  values: Partial<{
    status: string;
    cancel_reason: string | null;
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
    .updateTable("purchase_orders")
    .set(setValues as never)
    .where("id", "=", id)
    .execute();
}

export async function updateLineReceivedQuantity(lineId: number, receivedQuantity: number): Promise<void> {
  const db = getDb();
  await db
    .updateTable("purchase_order_lines")
    .set({ received_quantity: receivedQuantity })
    .where("id", "=", lineId)
    .execute();
}

export async function softDelete(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("purchase_orders")
    .set({ deleted_at: sql`CURRENT_TIMESTAMP`, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function restore(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("purchase_orders")
    .set({ deleted_at: null, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function findOverdueCandidates() {
  const db = getDb();
  return db
    .selectFrom("purchase_orders")
    .selectAll()
    .where("deleted_at", "is", null)
    .where("status", "not in", ["received", "cancelled"])
    .where("admin_review_required", "=", false)
    .where("expected_delivery_date", "is not", null)
    .execute();
}

export async function findMaterialIdsWithPendingPo(): Promise<Set<number>> {
  const db = getDb();
  const rows = await db
    .selectFrom("purchase_order_lines")
    .innerJoin("purchase_orders", "purchase_orders.id", "purchase_order_lines.purchase_order_id")
    .select("purchase_order_lines.raw_material_id")
    .where("purchase_orders.deleted_at", "is", null)
    .where("purchase_orders.status", "in", ["draft", "sent", "confirmed", "partially_received"])
    .execute();
  return new Set(rows.map((r) => r.raw_material_id));
}
