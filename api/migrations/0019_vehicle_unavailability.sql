-- 0019_vehicle_unavailability.sql
--
-- F-1.10/GAP-26 (data-model.md §4.2). UC-79's utilisation report already
-- named the off-road bucket; nothing wrote it. Vehicle-level and
-- arrangement-agnostic, unlike vehicle_day_allocation: an arrangement A/C
-- vehicle between allocations has no occupancy row at all to mark, so
-- unavailability needs its own table rather than a state layered onto one
-- that assumes an earning claim exists.
--
-- Deliberately does not duplicate incident.off_road_from/off_road_to
-- (§9.1), which already covers downtime an incident caused — this table is
-- for every other reason a vehicle sits still (routine service, sale
-- preparation, an owner's own use). It does not re-partition
-- user-flows.md §4.1's days_in_month formula and does not touch
-- UC-76's lease_eligible_days; a day still needs confirming through F-4.4
-- in the ordinary way. Not a money table (no posted_period_id), so it
-- stays outside assert_period_open()'s array, the same reasoning
-- attachment and lease_day_exception already carry.
CREATE TABLE vehicle_unavailability (
  id              uuid PRIMARY KEY,
  business_id     uuid NOT NULL REFERENCES business(id),
  vehicle_id      uuid NOT NULL REFERENCES vehicle(id),
  reason          text NOT NULL CHECK (reason IN ('service','sale_preparation','other')),
  unavailable_from date NOT NULL,
  unavailable_to   date,
  note            text,
  created_by      uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  voided_at       timestamptz,
  voided_reason   text,
  voided_by       uuid REFERENCES app_user(id),

  CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND voided_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL
        AND voided_reason IS NOT NULL AND voided_reason <> '')
  ),

  EXCLUDE USING gist (
    vehicle_id WITH =,
    daterange(unavailable_from, unavailable_to, '[]') WITH &&
  ) WHERE (voided_at IS NULL)
);
