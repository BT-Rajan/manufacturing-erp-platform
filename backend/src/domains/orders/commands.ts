import { record } from "../../application/services/auditService.js";
import * as capacityService from "../../application/services/capacityService.js";
import { nextNumber } from "../../application/services/numberSeriesService.js";
import { computeDocumentTotals, priceLine } from "../../application/services/pricingService.js";
import {
  getDefaultTaxRate,
  getLargeDiscountApprovalThreshold,
  isAutoCreateDeliveryNoteEnabled,
  isAutoScheduleProductionEnabled,
} from "../../application/services/settingsService.js";
import { ConflictError, NotFoundAppError, ValidationAppError } from "../../core/errors/index.js";
import { assertReasonGiven, assertTransitionAllowed } from "../../core/workflow/index.js";
import { getDb } from "../../infrastructure/database/connection.js";
import * as customersRepository from "../customers/repository.js";
import * as dealService from "../deals/service.js";
import * as inventoryCommands from "../inventory/commands.js";
import * as inventoryQueries from "../inventory/queries.js";
import * as machinesRepository from "../machines/repository.js";
import * as productsRepository from "../products/repository.js";
import * as quotationsRepository from "../quotations/repository.js";
import { ALLOWED_TRANSITIONS, RESERVED_STATUSES, STATUSES_REQUIRING_CLOSE_REASON, type OrderStatus } from "./constants.js";
import { getOrder } from "./queries.js";
import * as repository from "./repository.js";
import type { OrderCreateInput, OrderLineInput, OrderUpdateInput } from "./schema.js";

const TABLE_NAME = "orders";

async function priceLines(lines: OrderLineInput[]) {
  const priced: (OrderLineInput & { line_total: number })[] = [];
  for (const line of lines) {
    const product = await productsRepository.findById(line.product_id);
    if (!product) throw new ValidationAppError(`Product ${line.product_id} not found.`);
    priced.push({ ...line, line_total: priceLine(line.quantity, line.unit_price, line.discount_percent) });
  }
  return priced;
}

export async function createOrder(input: OrderCreateInput, performedBy: number | null) {
  const customer = await customersRepository.findById(input.customer_id);
  if (!customer) throw new ValidationAppError(`Customer ${input.customer_id} not found.`);

  const deal = await dealService.getOrCreateForNewStage(input.deal_id ?? null, input.customer_id, "order", performedBy);

  const priced = await priceLines(input.lines);
  const subtotalAmount = Math.round(priced.reduce((sum, l) => sum + l.line_total, 0) * 100) / 100;
  const taxRate = input.tax_rate ?? (await getDefaultTaxRate());
  const discountPercent = input.discount_percent ?? 0;
  const totals = computeDocumentTotals(subtotalAmount, discountPercent, taxRate);

  const orderNumber = await nextNumber("ORDER");
  const id = await repository.create(
    orderNumber,
    {
      customer_id: input.customer_id,
      deal_id: deal.id,
      order_date: input.order_date,
      requested_delivery_date: input.requested_delivery_date ?? null,
      notes: input.notes ?? null,
      tax_rate: taxRate,
      discount_percent: discountPercent,
      subtotal_amount: subtotalAmount,
      discount_amount: totals.discountAmount,
      tax_amount: totals.taxAmount,
      total_amount: totals.totalAmount,
    },
    priced,
    performedBy,
  );

  await record({ entityType: TABLE_NAME, entityId: id, action: "create", performedBy });
  return getOrder(id);
}

