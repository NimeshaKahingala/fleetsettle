-- 0022_void_everywhere.sql
--
-- W-58/D-11 (data-model.md §4.1, §7, §10.2, §10.6). Every write in this
-- schema is now voided, never deleted, including tables that hold no
-- money. Four tables previously carried an explicit no-restricted-syntax
-- exemption permitting a hard delete for exactly this reason —
-- migration 0002's audit trigger fires AFTER INSERT OR UPDATE only, so a
-- deleted row was never written to audit_log either, leaving a later
-- production investigation nothing to find. This migration gives all four
-- the trio; the matching ESLint exemptions and their call sites are
-- converted in the same commit. None of the four takes replaces_id
-- (0021) — a structural cause ("superseded by trip <id>", "un-skipping a
-- date") is text in voided_reason, not a second FK concept.

-- vehicle_day_allocation (GAP-118/GAP-119's own table)
ALTER TABLE vehicle_day_allocation ADD COLUMN voided_at timestamptz;
ALTER TABLE vehicle_day_allocation ADD COLUMN voided_reason text;
ALTER TABLE vehicle_day_allocation ADD COLUMN voided_by uuid REFERENCES app_user(id);
ALTER TABLE vehicle_day_allocation ADD CONSTRAINT vehicle_day_allocation_void_check CHECK (
  (voided_at IS NULL AND voided_by IS NULL AND voided_reason IS NULL)
  OR (voided_at IS NOT NULL AND voided_by IS NOT NULL
      AND voided_reason IS NOT NULL AND voided_reason <> '')
);

-- INV-1 itself: a hold and a voided row are both excluded, so an enquiry
-- never suppresses income and a freed day is truly free again.
DROP INDEX one_arrangement_per_vehicle_day;
CREATE UNIQUE INDEX one_arrangement_per_vehicle_day
  ON vehicle_day_allocation (vehicle_id, business_date)
  WHERE is_hold = false AND voided_at IS NULL;

DROP INDEX vehicle_day_allocation_vehicle_id_business_date_idx;
CREATE INDEX ON vehicle_day_allocation (vehicle_id, business_date)
  WHERE voided_at IS NULL;                        -- UC-95 calendar, GAP-119 fix

-- payment_allocation
ALTER TABLE payment_allocation ADD COLUMN voided_at timestamptz;
ALTER TABLE payment_allocation ADD COLUMN voided_reason text;
ALTER TABLE payment_allocation ADD COLUMN voided_by uuid REFERENCES app_user(id);

-- Partial, not table-level: a voided pair must be re-allocatable, since
-- undoing an allocation and drawing on the same payment again is ordinary
-- correction, not a re-run of the original mistake.
ALTER TABLE payment_allocation DROP CONSTRAINT payment_allocation_payment_id_obligation_id_key; -- allow: superseded by the partial unique index below, same drop-and-readd pattern 0014 used for obligation_kind_check
CREATE UNIQUE INDEX payment_allocation_live_pair
  ON payment_allocation (payment_id, obligation_id)
  WHERE voided_at IS NULL;

-- day_record. Nothing hard-deletes this table today; the trio lands ahead
-- of Wave 2, which is what actually needs it (GAP-118's fix voids a stale
-- future card on a driver or arrangement change rather than mutating it
-- in place — mutating an 'open' card with earned_minor = 0 would still be
-- touching a money-table row).
ALTER TABLE day_record ADD COLUMN voided_at timestamptz;
ALTER TABLE day_record ADD COLUMN voided_reason text;
ALTER TABLE day_record ADD COLUMN voided_by uuid REFERENCES app_user(id);
ALTER TABLE day_record ADD CONSTRAINT day_record_void_check CHECK (
  (voided_at IS NULL AND voided_by IS NULL AND voided_reason IS NULL)
  OR (voided_at IS NOT NULL AND voided_by IS NOT NULL
      AND voided_reason IS NOT NULL AND voided_reason <> '')
);

-- opening_balance_entry. Previously carried no void trio at all, on the
-- reasoning that a draft entry is "replaced wholesale on every save, not a
-- posted transaction under W-50" — correct as far as it went, but W-58
-- widens the why beyond W-50's posted-transaction test: even a pre-close
-- row is worth a trace once F3's materialisation can already read it.
-- "Replaced wholesale" now means every live entry in the batch is voided,
-- then the corrected set is inserted — never delete-and-reinsert.
ALTER TABLE opening_balance_entry ADD COLUMN voided_at timestamptz;
ALTER TABLE opening_balance_entry ADD COLUMN voided_reason text;
ALTER TABLE opening_balance_entry ADD COLUMN voided_by uuid REFERENCES app_user(id);
ALTER TABLE opening_balance_entry ADD CONSTRAINT opening_balance_entry_void_check CHECK (
  (voided_at IS NULL AND voided_by IS NULL AND voided_reason IS NULL)
  OR (voided_at IS NOT NULL AND voided_by IS NOT NULL
      AND voided_reason IS NOT NULL AND voided_reason <> '')
);
