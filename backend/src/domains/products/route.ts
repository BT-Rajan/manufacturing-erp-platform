import { Router } from "express";

import { requireAuth } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { parseListParams } from "../../infrastructure/database/listParams.js";
import { createProduct, deleteProduct, restoreProduct, updateProduct } from "./commands.js";
import { getProduct, getProductHistory, listProducts } from "./queries.js";
import { productCreateSchema, productUpdateSchema } from "./schema.js";

export const productsRouter = Router();

productsRouter.use("/api/products", requireAuth);

productsRouter.get("/api/products", requirePageAccess("products", "read"), async (req, res, next) => {
  try {
    res.status(200).json(await listProducts(parseListParams(req.query as Record<string, unknown>)));
  } catch (err) {
    next(err);
  }
});

productsRouter.get("/api/products/:id", requirePageAccess("products", "read"), async (req, res, next) => {
  try {
    res.status(200).json(await getProduct(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

productsRouter.get(
  "/api/products/:id/history",
  requirePageAccess("products", "read"),
  async (req, res, next) => {
    try {
      res.status(200).json(await getProductHistory(Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

productsRouter.post("/api/products", requirePageAccess("products", "write"), async (req, res, next) => {
  try {
    const input = productCreateSchema.parse(req.body);
    res.status(201).json(await createProduct(input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

productsRouter.put("/api/products/:id", requirePageAccess("products", "write"), async (req, res, next) => {
  try {
    const input = productUpdateSchema.parse(req.body);
    res.status(200).json(await updateProduct(Number(req.params.id), input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

productsRouter.delete(
  "/api/products/:id",
  requirePageAccess("products", "write"),
  async (req, res, next) => {
    try {
      await deleteProduct(Number(req.params.id), req.user?.id ?? null);
      res.status(200).json({ status: "deleted" });
    } catch (err) {
      next(err);
    }
  },
);

productsRouter.post(
  "/api/products/:id/restore",
  requirePageAccess("products", "write"),
  async (req, res, next) => {
    try {
      res.status(200).json(await restoreProduct(Number(req.params.id), req.user?.id ?? null));
    } catch (err) {
      next(err);
    }
  },
);
