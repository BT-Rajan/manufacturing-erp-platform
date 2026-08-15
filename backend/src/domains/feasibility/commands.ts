import { record } from "../../application/services/auditService.js";
import { nextNumber } from "../../application/services/numberSeriesService.js";
import { ConflictError, NotFoundAppError, ValidationAppError } from "../../core/errors/index.js";
import { assertReasonGiven, assertTransitionAllowed } from "../../core/workflow/index.js";
import * as bomRepository from "../bom/repository.js";
import * as bomRules from "../bom/rules.js";
import * as customersRepository from "../customers/repository.js";
import * as dealService from "../deals/service.js";
import { getDb } from "../../infrastructure/database/connection.js";
import * as inventoryQueries from "../inventory/queries.js";
import * as productsRepository from "../products/repository.js";
import * as rawMaterialsRepository from "../rawMaterials/repository.js";
import { checkCapacity } from "./capacityCheck.js";
import { QUOTABLE_STATUSES, ALLOWED_TRANSITIONS, STALE_AFTER_DAYS, type FeasibilityStatus } from "./constants.js";
import { getFeasibility } from "./queries.js";
import * as repository from "./repository.js";
import type { FeasibilityCreateInput, FeasibilityExceptionDecisionInput } from "./schema.js";

const TABLE_NAME = "feasibility_checks";

async function assertCustomerExists(customerId: number): Promise<void> {
  const customer = await customersRepository.findById(customerId);
  if (!customer) throw new ValidationAppError(`Customer ${customerId} not found.`);
}

export async function createFeasibility(input: FeasibilityCreateInput, performedBy: number | null) {
  await assertCustomerExists(input.customer_id);
  for (const line of input.lines) {
    const product = await productsRepository.findById(line.product_id);
    if (!product) throw new ValidationAppError(`Product ${line.product_id} not found.`);
  }

  const feasibilityNumber = await nextNumber("FEASIBILITY");
  const deal = await dealService.getOrCreateForNewStage(input.deal_id ?? null, input.customer_id, "feasibility", performedBy);
  const id = await repository.create(feasibilityNumber, deal.id, input, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "create", performedBy });
  return getFeasibility(id);
}

