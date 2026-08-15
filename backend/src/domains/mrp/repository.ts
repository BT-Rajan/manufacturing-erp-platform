import { sql } from "kysely";

import { getDb } from "../../infrastructure/database/connection.js";
import * as bomRules from "../bom/rules.js";
import type { RequirementTotals } from "../bom/rules.js";
import * as inventoryQueries from "../inventory/queries.js";

const OUTSTANDING_ORDER_STATUSES = ["confirmed", "in_production", "ready_to_ship"] as const;
const SCHEDULED_BATCH_STATUSES = ["planned", "in_progress"] as const;

/** How much of each product still needs producing, from two demand
 * streams deliberately kept from double-counting each other:
 *
 * 1. Every scheduled (not yet completed) production batch's
 *    planned_quantity -- already-decided demand, whether for stock or
 *    tied to an order.
 * 2. Outstanding order lines whose order has NO batch scheduled
 *    against it at all yet, net of that product's current
 *    finished-goods on-hand stock. An order with any batch scheduled
 *    is assumed covered by that batch for this purpose, even if the
 *    quantities don't exactly reconcile -- this schema doesn't have
 *    partial-fulfillment tracking yet. Ported as-is from
 *    mrp_service.py's own documented approximation.
 */
async function quantityToProduce(): Promise<Map<number, number>> {
  const db = getDb();
  const productQty = new Map<number, number>();

  const batches = await db
    .selectFrom("production_schedules")
    .select(["product_id", "planned_quantity", "order_id"])
    .where("status", "in", [...SCHEDULED_BATCH_STATUSES])
    .where("deleted_at", "is", null)
    .execute();

  const batchedOrderIds = new Set(batches.filter((b) => b.order_id !== null).map((b) => b.order_id as number));
  for (const batch of batches) {
    productQty.set(batch.product_id, (productQty.get(batch.product_id) ?? 0) + Number(batch.planned_quantity));
  }

  let ordersQuery = db
    .selectFrom("orders")
    .innerJoin("order_lines", "order_lines.order_id", "orders.id")
    .select(["orders.id as order_id", "order_lines.product_id", "order_lines.quantity"])
    .where("orders.status", "in", [...OUTSTANDING_ORDER_STATUSES])
    .where("orders.deleted_at", "is", null);
  if (batchedOrderIds.size > 0) {
    ordersQuery = ordersQuery.where("orders.id", "not in", [...batchedOrderIds]);
  }
  const orderLines = await ordersQuery.execute();

  for (const line of orderLines) {
    const stock = await inventoryQueries.getStock("product", line.product_id);
    const stillNeeded = Math.max(0, Number(line.quantity) - stock.quantity_on_hand);
    if (stillNeeded > 0) {
      productQty.set(line.product_id, (productQty.get(line.product_id) ?? 0) + stillNeeded);
    }
  }

  return productQty;
}

/** Explodes every to-produce quantity through its product's BOM
 * (bom rules, unchanged) and sums the results across products into
 * total raw-material demand. */
export async function rawMaterialRequirements(): Promise<RequirementTotals> {
  const db = getDb();
  const productQty = await quantityToProduce();
  const totals: RequirementTotals = {};
  for (const [productId, qty] of productQty) {
    if (qty <= 0) continue;
    const lineTotals = await bomRules.explodeRequirements(db, productId, qty);
    for (const [rawMaterialId, requiredQty] of Object.entries(lineTotals)) {
      totals[Number(rawMaterialId)] = (totals[Number(rawMaterialId)] ?? 0) + requiredQty;
    }
  }
  return totals;
}

export interface PurchaseSuggestion {
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  quantity: number;
  lead_time_days: number | null;
  mode_of_supply: string | null;
}

/** Greedily allocates a shortfall across known suppliers of the
 * material, fastest lead time first (nulls last), respecting each
 * supplier's max_supply_quantity. Returns (suggestions, uncovered). */
export async function suggestPurchases(
  rawMaterialId: number,
  shortfall: number,
): Promise<{ suggestions: PurchaseSuggestion[]; uncovered: number }> {
  const db = getDb();
  const rows = await db
    .selectFrom("supplier_materials")
    .innerJoin("suppliers", "suppliers.id", "supplier_materials.supplier_id")
    .select([
      "supplier_materials.supplier_id",
      "suppliers.code as supplier_code",
      "suppliers.name as supplier_name",
      "supplier_materials.max_supply_quantity",
      "supplier_materials.lead_time_days",
      "suppliers.mode_of_supply",
    ])
    .where("supplier_materials.raw_material_id", "=", rawMaterialId)
    .where("supplier_materials.deleted_at", "is", null)
    .where("suppliers.deleted_at", "is", null)
    .where("suppliers.status", "=", "active")
    // MariaDB doesn't support NULLS LAST; ordering by "is this null"
    // ascending puts every non-null lead_time_days first (false < true),
    // then lead_time_days itself breaks ties among those.
    .orderBy(sql`supplier_materials.lead_time_days is null`)
    .orderBy("supplier_materials.lead_time_days", "asc")
    .execute();

  let remaining = shortfall;
  const suggestions: PurchaseSuggestion[] = [];
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(row.max_supply_quantity));
    suggestions.push({
      supplier_id: row.supplier_id,
      supplier_code: row.supplier_code,
      supplier_name: row.supplier_name,
      quantity: take,
      lead_time_days: row.lead_time_days,
      mode_of_supply: row.mode_of_supply,
    });
    remaining -= take;
  }
  return { suggestions, uncovered: Math.max(0, remaining) };
}
