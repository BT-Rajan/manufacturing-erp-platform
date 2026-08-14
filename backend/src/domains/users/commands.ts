import { record } from "../../application/services/auditService.js";
import { ConflictError, NotFoundAppError } from "../../core/errors/index.js";
import { toPublicUser } from "./publicUser.js";
import * as repository from "./repository.js";
import type { UserCreateInput, UserUpdateInput } from "./schema.js";

const ENTITY_TYPE = "user";

export async function createUser(input: UserCreateInput, performedBy: number | null) {
  if (await repository.usernameOrEmailExists(input.username, input.email)) {
    throw new ConflictError("Username or email is already in use.");
  }
  const created = await repository.create(input, performedBy);
  await record({ entityType: ENTITY_TYPE, entityId: created!.id, action: "create", performedBy });
  return toPublicUser(created!);
}

export async function updateUser(id: number, input: UserUpdateInput, performedBy: number | null) {
  const existing = await repository.findById(id);
  if (!existing) throw new NotFoundAppError("User");

  const updated = await repository.update(id, input, performedBy);
  const { password: _password, ...changes } = input;
  await record({ entityType: ENTITY_TYPE, entityId: id, action: "update", performedBy, changes });
  return toPublicUser(updated!);
}

export async function deleteUser(id: number, performedBy: number | null): Promise<void> {
  const existing = await repository.findById(id);
  if (!existing) throw new NotFoundAppError("User");
  await repository.softDelete(id, performedBy);
  await record({ entityType: ENTITY_TYPE, entityId: id, action: "delete", performedBy });
}

export async function restoreUser(id: number, performedBy: number | null) {
  const existing = await repository.findById(id, true);
  if (!existing) throw new NotFoundAppError("User");
  await repository.restore(id, performedBy);
  await record({ entityType: ENTITY_TYPE, entityId: id, action: "restore", performedBy });
  const restored = await repository.findById(id);
  return toPublicUser(restored!);
}
