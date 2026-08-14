import cors from "cors";
import express, { type Express } from "express";

import { errorHandler } from "../core/errors/index.js";
import { getSettings } from "../core/config/settings.js";
import { bomRouter } from "../domains/bom/route.js";
import { customersRouter } from "../domains/customers/route.js";
import { fieldConfigRouter } from "../domains/fieldConfigAdmin/route.js";
import { inventoryRouter } from "../domains/inventory/route.js";
import { machinesRouter } from "../domains/machines/route.js";
import { permissionsRouter } from "../domains/permissions/route.js";
import { productsRouter } from "../domains/products/route.js";
import { rawMaterialsRouter } from "../domains/rawMaterials/route.js";
import { supplierMaterialsRouter } from "../domains/supplierMaterials/route.js";
import { suppliersRouter } from "../domains/suppliers/route.js";
import { usersRouter } from "../domains/users/route.js";
import { requestContext } from "./middleware/requestContext.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";

export function createApp(): Express {
  const settings = getSettings();
  const app = express();

  app.use(express.json());
  app.use(cors({ origin: settings.corsOrigins, credentials: true }));
  app.use(requestContext);

  app.use(healthRouter);
  app.use(authRouter);

  // Pass 1: master data domains + the admin surfaces that make them
  // configurable (permissions matrix, field config) and accountable
  // (users management).
  app.use(customersRouter);
  app.use(suppliersRouter);
  app.use(supplierMaterialsRouter);
  app.use(rawMaterialsRouter);
  app.use(machinesRouter);
  app.use(productsRouter);
  app.use(usersRouter);
  app.use(permissionsRouter);
  app.use(fieldConfigRouter);

  // Pass 2a: BOM + inventory.
  app.use(bomRouter);
  app.use(inventoryRouter);

  // Must be registered last -- Express only treats a 4-arg function as
  // an error handler.
  app.use(errorHandler);

  return app;
}
