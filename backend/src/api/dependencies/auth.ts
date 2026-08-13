import type { NextFunction, Request, Response } from "express";

import { AuthError } from "../../core/errors/index.js";
import { decodeAccessToken } from "../../core/security/security.js";
import { getDb } from "../../infrastructure/database/connection.js";

export interface AuthenticatedUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: string;
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
      .executeTakeFirst();

    if (!row || !row.is_active) {
      throw new AuthError("User not found or inactive.");
    }

    req.user = {
      id: row.id,
      username: row.username,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
    };
    next();
  } catch (err) {
    next(err);
  }
}
