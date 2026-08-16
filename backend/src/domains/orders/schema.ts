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

export const orderLineInputSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: z.number().positive(),
  unit_price: z.number().min(0),
  discount_percent: z.number().min(0).max(100).default(0),
});

export const orderCreateSchema = z.object({
  customer_id: z.number().int().positive(),
  deal_id: z.number().int().positive().nullish(),
  order_date: notInPast,
  requested_delivery_date: z.union([notInPast, z.null()]).optional(),
  notes: z.string().nullish(),
  tax_rate: z.number().min(0).max(100).nullish(),
  discount_percent: z.number().min(0).max(100).nullish(),
  lines: z.array(orderLineInputSchema).min(1, "At least one line item is required."),
});

export const orderUpdateSchema = z.object({
  customer_id: z.number().int().positive().optional(),
  order_date: notInPast.optional(),
  requested_delivery_date: z.union([notInPast, z.null()]).optional(),
  confirmed_delivery_date: z.union([notInPast, z.null()]).optional(),
  notes: z.string().nullish(),
  tax_rate: z.number().min(0).max(100).nullish(),
  discount_percent: z.number().min(0).max(100).nullish(),
  lines: z.array(orderLineInputSchema).min(1).optional(),
});

export const orderStatusUpdateSchema = z.object({
  status: z.enum(["confirmed", "in_production", "ready_to_ship", "shipped", "delivered", "cancelled"]),
  reason: z.string().nullish(),
});

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;
export type OrderLineInput = z.infer<typeof orderLineInputSchema>;
