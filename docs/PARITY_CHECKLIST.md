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

- [ ] Auth: login, refresh, logout, change password, "me" profile + avatar
- [ ] Users: CRUD, roles, department permissions, page-level permission matrix
- [ ] Customers: CRUD, search/sort/filter, history, soft delete/restore
- [ ] Suppliers: CRUD + supplied-materials editor, history, soft delete/restore
- [ ] Supplier materials: linkage between suppliers and raw materials
- [ ] Raw materials: CRUD, reorder point, unit cost, history
- [ ] Products: CRUD, unit, product type, selling price, machine/production
      formula inputs (production hours/unit, workers required)
- [ ] Machines: CRUD, capacity
- [ ] BOM (Bill of Materials): lines per product, explode, history
- [ ] Inventory: stock levels, movements
- [ ] MRP: materials requirements planning calculation
- [ ] Feasibility checks: production feasibility given machine/capacity/BOM
- [ ] Quotations: create, calculations, approval workflow
- [ ] Deals: deal + deal-detail lifecycle
- [ ] Orders: creation, order journey/status history, order lines
- [ ] Purchase orders: creation, receipt
- [ ] Delivery notes: creation, PDF generation, signature capture
- [ ] Production schedules: scheduling, capacity service, completion
- [ ] Calendar: calendar events tied to schedules/deliveries
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
- [ ] Global search across entities
- [ ] Soft delete + restore on every master-data entity
- [ ] Pagination, search, sort, filter — standardized across all list
      endpoints (`page`, `page_size`, `search`, `sort`, `filters`)

## Cross-cutting behaviors to preserve exactly

- [ ] Every write action attributes `created_by` / `updated_by`
- [ ] Every destructive action is soft-delete, never hard-delete
- [ ] `page_key`-based permission gating (read/write per page, admin/manager
      bypass) — current mechanism in `require_page_access`
- [ ] Request logging (method/path/status, never bodies/credentials)
- [ ] JWT access + refresh token flow, refresh token revocation
- [ ] CORS configuration via settings, not hardcoded origins

## Sign-off

A domain pass is not "done" until:
1. Every box above for that domain is checked against a working endpoint/UI.
2. A parity test exists proving old-behavior == new-behavior for at least
   the create/read/update/delete/restore/history cycle.
3. Any intentional behavior change is written down here with a reason and
   explicit approval — not discovered later as a silent gap.