export async function updateOrder(id: number, input: OrderUpdateInput, performedBy: number | null) {
  const order = await repository.findById(id);
  if (!order) throw new NotFoundAppError("Order");
  if (order.status !== "draft") throw new ConflictError("Only draft orders can be edited.");

  if (input.customer_id !== undefined) {
    const customer = await customersRepository.findById(input.customer_id);
    if (!customer) throw new ValidationAppError(`Customer ${input.customer_id} not found.`);
  }

  const updateValues: Parameters<typeof repository.update>[1] = {};
  if (input.customer_id !== undefined) updateValues.customer_id = input.customer_id;
  if (input.order_date !== undefined) updateValues.order_date = input.order_date;
  if (input.requested_delivery_date !== undefined) updateValues.requested_delivery_date = input.requested_delivery_date;
  if (input.confirmed_delivery_date !== undefined) updateValues.confirmed_delivery_date = input.confirmed_delivery_date;
  if (input.notes !== undefined) updateValues.notes = input.notes ?? null;

  let subtotalAmount = Number(order.subtotal_amount);
  let discountPercent = Number(order.discount_percent);
  let taxRate = Number(order.tax_rate);
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
  await record({ entityType: TABLE_NAME, entityId: id, action: "update", performedBy, changes: input as Record<string, unknown> });
  return getOrder(id);
}

export async function changeStatus(
  id: number,
  newStatus: OrderStatus,
  reason: string | null | undefined,
  performedBy: number | null,
) {
  const order = await repository.findById(id);
  if (!order) throw new NotFoundAppError("Order");
  assertTransitionAllowed(ALLOWED_TRANSITIONS, order.status as OrderStatus, newStatus, "order");

  if (newStatus === "confirmed") {
    const threshold = await getLargeDiscountApprovalThreshold();
    if (threshold !== null && order.approved_at === null) {
      const lines = await repository.getLines(id);
      const largest = Math.max(Number(order.discount_percent), ...lines.map((l) => Number(l.discount_percent)), 0);
      if (largest >= threshold) {
        throw new ConflictError(
          `This order has a discount of ${largest}%, at or above the large-discount approval threshold (${threshold}%), and needs admin approval before it can be confirmed.`,
        );
      }
    }
  }
  if (STATUSES_REQUIRING_CLOSE_REASON.has(newStatus)) {
    assertReasonGiven(reason, "A reason is required to cancel an order without a delivery note.");
  }

  const oldStatus = order.status as OrderStatus;
  const lines = await repository.getLines(id);

  // Stock side-effects, kept simple until production/delivery exist
  // (Pass 2e): confirming reserves finished-goods stock per line
  // (allowed to exceed on-hand -- a shortfall is exactly what MRP
  // flags, not something to block here); shipping consumes on-hand
  // stock and releases the reservation; cancelling from a reserved
  // state releases it.
  if (newStatus === "confirmed") {
    for (const line of lines) {
      await inventoryCommands.reserveStock("product", line.product_id, Number(line.quantity));
    }
  } else if (newStatus === "shipped") {
    for (const line of lines) {
      await inventoryCommands.adjustStock(
        {
          item_type: "product",
          item_id: line.product_id,
          quantity: -Number(line.quantity),
          movement_type: "issue",
          reference_type: "order",
          reference_id: id,
          notes: `Shipped against ${order.order_number}`,
        },
        performedBy,
      );
      await inventoryCommands.releaseReservation("product", line.product_id, Number(line.quantity));
    }
  } else if (newStatus === "cancelled" && RESERVED_STATUSES.has(oldStatus)) {
    for (const line of lines) {
      await inventoryCommands.releaseReservation("product", line.product_id, Number(line.quantity));
    }
  }

  await repository.updateStatus(
    id,
    {
      status: newStatus,
      ...(STATUSES_REQUIRING_CLOSE_REASON.has(newStatus) ? { close_reason: reason, admin_review_required: false } : {}),
    },
    performedBy,
  );
  await record({ entityType: TABLE_NAME, entityId: id, action: "update", performedBy, changes: { status: [oldStatus, newStatus] } });

  if (newStatus === "confirmed") {
    await maybeAutoScheduleProduction(id, performedBy);
  } else if (newStatus === "ready_to_ship") {
    await maybeAutoCreateDeliveryNote(id, performedBy);
  } else if (newStatus === "cancelled") {
    await cancelActiveProductionBatches(id, order.order_number, reason ?? null, performedBy);
    await dealService.reconcileDealStatus(order.deal_id, performedBy);
  }

  return getOrder(id);
}

