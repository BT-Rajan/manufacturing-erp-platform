# Architecture

Clean. Explicit. Modular. Testable. Observable. Secure.

- Dependencies flow inward: `api` → `application` → `domains` ← `infrastructure`
- Business logic must be easy to find — one authoritative place per rule
- APIs stay thin: request → validate → authorize → execute use case → response
- Domains own their rules; external systems stay behind adapters
- Database structure must not dictate application structure
- No abstraction without a demonstrated need — duplicate twice, abstract
  when the pattern is proven
- No feature is complete without validation, authorization, error
  handling, and tests appropriate to its risk

## Stack

- **Language:** TypeScript, throughout — backend and frontend. No Python
  anywhere in this repo.
- **Runtime:** Node.js, single monolithic service (not microservices —
  see rule 30 below).
- **Database:** MySQL. Access via a typed query builder (Kysely) over
  `mysql2`, not a heavyweight ORM with generated magic — keeps SQL
  explicit and auditable per rule 9 (no hidden magic) and rule 8
  (database is not the domain).

## Layout

```
backend/
├── src/
│   ├── domains/            # customers, suppliers, products, inventory,
│   │                        # procurement, sales, orders, production,
│   │                        # scheduling, users, notifications, ...
│   │   └── <domain>/
│   │       ├── entities.ts      # domain entities (not DB row types)
│   │       ├── rules.ts         # business rules — one home per rule
│   │       └── stateMachine.ts  # where the domain has a lifecycle
│   │
│   ├── application/
│   │   ├── commands/       # createQuotation, approveQuotation, ...
│   │   ├── queries/
│   │   └── services/
│   │
│   ├── infrastructure/
│   │   ├── database/       # Kysely db instance, row types, repositories
│   │   ├── integrations/   # email, WhatsApp, AI, accounting adapters
│   │   ├── messaging/
│   │   └── storage/
│   │
│   ├── api/
│   │   ├── routes/         # thin — no business logic
│   │   ├── middleware/
│   │   └── dependencies/
│   │
│   ├── core/
│   │   ├── config/          # single source of settings, incl. branding/tenant config
│   │   ├── security/
│   │   ├── errors/
│   │   └── logging/
│   │
│   └── main.ts
│
├── tests/
├── migrations/
└── scripts/

frontend/                    # React + TypeScript (unchanged language,
                              # existing convention from jdk_clean)
```

## Rules this structure exists to enforce

1. **Product-first, not technical-convenience-first.** No `utils`/`common`
   dumping ground. Every domain has a clear owner.
2. **No business logic in route handlers.** If a handler is more than
   validate → authorize → call a use case → return, it's wrong.
3. **One authoritative implementation per business rule** (pricing, stock
   availability, order state transitions, feasibility, permissions,
   quotation calculations) — never duplicated across endpoints.
4. **Explicit use cases** for every important operation — named,
   testable, independent of HTTP.
5. **Strong typing everywhere** — request/response DTOs, domain models,
   database models, enums are all distinct and explicit; no untyped
   dicts passed around.
6. **State machines, not scattered conditionals**, for anything with a
   lifecycle.
7. **Authorization at the use-case boundary**, not just the route or UI.
8. **Idempotency** on anything retryable.
9. **No hidden magic** — no auto-registration, no implicit dependencies,
   no giant generic base classes that obscure what a domain does.

See `docs/PLAN.md` for how this gets built up pass by pass, and
`docs/PARITY_CHECKLIST.md` for the zero-loss contract against the
current system.
