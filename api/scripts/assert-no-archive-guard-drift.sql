-- GAP-178/B13. Expected: zero rows. Run after every migration, and in CI.
--
-- Every money table that names a driver or a customer must carry:
--
--   <table>_archive_guard   refuses an INSERT against an archived party
--
-- Migration 0031 attaches these from the catalogue rather than a list, which
-- means the set cannot disagree with itself on the day it runs. It still
-- runs only once. A party-referencing money table added afterwards gets no
-- trigger, and the failure mode is the quiet one: money accrues against a
-- driver the business has already written off and closed, and nothing
-- anywhere says so.
--
-- This is the same argument assert-no-trigger-drift.sql makes for the
-- period-open and audit triggers, and it is a separate file because it is a
-- different set of tables — "carries posted_period_id" is the test there,
-- "carries posted_period_id *and* names a party" is the test here.
SELECT c.relname AS table_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind = 'r'
   AND EXISTS (SELECT 1 FROM pg_attribute p
                WHERE p.attrelid = c.oid AND NOT p.attisdropped
                  AND p.attname = 'posted_period_id')
   AND EXISTS (SELECT 1 FROM pg_attribute p
                WHERE p.attrelid = c.oid AND NOT p.attisdropped
                  AND p.attname IN ('driver_id', 'customer_id',
                                    'party_driver_id', 'party_customer_id'))
   AND NOT EXISTS (SELECT 1 FROM pg_trigger g
                    WHERE g.tgrelid = c.oid AND NOT g.tgisinternal
                      AND g.tgname = c.relname || '_archive_guard')
 ORDER BY c.relname;
