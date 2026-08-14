import { getDb } from "../../infrastructure/database/connection.js";
import type { SupplierMaterialLineInput } from "./schema.js";

export async function listBySupplier(supplierId: number) {
  const db = getDb();
  return db
    .selectFrom("supplier_materials")
    .innerJoin("raw_materials", "raw_materials.id", "supplier_materials.raw_material_id")
    .select([
      "supplier_materials.id",
      "supplier_materials.supplier_id",
      "supplier_materials.raw_material_id",
      "raw_materials.code as material_code",
      "raw_materials.name as material_name",
      "raw_materials.unit as material_unit",
      "supplier_materials.max_supply_quantity",
      "supplier_materials.lead_time_days",
      "supplier_materials.created_at",
      "supplier_materials.updated_at",
    ])
    .where("supplier_materials.supplier_id", "=", supplierId)
    .where("supplier_materials.deleted_at", "is", null)
    .execute();
}

/** Replaces the full set of lines for a supplier in one transaction:
 * every existing line for that supplier is removed and the given set
 * is inserted fresh. Matches the "send the whole edited grid" contract
 * supplierMaterialsReplaceSchema documents. */
export async function replaceLines(
  supplierId: number,
  lines: SupplierMaterialLineInput[],
  performedBy: number | null,
): Promise<void> {
  const db = getDb();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("supplier_materials").where("supplier_id", "=", supplierId).execute();
    if (lines.length === 0) return;
    await trx
      .insertInto("supplier_materials")
      .values(
        lines.map((line) => ({
          supplier_id: supplierId,
          raw_material_id: line.raw_material_id,
          max_supply_quantity: line.max_supply_quantity,
          lead_time_days: line.lead_time_days ?? null,
          created_by: performedBy,
          updated_by: performedBy,
        })),
      )
      .execute();
  });
}
