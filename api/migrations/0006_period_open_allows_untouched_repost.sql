-- 0006_period_open_allows_untouched_repost.sql
--
-- P8 (F-3.4/UC-12): an insurance claim is submitted while its period is open
-- and settled later, often after that period has closed — G-2's own fixture
-- has it submitted in July and settled in September, by which time July is
-- long closed. Recording the settlement is an UPDATE to the existing
-- insurance_claim/incident_recovery row (received_amount_minor,
-- received_on, received_period_id) — it does not repost anything into July,
-- it sets a second, independent period column that was designed for exactly
-- this (the comment on both tables: "claimed in one month, settled in
-- another"). But assert_period_open() checked NEW.posted_period_id on every
-- UPDATE unconditionally, so that update was rejected as if it were an
-- attempt to post a new fact into a closed month — confirmed against the
-- live test branch before writing this migration, not assumed.
--
-- The same gap sat latent in every other table the trigger covers:
-- `obligation` is updated by updateObligationSettled() whenever a payment
-- is allocated, and UC-11 explicitly describes paying rent late — a rent
-- obligation posted in July, settled by a payment in August, hits the exact
-- same rejection. No existing test crosses a period boundary between
-- posting and settling, which is why this was never caught (the same class
-- of gap DM §16.1 describes finding by actually running a fixture, not by
-- reading the schema).
--
-- The fix: only enforce the closed-period check when the write is actually
-- trying to post into (or re-post into) a period — an INSERT, or an UPDATE
-- that changes posted_period_id itself. An UPDATE that leaves
-- posted_period_id exactly as it was is not a new posting; it is a change
-- to some other fact about a row that already posted correctly, and W-35's
-- own belongs_to_period_id/received_period_id columns are what carry the
-- "when did this other thing actually happen" fact instead.
CREATE OR REPLACE FUNCTION assert_period_open() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.posted_period_id IS NOT DISTINCT FROM OLD.posted_period_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM accounting_period
             WHERE id = NEW.posted_period_id AND status = 'closed') THEN
    RAISE EXCEPTION 'accounting period % is closed; post to the open period with '
                    'belongs_to_period_id set (W-35)', NEW.posted_period_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
