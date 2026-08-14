import { Router } from "express";
import { z } from "zod";

import { requireAuth, requireRole } from "../../api/dependencies/auth.js";
import { addBomLine, deleteBomLine, replaceBom } from "./commands.js";
import { explodeBom, getBom, getBomHistory } from "./queries.js";
import { bomLineInputSchema, bomReplaceSchema } from "./schema.js";

export const bomRouter = Router();

const BASE = "/api/products/:productId/bom";

bomRouter.use(BASE, requireAuth);

// Read: any authenticated user, no page-matrix gating -- matches
// jdk_clean's api/bom.py, which only requires get_current_user for
// reads. Write: role-gated to admin/manager directly, not routed
// through the department permission matrix -- also matches jdk_clean.
const writeGuard = requireRole("admin", "manager");

bomRouter.get(BASE, async (req, res, next) => {
  try {
    res.status(200).json(await getBom(Number(req.params.productId)));
  } catch (err) {
    next(err);
  }
});

bomRouter.put(BASE, writeGuard, async (req, res, next) => {
  try {
    const input = bomReplaceSchema.parse(req.body);
    res.status(200).json(await replaceBom(Number(req.params.productId), input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

bomRouter.post(`${BASE}/lines`, writeGuard, async (req, res, next) => {
  try {
    const input = bomLineInputSchema.parse(req.body);
    res.status(201).json(await addBomLine(Number(req.params.productId), input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

bomRouter.delete(`${BASE}/lines/:lineId`, writeGuard, async (req, res, next) => {
  try {
    await deleteBomLine(Number(req.params.productId), Number(req.params.lineId), req.user?.id ?? null);
    res.status(200).json({ message: "Deleted." });
  } catch (err) {
    next(err);
  }
});

bomRouter.get(`${BASE}/history`, async (req, res, next) => {
  try {
    res.status(200).json(await getBomHistory(Number(req.params.productId)));
  } catch (err) {
    next(err);
  }
});

const explodeQuerySchema = z.object({
  quantity: z.coerce.number().positive(),
});

bomRouter.get(`${BASE}/explode`, async (req, res, next) => {
  try {
    const { quantity } = explodeQuerySchema.parse(req.query);
    res.status(200).json(await explodeBom(Number(req.params.productId), quantity));
  } catch (err) {
    next(err);
  }
});
