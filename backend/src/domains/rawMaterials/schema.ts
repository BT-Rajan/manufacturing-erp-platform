import { z } from "zod";

import type { FieldConfigDefaults } from "../../application/services/fieldConfigService.js";

export const rawMaterialCreateSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(150),
  unit: z.string().min(1).max(20),
  reorder_point: z.number().min(0).default(0),
  default_supplier_id: z.number().int().positive().nullish(),
  unit_cost: z.number().min(0).default(0),
  status: z.enum(["active", "inactive"]).default("active"),
});

export const rawMaterialUpdateSchema = rawMaterialCreateSchema.omit({ code: true }).partial();

export type RawMaterialCreateInput = z.infer<typeof rawMaterialCreateSchema>;
export type RawMaterialUpdateInput = z.infer<typeof rawMaterialUpdateSchema>;

export const rawMaterialFieldDefaults: FieldConfigDefaults = {
  code: { required: true, searchable: true, filterable: false },
  name: { required: true, searchable: true, filterable: false },
  unit: { required: true, searchable: false, filterable: false },
  default_supplier_id: { required: false, searchable: false, filterable: true },
  status: { required: false, searchable: false, filterable: true },
};
