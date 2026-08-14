import type { Transaction } from "kysely";

import { getDb } from "../../infrastructure/database/connection.js";
import type { Database } from "../../infrastructure/database/schema.js";

type Db = ReturnType<typeof getDb> | Transaction<Database>;

export async function lockOrCreateFinishedGoodsRow(trx: Transaction<Database>, productId: number) {
  let row = await trx
    .selectFrom("finished_goods_inventory")
    .selectAll()
    .where("product_id", "=", productId)
    .forUpdate()
    .executeTakeFirst();

  if (!row) {
    await trx
      .insertInto("finished_goods_inventory")
      .values({ product_id: productId, quantity_on_hand: 0, quantity_reserved: 0 })
      .execute();
    row = await trx
      .selectFrom("finished_goods_inventory")
      .selectAll()
      .where("product_id", "=", productId)
      .forUpdate()
      .executeTakeFirst();
  }
  return row!;
}

export async function lockOrCreateRawMaterialRow(trx: Transaction<Database>, rawMaterialId: number) {
  let row = await trx
    .selectFrom("raw_material_inventory")
    .selectAll()
    .where("raw_material_id", "=", rawMaterialId)
    .forUpdate()
    .executeTakeFirst();

  if (!row) {
    await trx
      .insertInto("raw_material_inventory")
      .values({ raw_material_id: rawMaterialId, quantity_on_hand: 0, quantity_reserved: 0 })
      .execute();
    row = await trx
      .selectFrom("raw_material_inventory")
      .selectAll()
      .where("raw_material_id", "=", rawMaterialId)
      .forUpdate()
      .executeTakeFirst();
  }
  return row!;
}

export async function getFinishedGoodsRow(db: Db, productId: number) {
  return db
    .selectFrom("finished_goods_inventory")
    .selectAll()
    .where("product_id", "=", productId)
    .executeTakeFirst();
}

export async function getRawMaterialRow(db: Db, rawMaterialId: number) {
  return db
    .selectFrom("raw_material_inventory")
    .selectAll()
    .where("raw_material_id", "=", rawMaterialId)
    .executeTakeFirst();
}

export async function updateFinishedGoodsRow(
  trx: Transaction<Database>,
  productId: number,
  values: { quantity_on_hand?: number; quantity_reserved?: number },
): Promise<void> {
  await trx
    .updateTable("finished_goods_inventory")
    .set(values)
    .where("product_id", "=", productId)
    .execute();
}

export async function updateRawMaterialRow(
  trx: Transaction<Database>,
  rawMaterialId: number,
  values: { quantity_on_hand?: number; quantity_reserved?: number },
): Promise<void> {
  await trx
    .updateTable("raw_material_inventory")
    .set(values)
    .where("raw_material_id", "=", rawMaterialId)
    .execute();
}

export async function insertMovement(
  trx: Transaction<Database>,
  input: {
    itemType: "product" | "raw_material";
    itemId: number;
    movementType: "receipt" | "issue" | "adjustment" | "production_in" | "production_out" | "return";
    quantity: number;
    referenceType?: string | null;
    referenceId?: number | null;
    notes?: string | null;
    performedBy: number | null;
  },
): Promise<void> {
  await trx
    .insertInto("stock_movements")
    .values({
      item_type: input.itemType,
      item_id: input.itemId,
      movement_type: input.movementType,
      quantity: input.quantity,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      notes: input.notes ?? null,
      created_by: input.performedBy,
    })
    .execute();
}

export async function getLowStock(db: Db) {
  return db
    .selectFrom("raw_materials")
    .leftJoin("raw_material_inventory", "raw_material_inventory.raw_material_id", "raw_materials.id")
    .select([
      "raw_materials.id as raw_material_id",
      "raw_materials.code",
      "raw_materials.name",
      "raw_materials.reorder_point",
      "raw_material_inventory.quantity_on_hand",
    ])
    .where("raw_materials.deleted_at", "is", null)
    .where("raw_materials.status", "=", "active")
    .execute();
}

export interface MovementHistoryParams {
  itemType?: "product" | "raw_material";
  itemId?: number;
  referenceType?: string;
  referenceId?: number;
  page: number;
  pageSize: number;
  sort?: string;
}

const MOVEMENT_SORTABLE_COLUMNS = ["created_at", "quantity", "movement_type"] as const;

export async function getMovementHistory(db: Db, params: MovementHistoryParams) {
  let base = db.selectFrom("stock_movements");

  if (params.itemType) base = base.where("item_type", "=", params.itemType);
  if (params.itemId !== undefined) base = base.where("item_id", "=", params.itemId);
  if (params.referenceType) base = base.where("reference_type", "=", params.referenceType);
  if (params.referenceId !== undefined) base = base.where("reference_id", "=", params.referenceId);

  const totalRow = await base.select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirst();
  const total = Number(totalRow?.count ?? 0);

  const sortColumn = (MOVEMENT_SORTABLE_COLUMNS as readonly string[]).includes(params.sort ?? "")
    ? (params.sort as (typeof MOVEMENT_SORTABLE_COLUMNS)[number])
    : "created_at";

  const items = await base
    .selectAll()
    .orderBy(sortColumn, "desc")
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize)
    .execute();

  return { items, total, page: params.page, pageSize: params.pageSize };
}
