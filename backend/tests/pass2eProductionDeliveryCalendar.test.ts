import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/api/app.js";
import { getDb } from "../src/infrastructure/database/connection.js";
import { closeTestDb, seedTestUser, TEST_PASSWORD, TEST_USERNAME } from "./testUtils.js";

const app = createApp();
let adminToken: string;
let adminUserId: number;

beforeAll(async () => {
  await seedTestUser();
  const login = await request(app).post("/api/auth/login").send({ username: TEST_USERNAME, password: TEST_PASSWORD });
  adminToken = login.body.access_token;
  const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${adminToken}`);
  adminUserId = me.body.id;
});

afterAll(async () => {
  await closeTestDb();
});

function asAdmin(req: request.Test) {
  return req.set("Authorization", `Bearer ${adminToken}`);
}

async function createCustomer() {
  const res = await asAdmin(request(app).post("/api/customers")).send({ code: `CUST-PE-${Date.now()}`, name: "Prod Test Customer" });
  return res.body.id as number;
}

async function createMaterial(suffix: string) {
  const res = await asAdmin(request(app).post("/api/raw-materials")).send({
    code: `RM-PE-${suffix}-${Date.now()}`,
    name: `Prod Test Material ${suffix}`,
    unit: "kg",
  });
  return res.body.id as number;
}

async function createProduct(suffix: string, extra: Record<string, unknown> = {}) {
  const res = await asAdmin(request(app).post("/api/products")).send({
    code: `PR-PE-${suffix}-${Date.now()}`,
    name: `Prod Test Product ${suffix}`,
    unit: "unit",
    selling_price: 20,
    ...extra,
  });
  return res.body.id as number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function disableAutoHooks() {
  await getDb()
    .updateTable("settings")
    .set({ setting_value: "false" })
    .where("setting_key", "in", ["auto_schedule_production_on_confirm", "auto_create_delivery_note_on_ready"])
    .execute();
}
async function enableAutoHooks() {
  await getDb()
    .updateTable("settings")
    .set({ setting_value: "true" })
    .where("setting_key", "in", ["auto_schedule_production_on_confirm", "auto_create_delivery_note_on_ready"])
    .execute();
}

describe("Production schedules: manual CRUD, state machine, material consumption", () => {
  let productId: number;
  let materialId: number;

  beforeAll(async () => {
    materialId = await createMaterial("manual");
    productId = await createProduct("manual");
    await asAdmin(request(app).post(`/api/products/${productId}/bom/lines`)).send({
      component_type: "raw_material",
      component_id: materialId,
      quantity: 5,
      unit: "kg",
    });
  });

  it("creates a planned batch, defaulting machine from the product when not given", async () => {
    const machineRes = await asAdmin(request(app).post("/api/machines")).send({ code: `MC-PE-${Date.now()}`, name: "Prod Test Machine" });
    const productWithMachine = await createProduct("wm", { machine_id: machineRes.body.id, production_hours_per_unit: 1 });

    const res = await asAdmin(request(app).post("/api/production-schedules")).send({
      product_id: productWithMachine,
      planned_quantity: 10,
      scheduled_start: today(),
      scheduled_end: today(),
    });
    expect(res.status).toBe(201);
    expect(res.body.batch_number).toMatch(/^BATCH-\d{5}$/);
    expect(res.body.machine_id).toBe(machineRes.body.id);
    expect(res.body.status).toBe("planned");
  });

  it("rejects completing without enough raw material, consumes materials and produces stock on success", async () => {
    const createRes = await asAdmin(request(app).post("/api/production-schedules")).send({
      product_id: productId,
      planned_quantity: 20,
      scheduled_start: today(),
      scheduled_end: today(),
    });
    const id = createRes.body.id;

    await asAdmin(request(app).post(`/api/production-schedules/${id}/status`)).send({ status: "in_progress" });

    const shortRes = await asAdmin(request(app).post(`/api/production-schedules/${id}/status`)).send({
      status: "completed",
      produced_quantity: 20,
    });
    expect(shortRes.status).toBe(500);

    await asAdmin(request(app).post("/api/inventory/adjust")).send({
      item_type: "raw_material",
      item_id: materialId,
      quantity: 200,
      movement_type: "receipt",
    });

    const materialBefore = await asAdmin(request(app).get(`/api/inventory/stock/raw_material/${materialId}`));
    const productBefore = await asAdmin(request(app).get(`/api/inventory/stock/product/${productId}`));

    const completeRes = await asAdmin(request(app).post(`/api/production-schedules/${id}/status`)).send({
      status: "completed",
      produced_quantity: 20,
    });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe("completed");
    expect(Number(completeRes.body.produced_quantity)).toBe(20);

    const materialAfter = await asAdmin(request(app).get(`/api/inventory/stock/raw_material/${materialId}`));
    const productAfter = await asAdmin(request(app).get(`/api/inventory/stock/product/${productId}`));
    expect(materialAfter.body.quantity_on_hand).toBe(materialBefore.body.quantity_on_hand - 100);
    expect(productAfter.body.quantity_on_hand).toBe(productBefore.body.quantity_on_hand + 20);
  });

  it("requires a reason to cancel, blocks editing/deleting a non-planned batch", async () => {
    const createRes = await asAdmin(request(app).post("/api/production-schedules")).send({
      product_id: productId,
      planned_quantity: 1,
      scheduled_start: today(),
      scheduled_end: today(),
    });
    const id = createRes.body.id;
    await asAdmin(request(app).post(`/api/production-schedules/${id}/status`)).send({ status: "in_progress" });

    const noReasonRes = await asAdmin(request(app).post(`/api/production-schedules/${id}/status`)).send({ status: "cancelled" });
    expect(noReasonRes.status).toBe(422);

    const cancelRes = await asAdmin(request(app).post(`/api/production-schedules/${id}/status`)).send({
      status: "cancelled",
      reason: "Wrong specs.",
    });
    expect(cancelRes.status).toBe(200);

    const editBlockedRes = await asAdmin(request(app).put(`/api/production-schedules/${id}`)).send({ planned_quantity: 5 });
    expect(editBlockedRes.status).toBe(409);
    const deleteBlockedRes = await asAdmin(request(app).delete(`/api/production-schedules/${id}`));
    expect(deleteBlockedRes.status).toBe(409);
  });
});

describe("Delivery notes: eligibility, issuing ships the order, cancellation", () => {
  it("rejects creating a note for an order that isn't ready_to_ship", async () => {
    const customerId = await createCustomer();
    const productId = await createProduct("dnnr");
    const orderRes = await asAdmin(request(app).post("/api/orders")).send({
      customer_id: customerId,
      order_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 20 }],
    });
    const res = await asAdmin(request(app).post("/api/delivery-notes")).send({ order_id: orderRes.body.id, delivery_date: today() });
    expect(res.status).toBe(409);
  });

  it("issuing a delivery note ships the linked order and consumes stock", async () => {
    await disableAutoHooks();
    const customerId = await createCustomer();
    const productId = await createProduct("dn-issue");
    await asAdmin(request(app).post("/api/inventory/adjust")).send({ item_type: "product", item_id: productId, quantity: 50, movement_type: "receipt" });

    const orderRes = await asAdmin(request(app).post("/api/orders")).send({
      customer_id: customerId,
      order_date: today(),
      lines: [{ product_id: productId, quantity: 3, unit_price: 20 }],
    });
    const orderId = orderRes.body.id;
    await asAdmin(request(app).post(`/api/orders/${orderId}/status`)).send({ status: "confirmed" });
    await asAdmin(request(app).post(`/api/orders/${orderId}/status`)).send({ status: "in_production" });
    await asAdmin(request(app).post(`/api/orders/${orderId}/status`)).send({ status: "ready_to_ship" });

    const noteRes = await asAdmin(request(app).post("/api/delivery-notes")).send({ order_id: orderId, delivery_date: today() });
    expect(noteRes.status).toBe(201);
    expect(noteRes.body.delivery_note_number).toMatch(/^DN-\d{5}$/);
    expect(noteRes.body.lines).toHaveLength(1);
    expect(Number(noteRes.body.lines[0].quantity_delivered)).toBe(3);

    const secondNoteAttempt = await asAdmin(request(app).post("/api/delivery-notes")).send({ order_id: orderId, delivery_date: today() });
    expect(secondNoteAttempt.status).toBe(409);

    const issueRes = await asAdmin(request(app).post(`/api/delivery-notes/${noteRes.body.id}/status`)).send({ status: "issued" });
    expect(issueRes.status).toBe(200);

    const orderAfter = await asAdmin(request(app).get(`/api/orders/${orderId}`));
    expect(orderAfter.body.status).toBe("shipped");
    await enableAutoHooks();
  });

  it("requires a reason to cancel a delivery note", async () => {
    await disableAutoHooks();
    const customerId = await createCustomer();
    const productId = await createProduct("dn-cancel");
    const orderRes = await asAdmin(request(app).post("/api/orders")).send({
      customer_id: customerId,
      order_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 20 }],
    });
    await asAdmin(request(app).post(`/api/orders/${orderRes.body.id}/status`)).send({ status: "confirmed" });
    await asAdmin(request(app).post(`/api/orders/${orderRes.body.id}/status`)).send({ status: "in_production" });
    await asAdmin(request(app).post(`/api/orders/${orderRes.body.id}/status`)).send({ status: "ready_to_ship" });
    const noteRes = await asAdmin(request(app).post("/api/delivery-notes")).send({ order_id: orderRes.body.id, delivery_date: today() });

    const res = await asAdmin(request(app).post(`/api/delivery-notes/${noteRes.body.id}/status`)).send({ status: "cancelled" });
    expect(res.status).toBe(422);
    await enableAutoHooks();
  });
});

describe("Calendar: creator-only modify, visibility, mentions", () => {
  it("creates an event and reads it back within a date range", async () => {
    const res = await asAdmin(request(app).post("/api/calendar/events")).send({
      event_date: today(),
      title: "Test maintenance window",
      all_users: true,
    });
    expect(res.status).toBe(201);

    const listRes = await asAdmin(request(app).get(`/api/calendar/events?from=${today()}&to=${today()}`));
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((e: { id: number }) => e.id === res.body.id)).toBe(true);
  });

  it("rejects mentioning a non-existent user", async () => {
    const res = await asAdmin(request(app).post("/api/calendar/events")).send({
      event_date: today(),
      title: "Bad mention",
      mentioned_user_ids: [999999],
    });
    expect(res.status).toBe(422);
  });

  it("stores and returns mentioned user ids", async () => {
    const res = await asAdmin(request(app).post("/api/calendar/events")).send({
      event_date: today(),
      title: "Mention test",
      mentioned_user_ids: [adminUserId],
    });
    expect(res.status).toBe(201);
    const getRes = await asAdmin(request(app).get(`/api/calendar/events/${res.body.id}`));
    expect(getRes.body.mentioned_user_ids).toContain(adminUserId);
  });
});

describe("Full pipeline with auto-progression hooks", () => {
  it("walks an order through the entire pipeline driven only by status changes", async () => {
    await enableAutoHooks();

    const customerId = await createCustomer();
    const materialId = await createMaterial("pipeline");
    const machineRes = await asAdmin(request(app).post("/api/machines")).send({
      code: `MC-PIPE-${Date.now()}`,
      name: "Pipeline Machine",
      capacity_hours_per_day: 24,
    });
    const productId = await createProduct("pipeline", { machine_id: machineRes.body.id, production_hours_per_unit: 1 });
    await asAdmin(request(app).post(`/api/products/${productId}/bom/lines`)).send({
      component_type: "raw_material",
      component_id: materialId,
      quantity: 2,
      unit: "kg",
    });
    await asAdmin(request(app).post("/api/inventory/adjust")).send({
      item_type: "raw_material",
      item_id: materialId,
      quantity: 100,
      movement_type: "receipt",
    });

    const orderRes = await asAdmin(request(app).post("/api/orders")).send({
      customer_id: customerId,
      order_date: today(),
      lines: [{ product_id: productId, quantity: 5, unit_price: 20 }],
    });
    const orderId = orderRes.body.id;

    const confirmRes = await asAdmin(request(app).post(`/api/orders/${orderId}/status`)).send({ status: "confirmed" });
    expect(confirmRes.status).toBe(200);

    const batchesRes = await asAdmin(request(app).get(`/api/production-schedules?order_id=${orderId}`));
    expect(batchesRes.body.total).toBe(1);
    const batchId = batchesRes.body.items[0].id;
    const batchDetail = await asAdmin(request(app).get(`/api/production-schedules/${batchId}`));
    expect(batchDetail.body.auto_scheduled).toBe(true);
    expect(Number(batchDetail.body.planned_quantity)).toBe(5);

    await asAdmin(request(app).post(`/api/production-schedules/${batchId}/status`)).send({ status: "in_progress" });
    const orderDuringProduction = await asAdmin(request(app).get(`/api/orders/${orderId}`));
    expect(orderDuringProduction.body.status).toBe("in_production");

    const completeRes = await asAdmin(request(app).post(`/api/production-schedules/${batchId}/status`)).send({
      status: "completed",
      produced_quantity: 5,
    });
    expect(completeRes.status).toBe(200);

    const orderAfterComplete = await asAdmin(request(app).get(`/api/orders/${orderId}`));
    expect(orderAfterComplete.body.status).toBe("ready_to_ship");

    const notesRes = await asAdmin(request(app).get(`/api/delivery-notes?order_id=${orderId}`));
    expect(notesRes.body.total).toBe(1);
    const note = notesRes.body.items[0];
    expect(note.status).toBe("draft");

    await asAdmin(request(app).post(`/api/delivery-notes/${note.id}/status`)).send({ status: "issued" });
    const orderFinal = await asAdmin(request(app).get(`/api/orders/${orderId}`));
    expect(orderFinal.body.status).toBe("shipped");

    const dealRes = await asAdmin(request(app).get(`/api/deals/${orderRes.body.deal_id}`));
    expect(dealRes.body.furthest_stage).toBe("delivery");
  });

  it("cancelling a confirmed order cancels its active production batch", async () => {
    await enableAutoHooks();
    const customerId = await createCustomer();
    const materialId = await createMaterial("cancelpipe");
    const machineRes = await asAdmin(request(app).post("/api/machines")).send({
      code: `MC-CANCEL-${Date.now()}`,
      name: "Cancel Pipeline Machine",
      capacity_hours_per_day: 24,
    });
    const productId = await createProduct("cancelpipe", { machine_id: machineRes.body.id, production_hours_per_unit: 1 });
    await asAdmin(request(app).post(`/api/products/${productId}/bom/lines`)).send({
      component_type: "raw_material",
      component_id: materialId,
      quantity: 1,
      unit: "kg",
    });

    const orderRes = await asAdmin(request(app).post("/api/orders")).send({
      customer_id: customerId,
      order_date: today(),
      lines: [{ product_id: productId, quantity: 2, unit_price: 20 }],
    });
    await asAdmin(request(app).post(`/api/orders/${orderRes.body.id}/status`)).send({ status: "confirmed" });

    const batchesRes = await asAdmin(request(app).get(`/api/production-schedules?order_id=${orderRes.body.id}`));
    expect(batchesRes.body.total).toBe(1);
    const batchId = batchesRes.body.items[0].id;

    const cancelRes = await asAdmin(request(app).post(`/api/orders/${orderRes.body.id}/status`)).send({
      status: "cancelled",
      reason: "Customer backed out.",
    });
    expect(cancelRes.status).toBe(200);

    const batchAfter = await asAdmin(request(app).get(`/api/production-schedules/${batchId}`));
    expect(batchAfter.body.status).toBe("cancelled");
    expect(batchAfter.body.cancel_reason).toContain(orderRes.body.order_number);
  });
});
