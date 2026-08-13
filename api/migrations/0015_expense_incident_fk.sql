-- 0015_expense_incident_fk.sql
--
-- GAP-59, part 1 of 2. `expense.incident_id` (0001) was never given a
-- foreign key at all — any uuid saved there, real incident or not. This
-- closes the referential gap on its own before 0016 layers the composite
-- (incident_id, vehicle_id) constraint on top (data-model.md D-14);
-- splitting the two keeps each migration to one concern.
ALTER TABLE expense
  ADD CONSTRAINT expense_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES incident(id);
