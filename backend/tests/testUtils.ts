import { hashPassword } from "../src/core/security/security.js";
import { getDb, resetDbConnection } from "../src/infrastructure/database/connection.js";

export const TEST_USERNAME = "pass0admin";
export const TEST_PASSWORD = "Pass0Test!";

export async function seedTestUser(): Promise<void> {
  const db = getDb();
  const existing = await db
    .selectFrom("users")
    .selectAll()
    .where("username", "=", TEST_USERNAME)
    .executeTakeFirst();

  if (existing) return;

  await db
    .insertInto("users")
    .values({
      username: TEST_USERNAME,
      email: "pass0admin@example.com",
      password_hash: await hashPassword(TEST_PASSWORD),
      full_name: "Pass 0 Admin",
      role: "admin",
      is_active: true,
    })
    .execute();
}

export async function closeTestDb(): Promise<void> {
  await resetDbConnection();
}
