import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../../api/dependencies/auth.js";
import { createEvent, deleteEvent, updateEvent } from "./commands.js";
import { getEvent, listEventsInRange } from "./queries.js";
import { calendarEventCreateSchema, calendarEventUpdateSchema } from "./schema.js";

export const calendarRouter = Router();

calendarRouter.use("/api/calendar", requireAuth);

const rangeQuerySchema = z.object({ from: z.string(), to: z.string() });

calendarRouter.get("/api/calendar/events", async (req, res, next) => {
  try {
    const { from, to } = rangeQuerySchema.parse(req.query);
    res.status(200).json(await listEventsInRange(from, to, req.user!.id));
  } catch (err) {
    next(err);
  }
});

calendarRouter.get("/api/calendar/events/:id", async (req, res, next) => {
  try {
    res.status(200).json(await getEvent(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

calendarRouter.post("/api/calendar/events", async (req, res, next) => {
  try {
    const input = calendarEventCreateSchema.parse(req.body);
    res.status(201).json(await createEvent(input, req.user?.id ?? null));
  } catch (err) {
    next(err);
  }
});

calendarRouter.put("/api/calendar/events/:id", async (req, res, next) => {
  try {
    const input = calendarEventUpdateSchema.parse(req.body);
    res.status(200).json(await updateEvent(Number(req.params.id), input, req.user!));
  } catch (err) {
    next(err);
  }
});

calendarRouter.delete("/api/calendar/events/:id", async (req, res, next) => {
  try {
    await deleteEvent(Number(req.params.id), req.user!);
    res.status(200).json({ message: "Deleted." });
  } catch (err) {
    next(err);
  }
});
