import { history as auditHistory } from "../../application/services/auditService.js";
import { NotFoundAppError } from "../../core/errors/index.js";
import type { ListParams } from "../../infrastructure/database/listParams.js";
import * as repository from "./repository.js";

const TABLE_NAME = "purchase_orders";

export async function getPurchaseOrder(id: number, includeDeleted = false) {
  const po = await repository.findById(id, includeDeleted);
  if (!po) throw new NotFoundAppError("Purchase order");
  const lines = await repository.getLines(id);
  return { ...po, lines };
}

export async function listPurchaseOrders(params: ListParams & { supplierId?: number }) {
  return repository.list(params);
}

export async function getPurchaseOrderHistory(id: number) {
  await getPurchaseOrder(id, true);
  return auditHistory(TABLE_NAME, id);
}
