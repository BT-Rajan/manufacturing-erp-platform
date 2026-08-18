import { record } from "../../application/services/auditService.js";
import { nextNumber } from "../../application/services/numberSeriesService.js";
import { AppError, ConflictError, NotFoundAppError, ValidationAppError } from "../../core/errors/index.js";
import { assertReasonGiven, assertTransitionAllowed } from "../../core/workflow/index.js";
import * as bomRules from "../bom/rules.js";
import * as dealService from "../deals/service.js";
import { getDb } from "../../infrastructure/database/connection.js";
import * as inventoryCommands from "../inventory/commands.js";
import * as inventoryQueries from "../inventory/queries.js";
import { changeStatus as changeOrderStatus } from "../orders/commands.js";
import * as ordersRepository from "../orders/repository.js";
import * as productsRepository from "../products/repository.js";
import * as rawMaterialsRepository from "../rawMaterials/repository.js";
import { ALLOWED_TRANSITIONS, type ProductionStatus } from "./constants.js";
import { getBatch } from "./queries.js";
import * as repository from "./repository.js";
import type { ProductionBatchCreateInput, ProductionBatchUpdateInput } from "./schema.js";

const TABLE_NAME = "production_schedules";

async function assertOrderExists(orderId: number) {
  const order = await ordersRepository.findById(orderId);
  if (!order) throw new ValidationAppError(`Order ${orderId} not found.`);
  return order;
}

export async function createBatch(
  input: ProductionBatchCreateInput,
  performedBy: number | null,
  internalOverrides?: { autoScheduled?: boolean; notes?: string },
) {
  const product = await productsRepository.findById(input.product_id);
  if (!product) throw new ValidationAppError(`Product ${input.product_id} not found.`);

  let order = null;
  if (input.order_id) {
    order = await assertOrderExists(input.order_id);
  }
  const machineId = input.machine_id ?? product.machine_id ?? null;

  const batchNumber = await nextNumber("PRODUCTION_BATCH");
  const id = await repository.create(
    batchNumber,
    {
      product_id: input.product_id,
      machine_id: machineId,
      order_id: input.order_id ?? null,
      planned_quantity: input.planned_quantity,
      scheduled_start: input.scheduled_start,
      scheduled_end: input.scheduled_end,
      notes: internalOverrides?.notes ?? input.notes ?? null,
      auto_scheduled: internalOverrides?.autoScheduled ?? false,
    },
    performedBy,
  );
  await record({ entityType: TABLE_NAME, entityId: id, action: "create", performedBy });

  if (order) {
    await dealService.advanceStage(order.deal_id, "production", performedBy);
  }

  return getBatch(id);
}

export async function updateBatch(id: number, input: ProductionBatchUpdateInput, performedBy: number | null) {
  const batch = await repository.findRawById(id);
  if (!batch) throw new NotFoundAppError("Production batch");
  if (batch.status !== "planned") {
    throw new ConflictError("Only planned batches can be edited; cancel and recreate instead.");
  }
  if (input.order_id) await assertOrderExists(input.order_id);

  const updateValues: Parameters<typeof repository.update>[1] = {};
  if (input.order_id !== undefined) updateValues.order_id = input.order_id;
  if (input.machine_id !== undefined) updateValues.machine_id = input.machine_id;
  if (input.planned_quantity !== undefined) updateValues.planned_quantity = input.planned_quantity;
  if (input.scheduled_start !== undefined) updateValues.scheduled_start = input.scheduled_start;
  if (input.scheduled_end !== undefined) updateValues.scheduled_end = input.scheduled_end;
  if (input.notes !== undefined) updateValues.notes = input.notes ?? null;

  await repository.update(id, updateValues, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "update", performedBy, changes: input as Record<string, unknown> });
  return getBatch(id);
}

async function startBatch(batch: { id: number; order_id: number | null }, performedBy: number | null): Promise<void> {
  await repository.updateStatus(batch.id, { actual_start: new Date() }, performedBy);
  if (batch.order_id) {
    const order = await ordersRepository.findById(batch.order_id);
    if (order && order.status === "confirmed") {
      await changeOrderStatus(batch.order_id, "in_production", null, performedBy);
    }
  }
}

