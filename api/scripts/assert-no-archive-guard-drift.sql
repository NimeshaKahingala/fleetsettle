-- GAP-178/B13. Expected: zero rows. Run after every migration, and in CI.
--
-- Every money table that names a driver or a customer must carry:
--
--   <table>_archive_guard   refuses an INSERT against an archived party
--
-- and that trigger must name *every* one of the table's party columns, not
-- just the ones that existed when migration 0031 ran.
--
-- What counts as a party column is not restated here. It is
-- `archive_guarded_party_column`, the view migration 0031 creates and
-- attaches triggers from — so this assertion and the thing it audits cannot
-- disagree about the set, only about whether the triggers match it. An
-- earlier draft of this file carried its own copy of the catalogue query and
-- SonarCloud failed the PR on the duplication, which was right for a better
-- reason than style.
--
-- There are two ways to drift after 0031 has run:
--
--   a new party-referencing money table gets no trigger at all, or
--   a new party column on an already-guarded table is left out of its
--   trigger's arguments
--
-- The second is the quieter of the two, and the one a trigger-exists check
-- cannot see. Gitar's review of PR #117 found `expense` outside the set
-- entirely for the same underlying reason: the first membership test read
-- four hard-coded column names, so `borne_by_driver_id` was invisible to it.
-- Both halves are now foreign-key questions, which no naming choice can hide
-- from.
--
-- The failure mode this exists to prevent is the quiet one: money accrues
-- against a driver the business has already written off and closed, and
-- nothing anywhere says so.
--
-- Companion to assert-no-trigger-drift.sql, which asks the same question of
-- the period-open and audit triggers over a different set of tables.
SELECT g.table_name,
       g.party_column,
       NOT EXISTS (SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = g.table_oid AND NOT t.tgisinternal
                      AND t.tgname = g.table_name || '_archive_guard') AS missing_trigger
  FROM archive_guarded_party_column g
 WHERE NOT EXISTS (
         SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = g.table_oid AND NOT t.tgisinternal
            AND t.tgname = g.table_name || '_archive_guard'
            -- The column must appear in the trigger's own argument list, not
            -- merely be on a table that has some trigger.
            AND pg_get_triggerdef(t.oid) LIKE '%' || quote_literal(g.party_column) || '%')
 ORDER BY g.table_name, g.party_column;
