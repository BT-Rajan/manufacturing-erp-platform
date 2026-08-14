import { history as auditHistory } from "../../application/services/auditService.js";
import { NotFoundAppError } from "../../core/errors/index.js";
import type { ListParams } from "../../infrastructure/database/listParams.js";
import * as repository from "./repository.js";

const ENTITY_TYPE = "machine";

export async function getMachine(id: number) {
  const machine = await repository.findById(id);
  if (!machine) throw new NotFoundAppError("Machine");
  return machine;
}

export async function listMachines(params: ListParams) {
  return repository.list(params);
}

export async function getMachineHistory(id: number) {
  await getMachine(id);
  return auditHistory(ENTITY_TYPE, id);
}
