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

export const deliveryNoteLineInputSchema = z.object({
  product_id: z.number().int().positive(),
  quantity_delivered: z.number().positive(),
});

export const deliveryNoteCreateSchema = z.object({
  order_id: z.number().int().positive(),
  delivery_date: notInPast,
  notes: z.string().nullish(),
  /** If omitted, lines are auto-populated from the order's own lines. */
  lines: z.array(deliveryNoteLineInputSchema).nullish(),
});

export const deliveryNoteUpdateSchema = z.object({
  delivery_date: notInPast.optional(),
  notes: z.string().nullish(),
  lines: z.array(deliveryNoteLineInputSchema).optional(),
});

export const deliveryNoteStatusUpdateSchema = z.object({
  status: z.enum(["issued", "cancelled"]),
  reason: z.string().nullish(),
});

export type DeliveryNoteCreateInput = z.infer<typeof deliveryNoteCreateSchema>;
export type DeliveryNoteUpdateInput = z.infer<typeof deliveryNoteUpdateSchema>;
