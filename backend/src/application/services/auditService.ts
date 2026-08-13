/**
 * The single audit entry point. Every command/use case that changes
 * state calls record() -- there is no other path to writing an audit
 * row, and nothing in the codebase updates or deletes one once written.
 */

import { getDb } from "../../infrastructure/database/connection.js";

export interface RecordAuditInput {
  entityType: string;
  entityId: string | number;
  action: string;
  changes?: Record<string, unknown> | null;
  performedBy?: number | null;
}

export async function record(input: RecordAuditInput): Promise<void> {
  const db = getDb();
  await db
    .insertInto("audit_log")
    .values({
      entity_type: input.entityType,
      entity_id: String(input.entityId),
      action: input.action,
      changes: input.changes ? JSON.stringify(input.changes) : null,
      performed_by: input.performedBy ?? null,
    })
    .execute();
}

export interface AuditEntry {
  id: number;
  entityType: string;
  entityId: string;
  action: string;
  changes: Record<string, unknown> | null;
  performedBy: number | null;
  performedAt: Date;
}

export async function history(entityType: string, entityId: string | number): Promise<AuditEntry[]> {
  const db = getDb();
  const rows = await db
    .selectFrom("audit_log")
    .selectAll()
    .where("entity_type", "=", entityType)
    .where("entity_id", "=", String(entityId))
    .orderBy("performed_at", "asc")
    .execute();

  return rows.map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    changes: row.changes ? (JSON.parse(row.changes) as Record<string, unknown>) : null,
    performedBy: row.performed_by,
    performedAt: new Date(row.performed_at),
  }));
}
