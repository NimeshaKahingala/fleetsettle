-- 0005_odometer_reading_lease_date_unique.sql
--
-- F-2.3/UC-14: idempotency lives in the constraint, not in application code
-- (CLAUDE.md → Writes). A reading against a lease is a once-a-day fact —
-- two taps recording the same lease's odometer on the same date are the
-- same submission arriving twice, not two different readings. Partial (only
-- rows that actually belong to a lease) because `odometer_reading` also
-- serves trip and general-oversight readings (W-12's "one odometer
-- mechanism, three purposes"), which carry no `lease_id` and have no such
-- one-per-day rule.
CREATE UNIQUE INDEX odometer_reading_lease_id_read_on_key
  ON odometer_reading (lease_id, read_on)
  WHERE lease_id IS NOT NULL;
