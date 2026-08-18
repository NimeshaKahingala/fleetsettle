-- Phase 2 of the platform-admin/multi-business design
-- (PLATFORM-ADMIN-AND-MULTI-BUSINESS-DESIGN-2026-08-17.md, decisions 1-5,
-- 17, 21-24). Depends on Phase 1 (migration 0029) having landed.
--
-- None of platform_admin, business_creation_request or platform_audit_log
-- carry business_id or posted_period_id — they sit above the business, not
-- inside one (DM §3.2, IG §7.6). Correctly absent from assert_period_open()'s
-- array (migration 0001) and write_audit_log()'s discovery loop (migration
-- 0002). Say so explicitly rather than leaving a reviewer to wonder whether
-- it was missed.

-- W-64: a per-identity allowance, not a hardcoded constant (decision 22) —
-- counts active owner/owner-manager memberships (Phase 2's domain layer),
-- below which POST /api/business is immediate.
ALTER TABLE app_user ADD COLUMN business_allowance int NOT NULL DEFAULT 5;

-- W-65: one row per admin, re-grantable. PRIMARY KEY on the parent's own id
-- rather than a surrogate — the same shape business_settings already uses
-- for "one row per parent entity" (migration 0001), one level up.
CREATE TABLE platform_admin (
  user_id     uuid PRIMARY KEY REFERENCES app_user(id),
  granted_by  uuid REFERENCES app_user(id),      -- null for the bootstrap row
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

CREATE UNIQUE INDEX platform_admin_active ON platform_admin (user_id) WHERE revoked_at IS NULL;

-- W-63, W-64. A held request, not a pending business row — decision 2:
-- nothing exists until approved, so the 30+ existing business routes never
-- gain a status to check.
CREATE TABLE business_creation_request (
  id                uuid PRIMARY KEY,
  requested_by      uuid NOT NULL REFERENCES app_user(id),
  name              text NOT NULL,
  currency_code     char(3) NOT NULL,
  timezone          text NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected')),
  decided_by        uuid REFERENCES app_user(id),
  decided_at        timestamptz,
  rejection_reason  text,
  business_id       uuid REFERENCES business(id),   -- set on approval, null otherwise
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- INV-41: at most one outstanding request per identity. The same idiom as
-- one_active_business_per_user (dropped, migration 0029) and as
-- business_member_active_pair (migration 0010, still live) — a partial
-- unique index scoped to the one status that must stay singular.
CREATE UNIQUE INDEX business_creation_request_one_pending
  ON business_creation_request (requested_by) WHERE status = 'pending';

-- W-67. A separate table from audit_log (migration 0001/0002) because
-- audit_log.business_id is NOT NULL, and platform actions have no business
-- to be NOT NULL about.
CREATE TABLE platform_audit_log (
  id           bigserial PRIMARY KEY,   -- allow: append-only log, never in a URL
  action       text NOT NULL CHECK (action IN
                  ('request_approved','request_rejected',
                   'admin_granted','admin_revoked','allowance_changed')),
  subject_id   uuid NOT NULL,           -- the request id, or the affected user_id
  actor_id     uuid NOT NULL REFERENCES app_user(id),
  self_action  boolean NOT NULL DEFAULT false,   -- W-67: actor == requester/subject
  detail_json  jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE RULE platform_audit_log_no_update AS ON UPDATE TO platform_audit_log DO INSTEAD NOTHING;
CREATE RULE platform_audit_log_no_delete AS ON DELETE TO platform_audit_log DO INSTEAD NOTHING;

-- INV-40, mirrors assert_business_has_owner() (migration 0010) one level
-- up: the moment admin administration exists, the first thing it enables is
-- the last admin revoking themselves and locking the tier out permanently,
-- with no higher authority able to restore it, only hand-run SQL against
-- production. Fires on UPDATE only — an INSERT can never by itself remove
-- the last admin.
CREATE OR REPLACE FUNCTION assert_platform_has_admin() RETURNS trigger AS $$
DECLARE remaining int;
BEGIN
  SELECT count(*) INTO remaining FROM platform_admin WHERE revoked_at IS NULL;
  IF remaining = 0 THEN
    RAISE EXCEPTION 'the platform would have no active admin (INV-40)';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

-- Deferred for the identical reason business_has_owner is: a re-grant after
-- a revoke is one UPDATE — platform_admin's PK is user_id itself, so there
-- is no two-row trick available to it the way business_member's is.
CREATE CONSTRAINT TRIGGER platform_has_admin
  AFTER UPDATE ON platform_admin
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_platform_has_admin();

-- W-67, mirrors business_member_audit's own reasoning (migration 0002):
-- platform_admin's grant/revoke history must not depend on every future
-- admin endpoint remembering to write it by hand. self_action isn't
-- computable by a generic diff — it needs the acting admin's own id
-- compared against the row changing — so this is purpose-built rather than
-- a reuse of write_audit_log(), which also requires business_id, absent
-- here. Reuses audit_actor() (migration 0002) for the actor read itself,
-- rather than a second current_setting('fleetsettle.actor_id', …) call
-- site to keep in sync with it.
CREATE OR REPLACE FUNCTION write_platform_admin_audit() RETURNS trigger AS $$
DECLARE actor uuid;
BEGIN
  actor := audit_actor();
  INSERT INTO platform_audit_log (action, subject_id, actor_id, self_action)
  VALUES (
    CASE WHEN NEW.revoked_at IS NOT NULL THEN 'admin_revoked' ELSE 'admin_granted' END,
    NEW.user_id,
    actor,
    actor = NEW.user_id
  );
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER platform_admin_audit
  AFTER INSERT OR UPDATE ON platform_admin
  FOR EACH ROW EXECUTE FUNCTION write_platform_admin_audit();
