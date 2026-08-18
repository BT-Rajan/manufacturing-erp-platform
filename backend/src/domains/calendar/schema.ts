import { z } from "zod";

export const calendarEventCreateSchema = z.object({
  event_date: z.string(),
  title: z.string().min(1).max(200),
  notes: z.string().nullish(),
  all_users: z.boolean().default(false),
  mentioned_user_ids: z.array(z.number().int().positive()).default([]),
});

export const calendarEventUpdateSchema = z.object({
  event_date: z.string().optional(),
  title: z.string().min(1).max(200).optional(),
  notes: z.string().nullish(),
  all_users: z.boolean().optional(),
  mentioned_user_ids: z.array(z.number().int().positive()).optional(),
});

export type CalendarEventCreateInput = z.infer<typeof calendarEventCreateSchema>;
export type CalendarEventUpdateInput = z.infer<typeof calendarEventUpdateSchema>;
