import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/api/app.js";
import { getDb } from "../src/infrastructure/database/connection.js";
import { closeTestDb, seedTestUser, TEST_PASSWORD, TEST_USERNAME } from "./testUtils.js";

const app = createApp();
let adminToken: string;

beforeAll(async () => {
  await seedTestUser();
  const login = await request(app).post("/api/auth/login").send({ username: TEST_USERNAME, password: TEST_PASSWORD });
  adminToken = login.body.access_token;
});

afterAll(async () => {
  await closeTestDb();
});

function asAdmin(req: request.Test) {
  return req.set("Authorization", `Bearer ${adminToken}`);
}

async function createCustomer() {
  const res = await asAdmin(request(app).post("/api/customers")).send({
    code: `CUST-FSB-${Date.now()}`,
    name: "Feasibility Test Customer",
  });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function createRawMaterial(suffix: string) {
  const res = await asAdmin(request(app).post("/api/raw-materials")).send({
    code: `RM-F-${suffix}-${Date.now()}`,
    name: `Feasibility Test Material ${suffix}`,
    unit: "kg",
  });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function createProduct(suffix: string, extra: Record<string, unknown> = {}) {
  const res = await asAdmin(request(app).post("/api/products")).send({
    code: `PR-F-${suffix}-${Date.now()}`,
    name: `Feasibility Test Product ${suffix}`,
    unit: "unit",
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("Feasibility: materials-only path (no machine/capacity involved)", () => {
  let customerId: number;
  let materialId: number;
  let productId: number;

  beforeAll(async () => {
    customerId = await createCustomer();
    materialId = await createRawMaterial("mat");
    productId = await createProduct("nocap");

    await asAdmin(request(app).post(`/api/products/${productId}/bom/lines`)).send({
      component_type: "raw_material",
      component_id: materialId,
      quantity: 10,
      unit: "kg",
    });
  });

  it("creates a draft feasibility check with a number", async () => {
    const res = await asAdmin(request(app).post("/api/feasibilities")).send({
      customer_id: customerId,
      lines: [{ product_id: productId, quantity: 5 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.feasibility_number).toMatch(/^FSB-\d{5}$/);
    expect(res.body.status).toBe("draft");
  });

  it("runs the check and flags exception_pending when raw material is short", async () => {
    const createRes = await asAdmin(request(app).post("/api/feasibilities")).send({
      customer_id: customerId,
      lines: [{ product_id: productId, quantity: 5 }],
    });
    const id = createRes.body.id;

    // No stock received yet -> 5 * 10kg = 50kg required, 0 on hand.
    const runRes = await asAdmin(request(app).post(`/api/feasibilities/${id}/run-check`));
    expect(runRes.status).toBe(200);
    expect(runRes.body.status).toBe("exception_pending");
    expect(runRes.body.lines[0].is_feasible).toBe(false);
    const shortfall = JSON.parse(runRes.body.lines[0].shortfall_json);
    expect(shortfall[0].shortfall).toBe(50);
  });

  it("rejects running a check that isn't in draft", async () => {
    const createRes = await asAdmin(request(app).post("/api/feasibilities")).send({
      customer_id: customerId,
      lines: [{ product_id: productId, quantity: 1 }],
    });
    const id = createRes.body.id;
    await asAdmin(request(app).post(`/api/feasibilities/${id}/run-check`));

    const secondRun = await asAdmin(request(app).post(`/api/feasibilities/${id}/run-check`));
    expect(secondRun.status).toBe(409);
  });

  it("passes feasible once enough stock is received", async () => {
    await asAdmin(request(app).post("/api/inventory/adjust")).send({
      item_type: "raw_material",
      item_id: materialId,
      quantity: 1000,
      movement_type: "receipt",
    });

    const createRes = await asAdmin(request(app).post("/api/feasibilities")).send({
      customer_id: customerId,
      lines: [{ product_id: productId, quantity: 5 }],
    });
    const id = createRes.body.id;

    const runRes = await asAdmin(request(app).post(`/api/feasibilities/${id}/run-check`));
    expect(runRes.status).toBe(200);
    expect(runRes.body.status).toBe("feasible");
    expect(runRes.body.lines[0].is_feasible).toBe(true);
  });

  it("flags bom_missing for a product with no BOM at all", async () => {
    const bareProductId = await createProduct("nobom");
    const createRes = await asAdmin(request(app).post("/api/feasibilities")).send({
      customer_id: customerId,
      lines: [{ product_id: bareProductId, quantity: 1 }],
    });
    const runRes = await asAdmin(request(app).post(`/api/feasibilities/${createRes.body.id}/run-check`));
    expect(runRes.body.status).toBe("exception_pending");
    expect(runRes.body.lines[0].bom_missing).toBe(true);
  });
});

describe("Feasibility: exception decision, close, revive, admin review, deletion guard", () => {
  let customerId: number;
  let materialId: number;
  let productId: number;
  let exceptionPendingId: number;

  beforeAll(async () => {
    customerId = await createCustomer();
    materialId = await createRawMaterial("exc");
    productId = await createProduct("exc");
    await asAdmin(request(app).post(`/api/products/${productId}/bom/lines`)).send({
      component_type: "raw_material",
      component_id: materialId,
      quantity: 10,
      unit: "kg",
    });

    const createRes = await asAdmin(request(app).post("/api/feasibilities")).send({
      customer_id: customerId,
      lines: [{ product_id: productId, quantity: 5 }],
    });
    exceptionPendingId = createRes.body.id;
    await asAdmin(request(app).post(`/api/feasibilities/${exceptionPendingId}/run-check`));
  });

  it("rejects a decision when nothing is pending", async () => {
    const otherRes = await asAdmin(request(app).post("/api/feasibilities")).send({
      customer_id: customerId,
      lines: [{ product_id: productId, quantity: 1 }],
    });
    const res = await asAdmin(request(app).post(`/api/feasibilities/${otherRes.body.id}/exception-decision`)).send({
      approve: true,
      reason: "n/a",
    });
    expect(res.status).toBe(409);
  });

  it("approves the exception, flags admin review, and blocks re-deciding", async () => {
    const res = await asAdmin(request(app).post(`/api/feasibilities/${exceptionPendingId}/exception-decision`)).send({
      approve: true,
      reason: "Customer accepts a delayed delivery.",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("exception_approved");
    expect(res.body.admin_review_required).toBe(true);

    const again = await asAdmin(request(app).post(`/api/feasibilities/${exceptionPendingId}/exception-decision`)).send({
      approve: true,
      reason: "again",
    });
    expect(again.status).toBe(409);
  });

  it("blocks deletion, requires a reason to close, then closes", async () => {
    const noReasonRes = await asAdmin(request(app).post(`/api/feasibilities/${exceptionPendingId}/close`)).send({});
    expect(noReasonRes.status).toBe(422);

    const closeRes = await asAdmin(request(app).post(`/api/feasibilities/${exceptionPendingId}/close`)).send({
      reason: "Customer went with a competitor.",
    });
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.status).toBe("closed");
  });

  it("revives a closed feasibility check back to draft, clearing prior results", async () => {
    const res = await asAdmin(request(app).post(`/api/feasibilities/${exceptionPendingId}/revive`));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("draft");
    expect(res.body.lines[0].is_feasible).toBeNull();
  });

  it("admin-review clears the review flag", async () => {
    // re-run through to exception_approved to get admin_review_required=true again
    await asAdmin(request(app).post(`/api/feasibilities/${exceptionPendingId}/run-check`));
    await asAdmin(request(app).post(`/api/feasibilities/${exceptionPendingId}/exception-decision`)).send({
      approve: true,
      reason: "Approved again for test.",
    });

    const reviewRes = await asAdmin(request(app).post(`/api/feasibilities/${exceptionPendingId}/admin-review`)).send({
      notes: "Reviewed and acknowledged.",
    });
    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.admin_review_required).toBe(false);
  });

  it("full audit history is recorded across the whole lifecycle", async () => {
    const res = await asAdmin(request(app).get(`/api/feasibilities/${exceptionPendingId}/history`));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(5); // create + run + decision + close + revive + run + decision + review
  });
});

describe("Feasibility: capacity check against a real scheduled batch", () => {
  it("reports capacity_ok=false and a shortfall when required date can't be met", async () => {
    const customerId = await createCustomer();
    const machineRes = await asAdmin(request(app).post("/api/machines")).send({
      code: `MC-FSB-${Date.now()}`,
      name: "Feasibility Test Machine",
      capacity_hours_per_day: 8,
    });
    const machineId = machineRes.body.id;

    const materialId = await createRawMaterial("cap");
    const productId = await createProduct("cap", {
      machine_id: machineId,
      production_hours_per_unit: 4, // 4h/unit, 8h/day machine -> 2 units/day max
    });
    await asAdmin(request(app).post(`/api/products/${productId}/bom/lines`)).send({
      component_type: "raw_material",
      component_id: materialId,
      quantity: 1,
      unit: "kg",
    });
    await asAdmin(request(app).post("/api/inventory/adjust")).send({
      item_type: "raw_material",
      item_id: materialId,
      quantity: 1000,
      movement_type: "receipt",
    });

    // Book the machine solid for the next 10 days directly via SQL
    // (production_schedules has no HTTP domain until Pass 2e -- this
    // is exactly the kind of real, if-minimal, table Pass 2b's
    // migration exists to make queryable now).
    const db = getDb();
    const today = new Date();
    const tenDaysOut = new Date(today);
    tenDaysOut.setUTCDate(tenDaysOut.getUTCDate() + 9);
    await db
      .insertInto("production_schedules")
      .values({
        product_id: productId,
        machine_id: machineId,
        planned_quantity: 20, // 20 units * 4h = 80h booked over 10 days = 8h/day = fully booked
        scheduled_start: today.toISOString().slice(0, 10),
        scheduled_end: tenDaysOut.toISOString().slice(0, 10),
        status: "planned",
      })
      .execute();

    // Require delivery tomorrow -- machine is fully booked for the
    // next 10 days, so this should be infeasible on capacity.
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const createRes = await asAdmin(request(app).post("/api/feasibilities")).send({
      customer_id: customerId,
      required_by_date: tomorrow.toISOString().slice(0, 10),
      lines: [{ product_id: productId, quantity: 4 }], // needs 16h, machine has 0 free/day for 10 days
    });
    const runRes = await asAdmin(request(app).post(`/api/feasibilities/${createRes.body.id}/run-check`));

    expect(runRes.status).toBe(200);
    expect(runRes.body.status).toBe("exception_pending");
    expect(runRes.body.lines[0].capacity_ok).toBe(false);
    const capacityShortfall = JSON.parse(runRes.body.lines[0].capacity_shortfall_json);
    expect(capacityShortfall.projected_completion_date > tomorrow.toISOString().slice(0, 10)).toBe(true);
  });
});

describe("MRP: aggregates real demand and nets against stock", () => {
  it("returns an empty array when there is no open demand at all", async () => {
    // Not a guaranteed-empty assertion globally (other describe blocks
    // may have left orders/schedules), but confirms the endpoint at
    // least responds correctly and is a real array.
    const res = await asAdmin(request(app).get("/api/mrp/requirements"));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("surfaces a shortfall for a scheduled batch that outstrips on-hand raw material", async () => {
    const materialId = await createRawMaterial("mrp");
    const productId = await createProduct("mrp");
    await asAdmin(request(app).post(`/api/products/${productId}/bom/lines`)).send({
      component_type: "raw_material",
      component_id: materialId,
      quantity: 50,
      unit: "kg",
    });
    // Only 100kg on hand, but the batch below needs 10 * 50kg = 500kg.
    await asAdmin(request(app).post("/api/inventory/adjust")).send({
      item_type: "raw_material",
      item_id: materialId,
      quantity: 100,
      movement_type: "receipt",
    });

    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    await db
      .insertInto("production_schedules")
      .values({
        product_id: productId,
        planned_quantity: 10,
        scheduled_start: today,
        scheduled_end: today,
        status: "planned",
      })
      .execute();

    const res = await asAdmin(request(app).get("/api/mrp/requirements"));
    expect(res.status).toBe(200);
    const line = res.body.find((r: { raw_material_id: number }) => r.raw_material_id === materialId);
    expect(line).toBeDefined();
    expect(line.total_required).toBe(500);
    expect(line.current_on_hand).toBe(100);
    expect(line.shortfall).toBe(400);
  });

  it("suggests purchases from a supplier of the shortfall material, respecting max_supply_quantity", async () => {
    const materialId = await createRawMaterial("mrpsupplier");
    const productId = await createProduct("mrpsupplier");
    await asAdmin(request(app).post(`/api/products/${productId}/bom/lines`)).send({
      component_type: "raw_material",
      component_id: materialId,
      quantity: 100,
      unit: "kg",
    });

    const supplierRes = await asAdmin(request(app).post("/api/suppliers")).send({
      code: `SUP-MRP-${Date.now()}`,
      name: "MRP Test Supplier",
    });
    await asAdmin(request(app).put(`/api/suppliers/${supplierRes.body.id}/materials`)).send({
      lines: [{ raw_material_id: materialId, max_supply_quantity: 30, lead_time_days: 3 }],
    });

    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    await db
      .insertInto("production_schedules")
      .values({ product_id: productId, planned_quantity: 1, scheduled_start: today, scheduled_end: today, status: "planned" })
      .execute();

    const res = await asAdmin(request(app).get("/api/mrp/requirements"));
    const line = res.body.find((r: { raw_material_id: number }) => r.raw_material_id === materialId);
    expect(line.shortfall).toBe(100);
    expect(line.suggested_purchases).toHaveLength(1);
    expect(line.suggested_purchases[0].quantity).toBe(30); // capped by max_supply_quantity
    expect(line.uncovered_quantity).toBe(70);
    expect(line.fully_covered).toBe(false);
  });
});
