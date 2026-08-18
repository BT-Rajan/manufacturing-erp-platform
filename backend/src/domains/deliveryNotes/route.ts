import { Router } from "express";

import { requireAuth } from "../../api/dependencies/auth.js";
import { requirePageAccess } from "../../api/dependencies/permissions.js";
import { parseListParams } from "../../infrastructure/database/listParams.js";
import { changeStatus, createDeliveryNote, deleteDeliveryNote, restoreDeliveryNote, updateDeliveryNote } from "./commands.js";
import { getDeliveryNote, getDeliveryNoteHistory, listDeliveryNotes } from "./queries.js";
import { deliveryNoteCreateSchema, deliveryNoteStatusUpdateSchema, deliveryNoteUpdateSchema } from "./schema.js";

export const deliveryNotesRouter = Router();

deliveryNotesRouter.use("/api/delivery-notes", requireAuth);

const readGuard = requirePageAccess("delivery_notes", "read");
const writeGuard = requirePageAccess("delivery_notes", "write");

deliveryNotesRouter.get("/api/delivery-notes", readGuard, async (req, res, next) => {
  try {
    const params = parseListParams(req.query as Record<string, unknown>);
    const orderId = req.query.order_id ? Number(req.query.order_id) : undefined;
    res.status(200).json(await listDeliveryNotes({ ...params, orderId }));
  } catch (err) {
    next(err);
  }
});

deliveryNotesRouter.get("/api/delivery-notes/:id", readGuard, async (req, res, next) => {
  try {
    res.status(200).json(await getDeliveryNote(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

deliveryNotesRouter.get("/api/delivery-notes/:id/history", readGuard, async (req, res, next) => {
  try {
    res.status(200).json(await getDeliveryNoteHistory(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

deliveryNotesRouter.post("/api/delivery-notes", writeGuard, async (req, res, next) => {
  try {
    const input = deliveryNoteCreateSchema.parse(req.body);
    res.status(201).json(await createDeliveryNote(input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

deliveryNotesRouter.put("/api/delivery-notes/:id", writeGuard, async (req, res, next) => {
  try {
    const input = deliveryNoteUpdateSchema.parse(req.body);
    res.status(200).json(await updateDeliveryNote(Number(req.params.id), input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

deliveryNotesRouter.post("/api/delivery-notes/:id/status", writeGuard, async (req, res, next) => {
  try {
    const input = deliveryNoteStatusUpdateSchema.parse(req.body);
    res.status(200).json(await changeStatus(Number(req.params.id), input.status, input.reason, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

deliveryNotesRouter.delete("/api/delivery-notes/:id", writeGuard, async (req, res, next) => {
  try {
    await deleteDeliveryNote(Number(req.params.id), req.user?.id ?? null);
    res.status(200).json({ message: "Deleted." });
  } catch (err) {
    next(err);
  }
});

deliveryNotesRouter.post("/api/delivery-notes/:id/restore", writeGuard, async (req, res, next) => {
  try {
    res.status(200).json(await restoreDeliveryNote(Number(req.params.id), req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

// /pdf and /email deferred to Pass 3 (document/adapter infrastructure).
