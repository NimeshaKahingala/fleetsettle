-- 0023_soft_delete_parties.sql
--
-- GAP-36/W-58. driver and customer have no soft-delete column at all, so a
-- row created by mistake is permanent. The full voided_* trio, matching
-- every other table W-58 now covers, not a bare timestamp — a soft-deleted
-- parent keeps every past record's history rendering exactly as before, so
-- a closed month's totals never move because someone archived a driver
-- later. No endpoint sets these columns yet; that is Wave 5 (A9b).
ALTER TABLE driver ADD COLUMN voided_at timestamptz;
ALTER TABLE driver ADD COLUMN voided_reason text;
ALTER TABLE driver ADD COLUMN voided_by uuid REFERENCES app_user(id);
ALTER TABLE driver ADD CONSTRAINT driver_void_check CHECK (
  (voided_at IS NULL AND voided_by IS NULL AND voided_reason IS NULL)
  OR (voided_at IS NOT NULL AND voided_by IS NOT NULL
      AND voided_reason IS NOT NULL AND length(voided_reason) > 0)
);

ALTER TABLE customer ADD COLUMN voided_at timestamptz;
ALTER TABLE customer ADD COLUMN voided_reason text;
ALTER TABLE customer ADD COLUMN voided_by uuid REFERENCES app_user(id);
ALTER TABLE customer ADD CONSTRAINT customer_void_check CHECK (
  (voided_at IS NULL AND voided_by IS NULL AND voided_reason IS NULL)
  OR (voided_at IS NOT NULL AND voided_by IS NOT NULL
      AND voided_reason IS NOT NULL AND length(voided_reason) > 0)
);

-- W-58 completion: an ON DELETE CASCADE is itself a hard-delete mechanism —
-- a direct DELETE against the parent would silently remove the child rows
-- that are the forensic trail W-58 exists to keep. Nothing in api/src
-- issues either DELETE (mileage_assessment and offset_record are both
-- append-only, corrected by voiding), so RESTRICT changes no application
-- behaviour; it only closes the one path left that could still destroy a
-- row outside application code's own no-hard-delete guarantee.
ALTER TABLE mileage_assessment_split DROP CONSTRAINT mileage_assessment_split_assessment_id_fkey; -- allow: replacing CASCADE with RESTRICT, see header
ALTER TABLE mileage_assessment_split
  ADD CONSTRAINT mileage_assessment_split_assessment_id_fkey
  FOREIGN KEY (assessment_id) REFERENCES mileage_assessment(id);

ALTER TABLE offset_allocation DROP CONSTRAINT offset_allocation_offset_id_fkey; -- allow: replacing CASCADE with RESTRICT, see header
ALTER TABLE offset_allocation
  ADD CONSTRAINT offset_allocation_offset_id_fkey
  FOREIGN KEY (offset_id) REFERENCES offset_record(id);
