import { record } from "../../application/services/auditService.js";
import { nextNumber } from "../../application/services/numberSeriesService.js";
import { ConflictError, NotFoundAppError, ValidationAppError } from "../../core/errors/index.js";
import { assertReasonGiven, assertTransitionAllowed } from "../../core/workflow/index.js";
import * as dealService from "../deals/service.js";
import { changeStatus as changeOrderStatus } from "../orders/commands.js";
import * as ordersRepository from "../orders/repository.js";
import * as productsRepository from "../products/repository.js";
import { ALLOWED_TRANSITIONS, ELIGIBLE_ORDER_STATUS, type DeliveryNoteStatus } from "./constants.js";
import { getDeliveryNote } from "./queries.js";
import * as repository from "./repository.js";
import type { DeliveryNoteCreateInput, DeliveryNoteUpdateInput } from "./schema.js";

const TABLE_NAME = "delivery_notes";

async function getEligibleOrder(orderId: number) {
  const order = await ordersRepository.findById(orderId);
  if (!order) throw new ValidationAppError(`Order ${orderId} not found.`);
  if (order.status !== ELIGIBLE_ORDER_STATUS) {
    throw new ConflictError(
      `A delivery note can only be created for an order that is '${ELIGIBLE_ORDER_STATUS}' (current status: '${order.status}').`,
    );
  }
  const existing = await repository.findActiveByOrderId(orderId);
  if (existing) {
    throw new ConflictError(`Order ${order.order_number} already has a delivery note (${existing.delivery_note_number}).`);
  }
  return order;
}

export async function createDeliveryNote(
  input: DeliveryNoteCreateInput,
  performedBy: number | null,
  autoCreated = false,
) {
  const order = await getEligibleOrder(input.order_id);

  let lines: { product_id: number; quantity_delivered: number }[];
  if (input.lines && input.lines.length > 0) {
    for (const line of input.lines) {
      const product = await productsRepository.findById(line.product_id);
      if (!product) throw new ValidationAppError(`Product ${line.product_id} not found.`);
    }
    lines = input.lines;
  } else {
    // Default: mirror the order's own lines exactly.
    const orderLines = await ordersRepository.getLines(input.order_id);
    lines = orderLines.map((ol) => ({ product_id: ol.product_id, quantity_delivered: Number(ol.quantity) }));
  }

  const noteNumber = await nextNumber("DELIVERY_NOTE");
  const id = await repository.create(
    noteNumber,
    { order_id: input.order_id, delivery_date: input.delivery_date, notes: input.notes ?? null, auto_created: autoCreated },
    lines,
    performedBy,
  );
  await record({ entityType: TABLE_NAME, entityId: id, action: "create", performedBy });

  await dealService.advanceStage(order.deal_id, "delivery", performedBy);

  return getDeliveryNote(id);
}

export async function updateDeliveryNote(id: number, input: DeliveryNoteUpdateInput, performedBy: number | null) {
  const note = await repository.findById(id);
  if (!note) throw new NotFoundAppError("Delivery note");
  if (note.status !== "draft") throw new ConflictError("Only draft delivery notes can be edited.");

  const updateValues: Parameters<typeof repository.update>[1] = {};
  if (input.delivery_date !== undefined) updateValues.delivery_date = input.delivery_date;
  if (input.notes !== undefined) updateValues.notes = input.notes ?? null;

  if (input.lines !== undefined) {
    for (const line of input.lines) {
      const product = await productsRepository.findById(line.product_id);
      if (!product) throw new ValidationAppError(`Product ${line.product_id} not found.`);
    }
    await repository.replaceLines(id, input.lines);
  }

  await repository.update(id, updateValues, performedBy);
  await record({
    entityType: TABLE_NAME,
    entityId: id,
    action: "update",
    performedBy,
    changes: input as Record<string, unknown>,
  });
  return getDeliveryNote(id);
}

export async function changeStatus(
  id: number,
  newStatus: DeliveryNoteStatus,
  reason: string | null | undefined,
  performedBy: number | null,
) {
  const note = await repository.findById(id);
  if (!note) throw new NotFoundAppError("Delivery note");
  assertTransitionAllowed(ALLOWED_TRANSITIONS, note.status as DeliveryNoteStatus, newStatus, "delivery note");

  if (newStatus === "issued") {
    await changeOrderStatus(note.order_id, "shipped", null, performedBy);
  } else if (newStatus === "cancelled") {
    assertReasonGiven(reason, "A reason is required to cancel a delivery note.");
    await repository.updateStatus(id, { cancel_reason: reason }, performedBy);
  }

  const oldStatus = note.status;
  await repository.updateStatus(id, { status: newStatus }, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "update", performedBy, changes: { status: [oldStatus, newStatus] } });

  return getDeliveryNote(id);
}

export async function deleteDeliveryNote(id: number, performedBy: number | null): Promise<void> {
  const note = await repository.findById(id);
  if (!note) throw new NotFoundAppError("Delivery note");
  if (note.status !== "draft") {
    throw new ConflictError("Only draft delivery notes can be deleted; cancel issued ones instead.");
  }
  await repository.softDelete(id, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "delete", performedBy });
}

export async function restoreDeliveryNote(id: number, performedBy: number | null) {
  const note = await repository.findById(id, true);
  if (!note) throw new NotFoundAppError("Delivery note");
  await repository.restore(id, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "restore", performedBy });
  return getDeliveryNote(id);
}
