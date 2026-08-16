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
    code: `CUST-ORD-${Date.now()}`,
    name: "Order Test Customer",
  });
  return res.body.id as number;
}

async function createProduct(suffix: string, sellingPrice = 50) {
  const res = await asAdmin(request(app).post("/api/products")).send({
    code: `PR-O-${suffix}-${Date.now()}`,
    name: `Order Test Product ${suffix}`,
    unit: "unit",
    selling_price: sellingPrice,
  });
  return res.body.id as number;
}

async function createSupplier() {
  const res = await asAdmin(request(app).post("/api/suppliers")).send({
    code: `SUP-PO-${Date.now()}`,
    name: "PO Test Supplier",
  });
  return res.body.id as number;
}

async function createRawMaterial(suffix: string) {
  const res = await asAdmin(request(app).post("/api/raw-materials")).send({
    code: `RM-O-${suffix}-${Date.now()}`,
    name: `Order Test Material ${suffix}`,
    unit: "kg",
  });
  return res.body.id as number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("Orders: pricing, state machine, stock reserve/consume/release", () => {
  let customerId: number;
  let productId: number;

  beforeAll(async () => {
    customerId = await createCustomer();
    productId = await createProduct("stock", 25);
  });

  it("creates a draft order with correct pricing and a new deal", async () => {
    const res = await asAdmin(request(app).post("/api/orders")).send({
      customer_id: customerId,
      order_date: today(),
      lines: [{ product_id: productId, quantity: 4, unit_price: 25 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.order_number).toMatch(/^ORD-\d{5}$/);
    expect(res.body.status).toBe("draft");
    expect(Number(res.body.subtotal_amount)).toBe(100);
    expect(res.body.deal_id).not.toBeNull();
  });

  it("confirming reserves finished-goods stock (even above on-hand), shipping consumes it and releases the reservation", async () => {
    const createRes = await asAdmin(request(app).post("/api/orders")).send({
      customer_id: customerId,
      order_date: today(),
      lines: [{ product_id: productId, quantity: 5, unit_price: 25 }],
    });
    const id = createRes.body.id;

    const beforeStock = await asAdmin(request(app).get(`/api/inventory/stock/product/${productId}`));
    expect(beforeStock.body.quantity_reserved).toBe(0);

    const confirmRes = await asAdmin(request(app).post(`/api/orders/${id}/status`)).send({ status: "confirmed" });
    expect(confirmRes.status).toBe(200);

    const afterConfirmStock = await asAdmin(request(app).get(`/api/inventory/stock/product/${productId}`));
    expect(afterConfirmStock.body.quantity_reserved).toBe(5); // reserved even though 0 on hand

    // Receive some finished-goods stock so shipping can actually consume it.
    await asAdmin(request(app).post("/api/inventory/adjust")).send({
      item_type: "product",
      item_id: productId,
      quantity: 10,
      movement_type: "receipt",
    });

    await asAdmin(request(app).post(`/api/orders/${id}/status`)).send({ status: "in_production" });
    await asAdmin(request(app).post(`/api/orders/${id}/status`)).send({ status: "ready_to_ship" });
    const shipRes = await asAdmin(request(app).post(`/api/orders/${id}/status`)).send({ status: "shipped" });
    expect(shipRes.status).toBe(200);

    const afterShipStock = await asAdmin(request(app).get(`/api/inventory/stock/product/${productId}`));
    expect(afterShipStock.body.quantity_on_hand).toBe(5); // 10 received - 5 shipped
    expect(afterShipStock.body.quantity_reserved).toBe(0); // released on ship
  });

  it("cancelling a confirmed order releases its reservation", async () => {
    const createRes = await asAdmin(request(app).post("/api/orders")).send({
      customer_id: customerId,
      order_date: today(),
      lines: [{ product_id: productId, quantity: 3, unit_price: 25 }],
    });
    const id = createRes.body.id;
    await asAdmin(request(app).post(`/api/orders/${id}/status`)).send({ status: "confirmed" });

    const beforeCancelStock = await asAdmin(request(app).get(`/api/inventory/stock/product/${productId}`));
    const reservedBefore = beforeCancelStock.body.quantity_reserved;

    const cancelRes = await asAdmin(request(app).post(`/api/orders/${id}/status`)).send({
      status: "cancelled",
      reason: "Customer changed their mind.",
    });
    expect(cancelRes.status).toBe(200);

    const afterCancelStock = await asAdmin(request(app).get(`/api/inventory/stock/product/${productId}`));
    expect(afterCancelStock.body.quantity_reserved).toBe(reservedBefore - 3);
  });

  it("requires a reason to cancel", async () => {
    const createRes = await asAdmin(request(app).post("/api/orders")).send({
      customer_id: customerId,
      order_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 25 }],
    });
    const res = await asAdmin(request(app).post(`/api/orders/${createRes.body.id}/status`)).send({ status: "cancelled" });
    expect(res.status).toBe(422);
  });

  it("only allows editing a draft order, and re-prices on line replace", async () => {
    const createRes = await asAdmin(request(app).post("/api/orders")).send({
      customer_id: customerId,
      order_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 25 }],
    });
    const id = createRes.body.id;

    const updateRes = await asAdmin(request(app).put(`/api/orders/${id}`)).send({
      lines: [{ product_id: productId, quantity: 2, unit_price: 30 }],
    });
    expect(updateRes.status).toBe(200);
    expect(Number(updateRes.body.subtotal_amount)).toBe(60);

    await asAdmin(request(app).post(`/api/orders/${id}/status`)).send({ status: "confirmed" });
    const blockedRes = await asAdmin(request(app).put(`/api/orders/${id}`)).send({ notes: "too late" });
    expect(blockedRes.status).toBe(409);
  });

  it("blocks deletion of a non-draft order but allows deleting/restoring a draft", async () => {
    const createRes = await asAdmin(request(app).post("/api/orders")).send({
      customer_id: customerId,
      order_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 25 }],
    });
    const id = createRes.body.id;

    const delRes = await asAdmin(request(app).delete(`/api/orders/${id}`));
    expect(delRes.status).toBe(200);
    const restoreRes = await asAdmin(request(app).post(`/api/orders/${id}/restore`));
    expect(restoreRes.status).toBe(200);

    await asAdmin(request(app).post(`/api/orders/${id}/status`)).send({ status: "confirmed" });
    const blockedDelete = await asAdmin(request(app).delete(`/api/orders/${id}`));
    expect(blockedDelete.status).toBe(409);
  });
});

