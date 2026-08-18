# Functional Parity Checklist

This is the zero-loss contract for the rewrite. Every item below exists in
the current system (`jdk_clean`) and must have a working, tested equivalent
before that domain's pass is marked complete. Nothing here is optional —
"clean architecture" is not an excuse to drop a feature. If a feature is
deliberately dropped, it must be called out explicitly and signed off,
never silently omitted.

Generated from the current codebase's actual surface — not from memory
or assumption — as of the migration start date.

## Domains / entities (from frontend page structure + backend models)

- [ ] Auth: login, refresh (no refresh token yet -- access token only),
      logout, change password, "me" profile + avatar (avatar upload
      deferred to Pass 3)
- [x] Users: CRUD (admin-only), roles, department, page-level permission
      matrix. Avatar/signature upload deferred to Pass 3 -- columns
      exist, no upload endpoint yet.
- [x] Customers: CRUD, search/sort/filter, history, soft delete/restore
- [x] Suppliers: CRUD + supplied-materials editor (full-replace-lines
      pattern), history, soft delete/restore
- [x] Supplier materials: linkage between suppliers and raw materials
- [x] Raw materials: CRUD, reorder point, unit cost, history,
      default_supplier_id (checked as a business rule, not just an FK)
- [x] Products: CRUD, unit, product type, selling price, machine/production
      formula inputs (production hours/unit, workers required)
- [x] Machines: CRUD, capacity
- [x] BOM (Bill of Materials): lines per product, explode, history,
      cycle detection, multi-level explosion with scrap%
- [x] Inventory: stock levels, movements, low-stock, reserve/release
      (reserve/release ported as application functions for Pass 2d
      Orders to call -- no HTTP route yet, matching jdk_clean, which
      doesn't expose them as endpoints either)
- [x] MRP: materials requirements planning calculation -- demand
      aggregation (scheduled batches + un-batched outstanding orders,
      no double-counting), BOM explosion, net against on-hand stock,
      greedy supplier-purchase suggestions by lead time
- [x] Feasibility checks: production feasibility given machine/capacity/BOM
      -- full state machine (draft/run-check/exception decision/close/
      revive/admin-review/stale-escalation), materials shortfall via
      BOM + inventory, real machine + shared-worker-pool capacity scan.
      Deal linking and auto-create-quotation-on-feasible explicitly
      deferred to Pass 2c (deal_id column exists, FK + the calls into
      deal_service/quotation_service land once those exist)
- [x] Quotations: create, calculations (line + document discount, tax,
      shared pricingService), approval workflow (draft/sent/accepted/
      rejected/expired/converted state machine, large-discount
      approval gate, expiry escalation)
- [x] Deals: deal + deal-detail lifecycle -- loose-grouping across
      feasibility/quotation stages, furthest_stage tracking, status
      reconciliation/reopen on stage terminal states. Deal-detail's
      orders/production_batches/delivery_notes sections are honest
      empty arrays until Pass 2d/2e widen the orders stub and build
      those domains
- [x] Orders: creation, status history (via /history; friendly /journey
      view deferred as presentational sugar), order lines, quotation
      conversion, stock reserve/consume/release, large-discount
      approval gate, overdue delivery escalation. Auto-schedule-
      production-on-confirm, auto-create-delivery-note-on-ready-to-ship,
      and cancelling-active-production-batches all deferred to Pass 2e
      (need production_service/delivery_note_service)
- [x] Purchase orders: creation, receipt (partial + full, per-line),
      large-PO and large-discount approval gates, auto-draft from MRP
      shortages (real greedy allocation, grouped by supplier, skips
      materials already covered by a pending PO)
- [x] Delivery notes: creation (auto-populated from order lines or
      explicit), eligibility (order must be ready_to_ship, one active
      note per order), issuing ships the linked order. PDF generation
      and signature capture deferred to Pass 3 (adapter infrastructure)
- [x] Production schedules: scheduling (manual + real auto-schedule on
      order confirmation via the same vacant-slot capacity scan
      feasibility uses), completion (all-or-nothing material
      consumption + finished-goods production), cancellation cascades
      from order cancellation
- [x] Calendar: events with date/title/notes, all-users or per-user
      mentions, creator-only (or admin/manager) modify -- not tied to
      the department permission matrix, matching jdk_clean. Not
      auto-linked to schedule/delivery events (jdk_clean's calendar is
      a general-purpose scheduling tool, not auto-populated from other
      domains, so there was nothing to port there beyond the base
      CRUD)
- [ ] Dashboard: widgets, user-customizable dashboard preferences
- [ ] Notifications: in-app notifications, notification service
- [ ] Email: transactional email via SMTP (order confirms, etc.)
- [ ] Settings: business settings (numbers series, factory setup, etc.)
- [ ] Number series: auto-numbering for orders/quotations/POs/etc.
- [ ] Assistant: in-app AI assistant + help content
- [ ] Audit log: create/update/delete/restore logged with before/after,
      per-entity history endpoint (`/{id}/history`)
- [ ] PDF generation: quotations, POs, delivery notes
- [ ] Signature capture/storage
- [ ] Global search across entities (per-entity search exists; no
      cross-entity global search yet)
- [x] Soft delete + restore on every master-data entity
- [x] Pagination, search, sort, filter — standardized across all list
      endpoints (`page`, `page_size`, `search`, `sort`, `status`)

## Cross-cutting behaviors to preserve exactly

- [x] Every write action attributes `created_by` / `updated_by`
- [x] Every destructive action is soft-delete, never hard-delete
- [x] `page_key`-based permission gating (read/write per page, admin/manager
      bypass, viewer read-only) — `requirePageAccess` in
      `api/dependencies/permissions.ts`
- [x] Request logging (method/path/status, never bodies/credentials)
- [ ] JWT access + refresh token flow, refresh token revocation --
      access token only so far, no refresh flow yet
- [x] CORS configuration via settings, not hardcoded origins

## Sign-off

A domain pass is not "done" until:
1. Every box above for that domain is checked against a working endpoint/UI.
2. A parity test exists proving old-behavior == new-behavior for at least
   the create/read/update/delete/restore/history cycle.
3. Any intentional behavior change is written down here with a reason and
   explicit approval — not discovered later as a silent gap.
