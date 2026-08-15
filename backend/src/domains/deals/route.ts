import { Router } from "express";

import { requireAuth } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { getDealDetail } from "./queries.js";

export const dealsRouter = Router();

dealsRouter.get(
  "/api/deals/:id",
  requireAuth,
  requirePageAccess("deals", "read"),
  async (req, res, next) => {
    try {
      res.status(200).json(await getDealDetail(Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);
