import { AppError, NotFoundAppError, ValidationAppError } from "../../core/errors/index.js";
import { getDb } from "../../infrastructure/database/connection.js";
import * as productsRepository from "../products/repository.js";
import * as rawMaterialsRepository from "../rawMaterials/repository.js";
import * as repository from "./repository.js";
import type { ItemType, StockAdjustRequest } from "./schema.js";

async function assertItemExists(itemType: ItemType, itemId: number): Promise<void> {
  if (itemType === "product") {
    const product = await productsRepository.findById(itemId);
    if (!product) throw new NotFoundAppError("Product");
  } else {
    const material = await rawMaterialsRepository.findById(itemId);
    if (!material) throw new NotFoundAppError("Raw material");
  }
}

export interface StockLevel {
  item_type: ItemType;
  item_id: number;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
}

function toStockLevel(
  itemType: ItemType,
  itemId: number,
  row: { quantity_on_hand: string; quantity_reserved: string },
): StockLevel {
  const onHand = Number(row.quantity_on_hand);
  const reserved = Number(row.quantity_reserved);
  return {
    item_type: itemType,
    item_id: itemId,
    quantity_on_hand: onHand,
    quantity_reserved: reserved,
    quantity_available: onHand - reserved,
  };
}

/** Apply a signed quantity delta to on-hand stock and record the
 * movement, inside one transaction with a row lock -- quantity > 0 is
 * stock coming in, quantity < 0 is stock going out. Refuses to let
 * on-hand stock go negative. */
export async function adjustStock(
  input: StockAdjustRequest & {
    reference_type?: string | null;
    reference_id?: number | null;
  },
  performedBy: number | null,
): Promise<StockLevel> {
  await assertItemExists(input.item_type, input.item_id);
  const db = getDb();

  return db.transaction().execute(async (trx) => {
    if (input.item_type === "product") {
      const row = await repository.lockOrCreateFinishedGoodsRow(trx, input.item_id);
      const newQuantity = Number(row.quantity_on_hand) + input.quantity;
      if (newQuantity < 0) {
        throw new AppError(
          `Insufficient stock: ${row.quantity_on_hand} on hand, cannot apply change of ${input.quantity}.`,
        );
      }
      await repository.updateFinishedGoodsRow(trx, input.item_id, { quantity_on_hand: newQuantity });
      await repository.insertMovement(trx, {
        itemType: "product",
        itemId: input.item_id,
        movementType: input.movement_type,
        quantity: input.quantity,
        referenceType: input.reference_type,
        referenceId: input.reference_id,
        notes: input.notes,
        performedBy,
      });
      return toStockLevel("product", input.item_id, {
        quantity_on_hand: String(newQuantity),
        quantity_reserved: row.quantity_reserved,
      });
    }

    const row = await repository.lockOrCreateRawMaterialRow(trx, input.item_id);
    const newQuantity = Number(row.quantity_on_hand) + input.quantity;
    if (newQuantity < 0) {
      throw new AppError(
        `Insufficient stock: ${row.quantity_on_hand} on hand, cannot apply change of ${input.quantity}.`,
      );
    }
    await repository.updateRawMaterialRow(trx, input.item_id, { quantity_on_hand: newQuantity });
    await repository.insertMovement(trx, {
      itemType: "raw_material",
      itemId: input.item_id,
      movementType: input.movement_type,
      quantity: input.quantity,
      referenceType: input.reference_type,
      referenceId: input.reference_id,
      notes: input.notes,
      performedBy,
    });
    return toStockLevel("raw_material", input.item_id, {
      quantity_on_hand: String(newQuantity),
      quantity_reserved: row.quantity_reserved,
    });
  });
}

/** Increases quantity_reserved without touching on-hand stock. Used
 * when an order is confirmed: stock is earmarked even if it hasn't
 * shipped (or been produced) yet. Reservations are allowed to exceed
 * on-hand quantity -- a shortfall here is exactly the signal MRP/
 * feasibility act on, not something to silently block at this layer. */
export async function reserveStock(itemType: ItemType, itemId: number, quantity: number): Promise<StockLevel> {
  if (quantity <= 0) throw new ValidationAppError("Reservation quantity must be positive.");
  await assertItemExists(itemType, itemId);
  const db = getDb();

  return db.transaction().execute(async (trx) => {
    if (itemType === "product") {
      const row = await repository.lockOrCreateFinishedGoodsRow(trx, itemId);
      const newReserved = Number(row.quantity_reserved) + quantity;
      await repository.updateFinishedGoodsRow(trx, itemId, { quantity_reserved: newReserved });
      return toStockLevel("product", itemId, { quantity_on_hand: row.quantity_on_hand, quantity_reserved: String(newReserved) });
    }
    const row = await repository.lockOrCreateRawMaterialRow(trx, itemId);
    const newReserved = Number(row.quantity_reserved) + quantity;
    await repository.updateRawMaterialRow(trx, itemId, { quantity_reserved: newReserved });
    return toStockLevel("raw_material", itemId, { quantity_on_hand: row.quantity_on_hand, quantity_reserved: String(newReserved) });
  });
}

/** Decreases quantity_reserved (order cancelled, or shipped and no
 * longer just "reserved"). Clamps at zero rather than going negative. */
export async function releaseReservation(itemType: ItemType, itemId: number, quantity: number): Promise<StockLevel> {
  if (quantity <= 0) throw new ValidationAppError("Release quantity must be positive.");
  await assertItemExists(itemType, itemId);
  const db = getDb();

  return db.transaction().execute(async (trx) => {
    if (itemType === "product") {
      const row = await repository.lockOrCreateFinishedGoodsRow(trx, itemId);
      const newReserved = Math.max(0, Number(row.quantity_reserved) - quantity);
      await repository.updateFinishedGoodsRow(trx, itemId, { quantity_reserved: newReserved });
      return toStockLevel("product", itemId, { quantity_on_hand: row.quantity_on_hand, quantity_reserved: String(newReserved) });
    }
    const row = await repository.lockOrCreateRawMaterialRow(trx, itemId);
    const newReserved = Math.max(0, Number(row.quantity_reserved) - quantity);
    await repository.updateRawMaterialRow(trx, itemId, { quantity_reserved: newReserved });
    return toStockLevel("raw_material", itemId, { quantity_on_hand: row.quantity_on_hand, quantity_reserved: String(newReserved) });
  });
}
