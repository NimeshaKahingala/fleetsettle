-- DM §13. Expected: zero rows. Run after every migration, and in CI.
--
-- Every table carrying posted_period_id must have both triggers:
--
--   <table>_period_open   refuses a write into a closed accounting period
--   <table>_audit         records who changed what (D-8)
--
-- The period-open list in migration 0001 is hand-maintained, which is exactly
-- the kind of list that drifts silently: a new money table gets posted_period_id,
-- nobody adds it, and it accepts writes into a settled month forever. Three
-- tables were missing at one point. A fourth — `trip` — is missing today and is
-- reported by this query rather than assumed away.
--
-- The audit list is derived from this same catalogue query in 0002, so it cannot
-- drift by construction. It is still checked here, because "cannot drift" is a
-- claim about code that no longer holds the moment someone writes a migration
-- that attaches triggers by hand.

SELECT c.relname AS table_name,
       NOT EXISTS (SELECT 1 FROM pg_trigger g
                    WHERE g.tgrelid = c.oid AND NOT g.tgisinternal
                      AND g.tgname = c.relname || '_period_open') AS missing_period_open,
       NOT EXISTS (SELECT 1 FROM pg_trigger g
                    WHERE g.tgrelid = c.oid AND NOT g.tgisinternal
                      AND g.tgname = c.relname || '_audit')        AS missing_audit
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND a.attname = 'posted_period_id'
   AND NOT a.attisdropped
   AND c.relkind = 'r'
   AND (NOT EXISTS (SELECT 1 FROM pg_trigger g
                     WHERE g.tgrelid = c.oid AND NOT g.tgisinternal
                       AND g.tgname = c.relname || '_period_open')
        OR
        NOT EXISTS (SELECT 1 FROM pg_trigger g
                     WHERE g.tgrelid = c.oid AND NOT g.tgisinternal
                       AND g.tgname = c.relname || '_audit'))
 ORDER BY c.relname;
