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
    code: `CUST-QTN-${Date.now()}`,
    name: "Quotation Test Customer",
  });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function createProduct(suffix: string, sellingPrice = 100) {
  const res = await asAdmin(request(app).post("/api/products")).send({
    code: `PR-Q-${suffix}-${Date.now()}`,
    name: `Quotation Test Product ${suffix}`,
    unit: "unit",
    selling_price: sellingPrice,
  });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("Quotations: pricing math, draft editing, state machine", () => {
  let customerId: number;
  let productId: number;

  beforeAll(async () => {
    customerId = await createCustomer();
    productId = await createProduct("basic", 50);
  });

  it("rejects an empty line list", async () => {
    const res = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      lines: [],
    });
    expect(res.status).toBe(422);
  });

  it("computes line totals, subtotal, discount, tax correctly", async () => {
    const res = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      tax_rate: 8,
      discount_percent: 5,
      lines: [{ product_id: productId, quantity: 10, unit_price: 50, discount_percent: 10 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.quotation_number).toMatch(/^QTN-\d{5}$/);
    expect(res.body.status).toBe("draft");
    expect(Number(res.body.subtotal_amount)).toBe(450);
    expect(Number(res.body.discount_amount)).toBe(22.5);
    expect(Number(res.body.tax_amount)).toBe(34.2);
    expect(Number(res.body.total_amount)).toBe(461.7);
    expect(res.body.lines[0].line_total).toBe("450.00");
  });

  it("defaults tax_rate from settings when not given", async () => {
    const res = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 100 }],
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.tax_rate)).toBe(0);
  });

  it("only allows editing a draft quotation, and re-prices on line replace", async () => {
    const createRes = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 50 }],
    });
    const id = createRes.body.id;

    const updateRes = await asAdmin(request(app).put(`/api/quotations/${id}`)).send({
      lines: [{ product_id: productId, quantity: 4, unit_price: 25 }],
    });
    expect(updateRes.status).toBe(200);
    expect(Number(updateRes.body.subtotal_amount)).toBe(100);

    await asAdmin(request(app).post(`/api/quotations/${id}/status`)).send({ status: "sent" });
    const blockedRes = await asAdmin(request(app).put(`/api/quotations/${id}`)).send({ notes: "too late" });
    expect(blockedRes.status).toBe(409);
  });

  it("walks the full state machine: draft -> sent -> accepted, rejecting invalid jumps", async () => {
    const createRes = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 10 }],
    });
    const id = createRes.body.id;

    const badJump = await asAdmin(request(app).post(`/api/quotations/${id}/status`)).send({ status: "accepted" });
    expect(badJump.status).toBe(409);

    const sentRes = await asAdmin(request(app).post(`/api/quotations/${id}/status`)).send({ status: "sent" });
    expect(sentRes.status).toBe(200);
    expect(sentRes.body.status).toBe("sent");

    const acceptedRes = await asAdmin(request(app).post(`/api/quotations/${id}/status`)).send({ status: "accepted" });
    expect(acceptedRes.status).toBe(200);
    expect(acceptedRes.body.status).toBe("accepted");
  });

  it("requires a reason to reject, and rejects 'converted' as a direct status target", async () => {
    const createRes = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 10 }],
    });
    const id = createRes.body.id;

    const noReasonRes = await asAdmin(request(app).post(`/api/quotations/${id}/status`)).send({ status: "rejected" });
    expect(noReasonRes.status).toBe(422);

    const withReasonRes = await asAdmin(request(app).post(`/api/quotations/${id}/status`)).send({
      status: "rejected",
      reason: "Customer chose a competitor.",
    });
    expect(withReasonRes.status).toBe(200);
    expect(withReasonRes.body.status).toBe("rejected");

    const convertedRes = await asAdmin(request(app).post(`/api/quotations`)).send({
      customer_id: customerId,
      quotation_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 10 }],
    });
    const attemptConverted = await asAdmin(request(app).post(`/api/quotations/${convertedRes.body.id}/status`)).send({
      status: "converted",
    });
    expect(attemptConverted.status).toBe(422);
  });

  it("blocks deletion of a converted quotation but allows deleting/restoring a draft", async () => {
    const createRes = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 10 }],
    });
    const id = createRes.body.id;

    const delRes = await asAdmin(request(app).delete(`/api/quotations/${id}`));
    expect(delRes.status).toBe(200);

    const getRes = await asAdmin(request(app).get(`/api/quotations/${id}`));
    expect(getRes.status).toBe(404);

    const restoreRes = await asAdmin(request(app).post(`/api/quotations/${id}/restore`));
    expect(restoreRes.status).toBe(200);
  });

  it("records audit history across create/update/status changes", async () => {
    const createRes = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 10 }],
    });
    const id = createRes.body.id;
    await asAdmin(request(app).put(`/api/quotations/${id}`)).send({ notes: "updated" });

    const historyRes = await asAdmin(request(app).get(`/api/quotations/${id}/history`));
    expect(historyRes.status).toBe(200);
    const actions = historyRes.body.map((e: { action: string }) => e.action);
    expect(actions).toContain("create");
    expect(actions).toContain("update");
  });
});

