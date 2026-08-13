-- 0016_expense_vehicle_consistency.sql
--
-- GAP-59/D-14/INV-33 (data-model.md §9). expense.vehicle_id, trip_id and
-- incident_id were each checked only against business_id, then discarded —
-- an expense could name a vehicle and a trip belonging to a DIFFERENT
-- vehicle, and the row would then appear on both vehicles' books, one of
-- them wrongly. trip and incident each need UNIQUE (id, vehicle_id) before
-- expense can hold a composite FK against the pair. id is already each
-- table's primary key, so this is not a new uniqueness fact about either
-- table — it only shapes the pair for the composite FK below.
ALTER TABLE trip ADD CONSTRAINT trip_id_vehicle_id_key UNIQUE (id, vehicle_id);
ALTER TABLE incident ADD CONSTRAINT incident_id_vehicle_id_key UNIQUE (id, vehicle_id);

-- Superseded by the composite FK below — same drop-and-readd pattern 0014
-- used for obligation_kind_check.
ALTER TABLE expense DROP CONSTRAINT expense_incident_id_fkey; -- allow: superseded by expense_incident_fkey below

-- MATCH SIMPLE (the default) is kept deliberately: an overhead expense
-- (vehicle_id NULL, UC-66) must keep saving with neither trip_id nor
-- incident_id set. The two CHECKs are what close the one hole MATCH SIMPLE
-- would otherwise leave open — naming a trip or incident with no vehicle at
-- all, since trip.vehicle_id and incident.vehicle_id are themselves NOT
-- NULL and a NULL expense.vehicle_id could otherwise dodge the composite
-- check entirely.
ALTER TABLE expense
  ADD CONSTRAINT expense_trip_vehicle_check CHECK (trip_id IS NULL OR vehicle_id IS NOT NULL),
  ADD CONSTRAINT expense_incident_vehicle_check CHECK (incident_id IS NULL OR vehicle_id IS NOT NULL),
  ADD CONSTRAINT expense_trip_fkey FOREIGN KEY (trip_id, vehicle_id) REFERENCES trip (id, vehicle_id),
  ADD CONSTRAINT expense_incident_fkey
    FOREIGN KEY (incident_id, vehicle_id) REFERENCES incident (id, vehicle_id);
