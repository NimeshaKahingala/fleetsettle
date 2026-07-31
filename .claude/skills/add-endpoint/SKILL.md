---
name: add-endpoint
description: Add or change a Worker API endpoint in FleetSettle. Use when building any backend route, handler, query or domain write path — it carries the fixed layer order and the traps specific to this money schema (period triggers, bigint money, business_id scoping, the linked-driver test class).
---

# Adding an endpoint

Read the flow's entry in `docs/product/user-flows.md` first. Its **Writes** line tells you which tables, and its **Accept** clauses are the test cases — they are written to be executable, so do not paraphrase them.

## The order (IG §3.2). Do not skip forward.

1. **`constants/`** — new literal tuples, if any.
2. **`schemas/<resource>.ts`** — request, response, DB row.
   - **Money fields are `z.string()`**, never `z.number()`. That is the wire shape; `bigint` is the domain shape.
3. **`queries/<resource>.ts`** — `async (db: Db, …)`. No Hono, no `c`, no auth. Parameterised only.
4. **`domain/<flow>.ts`** — required if the write touches more than one table. Do not inline a multi-statement write in a handler.
5. **`route-defs/<resource>.ts`** — declare **every** status the handler can produce, including the invariant ones below.
6. **`handlers/<resource>.ts`** — read the business from `c.get("businessId")`.
7. **`routes/<resource>.ts`** — wiring only. Mount in `index.ts`.
8. **Tests** (below), then update docs if behaviour changed.

## Traps specific to this schema

- **`business_id` comes from the verified token, never the request body.** Not as a fallback, not as an override, not "for testing".
- **Multi-statement writes are one transaction.** Confirming a day is four inserts; a partial write leaves a day confirmed but unpaid.
- **Do not pre-check whether the period is open.** `assert_period_open()` is the truth. Catch the violation and return `PERIOD_CLOSED` — an application pre-check will eventually disagree with the trigger.
- **Bulk operations use `insert … select` / `update … from`.** Never loop over rows issuing queries; Worker CPU is bounded per invocation.
- **Aggregation happens in SQL.** The report queries in `docs/engineering/data-model.md` §15 are implementations, not sketches — use them rather than re-deriving.
- **A unique-constraint violation on a cron path is success**, not a 500. Idempotency lives in the constraints.
- **Reports return "not available", never `0`,** when the data is missing (W-56).

## Status codes

| Situation | Code |
|---|---|
| Row missing **or another business's** | 404 `NOT_FOUND` |
| Role lacks the capability (W-49) | 403 `FORBIDDEN_CAPABILITY` |
| Write into a closed period | 409 `PERIOD_CLOSED` |
| Vehicle double-booked (INV-1) | 409 |
| Trip close with an unreconciled advance (INV-17) | 409 |

Cross-tenant is **404, never 403** — a 403 confirms the row exists.

## Test matrix — every endpoint

Happy path · 401 missing header · 401 verifier throws · 403 capability · **404 belongs to another business** · 409 on its invariant, if it has one · `PERIOD_CLOSED` where a period is involved.

**Plus, if the endpoint touches driver data:** a linked-driver token must receive 404 for every other driver's record, including via reports and exports. W-49 calls that boundary a security requirement, and a security requirement without a test is a hope.

Never mock the database. This schema's correctness is largely its constraints, and a mock has none of them.
