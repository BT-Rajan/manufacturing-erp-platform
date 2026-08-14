import { Router } from "express";
import { z } from "zod";

import { requireAuth, requireRole } from "../../api/dependencies/auth.js";
import { PAGE_KEYS } from "../../core/permissions/pageKeys.js";
import { computeEffectivePermissions, getMatrix, setMatrix } from "../../application/services/permissionService.js";

export const permissionsRouter = Router();

permissionsRouter.use("/api/permissions", requireAuth);

const adminOrManager = requireRole("admin", "manager");

const permissionEntrySchema = z.object({
  department: z.enum(["sales", "procurement", "warehouse"]),
  pageKey: z.enum(PAGE_KEYS),
  accessLevel: z.enum(["none", "read", "write"]),
});

const permissionMatrixUpdateSchema = z.object({
  entries: z.array(permissionEntrySchema),
});

permissionsRouter.get("/api/permissions", adminOrManager, async (_req, res, next) => {
  try {
    res.status(200).json(await getMatrix());
  } catch (err) {
    next(err);
  }
});

/** Any authenticated user can see the list of governable pages (not a
 * secret) -- only admin/manager can see or change the actual matrix. */
permissionsRouter.get("/api/permissions/pages", (_req, res) => {
  res.status(200).json({ pages: PAGE_KEYS });
});

/** The calling user's own effective access per page -- used by the
 * frontend to decide nav/routing without needing admin rights. */
permissionsRouter.get("/api/permissions/me", async (req, res, next) => {
  try {
    res.status(200).json(await computeEffectivePermissions(req.user!));
  } catch (err) {
    next(err);
  }
});

permissionsRouter.put("/api/permissions", adminOrManager, async (req, res, next) => {
  try {
    const input = permissionMatrixUpdateSchema.parse(req.body);
    res.status(200).json(await setMatrix(input.entries, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});