describe("Orders: quotation conversion", () => {
  it("converts an accepted quotation into a draft order, sharing the deal, and marks it converted", async () => {
    const customerId = await createCustomer();
    const productId = await createProduct("fromquote", 40);

    const quoteRes = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      lines: [{ product_id: productId, quantity: 3, unit_price: 40 }],
    });
    const quotationId = quoteRes.body.id;
    const dealId = quoteRes.body.deal_id;
    await asAdmin(request(app).post(`/api/quotations/${quotationId}/status`)).send({ status: "sent" });
    await asAdmin(request(app).post(`/api/quotations/${quotationId}/status`)).send({ status: "accepted" });

    const orderRes = await asAdmin(request(app).post(`/api/orders/from-quotation/${quotationId}`));
    expect(orderRes.status).toBe(201);
    expect(orderRes.body.deal_id).toBe(dealId);
    expect(Number(orderRes.body.total_amount)).toBe(120);
    expect(orderRes.body.notes).toContain(quoteRes.body.quotation_number);

    const quotationAfter = await asAdmin(request(app).get(`/api/quotations/${quotationId}`));
    expect(quotationAfter.body.status).toBe("converted");
    expect(quotationAfter.body.converted_order_id).toBe(orderRes.body.id);
  });

  it("rejects converting a quotation that isn't accepted", async () => {
    const customerId = await createCustomer();
    const productId = await createProduct("notaccepted");
    const quoteRes = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 10 }],
    });
    const res = await asAdmin(request(app).post(`/api/orders/from-quotation/${quoteRes.body.id}`));
    expect(res.status).toBe(409);
  });
});

