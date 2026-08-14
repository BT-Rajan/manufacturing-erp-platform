/**
 * Page-level access control. Ported 1:1 from jdk_clean's
 * app/core/permissions.py, including the exact same PAGE_KEYS list
 * (several pages here don't have a domain built yet -- Pass 2/3 -- but
 * the governable page list is a stable admin-facing contract, not
 * something that should shift as domains get built out).
 *
 * Only 'staff' users are governed by department_permissions -- admin
 * and manager always have full read/write access everywhere and never
 * consult it; 'viewer' always has read-only access everywhere. A
 * department/page combination with no row means "none" -- deny by
 * default until explicitly granted.
 */

export const PAGE_KEYS = [
  "dashboard",
  "customers",
  "suppliers",
  "raw_materials",
  "products",
  "inventory",
  "mrp",
  "purchase_orders",
  "delivery_notes",
  "deals",
  "feasibilities",
  "machines",
  "quotations",
  "orders",
  "production",
] as const;

export type PageKey = (typeof PAGE_KEYS)[number];
export type AccessLevel = "none" | "read" | "write";

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, read: 1, write: 2 };

export function meetsLevel(granted: AccessLevel, needed: AccessLevel): boolean {
  return LEVEL_RANK[granted] >= LEVEL_RANK[needed];
}

export function isPageKey(value: string): value is PageKey {
  return (PAGE_KEYS as readonly string[]).includes(value);
}