/** Fires when an order is cancelled: any production batch still tied
 * to it that hasn't finished ('planned' or 'in_progress' -- 'completed'
 * batches are deliberately left alone, since the materials are
 * genuinely consumed and the units genuinely exist) is cancelled too,
 * freeing the machine time and worker-hours it was holding for a
 * request that no longer exists. The resource-freeing half of what the
 * automation needs to stay honest: it auto-schedules real capacity on
 * confirmation, so it has to auto-release that capacity on
 * cancellation too. Dynamic import: production/commands.ts already
 * imports this module (to advance a batch's order to 'in_production'
 * when it starts), so a top-level import back here would be circular. */
async function cancelActiveProductionBatches(
  orderId: number,
  orderNumber: string | null,
  closeReason: string | null,
  performedBy: number | null,
): Promise<void> {
  const db = getDb();
  const activeBatches = await db
    .selectFrom("production_schedules")
    .select("id")
    .where("order_id", "=", orderId)
    .where("deleted_at", "is", null)
    .where("status", "in", ["planned", "in_progress"])
    .execute();
  if (activeBatches.length === 0) return;

  const reason = `Order ${orderNumber ?? `#${orderId}`} was cancelled` + (closeReason ? `: ${closeReason}` : ".");
  const { changeStatus: changeBatchStatus } = await import("../production/commands.js");
  for (const batch of activeBatches) {
    try {
      await changeBatchStatus(batch.id, "cancelled", null, reason, performedBy);
    } catch (err) {
      if (!(err instanceof ConflictError) && !(err instanceof ValidationAppError)) throw err;
    }
  }
}

/** Fires the moment an order is confirmed -- the same "auto create,
 * with role-based flexibility" pattern as feasibility's auto-quotation
 * hook, one joint further along: if enabled (Settings, admin/manager-
 * only to change), schedules a production batch for each line whose
 * product has a machine + time formula, using the same vacant-slot
 * capacity scan the feasibility check itself uses. Nets off existing
 * finished-goods stock first (same as feasibility's run_check) so a
 * line already covered by stock doesn't get an unnecessary batch.
 * Lines with no formula, no machine, or no achievable slot are left
 * for Production to schedule by hand. Never throws. */
