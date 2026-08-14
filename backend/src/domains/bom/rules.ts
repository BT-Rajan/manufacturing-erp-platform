/**
 * Genuine business rules (not field validation), ported from
 * jdk_clean's bom_service.py: cycle detection before a write, and
 * multi-level requirement explosion for a read.
 */

import { ConflictError } from "../../core/errors/index.js";
import * as repository from "./repository.js";
import type { getDb } from "../../infrastructure/database/connection.js";

const MAX_BOM_DEPTH = 10; // guards against pathological/unintended deep nesting

type Db = ReturnType<typeof getDb>;

/** All product IDs reachable by walking down `startProductId`'s BOM
 * (its sub-assemblies, their sub-assemblies, etc). Used to detect
 * cycles before they're written: adding component `c` under parent
 * `p` is only safe if `p` is not reachable from `c`. */
async function reachableProductIds(db: Db, startProductId: number): Promise<Set<number>> {
  const visited = new Set<number>();
  let frontier = [startProductId];
  let depth = 0;

  while (frontier.length > 0) {
    depth += 1;
    if (depth > MAX_BOM_DEPTH) {
      throw new ConflictError(`BOM nesting exceeds the maximum supported depth (${MAX_BOM_DEPTH}).`);
    }
    const edges = await repository.getProductComponentEdges(db, frontier);
    const nextFrontier: number[] = [];
    for (const edge of edges) {
      if (!visited.has(edge.component_id)) {
        visited.add(edge.component_id);
        nextFrontier.push(edge.component_id);
      }
    }
    frontier = nextFrontier;
  }
  return visited;
}

export async function assertNoCycle(
  db: Db,
  parentProductId: number,
  componentType: "raw_material" | "product",
  componentId: number,
): Promise<void> {
  if (componentType !== "product") return;
  if (componentId === parentProductId) {
    throw new ConflictError("A product cannot be a component of its own BOM.");
  }
  const reachableFromComponent = await reachableProductIds(db, componentId);
  if (reachableFromComponent.has(parentProductId)) {
    throw new ConflictError(
      `Adding product ${componentId} here would create a circular BOM ` +
        `(product ${componentId} already (transitively) requires product ${parentProductId}).`,
    );
  }
}

export interface RequirementTotals {
  [rawMaterialId: number]: number;
}

/** Recursively walks a (possibly multi-level) BOM and returns total
 * raw-material requirements for producing `quantity` units of
 * `productId`, applying each level's scrap_percent along the way.
 * Sub-assemblies are expanded rather than treated as leaves; only raw
 * materials accumulate in the result. */
export async function explodeRequirements(
  db: Db,
  productId: number,
  quantity: number,
): Promise<RequirementTotals> {
  const totals: RequirementTotals = {};

  async function walk(currentProductId: number, multiplier: number, depth: number): Promise<void> {
    if (depth > MAX_BOM_DEPTH) {
      throw new ConflictError(`BOM nesting exceeds the maximum supported depth (${MAX_BOM_DEPTH}).`);
    }
    const lines = await repository.getActiveLines(db, currentProductId);
    for (const line of lines) {
      const effectiveQty = Number(line.quantity) * (1 + Number(line.scrap_percent) / 100) * multiplier;
      if (line.component_type === "raw_material") {
        totals[line.component_id] = (totals[line.component_id] ?? 0) + effectiveQty;
      } else {
        await walk(line.component_id, effectiveQty, depth + 1);
      }
    }
  }

  await walk(productId, quantity, 1);
  return totals;
}
