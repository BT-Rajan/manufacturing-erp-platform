import { Router } from "express";

import { getSettings } from "../../core/config/settings.js";

export const healthRouter = Router();

healthRouter.get("/api/health", (_req, res) => {
  const settings = getSettings();
  res.status(200).json({ status: "ok", appName: settings.appName });
});
