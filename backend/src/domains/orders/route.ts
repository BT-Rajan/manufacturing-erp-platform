import { Router } from "express";
import { z } from "zod";

import { requireAuth, requireRole } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { parseListParams } from "../../infrastructure/database/listParams.js";
import {
  adminReview,
  approveOrder,
  changeStatus,
  createOrder,
  createOrderFromQuotation,
  deleteOrder,
  escalateOverdueOrders,
  restoreOrder,
  updateOrder,
} from "./commands.js";
import { getOrder, getOrderHistory, listOrders } from "./queries.js";
import { orderCreateSchema, orderStatusUpdateSchema, orderUpdateSchema } from "./schema.js";

export const ordersRouter = Router();

ordersRouter.use("/api/orders", requireAuth);

const readGuard = requirePageAccess("orders", "read");
const writeGuard = requirePageAccess("orders", "write");
const adminGuard = requireRole("admin");

ordersRouter.get("/api/orders", readGuard, async (req, res, next) => {
  try {
    const params = parseListParams(req.query as Record<string, unknown>);
    const customerId = req.query.customer_id ? Number(req.query.customer_id) : undefined;
    const adminReviewRequired =
      req.query.admin_review_required !== undefined ? req.query.admin_review_required === "true" : undefined;
    res.status(200).json(await listOrders({ ...params, customerId, adminReviewRequired }));
  } catch (err) {
    next(err);
  }
});

ordersRouter.get("/api/orders/:id", readGuard, async (req, res, next) => {
  try {
    res.status(200).json(await getOrder(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

ordersRouter.get("/api/orders/:id/history", readGuard, async (req, res, next) => {
  try {
    res.status(200).json(await getOrderHistory(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

ordersRouter.post("/api/orders", writeGuard, async (req, res, next) => {
  try {
    const input = orderCreateSchema.parse(req.body);
    res.status(201).json(await createOrder(input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

ordersRouter.post("/api/orders/from-quotation/:quotationId", writeGuard, async (req, res, next) => {
  try {
    res.status(201).json(await createOrderFromQuotation(Number(req.params.quotationId), req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

ordersRouter.put("/api/orders/:id", writeGuard, async (req, res, next) => {
  try {
    const input = orderUpdateSchema.parse(req.body);
    res.status(200).json(await updateOrder(Number(req.params.id), input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

ordersRouter.post("/api/orders/:id/status", writeGuard, async (req, res, next) => {
  try {
    const input = orderStatusUpdateSchema.parse(req.body);
    res.status(200).json(await changeStatus(Number(req.params.id), input.status, input.reason, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

ordersRouter.post("/api/orders/:id/approve", adminGuard, async (req, res, next) => {
  try {
    res.status(200).json(await approveOrder(Number(req.params.id), req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

ordersRouter.delete("/api/orders/:id", writeGuard, async (req, res, next) => {
  try {
    await deleteOrder(Number(req.params.id), req.user?.id ?? null);
    res.status(200).json({ message: "Deleted." });
  } catch (err) {
    next(err);
  }
});

ordersRouter.post("/api/orders/:id/restore", writeGuard, async (req, res, next) => {
  try {
    res.status(200).json(await restoreOrder(Number(req.params.id), req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

ordersRouter.post("/api/orders/scan-overdue", adminGuard, async (_req, res, next) => {
  try {
    const ids = await escalateOverdueOrders();
    res.status(200).json({ flagged_count: ids.length, order_ids: ids });
  } catch (err) {
    next(err);
  }
});

const adminReviewSchema = z.object({ notes: z.string().min(1) });
ordersRouter.post("/api/orders/:id/admin-review", adminGuard, async (req, res, next) => {
  try {
    const input = adminReviewSchema.parse(req.body);
    res.status(200).json(await adminReview(Number(req.params.id), input.notes, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

// /journey (friendly status-history view), /pdf, and /email are
// deferred: /pdf and /email need Pass 3's document/adapter
// infrastructure; /journey is presentational sugar over the same
// audit history /history already exposes. See docs/PARITY_CHECKLIST.md.
