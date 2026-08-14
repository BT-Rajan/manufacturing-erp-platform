import { z } from "zod";

import type { FieldConfigDefaults } from "../../application/services/fieldConfigService.js";

export const productCreateSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(150),
  unit: z.string().min(1).max(20),
  product_type: z.enum(["finished_good", "sub_assembly"]).default("finished_good"),
  selling_price: z.number().min(0).default(0),
  machine_id: z.number().int().positive().nullish(),
  production_hours_per_unit: z.number().min(0).nullish(),
  workers_required: z.number().int().min(0).nullish(),
  status: z.enum(["active", "inactive"]).default("active"),
});

export const productUpdateSchema = productCreateSchema.omit({ code: true }).partial();

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export const productFieldDefaults: FieldConfigDefaults = {
  code: { required: true, searchable: true, filterable: false },
  name: { required: true, searchable: true, filterable: false },
  unit: { required: true, searchable: false, filterable: false },
  product_type: { required: false, searchable: false, filterable: true },
  status: { required: false, searchable: false, filterable: true },
};
