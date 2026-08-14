import { Router } from "express";

import { requireAuth, requireRole } from "../../api/dependencies/auth.js";
import { parseListParams } from "../../infrastructure/database/listParams.js";
import { createUser, deleteUser, restoreUser, updateUser } from "./commands.js";
import { getUser, getUserHistory, listUsers } from "./queries.js";
import { userCreateSchema, userUpdateSchema } from "./schema.js";

export const usersRouter = Router();

// Users management is inherently admin-only, regardless of the
// department permission matrix -- otherwise a staff user granted
// "write" on some unrelated page could indirectly escalate by editing
// users. Mirrors jdk_clean's core/permissions.py comment on PAGE_KEYS.
usersRouter.use("/api/users", requireAuth, requireRole("admin"));

usersRouter.get("/api/users", async (req, res, next) => {
  try {
    res.status(200).json(await listUsers(parseListParams(req.query as Record<string, unknown>)));
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/api/users/:id", async (req, res, next) => {
  try {
    res.status(200).json(await getUser(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/api/users/:id/history", async (req, res, next) => {
  try {
    res.status(200).json(await getUserHistory(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

usersRouter.post("/api/users", async (req, res, next) => {
  try {
    const input = userCreateSchema.parse(req.body);
    res.status(201).json(await createUser(input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

usersRouter.put("/api/users/:id", async (req, res, next) => {
  try {
    const input = userUpdateSchema.parse(req.body);
    res.status(200).json(await updateUser(Number(req.params.id), input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

usersRouter.delete("/api/users/:id", async (req, res, next) => {
  try {
    await deleteUser(Number(req.params.id), req.user?.id ?? null);
    res.status(200).json({ status: "deleted" });
  } catch (err) {
    next(err);
  }
});

usersRouter.post("/api/users/:id/restore", async (req, res, next) => {
  try {
    res.status(200).json(await restoreUser(Number(req.params.id), req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});
