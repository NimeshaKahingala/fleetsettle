-- 0002_audit_log_writer.sql
--
-- DM D-8. `audit_log` exists with no writer; this is the writer, and it lands
-- before any money table holds live data. Retrofitting it later means
-- backfilling history that was never captured, and an audit trail with a gap at
-- the beginning is the one stretch someone eventually needs.
--
-- A trigger rather than application code, deliberately (D-8): a trigger cannot
-- be forgotten in a new code path, and "the developer remembered" is not an
-- enforcement mechanism for a record whose whole job is to be believed later.

-- Who did it.
--
-- The database has no idea which person is behind a connection, so the
-- application sets `fleetsettle.actor_id` on the transaction and this reads it
-- back. A NULL actor is recorded rather than rejected: a cron write genuinely
-- has no person behind it, and refusing the write would make the audit trail
-- the reason a payment failed.
CREATE OR REPLACE FUNCTION audit_actor() RETURNS uuid AS $$
DECLARE raw text;
BEGIN
  raw := current_setting('fleetsettle.actor_id', true);
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE;

-- What happened.
--
-- `voided_at` is read through to_jsonb rather than as OLD.voided_at because
-- only 13 of the 18 money tables carry the column, and a direct reference would
-- raise on the other five. This way one function serves every table.
CREATE OR REPLACE FUNCTION write_audit_log() RETURNS trigger AS $$
DECLARE
  act    text;
  before jsonb;
  after  jsonb;
BEGIN
  after := to_jsonb(NEW);

  IF TG_OP = 'INSERT' THEN
    act := 'insert';
    before := NULL;
  ELSE
    before := to_jsonb(OLD);
    IF (before ->> 'voided_at') IS NULL AND (after ->> 'voided_at') IS NOT NULL THEN
      act := 'void';
    ELSE
      act := 'update';
    END IF;
  END IF;

  INSERT INTO audit_log (
    business_id, table_name, record_id, action, changed_by, before_json, after_json
  ) VALUES (
    NEW.business_id, TG_TABLE_NAME, NEW.id, act, audit_actor(), before, after
  );

  RETURN NULL;  -- AFTER trigger; the return value is discarded
END $$ LANGUAGE plpgsql;

-- Where it applies.
--
-- Derived from the catalogue rather than from a hand-written list. §13's
-- assert_period_open() array is hand-maintained and has already drifted once —
-- three tables were missing from it and every one silently accepted writes into
-- a closed period. A second hand-maintained list would be a second chance to
-- make the same mistake, so audit coverage is defined as "every table carrying
-- posted_period_id" and cannot disagree with itself.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND a.attname = 'posted_period_id'
       AND NOT a.attisdropped
       AND c.relkind = 'r'
     ORDER BY c.relname
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION write_audit_log()', t, t);
  END LOOP;
END $$;
