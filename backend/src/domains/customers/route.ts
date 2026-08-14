import { Router } from "express";

import { requireAuth } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { parseListParams } from "../../infrastructure/database/listParams.js";
import { createCustomer, deleteCustomer, restoreCustomer, updateCustomer } from "./commands.js";
import { getCustomer, getCustomerHistory, listCustomers } from "./queries.js";
import { customerCreateSchema, customerUpdateSchema } from "./schema.js";

export const customersRouter = Router();

customersRouter.use("/api/customers", requireAuth);

customersRouter.get("/api/customers", requirePageAccess("customers", "read"), async (req, res, next) => {
  try {
    const result = await listCustomers(parseListParams(req.query as Record<string, unknown>));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

customersRouter.get("/api/customers/:id", requirePageAccess("customers", "read"), async (req, res, next) => {
  try {
    const customer = await getCustomer(Number(req.params.id));
    res.status(200).json(customer);
  } catch (err) {
    next(err);
  }
});

customersRouter.get(
  "/api/customers/:id/history",
  requirePageAccess("customers", "read"),
  async (req, res, next) => {
    try {
      const entries = await getCustomerHistory(Number(req.params.id));
      res.status(200).json(entries);
    } catch (err) {
      next(err);
    }
  },
);

customersRouter.post("/api/customers", requirePageAccess("customers", "write"), async (req, res, next) => {
  try {
    const input = customerCreateSchema.parse(req.body);
    const created = await createCustomer(input, req.user?.id ?? null);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

customersRouter.put("/api/customers/:id", requirePageAccess("customers", "write"), async (req, res, next) => {
  try {
    const input = customerUpdateSchema.parse(req.body);
    const updated = await updateCustomer(Number(req.params.id), input, req.user?.id ?? null);
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

customersRouter.delete(
  "/api/customers/:id",
  requirePageAccess("customers", "write"),
  async (req, res, next) => {
    try {
      await deleteCustomer(Number(req.params.id), req.user?.id ?? null);
      res.status(200).json({ status: "deleted" });
    } catch (err) {
      next(err);
    }
  },
);

customersRouter.post(
  "/api/customers/:id/restore",
  requirePageAccess("customers", "write"),
  async (req, res, next) => {
    try {
      const restored = await restoreCustomer(Number(req.params.id), req.user?.id ?? null);
      res.status(200).json(restored);
    } catch (err) {
      next(err);
    }
  },
);
