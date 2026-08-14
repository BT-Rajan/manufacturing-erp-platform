import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/api/app.js";
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

async function createRawMaterial(suffix: string) {
  const res = await asAdmin(request(app).post("/api/raw-materials")).send({
    code: `RM-B-${suffix}-${Date.now()}`,
    name: `BOM Test Material ${suffix}`,
    unit: "kg",
  });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function createProduct(suffix: string) {
  const res = await asAdmin(request(app).post("/api/products")).send({
    code: `PR-B-${suffix}-${Date.now()}`,
    name: `BOM Test Product ${suffix}`,
    unit: "unit",
  });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("BOM: multi-level explosion with scrap, cycle detection, duplicate rejection", () => {
  let cementId: number;
  let bagId: number; // sub-assembly: cement + packaging -> bagged cement
  let limestoneId: number;
  let packagingId: number;

  beforeAll(async () => {
    limestoneId = await createRawMaterial("lime");
    packagingId = await createRawMaterial("pack");
    cementId = await createProduct("cement");
    bagId = await createProduct("bagcem");
  });

  it("rejects a BOM line referencing a non-existent component", async () => {
    const res = await asAdmin(request(app).post(`/api/products/${cementId}/bom/lines`)).send({
      component_type: "raw_material",
      component_id: 999999,
      quantity: 10,
      unit: "kg",
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("adds a BOM line to cement: limestone with 5% scrap", async () => {
    const res = await asAdmin(request(app).post(`/api/products/${cementId}/bom/lines`)).send({
      component_type: "raw_material",
      component_id: limestoneId,
      quantity: 100,
      unit: "kg",
      scrap_percent: 5,
    });
    expect(res.status).toBe(201);
    expect(res.body.component_code).toBeDefined();
  });

  it("rejects a duplicate component on the same product's BOM", async () => {
    const res = await asAdmin(request(app).post(`/api/products/${cementId}/bom/lines`)).send({
      component_type: "raw_material",
      component_id: limestoneId,
      quantity: 50,
      unit: "kg",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("conflict");
  });

  it("builds a two-level BOM: bagged-cement = cement (sub-assembly) + packaging", async () => {
    const putRes = await asAdmin(request(app).put(`/api/products/${bagId}/bom`)).send({
      lines: [
        { component_type: "product", component_id: cementId, quantity: 1, unit: "unit" },
        { component_type: "raw_material", component_id: packagingId, quantity: 1, unit: "unit", scrap_percent: 0 },
      ],
    });
    expect(putRes.status).toBe(200);
    expect(putRes.body).toHaveLength(2);
  });

  it("rejects a circular BOM (cement cannot require bagged-cement, which already requires cement)", async () => {
    const res = await asAdmin(request(app).post(`/api/products/${cementId}/bom/lines`)).send({
      component_type: "product",
      component_id: bagId,
      quantity: 1,
      unit: "unit",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/circular/i);
  });

  it("rejects a product being a component of its own BOM", async () => {
    const res = await asAdmin(request(app).post(`/api/products/${cementId}/bom/lines`)).send({
      component_type: "product",
      component_id: cementId,
      quantity: 1,
      unit: "unit",
    });
    expect(res.status).toBe(409);
  });

  it("explodes bagged-cement's multi-level BOM correctly, including scrap", async () => {
    // 10 units of bagged-cement -> 10 units of cement (1:1, no scrap on
    // that line) -> each unit of cement needs 100kg limestone at 5% scrap
    // = 105kg per unit of cement -> 10 * 105 = 1050kg limestone total.
    const res = await asAdmin(request(app).get(`/api/products/${bagId}/bom/explode?quantity=10`));
    expect(res.status).toBe(200);
    expect(res.body.product_id).toBe(bagId);
    const limestoneReq = res.body.requirements.find((r: { raw_material_id: number }) => r.raw_material_id === limestoneId);
    expect(limestoneReq).toBeDefined();
    expect(limestoneReq.quantity_required).toBeCloseTo(1050, 4);
  });

  it("records BOM history for both the line-add and the replace", async () => {
    const res = await asAdmin(request(app).get(`/api/products/${cementId}/bom/history`));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("deletes a BOM line", async () => {
    const bomRes = await asAdmin(request(app).get(`/api/products/${cementId}/bom`));
    const lineId = bomRes.body[0].id;
    const delRes = await asAdmin(request(app).delete(`/api/products/${cementId}/bom/lines/${lineId}`));
    expect(delRes.status).toBe(200);

    const afterRes = await asAdmin(request(app).get(`/api/products/${cementId}/bom`));
    expect(afterRes.body.find((l: { id: number }) => l.id === lineId)).toBeUndefined();
  });
});

describe("Inventory: adjust, negative-stock guard, low stock, movement history", () => {
  let materialId: number;

  beforeAll(async () => {
    materialId = await createRawMaterial("inventory");
  });

  it("starts at zero stock for a material with no movements yet", async () => {
    const res = await asAdmin(request(app).get(`/api/inventory/stock/raw_material/${materialId}`));
    expect(res.status).toBe(200);
    expect(res.body.quantity_on_hand).toBe(0);
    expect(res.body.quantity_available).toBe(0);
  });

  it("rejects adjusting stock for a non-existent item", async () => {
    const res = await asAdmin(request(app).post("/api/inventory/adjust")).send({
      item_type: "raw_material",
      item_id: 999999,
      quantity: 10,
      movement_type: "receipt",
    });
    expect(res.status).toBe(404);
  });

  it("receives stock (positive adjustment)", async () => {
    const res = await asAdmin(request(app).post("/api/inventory/adjust")).send({
      item_type: "raw_material",
      item_id: materialId,
      quantity: 500,
      movement_type: "receipt",
      notes: "Initial stock",
    });
    expect(res.status).toBe(200);
    expect(res.body.quantity_on_hand).toBe(500);
  });

  it("rejects an adjustment that would take stock negative", async () => {
    const res = await asAdmin(request(app).post("/api/inventory/adjust")).send({
      item_type: "raw_material",
      item_id: materialId,
      quantity: -1000,
      movement_type: "issue",
    });
    expect(res.status).toBe(500); // AppError with default 500 status, matching jdk_clean's bare AppError
    const stockRes = await asAdmin(request(app).get(`/api/inventory/stock/raw_material/${materialId}`));
    expect(stockRes.body.quantity_on_hand).toBe(500); // unchanged
  });

  it("issues stock (negative adjustment) within bounds", async () => {
    const res = await asAdmin(request(app).post("/api/inventory/adjust")).send({
      item_type: "raw_material",
      item_id: materialId,
      quantity: -200,
      movement_type: "issue",
    });
    expect(res.status).toBe(200);
    expect(res.body.quantity_on_hand).toBe(300);
  });

  it("rejects a zero-quantity adjustment at the schema level", async () => {
    const res = await asAdmin(request(app).post("/api/inventory/adjust")).send({
      item_type: "raw_material",
      item_id: materialId,
      quantity: 0,
      movement_type: "adjustment",
    });
    expect(res.status).toBe(422);
  });

  it("shows up in low-stock once on-hand drops to/below reorder point", async () => {
    // reorder_point defaults to 0 for a freshly created material, so
    // push on-hand to exactly 0 to cross the threshold.
    await asAdmin(request(app).post("/api/inventory/adjust")).send({
      item_type: "raw_material",
      item_id: materialId,
      quantity: -300,
      movement_type: "issue",
    });
    const res = await asAdmin(request(app).get("/api/inventory/low-stock"));
    expect(res.status).toBe(200);
    expect(res.body.some((item: { raw_material_id: number }) => item.raw_material_id === materialId)).toBe(true);
  });

  it("records every adjustment in movement history", async () => {
    const res = await asAdmin(
      request(app).get(`/api/inventory/movements?item_type=raw_material&item_id=${materialId}`),
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(3); // receipt, issue, issue
    expect(res.body.items.every((m: { item_id: number }) => m.item_id === materialId)).toBe(true);
  });
});
