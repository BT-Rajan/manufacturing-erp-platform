import { sql, type Transaction } from "kysely";

import { getDb } from "../../infrastructure/database/connection.js";
import type { Database } from "../../infrastructure/database/schema.js";
import type { BomLineInput } from "./schema.js";

type Db = ReturnType<typeof getDb> | Transaction<Database>;

export async function getActiveLines(db: Db, parentProductId: number) {
  return db
    .selectFrom("bom_lines")
    .selectAll()
    .where("parent_product_id", "=", parentProductId)
    .where("deleted_at", "is", null)
    .orderBy("id", "asc")
    .execute();
}

/** All (component_type='product', component_id) pairs for a set of
 * parent product ids -- the one query the cycle-detection walk needs
 * per BFS level. */
export async function getProductComponentEdges(db: Db, parentProductIds: number[]) {
  if (parentProductIds.length === 0) return [];
  return db
    .selectFrom("bom_lines")
    .select(["parent_product_id", "component_id"])
    .where("parent_product_id", "in", parentProductIds)
    .where("component_type", "=", "product")
    .where("deleted_at", "is", null)
    .execute();
}

export async function findDuplicateLine(
  db: Db,
  parentProductId: number,
  componentType: "raw_material" | "product",
  componentId: number,
) {
  return db
    .selectFrom("bom_lines")
    .select("id")
    .where("parent_product_id", "=", parentProductId)
    .where("component_type", "=", componentType)
    .where("component_id", "=", componentId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
}

export async function findLineById(db: Db, parentProductId: number, lineId: number) {
  return db
    .selectFrom("bom_lines")
    .selectAll()
    .where("id", "=", lineId)
    .where("parent_product_id", "=", parentProductId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
}

export async function softDeleteAllActiveLines(
  db: Db,
  parentProductId: number,
  performedBy: number | null,
): Promise<number> {
  const existing = await getActiveLines(db, parentProductId);
  if (existing.length > 0) {
    await db
      .updateTable("bom_lines")
      .set({ deleted_at: sql`CURRENT_TIMESTAMP`, updated_by: performedBy })
      .where("parent_product_id", "=", parentProductId)
      .where("deleted_at", "is", null)
      .execute();
  }
  return existing.length;
}

export async function insertLines(db: Db, parentProductId: number, lines: BomLineInput[], performedBy: number | null) {
  if (lines.length === 0) return;
  await db
    .insertInto("bom_lines")
    .values(
      lines.map((line) => ({
        parent_product_id: parentProductId,
        ...line,
        created_by: performedBy,
        updated_by: performedBy,
      })),
    )
    .execute();
}

export async function insertLine(
  db: Db,
  parentProductId: number,
  line: BomLineInput,
  performedBy: number | null,
) {
  const result = await db
    .insertInto("bom_lines")
    .values({ parent_product_id: parentProductId, ...line, created_by: performedBy, updated_by: performedBy })
    .executeTakeFirstOrThrow();
  return db
    .selectFrom("bom_lines")
    .selectAll()
    .where("id", "=", Number(result.insertId))
    .executeTakeFirstOrThrow();
}

export async function softDeleteLine(db: Db, lineId: number, performedBy: number | null): Promise<void> {
  await db
    .updateTable("bom_lines")
    .set({ deleted_at: sql`CURRENT_TIMESTAMP`, updated_by: performedBy })
    .where("id", "=", lineId)
    .execute();
}

/** Resolves component_code/component_name for a set of lines in two
 * batched lookups (products, raw materials) rather than N+1 queries.
 * Mirrors bom_service._resolve_component_labels. */
export async function resolveComponentLabels<
  T extends { component_type: "raw_material" | "product"; component_id: number },
>(db: Db, lines: T[]): Promise<(T & { component_code: string | null; component_name: string | null })[]> {
  const productIds = [...new Set(lines.filter((l) => l.component_type === "product").map((l) => l.component_id))];
  const materialIds = [
    ...new Set(lines.filter((l) => l.component_type === "raw_material").map((l) => l.component_id)),
  ];

  const products =
    productIds.length > 0
      ? await db.selectFrom("products").select(["id", "code", "name"]).where("id", "in", productIds).execute()
      : [];
  const materials =
    materialIds.length > 0
      ? await db
          .selectFrom("raw_materials")
          .select(["id", "code", "name"])
          .where("id", "in", materialIds)
          .execute()
      : [];

  const productMap = new Map(products.map((p) => [p.id, p]));
  const materialMap = new Map(materials.map((m) => [m.id, m]));

  return lines.map((line) => {
    const source = line.component_type === "product" ? productMap.get(line.component_id) : materialMap.get(line.component_id);
    return { ...line, component_code: source?.code ?? null, component_name: source?.name ?? null };
  });
}
