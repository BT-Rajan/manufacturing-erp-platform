import { NotFoundAppError } from "../../core/errors/index.js";
import * as suppliersRepository from "../suppliers/repository.js";
import * as repository from "./repository.js";

export async function listSupplierMaterials(supplierId: number) {
  const supplier = await suppliersRepository.findById(supplierId);
  if (!supplier) throw new NotFoundAppError("Supplier");
  return repository.listBySupplier(supplierId);
}
