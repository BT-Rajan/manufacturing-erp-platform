import { z } from "zod";

export const supplierMaterialLineSchema = z.object({
  raw_material_id: z.number().int().positive(),
  max_supply_quantity: z.number().positive(),
  lead_time_days: z.number().int().min(0).nullish(),
});

/** Full replace of a supplier's suppliable materials: send every line
 * that should exist -- mirrors jdk_clean's SupplierMaterialsReplace /
 * BOM's replace-lines pattern, rather than one-line-at-a-time CRUD. */
export const supplierMaterialsReplaceSchema = z.object({
  lines: z.array(supplierMaterialLineSchema).refine(
    (lines) => {
      const seen = new Set<number>();
      for (const line of lines) {
        if (seen.has(line.raw_material_id)) return false;
        seen.add(line.raw_material_id);
      }
      return true;
    },
    { message: "Duplicate raw material in supplier's material list. Combine into a single line instead." },
  ),
});

export type SupplierMaterialLineInput = z.infer<typeof supplierMaterialLineSchema>;
export type SupplierMaterialsReplaceInput = z.infer<typeof supplierMaterialsReplaceSchema>;
