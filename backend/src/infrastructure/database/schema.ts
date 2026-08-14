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
  phone: string | null;
  avatar_filename: string | null;
  department: "sales" | "procurement" | "warehouse" | null;
  signature_filename: string | null;
  role: "admin" | "manager" | "staff" | "viewer";
  is_active: ColumnType<boolean, boolean | number, boolean | number>;
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  created_by: number | null;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  updated_by: number | null;
}

export interface AuditLogTable {
  id: Generated<number>;
  entity_type: string;
  entity_id: string;
  action: string;
  /** Insert side: we JSON.stringify() before writing (mysql2 needs a
   * string bind value for a JSON column). Select side: mysql2 parses
   * JSON columns automatically, so reads come back as the parsed
   * value, not a string -- see auditService.ts:history(). */
  changes: ColumnType<Record<string, unknown> | null, string | null, never>;
  performed_by: number | null;
  performed_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface DepartmentPermissionsTable {
  id: Generated<number>;
  department: "sales" | "procurement" | "warehouse";
  page_key: string;
  access_level: "none" | "read" | "write";
  updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  updated_by: number | null;
}

export interface FieldConfigTable {
  id: Generated<number>;
  entity_type: string;
  field_name: string;
  is_required: ColumnType<boolean | null, boolean | number | null, boolean | number | null>;
  is_searchable: ColumnType<boolean | null, boolean | number | null, boolean | number | null>;
  is_filterable: ColumnType<boolean | null, boolean | number | null, boolean | number | null>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  updated_by: number | null;
}

/** Shared shape every master-data (soft-deletable) table has in
 * common, beyond its own business columns -- used by
 * softDeleteRepository.ts's generic constraint. */
export interface SoftDeletableColumns {
  id: Generated<number>;
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  created_by: number | null;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  updated_by: number | null;
}

export interface CustomersTable extends SoftDeletableColumns {
  code: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  city: string | null;
  country: string | null;
  tax_id: string | null;
  credit_limit: ColumnType<string, string | number | undefined, string | number>;
  payment_terms_days: number;
  status: "active" | "inactive";
  notes: string | null;
}

export interface SuppliersTable extends SoftDeletableColumns {
  code: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  tax_id: string | null;
  payment_terms_days: number;
  mode_of_supply: "direct" | "distributor" | "broker" | "import" | null;
  rating: number | null;
  status: "active" | "inactive" | "suspended";
}

export interface RawMaterialsTable extends SoftDeletableColumns {
  code: string;
  name: string;
  unit: string;
  reorder_point: ColumnType<string, string | number | undefined, string | number>;
  default_supplier_id: number | null;
  unit_cost: ColumnType<string, string | number | undefined, string | number>;
  status: "active" | "inactive";
}

export interface SupplierMaterialsTable extends SoftDeletableColumns {
  supplier_id: number;
  raw_material_id: number;
  max_supply_quantity: ColumnType<string, string | number | undefined, string | number>;
  lead_time_days: number | null;
}

export interface MachinesTable extends SoftDeletableColumns {
  code: string;
  name: string;
  capacity_hours_per_day: ColumnType<string, string | number | undefined, string | number>;
  status: "active" | "inactive";
}

export interface ProductsTable extends SoftDeletableColumns {
  code: string;
  name: string;
  unit: string;
  product_type: "finished_good" | "sub_assembly";
  selling_price: ColumnType<string, string | number | undefined, string | number>;
  machine_id: number | null;
  production_hours_per_unit: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  workers_required: number | null;
  status: "active" | "inactive";
}

export interface Database {
  users: UsersTable;
  audit_log: AuditLogTable;
  department_permissions: DepartmentPermissionsTable;
  field_config: FieldConfigTable;
  customers: CustomersTable;
  suppliers: SuppliersTable;
  raw_materials: RawMaterialsTable;
  supplier_materials: SupplierMaterialsTable;
  machines: MachinesTable;
  products: ProductsTable;
}
