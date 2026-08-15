import { getDb } from "../../infrastructure/database/connection.js";
import * as rawMaterialsRepository from "../rawMaterials/repository.js";
import * as repository from "./repository.js";

export interface MrpResultLine {
  raw_material_id: number;
  code: string;
  name: string;
  unit: string;
  reorder_point: number;
  total_required: number;
  current_on_hand: number;
  shortfall: number;
  uncovered_quantity: number;
  fully_covered: boolean;
  suggested_purchases: repository.PurchaseSuggestion[];
}

/** The full MRP pass: demand -> BOM explosion -> net against stock ->
 * supplier suggestions for every raw material with a shortfall.
 * Read-only -- nothing here persists anything, it's computed fresh on
 * every call. Ported from mrp_service.compute_requirements. */
export async function computeRequirements(): Promise<MrpResultLine[]> {
  const rawTotals = await repository.rawMaterialRequirements();
  const rawMaterialIds = Object.keys(rawTotals).map(Number);
  if (rawMaterialIds.length === 0) return [];

  const results: MrpResultLine[] = [];
  for (const rawMaterialId of rawMaterialIds) {
    const totalRequired = rawTotals[rawMaterialId] ?? 0;
    const material = await rawMaterialsRepository.findById(rawMaterialId, true);

    // Read on-hand directly (not via inventory service's item-must-
    // exist check) since we already know the material exists from the
    // BOM explosion that produced this id.
    const stockRow = await getDb()
      .selectFrom("raw_material_inventory")
      .select("quantity_on_hand")
      .where("raw_material_id", "=", rawMaterialId)
      .executeTakeFirst();
    const onHand = stockRow ? Number(stockRow.quantity_on_hand) : 0;

    const shortfall = Math.max(0, Math.round((totalRequired - onHand) * 10000) / 10000);
    if (shortfall <= 0) continue;

    const { suggestions, uncovered } = await repository.suggestPurchases(rawMaterialId, shortfall);

    results.push({
      raw_material_id: rawMaterialId,
      code: material?.code ?? `#${rawMaterialId}`,
      name: material?.name ?? "Unknown material",
      unit: material?.unit ?? "",
      reorder_point: material ? Number(material.reorder_point) : 0,
      total_required: Math.round(totalRequired * 10000) / 10000,
      current_on_hand: onHand,
      shortfall,
      uncovered_quantity: uncovered,
      fully_covered: uncovered <= 0,
      suggested_purchases: suggestions,
    });
  }

  results.sort((a, b) => b.shortfall - a.shortfall);
  return results;
}
