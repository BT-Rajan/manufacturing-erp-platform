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

export async function isAutoCreateQuotationEnabled(): Promise<boolean> {
  const values = await getAll();
  const raw = (values["auto_create_quotation_from_feasibility"] ?? "true").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export async function getDefaultTaxRate(): Promise<number> {
  const values = await getAll();
  const parsed = Number.parseFloat(values["default_tax_rate"] ?? "0");
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

/** null means the large-discount approval gate is off -- admin hasn't
 * set a threshold. A set value of 0 would gate everything, presumably
 * never intended, so an empty/unparseable setting is treated the same
 * as "off" rather than "gate at zero". */
export async function getLargeDiscountApprovalThreshold(): Promise<number | null> {
  const values = await getAll();
  const raw = (values["large_discount_approval_threshold"] ?? "").trim();
  if (!raw) return null;
  const threshold = Number.parseFloat(raw);
  if (!Number.isFinite(threshold)) return null;
  return threshold > 0 ? threshold : null;
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
