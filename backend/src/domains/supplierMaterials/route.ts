import { Router } from "express";

import { requireAuth } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { replaceSupplierMaterials } from "./commands.js";
import { listSupplierMaterials } from "./queries.js";
import { supplierMaterialsReplaceSchema } from "./schema.js";

export const supplierMaterialsRouter = Router();

supplierMaterialsRouter.use("/api/suppliers/:supplierId/materials", requireAuth);

supplierMaterialsRouter.get(
  "/api/suppliers/:supplierId/materials",
  requirePageAccess("suppliers", "read"),
  async (req, res, next) => {
    try {
      res.status(200).json(await listSupplierMaterials(Number(req.params.supplierId)));
    } catch (err) {
      next(err);
    }
  },
);

supplierMaterialsRouter.put(
  "/api/suppliers/:supplierId/materials",
  requirePageAccess("suppliers", "write"),
  async (req, res, next) => {
    try {
      const input = supplierMaterialsReplaceSchema.parse(req.body);
      res
        .status(200)
        .json(await replaceSupplierMaterials(Number(req.params.supplierId), input, req.user?.id ?? null));
    } catch (err) {
      next(err);
    }
  },
);
