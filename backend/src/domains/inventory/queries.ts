import { NotFoundAppError } from "../../core/errors/index.js";
import { getDb } from "../../infrastructure/database/connection.js";
import * as productsRepository from "../products/repository.js";
import * as rawMaterialsRepository from "../rawMaterials/repository.js";
import * as repository from "./repository.js";
import type { ItemType } from "./schema.js";
import type { StockLevel } from "./commands.js";

async function assertItemExists(itemType: ItemType, itemId: number): Promise<void> {
  if (itemType === "product") {
    const product = await productsRepository.findById(itemId);
    if (!product) throw new NotFoundAppError("Product");
  } else {
    const material = await rawMaterialsRepository.findById(itemId);
    if (!material) throw new NotFoundAppError("Raw material");
  }
}

export async function getStock(itemType: ItemType, itemId: number): Promise<StockLevel> {
  await assertItemExists(itemType, itemId);
  const db = getDb();

  const row =
    itemType === "product"
      ? await repository.getFinishedGoodsRow(db, itemId)
      : await repository.getRawMaterialRow(db, itemId);

  const onHand = row ? Number(row.quantity_on_hand) : 0;
  const reserved = row ? Number(row.quantity_reserved) : 0;
  return {
    item_type: itemType,
    item_id: itemId,
    quantity_on_hand: onHand,
    quantity_reserved: reserved,
    quantity_available: onHand - reserved,
  };
}

export interface LowStockItem {
  raw_material_id: number;
  code: string;
  name: string;
  quantity_on_hand: number;
  reorder_point: number;
}

export async function getLowStock(): Promise<LowStockItem[]> {
  const db = getDb();
  const rows = await repository.getLowStock(db);
  return rows
    .map((row) => ({
      raw_material_id: row.raw_material_id,
      code: row.code,
      name: row.name,
      quantity_on_hand: row.quantity_on_hand ? Number(row.quantity_on_hand) : 0,
      reorder_point: Number(row.reorder_point),
    }))
    .filter((item) => item.quantity_on_hand <= item.reorder_point);
}

export async function getMovementHistory(params: {
  itemType?: ItemType;
  itemId?: number;
  referenceType?: string;
  referenceId?: number;
  page: number;
  pageSize: number;
  sort?: string;
}) {
  const db = getDb();
  return repository.getMovementHistory(db, params);
}
