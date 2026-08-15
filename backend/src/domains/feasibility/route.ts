import { Router } from "express";
import { z } from "zod";

import { requireAuth, requireRole } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { parseListParams } from "../../infrastructure/database/listParams.js";
import {
  adminReview,
  closeFeasibility,
  createFeasibility,
  decideException,
  deleteFeasibility,
  escalateStaleFeasibilityChecks,
  restoreFeasibility,
  reviveFeasibility,
  runCheck,
} from "./commands.js";
import { getFeasibility, getFeasibilityHistory, listAvailableForQuotation, listFeasibilities } from "./queries.js";
import {
  feasibilityAdminReviewSchema,
  feasibilityCloseSchema,
  feasibilityCreateSchema,
  feasibilityExceptionDecisionSchema,
} from "./schema.js";

export const feasibilityRouter = Router();

feasibilityRouter.use("/api/feasibilities", requireAuth);

const readGuard = requirePageAccess("feasibilities", "read");
const writeGuard = requirePageAccess("feasibilities", "write");

feasibilityRouter.get("/api/feasibilities", readGuard, async (req, res, next) => {
  try {
    const params = parseListParams(req.query as Record<string, unknown>);
    const customerId = req.query.customer_id ? Number(req.query.customer_id) : undefined;
    res.status(200).json(await listFeasibilities({ ...params, customerId }));
  } catch (err) {
    next(err);
  }
});

feasibilityRouter.get("/api/feasibilities/available-for-quotation", readGuard, async (req, res, next) => {
  try {
    const customerId = req.query.customer_id ? Number(req.query.customer_id) : undefined;
    res.status(200).json(await listAvailableForQuotation(customerId));
  } catch (err) {
    next(err);
  }
});

feasibilityRouter.get("/api/feasibilities/:id", readGuard, async (req, res, next) => {
  try {
    res.status(200).json(await getFeasibility(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

feasibilityRouter.get("/api/feasibilities/:id/history", readGuard, async (req, res, next) => {
  try {
    res.status(200).json(await getFeasibilityHistory(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

feasibilityRouter.post("/api/feasibilities", writeGuard, async (req, res, next) => {
  try {
    const input = feasibilityCreateSchema.parse(req.body);
    res.status(201).json(await createFeasibility(input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

feasibilityRouter.post("/api/feasibilities/:id/run-check", writeGuard, async (req, res, next) => {
  try {
    res.status(200).json(await runCheck(Number(req.params.id), req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

feasibilityRouter.post("/api/feasibilities/:id/exception-decision", writeGuard, async (req, res, next) => {
  try {
    const input = feasibilityExceptionDecisionSchema.parse(req.body);
    res.status(200).json(await decideException(Number(req.params.id), input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

feasibilityRouter.post("/api/feasibilities/:id/close", writeGuard, async (req, res, next) => {
  try {
    const input = feasibilityCloseSchema.parse(req.body);
    res.status(200).json(await closeFeasibility(Number(req.params.id), input.reason, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

feasibilityRouter.post("/api/feasibilities/:id/revive", writeGuard, async (req, res, next) => {
  try {
    res.status(200).json(await reviveFeasibility(Number(req.params.id), req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

// Admin review is a genuinely separate authority from ordinary write
// access to the page -- an admin/manager signs off on an override or
// a stale-open flag, regardless of who has write on 'feasibilities'.
feasibilityRouter.post(
  "/api/feasibilities/:id/admin-review",
  requireRole("admin", "manager"),
  async (req, res, next) => {
    try {
      const input = feasibilityAdminReviewSchema.parse(req.body);
      res.status(200).json(await adminReview(Number(req.params.id), input.notes, req.user?.id ?? null));
    } catch (err) {
      next(err);
    }
  },
);

feasibilityRouter.delete("/api/feasibilities/:id", writeGuard, async (req, res, next) => {
  try {
    await deleteFeasibility(Number(req.params.id), req.user?.id ?? null);
    res.status(200).json({ status: "deleted" });
  } catch (err) {
    next(err);
  }
});

feasibilityRouter.post("/api/feasibilities/:id/restore", writeGuard, async (req, res, next) => {
  try {
    res.status(200).json(await restoreFeasibility(Number(req.params.id), req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

// Operational trigger for the stale-open sweep -- normally run by a
// scheduled job (Pass 6 background jobs); exposed here as an
// admin-only manual trigger in the meantime.
const escalateBodySchema = z.object({ as_of: z.string().optional() });
feasibilityRouter.post(
  "/api/feasibilities/escalate-stale",
  requireRole("admin", "manager"),
  async (req, res, next) => {
    try {
      const { as_of } = escalateBodySchema.parse(req.body ?? {});
      const ids = await escalateStaleFeasibilityChecks(as_of);
      res.status(200).json({ flagged_ids: ids });
    } catch (err) {
      next(err);
    }
  },
);
