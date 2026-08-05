-- 0007_expense_voided_by.sql
--
-- W-50's own checklist (the write-migration skill, DM's money-table review):
-- every money-fact table carries voided_at / voided_reason / voided_by. DM
-- §9's own `expense` DDL only ever wrote the first two — found while
-- building P9's void-and-replace endpoint (F-8.5/UC-96), the first thing to
-- actually write a `voided_*` column on this table. `expense` predates every
-- write to it that matters (P3), so a NOT NULL-free ADD COLUMN needs no
-- backfill.
ALTER TABLE expense ADD COLUMN voided_by uuid REFERENCES app_user(id);
