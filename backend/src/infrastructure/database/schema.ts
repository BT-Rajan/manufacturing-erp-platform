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

export interface BomLinesTable extends SoftDeletableColumns {
  parent_product_id: number;
  component_type: "raw_material" | "product";
  component_id: number;
  quantity: ColumnType<string, string | number | undefined, string | number>;
  unit: string;
  scrap_percent: ColumnType<string, string | number | undefined, string | number>;
}

export interface FinishedGoodsInventoryTable {
  id: Generated<number>;
  product_id: number;
  quantity_on_hand: ColumnType<string, string | number | undefined, string | number>;
  quantity_reserved: ColumnType<string, string | number | undefined, string | number>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
}

export interface RawMaterialInventoryTable {
  id: Generated<number>;
  raw_material_id: number;
  quantity_on_hand: ColumnType<string, string | number | undefined, string | number>;
  quantity_reserved: ColumnType<string, string | number | undefined, string | number>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
}

export interface StockMovementsTable {
  id: Generated<number>;
  item_type: "raw_material" | "product";
  item_id: number;
  movement_type: "receipt" | "issue" | "adjustment" | "production_in" | "production_out" | "return";
  quantity: ColumnType<string, string | number | undefined, string | number>;
  reference_type: string | null;
  reference_id: number | null;
  notes: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  created_by: number | null;
}

export interface NumberSeriesTable {
  id: Generated<number>;
  doc_type: string;
  prefix: string;
  next_number: number;
  padding: number;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
}

export interface SettingsTable {
  id: Generated<number>;
  setting_key: string;
  setting_value: string | null;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
}

/** Minimal stub -- see migration 0004's header comment. Full domain
 * (discounts, tax, approval workflow, etc.) lands in Pass 2d. */
export interface OrdersTable {
  id: Generated<number>;
  order_number: string | null;
  customer_id: number;
  status: "draft" | "confirmed" | "in_production" | "ready_to_ship" | "shipped" | "delivered" | "cancelled";
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface OrderLinesTable {
  id: Generated<number>;
  order_id: number;
  product_id: number;
  quantity: ColumnType<string, string | number | undefined, string | number>;
}

/** Minimal stub -- see migration 0004's header comment. Full domain
 * lands in Pass 2e. */
export interface ProductionSchedulesTable {
  id: Generated<number>;
  batch_number: string | null;
  product_id: number;
  machine_id: number | null;
  order_id: number | null;
  planned_quantity: ColumnType<string, string | number | undefined, string | number>;
  scheduled_start: ColumnType<Date, string, string>;
  scheduled_end: ColumnType<Date, string, string>;
  status: "planned" | "in_progress" | "completed" | "cancelled";
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface FeasibilityChecksTable {
  id: Generated<number>;
  feasibility_number: string;
  customer_id: number;
  deal_id: number | null;
  status: "draft" | "feasible" | "exception_pending" | "exception_approved" | "exception_rejected" | "closed" | "converted";
  required_by_date: ColumnType<string | null, string | null, string | null>;
  checked_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  exception_reason: string | null;
  exception_by: number | null;
  close_reason: string | null;
  notes: string | null;
  admin_review_required: ColumnType<boolean, boolean | number, boolean | number>;
  admin_review_reason: "override" | "stale_open" | null;
  admin_reviewed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  admin_reviewed_by: number | null;
  admin_review_notes: string | null;
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  created_by: number | null;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  updated_by: number | null;
}

export interface FeasibilityLinesTable {
  id: Generated<number>;
  feasibility_id: number;
  product_id: number;
  quantity: ColumnType<string, string | number | undefined, string | number>;
  covered_by_stock: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  bom_missing: ColumnType<boolean | null, boolean | number | null | undefined, boolean | number | null>;
  is_feasible: ColumnType<boolean | null, boolean | number | null | undefined, boolean | number | null>;
  shortfall_json: string | null;
  capacity_ok: ColumnType<boolean | null, boolean | number | null | undefined, boolean | number | null>;
  capacity_shortfall_json: string | null;
}

export interface DealsTable {
  id: Generated<number>;
  deal_number: string;
  customer_id: number;
  furthest_stage: "feasibility" | "quotation" | "order" | "production" | "delivery";
  status: "open" | "cancelled";
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  created_by: number | null;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  updated_by: number | null;
}

export interface QuotationsTable {
  id: Generated<number>;
  quotation_number: string;
  customer_id: number;
  deal_id: number | null;
  quotation_date: ColumnType<Date, string, string>;
  valid_until: ColumnType<Date | null, string | null, string | null>;
  status: "draft" | "sent" | "accepted" | "rejected" | "expired" | "converted";
  subtotal_amount: ColumnType<string, string | number | undefined, string | number>;
  discount_percent: ColumnType<string, string | number | undefined, string | number>;
  discount_amount: ColumnType<string, string | number | undefined, string | number>;
  tax_rate: ColumnType<string, string | number | undefined, string | number>;
  tax_amount: ColumnType<string, string | number | undefined, string | number>;
  total_amount: ColumnType<string, string | number | undefined, string | number>;
  notes: string | null;
  converted_order_id: number | null;
  feasibility_id: number | null;
  auto_created: ColumnType<boolean, boolean | number | undefined, boolean | number>;
  close_reason: string | null;
  approved_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  approved_by: number | null;
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  created_by: number | null;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  updated_by: number | null;
}

export interface QuotationDetailsTable {
  id: Generated<number>;
  quotation_id: number;
  product_id: number;
  quantity: ColumnType<string, string | number | undefined, string | number>;
  unit_price: ColumnType<string, string | number | undefined, string | number>;
  discount_percent: ColumnType<string, string | number | undefined, string | number>;
  line_total: ColumnType<string, string | number | undefined, string | number>;
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
  bom_lines: BomLinesTable;
  finished_goods_inventory: FinishedGoodsInventoryTable;
  raw_material_inventory: RawMaterialInventoryTable;
  stock_movements: StockMovementsTable;
  number_series: NumberSeriesTable;
  settings: SettingsTable;
  orders: OrdersTable;
  order_lines: OrderLinesTable;
  production_schedules: ProductionSchedulesTable;
  feasibility_checks: FeasibilityChecksTable;
  feasibility_lines: FeasibilityLinesTable;
  deals: DealsTable;
  quotations: QuotationsTable;
  quotation_details: QuotationDetailsTable;
}
