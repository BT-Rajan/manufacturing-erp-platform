import { z } from "zod";

export const bomLineInputSchema = z.object({
  component_type: z.enum(["raw_material", "product"]),
  component_id: z.number().int().positive(),
  quantity: z.number().positive(),
  unit: z.string().min(1).max(20),
  scrap_percent: z.number().min(0).max(100).default(0),
});

/** Full replace of a product's BOM: send every line that should exist. */
export const bomReplaceSchema = z.object({
  lines: z.array(bomLineInputSchema).refine(
    (lines) => {
      const seen = new Set<string>();
      for (const line of lines) {
        const key = `${line.component_type}:${line.component_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    { message: "Duplicate component in BOM. Combine into a single line instead." },
  ),
});

export type BomLineInput = z.infer<typeof bomLineInputSchema>;
export type BomReplaceInput = z.infer<typeof bomReplaceSchema>;
