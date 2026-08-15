import { Router } from "express";

import { requireAuth, requireRole } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { parseListParams } from "../../infrastructure/database/listParams.js";
import {
  approveQuotation,
  changeStatus,
  createQuotation,
  deleteQuotation,
  escalateExpiredQuotations,
  restoreQuotation,
  updateQuotation,
} from "./commands.js";
import { getQuotation, getQuotationHistory, listQuotations } from "./queries.js";
import { quotationCreateSchema, quotationStatusUpdateSchema, quotationUpdateSchema } from "./schema.js";

export const quotationsRouter = Router();

quotationsRouter.use("/api/quotations", requireAuth);

const readGuard = requirePageAccess("quotations", "read");
const writeGuard = requirePageAccess("quotations", "write");
const adminGuard = requireRole("admin");

quotationsRouter.get("/api/quotations", readGuard, async (req, res, next) => {
  try {
    const params = parseListParams(req.query as Record<string, unknown>);
    const customerId = req.query.customer_id ? Number(req.query.customer_id) : undefined;
    res.status(200).json(await listQuotations({ ...params, customerId }));
  } catch (err) {
    next(err);
  }
});

quotationsRouter.get("/api/quotations/:id", readGuard, async (req, res, next) => {
  try {
    res.status(200).json(await getQuotation(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

quotationsRouter.get("/api/quotations/:id/history", readGuard, async (req, res, next) => {
  try {
    res.status(200).json(await getQuotationHistory(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

quotationsRouter.post("/api/quotations", writeGuard, async (req, res, next) => {
  try {
    const input = quotationCreateSchema.parse(req.body);
    res.status(201).json(await createQuotation(input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

quotationsRouter.put("/api/quotations/:id", writeGuard, async (req, res, next) => {
  try {
    const input = quotationUpdateSchema.parse(req.body);
    res.status(200).json(await updateQuotation(Number(req.params.id), input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

quotationsRouter.post("/api/quotations/:id/status", writeGuard, async (req, res, next) => {
  try {
    const input = quotationStatusUpdateSchema.parse(req.body);
    res
      .status(200)
      .json(await changeStatus(Number(req.params.id), input.status, input.reason, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

// Admin sign-off clearing the large-discount approval gate -- a
// genuinely separate authority from ordinary write access to the
// page, matches jdk_clean's admin_guard on this one route.
quotationsRouter.post("/api/quotations/:id/approve", adminGuard, async (req, res, next) => {
  try {
    res.status(200).json(await approveQuotation(Number(req.params.id), req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

quotationsRouter.post("/api/quotations/scan-expired", adminGuard, async (_req, res, next) => {
  try {
    const ids = await escalateExpiredQuotations();
    res.status(200).json({ expired_count: ids.length, quotation_ids: ids });
  } catch (err) {
    next(err);
  }
});

quotationsRouter.delete("/api/quotations/:id", writeGuard, async (req, res, next) => {
  try {
    await deleteQuotation(Number(req.params.id), req.user?.id ?? null);
    res.status(200).json({ message: "Deleted." });
  } catch (err) {
    next(err);
  }
});

quotationsRouter.post("/api/quotations/:id/restore", writeGuard, async (req, res, next) => {
  try {
    res.status(200).json(await restoreQuotation(Number(req.params.id), req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});
