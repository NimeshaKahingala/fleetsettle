-- 0031_archive_guard_and_missing_constraints.sql
--
-- GAP-178, PR A. Three constraint gaps the schema has carried since 0001,
-- plus the archived-party guard that closes B13's remaining half.
--
-- Grouped into one migration because they share a property: each is a rule
-- the application already believes and the database has never enforced, so
-- every one of them can only be violated by a path nobody reviewed.

-- ---------------------------------------------------------------------------
-- B20. The four money columns with no CHECK at all.
--
-- Found by asking pg_constraint, not by reading migrations: an earlier pass
-- read `rent_amount_minor` as already covered, having matched `lease`'s
-- column rather than `billing_period`'s. They are different columns on
-- different tables and only one of them carried a CHECK.
--
-- All four take `>= 0`, not `> 0`, and the distinction is the codebase's own
-- convention rather than a preference: `> 0` guards an amount a person
-- typed, `>= 0` guards an accumulator or a rate. Three of these four default
-- to 0 and are incremented as money arrives — `> 0` would refuse the row at
-- the moment it is created.
--
-- `insurance_claim.received_amount_minor` is nullable. A CHECK passes NULL
-- unevaluated, so this implies no NOT NULL and none is intended: a claim
-- that has never paid out is a different fact from one that paid zero.
ALTER TABLE billing_period
  ADD CONSTRAINT billing_period_rent_amount_minor_check
  CHECK (rent_amount_minor >= 0);

ALTER TABLE incident_recovery
  ADD CONSTRAINT incident_recovery_received_amount_minor_check
  CHECK (received_amount_minor >= 0);

ALTER TABLE insurance_claim
  ADD CONSTRAINT insurance_claim_excess_borne_minor_check
  CHECK (excess_borne_minor >= 0);

ALTER TABLE insurance_claim
  ADD CONSTRAINT insurance_claim_received_amount_minor_check
  CHECK (received_amount_minor >= 0);

-- ---------------------------------------------------------------------------
-- B19. One live recovery per (incident, source).
--
-- Two managers agreeing the same recovery at once do not collide today —
-- they both succeed, and the incident carries two claims against one source
-- forever. Nothing surfaces it, because each row is individually valid.
--
-- `WHERE voided_at IS NULL` is not a refinement, it is the constraint. Money
-- is append-only and a correction voids and replaces (W-50), so an
-- unconstrained UNIQUE would make the first wrong claim permanently
-- uncorrectable: the replacement could never be inserted alongside the row
-- it replaces.
--
-- Safe against the settlement path: `settleInsuranceClaim` updates
-- `received_amount_minor` on the existing row rather than inserting a second.
CREATE UNIQUE INDEX incident_recovery_one_live_per_source
  ON incident_recovery (incident_id, source)
  WHERE voided_at IS NULL;

-- ---------------------------------------------------------------------------
-- B13. No new money against an archived party.
--
-- `archiveDriver`/`archiveCustomer` check for open money (W-60) and then
-- write, with the read outside the transaction. Between the two, another
-- request can raise a due, take a deposit or confirm a day against the party
-- being archived — and the archive succeeds, because the check already
-- passed. The result is an archived party carrying live money, which is the
-- one state W-60 exists to prevent.
--
-- Moving the check inside the transaction (PR B) closes the archive side.
-- This closes the money side, and it has to be a trigger rather than a
-- FOR SHARE on each write path for one reason: "did every money path take
-- the lock?" is answerable only by reading all of them, and a money table
-- added next year would reopen the race in silence. A trigger is answerable
-- by asking the catalogue, which is what assert-no-archive-guard-drift.sql
-- then does in CI.
--
-- INSERT only, deliberately.
--
-- W-60 refuses archiving while money is still *open*, so what remains after
-- archival is settled history. U-5 promises every figure stays correctable,
-- and W-50 makes that correction a void — which is an UPDATE. A trigger
-- firing on UPDATE would refuse a documented correction to an archived
-- party's own history, breaking U-5 to enforce a rule W-60 never asked for.
-- INSERT-only also states the rule the way the business states it: no *new*
-- money against this party, not this party's past is frozen.
--
-- A late fact for an archived party (§6.14/W-35 — a fine arriving after the
-- deposit went back) is an INSERT and is refused here. That is the intended
-- answer, not a gap: the path is unarchive, record it, re-archive, and both
-- unarchive functions already exist. A party still receiving charges is not
-- gone, and being made to say so is the point.
--
-- Its own SQLSTATE rather than a fifth P0001.
--
-- Four application-side matchers already disambiguate P0001 raisers by
-- substring-matching their message text (db/pg-error.ts) — a fragility filed
-- as B18 in this same step. Adding a fifth would be widening the defect
-- while pinning it. FS001 is in an unused class, so the matcher for this one
-- keys on the code alone and no message text is load-bearing.
CREATE OR REPLACE FUNCTION assert_party_not_archived() RETURNS trigger AS $$
DECLARE
  row_json jsonb := to_jsonb(NEW);
  driver_ref   uuid;
  customer_ref uuid;
