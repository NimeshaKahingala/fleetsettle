-- 0027_lease_day_exception_unique_live.sql
--
-- GAP-20. Migration 0018 gave `lease_day_exception` a plain
-- `UNIQUE (daily_lease_id, exception_date)` rather than the void-aware
-- partial form every other correctable table in this schema uses (0023's
-- `WHERE voided_at IS NULL` void-race guards, 0025's own
-- `WHERE replaces_id IS NOT NULL` indexes). `day_record`'s own plain unique
-- index on this exact column pair is safe for a documented reason
-- (data-model.md §7): a driver or arrangement change always opens a fresh
-- `daily_lease_id`, so a voided row and its replacement never share a key.
-- `lease_day_exception` has no such escape hatch — un-skipping a date
-- voids the exception under the *same* `daily_lease_id`, and skipping that
-- same date again later, for a different reason, is an entirely ordinary
-- correction (W-58). Today that second skip collides with the exact row
-- it just voided and fails on a bare unique-violation with nothing to map
-- it to.
ALTER TABLE lease_day_exception DROP CONSTRAINT lease_day_exception_daily_lease_id_exception_date_key; -- allow: relaxing to the partial form below — every existing live row already satisfies it, and no voided row needs its date slot held forever

CREATE UNIQUE INDEX lease_day_exception_daily_lease_id_exception_date_key
  ON lease_day_exception (daily_lease_id, exception_date)
  WHERE voided_at IS NULL;