async function maybeAutoScheduleProduction(orderId: number, performedBy: number | null): Promise<void> {
  if (!(await isAutoScheduleProductionEnabled())) return;

  const order = await getOrder(orderId);
  const today = new Date().toISOString().slice(0, 10);

  let anyBatchCreated = false;
  let anyLineUnresolved = false;

  for (const line of order.lines) {
    const stock = await inventoryQueries.getStock("product", line.product_id);
    const availableFromExistingStock = Math.max(stock.quantity_on_hand - (stock.quantity_reserved - Number(line.quantity)), 0);
    const coveredByStock = Math.min(Number(line.quantity), availableFromExistingStock);
    const quantityToProduce = Math.round((Number(line.quantity) - coveredByStock) * 10000) / 10000;
    if (quantityToProduce <= 0) continue;

    const product = await productsRepository.findById(line.product_id);
    if (!product || product.machine_id === null || product.production_hours_per_unit === null) {
      anyLineUnresolved = true;
      continue;
    }
    const machine = await machinesRepository.findById(product.machine_id);
    if (!machine) {
      anyLineUnresolved = true;
      continue;
    }

    const requiredHours = Math.round(quantityToProduce * Number(product.production_hours_per_unit) * 10000) / 10000;
    const db = getDb();
    const bookedBatches = await db
      .selectFrom("production_schedules")
      .innerJoin("products", "products.id", "production_schedules.product_id")
      .select([
        "production_schedules.scheduled_start",
        "production_schedules.scheduled_end",
        "production_schedules.planned_quantity",
        "products.production_hours_per_unit as product_production_hours_per_unit",
        "products.workers_required as product_workers_required",
      ])
      .where("production_schedules.machine_id", "=", machine.id)
      .where("production_schedules.deleted_at", "is", null)
      .where("production_schedules.status", "in", [...capacityService.BOOKED_PRODUCTION_STATUSES])
      .where("production_schedules.scheduled_end", ">=", new Date(`${today}T00:00:00.000Z`))
      .execute();
    const dailyBooked = capacityService.dailyBookedHours(
      bookedBatches.map((b) => ({
        scheduled_start: b.scheduled_start.toISOString().slice(0, 10),
        scheduled_end: b.scheduled_end.toISOString().slice(0, 10),
        planned_quantity: Number(b.planned_quantity),
        product_production_hours_per_unit: b.product_production_hours_per_unit ? Number(b.product_production_hours_per_unit) : null,
        product_workers_required: b.product_workers_required,
      })),
      "machine",
    );
    const completion = capacityService.findVacantSlotCompletion(Number(machine.capacity_hours_per_day), dailyBooked, requiredHours, today);
    if (completion === null) {
      anyLineUnresolved = true;
      continue;
    }

    try {
      const { createBatch } = await import("../production/commands.js");
      await createBatch(
        {
          product_id: line.product_id,
          machine_id: machine.id,
          order_id: orderId,
          planned_quantity: quantityToProduce,
          scheduled_start: today,
          scheduled_end: completion,
        },
        performedBy,
        {
          autoScheduled: true,
          notes:
            `Auto-scheduled on confirmation of ${order.order_number}` +
            (coveredByStock > 0 ? ` (${coveredByStock} of ${Number(line.quantity)} already covered by existing stock).` : "."),
        },
      );
      anyBatchCreated = true;
    } catch (err) {
      if (!(err instanceof ConflictError) && !(err instanceof ValidationAppError)) throw err;
      anyLineUnresolved = true;
    }
  }

  if (order.lines.length > 0 && !anyBatchCreated && !anyLineUnresolved) {
    // Every line was fully covered by existing finished-goods stock --
    // nothing left to produce, so nothing will ever drive the usual
    // confirmed -> in_production -> ready_to_ship progression. Skip
    // straight to ready_to_ship instead of leaving the order stranded.
    try {
      await changeStatus(orderId, "ready_to_ship", null, performedBy);
    } catch (err) {
      if (!(err instanceof ConflictError) && !(err instanceof ValidationAppError)) throw err;
    }
  }
}

/** Fires the moment an order becomes ready to ship -- whether set
 * directly or auto-advanced by production once every batch completed.
 * The last joint in the pipeline, same pattern as the two upstream
 * hooks: if enabled, drafts a delivery note automatically (today's
 * date, lines mirrored from the order). Never throws. Dynamic import:
 * deliveryNotes/commands.ts already imports this module (to move an
 * order to 'shipped' when its note is issued), so a top-level import
 * back here would be circular. */
async function maybeAutoCreateDeliveryNote(orderId: number, performedBy: number | null): Promise<void> {
  if (!(await isAutoCreateDeliveryNoteEnabled())) return;
  try {
    const { createDeliveryNote } = await import("../deliveryNotes/commands.js");
    await createDeliveryNote(
      {
        order_id: orderId,
        delivery_date: new Date().toISOString().slice(0, 10),
        notes: "Auto-created when the order became ready to ship.",
      },
      performedBy,
      true,
    );
  } catch (err) {
    if (!(err instanceof ConflictError) && !(err instanceof ValidationAppError)) throw err;
  }
}

export async function approveOrder(id: number, performedBy: number | null) {
  const order = await repository.findById(id);
  if (!order) throw new NotFoundAppError("Order");
  if (order.status !== "draft") throw new ConflictError("Only a draft order can be approved.");
  await repository.updateStatus(id, { approved_at: new Date(), approved_by: performedBy }, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "update", performedBy, changes: { approved_at: [null, new Date().toISOString()] } });
  return getOrder(id);
}

export async function deleteOrder(id: number, performedBy: number | null): Promise<void> {
  const order = await repository.findById(id);
  if (!order) throw new NotFoundAppError("Order");
  if (order.status !== "draft") {
    throw new ConflictError("Only draft orders can be deleted; cancel confirmed orders instead.");
  }
  await repository.softDelete(id, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "delete", performedBy });
}

export async function restoreOrder(id: number, performedBy: number | null) {
  const order = await repository.findById(id, true);
  if (!order) throw new NotFoundAppError("Order");
  await repository.restore(id, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "restore", performedBy });
  return getOrder(id);
}

