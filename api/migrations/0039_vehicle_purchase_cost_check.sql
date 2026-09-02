-- 0039_vehicle_purchase_cost_check.sql
--
-- L-4, 31 Aug 2026. `vehicle.purchase_cost_minor` was the last money column
-- in this schema admitting a negative — every sibling money column already
-- carries a `>= 0` CHECK (or is guarded application-side by
-- `positiveMoneyWireSchema`, PR-17's own NM-6/L-1 fixes for the schemas
-- that raise a real transaction rather than a static fact). Nullable stays
-- nullable — GAP-185/UC-106 states "purchase price is entered alongside a
-- loan (F-12.1) but lives on the vehicle itself, never required" (U-2), so
-- absence is still a real, distinct state from zero.
ALTER TABLE vehicle
  ADD CONSTRAINT vehicle_purchase_cost_minor_check
  CHECK (purchase_cost_minor IS NULL OR purchase_cost_minor >= 0);
