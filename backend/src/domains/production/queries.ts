import { history as auditHistory } from "../../application/services/auditService.js";
import { NotFoundAppError } from "../../core/errors/index.js";
import type { ListParams } from "../../infrastructure/database/listParams.js";
import * as repository from "./repository.js";

const TABLE_NAME = "production_schedules";

export async function getBatch(id: number, includeDeleted = false) {
  const batch = await repository.findById(id, includeDeleted);
  if (!batch) throw new NotFoundAppError("Production batch");
  return batch;
}

export async function listBatches(params: ListParams & { productId?: number; orderId?: number }) {
  return repository.list(params);
}

export async function getBatchHistory(id: number) {
  await getBatch(id, true);
  return auditHistory(TABLE_NAME, id);
}
