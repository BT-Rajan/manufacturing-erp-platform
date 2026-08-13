# Multi-Pass Development Plan

Ground-up rewrite, superseding `jdk` / `jdk_clean` / `jdkv2`. Organized as
sequential, independently-shippable passes. Each pass ends in a state that
runs and can be demoed — this is not "big bang at the end."

Non-negotiables carried through every pass (see `docs/PARITY_CHECKLIST.md`
and `docs/ARCHITECTURE.md` for the detail behind each):

- **No loss of function.** Every existing capability must have a working
  equivalent before a domain is considered migrated.
- **Everything admin-configurable.** No hardcoded business rules that an
  admin should reasonably be able to change (number formats, workflow
  states, permission matrix, notification channels, branding).
- **Truly auditable.** Every state-changing action is attributed and
  logged with before/after values, immutably.
- **No hardcoded branding.** No company name, logo, color, or copy string
  baked into code — all sourced from a branding/tenant config.
- **Clean from scratch.** New codebase, new repo — not a patch on the old
  one — following the domains → application → infrastructure → api layering.

---

## Pass 0 — Foundation & Contracts (no business features yet)

Goal: an empty but fully wired skeleton that boots, authenticates, logs,
and audits — before a single business domain is touched.

- Repo scaffold matching target architecture (`domains/`, `application/`,
  `infrastructure/`, `api/`, `core/`)
- Centralized configuration system (one settings module, no scattered
  env reads) — includes a **branding/tenant config** (name, logo URL,
  color tokens, terminology overrides) consumed by frontend at runtime,
  never compiled in
- Auth & permission core: JWT flow, role model, **admin-configurable
  permission matrix** (not hardcoded role checks in route handlers)
- Audit infrastructure: immutable audit log (who/what/when/before/after),
  a single `audit()` call available to every use case — not bolted on
  per-module later
- Consistent error model (validation / auth / authz / not-found /
  conflict / business-rule / infra), no raw exceptions leaked
- Structured logging + request IDs + error IDs
- CI: lint, type-check, test run on every push
- **Exit criteria:** empty app boots, login works, an audit entry is
  provably written and queryable, no domain logic exists yet

## Pass 1 — Master Data Domains (parity, not features)

Customers, Suppliers, Supplier Materials, Raw Materials, Products,
Machines — the "simple CRUD" domains, migrated first because they
validate the domain/application/infra pattern cheaply before it's
applied to the harder domains.

- One domain module per entity, each owning its own rules, DTOs, and
  use cases (`CreateCustomer`, `UpdateSupplier`, etc.) — not a shared
  generic CRUD engine that obscures what each domain actually allows
- Soft delete + restore + history as a reusable **capability**, not a
  reusable **god class** (composition over a giant base class)
- Admin-configurable: which fields are required/searchable/filterable
  per entity, without a code change
- Parity tests per entity against the checklist (create/read/list/
  update/history/delete/restore)
- **Exit criteria:** all master-data parity checklist items checked,
  running side-by-side comparable against current `jdk_clean` behavior

## Pass 2 — Transactional Core (the hard domains)

Quotations, Deals, Orders, Purchase Orders, Delivery Notes, BOM,
Feasibility, Production Schedules, MRP, Inventory, Calendar.

- Explicit state machines for every lifecycle (quotation, order,
  purchase order, production schedule) — replacing scattered
  `if status == ...` — with **admin-configurable transition rules**
  where the business genuinely varies by tenant (e.g. approval steps)
- Transaction boundaries made explicit for multi-step operations
  (create order → reserve inventory → create lines → update totals)
- Business rules (pricing, feasibility, MRP calculation, stock
  availability) each get exactly one authoritative implementation,
  covered by unit tests as the top test priority
- Number series as a configurable service (formats/prefixes/resets
  editable by admin, not hardcoded per entity)
- **Exit criteria:** full order→delivery and quotation→order journeys
  pass parity tests end-to-end against real data

## Pass 3 — Adapters & Integrations

PDF generation, email, signatures, notifications, AI assistant.

- Each integration becomes a swappable adapter behind an interface
  (domain says "send confirmation", adapter decides email/WhatsApp/etc.)
- PDF/branding templates pull from the tenant branding config —
  **zero hardcoded company name/logo in template code**
- Idempotency on anything retryable (emails, PDF jobs, notifications)
- Background jobs for anything long-running, out of the request path
- **Exit criteria:** every integration replaceable via config/interface
  swap without touching domain code, proven by swapping one in tests

## Pass 4 — Admin Configuration Surface

This pass makes Pass 0–3's "configurable" promises real and usable —
a real admin UI, not just config files.

- Branding admin: company name, logo, colors, terminology — live
  preview, applies without redeploy
- Workflow admin: which states exist, which transitions are allowed,
  who can perform them
- Permission admin: page/action matrix editable per role
- Number series admin: formats, prefixes, reset rules
- Notification channel admin: which events notify whom, via what channel
- **Exit criteria:** a non-developer can change branding, a workflow
  transition, and a permission rule, entirely through the UI

## Pass 5 — Auditability & Accountability Hardening

Everything up to now logs; this pass makes the log trustworthy and usable.

- Audit log UI: per-record history, per-user activity, filterable/
  exportable
- Approval trails on every workflow that needs sign-off (quotation
  approval, PO approval) — who approved, when, previous state
- Tamper-evidence: audit entries are append-only, no update/delete path
- Access log: who viewed sensitive records, not just who changed them
- **Exit criteria:** any state change in the system can be answered with
  "who did this, when, and what did it look like before" without
  touching the database directly

## Pass 6 — Performance & User Friendliness

- Query/index audit against real data volumes; N+1 elimination
- Pagination/caching on high-traffic list views
- Frontend: loading states, optimistic updates, consistent UX patterns
  standardized across all list/detail/form pages (not per-page ad hoc)
- Global search performance pass
- Load test against realistic transaction volume
- **Exit criteria:** defined performance budget met (list views, PDF
  generation, dashboard load) under realistic data volume

## Pass 7 — Cutover

- Data migration scripts from `jdk_clean`'s schema, dry-run + validated
- Parallel-run period against production data (read-only shadow)
- Full parity checklist signed off
- Cutover, `jdk_clean` frozen/archived

---

## Sequencing notes

- Pass 0 and Pass 1 are the highest-leverage passes: they prove the
  architecture pattern cheaply. Don't start Pass 2 until Pass 1's
  pattern feels right — changing it later is expensive across every domain.
- Passes 4 and 5 (admin config, audit hardening) are pulled forward
  from "polish at the end" because they're explicit requirements here,
  not nice-to-haves — every domain built in Pass 1–3 should already be
  built *with* configurability and audit hooks, not retrofitted in Pass 4/5.
  Pass 4/5 are where the UI and hardening catch up to what the domain
  layer already supports.
- Each pass produces a running, demoable increment — never a multi-week
  black box.
