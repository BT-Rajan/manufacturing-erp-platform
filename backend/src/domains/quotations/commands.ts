import { record } from "../../application/services/auditService.js";
import { nextNumber } from "../../application/services/numberSeriesService.js";
import { computeDocumentTotals, priceLine } from "../../application/services/pricingService.js";
import { getDefaultTaxRate, getLargeDiscountApprovalThreshold } from "../../application/services/settingsService.js";
import { ConflictError, NotFoundAppError, ValidationAppError } from "../../core/errors/index.js";
import { assertReasonGiven, assertTransitionAllowed } from "../../core/workflow/index.js";
import * as customersRepository from "../customers/repository.js";
import * as dealService from "../deals/service.js";
import { markConverted as markFeasibilityConverted } from "../feasibility/commands.js";
import { getFeasibility } from "../feasibility/queries.js";
import * as productsRepository from "../products/repository.js";
import { ALLOWED_TRANSITIONS, STATUSES_REQUIRING_CLOSE_REASON, type QuotationStatus } from "./constants.js";
import * as repository from "./repository.js";
import { getQuotation } from "./queries.js";
import type { QuotationCreateInput, QuotationLineInput, QuotationUpdateInput } from "./schema.js";

const TABLE_NAME = "quotations";

async function priceLines(lines: QuotationLineInput[]) {
  const priced: (QuotationLineInput & { line_total: number })[] = [];
  for (const line of lines) {
    const product = await productsRepository.findById(line.product_id);
    if (!product) throw new ValidationAppError(`Product ${line.product_id} not found.`);
    const lineTotal = priceLine(line.quantity, line.unit_price, line.discount_percent);
    priced.push({ ...line, line_total: lineTotal });
  }
  return priced;
}

export async function createQuotation(
  input: QuotationCreateInput,
  performedBy: number | null,
  autoCreated = false,
) {
  const customer = await customersRepository.findById(input.customer_id);
  if (!customer) throw new ValidationAppError(`Customer ${input.customer_id} not found.`);

  // A quotation can be raised off a feasibility check that came back
  // feasible (or was exception-approved), or created standalone with
  // no check at all. If given, mark that check converted and inherit
  // its deal.
  let dealId = input.deal_id ?? null;
  if (input.feasibility_id) {
    await markFeasibilityConverted(input.feasibility_id, performedBy);
    if (!dealId) {
      const checked = await getFeasibility(input.feasibility_id);
      dealId = checked.deal_id;
    }
  }

  const deal = await dealService.getOrCreateForNewStage(dealId, input.customer_id, "quotation", performedBy);

  const priced = await priceLines(input.lines);
  const subtotalAmount = Math.round(priced.reduce((sum, l) => sum + l.line_total, 0) * 100) / 100;
  const taxRate = input.tax_rate ?? (await getDefaultTaxRate());
  const discountPercent = input.discount_percent ?? 0;
  const totals = computeDocumentTotals(subtotalAmount, discountPercent, taxRate);

  const quotationNumber = await nextNumber("QUOTATION");

  const id = await repository.create(
    quotationNumber,
    {
      customer_id: input.customer_id,
      deal_id: deal.id,
      feasibility_id: input.feasibility_id ?? null,
      quotation_date: input.quotation_date,
      valid_until: input.valid_until ?? null,
      notes: input.notes ?? null,
      tax_rate: taxRate,
      discount_percent: discountPercent,
      subtotal_amount: subtotalAmount,
      discount_amount: totals.discountAmount,
      tax_amount: totals.taxAmount,
      total_amount: totals.totalAmount,
      auto_created: autoCreated,
    },
    priced,
    performedBy,
  );

  await record({ entityType: TABLE_NAME, entityId: id, action: "create", performedBy });
  return getQuotation(id);
}

export async function updateQuotation(id: number, input: QuotationUpdateInput, performedBy: number | null) {
  const quotation = await repository.findById(id);
  if (!quotation) throw new NotFoundAppError("Quotation");
  if (quotation.status !== "draft") {
    throw new ConflictError("Only draft quotations can be edited.");
  }

  if (input.customer_id !== undefined) {
    const customer = await customersRepository.findById(input.customer_id);
    if (!customer) throw new ValidationAppError(`Customer ${input.customer_id} not found.`);
  }

  const updateValues: Parameters<typeof repository.update>[1] = {};
  if (input.customer_id !== undefined) updateValues.customer_id = input.customer_id;
  if (input.quotation_date !== undefined) updateValues.quotation_date = input.quotation_date;
  if (input.valid_until !== undefined) updateValues.valid_until = input.valid_until;
  if (input.notes !== undefined) updateValues.notes = input.notes ?? null;

  let subtotalAmount = Number(quotation.subtotal_amount);
  let discountPercent = Number(quotation.discount_percent);
  let taxRate = Number(quotation.tax_rate);
  let clearApproval = false;

  if (input.lines !== undefined) {
    const priced = await priceLines(input.lines);
    await repository.replaceLines(id, priced);
    subtotalAmount = Math.round(priced.reduce((sum, l) => sum + l.line_total, 0) * 100) / 100;
    clearApproval = true;
  }
  if (input.tax_rate !== undefined && input.tax_rate !== null) {
    taxRate = input.tax_rate;
    updateValues.tax_rate = taxRate;
  }
  if (input.discount_percent !== undefined && input.discount_percent !== null) {
    discountPercent = input.discount_percent;
    updateValues.discount_percent = discountPercent;
    clearApproval = true;
  }

  if (input.lines !== undefined || input.tax_rate !== undefined || input.discount_percent !== undefined) {
    const totals = computeDocumentTotals(subtotalAmount, discountPercent, taxRate);
    updateValues.subtotal_amount = subtotalAmount;
    updateValues.discount_amount = totals.discountAmount;
    updateValues.tax_amount = totals.taxAmount;
    updateValues.total_amount = totals.totalAmount;
  }
  if (clearApproval) {
    updateValues.approved_at = null;
    updateValues.approved_by = null;
  }

  await repository.update(id, updateValues, performedBy);
  await record({
    entityType: TABLE_NAME,
    entityId: id,
    action: "update",
    performedBy,
    changes: input as Record<string, unknown>,
  });
  return getQuotation(id);
}

