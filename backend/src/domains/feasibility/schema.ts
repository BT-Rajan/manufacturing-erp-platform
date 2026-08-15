import { z } from "zod";

const notInPast = (message: string) =>
  z
    .string()
    .refine(
      (v) => {
        const date = new Date(`${v}T00:00:00.000Z`);
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        return date >= today;
      },
      { message },
    );

export const feasibilityLineInputSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: z.number().positive(),
});

export const feasibilityCreateSchema = z.object({
  customer_id: z.number().int().positive(),
  deal_id: z.number().int().positive().nullish(),
  required_by_date: z
    .union([notInPast("required_by_date cannot be in the past."), z.null()])
    .optional(),
  notes: z.string().nullish(),
  lines: z.array(feasibilityLineInputSchema).min(1, "At least one product line is required."),
});

export const feasibilityExceptionDecisionSchema = z.object({
  approve: z.boolean(),
  reason: z.string().min(1),
});

export const feasibilityCloseSchema = z.object({
  reason: z.string().min(1),
});

export const feasibilityAdminReviewSchema = z.object({
  notes: z.string().min(1),
});

export type FeasibilityCreateInput = z.infer<typeof feasibilityCreateSchema>;
export type FeasibilityExceptionDecisionInput = z.infer<typeof feasibilityExceptionDecisionSchema>;