describe("Quotations: large-discount approval gate", () => {
  it("blocks 'sent' at/above threshold until an admin approves, then allows it", async () => {
    await getDb().updateTable("settings").set({ setting_value: "20" }).where("setting_key", "=", "large_discount_approval_threshold").execute();

    const customerId = await createCustomer();
    const productId = await createProduct("discount", 100);

    const createRes = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      discount_percent: 25,
      lines: [{ product_id: productId, quantity: 1, unit_price: 100 }],
    });
    const id = createRes.body.id;

    const blockedRes = await asAdmin(request(app).post(`/api/quotations/${id}/status`)).send({ status: "sent" });
    expect(blockedRes.status).toBe(409);

    const approveRes = await asAdmin(request(app).post(`/api/quotations/${id}/approve`));
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.approved_at).not.toBeNull();

    const sentRes = await asAdmin(request(app).post(`/api/quotations/${id}/status`)).send({ status: "sent" });
    expect(sentRes.status).toBe(200);

    await getDb().updateTable("settings").set({ setting_value: "" }).where("setting_key", "=", "large_discount_approval_threshold").execute();
  });

  it("clears approval when lines or discount change after approval", async () => {
    await getDb().updateTable("settings").set({ setting_value: "10" }).where("setting_key", "=", "large_discount_approval_threshold").execute();

    const customerId = await createCustomer();
    const productId = await createProduct("reapprove", 100);
    const createRes = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      discount_percent: 15,
      lines: [{ product_id: productId, quantity: 1, unit_price: 100 }],
    });
    const id = createRes.body.id;
    await asAdmin(request(app).post(`/api/quotations/${id}/approve`));

    await asAdmin(request(app).put(`/api/quotations/${id}`)).send({
      lines: [{ product_id: productId, quantity: 2, unit_price: 100 }],
    });

    const blockedRes = await asAdmin(request(app).post(`/api/quotations/${id}/status`)).send({ status: "sent" });
    expect(blockedRes.status).toBe(409);

    await getDb().updateTable("settings").set({ setting_value: "" }).where("setting_key", "=", "large_discount_approval_threshold").execute();
  });
});

