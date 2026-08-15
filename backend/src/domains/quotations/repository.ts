import { sql } from "kysely";

import { getDb } from "../../infrastructure/database/connection.js";
import { toListResult, type ListParams, type ListResult } from "../../infrastructure/database/listParams.js";
import type { QuotationLineInput } from "./schema.js";

export async function findById(id: number, includeDeleted = false) {
  const db = getDb();
  let query = db
    .selectFrom("quotations")
    .leftJoin("customers", "customers.id", "quotations.customer_id")
    .leftJoin("deals", "deals.id", "quotations.deal_id")
    .select([
      "quotations.id",
      "quotations.quotation_number",
      "quotations.customer_id",
      "customers.name as customer_name",
      "customers.email as customer_email",
      "quotations.deal_id",
      "deals.deal_number",
      "quotations.quotation_date",
      "quotations.valid_until",
      "quotations.status",
      "quotations.subtotal_amount",
      "quotations.discount_percent",
      "quotations.discount_amount",
      "quotations.tax_rate",
      "quotations.tax_amount",
      "quotations.total_amount",
      "quotations.notes",
      "quotations.converted_order_id",
      "quotations.feasibility_id",
      "quotations.auto_created",
      "quotations.close_reason",
      "quotations.approved_at",
      "quotations.created_at",
      "quotations.created_by",
      "quotations.updated_at",
      "quotations.updated_by",
      "quotations.deleted_at",
    ])
    .where("quotations.id", "=", id);
  if (!includeDeleted) query = query.where("quotations.deleted_at", "is", null);
  return query.executeTakeFirst();
}

export async function getLines(quotationId: number) {
  const db = getDb();
  return db
    .selectFrom("quotation_details")
    .leftJoin("products", "products.id", "quotation_details.product_id")
    .select([
      "quotation_details.id",
      "quotation_details.product_id",
      "products.code as product_code",
      "products.name as product_name",
      "products.unit",
      "quotation_details.quantity",
      "quotation_details.unit_price",
      "quotation_details.discount_percent",
      "quotation_details.line_total",
    ])
    .where("quotation_details.quotation_id", "=", quotationId)
    .orderBy("quotation_details.id", "asc")
    .execute();
}

export interface QuotationListItem {
  id: number;
  quotation_number: string;
  customer_id: number;
  customer_name: string | null;
  status: string;
  quotation_date: Date;
  total_amount: string;
  created_at: Date;
}

export async function list(params: ListParams & { customerId?: number }): Promise<ListResult<QuotationListItem>> {
  const db = getDb();
  let base = db
    .selectFrom("quotations")
    .leftJoin("customers", "customers.id", "quotations.customer_id")
    .where("quotations.deleted_at", "is", null);

  if (params.status) base = base.where("quotations.status", "=", params.status as never);
  if (params.customerId) base = base.where("quotations.customer_id", "=", params.customerId);
  if (params.search) {
    const term = `%${params.search}%`;
    base = base.where((eb) => eb.or([eb("quotations.quotation_number", "like", term), eb("customers.name", "like", term)]));
  }

  const totalRow = await base.select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirst();
  const total = Number(totalRow?.count ?? 0);

  const allowedSort = ["id", "quotation_number", "quotation_date", "total_amount", "status", "created_at"];
  const sortColumn = allowedSort.includes(params.sort ?? "") ? `quotations.${params.sort}` : "quotations.id";

  const items = await base
    .select([
      "quotations.id",
      "quotations.quotation_number",
      "quotations.customer_id",
      "customers.name as customer_name",
      "quotations.status",
      "quotations.quotation_date",
      "quotations.total_amount",
      "quotations.created_at",
    ])
    .orderBy(sql.ref(sortColumn), "desc")
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize)
    .execute();

  return toListResult(items, total, params);
}

export interface CreateQuotationValues {
  customer_id: number;
  deal_id: number | null;
  feasibility_id: number | null;
  quotation_date: string;
  valid_until: string | null;
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
  quotationNumber: string,
  values: CreateQuotationValues,
  lines: (QuotationLineInput & { line_total: number })[],
  performedBy: number | null,
) {
  const db = getDb();
  return db.transaction().execute(async (trx) => {
    const result = await trx
      .insertInto("quotations")
      .values({
        quotation_number: quotationNumber,
        status: "draft",
        ...values,
        created_by: performedBy,
        updated_by: performedBy,
      })
      .executeTakeFirstOrThrow();
    const id = Number(result.insertId);

    await trx
      .insertInto("quotation_details")
      .values(lines.map((line) => ({ quotation_id: id, ...line })))
      .execute();

    return id;
  });
}

export async function replaceLines(
  quotationId: number,
  lines: (QuotationLineInput & { line_total: number })[],
): Promise<void> {
  const db = getDb();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("quotation_details").where("quotation_id", "=", quotationId).execute();
    if (lines.length > 0) {
      await trx
        .insertInto("quotation_details")
        .values(lines.map((line) => ({ quotation_id: quotationId, ...line })))
        .execute();
    }
  });
}

export async function update(
  id: number,
  values: Partial<{
    customer_id: number;
    quotation_date: string;
    valid_until: string | null;
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
    .updateTable("quotations")
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
    converted_order_id: number | null;
  }>,
  performedBy: number | null,
): Promise<void> {
  const db = getDb();
  const setValues = { ...values, updated_by: performedBy };
  await db
    .updateTable("quotations")
    .set(setValues as never)
    .where("id", "=", id)
    .execute();
}

export async function softDelete(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("quotations")
    .set({ deleted_at: sql`CURRENT_TIMESTAMP`, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function restore(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("quotations")
    .set({ deleted_at: null, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function findExpirableCandidates(asOf: Date) {
  const db = getDb();
  return db
    .selectFrom("quotations")
    .selectAll()
    .where("deleted_at", "is", null)
    .where("status", "=", "sent")
    .where("valid_until", "is not", null)
    .where("valid_until", "<", asOf)
    .execute();
}
