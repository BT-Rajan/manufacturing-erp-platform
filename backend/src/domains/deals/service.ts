/**
 * A deal is a loose grouping tying one customer request's feasibility
 * check, quotation(s), and order together via deal_id on each of
 * those tables. Loose on purpose: whichever stage is created first
 * with no deal_id given starts a new deal -- nothing requires every
 * deal to pass through every stage. Ported from deal_service.py.
 */

import { record } from "../../application/services/auditService.js";
import { nextNumber } from "../../application/services/numberSeriesService.js";
import { getDb } from "../../infrastructure/database/connection.js";

export const DEAL_STAGES = ["feasibility", "quotation", "order", "production", "delivery"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
const STAGE_ORDER: Record<DealStage, number> = Object.fromEntries(
  DEAL_STAGES.map((s, i) => [s, i]),
) as Record<DealStage, number>;

const TABLE_NAME = "deals";

export async function getDeal(id: number) {
  const db = getDb();
  return db.selectFrom("deals").selectAll().where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
}

/** The loose-grouping rule, in one place: if a dealId is already known
 * (e.g. a quotation created from a feasibility check inherits that
 * check's deal), reuse it and bump furthest_stage if this stage is
 * further along. Otherwise start a new deal right here. */
export async function getOrCreateForNewStage(
  dealId: number | null,
  customerId: number,
  stage: DealStage,
  performedBy: number | null,
): Promise<{ id: number; furthest_stage: DealStage; status: "open" | "cancelled" }> {
  const db = getDb();

  if (dealId !== null) {
    const deal = await getDeal(dealId);
    if (deal) {
      const updates: Partial<{ furthest_stage: DealStage; status: "open"; updated_by: number | null }> = {};
      if (STAGE_ORDER[stage] > STAGE_ORDER[deal.furthest_stage]) {
        updates.furthest_stage = stage;
      }
      if (deal.status === "cancelled") {
        updates.status = "open";
      }
      if (Object.keys(updates).length > 0) {
        await db
          .updateTable("deals")
          .set({ ...updates, updated_by: performedBy })
          .where("id", "=", dealId)
          .execute();
      }
      return { id: deal.id, furthest_stage: updates.furthest_stage ?? deal.furthest_stage, status: updates.status ?? deal.status };
    }
  }

  const dealNumber = await nextNumber("DEAL");
  const result = await db
    .insertInto("deals")
    .values({ deal_number: dealNumber, customer_id: customerId, furthest_stage: stage, status: "open", created_by: performedBy, updated_by: performedBy })
    .executeTakeFirstOrThrow();
  const id = Number(result.insertId);
  await record({ entityType: TABLE_NAME, entityId: id, action: "create", performedBy });
  return { id, furthest_stage: stage, status: "open" };
}

/** Bumps furthest_stage on an existing deal without creating anything
 * -- used when a later stage (production, delivery) attaches to a
 * deal that already exists rather than originating one. */
export async function advanceStage(dealId: number | null, stage: DealStage, performedBy: number | null): Promise<void> {
  if (dealId === null) return;
  const deal = await getDeal(dealId);
  if (!deal) return;
  if (STAGE_ORDER[stage] > STAGE_ORDER[deal.furthest_stage]) {
    const db = getDb();
    await db.updateTable("deals").set({ furthest_stage: stage, updated_by: performedBy }).where("id", "=", dealId).execute();
  }
}

/** Explicitly reopens a deal (e.g. feasibility revive calling this
 * when the check it's reviving belongs to a deal marked cancelled). */
export async function reopenDeal(dealId: number | null, performedBy: number | null): Promise<void> {
  if (dealId === null) return;
  const deal = await getDeal(dealId);
  if (!deal || deal.status !== "cancelled") return;
  const db = getDb();
  await db.updateTable("deals").set({ status: "open", updated_by: performedBy }).where("id", "=", dealId).execute();
}

/** Called after a feasibility check, quotation, or order under a deal
 * terminates negatively -- checks whether anything left under the
 * deal could still move it forward, and marks it 'cancelled' if not.
 * Deliberately conservative: a deal with nothing under it at all yet
 * is left alone rather than guessed at. */
export async function reconcileDealStatus(dealId: number | null, performedBy: number | null): Promise<void> {
  if (dealId === null) return;
  const deal = await getDeal(dealId);
  if (!deal || deal.status === "cancelled") return;

  const db = getDb();
  // orders.deal_id doesn't exist until Pass 2d widens the orders stub
  // (see migration 0004's header) -- there is no way to correctly
  // query "orders under this deal" yet, so this half of the check is
  // honestly a no-op (empty list) rather than a query that would
  // incorrectly match unrelated orders by some other field. Once Pass
  // 2d lands, this becomes a real `where deal_id = dealId` query and
  // reconcileDealStatus needs no other change.
  const orders: { status: string }[] = [];
  const quotations = await db
    .selectFrom("quotations")
    .select(["status"])
    .where("deal_id", "=", dealId)
    .where("deleted_at", "is", null)
    .execute();
  const checks = await db
    .selectFrom("feasibility_checks")
    .select(["status"])
    .where("deal_id", "=", dealId)
    .where("deleted_at", "is", null)
    .execute();

  if (orders.length === 0 && quotations.length === 0 && checks.length === 0) return;

  const orderAlive = orders.some((o) => o.status !== "cancelled");
  if (orderAlive) return;

  const quotationAlive = quotations.some((q) => ["draft", "sent", "accepted"].includes(q.status));
  if (quotationAlive) return;
  const checkAlive = checks.some((c) => ["draft", "feasible", "exception_pending", "exception_approved"].includes(c.status));
  if (checkAlive) return;

  await db.updateTable("deals").set({ status: "cancelled", updated_by: performedBy }).where("id", "=", dealId).execute();
}
