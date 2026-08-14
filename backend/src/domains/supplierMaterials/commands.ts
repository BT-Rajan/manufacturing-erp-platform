import { record } from "../../application/services/auditService.js";
import { BusinessRuleError, NotFoundAppError } from "../../core/errors/index.js";
import * as rawMaterialsRepository from "../rawMaterials/repository.js";
import * as suppliersRepository from "../suppliers/repository.js";
import * as repository from "./repository.js";
import type { SupplierMaterialsReplaceInput } from "./schema.js";

const ENTITY_TYPE = "supplier_materials";

export async function replaceSupplierMaterials(
  supplierId: number,
  input: SupplierMaterialsReplaceInput,
  performedBy: number | null,
) {
  const supplier = await suppliersRepository.findById(supplierId);
  if (!supplier) throw new NotFoundAppError("Supplier");

  for (const line of input.lines) {
    const material = await rawMaterialsRepository.findById(line.raw_material_id);
    if (!material) {
      throw new BusinessRuleError(`Raw material #${line.raw_material_id} does not exist or has been deleted.`);
    }
  }

  await repository.replaceLines(supplierId, input.lines, performedBy);
  await record({
    entityType: ENTITY_TYPE,
    entityId: supplierId,
    action: "replace",
    performedBy,
    changes: { lines: input.lines },
  });

  return repository.listBySupplier(supplierId);
}
