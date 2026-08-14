import { z } from "zod";

export const itemTypeSchema = z.enum(["product", "raw_material"]);

export const stockAdjustRequestSchema = z.object({
  item_type: itemTypeSchema,
  item_id: z.number().int().positive(),
  quantity: z.number().refine((v) => v !== 0, "Quantity must not be zero."),
  movement_type: z.enum(["receipt", "issue", "adjustment", "return"]),
  notes: z.string().max(255).nullish(),
});

export type ItemType = z.infer<typeof itemTypeSchema>;
export type StockAdjustRequest = z.infer<typeof stockAdjustRequestSchema>;
