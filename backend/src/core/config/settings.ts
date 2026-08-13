/**
 * Single source of configuration. No module outside this file reads
 * process.env directly -- see docs/ARCHITECTURE.md rule 16
 * (configuration is centralized).
 *
 * BRAND_* fields here are bootstrap-only defaults used to seed the
 * tenant on first boot. From Pass 4 (admin configuration surface)
 * onward, the values an admin actually edits live in MySQL via the
 * settings domain and are read at runtime -- these env fields never
 * gate a redeploy for a branding change.
 */

import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface Settings {
  appName: string;
  env: "development" | "test" | "production";
  port: number;

  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };

  jwt: {
    secret: string;
    accessTokenExpireMinutes: number;
  };

  corsOrigins: string[];

  branding: {
    name: string;
    logoUrl: string;
    primaryColor: string;
  };
}

let cached: Settings | undefined;

export function getSettings(): Settings {
  if (cached) return cached;

  cached = {
    appName: process.env.APP_NAME ?? "Manufacturing ERP Platform",
    env: (process.env.NODE_ENV as Settings["env"]) ?? "development",
    port: Number(process.env.PORT ?? 8000),

    db: {
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 3306),
      user: required("DB_USER", "erp_user"),
      password: required("DB_PASSWORD", "erp_pass"),
      database: required("DB_NAME", "erp_platform"),
    },

    jwt: {
      secret: process.env.JWT_SECRET_KEY ?? "change-me-in-env",
      accessTokenExpireMinutes: Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES ?? 60),
    },

    corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),

    branding: {
      name: process.env.BRAND_NAME ?? "Manufacturing ERP",
      logoUrl: process.env.BRAND_LOGO_URL ?? "",
      primaryColor: process.env.BRAND_PRIMARY_COLOR ?? "#1f2937",
    },
  };

  return cached;
}

/** Test-only: forces settings to be re-read from process.env. */
export function resetSettingsCache(): void {
  cached = undefined;
}
