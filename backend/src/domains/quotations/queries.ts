import { history as auditHistory } from "../../application/services/auditService.js";
import { NotFoundAppError } from "../../core/errors/index.js";
import type { ListParams } from "../../infrastructure/database/listParams.js";
import * as repository from "./repository.js";

const TABLE_NAME = "quotations";

export async function getQuotation(id: number, includeDeleted = false) {
  const quotation = await repository.findById(id, includeDeleted);
  if (!quotation) throw new NotFoundAppError("Quotation");
  const lines = await repository.getLines(id);
  return { ...quotation, lines };
}

export async function listQuotations(params: ListParams & { customerId?: number }) {
  return repository.list(params);
}

export async function getQuotationHistory(id: number) {
  await getQuotation(id, true);
  return auditHistory(TABLE_NAME, id);
}
