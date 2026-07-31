---
name: write-migration
description: Write or review a database migration for FleetSettle. Use for any schema change — it carries the forward-only rule, the columns every money table must have, and the trigger array that has already drifted once and silently lets writes into closed periods.
---

# Writing a migration

## Non-negotiables

- **Hand-written SQL, numbered `NNNN_description.sql`, applied in filename order, forward-only.** No generated diffs — the schema leans on exclusion constraints, partial unique indexes, deferred constraints, triggers and rules that a diff tool will not round-trip, and a money schema whose enforcement silently fails to migrate is the worst case available.
- **Never drop or rename a column** without explicit instruction. Add a new one and backfill.
- **A migration is never rolled back over live data.** If it is wrong, the fix is another migration.
- **Money is `bigint` minor units.** Never `numeric`, `float` or `real` for an amount.
- **UUID v4 primary keys**, `DEFAULT gen_random_uuid()`. Never serial — ids appear in URLs.

## Adding a money table — the checklist that has already been missed

A table that records money must carry **all** of:

- [ ] `business_id` — never nullable (W-39), with the composite FK for tenant isolation
- [ ] `posted_period_id NOT NULL` — the accounting period it posts to
- [ ] `belongs_to_period_id` — the period it *belongs* to, when it arrived late (W-35)
- [ ] `voided_at` / `voided_reason` / `voided_by` — money records are append-only; corrections void and replace (W-50)
- [ ] `created_at` / `updated_at` plus the shared `trigger_set_updated_at()`
- [ ] **Its name added to the `assert_period_open()` trigger array**

**That last one is the one that gets forgotten.** Three tables were missing from it at one point — `advance_settlement`, `incident_recovery`, `insurance_claim` — and every one of them silently accepted writes into a closed accounting period. `docs/engineering/data-model.md` §13 carries a drift assertion for exactly this. **Run it after any migration that adds a table:**

```sql
SELECT c.relname AS table_missing_period_trigger
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND a.attname = 'posted_period_id' AND NOT a.attisdropped
   AND NOT EXISTS (SELECT 1 FROM pg_trigger g
                    WHERE g.tgrelid = c.oid AND NOT g.tgisinternal
                      AND g.tgname = c.relname || '_period_open');
```

Expected: zero rows. Wire it into CI.

Also confirm the new table is covered by the `audit_log` trigger (D-8) — an audit trail with a gap is the stretch someone eventually needs.

## Idempotency is a constraint, not code

Anything a cron writes needs a unique key that makes a second run a no-op: `day_record` on `(daily_lease_id, business_date)`, `billing_period` on `(lease_id, seq)`, `message` on `(trigger, subject, stage)`. Add the equivalent for anything new.

## The runner

Two hardening items that must exist before the first migration lands:

- **A Postgres advisory lock** around the run — two concurrent deploys can otherwise both read an empty `_migrations` and both apply.
- **A SHA-256 checksum per filename** — an already-applied file that is later edited must fail loudly rather than be skipped.

## Verify

1. Apply to a **Neon branch**, never to `main` first. The free plan has no protected branches, so nothing at the platform level protects `main` — that guardrail is who holds console access.
2. Run the drift assertion above.
3. **Run the golden fixtures.** Any change that moves **134,000**, **15,000** or **7,500** is a breaking change and must fail loudly (FL §9.1).
4. Delete the branch when done — the free plan caps at 10 per project and branch creation starts failing at around nine.
