import { record } from "../../application/services/auditService.js";
import { nextNumber } from "../../application/services/numberSeriesService.js";
import { computeDocumentTotals, priceLine } from "../../application/services/pricingService.js";
import { getDefaultTaxRate, getLargeDiscountApprovalThreshold, getLargePoApprovalThreshold } from "../../application/services/settingsService.js";
import { ConflictError, NotFoundAppError, ValidationAppError } from "../../core/errors/index.js";
import { assertReasonGiven, assertTransitionAllowed } from "../../core/workflow/index.js";
import * as inventoryCommands from "../inventory/commands.js";
import { computeRequirements } from "../mrp/queries.js";
import * as rawMaterialsRepository from "../rawMaterials/repository.js";
import * as suppliersRepository from "../suppliers/repository.js";
import { ALLOWED_TRANSITIONS, type PurchaseOrderStatus } from "./constants.js";
import { getPurchaseOrder } from "./queries.js";
import * as repository from "./repository.js";
import type { PurchaseOrderCreateInput, PurchaseOrderLineInput, PurchaseOrderUpdateInput } from "./schema.js";

const TABLE_NAME = "purchase_orders";

async function priceLines(lines: PurchaseOrderLineInput[]) {
  const priced: (PurchaseOrderLineInput & { line_total: number })[] = [];
  for (const line of lines) {
    const material = await rawMaterialsRepository.findById(line.raw_material_id);
    if (!material) throw new ValidationAppError(`Raw material ${line.raw_material_id} not found.`);
    priced.push({ ...line, line_total: priceLine(line.quantity, line.unit_price, line.discount_percent) });
  }
  return priced;
}

