-- 0012_incident_recovery_obligation_fk.sql
--
-- GAP-10/A10b: `incident_recovery.obligation_id` has carried the comment
-- "customer contributions become receivable" since 0001, but nothing ever
-- wrote it and it was never a real foreign key — just a bare `uuid`. Now
-- that `recordCustomerContribution` (domain/incident.ts) writes an
-- `obligation` row and links it, the column earns the same enforcement
-- every other reference in this schema gets: an `obligation_id` that
-- points nowhere is exactly the kind of drift DM §1.1 assigns to Postgres,
-- not to application code.
--
-- Additive and safe: every existing row has `obligation_id IS NULL`, which
-- trivially satisfies a foreign key (allow: NULL is always valid against a
-- FK, so this cannot fail against live data).
ALTER TABLE incident_recovery
  ADD CONSTRAINT incident_recovery_obligation_id_fkey
  FOREIGN KEY (obligation_id) REFERENCES obligation(id);
