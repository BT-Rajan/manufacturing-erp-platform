import { history as auditHistory } from "../../application/services/auditService.js";
import { NotFoundAppError } from "../../core/errors/index.js";
import type { ListParams } from "../../infrastructure/database/listParams.js";
import * as repository from "./repository.js";

const TABLE_NAME = "feasibility_checks";

export async function getFeasibility(id: number, includeDeleted = false) {
  const check = await repository.findById(id, includeDeleted);
  if (!check) throw new NotFoundAppError("Feasibility check");
  const lines = await repository.getLines(id);
  return { ...check, lines };
}

export async function listFeasibilities(params: ListParams & { customerId?: number }) {
  return repository.list(params);
}

export async function listAvailableForQuotation(customerId?: number) {
  return repository.listAvailableForQuotation(customerId);
}

export async function getFeasibilityHistory(id: number) {
  await getFeasibility(id, true);
  return auditHistory(TABLE_NAME, id);
}
