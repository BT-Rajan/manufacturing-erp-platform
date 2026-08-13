import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { getSettings } from "../config/settings.js";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export interface AccessTokenClaims {
  sub: string;
  role: string;
}

export function createAccessToken(claims: AccessTokenClaims): string {
  const settings = getSettings();
  return jwt.sign({ ...claims, type: "access" }, settings.jwt.secret, {
    expiresIn: `${settings.jwt.accessTokenExpireMinutes}m`,
  });
}

export function decodeAccessToken(token: string): AccessTokenClaims {
  const settings = getSettings();
  try {
    return jwt.verify(token, settings.jwt.secret) as unknown as AccessTokenClaims;
  } catch {
    throw new Error("Invalid or expired token.");
  }
}
