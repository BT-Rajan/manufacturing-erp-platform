import { z } from "zod";

import type { FieldConfigDefaults } from "../../application/services/fieldConfigService.js";

export const machineCreateSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(150),
  capacity_hours_per_day: z.number().positive().default(8),
  status: z.enum(["active", "inactive"]).default("active"),
});

export const machineUpdateSchema = machineCreateSchema.omit({ code: true }).partial();

export type MachineCreateInput = z.infer<typeof machineCreateSchema>;
export type MachineUpdateInput = z.infer<typeof machineUpdateSchema>;

export const machineFieldDefaults: FieldConfigDefaults = {
  code: { required: true, searchable: true, filterable: false },
  name: { required: true, searchable: true, filterable: false },
  status: { required: false, searchable: false, filterable: true },
};
