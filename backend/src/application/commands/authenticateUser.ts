import { AuthError } from "../../core/errors/index.js";
import { createAccessToken, verifyPassword } from "../../core/security/security.js";
import { getDb } from "../../infrastructure/database/connection.js";
import { record } from "../services/auditService.js";

export interface AuthenticateResult {
  accessToken: string;
  tokenType: "bearer";
}

export async function authenticate(username: string, password: string): Promise<AuthenticateResult> {
  const db = getDb();
  const user = await db.selectFrom("users").selectAll().where("username", "=", username).executeTakeFirst();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new AuthError("Invalid username or password.");
  }
  if (!user.is_active) {
    throw new AuthError("This account has been deactivated.");
  }

  const accessToken = createAccessToken({ sub: String(user.id), role: user.role });

  await record({
    entityType: "user",
    entityId: user.id,
    action: "login",
    performedBy: user.id,
  });

  return { accessToken, tokenType: "bearer" };
}
