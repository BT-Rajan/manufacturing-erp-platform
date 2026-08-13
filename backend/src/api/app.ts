import cors from "cors";
import express, { type Express } from "express";

import { errorHandler } from "../core/errors/index.js";
import { requestContext } from "./middleware/requestContext.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { getSettings } from "../core/config/settings.js";

export function createApp(): Express {
  const settings = getSettings();
  const app = express();

  app.use(express.json());
  app.use(cors({ origin: settings.corsOrigins, credentials: true }));
  app.use(requestContext);

  app.use(healthRouter);
  app.use(authRouter);

  // Must be registered last -- Express only treats a 4-arg function as
  // an error handler.
  app.use(errorHandler);

  return app;
}
