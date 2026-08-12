-- 0013_attachment_void_and_subject_index.sql
--
-- A7/GAP-16: attachment (DM §12, migration 0001) has never held a row.
-- This is the schema half of the first real writer — the R2 upload
-- endpoint — and it tightens the table while it is still empty, which
-- will never be true again; a CHECK added later needs a backfill and a
-- validation pass this one does not.
--
-- attachment is deliberately NOT added to assert_period_open()'s array
-- and is NOT a money table by the write-migration checklist: it has no
-- posted_period_id, so the trigger body's NEW.posted_period_id read
-- would throw 42703 on the first insert (the exact failure 0004's own
-- header documents), and write_audit_log() would fail the same way
-- since it discovers its tables by walking posted_period_id. The
-- consequence is real and is recorded rather than assumed: attachment
-- writes are neither period-gated nor audit-logged. The drift check in
-- data-model.md §13 selects only posted_period_id tables, so it will
-- stay correctly silent about this table — that silence is intended.

ALTER TABLE attachment
  ADD COLUMN voided_at     timestamptz,
  ADD COLUMN voided_reason text,
  ADD COLUMN voided_by     uuid REFERENCES app_user(id);

-- A half-voided row can never exist: all three trio columns null, or
-- all three set with a non-empty reason. Same shape the money tables'
-- CHECK would carry if they had one written down explicitly.
ALTER TABLE attachment
  ADD CONSTRAINT attachment_void_consistency CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND voided_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL
        AND voided_reason IS NOT NULL AND voided_reason IS DISTINCT FROM '')
  );

ALTER TABLE attachment
  ADD CONSTRAINT attachment_size_positive CHECK (size_bytes > 0);

-- content_type has been free text since 0001. This is the same
-- allowlist the upload handler enforces server-side (api/CLAUDE.md:
-- the DB constraint is the truth, the handler check is the better
-- error message ahead of it) — image formats only; a PDF ticket or
-- another type is a future migration, deliberately, not a reason to
-- leave the column unconstrained now.
ALTER TABLE attachment
  ADD CONSTRAINT attachment_content_type_allowed CHECK (
    content_type IN ('image/jpeg', 'image/png', 'image/webp')
  );

-- kind and subject_type are not independent — a condition_handover
-- attached to an expense is nonsense the table would otherwise store
-- happily. This covers every combination the schema will ever legally
-- hold, not only the one pair the first API endpoint (expense
-- receipts) accepts; "legal in the database" and "supported by this
-- branch's API" are two separate gates on purpose (A7's plan,
-- decision 5) — an unbuilt subject type is rejected by the handler
-- with its own 400, not by this CHECK being the only thing in its way.
ALTER TABLE attachment
  ADD CONSTRAINT attachment_kind_subject_type_pair CHECK (
    (subject_type = 'expense' AND kind = 'expense_receipt')
    OR (subject_type = 'lease' AND kind IN ('condition_handover', 'condition_return'))
    OR (subject_type = 'incident' AND kind = 'incident')
    OR (subject_type = 'odometer_reading' AND kind = 'odometer')
    OR (subject_type = 'post_closure_charge' AND kind = 'ticket')
  );

-- The lookup every read path performs ("the live photos for this
-- subject"), tenant-scoped and newest-first to match the actual query
-- shape, excluding voided rows. No index on the subject pair existed
-- before this migration.
CREATE INDEX attachment_subject_live
  ON attachment (business_id, subject_type, subject_id, uploaded_at DESC)
  WHERE voided_at IS NULL;
