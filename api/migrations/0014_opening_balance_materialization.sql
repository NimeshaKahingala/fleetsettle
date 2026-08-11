-- 0014_opening_balance_materialization.sql
--
-- GAP-103/F3: committing an opening-balance batch has only ever flipped
-- opening_balance_batch.status. None of the six entry kinds ever became an
-- obligation, deposit or advance row, so every report that reads those
-- tables — "Who owes us", "Where is our cash", a driver's own two balances —
-- is blind to a business's real starting position from the moment it goes
-- live. Decided: materialise on commit, into the exact tables those reports
-- already read, rather than a second ledger every report would need a new
-- UNION to know about.
--
-- 'opening_balance' is the new obligation.kind this migration admits, for
-- the three entry kinds a receivable/payable already models honestly
-- (customer_due, driver_arrears, owed_to_driver). Widening a CHECK is
-- additive — every existing row's kind is already in the old set, so it
-- still satisfies the new one (same reasoning 0009 recorded for
-- 'trip_fare'). Constraint name confirmed unchanged since 0009's own header
-- recorded it as Postgres-generated and still `obligation_kind_check`.
ALTER TABLE obligation DROP CONSTRAINT obligation_kind_check; -- allow: widening a CHECK is additive, see header
ALTER TABLE obligation ADD CONSTRAINT obligation_kind_check CHECK (kind IN
  ('rent','mileage_excess','daily_amount','driver_fee','post_closure_charge',
   'customer_contribution','management_fee','trip_fare','opening_balance','other'));

-- deposit_held, advance_outstanding and cash_held have no source_type/
-- source_id column to record where they came from — deposit, advance and
-- payment never carried one (unlike obligation). A correction (F-0.2's own
-- "editable until the first period closes" clause) has to find and reverse
-- whatever a prior commit posted before re-posting the corrected figures,
-- so this table is the only durable link between one opening_balance_entry
-- and the row(s) it produced elsewhere, for all six kinds uniformly —
-- including the three obligation-backed ones, which could use
-- source_type/source_id instead but are kept on the same mechanism so
-- there is exactly one reversal code path, not two.
--
-- Deliberately NOT a money table by the write-migration checklist: it
-- holds no amount_minor and states no fact of its own (the row it points
-- at is the fact; this is only "which row"), so it carries no
-- posted_period_id, no voided_* trio and is NOT added to
-- assert_period_open()'s array — the same reasoning 0013 recorded for
-- attachment, and the same reasoning opening_balance_entry's own
-- 0001-era comment already gives for itself. reversed_at is this table's
-- own bookkeeping for "has a later correction already neutralised this
-- posting", not a W-50 void of a money fact — the money fact's own void
-- (obligation, advance) or offsetting entry (deposit_movement, payment)
-- is what actually reverses the figure a report reads.
CREATE TABLE opening_balance_posting (
  id            uuid PRIMARY KEY,
  business_id   uuid NOT NULL REFERENCES business(id),
  batch_id      uuid NOT NULL REFERENCES opening_balance_batch(id),
  entry_kind    text NOT NULL CHECK (entry_kind IN
                  ('customer_due','driver_arrears','owed_to_driver',
                   'deposit_held','advance_outstanding','cash_held')),
  target_table  text NOT NULL CHECK (target_table IN
                  ('obligation','deposit_movement','advance','payment')),
  target_id     uuid NOT NULL,
  -- Only set when target_table = 'deposit_movement': the parent deposit
  -- row a correction's offsetting movement must post against. deposit
  -- itself carries no posted_period_id (0001 never gave it one; only its
  -- child deposit_movement is period-gated), so this is a plain pointer,
  -- not a second FK a trigger needs to know about.
  deposit_id    uuid,
  reversed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The reversal scan every correction runs: "everything this batch posted
-- that a later correction hasn't already neutralised."
CREATE INDEX opening_balance_posting_active
  ON opening_balance_posting (batch_id)
  WHERE reversed_at IS NULL;
