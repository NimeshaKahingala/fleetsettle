# API Codex Instructions

Root `AGENTS.md` and root `CLAUDE.md` apply. This file adds API-specific
guidance for everything under `api/`.

Before changing API behavior, read `api/CLAUDE.md` and the owning spec section:

- Schema, constraints, triggers, reports: `docs/engineering/data-model.md`
- Endpoint behavior and acceptance criteria: `docs/product/user-flows.md`
- Implementation and testing rules: `docs/engineering/implementation-guidelines.md`
- Current open/closed gap state: `TRACKER.md`

## Layering

Keep imports moving in this direction only:

`constants -> schemas -> queries -> domain -> route-defs -> handlers -> routes`

Queries do not know HTTP. Domain code owns multi-table writes and transactions.
Handlers map request/response concerns and errors; they do not become business
logic modules.

## API Rules

- Resolve `business_id` from auth context, never from input.
- Never trust ids from the body without checking ownership and cross-field
  consistency.
- Cross-tenant is 404; missing capability is 403.
- Catch database invariants and map them to the existing app errors; do not
  duplicate database checks in application code when a constraint is the truth.
- Money writes are one transaction. If a write touches more than one money fact,
  it belongs in `domain/`.
- New money tables must be included in the period-open trigger and drift checks
  unless the migration documents why the table is not a money table.
- Migrations are hand-written SQL, numbered, forward-only, and include comments
  for non-obvious safety or exemption decisions.
- Cloudflare Worker code must not rely on Node globals, `fs`, `Buffer`, or
  `process.env`.
- No `console.*`; use the structured logging pattern already in the Worker.

## API Testing

For endpoint changes, cover the relevant matrix:

- Happy path.
- Missing/invalid auth.
- Capability denial.
- Cross-tenant access returns 404.
- Invariant failures return the expected app error.
- `PERIOD_CLOSED` behavior where a period-gated money table is involved.
- Linked-driver isolation when driver data is reachable.

For money/reporting changes, run or update the golden-fixture coverage and state
whether 134,000 / 15,000 / 7,500 moved.
