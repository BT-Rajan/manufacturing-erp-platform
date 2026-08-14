import { Router } from "express";

import { requireAuth } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { parseListParams } from "../../infrastructure/database/listParams.js";
import { createMachine, deleteMachine, restoreMachine, updateMachine } from "./commands.js";
import { getMachine, getMachineHistory, listMachines } from "./queries.js";
import { machineCreateSchema, machineUpdateSchema } from "./schema.js";

export const machinesRouter = Router();

machinesRouter.use("/api/machines", requireAuth);

machinesRouter.get("/api/machines", requirePageAccess("machines", "read"), async (req, res, next) => {
  try {
    res.status(200).json(await listMachines(parseListParams(req.query as Record<string, unknown>)));
  } catch (err) {
    next(err);
  }
});

machinesRouter.get("/api/machines/:id", requirePageAccess("machines", "read"), async (req, res, next) => {
  try {
    res.status(200).json(await getMachine(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

machinesRouter.get(
  "/api/machines/:id/history",
  requirePageAccess("machines", "read"),
  async (req, res, next) => {
    try {
      res.status(200).json(await getMachineHistory(Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

machinesRouter.post("/api/machines", requirePageAccess("machines", "write"), async (req, res, next) => {
  try {
    const input = machineCreateSchema.parse(req.body);
    res.status(201).json(await createMachine(input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

machinesRouter.put("/api/machines/:id", requirePageAccess("machines", "write"), async (req, res, next) => {
  try {
    const input = machineUpdateSchema.parse(req.body);
    res.status(200).json(await updateMachine(Number(req.params.id), input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

machinesRouter.delete(
  "/api/machines/:id",
  requirePageAccess("machines", "write"),
  async (req, res, next) => {
    try {
      await deleteMachine(Number(req.params.id), req.user?.id ?? null);
      res.status(200).json({ status: "deleted" });
    } catch (err) {
      next(err);
    }
  },
);

machinesRouter.post(
  "/api/machines/:id/restore",
  requirePageAccess("machines", "write"),
  async (req, res, next) => {
    try {
      res.status(200).json(await restoreMachine(Number(req.params.id), req.user?.id ?? null));
    } catch (err) {
      next(err);
    }
  },
);
