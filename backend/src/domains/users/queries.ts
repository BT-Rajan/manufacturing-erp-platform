import { history as auditHistory } from "../../application/services/auditService.js";
import { NotFoundAppError } from "../../core/errors/index.js";
import type { ListParams } from "../../infrastructure/database/listParams.js";
import { toPublicUser } from "./publicUser.js";
import * as repository from "./repository.js";

const ENTITY_TYPE = "user";

export async function getUser(id: number) {
  const user = await repository.findById(id);
  if (!user) throw new NotFoundAppError("User");
  return toPublicUser(user);
}

export async function listUsers(params: ListParams) {
  const result = await repository.list(params);
  return { ...result, items: result.items.map((item) => toPublicUser(item!)) };
}

export async function getUserHistory(id: number) {
  await getUser(id);
  return auditHistory(ENTITY_TYPE, id);
}
