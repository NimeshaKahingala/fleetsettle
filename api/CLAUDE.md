# api — the Worker

Root `CLAUDE.md` applies. This file adds only what is true of every file in this directory. The procedure for adding a route is the `add-endpoint` skill; the procedure for a schema change is `write-migration`.

## The layer order is one-directional

```
constants → schemas → queries → domain → route-defs → handlers → routes
```

Nothing imports from further right. `queries/` takes `(db, …)` and has never heard of HTTP; `domain/` exists so that a write touching more than one table is one transaction rather than a handler with four awaits in it. ESLint enforces the arrows — if a `no-restricted-imports` error looks wrong, the layering is wrong, not the rule.

## Three things this runtime does not have

- **No `process.env`.** Bindings arrive on the env object (TS §8).
- **No Node globals** — no `Buffer`, no `fs`. Web APIs only.
- **Bounded CPU per invocation.** Bulk work is `insert … select` / `update … from`, never a loop issuing one query per row.

## What goes wrong here specifically

- **`business_id` comes from `c.get("businessId")`**, resolved from the verified JWT. Not from the body, not as a fallback, not "for testing".
- **Do not pre-check the period.** `assert_period_open()` is the truth; catch the violation and map it to `PERIOD_CLOSED`. Two implementations of one rule diverge, and the one that loses is the database.
- **A unique-constraint violation on a cron path is success.** A job that fires twice is a no-op, not a page.
- **Cross-tenant is 404, never 403.** A 403 confirms the row exists.
- **No `console.*`.** Structured logging only, and never a request body — they carry NICs, phone numbers and amounts.

## Tests

Never mock the database. This schema's correctness is largely its constraints and a mock has none of them. Every endpoint covers: happy path · 401 missing header · 401 verifier throws · 403 capability · **404 belongs to another business** · 409 on its invariant · `PERIOD_CLOSED` where a period is involved.

If the endpoint touches driver data, add the linked-driver class: that token must get 404 for every other driver's record, including through reports and exports. W-49 makes that boundary a security requirement, and a security requirement without a test is a hope.