export async function runCheck(id: number, performedBy: number | null) {
  const feasibility = await repository.findById(id);
  if (!feasibility) throw new NotFoundAppError("Feasibility check");
  if (feasibility.status !== "draft") {
    throw new ConflictError(`Only a draft feasibility check can be run (current status: '${feasibility.status}').`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const lines = await repository.getLines(id);
  let allFeasible = true;

  for (const line of lines) {
    const requestedQty = Number(line.quantity);

    const finishedStock = await inventoryQueries.getStock("product", line.product_id);
    const coveredByStock = Math.round(Math.min(requestedQty, Math.max(finishedStock.quantity_available, 0)) * 10000) / 10000;
    const quantityToProduce = Math.round((requestedQty - coveredByStock) * 10000) / 10000;

    if (quantityToProduce <= 0) {
      await repository.updateLine(line.id, {
        covered_by_stock: coveredByStock > 0 ? coveredByStock : null,
        is_feasible: true,
        bom_missing: null,
        shortfall_json: null,
        capacity_ok: null,
        capacity_shortfall_json: null,
      });
      continue;
    }

    const db = getDb();
    const hasBom = (await bomRepository.getActiveLines(db, line.product_id)).length > 0;
    if (!hasBom) {
      await repository.updateLine(line.id, {
        covered_by_stock: coveredByStock > 0 ? coveredByStock : null,
        is_feasible: false,
        bom_missing: true,
        shortfall_json: null,
        capacity_ok: null,
        capacity_shortfall_json: null,
      });
      allFeasible = false;
      continue;
    }

    const requirements = await bomRules.explodeRequirements(db, line.product_id, quantityToProduce);
    const shortfalls: Record<string, unknown>[] = [];
    for (const [rawMaterialIdStr, requiredQty] of Object.entries(requirements)) {
      const rawMaterialId = Number(rawMaterialIdStr);
      const stock = await inventoryQueries.getStock("raw_material", rawMaterialId);
      if (stock.quantity_available < requiredQty) {
        const material = await rawMaterialsRepository.findById(rawMaterialId, true);
        shortfalls.push({
          raw_material_id: rawMaterialId,
          code: material?.code ?? `#${rawMaterialId}`,
          name: material?.name ?? "Unknown material",
          unit: material?.unit ?? "",
          required: requiredQty,
          on_hand: stock.quantity_available,
          shortfall: Math.round((requiredQty - stock.quantity_available) * 10000) / 10000,
        });
      }
    }

    const product = await productsRepository.findById(line.product_id);
    const { capacityOk, shortfall: capacityShortfall } = await checkCapacity(
      {
        machine_id: product!.machine_id,
        production_hours_per_unit: product!.production_hours_per_unit,
        workers_required: product!.workers_required,
      },
      quantityToProduce,
      feasibility.required_by_date,
      today,
    );

    await repository.updateLine(line.id, {
      covered_by_stock: coveredByStock > 0 ? coveredByStock : null,
      is_feasible: shortfalls.length === 0,
      bom_missing: null,
      shortfall_json: shortfalls.length > 0 ? JSON.stringify(shortfalls) : null,
      capacity_ok: capacityOk,
      capacity_shortfall_json: capacityShortfall ? JSON.stringify(capacityShortfall) : null,
    });

    if (shortfalls.length > 0 || capacityOk === false) allFeasible = false;
  }

  const newStatus: FeasibilityStatus = allFeasible ? "feasible" : "exception_pending";
  await repository.updateStatus(id, { status: newStatus, checked_at: new Date() }, performedBy);
  await record({
    entityType: TABLE_NAME,
    entityId: id,
    action: "update",
    performedBy,
    changes: { status: [feasibility.status, newStatus] },
  });

  if (newStatus === "feasible") {
    await maybeAutoCreateQuotation(id, performedBy);
  }

  return getFeasibility(id);
}

export async function decideException(
  id: number,
  input: FeasibilityExceptionDecisionInput,
  performedBy: number | null,
) {
  const feasibility = await repository.findById(id);
  if (!feasibility) throw new NotFoundAppError("Feasibility check");
  if (feasibility.status !== "exception_pending") {
    throw new ConflictError(`No exception is pending on this feasibility check (current status: '${feasibility.status}').`);
  }

  const newStatus: FeasibilityStatus = input.approve ? "exception_approved" : "exception_rejected";
  await repository.updateStatus(
    id,
    {
      status: newStatus,
      exception_reason: input.reason,
      exception_by: performedBy,
      ...(input.approve
        ? {
            admin_review_required: true,
            admin_review_reason: "override" as const,
            admin_reviewed_at: null,
            admin_reviewed_by: null,
            admin_review_notes: null,
          }
        : {}),
    },
    performedBy,
  );
  await record({
    entityType: TABLE_NAME,
    entityId: id,
    action: "update",
    performedBy,
    changes: { status: [feasibility.status, newStatus] },
  });

  if (newStatus === "exception_approved") {
    await maybeAutoCreateQuotation(id, performedBy);
  } else if (newStatus === "exception_rejected") {
    await dealService.reconcileDealStatus(feasibility.deal_id, performedBy);
  }

  return getFeasibility(id);
}

export async function closeFeasibility(id: number, reason: string, performedBy: number | null) {
  const feasibility = await repository.findById(id);
  if (!feasibility) throw new NotFoundAppError("Feasibility check");
  assertTransitionAllowed(ALLOWED_TRANSITIONS, feasibility.status, "closed", "feasibility check");
  assertReasonGiven(reason, "A reason is required to close a feasibility check.");

  await repository.updateStatus(id, { status: "closed", close_reason: reason }, performedBy);
  await record({
    entityType: TABLE_NAME,
    entityId: id,
    action: "update",
    performedBy,
    changes: { status: [feasibility.status, "closed"] },
  });

  await dealService.reconcileDealStatus(feasibility.deal_id, performedBy);

  return getFeasibility(id);
}

export async function reviveFeasibility(id: number, performedBy: number | null) {
  const feasibility = await repository.findById(id);
  if (!feasibility) throw new NotFoundAppError("Feasibility check");
  const revivable: FeasibilityStatus[] = ["converted", "closed", "exception_rejected"];
  if (!revivable.includes(feasibility.status)) {
    throw new ConflictError(
      `Only a converted, closed, or rejected feasibility check can be revived (current status: '${feasibility.status}').`,
    );
  }

  await repository.updateStatus(
    id,
    {
      status: "draft",
      checked_at: null,
      exception_reason: null,
      exception_by: null,
      close_reason: null,
      admin_review_required: false,
      admin_review_reason: null,
      admin_reviewed_at: null,
      admin_reviewed_by: null,
      admin_review_notes: null,
    },
    performedBy,
  );

  const lines = await repository.getLines(id);
  for (const line of lines) {
    await repository.updateLine(line.id, {
      is_feasible: null,
      shortfall_json: null,
      capacity_ok: null,
      capacity_shortfall_json: null,
      covered_by_stock: null,
      bom_missing: null,
    });
  }

  await record({
    entityType: TABLE_NAME,
    entityId: id,
    action: "update",
    performedBy,
    changes: { status: [feasibility.status, "draft"] },
  });

  await dealService.reopenDeal(feasibility.deal_id, performedBy);

  return getFeasibility(id);
}

export async function adminReview(id: number, notes: string, performedBy: number | null) {
  const feasibility = await repository.findById(id);
  if (!feasibility) throw new NotFoundAppError("Feasibility check");
  if (!feasibility.admin_review_required) {
    throw new ConflictError("This feasibility check has no pending admin review.");
  }

  await repository.updateStatus(
    id,
    {
      admin_review_required: false,
      admin_reviewed_at: new Date(),
      admin_reviewed_by: performedBy,
      admin_review_notes: notes,
    },
    performedBy,
  );
  await record({
    entityType: TABLE_NAME,
    entityId: id,
    action: "update",
    performedBy,
    changes: { admin_review_required: [true, false] },
  });

  return getFeasibility(id);
}

export async function escalateStaleFeasibilityChecks(asOfIso?: string): Promise<number[]> {
  const asOf = asOfIso ? new Date(asOfIso) : new Date();
  const cutoff = new Date(asOf);
  cutoff.setUTCDate(cutoff.getUTCDate() - STALE_AFTER_DAYS);

  const candidates = await repository.findStaleOpenCandidates(cutoff);

  const flaggedIds: number[] = [];
  for (const candidate of candidates) {
    await repository.updateStatus(
      candidate.id,
      { admin_review_required: true, admin_review_reason: "stale_open" },
      null,
    );
    await record({
      entityType: TABLE_NAME,
      entityId: candidate.id,
      action: "update",
      performedBy: null,
      changes: { admin_review_required: [false, true] },
    });
    flaggedIds.push(candidate.id);
  }
  return flaggedIds;
}

export async function deleteFeasibility(id: number, performedBy: number | null): Promise<void> {
  const feasibility = await repository.findById(id);
  if (!feasibility) throw new NotFoundAppError("Feasibility check");
  if (feasibility.status === "converted") {
    throw new ConflictError("This feasibility check has been converted to a quotation and cannot be deleted.");
  }
  await repository.softDelete(id, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "delete", performedBy });
}

/** Called by quotation creation once it has validated this feasibility
 * check is quotable; not exposed as its own endpoint. */
export async function markConverted(id: number, performedBy: number | null): Promise<void> {
  const feasibility = await repository.findById(id);
  if (!feasibility) throw new NotFoundAppError("Feasibility check");
  if (!QUOTABLE_STATUSES.has(feasibility.status)) {
    throw new ConflictError(
      `Feasibility check '${feasibility.feasibility_number}' is not in a quotable status (current status: '${feasibility.status}').`,
    );
  }
  await repository.updateStatus(id, { status: "converted" }, performedBy);
  await record({
    entityType: TABLE_NAME,
    entityId: id,
    action: "update",
    performedBy,
    changes: { status: [feasibility.status, "converted"] },
  });
}

/** Fires the moment a check turns feasible (runCheck) or Sales
 * overrides an infeasible result (decideException, approved) -- if
 * enabled (Settings, admin/manager-only to change), drafts a
 * quotation right then, pre-filled from the check's own lines, on the
 * same deal. If disabled, does nothing -- Sales creates the quotation
 * by hand as before.
 *
 * Never throws: an auto-create failure (disabled, already converted,
 * or any other edge case) should never break the feasibility action
 * that triggered it. Dynamic import to break the circular dependency
 * -- quotations/commands.ts already imports this module (to call
 * markConverted), so a top-level import back here would be circular.
 * Mirrors jdk_clean's own local-import fix for the same reason. */
async function maybeAutoCreateQuotation(feasibilityId: number, performedBy: number | null): Promise<void> {
  const { isAutoCreateQuotationEnabled } = await import("../../application/services/settingsService.js");
  if (!(await isAutoCreateQuotationEnabled())) return;

  const feasibility = await getFeasibility(feasibilityId);
  const lines = [];
  for (const line of feasibility.lines) {
    const product = await productsRepository.findById(line.product_id);
    lines.push({
      product_id: line.product_id,
      quantity: Number(line.quantity),
      unit_price: product ? Number(product.selling_price) : 0,
      discount_percent: 0,
    });
  }
  if (lines.length === 0) return;

  try {
    const { createQuotation } = await import("../quotations/commands.js");
    await createQuotation(
      {
        customer_id: feasibility.customer_id,
        deal_id: feasibility.deal_id,
        feasibility_id: feasibility.id,
        quotation_date: new Date().toISOString().slice(0, 10),
        valid_until: null,
        notes: `Auto-created from feasibility check ${feasibility.feasibility_number}.`,
        lines,
      },
      performedBy,
      true,
    );
  } catch (err) {
    // Already converted, or some other reason it's not quotable right
    // now -- fine, this is best-effort convenience, not a hard
    // requirement. Sales can still create one by hand. Only swallow
    // the errors this is actually meant to tolerate.
    if (!(err instanceof ConflictError) && !(err instanceof ValidationAppError)) {
      throw err;
    }
  }
}

export async function restoreFeasibility(id: number, performedBy: number | null) {
  const feasibility = await repository.findById(id, true);
  if (!feasibility) throw new NotFoundAppError("Feasibility check");
  await repository.restore(id, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "restore", performedBy });
  return getFeasibility(id);
}
