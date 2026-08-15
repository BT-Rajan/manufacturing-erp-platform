import { NotFoundAppError } from "../../core/errors/index.js";
import { getDb } from "../../infrastructure/database/connection.js";
import * as dealService from "./service.js";

/** Everything under one deal. Lists, not singulars -- the loose
 * grouping means a deal could in principle have more than one
 * feasibility check or quotation. Orders/production_batches/
 * delivery_notes sections are empty for now: orders' stub has no
 * deal_id yet (Pass 2d widens it), production_schedules has no
 * order-linkage query wired here yet, and delivery_notes doesn't
 * exist until Pass 2e -- honest empty arrays, not fabricated data,
 * populated once those passes land. */
export async function getDealDetail(id: number) {
  const deal = await dealService.getDeal(id);
  if (!deal) throw new NotFoundAppError("Deal");

  const db = getDb();
  const feasibilityChecks = await db
    .selectFrom("feasibility_checks")
    .select(["id", "feasibility_number", "status"])
    .where("deal_id", "=", id)
    .where("deleted_at", "is", null)
    .orderBy("created_at", "asc")
    .execute();

  const quotations = await db
    .selectFrom("quotations")
    .select(["id", "quotation_number", "status", "total_amount", "auto_created"])
    .where("deal_id", "=", id)
    .where("deleted_at", "is", null)
    .orderBy("created_at", "asc")
    .execute();

  return {
    id: deal.id,
    deal_number: deal.deal_number,
    customer_id: deal.customer_id,
    furthest_stage: deal.furthest_stage,
    status: deal.status,
    created_at: deal.created_at,
    feasibility_checks: feasibilityChecks,
    quotations: quotations.map((q) => ({ ...q, total_amount: Number(q.total_amount) })),
    orders: [] as { id: number; order_number: string; status: string; total_amount: number }[],
    production_batches: [] as { id: number; batch_number: string; status: string; product_name: string | null }[],
    delivery_notes: [] as { id: number; delivery_note_number: string; status: string }[],
  };
}
