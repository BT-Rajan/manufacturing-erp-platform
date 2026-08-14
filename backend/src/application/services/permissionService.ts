/**
 * Manages the department_permissions matrix that
 * api/dependencies/permissions.ts's requirePageAccess enforces. Only
 * ever touched by admin/manager (see the route guard) -- staff and
 * viewer users are governed by this data, never allowed to change it.
 * Ported from jdk_clean's app/services/permission_service.py.
 */

import { getDb } from "../../infrastructure/database/connection.js";
import type { AccessLevel, PageKey } from "../../core/permissions/pageKeys.js";
import { PAGE_KEYS } from "../../core/permissions/pageKeys.js";
import type { AuthenticatedUser } from "../../api/dependencies/auth.js";

export const DEPARTMENTS = ["sales", "procurement", "warehouse"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export interface PermissionEntry {
  department: Department;
  pageKey: PageKey;
  accessLevel: AccessLevel;
}

/** One row per (department, page_key) combination -- every department
 * times every page, always the full grid, 'none' for anything never
 * explicitly set. This is what the Settings -> Access Control grid
 * renders directly. */
export async function getMatrix(): Promise<PermissionEntry[]> {
  const db = getDb();
  const rows = await db.selectFrom("department_permissions").selectAll().execute();
  const existing = new Map(rows.map((r) => [`${r.department}:${r.page_key}`, r.access_level]));

  const matrix: PermissionEntry[] = [];
  for (const department of DEPARTMENTS) {
    for (const pageKey of PAGE_KEYS) {
      matrix.push({
        department,
        pageKey,
        accessLevel: existing.get(`${department}:${pageKey}`) ?? "none",
      });
    }
  }
  return matrix;
}

/** The calling user's own effective access per page -- what
 * requirePageAccess actually enforces, exposed as data so the frontend
 * can decide what to show in nav/routing without admin rights. */
export async function computeEffectivePermissions(
  user: AuthenticatedUser,
): Promise<Record<PageKey, AccessLevel>> {
  if (user.role === "admin" || user.role === "manager") {
    return Object.fromEntries(PAGE_KEYS.map((k) => [k, "write"])) as Record<PageKey, AccessLevel>;
  }
  if (user.role === "viewer") {
    return Object.fromEntries(PAGE_KEYS.map((k) => [k, "read"])) as Record<PageKey, AccessLevel>;
  }

  const db = getDb();
  const rows = await db
    .selectFrom("department_permissions")
    .selectAll()
    .where("department", "=", (user.department ?? "sales") as Department)
    .execute();
  const granted = new Map(rows.map((r) => [r.page_key, r.access_level]));

  return Object.fromEntries(PAGE_KEYS.map((k) => [k, granted.get(k) ?? "none"])) as Record<PageKey, AccessLevel>;
}

/** Bulk upsert -- entries is exactly what getMatrix() returns, so the
 * frontend sends the whole edited grid back in one call. */
export async function setMatrix(entries: PermissionEntry[], performedBy: number | null): Promise<PermissionEntry[]> {
  const db = getDb();
  for (const entry of entries) {
    if (!DEPARTMENTS.includes(entry.department)) continue;
    if (!(PAGE_KEYS as readonly string[]).includes(entry.pageKey)) continue;
    if (!["none", "read", "write"].includes(entry.accessLevel)) continue;

    const existing = await db
      .selectFrom("department_permissions")
      .selectAll()
      .where("department", "=", entry.department)
      .where("page_key", "=", entry.pageKey)
      .executeTakeFirst();

    if (existing) {
      await db
        .updateTable("department_permissions")
        .set({ access_level: entry.accessLevel, updated_by: performedBy })
        .where("id", "=", existing.id)
        .execute();
    } else {
      await db
        .insertInto("department_permissions")
        .values({
          department: entry.department,
          page_key: entry.pageKey,
          access_level: entry.accessLevel,
          updated_by: performedBy,
        })
        .execute();
    }
  }
  return getMatrix();
}