async function completeBatch(
  batch: { id: number; product_id: number; batch_number: string | null },
  producedQuantity: number,
  performedBy: number | null,
): Promise<void> {
  const batchLabel = batch.batch_number ?? `#${batch.id}`;
  const db = getDb();
  const requirements = await bomRules.explodeRequirements(db, batch.product_id, producedQuantity);

  const shortfalls: string[] = [];
  for (const [rawMaterialIdStr, requiredQty] of Object.entries(requirements)) {
    const rawMaterialId = Number(rawMaterialIdStr);
    const stock = await inventoryQueries.getStock("raw_material", rawMaterialId);
    if (stock.quantity_on_hand < requiredQty) {
      const material = await rawMaterialsRepository.findById(rawMaterialId, true);
      const label = material ? material.name : `#${rawMaterialId}`;
      shortfalls.push(`${label} (need ${requiredQty.toFixed(4)}, have ${stock.quantity_on_hand.toFixed(4)})`);
    }
  }
  if (shortfalls.length > 0) {
    throw new AppError(`Not enough raw material on hand to complete this batch: ${shortfalls.join("; ")}`);
  }

  for (const [rawMaterialIdStr, requiredQty] of Object.entries(requirements)) {
    await inventoryCommands.adjustStock(
      {
        item_type: "raw_material",
        item_id: Number(rawMaterialIdStr),
        quantity: -requiredQty,
        movement_type: "issue",
        reference_type: "production_schedule",
        reference_id: batch.id,
        notes: `Consumed by batch ${batchLabel}`,
      },
      performedBy,
    );
  }

  await inventoryCommands.adjustStock(
    {
      item_type: "product",
      item_id: batch.product_id,
      quantity: producedQuantity,
      movement_type: "receipt",
      reference_type: "production_schedule",
      reference_id: batch.id,
      notes: `Produced by batch ${batchLabel}`,
    },
    performedBy,
  );

  await repository.updateStatus(batch.id, { produced_quantity: producedQuantity, actual_end: new Date() }, performedBy);
}

async function maybeAdvanceOrderToReadyToShip(orderId: number | null, performedBy: number | null): Promise<void> {
  if (orderId === null) return;
  const order = await ordersRepository.findById(orderId);
  if (!order || order.status !== "in_production") return;

  const batches = await repository.findActiveByOrderId(orderId);
  if (batches.some((b) => b.status !== "completed" && b.status !== "cancelled")) return;
  if (!batches.some((b) => b.status === "completed")) return;

  try {
    await changeOrderStatus(orderId, "ready_to_ship", null, performedBy);
  } catch (err) {
    if (!(err instanceof ConflictError) && !(err instanceof ValidationAppError)) throw err;
  }
}

export async function changeStatus(
  id: number,
  newStatus: ProductionStatus,
  producedQuantity: number | null | undefined,
  reason: string | null | undefined,
  performedBy: number | null,
) {
  const batch = await repository.findRawById(id);
  if (!batch) throw new NotFoundAppError("Production batch");
  assertTransitionAllowed(ALLOWED_TRANSITIONS, batch.status as ProductionStatus, newStatus, "production batch");

  if (newStatus === "in_progress") {
    await startBatch(batch, performedBy);
  } else if (newStatus === "completed") {
    if (!producedQuantity) throw new ValidationAppError("produced_quantity is required to complete a batch.");
    await completeBatch(batch, producedQuantity, performedBy);
  } else if (newStatus === "cancelled") {
    assertReasonGiven(reason, "A reason is required to cancel a production batch.");
    await repository.updateStatus(id, { cancel_reason: reason }, performedBy);
  }

  const oldStatus = batch.status;
  await repository.updateStatus(id, { status: newStatus }, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "update", performedBy, changes: { status: [oldStatus, newStatus] } });

  if (newStatus === "completed") {
    await maybeAdvanceOrderToReadyToShip(batch.order_id, performedBy);
  }

  return getBatch(id);
}

export async function deleteBatch(id: number, performedBy: number | null): Promise<void> {
  const batch = await repository.findRawById(id);
  if (!batch) throw new NotFoundAppError("Production batch");
  if (batch.status !== "planned") {
    throw new ConflictError("Only planned batches can be deleted; cancel started batches instead.");
  }
  await repository.softDelete(id, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "delete", performedBy });
}

export async function restoreBatch(id: number, performedBy: number | null) {
  const batch = await repository.findRawById(id);
  if (!batch) throw new NotFoundAppError("Production batch");
  await repository.restore(id, performedBy);
  await record({ entityType: TABLE_NAME, entityId: id, action: "restore", performedBy });
  return getBatch(id);
}
