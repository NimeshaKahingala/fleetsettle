---
paths:
  - "api/migrations/**/*.sql"
  - "**/*.sql"
---

# Writing SQL here

The full procedure is the `write-migration` skill. These are the facts that have already cost something, so they load whenever a `.sql` file is open rather than waiting to be asked for.

- **Money is `bigint` minor units.** Never `numeric`, `decimal`, `real`, `float` or `money` for an amount.
- **Never `CURRENT_DATE`.** Postgres evaluates it in the server's timezone, not `Asia/Colombo`. The business date is passed in as a parameter.
- **UUID primary keys**, `DEFAULT gen_random_uuid()`. Never `serial` — ids appear in URLs.
- **Forward-only.** No `DROP COLUMN`, no `DROP TABLE`, no `ALTER COLUMN … TYPE`. Add a new column and backfill. A wrong migration is fixed by another migration.
- **Numbered `NNNN_lower_snake_case.sql`**, applied in filename order.

**A new money table is not finished until its name is in the `assert_period_open()` trigger array.** Three tables were missing from it at one point — `advance_settlement`, `incident_recovery`, `insurance_claim` — and every one of them silently accepted writes into a closed accounting period. DM §13 carries the drift assertion; run it after any migration that adds a table.

Money tables also carry `business_id` (not nullable), `posted_period_id`, `belongs_to_period_id`, the `voided_*` trio, and timestamps. Anything a cron writes needs a unique key that makes a second run a no-op.

`npm run guard` checks the mechanical half of this. It cannot check the trigger array — that needs a database.
