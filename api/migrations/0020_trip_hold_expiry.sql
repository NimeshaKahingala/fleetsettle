-- 0020_trip_hold_expiry.sql
--
-- GAP-7/D-13 (data-model.md §8). hold_expires_on is the single source of
-- truth for when a hold releases — vehicle_day_allocation.is_hold is not
-- duplicated with its own copy, since one trip's hold spans several
-- allocation rows and only one of them could ever be corrected without the
-- others silently disagreeing (the exact two-representations-of-one-fact
-- shape W-58 exists to prevent).
--
-- Pre-filled from a business-wide default of seven days (user-flows.md
-- ST-5), editable per hold. hold_expiry_days follows business_settings'
-- own existing pattern for a business-tunable number (deposit_hold_days).
ALTER TABLE business_settings ADD COLUMN hold_expiry_days integer NOT NULL DEFAULT 7;

ALTER TABLE trip ADD COLUMN hold_expires_on date;
ALTER TABLE trip ADD CONSTRAINT trip_hold_expires_on_check
  CHECK (status = 'hold' OR hold_expires_on IS NULL);

-- Release is synchronous (bookTrip / startDailyLease / startLease each void
-- a vehicle's own expired holds before checking for a conflict — Wave 2),
-- never only by cron; CLAUDE.md's "no cron is a prerequisite for a user
-- action" applied to holds the same way D-9 already applies it to the
-- daily-lease horizon. The nightly job then only releases what nobody
-- happened to book around.