export async function createPurchaseOrder(input: PurchaseOrderCreateInput, performedBy: number | null, autoCreated = false) {
  const supplier = await suppliersRepository.findById(input.supplier_id);
  if (!supplier) throw new ValidationAppError(`Supplier ${input.supplier_id} not found.`);

  const priced = await priceLines(input.lines);
  const subtotalAmount = Math.round(priced.reduce((sum, l) => sum + l.line_total, 0) * 100) / 100;
  const taxRate = input.tax_rate ?? (await getDefaultTaxRate());
  const discountPercent = input.discount_percent ?? 0;
  const totals = computeDocumentTotals(subtotalAmount, discountPercent, taxRate);

  const poNumber = await nextNumber("PURCHASE_ORDER");
  const id = await repository.create(
    poNumber,
    {
      supplier_id: input.supplier_id,
      order_date: input.order_date,
      expected_delivery_date: input.expected_delivery_date ?? null,
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
  return getPurchaseOrder(id);
}

/** MRP already knows exactly what's short and, for each material,
 * which supplier(s) could cover it (mrp's suggested_purchases -- a
 * real greedy allocation by lead time, respecting max_supply_quantity).
 * Turns that into actual draft POs: one per supplier, grouping every
 * material that supplier was suggested for. Always lands in 'draft'
 * for procurement to review -- never sent automatically.
 *
 * Materials with no known supplier are skipped (nothing to draft
 * against -- still visible on the MRP report for manual sourcing).
 * Materials already covered by an existing non-cancelled PO line are
 * also skipped, so re-running this periodically doesn't pile up
 * duplicate drafts for the same shortage. */
export async function autoDraftFromMrpShortages(performedBy: number | null) {
  const requirements = await computeRequirements();
  if (requirements.length === 0) return [];

  const alreadyPending = await repository.findMaterialIdsWithPendingPo();

  const bySupplier = new Map<number, { raw_material_id: number; quantity: number; lead_time_days: number | null }[]>();
  for (const req of requirements) {
    if (alreadyPending.has(req.raw_material_id)) continue;
    for (const suggestion of req.suggested_purchases) {
      const lines = bySupplier.get(suggestion.supplier_id) ?? [];
      lines.push({ raw_material_id: req.raw_material_id, quantity: suggestion.quantity, lead_time_days: suggestion.lead_time_days });
      bySupplier.set(suggestion.supplier_id, lines);
    }
  }
  if (bySupplier.size === 0) return [];

  const created = [];
  const today = new Date();
  for (const [supplierId, lines] of bySupplier) {
    const maxLeadTime = Math.max(...lines.map((l) => l.lead_time_days ?? 7));
    const poLines: PurchaseOrderLineInput[] = [];
    for (const line of lines) {
      const material = await rawMaterialsRepository.findById(line.raw_material_id, true);
      if (!material) continue;
      poLines.push({ raw_material_id: line.raw_material_id, quantity: line.quantity, unit_price: Number(material.unit_cost), discount_percent: 0 });
    }
    if (poLines.length === 0) continue;

    const expectedDelivery = new Date(today);
    expectedDelivery.setUTCDate(expectedDelivery.getUTCDate() + maxLeadTime);

    try {
      const po = await createPurchaseOrder(
        {
          supplier_id: supplierId,
          order_date: today.toISOString().slice(0, 10),
          expected_delivery_date: expectedDelivery.toISOString().slice(0, 10),
          notes: "Auto-drafted from an MRP shortage. Review quantities and pricing before sending.",
          lines: poLines,
        },
        performedBy,
        true,
      );
      created.push(po);
    } catch (err) {
      if (!(err instanceof ConflictError) && !(err instanceof ValidationAppError)) throw err;
    }
  }
  return created;
}

export async function updatePurchaseOrder(id: number, input: PurchaseOrderUpdateInput, performedBy: number | null) {
  const po = await repository.findById(id);
  if (!po) throw new NotFoundAppError("Purchase order");
  if (po.status !== "draft") throw new ConflictError("Only draft purchase orders can be edited.");

  if (input.supplier_id !== undefined) {
    const supplier = await suppliersRepository.findById(input.supplier_id);
    if (!supplier) throw new ValidationAppError(`Supplier ${input.supplier_id} not found.`);
  }

  const updateValues: Parameters<typeof repository.update>[1] = {};
  if (input.supplier_id !== undefined) updateValues.supplier_id = input.supplier_id;
  if (input.order_date !== undefined) updateValues.order_date = input.order_date;
  if (input.expected_delivery_date !== undefined) updateValues.expected_delivery_date = input.expected_delivery_date;
  if (input.notes !== undefined) updateValues.notes = input.notes ?? null;

  let subtotalAmount = Number(po.subtotal_amount);
  let discountPercent = Number(po.discount_percent);
  let taxRate = Number(po.tax_rate);
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
  return getPurchaseOrder(id);
}

/** Handles the plain transitions (draft->sent->confirmed, and
 * cancelling). Receiving goods is deliberately NOT one of these -- it
 * needs per-line quantities, so it's its own action (receiveLines). */
export async function changeStatus(
  id: number,
  newStatus: Exclude<PurchaseOrderStatus, "partially_received" | "received">,
  reason: string | null | undefined,
  performedBy: number | null,
) {
  const po = await repository.findById(id);
  if (!po) throw new NotFoundAppError("Purchase order");
  assertTransitionAllowed(ALLOWED_TRANSITIONS, po.status as PurchaseOrderStatus, newStatus, "purchase order");

  if (newStatus === "sent") {
    const amountThreshold = await getLargePoApprovalThreshold();
    if (amountThreshold !== null && Number(po.total_amount) >= amountThreshold && po.approved_at === null) {
      throw new ConflictError(
        `This purchase order (${Number(po.total_amount).toFixed(2)}) is at or above the large-PO approval threshold (${amountThreshold}) and needs admin approval before it can be sent.`,
      );
    }
    const discountThreshold = await getLargeDiscountApprovalThreshold();
    if (discountThreshold !== null && po.approved_at === null) {
      const lines = await repository.getLines(id);
      const largest = Math.max(Number(po.discount_percent), ...lines.map((l) => Number(l.discount_percent)), 0);
      if (largest >= discountThreshold) {
        throw new ConflictError(
          `This purchase order has a discount of ${largest}%, at or above the large-discount approval threshold (${discountThreshold}%), and needs admin approval before it can be sent.`,
        );
      }
    }
  } else if (newStatus === "cancelled") {
    assertReasonGiven(reason, "A reason is required to cancel a purchase order.");
  }

  const oldStatus = po.status;
  await repository.updateStatus(id, { status: newStatus, ...(newStatus === "cancelled" ? { cancel_reason: reason } : {}) }, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "update", performedBy, changes: { status: [oldStatus, newStatus] } });
  return getPurchaseOrder(id);
}

export async function approvePurchaseOrder(id: number, performedBy: number | null) {
  const po = await repository.findById(id);
  if (!po) throw new NotFoundAppError("Purchase order");
  if (po.status !== "draft") throw new ConflictError("Only a draft purchase order can be approved.");
  await repository.updateStatus(id, { approved_at: new Date(), approved_by: performedBy }, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "update", performedBy, changes: { approved_at: [null, new Date().toISOString()] } });
  return getPurchaseOrder(id);
}

