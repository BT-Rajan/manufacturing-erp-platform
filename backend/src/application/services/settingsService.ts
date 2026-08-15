import { getDb } from "../../infrastructure/database/connection.js";

export async function getAll(): Promise<Record<string, string>> {
  const db = getDb();
  const rows = await db.selectFrom("settings").select(["setting_key", "setting_value"]).execute();
  return Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value ?? ""]));
}

export async function update(values: Record<string, string>, performedBy: number | null): Promise<Record<string, string>> {
  const db = getDb();
  for (const [key, value] of Object.entries(values)) {
    const existing = await db.selectFrom("settings").select("id").where("setting_key", "=", key).executeTakeFirst();
    if (existing) {
      await db.updateTable("settings").set({ setting_value: value }).where("id", "=", existing.id).execute();
    } else {
      await db.insertInto("settings").values({ setting_key: key, setting_value: value }).execute();
    }
  }
  void performedBy; // no per-setting audit trail yet -- see docs/PARITY_CHECKLIST.md
  return getAll();
}

/** (totalWorkers, workdayHours) for feasibility's capacity scan.
 * Unset/unparseable values default to (0, 8.0) -- 0 workers means the
 * worker-hours side of the capacity check is simply skipped (same
 * "not evaluable" treatment as a product with no machine/formula
 * set), rather than erroring. */
export async function getFactoryLaborPool(): Promise<{ totalWorkers: number; workdayHours: number }> {
  const values = await getAll();
  const totalWorkers = Number.parseInt(values["factory_total_workers"] ?? "", 10);
  const workdayHours = Number.parseFloat(values["factory_workday_hours"] ?? "");
  return {
    totalWorkers: Number.isFinite(totalWorkers) ? Math.max(totalWorkers, 0) : 0,
    workdayHours: Number.isFinite(workdayHours) ? Math.max(workdayHours, 0) : 8.0,
  };
}
