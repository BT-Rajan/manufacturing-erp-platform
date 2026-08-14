import { Router } from "express";

import { requireAuth } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { parseListParams } from "../../infrastructure/database/listParams.js";
import { createSupplier, deleteSupplier, restoreSupplier, updateSupplier } from "./commands.js";
import { getSupplier, getSupplierHistory, listSuppliers } from "./queries.js";
import { supplierCreateSchema, supplierUpdateSchema } from "./schema.js";

export const suppliersRouter = Router();

suppliersRouter.use("/api/suppliers", requireAuth);

suppliersRouter.get("/api/suppliers", requirePageAccess("suppliers", "read"), async (req, res, next) => {
  try {
    res.status(200).json(await listSuppliers(parseListParams(req.query as Record<string, unknown>)));
  } catch (err) {
    next(err);
  }
});

suppliersRouter.get("/api/suppliers/:id", requirePageAccess("suppliers", "read"), async (req, res, next) => {
  try {
    res.status(200).json(await getSupplier(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

suppliersRouter.get(
  "/api/suppliers/:id/history",
  requirePageAccess("suppliers", "read"),
  async (req, res, next) => {
    try {
      res.status(200).json(await getSupplierHistory(Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

suppliersRouter.post("/api/suppliers", requirePageAccess("suppliers", "write"), async (req, res, next) => {
  try {
    const input = supplierCreateSchema.parse(req.body);
    res.status(201).json(await createSupplier(input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

suppliersRouter.put("/api/suppliers/:id", requirePageAccess("suppliers", "write"), async (req, res, next) => {
  try {
    const input = supplierUpdateSchema.parse(req.body);
    res.status(200).json(await updateSupplier(Number(req.params.id), input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

suppliersRouter.delete(
  "/api/suppliers/:id",
  requirePageAccess("suppliers", "write"),
  async (req, res, next) => {
    try {
      await deleteSupplier(Number(req.params.id), req.user?.id ?? null);
      res.status(200).json({ status: "deleted" });
    } catch (err) {
      next(err);
    }
  },
);

suppliersRouter.post(
  "/api/suppliers/:id/restore",
  requirePageAccess("suppliers", "write"),
  async (req, res, next) => {
    try {
      res.status(200).json(await restoreSupplier(Number(req.params.id), req.user?.id ?? null));
    } catch (err) {
      next(err);
    }
  },
);