/** Records goods received against one or more lines -- possibly
 * partial, possibly spread across several calls. Each receipt
 * increases raw-material stock on hand and the line's
 * received_quantity; the PO's overall status is recomputed from the
 * lines afterward. Validates every receipt before applying any of
 * them, so a bad line in the batch doesn't leave earlier ones already
 * applied. */
export async function receiveLines(
  id: number,
  receipts: { line_id: number; quantity: number }[],
  performedBy: number | null,
) {
  const po = await repository.findById(id);
  if (!po) throw new NotFoundAppError("Purchase order");
  if (po.status !== "confirmed" && po.status !== "partially_received") {
    throw new ConflictError(`Cannot receive goods against a purchase order in '${po.status}' status; it must be confirmed first.`);
  }

  const lines = await repository.getLines(id);
  const linesById = new Map(lines.map((l) => [l.id, l]));

  for (const receipt of receipts) {
    const line = linesById.get(receipt.line_id);
    if (!line) throw new ValidationAppError(`Line ${receipt.line_id} does not belong to this purchase order.`);
    const remaining = Number(line.quantity) - Number(line.received_quantity);
    if (receipt.quantity > remaining) {
      throw new ValidationAppError(
        `Cannot receive ${receipt.quantity} of ${line.material_name}: only ${remaining.toFixed(4)} remains outstanding on this line.`,
      );
    }
  }

  for (const receipt of receipts) {
    const line = linesById.get(receipt.line_id)!;
    await inventoryCommands.adjustStock(
      {
        item_type: "raw_material",
        item_id: line.raw_material_id,
        quantity: receipt.quantity,
        movement_type: "receipt",
        reference_type: "purchase_order",
        reference_id: id,
        notes: `Received against ${po.po_number}`,
      },
      performedBy,
    );
    await repository.updateLineReceivedQuantity(line.id, Number(line.received_quantity) + receipt.quantity);
  }

  const updatedLines = await repository.getLines(id);
  const allReceived = updatedLines.every((l) => Number(l.received_quantity) >= Number(l.quantity));
  const newStatus = allReceived ? "received" : "partially_received";
  await repository.updateStatus(id, { status: newStatus }, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "update", performedBy, changes: { status: [po.status, newStatus] } });

  return getPurchaseOrder(id);
}

export async function deletePurchaseOrder(id: number, performedBy: number | null): Promise<void> {
  const po = await repository.findById(id);
  if (!po) throw new NotFoundAppError("Purchase order");
  if (po.status !== "draft") {
    throw new ConflictError("Only draft purchase orders can be deleted; cancel confirmed ones instead.");
  }
  await repository.softDelete(id, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "delete", performedBy });
}

export async function restorePurchaseOrder(id: number, performedBy: number | null) {
  const po = await repository.findById(id, true);
  if (!po) throw new NotFoundAppError("Purchase order");
  await repository.restore(id, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "restore", performedBy });
  return getPurchaseOrder(id);
}

export async function adminReview(id: number, notes: string, performedBy: number | null) {
  const po = await repository.findById(id);
  if (!po) throw new NotFoundAppError("Purchase order");
  if (!po.admin_review_required) throw new ConflictError("This purchase order has no pending admin review.");
  await repository.updateStatus(
    id,
    { admin_review_required: false, admin_reviewed_at: new Date(), admin_reviewed_by: performedBy, admin_review_notes: notes },
    performedBy,
  );
  await record({ entityType: TABLE_NAME, entityId: id, action: "update", performedBy, changes: { admin_review_required: [true, false] } });
  return getPurchaseOrder(id);
}

/** The purchasing-side mirror of orders' escalateOverdueOrders: flags
 * every PO past expected_delivery_date with nothing received and not
 * cancelled -- a supplier running late. */
export async function escalateOverduePurchaseOrders(asOfIso?: string): Promise<number[]> {
  const asOf = asOfIso ? new Date(asOfIso) : new Date();
  const todayStr = asOf.toISOString().slice(0, 10);

  const candidates = await repository.findOverdueCandidates();
  const flaggedIds: number[] = [];
  for (const po of candidates) {
    if (!po.expected_delivery_date) continue;
    const dueDateStr =
      po.expected_delivery_date instanceof Date
        ? po.expected_delivery_date.toISOString().slice(0, 10)
        : String(po.expected_delivery_date).slice(0, 10);
    if (dueDateStr < todayStr) {
      await repository.updateStatus(po.id, { admin_review_required: true }, null);
      await record({ entityType: TABLE_NAME, entityId: po.id, action: "update", performedBy: null, changes: { admin_review_required: [false, true] } });
      flaggedIds.push(po.id);
    }
  }
  return flaggedIds;
}
