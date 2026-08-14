import { history as auditHistory } from "../../application/services/auditService.js";
import { NotFoundAppError } from "../../core/errors/index.js";
import type { ListParams } from "../../infrastructure/database/listParams.js";
import * as repository from "./repository.js";

const ENTITY_TYPE = "product";

export async function getProduct(id: number) {
  const product = await repository.findById(id);
  if (!product) throw new NotFoundAppError("Product");
  return product;
}

export async function listProducts(params: ListParams) {
  return repository.list(params);
}

export async function getProductHistory(id: number) {
  await getProduct(id);
  return auditHistory(ENTITY_TYPE, id);
}
