/**
 * Pass 0 foundation tables only.
 *
 * `users` here is a minimal bootstrap entity so login/audit can be
 * proven end-to-end. The full Users domain (roles, admin CRUD,
 * department permission matrix -- see docs/PARITY_CHECKLIST.md) is
 * built out properly in Pass 1 under src/domains/users/, with this
 * table as its persistence model.
 *
 * `audit_log` is deliberately append-only: no updated_at/deleted_at,
 * and no service anywhere in the codebase should ever UPDATE or
 * DELETE a row in this table. See docs/PLAN.md Pass 5 for
 * tamper-evidence hardening.
 */

import type { ColumnType, Generated } from "kysely";

export interface UsersTable {
  id: Generated<number>;
  username: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: string;
  is_active: ColumnType<boolean, boolean | number, boolean | number>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface AuditLogTable {
  id: Generated<number>;
  entity_type: string;
  entity_id: string;
  action: string;
  changes: ColumnType<string | null, string | null, never>;
  performed_by: number | null;
  performed_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface Database {
  users: UsersTable;
  audit_log: AuditLogTable;
}
