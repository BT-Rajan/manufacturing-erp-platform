import { Router } from "express";

import { requireAuth } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { parseListParams } from "../../infrastructure/database/listParams.js";
import { changeStatus, createBatch, deleteBatch, restoreBatch, updateBatch } from "./commands.js";
import { getBatch, getBatchHistory, listBatches } from "./queries.js";
import { productionBatchCreateSchema, productionBatchStatusUpdateSchema, productionBatchUpdateSchema } from "./schema.js";

export const productionRouter = Router();

productionRouter.use("/api/production-schedules", requireAuth);

const readGuard = requirePageAccess("production", "read");
const writeGuard = requirePageAccess("production", "write");

productionRouter.get("/api/production-schedules", readGuard, async (req, res, next) => {
  try {
    const params = parseListParams(req.query as Record<string, unknown>);
    const productId = req.query.product_id ? Number(req.query.product_id) : undefined;
    const orderId = req.query.order_id ? Number(req.query.order_id) : undefined;
    res.status(200).json(await listBatches({ ...params, productId, orderId }));
  } catch (err) {
    next(err);
  }
});

productionRouter.get("/api/production-schedules/:id", readGuard, async (req, res, next) => {
  try {
    res.status(200).json(await getBatch(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

productionRouter.get("/api/production-schedules/:id/history", readGuard, async (req, res, next) => {
  try {
    res.status(200).json(await getBatchHistory(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

productionRouter.post("/api/production-schedules", writeGuard, async (req, res, next) => {
  try {
    const input = productionBatchCreateSchema.parse(req.body);
    res.status(201).json(await createBatch(input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

productionRouter.put("/api/production-schedules/:id", writeGuard, async (req, res, next) => {
  try {
    const input = productionBatchUpdateSchema.parse(req.body);
    res.status(200).json(await updateBatch(Number(req.params.id), input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

productionRouter.post("/api/production-schedules/:id/status", writeGuard, async (req, res, next) => {
  try {
    const input = productionBatchStatusUpdateSchema.parse(req.body);
    res
      .status(200)
      .json(
        await changeStatus(Number(req.params.id), input.status, input.produced_quantity, input.reason, req.user?.id ?? null),
      );
  } catch (err) {
    next(err);
  }
});

productionRouter.delete("/api/production-schedules/:id", writeGuard, async (req, res, next) => {
  try {
    await deleteBatch(Number(req.params.id), req.user?.id ?? null);
    res.status(200).json({ message: "Deleted." });
  } catch (err) {
    next(err);
  }
});

productionRouter.post("/api/production-schedules/:id/restore", writeGuard, async (req, res, next) => {
  try {
    res.status(200).json(await restoreBatch(Number(req.params.id), req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});
