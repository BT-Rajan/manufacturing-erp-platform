# manufacturing-erp-platform

Clean-slate, fully configurable manufacturing ERP platform. Ground-up
rewrite superseding `jdk`, `jdk_clean`, and `jdkv2` — same business
domain (cement manufacturing ERP: customers, suppliers, products,
inventory, procurement, sales, orders, production, scheduling), rebuilt
on an explicit domain-driven architecture with no loss of existing
functionality.

## Non-negotiables

- **No loss of function.** See [`docs/PARITY_CHECKLIST.md`](docs/PARITY_CHECKLIST.md).
- **Everything admin-configurable.** No hardcoded business rules an admin
  should reasonably control (workflow states, permissions, branding,
  number formats, notification routing).
- **Truly auditable & accountable.** Every state change is attributed
  and logged with before/after values, immutably.
- **No hardcoded branding.** No company name, logo, color, or copy
  baked into code — sourced from a tenant/branding config.
- **Clean architecture.** See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Status

Pass 0 (foundation) — repo scaffolded, plan and architecture documented,
no domain code yet. See [`docs/PLAN.md`](docs/PLAN.md) for the full
multi-pass roadmap.

## Docs

- [`docs/PLAN.md`](docs/PLAN.md) — multi-pass development plan
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — target architecture and the
  rules it exists to enforce
- [`docs/PARITY_CHECKLIST.md`](docs/PARITY_CHECKLIST.md) — the zero-loss
  contract against the current system
