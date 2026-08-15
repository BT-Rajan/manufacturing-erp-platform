import { sql } from "kysely";

import { getDb } from "../../infrastructure/database/connection.js";
import { toListResult, type ListParams, type ListResult } from "../../infrastructure/database/listParams.js";
import type { FeasibilityCreateInput } from "./schema.js";

export async function findById(id: number, includeDeleted = false) {
  const db = getDb();
  let query = db.selectFrom("feasibility_checks").selectAll().where("id", "=", id);
  if (!includeDeleted) query = query.where("deleted_at", "is", null);
  return query.executeTakeFirst();
}

export async function getLines(feasibilityId: number) {
  const db = getDb();
  return db
    .selectFrom("feasibility_lines")
    .leftJoin("products", "products.id", "feasibility_lines.product_id")
    .select([
      "feasibility_lines.id",
      "feasibility_lines.feasibility_id",
      "feasibility_lines.product_id",
      "products.code as product_code",
      "products.name as product_name",
      "feasibility_lines.quantity",
      "feasibility_lines.covered_by_stock",
      "feasibility_lines.bom_missing",
      "feasibility_lines.is_feasible",
      "feasibility_lines.shortfall_json",
      "feasibility_lines.capacity_ok",
      "feasibility_lines.capacity_shortfall_json",
    ])
    .where("feasibility_lines.feasibility_id", "=", feasibilityId)
    .orderBy("feasibility_lines.id", "asc")
    .execute();
}

const SEARCHABLE = ["feasibility_number"] as const;

export async function list(
  params: ListParams & { customerId?: number },
): Promise<ListResult<Awaited<ReturnType<typeof findById>>>> {
  const db = getDb();
  let base = db.selectFrom("feasibility_checks").where("deleted_at", "is", null);

  if (params.status) base = base.where("status", "=", params.status as never);
  if (params.customerId) base = base.where("customer_id", "=", params.customerId);
  if (params.search) {
    const term = `%${params.search}%`;
    base = base.where((eb) => eb.or(SEARCHABLE.map((col) => eb(col, "like", term))));
  }

  const totalRow = await base.select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirst();
  const total = Number(totalRow?.count ?? 0);

  const sortColumn = ["id", "feasibility_number", "status", "created_at"].includes(params.sort ?? "")
    ? (params.sort as "id" | "feasibility_number" | "status" | "created_at")
    : "id";

  const items = await base
    .selectAll()
    .orderBy(sortColumn, "desc")
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize)
    .execute();

  return toListResult(items, total, params);
}

export async function listAvailableForQuotation(customerId?: number) {
  const db = getDb();
  let query = db
    .selectFrom("feasibility_checks")
    .selectAll()
    .where("deleted_at", "is", null)
    .where("status", "in", ["feasible", "exception_approved"]);
  if (customerId) query = query.where("customer_id", "=", customerId);
  return query.orderBy("feasibility_number", "desc").execute();
}

export async function create(
  feasibilityNumber: string,
  dealId: number,
  input: FeasibilityCreateInput,
  performedBy: number | null,
) {
  const db = getDb();
  return db.transaction().execute(async (trx) => {
    const result = await trx
      .insertInto("feasibility_checks")
      .values({
        feasibility_number: feasibilityNumber,
        customer_id: input.customer_id,
        deal_id: dealId,
        status: "draft",
        admin_review_required: false,
        required_by_date: input.required_by_date ?? null,
        notes: input.notes ?? null,
        created_by: performedBy,
        updated_by: performedBy,
      })
      .executeTakeFirstOrThrow();

    const feasibilityId = Number(result.insertId);
    await trx
      .insertInto("feasibility_lines")
      .values(
        input.lines.map((line) => ({
          feasibility_id: feasibilityId,
          product_id: line.product_id,
          quantity: line.quantity,
        })),
      )
      .execute();

    return feasibilityId;
  });
}

export async function updateStatus(
  id: number,
  values: Partial<{
    status: string;
    checked_at: Date | null;
    exception_reason: string | null;
    exception_by: number | null;
    close_reason: string | null;
    admin_review_required: boolean;
    admin_review_reason: "override" | "stale_open" | null;
    admin_reviewed_at: Date | null;
    admin_reviewed_by: number | null;
    admin_review_notes: string | null;
  }>,
  performedBy: number | null,
): Promise<void> {
  const db = getDb();
  const setValues = { ...values, updated_by: performedBy };
  await db
    .updateTable("feasibility_checks")
    .set(setValues as never)
    .where("id", "=", id)
    .execute();
}

export async function updateLine(
  lineId: number,
  values: Partial<{
    covered_by_stock: number | null;
    bom_missing: boolean | null;
    is_feasible: boolean | null;
    shortfall_json: string | null;
    capacity_ok: boolean | null;
    capacity_shortfall_json: string | null;
  }>,
): Promise<void> {
  const db = getDb();
  await db.updateTable("feasibility_lines").set(values as never).where("id", "=", lineId).execute();
}

export async function softDelete(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("feasibility_checks")
    .set({ deleted_at: sql`CURRENT_TIMESTAMP`, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function restore(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("feasibility_checks")
    .set({ deleted_at: null, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}

export async function findStaleOpenCandidates(cutoff: Date) {
  const db = getDb();
  return db
    .selectFrom("feasibility_checks")
    .selectAll()
    .where("deleted_at", "is", null)
    .where("status", "in", ["draft", "feasible", "exception_pending", "exception_approved", "exception_rejected"])
    .where("admin_review_required", "=", false)
    .where("created_at", "<=", cutoff)
    .execute();
}
