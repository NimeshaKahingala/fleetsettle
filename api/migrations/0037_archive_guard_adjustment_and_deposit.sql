-- 0037_archive_guard_adjustment_and_deposit.sql
--
-- GAP-208/NM-2/NM-3/GAP-187. Migration 0031's own comment named this gap
-- honestly rather than leaving it to be discovered: `archive_guarded_party_column`
-- derives its membership from two catalogue questions — does this table
-- carry `posted_period_id`, and does it have a direct foreign key to
-- `driver`/`customer` — and both `adjustment` and `deposit` fail one half
-- of that test for a real, different reason each. Neither can be reached by
-- widening the view itself (0031's own comment already explains why: doing
-- so pulls in `lease`, `daily_lease`, `driver_link_invite` and `message`,
-- which are arrangements, identity and correspondence rather than money and
-- want a different answer). Both are closed here, by hand, the way 0031's
-- own trailing comment said they would need to be.

-- ---------------------------------------------------------------------------
-- NM-2. `adjustment` reaches its party only through `obligation_id` — it has
-- no direct foreign key to `driver`/`customer` at all, so the view's own
-- membership test cannot see it no matter how it is phrased. A waiver or a
-- late fee against an archived party's obligation is exactly the "money
-- accrues against a party the business has already written off" failure
-- B13 exists to prevent — an adjustment does not move cash on its own, but
-- it changes what is owed, which is the same fact this guard protects
-- everywhere else it applies.
--
-- `assert_party_not_archived()` reads its target columns straight off `NEW`
-- — it has no way to look through a join, and widening it to do so would
-- turn one small, auditable function into a generic query planner for the
-- sake of one caller. A dedicated trigger function is more honest about
-- what it does: resolve `obligation_id` to that obligation's own party,
-- then apply the identical archived check and `replaces_id` exemption
-- (W-50's replace half, same reasoning as `assert_party_not_archived()`'s
-- own comment) that every other guarded table already gets.
CREATE OR REPLACE FUNCTION assert_adjustment_party_not_archived() RETURNS trigger AS $$
DECLARE
  ob obligation%ROWTYPE;
  prior_ob_id uuid;
  archived boolean;
BEGIN
  SELECT * INTO ob FROM obligation WHERE id = NEW.obligation_id;
  -- No row: a bad obligation_id is a foreign-key violation of its own,
  -- already refused by the column's REFERENCES clause. Nothing to check.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.replaces_id IS NOT NULL THEN
    SELECT obligation_id INTO prior_ob_id FROM adjustment WHERE id = NEW.replaces_id;
    IF prior_ob_id IS NOT DISTINCT FROM NEW.obligation_id THEN
      RETURN NEW;
    END IF;
  END IF;

  archived := NULL;
  -- FOR SHARE, and no voided_at filter in the WHERE — migration 0034's own
  -- correction to assert_party_not_archived(), which this function has to
  -- match rather than merely resemble. Filtering on status here means a
  -- still-active party (the common case) matches no rows, and a SELECT that
  -- returns no rows locks nothing: the archive-vs-insert race 0034 exists to
  -- close would be wide open again for exactly the tables this migration is
  -- adding. Lock the party row regardless of its status, then read the
  -- status off the locked row. Shared locks don't conflict with each other,
  -- so two ordinary adjustments against the same active party never block;
  -- only the FOR UPDATE an archive takes (domain/party-archive.ts) forces
  -- either side to wait.
  IF ob.party_type = 'driver' AND ob.party_driver_id IS NOT NULL THEN
    SELECT (d.voided_at IS NOT NULL) INTO archived FROM driver d
      WHERE d.id = ob.party_driver_id FOR SHARE;
  ELSIF ob.party_type = 'customer' AND ob.party_customer_id IS NOT NULL THEN
    SELECT (c.voided_at IS NOT NULL) INTO archived FROM customer c
      WHERE c.id = ob.party_customer_id FOR SHARE;
  END IF;

  IF archived THEN
    RAISE EXCEPTION 'party is archived: % (via adjustment.obligation_id -> obligation)', ob.party_type
      USING ERRCODE = 'FS001';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER adjustment_archive_guard BEFORE INSERT ON adjustment
  FOR EACH ROW EXECUTE FUNCTION assert_adjustment_party_not_archived();

-- ---------------------------------------------------------------------------
-- NM-3/GAP-187. `deposit` carries `party_customer_id`/`party_driver_id`
-- directly — the *other* half of the view's test is what excludes it: the
-- parent row is a container with no `posted_period_id` of its own (the
-- money lives in `deposit_movement`, which names the deposit rather than
-- the party). Real money still starts here: `recordDepositMovement`'s
-- `taken` movement type is a new deposit only ever preceded by an INSERT
-- into this table, so a fresh `deposit` row against an archived party is
-- the actual gap, not a theoretical one — W-60 makes it unlikely (a party
-- cannot be archived while holding one) but not impossible.
--
-- `assert_party_not_archived()` already does exactly the right check for a
-- table with direct party columns — it just needed attaching by hand, since
-- the view that drives 0031's own `DO` block will never select this table.
-- `deposit` carries no `replaces_id` (a container is opened once, corrected
-- through its own movements, never replaced), so that half of the function
-- is inert here rather than irrelevant.
CREATE TRIGGER deposit_archive_guard BEFORE INSERT ON deposit
  FOR EACH ROW EXECUTE FUNCTION assert_party_not_archived('driver', 'party_driver_id', 'customer', 'party_customer_id');

-- Deliberately outside assert-no-archive-guard-drift.sql's own coverage:
-- both triggers above guard tables the catalogue-driven view structurally
-- cannot see, for the two different reasons documented above. Widening the
-- drift check to also assert these two by name would be exactly the
-- hand-maintained list DM §13's own history (three tables silently missing
-- from assert_period_open()) already showed goes stale. Verified instead by
-- a direct integration test against each trigger.