export async function adminReview(id: number, notes: string, performedBy: number | null) {
  const order = await repository.findById(id);
  if (!order) throw new NotFoundAppError("Order");
  if (!order.admin_review_required) throw new ConflictError("This order has no pending admin review.");
  await repository.updateStatus(
    id,
    { admin_review_required: false, admin_reviewed_at: new Date(), admin_reviewed_by: performedBy, admin_review_notes: notes },
    performedBy,
  );
  await record({ entityType: TABLE_NAME, entityId: id, action: "update", performedBy, changes: { admin_review_required: [true, false] } });
  return getOrder(id);
}

/** Flags every still-open order whose delivery date has passed with no
 * delivery note issued and no close reason recorded. delivery_notes
 * doesn't exist until Pass 2e, so the "has a delivery note" half of
 * this check is a no-op (nothing excluded on that basis) until then
 * -- purely additive once Pass 2e lands, never a false negative in
 * the meantime. */
export async function escalateOverdueOrders(asOfIso?: string): Promise<number[]> {
  const asOf = asOfIso ? new Date(asOfIso) : new Date();
  const todayStr = asOf.toISOString().slice(0, 10);

  const candidates = await repository.findOverdueCandidates();
  const flaggedIds: number[] = [];
  for (const order of candidates) {
    const dueDate = order.confirmed_delivery_date ?? order.requested_delivery_date;
    if (!dueDate) continue;
    const dueDateStr = dueDate instanceof Date ? dueDate.toISOString().slice(0, 10) : String(dueDate).slice(0, 10);
    if (dueDateStr < todayStr) {
      await repository.updateStatus(order.id, { admin_review_required: true }, null);
      await record({ entityType: TABLE_NAME, entityId: order.id, action: "update", performedBy: null, changes: { admin_review_required: [false, true] } });
      flaggedIds.push(order.id);
    }
  }
  return flaggedIds;
}

/** Converts an accepted quotation into a new draft order, copying its
 * customer/lines, then marks the quotation converted with a link back
 * to the new order. */
export async function createOrderFromQuotation(quotationId: number, performedBy: number | null) {
  const quotation = await quotationsRepository.findById(quotationId);
  if (!quotation) throw new NotFoundAppError("Quotation");
  if (quotation.status !== "accepted") {
    throw new ConflictError(`Only accepted quotations can be converted to an order (current status: '${quotation.status}').`);
  }

  const quotationLines = await quotationsRepository.getLines(quotationId);
  const lines = quotationLines.map((line) => ({
    product_id: line.product_id,
    quantity: Number(line.quantity),
    unit_price: Number(line.unit_price),
    discount_percent: Number(line.discount_percent),
    line_total: Number(line.line_total),
  }));

  const deal = await dealService.getOrCreateForNewStage(quotation.deal_id, quotation.customer_id, "order", performedBy);

  const orderNumber = await nextNumber("ORDER");
  const id = await repository.create(
    orderNumber,
    {
      customer_id: quotation.customer_id,
      deal_id: deal.id,
      order_date: new Date().toISOString().slice(0, 10),
      requested_delivery_date: null,
      notes: `Converted from quotation ${quotation.quotation_number}.`,
      tax_rate: Number(quotation.tax_rate),
      discount_percent: Number(quotation.discount_percent),
      subtotal_amount: Number(quotation.subtotal_amount),
      discount_amount: Number(quotation.discount_amount),
      tax_amount: Number(quotation.tax_amount),
      total_amount: Number(quotation.total_amount),
    },
    lines,
    performedBy,
  );
  await record({ entityType: TABLE_NAME, entityId: id, action: "create", performedBy });

  await quotationsRepository.updateStatus(
    quotationId,
    { status: "converted", converted_order_id: id },
    performedBy,
  );
  await record({
    entityType: "quotations",
    entityId: quotationId,
    action: "update",
    performedBy,
    changes: { status: [quotation.status, "converted"], converted_order_id: [null, id] },
  });

  return getOrder(id);
}
