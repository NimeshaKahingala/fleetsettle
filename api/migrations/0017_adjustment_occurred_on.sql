-- 0017_adjustment_occurred_on.sql
--
-- GAP-73. adjustment (0001) has no business-date column of its own — only
-- created_at (when the row was inserted) and posted_period_id. U-8 is
-- explicit that any record can be entered for a past date, so a waiver
-- given 15 June and entered 2 July was landing in July's report, and the
-- wrong year if it straddled one. occurred_on is the same shape every other
-- money table's own business-date column already has (payment.occurred_on,
-- deposit_movement.occurred_on, offset_record.occurred_on).
--
-- Backfilled from created_at::date rather than a literal default — the
-- closest available truth for any row entered before this column existed,
-- never today's date (CLAUDE.md: never treat "when this migration ran" as
-- a business date).
ALTER TABLE adjustment ADD COLUMN occurred_on date;
UPDATE adjustment SET occurred_on = created_at::date WHERE occurred_on IS NULL; -- allow: backfill from the best available prior fact, not a business-date default
ALTER TABLE adjustment ALTER COLUMN occurred_on SET NOT NULL;

-- Wiring occurred_on into belongs_to_period_id resolution, report grouping
-- by adjustment_type and windowing (GAP-73's report half) is Wave 4 —
-- this migration only adds the column and the two existing insert sites
-- that already compute a business date for resolvePeriodLinkage now also
-- write it here (domain/adjustment.ts, domain/mileage.ts).
