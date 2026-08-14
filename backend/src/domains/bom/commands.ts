import { record } from "../../application/services/auditService.js";
import { ConflictError, NotFoundAppError, ValidationAppError } from "../../core/errors/index.js";
import { getDb } from "../../infrastructure/database/connection.js";
import * as productsRepository from "../products/repository.js";
import * as rawMaterialsRepository from "../rawMaterials/repository.js";
import * as repository from "./repository.js";
import * as rules from "./rules.js";
import type { BomLineInput, BomReplaceInput } from "./schema.js";

const TABLE_NAME = "bom_lines";

async function assertActiveProductExists(productId: number): Promise<void> {
  const product = await productsRepository.findById(productId);
  if (!product) throw new NotFoundAppError("Product");
}

async function assertComponentExists(componentType: "raw_material" | "product", componentId: number): Promise<void> {
  if (componentType === "product") {
    const product = await productsRepository.findById(componentId);
    if (!product) throw new ValidationAppError(`Component product ${componentId} not found.`);
  } else {
    const material = await rawMaterialsRepository.findById(componentId);
    if (!material) throw new ValidationAppError(`Component raw material ${componentId} not found.`);
  }
}

export async function replaceBom(parentProductId: number, input: BomReplaceInput, performedBy: number | null) {
  await assertActiveProductExists(parentProductId);
  const db = getDb();

  for (const line of input.lines) {
    await assertComponentExists(line.component_type, line.component_id);
    await rules.assertNoCycle(db, parentProductId, line.component_type, line.component_id);
  }

  const previousCount = await repository.softDeleteAllActiveLines(db, parentProductId, performedBy);
  await repository.insertLines(db, parentProductId, input.lines, performedBy);

  await record({
    entityType: TABLE_NAME,
    entityId: parentProductId,
    action: "update",
    performedBy,
    changes: { lines: [`${previousCount} line(s)`, `${input.lines.length} line(s)`] },
  });

  return queryBom(parentProductId);
}

export async function addBomLine(parentProductId: number, input: BomLineInput, performedBy: number | null) {
  await assertActiveProductExists(parentProductId);
  await assertComponentExists(input.component_type, input.component_id);
  const db = getDb();
  await rules.assertNoCycle(db, parentProductId, input.component_type, input.component_id);

  const duplicate = await repository.findDuplicateLine(db, parentProductId, input.component_type, input.component_id);
  if (duplicate) {
    throw new ConflictError("This component is already on the BOM; edit that line instead.");
  }

  const row = await repository.insertLine(db, parentProductId, input, performedBy);
  await record({ entityType: TABLE_NAME, entityId: parentProductId, action: "create", performedBy });

  const [withLabels] = await repository.resolveComponentLabels(db, [row]);
  return withLabels;
}

export async function deleteBomLine(parentProductId: number, lineId: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  const line = await repository.findLineById(db, parentProductId, lineId);
  if (!line) throw new NotFoundAppError("BOM line");

  await repository.softDeleteLine(db, lineId, performedBy);
  // Keyed by parent_product_id (not line id) so this shows up in the
  // product's BOM history alongside replaceBom's entries.
  await record({ entityType: TABLE_NAME, entityId: parentProductId, action: "delete", performedBy });
}

async function queryBom(parentProductId: number) {
  const db = getDb();
  const lines = await repository.getActiveLines(db, parentProductId);
  return repository.resolveComponentLabels(db, lines);
}
