import { history as auditHistory } from "../../application/services/auditService.js";
import { NotFoundAppError } from "../../core/errors/index.js";
import type { ListParams } from "../../infrastructure/database/listParams.js";
import * as repository from "./repository.js";

const TABLE_NAME = "orders";

export async function getOrder(id: number, includeDeleted = false) {
  const order = await repository.findById(id, includeDeleted);
  if (!order) throw new NotFoundAppError("Order");
  const lines = await repository.getLines(id);
  return { ...order, lines };
}

export async function listOrders(params: ListParams & { customerId?: number; adminReviewRequired?: boolean }) {
  return repository.list(params);
}

export async function getOrderHistory(id: number) {
  await getOrder(id, true);
  return auditHistory(TABLE_NAME, id);
}
