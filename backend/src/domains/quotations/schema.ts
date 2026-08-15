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

export const quotationLineInputSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: z.number().positive(),
  unit_price: z.number().min(0),
  discount_percent: z.number().min(0).max(100).default(0),
});

export const quotationCreateSchema = z.object({
  customer_id: z.number().int().positive(),
  feasibility_id: z.number().int().positive().nullish(),
  deal_id: z.number().int().positive().nullish(),
  quotation_date: notInPast,
  valid_until: z.union([notInPast, z.null()]).optional(),
  notes: z.string().nullish(),
  tax_rate: z.number().min(0).max(100).nullish(),
  discount_percent: z.number().min(0).max(100).nullish(),
  lines: z.array(quotationLineInputSchema).min(1, "At least one line item is required."),
});

export const quotationUpdateSchema = z.object({
  customer_id: z.number().int().positive().optional(),
  quotation_date: notInPast.optional(),
  valid_until: z.union([notInPast, z.null()]).optional(),
  notes: z.string().nullish(),
  tax_rate: z.number().min(0).max(100).nullish(),
  discount_percent: z.number().min(0).max(100).nullish(),
  lines: z.array(quotationLineInputSchema).min(1).optional(),
});

export const quotationStatusUpdateSchema = z.object({
  status: z.enum(["sent", "accepted", "rejected", "expired"]),
  reason: z.string().nullish(),
});

export type QuotationCreateInput = z.infer<typeof quotationCreateSchema>;
export type QuotationUpdateInput = z.infer<typeof quotationUpdateSchema>;
export type QuotationLineInput = z.infer<typeof quotationLineInputSchema>;
