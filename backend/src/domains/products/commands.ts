import { record } from "../../application/services/auditService.js";
import { getEffectiveFieldConfig } from "../../application/services/fieldConfigService.js";
import { BusinessRuleError, ConflictError, NotFoundAppError, ValidationAppError } from "../../core/errors/index.js";
import * as machinesRepository from "../machines/repository.js";
import * as repository from "./repository.js";
import { productFieldDefaults, type ProductCreateInput, type ProductUpdateInput } from "./schema.js";

const ENTITY_TYPE = "product";

async function assertRequiredFieldsPresent(input: Record<string, unknown>, isUpdate: boolean): Promise<void> {
  const config = await getEffectiveFieldConfig(ENTITY_TYPE, productFieldDefaults);
  for (const [field, meta] of Object.entries(config)) {
    if (!meta.required) continue;
    if (isUpdate && !(field in input)) continue;
    const value = input[field];
    if (value === undefined || value === null || value === "") {
      throw new ValidationAppError(`Field "${field}" is required.`);
    }
  }
}

/** A product can't be assigned to a machine that doesn't exist (or has
 * been soft-deleted) -- this is a genuine business rule, not field
 * validation, so it lives here rather than in the zod schema. */
async function assertMachineExists(machineId: number | null | undefined): Promise<void> {
  if (machineId === null || machineId === undefined) return;
  const machine = await machinesRepository.findById(machineId);
  if (!machine) {
    throw new BusinessRuleError(`Machine #${machineId} does not exist or has been deleted.`);
  }
}

export async function createProduct(input: ProductCreateInput, performedBy: number | null) {
  await assertRequiredFieldsPresent(input, false);
  await assertMachineExists(input.machine_id);
  if (await repository.codeExists(input.code)) {
    throw new ConflictError(`Product code "${input.code}" is already in use.`);
  }
  const created = await repository.create(input, performedBy);
  await record({ entityType: ENTITY_TYPE, entityId: created!.id, action: "create", performedBy });
  return created;
}

export async function updateProduct(id: number, input: ProductUpdateInput, performedBy: number | null) {
  const existing = await repository.findById(id);
  if (!existing) throw new NotFoundAppError("Product");
  await assertRequiredFieldsPresent(input, true);
  await assertMachineExists(input.machine_id);
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

export async function deleteProduct(id: number, performedBy: number | null): Promise<void> {
  const existing = await repository.findById(id);
  if (!existing) throw new NotFoundAppError("Product");
  await repository.softDelete(id, performedBy);
  await record({ entityType: ENTITY_TYPE, entityId: id, action: "delete", performedBy });
}

export async function restoreProduct(id: number, performedBy: number | null) {
  const existing = await repository.findById(id, true);
  if (!existing) throw new NotFoundAppError("Product");
  await repository.restore(id, performedBy);
  await record({ entityType: ENTITY_TYPE, entityId: id, action: "restore", performedBy });
  return repository.findById(id);
}
