import { Router } from "express";
import { z } from "zod";

import { requireAuth, requireRole } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { parseListParams } from "../../infrastructure/database/listParams.js";
import {
  adminReview,
  approvePurchaseOrder,
  autoDraftFromMrpShortages,
  changeStatus,
  createPurchaseOrder,
  deletePurchaseOrder,
  escalateOverduePurchaseOrders,
  receiveLines,
  restorePurchaseOrder,
  updatePurchaseOrder,
} from "./commands.js";
import { getPurchaseOrder, getPurchaseOrderHistory, listPurchaseOrders } from "./queries.js";
import {
  purchaseOrderCreateSchema,
  purchaseOrderStatusUpdateSchema,
  purchaseOrderUpdateSchema,
  receivePurchaseOrderSchema,
} from "./schema.js";

export const purchaseOrdersRouter = Router();

purchaseOrdersRouter.use("/api/purchase-orders", requireAuth);

const readGuard = requirePageAccess("purchase_orders", "read");
const writeGuard = requirePageAccess("purchase_orders", "write");
const adminGuard = requireRole("admin");

purchaseOrdersRouter.get("/api/purchase-orders", readGuard, async (req, res, next) => {
  try {
    const params = parseListParams(req.query as Record<string, unknown>);
    const supplierId = req.query.supplier_id ? Number(req.query.supplier_id) : undefined;
    res.status(200).json(await listPurchaseOrders({ ...params, supplierId }));
  } catch (err) {
    next(err);
  }
});

purchaseOrdersRouter.get("/api/purchase-orders/:id", readGuard, async (req, res, next) => {
  try {
    res.status(200).json(await getPurchaseOrder(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

purchaseOrdersRouter.get("/api/purchase-orders/:id/history", readGuard, async (req, res, next) => {
  try {
    res.status(200).json(await getPurchaseOrderHistory(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

purchaseOrdersRouter.post("/api/purchase-orders", writeGuard, async (req, res, next) => {
  try {
    const input = purchaseOrderCreateSchema.parse(req.body);
    res.status(201).json(await createPurchaseOrder(input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

purchaseOrdersRouter.post("/api/purchase-orders/auto-draft-from-mrp", adminGuard, async (req, res, next) => {
  try {
    const created = await autoDraftFromMrpShortages(req.user?.id ?? null);
    res.status(201).json({ created_count: created.length, purchase_orders: created });
  } catch (err) {
    next(err);
  }
});

purchaseOrdersRouter.put("/api/purchase-orders/:id", writeGuard, async (req, res, next) => {
  try {
    const input = purchaseOrderUpdateSchema.parse(req.body);
    res.status(200).json(await updatePurchaseOrder(Number(req.params.id), input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

purchaseOrdersRouter.post("/api/purchase-orders/:id/status", writeGuard, async (req, res, next) => {
  try {
    const input = purchaseOrderStatusUpdateSchema.parse(req.body);
    res.status(200).json(await changeStatus(Number(req.params.id), input.status, input.reason, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

purchaseOrdersRouter.post("/api/purchase-orders/:id/approve", adminGuard, async (req, res, next) => {
  try {
    res.status(200).json(await approvePurchaseOrder(Number(req.params.id), req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

purchaseOrdersRouter.post("/api/purchase-orders/:id/receive", writeGuard, async (req, res, next) => {
  try {
    const input = receivePurchaseOrderSchema.parse(req.body);
    res.status(200).json(await receiveLines(Number(req.params.id), input.lines, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

purchaseOrdersRouter.delete("/api/purchase-orders/:id", writeGuard, async (req, res, next) => {
  try {
    await deletePurchaseOrder(Number(req.params.id), req.user?.id ?? null);
    res.status(200).json({ message: "Deleted." });
  } catch (err) {
    next(err);
  }
});

purchaseOrdersRouter.post("/api/purchase-orders/:id/restore", writeGuard, async (req, res, next) => {
  try {
    res.status(200).json(await restorePurchaseOrder(Number(req.params.id), req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

purchaseOrdersRouter.post("/api/purchase-orders/scan-overdue", adminGuard, async (_req, res, next) => {
  try {
    const ids = await escalateOverduePurchaseOrders();
    res.status(200).json({ flagged_count: ids.length, purchase_order_ids: ids });
  } catch (err) {
    next(err);
  }
});

const adminReviewSchema = z.object({ notes: z.string().min(1) });
purchaseOrdersRouter.post("/api/purchase-orders/:id/admin-review", adminGuard, async (req, res, next) => {
  try {
    const input = adminReviewSchema.parse(req.body);
    res.status(200).json(await adminReview(Number(req.params.id), input.notes, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

// /pdf and /email deferred to Pass 3 (document/adapter infrastructure).
