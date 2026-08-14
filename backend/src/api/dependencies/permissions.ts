import type { NextFunction, Request, Response } from "express";

import { ForbiddenError } from "../../core/errors/index.js";
import { meetsLevel, type AccessLevel, type PageKey } from "../../core/permissions/pageKeys.js";
import { getDb } from "../../infrastructure/database/connection.js";
import type { Department } from "../../application/services/permissionService.js";

/**
 * Express middleware factory mirroring jdk_clean's
 * app/core/permissions.py:require_page_access. Must run after
 * requireAuth (needs req.user).
 */
export function requirePageAccess(pageKey: PageKey, level: AccessLevel = "read") {
  return async function (req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        throw new ForbiddenError();
      }

      if (user.role === "admin" || user.role === "manager") {
        next();
        return;
      }
      if (user.role === "viewer") {
        if (level === "read") {
          next();
          return;
        }
        throw new ForbiddenError();
      }

      // staff
      const db = getDb();
      const row = await db
        .selectFrom("department_permissions")
        .selectAll()
        .where("department", "=", (user.department ?? "sales") as Department)
        .where("page_key", "=", pageKey)
        .executeTakeFirst();

      const granted: AccessLevel = row?.access_level ?? "none";
      if (meetsLevel(granted, level)) {
        next();
        return;
      }
      throw new ForbiddenError();
    } catch (err) {
      next(err);
    }
  };
}
