import { history as auditHistory } from "../../application/services/auditService.js";
import { NotFoundAppError } from "../../core/errors/index.js";
import { getDb } from "../../infrastructure/database/connection.js";
import * as productsRepository from "../products/repository.js";
import * as rawMaterialsRepository from "../rawMaterials/repository.js";
import * as repository from "./repository.js";
import * as rules from "./rules.js";

const TABLE_NAME = "bom_lines";

async function assertActiveProductExists(productId: number): Promise<void> {
  const product = await productsRepository.findById(productId);
  if (!product) throw new NotFoundAppError("Product");
}

export async function getBom(parentProductId: number) {
  await assertActiveProductExists(parentProductId);
  const db = getDb();
  const lines = await repository.getActiveLines(db, parentProductId);
  return repository.resolveComponentLabels(db, lines);
}

export async function getBomHistory(parentProductId: number) {
  return auditHistory(TABLE_NAME, parentProductId);
}

export interface RequirementLine {
  raw_material_id: number;
  code: string | null;
  name: string | null;
  unit: string | null;
  quantity_required: number;
}

export async function explodeBom(productId: number, quantity: number) {
  await assertActiveProductExists(productId);
  const db = getDb();
  const totals = await rules.explodeRequirements(db, productId, quantity);

  const rawMaterialIds = Object.keys(totals).map(Number);
  const requirements: RequirementLine[] = [];
  for (const rawMaterialId of rawMaterialIds) {
    const material = await rawMaterialsRepository.findById(rawMaterialId, true);
    requirements.push({
      raw_material_id: rawMaterialId,
      code: material?.code ?? null,
      name: material?.name ?? null,
      unit: material?.unit ?? null,
      quantity_required: Math.round((totals[rawMaterialId] ?? 0) * 10000) / 10000,
    });
  }
  requirements.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return { product_id: productId, quantity_requested: quantity, requirements };
}
