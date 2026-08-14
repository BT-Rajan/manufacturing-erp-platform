import { record } from "../../application/services/auditService.js";
import { getEffectiveFieldConfig } from "../../application/services/fieldConfigService.js";
import { ConflictError, NotFoundAppError, ValidationAppError } from "../../core/errors/index.js";
import * as repository from "./repository.js";
import { machineFieldDefaults, type MachineCreateInput, type MachineUpdateInput } from "./schema.js";

const ENTITY_TYPE = "machine";

async function assertRequiredFieldsPresent(input: Record<string, unknown>, isUpdate: boolean): Promise<void> {
  const config = await getEffectiveFieldConfig(ENTITY_TYPE, machineFieldDefaults);
  for (const [field, meta] of Object.entries(config)) {
    if (!meta.required) continue;
    if (isUpdate && !(field in input)) continue;
    const value = input[field];
    if (value === undefined || value === null || value === "") {
      throw new ValidationAppError(`Field "${field}" is required.`);
    }
  }
}

export async function createMachine(input: MachineCreateInput, performedBy: number | null) {
  await assertRequiredFieldsPresent(input, false);
  if (await repository.codeExists(input.code)) {
    throw new ConflictError(`Machine code "${input.code}" is already in use.`);
  }
  const created = await repository.create(input, performedBy);
  await record({ entityType: ENTITY_TYPE, entityId: created!.id, action: "create", performedBy });
  return created;
}

export async function updateMachine(id: number, input: MachineUpdateInput, performedBy: number | null) {
  const existing = await repository.findById(id);
  if (!existing) throw new NotFoundAppError("Machine");
  await assertRequiredFieldsPresent(input, true);
  const updated = await repository.update(id, input, performedBy);
  await record({
    entityType: ENTITY_TYPE,
    entityId: id,
    action: "update",
    performedBy,
    changes: input as Record<string, unknown>,
  });
  return updated;
}

export async function deleteMachine(id: number, performedBy: number | null): Promise<void> {
  const existing = await repository.findById(id);
  if (!existing) throw new NotFoundAppError("Machine");
  await repository.softDelete(id, performedBy);
  await record({ entityType: ENTITY_TYPE, entityId: id, action: "delete", performedBy });
}

export async function restoreMachine(id: number, performedBy: number | null) {
  const existing = await repository.findById(id, true);
  if (!existing) throw new NotFoundAppError("Machine");
  await repository.restore(id, performedBy);
  await record({ entityType: ENTITY_TYPE, entityId: id, action: "restore", performedBy });
  return repository.findById(id);
}
