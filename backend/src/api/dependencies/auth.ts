import type { NextFunction, Request, Response } from "express";

import { AuthError, ForbiddenError } from "../../core/errors/index.js";
import { decodeAccessToken } from "../../core/security/security.js";
import { getDb } from "../../infrastructure/database/connection.js";

export interface AuthenticatedUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: "admin" | "manager" | "staff" | "viewer";
  department: "sales" | "procurement" | "warehouse" | null;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new AuthError("Missing or invalid Authorization header.");
    }

    const token = header.slice("Bearer ".length);
    let claims;
    try {
      claims = decodeAccessToken(token);
    } catch (err) {
      throw new AuthError(err instanceof Error ? err.message : "Invalid token.");
    }

    const db = getDb();
    const row = await db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", Number(claims.sub))
      .where("deleted_at", "is", null)
      .executeTakeFirst();

    if (!row || !row.is_active) {
      throw new AuthError("Account is no longer active.");
    }

    req.user = {
      id: row.id,
      username: row.username,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      department: row.department,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Restricts a route to specific roles -- mirrors jdk_clean's require_role. */
export function requireRole(...allowedRoles: AuthenticatedUser["role"][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}
