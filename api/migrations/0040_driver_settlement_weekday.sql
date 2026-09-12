-- 0040_driver_settlement_weekday.sql
--
-- GAP-135/D-5, 12 Sept 2026. DM D-5 records that `obligation.effective_due_on`
-- was meant to be derived from `driver.settlement_rhythm`, and never was —
-- the write path was guarded instead (17 Aug 2026, `SETTLEMENT_RHYTHM_UNSUPPORTED`)
-- rather than left silently wrong. Guarding the write is not the same as
-- building the derivation, and the derivation could not be built on the
-- schema as it stood: `settlement_rhythm` says a driver settles `'weekly'`,
-- but nothing anywhere records *which* day. UC-37/UC-78/F-4.5 all state the
-- rule as "a driver who settles every Friday" — the day is load-bearing,
-- not a detail, and had nowhere to live.
--
-- `smallint`, 0..6, Sunday = 0 — deliberately not ISO 8601's 1..7. This
-- schema already has a column recording exactly this kind of fact,
-- `daily_lease_pattern.pattern_weekdays` (migration 0001), and it uses
-- Postgres's own `EXTRACT(dow ...)` convention (0=Sunday), the same one
-- `weekdayOf()` (packages/shared/src/dates.ts) already returns. A second
-- weekday column choosing a different base would be two conventions for
-- one fact in one schema, discovered by whoever next has to convert
-- between them.
--
-- The CHECK pairs the two columns rather than leaving `settlement_weekday`
-- merely nullable: `'daily'` requires NULL, `'weekly'` requires a real
-- 0..6 value. This is what makes the derivation total once it is written —
-- `'weekly'` with no weekday would be exactly the "column exists, is
-- never populated, and is quietly assumed" failure that created this gap
-- in the first place (D-5's own history). No CHECK exists today pinning
-- `settlement_rhythm` itself to `'daily'` (deliberately, per D-5 — the
-- rhythm stays licensed), so this is the one place the pair is enforced.
--
-- No backfill. Verified against both live environments before writing
-- this migration, not assumed from "no endpoint writes the column" (that
-- argument proves the column is inert, not that every row is `'daily'`):
-- production's `driver` table currently has zero rows, and QA's six rows
-- are all `'daily'`. Every existing row already satisfies the CHECK with
-- `settlement_weekday IS NULL`.
ALTER TABLE driver
  ADD COLUMN settlement_weekday smallint;

-- `IS NOT NULL` stated explicitly in the weekly branch, not left implicit
-- in `BETWEEN` — a three-valued-logic trap, caught against a live branch
-- rather than assumed: `BETWEEN 0 AND 6` against a NULL evaluates to NULL,
-- not FALSE, and a CHECK only refuses a row on FALSE — NULL passes the
-- same as TRUE does. Without this, `('weekly', NULL)` inserted cleanly.
ALTER TABLE driver
  ADD CONSTRAINT driver_settlement_weekday_check
  CHECK (
    (settlement_rhythm = 'daily' AND settlement_weekday IS NULL)
    OR (settlement_rhythm = 'weekly' AND settlement_weekday IS NOT NULL
        AND settlement_weekday BETWEEN 0 AND 6)
  );
