import { Router } from "express";

import { requireAuth } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { parseListParams } from "../../infrastructure/database/listParams.js";
import { createRawMaterial, deleteRawMaterial, restoreRawMaterial, updateRawMaterial } from "./commands.js";
import { getRawMaterial, getRawMaterialHistory, listRawMaterials } from "./queries.js";
import { rawMaterialCreateSchema, rawMaterialUpdateSchema } from "./schema.js";

export const rawMaterialsRouter = Router();

rawMaterialsRouter.use("/api/raw-materials", requireAuth);

rawMaterialsRouter.get(
  "/api/raw-materials",
  requirePageAccess("raw_materials", "read"),
  async (req, res, next) => {
    try {
      res.status(200).json(await listRawMaterials(parseListParams(req.query as Record<string, unknown>)));
    } catch (err) {
      next(err);
    }
  },
);

rawMaterialsRouter.get(
  "/api/raw-materials/:id",
  requirePageAccess("raw_materials", "read"),
  async (req, res, next) => {
    try {
      res.status(200).json(await getRawMaterial(Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

rawMaterialsRouter.get(
  "/api/raw-materials/:id/history",
  requirePageAccess("raw_materials", "read"),
  async (req, res, next) => {
    try {
      res.status(200).json(await getRawMaterialHistory(Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

rawMaterialsRouter.post(
  "/api/raw-materials",
  requirePageAccess("raw_materials", "write"),
  async (req, res, next) => {
    try {
      const input = rawMaterialCreateSchema.parse(req.body);
      res.status(201).json(await createRawMaterial(input, req.user?.id ?? null));
    } catch (err) {
      next(err);
    }
  },
);

rawMaterialsRouter.put(
  "/api/raw-materials/:id",
  requirePageAccess("raw_materials", "write"),
  async (req, res, next) => {
    try {
      const input = rawMaterialUpdateSchema.parse(req.body);
      res.status(200).json(await updateRawMaterial(Number(req.params.id), input, req.user?.id ?? null));
    } catch (err) {
      next(err);
    }
  },
);

rawMaterialsRouter.delete(
  "/api/raw-materials/:id",
  requirePageAccess("raw_materials", "write"),
  async (req, res, next) => {
    try {
      await deleteRawMaterial(Number(req.params.id), req.user?.id ?? null);
      res.status(200).json({ status: "deleted" });
    } catch (err) {
      next(err);
    }
  },
);

rawMaterialsRouter.post(
  "/api/raw-materials/:id/restore",
  requirePageAccess("raw_materials", "write"),
  async (req, res, next) => {
    try {
      res.status(200).json(await restoreRawMaterial(Number(req.params.id), req.user?.id ?? null));
    } catch (err) {
      next(err);
    }
  },
);
