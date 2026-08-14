import { history as auditHistory } from "../../application/services/auditService.js";
import { NotFoundAppError } from "../../core/errors/index.js";
import type { ListParams } from "../../infrastructure/database/listParams.js";
import * as repository from "./repository.js";

const ENTITY_TYPE = "customer";

export async function getCustomer(id: number) {
  const customer = await repository.findById(id);
  if (!customer) throw new NotFoundAppError("Customer");
  return customer;
}

export async function listCustomers(params: ListParams) {
  return repository.list(params);
}

export async function getCustomerHistory(id: number) {
  await getCustomer(id); // 404s if the customer doesn't exist
  return auditHistory(ENTITY_TYPE, id);
}
