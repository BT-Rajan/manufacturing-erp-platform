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

## Layout

```
backend/
├── app/
│   ├── domains/           # customers, suppliers, products, inventory,
│   │                       # procurement, sales, orders, production,
│   │                       # scheduling, users, notifications, ...
│   │   └── <domain>/
│   │       ├── models.py       # domain entities (not ORM models)
│   │       ├── rules.py        # business rules — one home per rule
│   │       └── state_machine.py (where the domain has a lifecycle)
│   │
│   ├── application/
│   │   ├── commands/       # CreateQuotation, ApproveQuotation, ...
│   │   ├── queries/
│   │   └── services/
│   │
│   ├── infrastructure/
│   │   ├── database/       # ORM models + repositories, separate from domain models
│   │   ├── integrations/   # email, WhatsApp, AI, accounting adapters
│   │   ├── messaging/
│   │   └── storage/
│   │
│   ├── api/
│   │   ├── routes/         # thin — no business logic
│   │   ├── middleware/
│   │   └── dependencies/
│   │
│   └── core/
│       ├── config/          # single source of settings, incl. branding/tenant config
│       ├── security/
│       ├── errors/
│       └── logging/
│
├── tests/
├── migrations/
└── scripts/
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
