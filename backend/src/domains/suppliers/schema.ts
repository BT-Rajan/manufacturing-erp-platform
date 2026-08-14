import { z } from "zod";

import type { FieldConfigDefaults } from "../../application/services/fieldConfigService.js";

export const supplierCreateSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(150),
  contact_person: z.string().max(120).nullish(),
  email: z.string().email().max(120).nullish(),
  phone: z.string().max(30).nullish(),
  address: z.string().max(255).nullish(),
  city: z.string().max(80).nullish(),
  country: z.string().max(80).nullish(),
  tax_id: z.string().max(50).nullish(),
  payment_terms_days: z.number().int().min(0).default(30),
  mode_of_supply: z.enum(["direct", "distributor", "broker", "import"]).nullish(),
  rating: z.number().int().min(1).max(5).nullish(),
  status: z.enum(["active", "inactive", "suspended"]).default("active"),
});

export const supplierUpdateSchema = supplierCreateSchema.omit({ code: true }).partial();

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;

export const supplierFieldDefaults: FieldConfigDefaults = {
  code: { required: true, searchable: true, filterable: false },
  name: { required: true, searchable: true, filterable: false },
  contact_person: { required: false, searchable: true, filterable: false },
  email: { required: false, searchable: true, filterable: false },
  phone: { required: false, searchable: false, filterable: false },
  city: { required: false, searchable: false, filterable: true },
  country: { required: false, searchable: false, filterable: true },
  mode_of_supply: { required: false, searchable: false, filterable: true },
  status: { required: false, searchable: false, filterable: true },
};
