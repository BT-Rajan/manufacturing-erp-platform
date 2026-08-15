/**
 * Vacant-slot capacity scanning: given a machine's (or the factory's
 * shared worker pool's) daily capacity and what's already booked
 * against it, find the first day enough free time has accumulated to
 * cover a required number of hours. Ported from jdk_clean's
 * capacity_service.py.
 */

export const BOOKED_PRODUCTION_STATUSES = ["planned", "in_progress"] as const;

/** How far forward a scan looks before giving up and reporting "not
 * achievable in the foreseeable future" rather than scanning forever. */
const MAX_SCAN_DAYS = 365;

export interface ScheduleBatch {
  scheduled_start: string; // YYYY-MM-DD
  scheduled_end: string; // YYYY-MM-DD
  planned_quantity: number;
  product_production_hours_per_unit: number | null;
  product_workers_required: number | null;
}

function toDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}
function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

/** Spreads each batch's total required hours evenly across the days
 * it's scheduled over, so a 5-day batch doesn't count as fully
 * consuming capacity on every one of those days at once. */
export function dailyBookedHours(
  batches: ScheduleBatch[],
  hoursField: "machine" | "workers" = "machine",
): Map<string, number> {
  const daily = new Map<string, number>();

  for (const batch of batches) {
    if (batch.product_production_hours_per_unit === null) continue;
    const start = toDate(batch.scheduled_start);
    const end = toDate(batch.scheduled_end);
    const spanDays = diffDays(end, start) + 1;
    if (spanDays <= 0) continue;

    let batchHours = batch.planned_quantity * batch.product_production_hours_per_unit;
    if (hoursField === "workers") {
      if (!batch.product_workers_required) continue;
      batchHours *= batch.product_workers_required;
    }
    const perDay = batchHours / spanDays;

    for (let i = 0; i < spanDays; i++) {
      const key = toIso(addDays(start, i));
      daily.set(key, (daily.get(key) ?? 0) + perDay);
    }
  }
  return daily;
}

/** Scans forward day by day from `today`, accumulating free capacity,
 * and returns the first ISO date by which enough cumulative free time
 * has opened up to cover `requiredHours`. Null if not achievable
 * within MAX_SCAN_DAYS. */
export function findVacantSlotCompletion(
  dailyCapacity: number,
  dailyBooked: Map<string, number>,
  requiredHours: number,
  today: string,
): string | null {
  if (requiredHours <= 0) return today;

  let cumulativeFree = 0;
  let d = toDate(today);
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    const key = toIso(d);
    const freeToday = Math.max(dailyCapacity - (dailyBooked.get(key) ?? 0), 0);
    cumulativeFree += freeToday;
    if (cumulativeFree >= requiredHours) return key;
    d = addDays(d, 1);
  }
  return null;
}
