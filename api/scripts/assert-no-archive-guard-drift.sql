-- GAP-178/B13. Expected: zero rows. Run after every migration, and in CI.
--
-- Every money table that names a driver or a customer must carry:
--
--   <table>_archive_guard   refuses an INSERT against an archived party
--
-- and that trigger must name *every* one of the table's party columns, not
-- just the ones that existed when the migration ran.
--
-- Migration 0031 attaches these from the catalogue rather than a list, which
-- means the set cannot disagree with itself on the day it runs. It still
-- runs only once, and there are two ways to drift afterwards:
--
--   a new party-referencing money table gets no trigger at all, or
--   a new party column on an already-guarded table is left out of its
--   trigger's arguments
--
-- The second is the quieter of the two and the one the first draft of this
-- file could not see, because it tested only for the trigger's existence.
-- Gitar's review of PR #117 found `expense` outside the set entirely for the
-- same underlying reason: the membership test read four hard-coded column
-- names, so `borne_by_driver_id` was invisible to it. Both halves are now
-- foreign-key questions — "does this column REFERENCE driver or customer" —
-- which no naming choice can hide from.
--
-- The failure mode this exists to prevent is the quiet one: money accrues
-- against a driver the business has already written off and closed, and
-- nothing anywhere says so.
--
-- This is the same argument assert-no-trigger-drift.sql makes for the
-- period-open and audit triggers, and it is a separate file because it is a
-- different set of tables — "carries posted_period_id" is the test there,
-- "carries posted_period_id *and* names a party" is the test here.
WITH party_columns AS (
  SELECT c.oid AS reloid, c.relname AS table_name, a.attname AS party_column
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_constraint fk ON fk.conrelid = c.oid
                         AND fk.contype = 'f'
                         AND fk.confrelid IN ('driver'::regclass, 'customer'::regclass)
    JOIN pg_attribute a ON a.attrelid = c.oid
                       AND a.attnum = fk.conkey[1]
                       AND NOT a.attisdropped
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM pg_attribute p
                  WHERE p.attrelid = c.oid AND NOT p.attisdropped
                    AND p.attname = 'posted_period_id')
)
SELECT p.table_name,
       p.party_column,
       NOT EXISTS (SELECT 1 FROM pg_trigger g
                    WHERE g.tgrelid = p.reloid AND NOT g.tgisinternal
                      AND g.tgname = p.table_name || '_archive_guard') AS missing_trigger
  FROM party_columns p
 WHERE NOT EXISTS (
         SELECT 1 FROM pg_trigger g
          WHERE g.tgrelid = p.reloid AND NOT g.tgisinternal
            AND g.tgname = p.table_name || '_archive_guard'
            -- The column must actually appear in the trigger's argument
            -- list, not merely be on a table that has some trigger.
            AND pg_get_triggerdef(g.oid) LIKE '%' || quote_literal(p.party_column) || '%')
 ORDER BY p.table_name, p.party_column;
