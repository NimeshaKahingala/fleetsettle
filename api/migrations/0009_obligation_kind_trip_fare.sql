-- 0009_obligation_kind_trip_fare.sql
--
-- GAP-23/A6: a trip's agreed_amount_minor never became a receivable.
-- bookTrip has never written an obligation, so no payment could allocate
-- against a charter's fare — the money floated as unallocatedMinor forever,
-- and TripDetailScreen's "Received" row has read NotAvailable since Web-P7
-- naming exactly this reason (W-56).
--
-- Design settled by the business owner (TRACKER.md GAP-23, confirmed against
-- the code before this migration was written): post at booking, not close —
-- a charter has no cancellation-fee concept and ST-5's `hold` state was
-- never built, so booking is the fact being posted. `kind: 'trip_fare'` is
-- the new literal this migration admits.
--
-- The constraint is unnamed in 0001 (`kind text NOT NULL CHECK (kind IN
-- (...))`), so Postgres generated the name — confirmed against the live
-- branch rather than assumed, the same way 0006's own header records doing:
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'obligation'::regclass AND contype = 'c';
-- returns obligation_kind_check.
ALTER TABLE obligation DROP CONSTRAINT obligation_kind_check; -- allow: widening a CHECK is additive — every existing row's kind is already in the old set, so it still satisfies the new one
ALTER TABLE obligation ADD CONSTRAINT obligation_kind_check CHECK (kind IN
  ('rent','mileage_excess','daily_amount','driver_fee','post_closure_charge',
   'customer_contribution','management_fee','trip_fare','other'));
