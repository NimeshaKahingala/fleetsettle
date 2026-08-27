-- 0034_archive_guard_locks_the_party_row.sql
--
-- GAP-190/B13, Gitar review of PR #136. Migration 0031's own archive guard
-- (assert_party_not_archived()) and the app-side check that runs alongside
-- an archive (domain/party-archive.ts) both read driver/customer with a
-- plain SELECT — no lock. Under READ COMMITTED that is not enough to
-- serialize an archive against a concurrent money insert: each side reads
-- the other's pre-commit state, so an archive and an insert can both
-- succeed, leaving an archived party with open money (INV-35) even though
-- neither one, alone, did anything wrong.
--
-- Fixed the way every other parent-row race in this schema is fixed
-- (deposit.ts's own comment on GAP-178/B10 gives the identical reasoning):
-- both sides lock the same row. The archive path takes FOR UPDATE
-- (exclusive — see party-archive.ts); this trigger takes FOR SHARE on the
-- referenced party for the entirety of its own check. Two ordinary money
-- inserts against the same still-active party each take a FOR SHARE lock
-- too, but shared locks don't conflict with each other, so they never
-- block one another — only the exclusive lock an archive holds forces
-- either side to wait for the other to commit.
CREATE OR REPLACE FUNCTION assert_party_not_archived() RETURNS trigger AS $$
DECLARE
  row_json jsonb := to_jsonb(NEW);
  i        int := 0;
  party    text;
  col      text;
  ref      uuid;
  prior    uuid;
  archived boolean;
BEGIN
  WHILE i < TG_NARGS LOOP
    party := TG_ARGV[i];
    col   := TG_ARGV[i + 1];
    ref   := (row_json ->> col)::uuid;

    IF ref IS NOT NULL THEN
      IF (row_json ->> 'replaces_id') IS NOT NULL THEN
        EXECUTE format('SELECT %I FROM %I WHERE id = $1', col, TG_TABLE_NAME)
           INTO prior USING (row_json ->> 'replaces_id')::uuid;
        IF prior IS NOT DISTINCT FROM ref THEN
          i := i + 2;
          CONTINUE;
        END IF;
      END IF;

      archived := NULL;
      -- The WHERE no longer filters on voided_at: filtering there means a
      -- still-active party (the common case) matches nothing, and a SELECT
      -- that returns no rows locks nothing. The row must be locked
      -- regardless of its current status, then its status read.
      IF party = 'driver' THEN
        SELECT (d.voided_at IS NOT NULL) INTO archived FROM driver d
          WHERE d.id = ref FOR SHARE;
      ELSE
        SELECT (c.voided_at IS NOT NULL) INTO archived FROM customer c
          WHERE c.id = ref FOR SHARE;
      END IF;

      IF archived THEN
        RAISE EXCEPTION 'party is archived: % % (via %.%)', party, ref, TG_TABLE_NAME, col
          USING ERRCODE = 'FS001';
      END IF;
    END IF;

    i := i + 2;
  END LOOP;

  RETURN NEW;
END $$ LANGUAGE plpgsql;
