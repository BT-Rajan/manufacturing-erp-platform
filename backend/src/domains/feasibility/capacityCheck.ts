import * as capacityService from "../../application/services/capacityService.js";
import { getFactoryLaborPool } from "../../application/services/settingsService.js";
import { getDb } from "../../infrastructure/database/connection.js";
import * as machinesRepository from "../machines/repository.js";

/** mysql2 returns DATE columns as JS Date objects, not strings,
 * despite schema.ts declaring them ColumnType<string, string, string>
 * -- normalize here rather than widening that type everywhere, since
 * capacityService's date math is deliberately string-based (YYYY-MM-DD
 * comparisons sort correctly as plain strings, no timezone footguns). */
function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export interface CapacityShortfall {
  machine: string;
  required_hours: number;
  projected_completion_date: string | null;
  shortfall_days: number | null;
  workers_required: number | null;
  required_worker_hours: number | null;
}

export interface CapacityResult {
  capacityOk: boolean | null;
  shortfall: CapacityShortfall | null;
}

/** Machine-availability + time-required (+ labor) check for one line:
 * scans forward from today for the first vacant slot -- on the
 * product's machine, and in the factory's shared worker pool -- with
 * enough free capacity to produce `quantity` units, net of what's
 * already booked in production_schedules. capacityOk is true only if
 * that projected completion date is on or before requiredByDate.
 * Returns capacityOk=null ("not evaluable") when the product has no
 * machine/time formula, or there's no requiredByDate to measure
 * against. */
export async function checkCapacity(
  product: { machine_id: number | null; production_hours_per_unit: string | null; workers_required: number | null },
  quantity: number,
  requiredByDate: string | null,
  today: string,
): Promise<CapacityResult> {
  if (product.machine_id === null || product.production_hours_per_unit === null) {
    return { capacityOk: null, shortfall: null };
  }
  if (requiredByDate === null) {
    return { capacityOk: null, shortfall: null };
  }

  const machine = await machinesRepository.findById(product.machine_id);
  if (!machine) {
    return { capacityOk: null, shortfall: null };
  }

  const requiredHours = Math.round(quantity * Number(product.production_hours_per_unit) * 10000) / 10000;
  // Kysely's typed where() needs a Date to compare against a DATE
  // column (see schema.ts) -- `today` itself stays a string since
  // capacityService's scan math is deliberately string-based.
  const todayAsDate = new Date(`${today}T00:00:00.000Z`);

  const db = getDb();
  const machineBatches = await db
    .selectFrom("production_schedules")
    .innerJoin("products", "products.id", "production_schedules.product_id")
    .select([
      "production_schedules.scheduled_start",
      "production_schedules.scheduled_end",
      "production_schedules.planned_quantity",
      "products.production_hours_per_unit as product_production_hours_per_unit",
      "products.workers_required as product_workers_required",
    ])
    .where("production_schedules.machine_id", "=", machine.id)
    .where("production_schedules.deleted_at", "is", null)
    .where("production_schedules.status", "in", [...capacityService.BOOKED_PRODUCTION_STATUSES])
    .where("production_schedules.scheduled_end", ">=", todayAsDate)
    .execute();

  const machineDailyBooked = capacityService.dailyBookedHours(
    machineBatches.map((b) => ({
      scheduled_start: toIsoDate(b.scheduled_start),
      scheduled_end: toIsoDate(b.scheduled_end),
      planned_quantity: Number(b.planned_quantity),
      product_production_hours_per_unit: b.product_production_hours_per_unit ? Number(b.product_production_hours_per_unit) : null,
      product_workers_required: b.product_workers_required,
    })),
    "machine",
  );
  const machineCompletion = capacityService.findVacantSlotCompletion(
    Number(machine.capacity_hours_per_day),
    machineDailyBooked,
    requiredHours,
    today,
  );

  // Worker slot: every batch factory-wide competes for the shared
  // pool, not just this machine's -- workers move between machines.
  let workerCompletion: string | null = today;
  const workersRequired = product.workers_required;
  let requiredWorkerHours: number | null = null;
  const { totalWorkers, workdayHours } = await getFactoryLaborPool();

  if (workersRequired && totalWorkers > 0) {
    requiredWorkerHours = Math.round(requiredHours * workersRequired * 10000) / 10000;
    const workerBatches = await db
      .selectFrom("production_schedules")
      .innerJoin("products", "products.id", "production_schedules.product_id")
      .select([
        "production_schedules.scheduled_start",
        "production_schedules.scheduled_end",
        "production_schedules.planned_quantity",
        "products.production_hours_per_unit as product_production_hours_per_unit",
        "products.workers_required as product_workers_required",
      ])
      .where("production_schedules.deleted_at", "is", null)
      .where("production_schedules.status", "in", [...capacityService.BOOKED_PRODUCTION_STATUSES])
      .where("production_schedules.scheduled_end", ">=", todayAsDate)
      .execute();

    const workerDailyBooked = capacityService.dailyBookedHours(
      workerBatches.map((b) => ({
        scheduled_start: toIsoDate(b.scheduled_start),
        scheduled_end: toIsoDate(b.scheduled_end),
        planned_quantity: Number(b.planned_quantity),
        product_production_hours_per_unit: b.product_production_hours_per_unit ? Number(b.product_production_hours_per_unit) : null,
        product_workers_required: b.product_workers_required,
      })),
      "workers",
    );
    workerCompletion = capacityService.findVacantSlotCompletion(
      totalWorkers * workdayHours,
      workerDailyBooked,
      requiredWorkerHours,
      today,
    );
  } else if (workersRequired && totalWorkers === 0) {
    // Workers required by the formula but no factory-wide pool
    // configured -- can't evaluate that half of the check, so don't
    // silently pass it.
    workerCompletion = null;
  }

  const projectedCompletion =
    machineCompletion === null || workerCompletion === null
      ? null
      : machineCompletion > workerCompletion
        ? machineCompletion
        : workerCompletion;

  const capacityOk = projectedCompletion !== null && projectedCompletion <= requiredByDate;
  if (capacityOk) return { capacityOk: true, shortfall: null };

  const shortfallDays =
    projectedCompletion !== null
      ? Math.round(
          (new Date(`${projectedCompletion}T00:00:00.000Z`).getTime() -
            new Date(`${requiredByDate}T00:00:00.000Z`).getTime()) /
            (24 * 60 * 60 * 1000),
        )
      : null;

  return {
    capacityOk: false,
    shortfall: {
      machine: `${machine.code} — ${machine.name}`,
      required_hours: requiredHours,
      projected_completion_date: projectedCompletion,
      shortfall_days: shortfallDays,
      workers_required: workersRequired,
      required_worker_hours: requiredWorkerHours,
    },
  };
}
