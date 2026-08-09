-- 0011_management_fee_obligation.sql
--
-- A10a/GAP-39/W-53: a management fee reduces the owner's vehicle profit
-- before shares — sumVehicleCostsForPeriod (queries/reports.ts) has read
-- obligation.kind = 'management_fee' since P7, but nothing has ever
-- inserted one; every managed vehicle has reported a management-fee cost of
-- zero, silently, since P7. This migration adds nothing to obligation's own
-- shape (already a money table, already in assert_period_open()'s array
-- since 0001/0002) — it adds only the idempotency key the new generator
-- needs, the same role billing_period's UNIQUE(lease_id, seq) plays for
-- generate-billing-periods.
--
-- Partial, not table-wide: obligation carries every kind this business
-- writes, and only a management-fee row raised by this generator is
-- supposed to be unique per (agreement, period) — a table-level constraint
-- would wrongly reach into rent/mileage_excess/driver_fee rows that share
-- no such rule.
CREATE UNIQUE INDEX obligation_management_fee_once
  ON obligation (source_id, posted_period_id)
  WHERE source_type = 'management_fee_agreement' AND voided_at IS NULL;
