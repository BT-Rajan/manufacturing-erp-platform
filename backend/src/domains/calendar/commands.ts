import { record } from "../../application/services/auditService.js";
import { ForbiddenError, NotFoundAppError, ValidationAppError } from "../../core/errors/index.js";
import * as usersRepository from "../users/repository.js";
import { getEvent } from "./queries.js";
import * as repository from "./repository.js";
import type { CalendarEventCreateInput, CalendarEventUpdateInput } from "./schema.js";

const TABLE_NAME = "calendar_events";

async function assertMentionedUsersExist(userIds: number[]): Promise<void> {
  for (const userId of userIds) {
    const user = await usersRepository.findById(userId);
    if (!user) throw new ValidationAppError(`User ${userId} not found.`);
  }
}

function assertCanModify(event: { created_by: number | null }, user: { id: number; role: string }): void {
  if (user.role === "admin" || user.role === "manager") return;
  if (event.created_by === user.id) return;
  throw new ForbiddenError("Only the event's creator (or an admin/manager) can modify it.");
}

export async function createEvent(input: CalendarEventCreateInput, performedBy: number | null) {
  await assertMentionedUsersExist(input.mentioned_user_ids);
  const id = await repository.create(
    { event_date: input.event_date, title: input.title, notes: input.notes ?? null, all_users: input.all_users },
    input.mentioned_user_ids,
    performedBy,
  );
  await record({ entityType: TABLE_NAME, entityId: id, action: "create", performedBy });
  return getEvent(id);
}

export async function updateEvent(
  id: number,
  input: CalendarEventUpdateInput,
  currentUser: { id: number; role: string },
) {
  const event = await repository.findById(id);
  if (!event) throw new NotFoundAppError("Calendar event");
  assertCanModify(event, currentUser);

  if (input.mentioned_user_ids !== undefined) {
    await assertMentionedUsersExist(input.mentioned_user_ids);
  }

  const updateValues: Parameters<typeof repository.update>[1] = {};
  if (input.event_date !== undefined) updateValues.event_date = input.event_date;
  if (input.title !== undefined) updateValues.title = input.title;
  if (input.notes !== undefined) updateValues.notes = input.notes ?? null;
  if (input.all_users !== undefined) updateValues.all_users = input.all_users;

  await repository.update(id, updateValues, input.mentioned_user_ids, currentUser.id);
  await record({
    entityType: TABLE_NAME,
    entityId: id,
    action: "update",
    performedBy: currentUser.id,
    changes: input as Record<string, unknown>,
  });
  return getEvent(id);
}

export async function deleteEvent(id: number, currentUser: { id: number; role: string }): Promise<void> {
  const event = await repository.findById(id);
  if (!event) throw new NotFoundAppError("Calendar event");
  assertCanModify(event, currentUser);
  await repository.softDelete(id, currentUser.id);
  await record({ entityType: TABLE_NAME, entityId: id, action: "delete", performedBy: currentUser.id });
}
