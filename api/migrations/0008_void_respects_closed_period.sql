-- 0008_void_respects_closed_period.sql
--
-- GAP-35: voiding a record posted into a closed accounting period was
-- refused by nothing. Migration 0006 made assert_period_open() return early
-- on any UPDATE that leaves posted_period_id untouched — correct for
-- settling a July obligation with an August payment, since that update
-- posts nothing new into July. But a void also leaves posted_period_id
-- untouched (it only sets voided_at), and a void is a new reversal fact,
-- not an incidental update to some other column: voiding a July expense
-- after July closes silently changes July's reported costs. voidExpense's
-- own comment even documented this as intentional — "which is what lets
-- this land even after the expense's own period has closed" — the exact
-- "wrong, plausible, unnoticed for months" failure CLAUDE.md exists to
-- prevent, and it was live.
--
-- The fix narrows 0006's exception rather than removing it: an UPDATE that
-- leaves posted_period_id untouched still skips the closed-period check,
-- *unless* it is also the voided_at transition NULL -> NOT NULL, in which
-- case the check applies as if it were a new post. Every other
-- posted-period-preserving update (settling an obligation, correcting a
-- payment, recording a claim settlement) is unaffected.
--
-- assert_period_open() is attached to 19 tables (0001's FOREACH block) but
-- only 13 of them carry voided_at — the six without are payment,
-- day_record, mileage_assessment, payment_correction, insurance_claim and
-- trip. A test that names NEW.voided_at/OLD.voided_at directly would fail
-- on those six with "record ... has no field ...", so the test goes
-- through to_jsonb instead, which is legal on a row with no such column
-- (it simply reads NULL from the ->> operator).
CREATE OR REPLACE FUNCTION assert_period_open() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.posted_period_id IS NOT DISTINCT FROM OLD.posted_period_id THEN
    -- A void (voided_at NULL -> NOT NULL) is a new reversal fact and must
    -- still obey the closed-period rule even though posted_period_id itself
    -- is unchanged. to_jsonb keeps this legal on the six trigger tables
    -- with no voided_at column at all (GAP-35).
    IF (to_jsonb(OLD) ->> 'voided_at') IS NULL
       AND (to_jsonb(NEW) ->> 'voided_at') IS NOT NULL THEN
      NULL; -- fall through to the closed check below
    ELSE
      RETURN NEW; -- 0006's case, unchanged: not a new post, let it through
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM accounting_period
             WHERE id = NEW.posted_period_id AND status = 'closed') THEN
    RAISE EXCEPTION 'accounting period % is closed; post to the open period with '
                    'belongs_to_period_id set (W-35)', NEW.posted_period_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
