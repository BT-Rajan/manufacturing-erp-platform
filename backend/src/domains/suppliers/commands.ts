import { record } from "../../application/services/auditService.js";
import { getEffectiveFieldConfig } from "../../application/services/fieldConfigService.js";
import { ConflictError, NotFoundAppError, ValidationAppError } from "../../core/errors/index.js";
import * as repository from "./repository.js";
import { supplierFieldDefaults, type SupplierCreateInput, type SupplierUpdateInput } from "./schema.js";

const ENTITY_TYPE = "supplier";

async function assertRequiredFieldsPresent(input: Record<string, unknown>, isUpdate: boolean): Promise<void> {
  const config = await getEffectiveFieldConfig(ENTITY_TYPE, supplierFieldDefaults);
  for (const [field, meta] of Object.entries(config)) {
    if (!meta.required) continue;
    if (isUpdate && !(field in input)) continue;
    const value = input[field];
    if (value === undefined || value === null || value === "") {
      throw new ValidationAppError(`Field "${field}" is required.`);
    }
  }
}

export async function createSupplier(input: SupplierCreateInput, performedBy: number | null) {
  await assertRequiredFieldsPresent(input, false);
  if (await repository.codeExists(input.code)) {
    throw new ConflictError(`Supplier code "${input.code}" is already in use.`);
  }
  const created = await repository.create(input, performedBy);
  await record({ entityType: ENTITY_TYPE, entityId: created!.id, action: "create", performedBy });
  return created;
}

export async function updateSupplier(id: number, input: SupplierUpdateInput, performedBy: number | null) {
  const existing = await repository.findById(id);
  if (!existing) throw new NotFoundAppError("Supplier");
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

export async function deleteSupplier(id: number, performedBy: number | null): Promise<void> {
  const existing = await repository.findById(id);
  if (!existing) throw new NotFoundAppError("Supplier");
  await repository.softDelete(id, performedBy);
  await record({ entityType: ENTITY_TYPE, entityId: id, action: "delete", performedBy });
}

export async function restoreSupplier(id: number, performedBy: number | null) {
  const existing = await repository.findById(id, true);
  if (!existing) throw new NotFoundAppError("Supplier");
  await repository.restore(id, performedBy);
  await record({ entityType: ENTITY_TYPE, entityId: id, action: "restore", performedBy });
  return repository.findById(id);
}
