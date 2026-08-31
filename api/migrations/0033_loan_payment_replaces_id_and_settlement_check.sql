-- 0033_loan_payment_replaces_id_and_settlement_check.sql
--
-- GAP-190/N4+N6. Two gaps in `0032_vehicle_loans.sql`'s own `loan_payment`
-- DDL, found validating an external evaluation against current code rather
-- than assumed away.
--
-- N4: `loan_payment` carries `replaces_id` (0032:59) like every other W-50
-- table, but 0025 — which gave all thirteen *existing* tables a partial
-- unique index on it — predates loan_payment by seven migrations, so it was
-- simply never included. Without the index, two concurrent "record the
-- correct one" requests could both name the same voided payment as what
-- they replace, the identical race 0025's own comment describes.
CREATE UNIQUE INDEX loan_payment_replaces_id_key ON loan_payment (replaces_id) WHERE replaces_id IS NOT NULL;

-- N6: `CHECK (amount_minor > 0 OR is_settlement = true)` admits a negative
-- amount whenever is_settlement is true — the clause only ever meant to
-- carve out the zero case `2847794` added (a lender forgiving the entire
-- balance), not to drop the floor on settlements altogether. Re-stated
-- rather than dropped-and-reinstated as a bare `>= 0`, so the
-- ordinary-payment half (amount_minor > 0) is untouched and 2847794's
-- full-forgiveness case (settlement = 0) still passes.
--
-- Confirmed against a live branch rather than assumed, the same discipline
-- 0031's own comment names: this clause spans two columns (amount_minor,
-- is_settlement), so Postgres registers it as a table-level constraint —
-- `loan_payment_check`, not `loan_payment_amount_minor_check` — despite
-- being written inline after amount_minor in 0032's DDL.
ALTER TABLE loan_payment DROP CONSTRAINT loan_payment_check; -- allow: a narrowing, not a widening — the new clause rejects a negative amount_minor with is_settlement = true, which the old one admitted. Safe against existing rows because no write path can ever have produced one: recordLoanPaymentRequestSchema.amountMinor is positiveMoneyWireSchema, and settleVehicleLoanRequestSchema.settlementAmountMinor refines >= 0n, so the case being closed was admitted by the constraint but unreachable through the API
ALTER TABLE loan_payment ADD CONSTRAINT loan_payment_check
  CHECK (amount_minor > 0 OR (is_settlement = true AND amount_minor >= 0));
