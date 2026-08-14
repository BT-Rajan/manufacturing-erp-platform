import { z } from "zod";

import type { FieldConfigDefaults } from "../../application/services/fieldConfigService.js";

export const customerCreateSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(150),
  contact_person: z.string().max(120).nullish(),
  email: z.string().email().max(120).nullish(),
  phone: z.string().max(30).nullish(),
  billing_address: z.string().max(255).nullish(),
  shipping_address: z.string().max(255).nullish(),
  city: z.string().max(80).nullish(),
  country: z.string().max(80).nullish(),
  tax_id: z.string().max(50).nullish(),
  credit_limit: z.number().min(0).default(0),
  payment_terms_days: z.number().int().min(0).default(30),
  status: z.enum(["active", "inactive"]).default("active"),
  notes: z.string().nullish(),
});

export const customerUpdateSchema = customerCreateSchema.omit({ code: true }).partial();

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

/** Code default field config -- mirrors what jdk_clean always required
 * (code/name always required, everything else optional), overridable
 * per-tenant by an admin via /api/admin/field-config/customers. */
export const customerFieldDefaults: FieldConfigDefaults = {
  code: { required: true, searchable: true, filterable: false },
  name: { required: true, searchable: true, filterable: false },
  contact_person: { required: false, searchable: true, filterable: false },
  email: { required: false, searchable: true, filterable: false },
  phone: { required: false, searchable: false, filterable: false },
  city: { required: false, searchable: false, filterable: true },
  country: { required: false, searchable: false, filterable: true },
  status: { required: false, searchable: false, filterable: true },
};
