import { history as auditHistory } from "../../application/services/auditService.js";
import { NotFoundAppError } from "../../core/errors/index.js";
import type { ListParams } from "../../infrastructure/database/listParams.js";
import * as repository from "./repository.js";

const ENTITY_TYPE = "supplier";

export async function getSupplier(id: number) {
  const supplier = await repository.findById(id);
  if (!supplier) throw new NotFoundAppError("Supplier");
  return supplier;
}

export async function listSuppliers(params: ListParams) {
  return repository.list(params);
}

export async function getSupplierHistory(id: number) {
  await getSupplier(id);
  return auditHistory(ENTITY_TYPE, id);
}
