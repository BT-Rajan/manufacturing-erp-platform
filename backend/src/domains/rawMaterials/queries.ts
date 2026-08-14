import { history as auditHistory } from "../../application/services/auditService.js";
import { NotFoundAppError } from "../../core/errors/index.js";
import type { ListParams } from "../../infrastructure/database/listParams.js";
import * as repository from "./repository.js";

const ENTITY_TYPE = "raw_material";

export async function getRawMaterial(id: number) {
  const material = await repository.findById(id);
  if (!material) throw new NotFoundAppError("Raw material");
  return material;
}

export async function listRawMaterials(params: ListParams) {
  return repository.list(params);
}

export async function getRawMaterialHistory(id: number) {
  await getRawMaterial(id);
  return auditHistory(ENTITY_TYPE, id);
}