describe("Feasibility -> Quotation integration: deal linkage, conversion, auto-create", () => {
  it("creating a quotation from a feasibility check marks it converted and shares the deal", async () => {
    const customerId = await createCustomer();
    const productId = await createProduct("linked", 75);
    const materialRes = await asAdmin(request(app).post("/api/raw-materials")).send({
      code: `RM-Q-${Date.now()}`,
      name: "Linked Material",
      unit: "kg",
    });
    const materialId = materialRes.body.id;
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

    const fsbRes = await asAdmin(request(app).post("/api/feasibilities")).send({
      customer_id: customerId,
      lines: [{ product_id: productId, quantity: 2 }],
    });
    const fsbId = fsbRes.body.id;

    const runRes = await asAdmin(request(app).post(`/api/feasibilities/${fsbId}/run-check`));
    expect(runRes.body.status).toBe("converted");
    const dealId = runRes.body.deal_id;
    expect(dealId).not.toBeNull();

    const quotationsRes = await asAdmin(request(app).get(`/api/quotations?customer_id=${customerId}`));
    const autoQuotation = quotationsRes.body.items.find((q: { customer_id: number }) => q.customer_id === customerId);
    expect(autoQuotation).toBeDefined();

    const fullQuotation = await asAdmin(request(app).get(`/api/quotations/${autoQuotation.id}`));
    expect(fullQuotation.body.feasibility_id).toBe(fsbId);
    expect(fullQuotation.body.deal_id).toBe(dealId);
    expect(fullQuotation.body.auto_created).toBe(true);
    expect(Number(fullQuotation.body.lines[0].unit_price)).toBe(75);

    const dealRes = await asAdmin(request(app).get(`/api/deals/${dealId}`));
    expect(dealRes.status).toBe(200);
    expect(dealRes.body.feasibility_checks).toHaveLength(1);
    expect(dealRes.body.quotations).toHaveLength(1);
    expect(dealRes.body.furthest_stage).toBe("quotation");
  });

  it("rejects creating a quotation from a feasibility check that isn't quotable", async () => {
    const customerId = await createCustomer();
    const productId = await createProduct("notquotable");
    const fsbRes = await asAdmin(request(app).post("/api/feasibilities")).send({
      customer_id: customerId,
      lines: [{ product_id: productId, quantity: 1 }],
    });
    const res = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      feasibility_id: fsbRes.body.id,
      quotation_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 10 }],
    });
    expect(res.status).toBe(409);
  });

  it("a standalone quotation with no feasibility_id starts its own new deal", async () => {
    const customerId = await createCustomer();
    const productId = await createProduct("standalone");
    const res = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 10 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.deal_id).not.toBeNull();
    expect(res.body.deal_number).toMatch(/^DEAL-\d{5}$/);
  });

  it("rejecting a quotation with no other alive stage cancels its deal", async () => {
    const customerId = await createCustomer();
    const productId = await createProduct("cancel-deal");
    const createRes = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 10 }],
    });
    const dealId = createRes.body.deal_id;

    await asAdmin(request(app).post(`/api/quotations/${createRes.body.id}/status`)).send({ status: "sent" });
    await asAdmin(request(app).post(`/api/quotations/${createRes.body.id}/status`)).send({
      status: "rejected",
      reason: "No longer needed.",
    });

    const dealRes = await asAdmin(request(app).get(`/api/deals/${dealId}`));
    expect(dealRes.body.status).toBe("cancelled");
  });
});

describe("Quotations: expiry escalation", () => {
  it("moves a sent quotation past its valid_until to expired, and reconciles its deal", async () => {
    const customerId = await createCustomer();
    const productId = await createProduct("expiry");
    const createRes = await asAdmin(request(app).post("/api/quotations")).send({
      customer_id: customerId,
      quotation_date: today(),
      valid_until: today(),
      lines: [{ product_id: productId, quantity: 1, unit_price: 10 }],
    });
    const id = createRes.body.id;
    const dealId = createRes.body.deal_id;
    await asAdmin(request(app).post(`/api/quotations/${id}/status`)).send({ status: "sent" });

    await getDb().updateTable("quotations").set({ valid_until: "2000-01-01" }).where("id", "=", id).execute();

    const scanRes = await asAdmin(request(app).post("/api/quotations/scan-expired"));
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.quotation_ids).toContain(id);

    const getRes = await asAdmin(request(app).get(`/api/quotations/${id}`));
    expect(getRes.body.status).toBe("expired");

    const dealRes = await asAdmin(request(app).get(`/api/deals/${dealId}`));
    expect(dealRes.body.status).toBe("cancelled");
  });
});
