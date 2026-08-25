-- 0032_vehicle_loans.sql
--
-- GAP-185/F-12, UC-106..UC-108, W-68..W-70. Schema for `data-model.md` §4.4,
-- decided 23 Aug 2026 and unchanged since. A financed vehicle, scoped
-- through vehicle_id exactly as ownership_share is.

ALTER TABLE vehicle ADD COLUMN purchase_cost_minor bigint; -- nullable: U-2, never required to save a vehicle

CREATE TABLE vehicle_loan (
  id                     uuid PRIMARY KEY,
  vehicle_id             uuid NOT NULL REFERENCES vehicle(id),
  lender                 text NOT NULL,
  liability_owner        uuid REFERENCES app_user(id),   -- NULL = the business carries it (UC-107)
  principal_minor        bigint NOT NULL CHECK (principal_minor > 0),
  total_repayable_minor  bigint NOT NULL,
  term_months            integer NOT NULL CHECK (term_months > 0),
  monthly_payment_minor  bigint CHECK (monthly_payment_minor > 0),
  payment_day            integer CHECK (payment_day BETWEEN 1 AND 31),
  -- W-68. One permitted value, so the assumption is visible in the schema
  -- rather than buried in a formula. Admitting 'reducing' later is a CHECK
  -- change, not a restructure. Immutable once a payment exists — enforced by
  -- trigger below, not by application code.
  amortisation_method    text NOT NULL DEFAULT 'flat' CHECK (amortisation_method IN ('flat')),
  down_payment_minor     bigint CHECK (down_payment_minor > 0),
  down_payment_by_user_id uuid REFERENCES app_user(id),
  started_on             date NOT NULL,
  closed_on              date,
  CHECK (total_repayable_minor >= principal_minor),
  -- A down payment names exactly one funder, or neither is set (W-52, UC-106).
  CHECK ((down_payment_minor IS NULL) = (down_payment_by_user_id IS NULL))
);
CREATE INDEX vehicle_loan_vehicle ON vehicle_loan (vehicle_id) WHERE closed_on IS NULL;

-- A money table. Everything in DM §10's conventions applies.
CREATE TABLE loan_payment (
  id            uuid PRIMARY KEY,
  business_id   uuid NOT NULL REFERENCES business(id),
  loan_id       uuid NOT NULL REFERENCES vehicle_loan(id),
  -- Copilot review, PR #130: an ordinary payment of nothing is not a
  -- payment (GAP-177's own reasoning — amount_minor > 0), but a
  -- settlement can legitimately be 0: a lender forgiving the entire
  -- remaining balance is F-12.3's own "settlement < principal
  -- outstanding" case taken to its limit, and the design's Post clause
  -- ("one closing loan_payment... closed_on set") is unconditional on the
  -- amount. The row must still exist to close the loan and carry
  -- waived_minor.
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0 OR is_settlement = true),
  paid_on       date NOT NULL,
  is_settlement boolean NOT NULL DEFAULT false,   -- UC-108, F-12.3
  -- W-69/INV-43: principal the lender forgave. A fact about the loan, never a
  -- money record — no income, no expense, no adjustment row anywhere.
  waived_minor  bigint NOT NULL DEFAULT 0 CHECK (waived_minor >= 0),
  note          text,
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),  -- W-35
  voided_at     timestamptz,                  -- W-50: voided, never deleted
  voided_reason text,
  voided_by     uuid REFERENCES app_user(id),
  replaces_id   uuid REFERENCES loan_payment(id),
  -- Correction to DM §4.4's DDL, found implementing it rather than assumed
  -- away: F-12.3/INV-43 require voiding a payment to void "its finance
  -- expense with it" — impossible without a stored link, and the doc's own
  -- table carries none. `write_off_recovery.payment_id` is this schema's
  -- existing precedent for the same shape ("record the fact as a field,
  -- never a guess" — domain/write-off.ts's own comment). Exactly one is set
  -- per payment, matching the loan's own liability_owner: `expense_id` when
  -- the business carries it, `partner_payout_id` when a named owner does.
  -- Both stay NULL on a settlement whose finance portion is zero (INV-43:
  -- "no money record is written" when settlement < principal outstanding).
  expense_id        uuid REFERENCES expense(id),
  partner_payout_id uuid REFERENCES partner_payout(id),
  CHECK (expense_id IS NULL OR partner_payout_id IS NULL)
);
CREATE INDEX loan_payment_loan ON loan_payment (loan_id, paid_on) WHERE voided_at IS NULL;

-- Two CHECK-constraint widenings, easy to forget because the tables above
-- look self-contained. Both confirmed against the live branch rather than
-- assumed unnamed:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'expense'::regclass AND contype = 'c';
--   SELECT conname FROM pg_constraint WHERE conrelid = 'partner_payout'::regclass AND contype = 'c';
-- return expense_category_check and partner_payout_kind_check.

-- UC §6.7's own row: always 'us', in all three arrangements.
ALTER TABLE expense DROP CONSTRAINT expense_category_check; -- allow: widening a CHECK is additive — every existing row's category is already in the old set, so it still satisfies the new one
ALTER TABLE expense ADD CONSTRAINT expense_category_check CHECK (category IN (
  'fuel','tolls','fines','cleaning','tyres','servicing','repairs',
  'insurance','licence','crew_food','permits','office','legal',
  'messaging','other','finance'));

-- UC-107: an owner's own loan paid from business cash is a drawing, not a cost.
ALTER TABLE partner_payout DROP CONSTRAINT partner_payout_kind_check; -- allow: widening a CHECK is additive, same reasoning as above
ALTER TABLE partner_payout ADD CONSTRAINT partner_payout_kind_check
  CHECK (kind IN ('payout','partner_settlement','loan_on_behalf'));

-- `loan_payment` is a money table, and two hand-maintained lists decide
-- whether it behaves like one — carrying posted_period_id is not enough on
-- its own, and neither omission fails at write time (DM §4.4/§13):
--
-- 1. assert_period_open()'s array (migration 0001, revised 0006) is a
--    literal ARRAY[...] of table names and ran once. A table created
--    afterwards gets no trigger unless one is written here by hand.
-- 2. write_audit_log()'s trigger is attached by a catalogue DO block in
--    migration 0002 that also ran once. Precedent: 0010 wrote
--    CREATE TRIGGER business_member_audit by hand for exactly this reason.
--
-- api/scripts/assert-no-trigger-drift.sql checks both triggers for every
-- table carrying posted_period_id and expects zero rows; check:drift runs it
-- in three workflows, so a missed table fails CI before reaching QA. No
-- bespoke test needed for either omission — the standing assertion covers
-- them (DM §4.4).
CREATE TRIGGER loan_payment_period_open
  BEFORE INSERT OR UPDATE ON loan_payment
  FOR EACH ROW EXECUTE FUNCTION assert_period_open();

CREATE TRIGGER loan_payment_audit
  AFTER INSERT OR UPDATE ON loan_payment
  FOR EACH ROW EXECUTE FUNCTION write_audit_log();

-- W-68/UC-106's own Accept clause ("amortisation_method is 'flat' and is the
-- only permitted value... immutable once a payment exists") is met by the
-- CHECK constraint above plus the absence of any writer that ever updates
-- the column after insert (no F-12 flow edits a loan's amortisation method).
-- No separate trigger: 'flat' being the only value the CHECK admits already
-- makes "changing method" unreachable, and a trigger guarding a column no
-- code ever writes is surface with nothing to test against — the same
-- judgement call this file's own DM §4.4 DDL makes by not including one.