export async function changeStatus(
  id: number,
  newStatus: Exclude<QuotationStatus, "converted">,
  reason: string | null | undefined,
  performedBy: number | null,
) {
  const quotation = await repository.findById(id);
  if (!quotation) throw new NotFoundAppError("Quotation");
  assertTransitionAllowed(ALLOWED_TRANSITIONS, quotation.status as QuotationStatus, newStatus, "quotation");

  if (newStatus === "sent") {
    const threshold = await getLargeDiscountApprovalThreshold();
    if (threshold !== null && quotation.approved_at === null) {
      const lines = await repository.getLines(id);
      const largest = Math.max(Number(quotation.discount_percent), ...lines.map((l) => Number(l.discount_percent)), 0);
      if (largest >= threshold) {
        throw new ConflictError(
          `This quotation has a discount of ${largest}%, at or above the large-discount approval threshold (${threshold}%), and needs admin approval before it can be sent.`,
        );
      }
    }
  }

  if (STATUSES_REQUIRING_CLOSE_REASON.has(newStatus)) {
    assertReasonGiven(reason, "A reason is required to close a quotation without generating an order.");
  }

  const oldStatus = quotation.status;
  await repository.updateStatus(
    id,
    { status: newStatus, ...(STATUSES_REQUIRING_CLOSE_REASON.has(newStatus) ? { close_reason: reason } : {}) },
    performedBy,
  );
  await record({ entityType: TABLE_NAME, entityId: id, action: "update", performedBy, changes: { status: [oldStatus, newStatus] } });

  if (newStatus === "rejected" || newStatus === "expired") {
    await dealService.reconcileDealStatus(quotation.deal_id, performedBy);
  }

  return getQuotation(id);
}

/** Admin sign-off clearing the large-discount gate -- can be called
 * any time a quotation is still draft, whether or not it's actually
 * at/above the current threshold (the threshold can change after the
 * quotation was drafted; approving early never hurts). */
export async function approveQuotation(id: number, performedBy: number | null) {
  const quotation = await repository.findById(id);
  if (!quotation) throw new NotFoundAppError("Quotation");
  if (quotation.status !== "draft") {
    throw new ConflictError("Only a draft quotation can be approved.");
  }
  await repository.updateStatus(id, { approved_at: new Date(), approved_by: performedBy }, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "update", performedBy, changes: { approved_at: [null, new Date().toISOString()] } });
  return getQuotation(id);
}

export async function deleteQuotation(id: number, performedBy: number | null): Promise<void> {
  const quotation = await repository.findById(id);
  if (!quotation) throw new NotFoundAppError("Quotation");
  if (quotation.status === "converted") {
    throw new ConflictError("This quotation has been converted to an order and cannot be deleted.");
  }
  await repository.softDelete(id, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "delete", performedBy });
}

export async function restoreQuotation(id: number, performedBy: number | null) {
  const quotation = await repository.findById(id, true);
  if (!quotation) throw new NotFoundAppError("Quotation");
  await repository.restore(id, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "restore", performedBy });
  return getQuotation(id);
}

/** Moves every 'sent' quotation whose valid_until has passed to
 * 'expired'. Meant to be run periodically (Pass 6 background jobs) --
 * exposed as an admin-triggered endpoint in the meantime. Idempotent:
 * only 'sent' quotations past their valid_until are touched, and once
 * expired they're excluded by the status filter on the next run. */
export async function escalateExpiredQuotations(asOfIso?: string): Promise<number[]> {
  const asOf = asOfIso ? new Date(asOfIso) : new Date();
  const candidates = await repository.findExpirableCandidates(asOf);

  const expiredIds: number[] = [];
  for (const quotation of candidates) {
    await repository.updateStatus(quotation.id, { status: "expired" }, null);
    await record({ entityType: TABLE_NAME, entityId: quotation.id, action: "update", performedBy: null, changes: { status: [quotation.status, "expired"] } });
    expiredIds.push(quotation.id);
  }
  if (expiredIds.length > 0) {
    for (const quotation of candidates) {
      await dealService.reconcileDealStatus(quotation.deal_id, null);
    }
  }
  return expiredIds;
}
