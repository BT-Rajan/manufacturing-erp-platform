import { z } from "zod";

const notInPast = z.string().refine(
  (v) => {
    const date = new Date(`${v}T00:00:00.000Z`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return date >= today;
  },
  { message: "Date cannot be in the past." },
);

export const productionBatchCreateSchema = z
  .object({
    product_id: z.number().int().positive(),
    machine_id: z.number().int().positive().nullish(),
    order_id: z.number().int().positive().nullish(),
    planned_quantity: z.number().positive(),
    scheduled_start: notInPast,
    scheduled_end: z.string(),
    notes: z.string().nullish(),
  })
  .refine((data) => data.scheduled_end >= data.scheduled_start, {
    message: "scheduled_end cannot be before scheduled_start.",
    path: ["scheduled_end"],
  });

export const productionBatchUpdateSchema = z.object({
  order_id: z.number().int().positive().nullish(),
  machine_id: z.number().int().positive().nullish(),
  planned_quantity: z.number().positive().optional(),
  scheduled_start: notInPast.optional(),
  scheduled_end: z.string().optional(),
  notes: z.string().nullish(),
});

export const productionBatchStatusUpdateSchema = z.object({
  status: z.enum(["in_progress", "completed", "cancelled"]),
  produced_quantity: z.number().positive().nullish(),
  reason: z.string().nullish(),
});

export type ProductionBatchCreateInput = z.infer<typeof productionBatchCreateSchema>;
export type ProductionBatchUpdateInput = z.infer<typeof productionBatchUpdateSchema>;
