import { history as auditHistory } from "../../application/services/auditService.js";
import { NotFoundAppError } from "../../core/errors/index.js";
import type { ListParams } from "../../infrastructure/database/listParams.js";
import * as repository from "./repository.js";

const TABLE_NAME = "delivery_notes";

export async function getDeliveryNote(id: number, includeDeleted = false) {
  const note = await repository.findById(id, includeDeleted);
  if (!note) throw new NotFoundAppError("Delivery note");
  const lines = await repository.getLines(id);
  return { ...note, lines };
}

export async function listDeliveryNotes(params: ListParams & { orderId?: number }) {
  return repository.list(params);
}

export async function getDeliveryNoteHistory(id: number) {
  await getDeliveryNote(id, true);
  return auditHistory(TABLE_NAME, id);
}
