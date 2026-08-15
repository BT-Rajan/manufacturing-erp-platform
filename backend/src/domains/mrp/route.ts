import { Router } from "express";

import { requireAuth } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { computeRequirements } from "./queries.js";

export const mrpRouter = Router();

mrpRouter.get(
  "/api/mrp/requirements",
  requireAuth,
  requirePageAccess("mrp", "read"),
  async (_req, res, next) => {
    try {
      res.status(200).json(await computeRequirements());
    } catch (err) {
      next(err);
    }
  },
);
