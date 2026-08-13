import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/api/app.js";
import { getDb } from "../src/infrastructure/database/connection.js";
import { closeTestDb, seedTestUser, TEST_PASSWORD, TEST_USERNAME } from "./testUtils.js";

const app = createApp();

beforeAll(async () => {
  await seedTestUser();
});

afterAll(async () => {
  await closeTestDb();
});

describe("Pass 0 foundation", () => {
  it("health check reports ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("rejects a protected route with no token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("auth_error");
  });

  it("rejects a bad login with the consistent error model", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: TEST_USERNAME, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("auth_error");
  });

  it("logs in, reaches a protected route, and provably writes+reads an audit entry", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD });
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.access_token as string;
    expect(typeof token).toBe("string");

    const meRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.username).toBe(TEST_USERNAME);

    // Query the audit trail directly -- proves the write actually
    // landed in MySQL and is queryable, not just returned by the API.
    const db = getDb();
    const user = await db.selectFrom("users").selectAll().where("username", "=", TEST_USERNAME).executeTakeFirstOrThrow();
    const auditRows = await db
      .selectFrom("audit_log")
      .selectAll()
      .where("entity_type", "=", "user")
      .where("entity_id", "=", String(user.id))
      .where("action", "=", "login")
      .execute();

    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[auditRows.length - 1]?.performed_by).toBe(user.id);
  });
});
