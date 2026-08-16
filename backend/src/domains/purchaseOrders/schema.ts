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

export const purchaseOrderLineInputSchema = z.object({
  raw_material_id: z.number().int().positive(),
  quantity: z.number().positive(),
  unit_price: z.number().min(0),
  discount_percent: z.number().min(0).max(100).default(0),
});

export const purchaseOrderCreateSchema = z.object({
  supplier_id: z.number().int().positive(),
  order_date: notInPast,
  expected_delivery_date: z.union([notInPast, z.null()]).optional(),
  notes: z.string().nullish(),
  tax_rate: z.number().min(0).max(100).nullish(),
  discount_percent: z.number().min(0).max(100).nullish(),
  lines: z.array(purchaseOrderLineInputSchema).min(1, "At least one line item is required."),
});

export const purchaseOrderUpdateSchema = z.object({
  supplier_id: z.number().int().positive().optional(),
  order_date: notInPast.optional(),
  expected_delivery_date: z.union([notInPast, z.null()]).optional(),
  notes: z.string().nullish(),
  tax_rate: z.number().min(0).max(100).nullish(),
  discount_percent: z.number().min(0).max(100).nullish(),
  lines: z.array(purchaseOrderLineInputSchema).min(1).optional(),
});

export const purchaseOrderStatusUpdateSchema = z.object({
  status: z.enum(["sent", "confirmed", "cancelled"]),
  reason: z.string().nullish(),
});

export const receiveLineSchema = z.object({
  line_id: z.number().int().positive(),
  quantity: z.number().positive(),
});

export const receivePurchaseOrderSchema = z.object({
  lines: z.array(receiveLineSchema).min(1),
});

export type PurchaseOrderCreateInput = z.infer<typeof purchaseOrderCreateSchema>;
export type PurchaseOrderUpdateInput = z.infer<typeof purchaseOrderUpdateSchema>;
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInputSchema>;
