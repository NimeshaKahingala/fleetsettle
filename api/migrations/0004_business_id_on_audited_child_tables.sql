-- 0004_business_id_on_audited_child_tables.sql
--
-- write_audit_log() (0002) reads NEW.business_id unconditionally, and its
-- trigger attaches to "every table carrying posted_period_id" by design —
-- deliberately not a hand-maintained list, DM §13's own lesson from
-- assert_period_open() drifting once already. Seven tables carry
-- posted_period_id without carrying business_id: advance_settlement and
-- deposit_movement (found here, P4, the first phase to write either one —
-- 42703 "record 'new' has no field 'business_id'" the moment a row is
-- inserted) and five tables no phase has written to yet — incident_recovery,
-- insurance_claim, mileage_assessment, payment_correction,
-- write_off_recovery (P5/P8/P9/P10).
--
-- The write-migration checklist itself requires business_id — never
-- nullable (W-39) — on every money table, alongside posted_period_id. These
-- seven were the money-table checklist's own exception, and the audit
-- trigger's generic design assumes there isn't one. All seven are empty
-- (confirmed against both the dev and integration-test databases before
-- writing this), so a NOT NULL column with no backfill is safe today; it
-- would not be once any of them held a live row.
ALTER TABLE advance_settlement ADD COLUMN business_id uuid NOT NULL REFERENCES business(id);
ALTER TABLE deposit_movement   ADD COLUMN business_id uuid NOT NULL REFERENCES business(id);
ALTER TABLE incident_recovery  ADD COLUMN business_id uuid NOT NULL REFERENCES business(id);
ALTER TABLE insurance_claim    ADD COLUMN business_id uuid NOT NULL REFERENCES business(id);
ALTER TABLE mileage_assessment ADD COLUMN business_id uuid NOT NULL REFERENCES business(id);
ALTER TABLE payment_correction ADD COLUMN business_id uuid NOT NULL REFERENCES business(id);
ALTER TABLE write_off_recovery ADD COLUMN business_id uuid NOT NULL REFERENCES business(id);