describe("Orders: admin review and overdue escalation", () => {
  it("flags an order past its requested delivery date, then admin-review clears it", async () => {
    const customerId = await createCustomer();
    const productId = await createProduct("overdue");
    const createRes = await asAdmin(request(app).post("/api/orders")).send({
      customer_id: customerId,
      order_date: today(),
      requested_delivery_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 10 }],
    });
    const id = createRes.body.id;

    await getDb().updateTable("orders").set({ requested_delivery_date: "2000-01-01" }).where("id", "=", id).execute();

    const scanRes = await asAdmin(request(app).post("/api/orders/scan-overdue"));
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.order_ids).toContain(id);

    const getRes = await asAdmin(request(app).get(`/api/orders/${id}`));
    expect(getRes.body.admin_review_required).toBe(true);

    const reviewRes = await asAdmin(request(app).post(`/api/orders/${id}/admin-review`)).send({ notes: "Confirmed with customer, delayed shipment." });
    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.admin_review_required).toBe(false);
  });
});

describe("Purchase orders: pricing, state machine, receiving", () => {
  let supplierId: number;
  let materialId: number;

  beforeAll(async () => {
    supplierId = await createSupplier();
    materialId = await createRawMaterial("po");
  });

  it("creates a draft PO with correct pricing", async () => {
    const res = await asAdmin(request(app).post("/api/purchase-orders")).send({
      supplier_id: supplierId,
      order_date: today(),
      lines: [{ raw_material_id: materialId, quantity: 100, unit_price: 5 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.po_number).toMatch(/^PO-\d{5}$/);
    expect(Number(res.body.subtotal_amount)).toBe(500);
  });

  it("walks draft -> sent -> confirmed, rejecting invalid jumps", async () => {
    const createRes = await asAdmin(request(app).post("/api/purchase-orders")).send({
      supplier_id: supplierId,
      order_date: today(),
      lines: [{ raw_material_id: materialId, quantity: 10, unit_price: 5 }],
    });
    const id = createRes.body.id;

    const badJump = await asAdmin(request(app).post(`/api/purchase-orders/${id}/status`)).send({ status: "confirmed" });
    expect(badJump.status).toBe(409);

    const sentRes = await asAdmin(request(app).post(`/api/purchase-orders/${id}/status`)).send({ status: "sent" });
    expect(sentRes.status).toBe(200);
    const confirmedRes = await asAdmin(request(app).post(`/api/purchase-orders/${id}/status`)).send({ status: "confirmed" });
    expect(confirmedRes.status).toBe(200);
  });

  it("receives goods partially, then fully, transitioning partially_received -> received, and stock increases", async () => {
    const createRes = await asAdmin(request(app).post("/api/purchase-orders")).send({
      supplier_id: supplierId,
      order_date: today(),
      lines: [{ raw_material_id: materialId, quantity: 50, unit_price: 5 }],
    });
    const id = createRes.body.id;
    await asAdmin(request(app).post(`/api/purchase-orders/${id}/status`)).send({ status: "sent" });
    await asAdmin(request(app).post(`/api/purchase-orders/${id}/status`)).send({ status: "confirmed" });

    const lineId = createRes.body.lines[0].id;
    const stockBefore = await asAdmin(request(app).get(`/api/inventory/stock/raw_material/${materialId}`));

    const partialRes = await asAdmin(request(app).post(`/api/purchase-orders/${id}/receive`)).send({
      lines: [{ line_id: lineId, quantity: 20 }],
    });
    expect(partialRes.status).toBe(200);
    expect(partialRes.body.status).toBe("partially_received");

    const overReceiveRes = await asAdmin(request(app).post(`/api/purchase-orders/${id}/receive`)).send({
      lines: [{ line_id: lineId, quantity: 40 }], // only 30 remains
    });
    expect(overReceiveRes.status).toBe(422);

    const finalRes = await asAdmin(request(app).post(`/api/purchase-orders/${id}/receive`)).send({
      lines: [{ line_id: lineId, quantity: 30 }],
    });
    expect(finalRes.status).toBe(200);
    expect(finalRes.body.status).toBe("received");

    const stockAfter = await asAdmin(request(app).get(`/api/inventory/stock/raw_material/${materialId}`));
    expect(stockAfter.body.quantity_on_hand).toBe(stockBefore.body.quantity_on_hand + 50);
  });

  it("requires a reason to cancel, blocks deletion of non-draft POs", async () => {
    const createRes = await asAdmin(request(app).post("/api/purchase-orders")).send({
      supplier_id: supplierId,
      order_date: today(),
      lines: [{ raw_material_id: materialId, quantity: 5, unit_price: 5 }],
    });
    const id = createRes.body.id;
    await asAdmin(request(app).post(`/api/purchase-orders/${id}/status`)).send({ status: "sent" });

    const noReasonRes = await asAdmin(request(app).post(`/api/purchase-orders/${id}/status`)).send({ status: "cancelled" });
    expect(noReasonRes.status).toBe(422);

    const cancelRes = await asAdmin(request(app).post(`/api/purchase-orders/${id}/status`)).send({
      status: "cancelled",
      reason: "No longer needed.",
    });
    expect(cancelRes.status).toBe(200);

    const deleteRes = await asAdmin(request(app).delete(`/api/purchase-orders/${id}`));
    expect(deleteRes.status).toBe(409);
  });
});

describe("Purchase orders: large-PO and large-discount approval gates", () => {
  it("blocks sending a PO at/above the large-PO amount threshold until approved", async () => {
    await getDb().updateTable("settings").set({ setting_value: "1000" }).where("setting_key", "=", "large_po_approval_threshold").execute();

    const supplierId = await createSupplier();
    const materialId = await createRawMaterial("bigpo");
    const createRes = await asAdmin(request(app).post("/api/purchase-orders")).send({
      supplier_id: supplierId,
      order_date: today(),
      lines: [{ raw_material_id: materialId, quantity: 300, unit_price: 5 }], // 1500 > 1000 threshold
    });
    const id = createRes.body.id;

    const blockedRes = await asAdmin(request(app).post(`/api/purchase-orders/${id}/status`)).send({ status: "sent" });
    expect(blockedRes.status).toBe(409);

    await asAdmin(request(app).post(`/api/purchase-orders/${id}/approve`));
    const sentRes = await asAdmin(request(app).post(`/api/purchase-orders/${id}/status`)).send({ status: "sent" });
    expect(sentRes.status).toBe(200);

    await getDb().updateTable("settings").set({ setting_value: "" }).where("setting_key", "=", "large_po_approval_threshold").execute();
  });
});

describe("Purchase orders: auto-draft from MRP shortages", () => {
  it("drafts a PO grouping every shortage material a supplier covers, skips materials with no supplier", async () => {
    const productId = await createProduct("mrpdraft");
    const materialId = await createRawMaterial("mrpdraft");
    await asAdmin(request(app).post(`/api/products/${productId}/bom/lines`)).send({
      component_type: "raw_material",
      component_id: materialId,
      quantity: 20,
      unit: "kg",
    });
    const supplierId = await createSupplier();
    await asAdmin(request(app).put(`/api/suppliers/${supplierId}/materials`)).send({
      lines: [{ raw_material_id: materialId, max_supply_quantity: 500, lead_time_days: 4 }],
    });

    const db = getDb();
    await db
      .insertInto("production_schedules")
      .values({ product_id: productId, planned_quantity: 5, scheduled_start: today(), scheduled_end: today(), status: "planned" })
      .execute();
    // 5 * 20kg = 100kg required, 0 on hand -> 100kg shortfall.

    const draftRes = await asAdmin(request(app).post("/api/purchase-orders/auto-draft-from-mrp"));
    expect(draftRes.status).toBe(201);
    expect(draftRes.body.created_count).toBeGreaterThanOrEqual(1);

    const drafted = draftRes.body.purchase_orders.find((po: { supplier_id: number }) => po.supplier_id === supplierId);
    expect(drafted).toBeDefined();
    expect(drafted.status).toBe("draft");
    expect(drafted.auto_created).toBe(true);
    expect(
      drafted.lines.some(
        (l: { raw_material_id: number; quantity: string }) => l.raw_material_id === materialId && Number(l.quantity) === 100,
      ),
    ).toBe(true);

    // Re-running immediately shouldn't duplicate a draft for the same
    // still-pending shortage.
    const secondRun = await asAdmin(request(app).post("/api/purchase-orders/auto-draft-from-mrp"));
    const secondDraftForSameMaterial = secondRun.body.purchase_orders.some((po: { lines: { raw_material_id: number }[] }) =>
      po.lines.some((l) => l.raw_material_id === materialId),
    );
    expect(secondDraftForSameMaterial).toBe(false);
  });
});
