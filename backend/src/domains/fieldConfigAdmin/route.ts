import { Router } from "express";
import { z } from "zod";

import { requireAuth, requireRole } from "../../api/dependencies/auth.js";
import { customerFieldDefaults } from "../customers/schema.js";
import { machineFieldDefaults } from "../machines/schema.js";
import { productFieldDefaults } from "../products/schema.js";
import { rawMaterialFieldDefaults } from "../rawMaterials/schema.js";
import { supplierFieldDefaults } from "../suppliers/schema.js";
import {
  getEffectiveFieldConfig,
  setFieldConfig,
  type FieldConfigDefaults,
} from "../../application/services/fieldConfigService.js";

export const fieldConfigRouter = Router();

const ENTITY_DEFAULTS: Record<string, FieldConfigDefaults> = {
  customer: customerFieldDefaults,
  supplier: supplierFieldDefaults,
  raw_material: rawMaterialFieldDefaults,
  machine: machineFieldDefaults,
  product: productFieldDefaults,
};

fieldConfigRouter.use("/api/admin/field-config", requireAuth, requireRole("admin"));

fieldConfigRouter.get("/api/admin/field-config/:entityType", async (req, res, next) => {
  try {
    const entityType = req.params.entityType!;
    const defaults = ENTITY_DEFAULTS[entityType];
    if (!defaults) {
      res.status(404).json({ error: { code: "not_found", message: `Unknown entity type "${entityType}".` } });
      return;
    }
    res.status(200).json(await getEffectiveFieldConfig(entityType, defaults));
  } catch (err) {
    next(err);
  }
});

const fieldConfigUpdateSchema = z.object({
  updates: z.array(
    z.object({
      fieldName: z.string().min(1),
      isRequired: z.boolean().optional(),
      isSearchable: z.boolean().optional(),
      isFilterable: z.boolean().optional(),
    }),
  ),
});

fieldConfigRouter.put("/api/admin/field-config/:entityType", async (req, res, next) => {
  try {
    const entityType = req.params.entityType!;
    const defaults = ENTITY_DEFAULTS[entityType];
    if (!defaults) {
      res.status(404).json({ error: { code: "not_found", message: `Unknown entity type "${entityType}".` } });
      return;
    }
    const input = fieldConfigUpdateSchema.parse(req.body);
    await setFieldConfig(entityType, input.updates, req.user?.id ?? null);
    res.status(200).json(await getEffectiveFieldConfig(entityType, defaults));
  } catch (err) {
    next(err);
  }
});
