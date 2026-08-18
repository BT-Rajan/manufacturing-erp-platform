import { NotFoundAppError } from "../../core/errors/index.js";
import * as repository from "./repository.js";

export async function getEvent(id: number) {
  const event = await repository.findById(id);
  if (!event) throw new NotFoundAppError("Calendar event");
  const mentionedUserIds = await repository.getMentionedUserIds(id);
  return { ...event, mentioned_user_ids: mentionedUserIds };
}

export async function listEventsInRange(from: string, to: string, userId: number) {
  return repository.listInRange(from, to, userId);
}
