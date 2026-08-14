-- 0024_offset_allocation_void.sql
--
-- GAP-12/W-61/INV-36 §3.2. offset_allocation is structurally identical to
-- payment_allocation (a child allocation row moving obligation.settled_minor)
-- but never received the W-58 void trio migration 0022 gave that table, and
-- migration 0023 then closed its ON DELETE CASCADE to RESTRICT — so today an
-- offset allocation cannot be undone by any legal route at all. No
-- posted_period_id here, same as payment_allocation, so this table is not in
-- assert_period_open()'s array (0001) and this void is never period-gated;
-- the offset_record it belongs to carries its own posted_period_id and is
-- gated there instead.
ALTER TABLE offset_allocation ADD COLUMN voided_at timestamptz;
ALTER TABLE offset_allocation ADD COLUMN voided_reason text;
ALTER TABLE offset_allocation ADD COLUMN voided_by uuid REFERENCES app_user(id);
ALTER TABLE offset_allocation ADD CONSTRAINT offset_allocation_void_check CHECK (
  (voided_at IS NULL AND voided_by IS NULL AND voided_reason IS NULL)
  OR (voided_at IS NOT NULL AND voided_by IS NOT NULL
      AND voided_reason IS NOT NULL AND length(voided_reason) > 0)
);