BEGIN
  -- Read through jsonb rather than NEW.<column>: the guarded tables spell the
  -- reference four different ways and no single table has all four, so a
  -- direct reference would raise on every table missing that column. One
  -- function serves all of them, the same way write_audit_log() does.
  driver_ref := COALESCE(row_json ->> 'driver_id', row_json ->> 'party_driver_id')::uuid;
  customer_ref := COALESCE(row_json ->> 'customer_id', row_json ->> 'party_customer_id')::uuid;

  IF driver_ref IS NOT NULL
     AND EXISTS (SELECT 1 FROM driver d
                  WHERE d.id = driver_ref AND d.voided_at IS NOT NULL) THEN
    RAISE EXCEPTION 'party is archived: driver %', driver_ref
      USING ERRCODE = 'FS001';
  END IF;

  IF customer_ref IS NOT NULL
     AND EXISTS (SELECT 1 FROM customer c
                  WHERE c.id = customer_ref AND c.voided_at IS NOT NULL) THEN
    RAISE EXCEPTION 'party is archived: customer %', customer_ref
      USING ERRCODE = 'FS001';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Where it applies.
--
-- Derived from the catalogue, for the reason 0002 gives at length: §13's
-- hand-maintained period-open array has already drifted, and a second
-- hand-maintained list is a second chance to make the same mistake. The
-- membership test here is "a money table that names a party" — carries
-- posted_period_id, and carries at least one of the four party columns.
--
-- Like 0002's block this runs once, so a party-referencing money table
-- created later gets no trigger from it. That is what the drift assertion is
-- for: it fails CI rather than going quiet.
--
-- What this test does *not* reach, said plainly rather than left to be
-- discovered: `deposit` and `opening_balance_entry` both name a party and
-- neither carries `posted_period_id`, so neither is guarded here. For
-- `deposit` that is a real if narrow gap — the parent row is a container and
-- the money lives in `deposit_movement`, which names the deposit rather than
-- the party — so taking a *new* deposit from an archived driver is still
-- possible. W-60 makes it unlikely (a party cannot be archived while holding
-- one) but not impossible. Filed rather than widened: the alternative
-- membership test, "names a party" without the money qualifier, pulls in
-- `lease`, `daily_lease` and `driver_link_invite`, which are arrangements and
-- identity rather than money and want a different answer.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM pg_attribute p
                    WHERE p.attrelid = c.oid AND NOT p.attisdropped
                      AND p.attname = 'posted_period_id')
       AND EXISTS (SELECT 1 FROM pg_attribute p
                    WHERE p.attrelid = c.oid AND NOT p.attisdropped
                      AND p.attname IN ('driver_id', 'customer_id',
                                        'party_driver_id', 'party_customer_id'))
     ORDER BY c.relname
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_archive_guard BEFORE INSERT ON %I '
      'FOR EACH ROW EXECUTE FUNCTION assert_party_not_archived()', t, t);
  END LOOP;
END $$;
