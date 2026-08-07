-- 0010_business_member_invite.sql
--
-- A11/W-57: no second person can ever join a business. business_member has
-- no writer but POST /api/business — this migration is the schema half of
-- fixing that (GAP-43). Three prerequisites, then the table the invite
-- endpoints need. None of this touches a money table, so none of the golden
-- fixtures (134,000 / 15,000 / 7,500) can move.

-- GAP-52. business_member_business_id_user_id_key (0001, confirmed against
-- the live branch rather than assumed:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'business_member'::regclass;
-- returns it) is a plain table-level UNIQUE on (business_id, user_id). 0003's
-- own header comment claims a revoked row "can be re-granted... without this
-- index in the way" — true of one_active_business_per_user, which it was
-- describing, but false of this constraint one line above it, which still
-- blocks exactly that: F-1.4's own alternate is revoke, then re-invite the
-- same person into the same business. A partial unique index — scoped to the
-- active pair only — is what the flow actually needs; a revoked row no
-- longer occupies the slot.
ALTER TABLE business_member DROP CONSTRAINT business_member_business_id_user_id_key; -- allow: replacing a table-level UNIQUE with a partial index that enforces the same pair-uniqueness, only scoped to active rows (GAP-52) — no column dropped, no data lost, every currently-unique (business_id, user_id) pair stays unique
CREATE UNIQUE INDEX business_member_active_pair
  ON business_member (business_id, user_id) WHERE revoked_at IS NULL;

-- GAP-53. write_audit_log() (0002) attaches itself to every table carrying
-- posted_period_id, discovered rather than hand-listed. business_member is
-- not a money table and carries no such column, so the loop has never
-- covered it: who granted or revoked a role has been recorded nowhere. The
-- function reads only NEW.business_id and NEW.id, both present already.
CREATE TRIGGER business_member_audit
  AFTER INSERT OR UPDATE ON business_member
  FOR EACH ROW EXECUTE FUNCTION write_audit_log();

-- INV-31. A11 is what first makes revoking or demoting a member possible at
-- all — until now the only writer of this table was createBusiness's single
-- insert. Without this, the first thing member administration enables is an
-- owner revoking or demoting themselves (or the business's only other owner)
-- and locking the business out permanently, with no endpoint able to undo
-- it.
--
-- UPDATE only, not INSERT: an INSERT can only ever add a row, so it can
-- never by itself reduce a business's active-owner count to zero — only an
-- UPDATE that sets revoked_at can. Every real removal path (revokeBusinessMember,
-- and changeBusinessMemberRole's revoke half) is an UPDATE, so covering
-- INSERT too would add no protection a real write needs, at the cost of
-- rejecting an ordinary insert into a business that a fixture (or a future
-- bulk-import) populated members-first, owner-later within one transaction.
-- Deferred, exactly as assert_shares_total (0001) is: a role change is
-- revoke-then-grant, two statements in one transaction (never an in-place
-- UPDATE — that would lose the history), and an immediate check would
-- reject the revoke half before the grant half lands.
CREATE OR REPLACE FUNCTION assert_business_has_owner() RETURNS trigger AS $$
DECLARE remaining int;
BEGIN
  SELECT count(*) INTO remaining FROM business_member
   WHERE business_id = NEW.business_id
     AND role IN ('owner','owner_manager')
     AND revoked_at IS NULL;
  IF remaining = 0 THEN
    RAISE EXCEPTION 'business % would have no active owner or owner-manager (INV-31)',
                    NEW.business_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER business_has_owner
  AFTER UPDATE ON business_member
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_business_has_owner();

-- W-57. The F-1.4 counterpart to driver_link_invite (0001, W-42) — same
-- shape, a code scoped to a business and a chosen role rather than to one
-- driver record. The plaintext code is returned once, in the invite
-- response; only its hash is stored. Not a money table: no posted_period_id,
-- so assert_period_open()'s trigger array and the audit-trigger discovery
-- loop both correctly skip it.
CREATE TABLE business_member_invite (
  id          uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES business(id),
  role        text NOT NULL CHECK (role IN ('owner','owner_manager','manager')),
  code_hash   text NOT NULL,
  created_by  uuid NOT NULL REFERENCES app_user(id),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES app_user(id)
);
