import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { adjustStock } from "./commands.js";
import { getLowStock, getMovementHistory, getStock } from "./queries.js";
import { itemTypeSchema, stockAdjustRequestSchema } from "./schema.js";

export const inventoryRouter = Router();

inventoryRouter.use("/api/inventory", requireAuth);

const readGuard = requirePageAccess("inventory", "read");
const writeGuard = requirePageAccess("inventory", "write");

inventoryRouter.get("/api/inventory/stock/:itemType/:itemId", readGuard, async (req, res, next) => {
  try {
    const itemType = itemTypeSchema.parse(req.params.itemType);
    res.status(200).json(await getStock(itemType, Number(req.params.itemId)));
  } catch (err) {
    next(err);
  }
});

inventoryRouter.post("/api/inventory/adjust", writeGuard, async (req, res, next) => {
  try {
    const input = stockAdjustRequestSchema.parse(req.body);
    res.status(200).json(await adjustStock(input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get("/api/inventory/low-stock", readGuard, async (_req, res, next) => {
  try {
    res.status(200).json(await getLowStock());
  } catch (err) {
    next(err);
  }
});

const movementQuerySchema = z.object({
  item_type: itemTypeSchema.optional(),
  item_id: z.coerce.number().int().positive().optional(),
  reference_type: z.string().optional(),
  reference_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(10),
  sort: z.string().optional(),
});

inventoryRouter.get("/api/inventory/movements", readGuard, async (req, res, next) => {
  try {
    const q = movementQuerySchema.parse(req.query);
    const result = await getMovementHistory({
      itemType: q.item_type,
      itemId: q.item_id,
      referenceType: q.reference_type,
      referenceId: q.reference_id,
      page: q.page,
      pageSize: q.page_size,
      sort: q.sort,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
